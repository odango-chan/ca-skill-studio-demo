/**
 * CA-SL v1alpha4 source-shape projection for editor diagnostics.
 * Frozen source: ca-skills@7f84393ee8c395e4d8c39a74cb5000a1f896588d.
 *
 * This intentionally does not link Owner/Catalog/Capabilities or claim
 * Compiler/Host qualification. Missing trust always stays explicit.
 */
import { parseDocument, isMap, isScalar, isSeq } from "yaml";
import type { PackageDocumentSnapshot, LanguageDiagnostic, ProcedureProjection, ProcedureNode, ProcedureRoute } from "./types.js";

const CONTRACT_FIELDS = new Set(["goal","precondition","requestSchema","contextSchema","dependencies","capabilities","limits"]);
const STAGES = ["precondition","operation","observation","postcondition"] as const;
const TERMINALS = new Set(["SUCCEEDED","FAILED","UNRESOLVED","SAFE_STOPPED"]);
const OLD_FIELDS = new Set(["procedures","with","call","verify","reconcile","resolve","preconditions","postconditions","on","terminal","entryProcedure","apiVersion","kind","metadata","target"]);
const EVAL_FIELDS = new Set(["parameters","evidence","evaluator"]);

export function isV1Alpha4Procedure(text: string): boolean {
  // Detect incomplete authoring snapshots too: deleting one root key in the editor
  // must not silently re-route the document into the legacy v0.2 analyzer.
  return /^(?:start|nodes):[ \t]*/m.test(text);
}

type SyntaxResult = {root: any; document: PackageDocumentSnapshot} | null;

export function analyzeV1Alpha4Source(
  documents: ReadonlyMap<string, PackageDocumentSnapshot>,
  packageName: string
): {procedure: ProcedureProjection; diagnostics: LanguageDiagnostic[]} {
  const diagnostics: LanguageDiagnostic[] = [];
  function add(document: PackageDocumentSnapshot, code: string, message: string, item?: any, severity: "error" | "warning"="error") {
    const position = Array.isArray(item?.range) && Number.isInteger(item.range[0]) ? item.range[0] : 0;
    const line = document.text.slice(0, position).split("\n").length;
    diagnostics.push({
      code, message, severity, uri:document.uri,
      relativePath:document.relativePath, source:"procedure-projection", confidence:"exact", line
    });
  }
  function parse(path: string): SyntaxResult {
    const document = documents.get(path);
    if (!document) return null;
    let parsed;
    try {
      parsed = parseDocument(document.text, {
        version:"1.2",schema:"core",strict:true,uniqueKeys:true,keepSourceTokens:true,logLevel:"silent"
      });
    } catch (error) {
      add(document,"YAML_PARSE_ERROR","YAML parser rejected source: "+String(error));
      return null;
    }
    if (parsed.errors.length) {
      for (const error of parsed.errors)
        add(document,"YAML_PARSE_ERROR",error.message,{range:[error.pos?.[0]??0]});
      return null;
    }
    if (!isMap(parsed.contents)) {
      add(document,"SOURCE_ROOT_INVALID","CA-SL v1alpha4 "+path+" must have a mapping root");
      return null;
    }
    return {root:parsed.contents,document};
  }
  function props(root: any, document: PackageDocumentSnapshot, allowed: ReadonlySet<string>) {
    if (!isMap(root)) {
      add(document,"SOURCE_ROOT_INVALID","Expected a YAML mapping",root);
      return;
    }
    for (const pair of root.items) {
      const key = isScalar(pair.key) ? String(pair.key.value) : "";
      if (!allowed.has(key)) add(document,OLD_FIELDS.has(key)?"UNKNOWN_FIELD":"UNKNOWN_FIELD","Unsupported CA-SL v1alpha4 field: "+key,pair.key);
    }
  }
  function scalar(node: any): string {
    return isScalar(node) && typeof node.value === "string" ? node.value : "";
  }
  function keys(node: any): string[] {
    return isMap(node) ? node.items.map((item:any)=>scalar(item.key)) : [];
  }
  function lineAt(document:PackageDocumentSnapshot,item:any):number {
    const offset=Array.isArray(item?.range)?item.range[0]:0;
    return document.text.slice(0,offset).split("\n").length;
  }

  const c=parse("assurance/contract.yaml");
  const p=parse("assurance/procedure.yaml");
  const predicates=parse("assurance/predicates.yaml");
  if (c) {
    props(c.root,c.document,CONTRACT_FIELDS);
    if (!scalar(c.root.get("goal",true))) add(c.document,"SOURCE_ROOT_INVALID","Contract must declare one goal",c.root);
    const gate=c.root.get("precondition",true);
    if (gate!==undefined && (!scalar(gate) || !/^[A-Za-z][A-Za-z0-9_-]*\.precondition$/.test(scalar(gate))))
      add(c.document,"ENTRY_PRECONDITION_REF_INVALID","Contract precondition is a single node.precondition reference",gate);
  }
  const predicateSignatures=new Map<string,any[]>();
  if (predicates) {
    props(predicates.root,predicates.document,new Set(["predicates"]));
    const declared=predicates.root.get("predicates",true);
    if (!isMap(declared)) add(predicates.document,"SOURCE_ROOT_INVALID","PredicateSet must contain a predicates mapping",declared);
    else for (const item of declared.items) {
      props(item.value,predicates.document,EVAL_FIELDS);
      const predicateId=scalar(item.key);
      const parameters=isMap(item.value)?item.value.get("parameters",true):null;
      // An empty list is the explicit zero-parameter signature in v1alpha4.
      if (!isSeq(parameters) || parameters.items.some((x:any)=>!isMap(x)||x.items.length!==1))
        add(predicates.document,"PREDICATE_GROUP_INVALID","Predicate parameters must be an ordered list of one-key mappings (an empty list declares zero parameters)",parameters??item.value);
      else if(predicateId)predicateSignatures.set(predicateId,parameters.items);
    }
  }
  function primitiveLiteralType(node:any,document:PackageDocumentSnapshot):string|null {
    if(!isScalar(node))return null;
    if(typeof node.value==="boolean")return "boolean";
    if(typeof node.value==="number")return Number.isInteger(node.value)?"integer":"number";
    if(typeof node.value==="string"){
      const raw=Array.isArray(node.range)?document.text.slice(node.range[0],node.range[1]):"";
      if(raw.startsWith('"')||raw.startsWith("'"))return "string";
      // Bare strings are SourcePaths in this language. Their type must come
      // from the exact Context / Producer Schema, never from the YAML scalar.
      return null;
    }
    return null;
  }

  const empty:ProcedureProjection={state:"UNAVAILABLE",entry:null,procedures:[],diagnostics};
  if (!p) return {procedure:empty,diagnostics};
  props(p.root,p.document,new Set(["start","nodes"]));
  const start=scalar(p.root.get("start",true));
  const rawNodes=p.root.get("nodes",true);
  if (!isMap(rawNodes) || !rawNodes.items.length) {
    add(p.document,"SOURCE_ROOT_INVALID","Procedure must contain a nonempty nodes mapping",rawNodes);
    return {procedure:empty,diagnostics};
  }
  const declared=new Set(keys(rawNodes));
  if (!start || !declared.has(start)) add(p.document,"PROCEDURE_START_MISSING","start must name a declared Node",p.root.get("start",true));
  const nodes:ProcedureNode[]=[];
  const routes:ProcedureRoute[]=[];
  // Reachability belongs to (Node,Stage), not just Node. A routed normal
  // outcome skips later stages in that Node; only an unrouted normal
  // outcome implicitly falls through (§12.1, §12.9).
  const adjacency=new Map<string,string[]>();
  const firstStage=new Map<string,string>();
  for (const item of rawNodes.items) {
    const id=scalar(item.key);
    const body:any=item.value;
    if (!id || TERMINALS.has(id) || id==="context") {
      add(p.document,"NODE_ID_RESERVED","Node has missing or reserved identifier",item.key);
      continue;
    }
    props(body,p.document,new Set(STAGES));
    const stageNames=STAGES.filter(x=>isMap(body)&&body.has(x));
    if (!stageNames.length) add(p.document,"SOURCE_ROOT_INVALID","Node must declare at least one stage",body);
    if (stageNames.length)firstStage.set(id,id+"."+stageNames[0]);
    for (const stage of stageNames) {
      const outgoing:string[]=[];
      const part=body.get(stage,true);
      if (!isMap(part)) { add(p.document,"SOURCE_ROOT_INVALID",stage+" stage must be a mapping",part);continue; }
      props(part,p.document,new Set(stage==="precondition"||stage==="postcondition"
        ?["predicates","routes"]
        :stage==="observation"?["tool","arguments","routes"]:["tool","script","arguments","retryOf","routes"]));
      if (stage==="precondition"||stage==="postcondition") {
        const calls=part.get("predicates",true);
        if (!isSeq(calls)||!calls.items.length) add(p.document,"PREDICATE_GROUP_INVALID","Stage predicates must be a nonempty ordered list",calls??part);
        else for (const call of calls.items) {
          props(call,p.document,new Set(["predicate","arguments"]));
          const signature=isMap(call)?call.get("predicate",true):null;
          const argumentsNode=isMap(call)?call.get("arguments",true):null;
          if (!scalar(signature)||!isSeq(argumentsNode))
            add(p.document,"PREDICATE_GROUP_INVALID","Every predicate call needs predicate and positional arguments",call);
          else {
            const parameters=predicateSignatures.get(scalar(signature));
            if(parameters){
              if(argumentsNode.items.length!==parameters.length)
                add(p.document,"PREDICATE_ARITY_MISMATCH",
                  "Predicate "+scalar(signature)+" expects "+parameters.length+
                  " positional arguments but received "+argumentsNode.items.length,
                  argumentsNode);
              else for(let index=0;index<parameters.length;index++){
                const parameter=parameters[index];
                const targetType=isMap(parameter)?scalar(parameter.items[0]?.value):"";
                const actualType=primitiveLiteralType(argumentsNode.items[index],p.document);
                if(!actualType||!["string","integer","number","boolean"].includes(targetType))continue;
                const compatible=targetType==="number"
                  ?actualType==="integer"||actualType==="number"
                  :targetType===actualType;
                if(!compatible)add(p.document,"PREDICATE_TYPE_MISMATCH",
                  "Predicate "+scalar(signature)+" argument "+(index+1)+
                  " requires "+targetType+" but received "+actualType,
                  argumentsNode.items[index]);
              }
            }
          }
        }
      } else {
        const tool=part.get("tool",true),script=part.get("script",true);
        if ((tool===undefined)===(script===undefined))
          add(p.document,"CONTROL_FLOW_AMBIGUOUS","Exactly one tool or script target is required",part);
        if (stage==="observation" && script!==undefined)
          add(p.document,"UNKNOWN_FIELD","Observation cannot invoke a Script",script);
        if (!isMap(part.get("arguments",true))) add(p.document,"SOURCE_ROOT_INVALID","Tool/Script arguments must be a named mapping",part);
      }
      const rawRoutes=part.get("routes",true);
      if (rawRoutes!==undefined && !isMap(rawRoutes)) {
        add(p.document,"SOURCE_ROOT_INVALID","Stage routes must be a mapping",rawRoutes);
        continue;
      }
      if (isMap(rawRoutes)) for (const route of rawRoutes.items) {
        const outcome=scalar(route.key),target=scalar(route.value);
        const allowedOutcomes=stage==="precondition"||stage==="postcondition"
          ?new Set(["PASS","FAIL","UNKNOWN"])
          :stage==="observation"
            ?new Set(["SUCCEEDED","FAILED","DENIED","UNKNOWN"])
            :part.has("script")
              ?new Set(["SUCCEEDED","FAILED"])
              // Tool Effect and Owner-declared outcomes require trusted linking.
              // Accept the union here, but never infer which outcomes are valid.
              :new Set(["SUCCEEDED","FAILED","DENIED","UNKNOWN",
                "NOT_COMMITTED","OUTCOME_UNKNOWN","COMMITTED"]);
        if(!allowedOutcomes.has(outcome))
          add(p.document,"ROUTE_OUTCOME_UNKNOWN",
            "Outcome "+outcome+" is not valid for "+stage+" stage source",route.key);
        const isTerminal=TERMINALS.has(target);
        if (!target||(!isTerminal&&!declared.has(target)))
          add(p.document,"ROUTE_TARGET_INVALID","Route target must be a Node or terminal status",route.value);
        if (outcome==="OUTCOME_UNKNOWN" && !["UNRESOLVED","SAFE_STOPPED"].includes(target))
          add(p.document,"ROUTE_OUTCOME_UNKNOWN","OUTCOME_UNKNOWN can only safely stop",route.value);
        if(!isTerminal && declared.has(target))outgoing.push(target);
        routes.push({
          id:id+"."+stage+"."+outcome,
          source:id,outcome,target,routeSource:stage,
          line:lineAt(p.document,route.key),
          sourceSpan:{start:(route.key as any)?.range?.[0]??0,end:(route.key as any)?.range?.[1]??0},
          patchable:false
        });
      }
      // Enforce stage-local outcomes that do not require Owner linking.
      if (stage==="precondition"||stage==="postcondition") {
        for(const key of ["FAIL","UNKNOWN"])if(!isMap(rawRoutes)||!rawRoutes.has(key))
          add(p.document,"ROUTE_OUTCOME_MISSING","Predicate stage requires "+key+" route",part);
      }
      if(stage==="operation"&&part.has("script")&&
         (!isMap(rawRoutes)||!rawRoutes.has("FAILED")))
        add(p.document,"ROUTE_OUTCOME_MISSING","Procedure Script requires FAILED route",part);
      const next=stageNames[stageNames.indexOf(stage)+1];
      const normal=(stage==="precondition"||stage==="postcondition")?"PASS":"SUCCEEDED";
      if(next){
        if(isMap(rawRoutes)&&rawRoutes.has(normal))
          add(p.document,"ROUTE_NORMAL_OUTCOME_NOT_ALLOWED",
            "Normal "+normal+" outcome advances to the next stage and must not be routed explicitly",rawRoutes.get(normal,true));
        else outgoing.push(id+"."+next);
      }else if(!isMap(rawRoutes)||!rawRoutes.has(normal)){
        add(p.document,"ROUTE_OUTCOME_MISSING",
          "Final "+stage+" stage requires "+normal+" route",part);
      }
      adjacency.set(id+"."+stage,outgoing);
    }
    nodes.push({
      id, operator:stageNames[0]??"",value:stageNames.join(", "),
      line:lineAt(p.document,item.key),phases:[],children:[]
    });
  }
  const visited=new Set<string>(),active=new Set<string>();
  let cycle=false;
  function walk(stage:string) {
    if(active.has(stage)){cycle=true;return;}
    if(visited.has(stage))return;
    visited.add(stage);active.add(stage);
    for(const child of adjacency.get(stage)??[]) {
      const target=firstStage.get(child)??child;
      if(adjacency.has(target))walk(target);
    }
    active.delete(stage);
  }
  const entry=firstStage.get(start);
  if(entry)walk(entry);
  if(cycle)add(p.document,"CONTROL_FLOW_CYCLE","Procedure DAG contains a reachable cycle",rawNodes);
  for (const item of rawNodes.items) {
    const id=scalar(item.key),head=firstStage.get(id);
    if (head && !visited.has(head))
      add(p.document,"UNREACHABLE_NODE",
        "Node "+id+" is not reachable from start",item.key,"warning");
  }
  // A Contract gate must identify a real, reachable Precondition stage.
  // This lexical/source check requires no trusted Owner publication.
  if (c) {
    const gate=c.root.get("precondition",true);
    const reference=scalar(gate);
    if (reference && /^[A-Za-z][A-Za-z0-9_-]*\.precondition$/.test(reference)) {
      const nodeId=reference.slice(0,-".precondition".length);
      const node=rawNodes.get(nodeId,true);
      if (!isMap(node) || !isMap(node.get("precondition",true)) || !visited.has(nodeId+".precondition"))
        add(c.document,"ENTRY_PRECONDITION_REF_INVALID",
          "Contract precondition must reference a reachable Node precondition stage",gate);
    }
  }
  // Success is a property of reachable source routes, not simply of a key
  // appearing anywhere in the YAML. An orphan final stage cannot prove Goal
  // or hide a reachable bypass (§12.9).
  const successRoutes=routes.filter(route=>visited.has(route.source+"."+route.routeSource)&&route.target==="SUCCEEDED");
  const hasValidSuccess=successRoutes.some(route=>
    route.routeSource==="postcondition"&&route.outcome==="PASS");
  if(successRoutes.length && !hasValidSuccess)
    add(p.document,"FINAL_POSTCONDITION_MISSING",
      "Only a reachable final Postcondition aggregate PASS may request SUCCEEDED");
  if(hasValidSuccess)for(const route of successRoutes)if(
    !(route.routeSource==="postcondition"&&route.outcome==="PASS"))
    add(p.document,"SUCCESS_BYPASSES_FINAL_POSTCONDITION",
      "A reachable non-final stage bypasses final Goal proof");
  // Projection READY means source graph shape is available for editor rendering,
  // *never* that the Tool/Schema/Capability trust closure has been compiled.
  const projection:ProcedureProjection={
    // Invalid Contract/PredicateSet text must not hide a structurally
    // valid Procedure graph while its author is editing another document.
    state: diagnostics.some(x=>x.severity==="error"&&
      x.relativePath===p.document.relativePath)?"UNAVAILABLE":"READY",
    entry:start,diagnostics:diagnostics.filter(x=>x.relativePath===p.document.relativePath),
    procedures:[{
      name:packageName,start,nodes,routes,children:[],
      line:1,profile:"CA-SL v1alpha4 (editor source projection only)"
    }]
  };
  return {procedure:projection,diagnostics};
}
