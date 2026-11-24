// Conservative, Schema-backed CA-SL value path completions. Source-local
// context.request fields and strictly dominating producer outputs only.
// This is an authoring hint, not a claim about Runtime inputs or trust.
import {parseDocument,isMap,isScalar} from "yaml";
import {projectSchemaPropertyTree} from "./schema-path-projection.mjs";

const NAME=/^[A-Za-z_][A-Za-z0-9_-]*$/;
const NODE=/^[A-Za-z][A-Za-z0-9_-]*$/;
const STAGES=["precondition","operation","observation","postcondition"];
const TERMINALS=new Set(["SUCCEEDED","FAILED","UNRESOLVED","SAFE_STOPPED"]);
function field(m,key){return isMap(m)?m.get(key,true):null;}
function value(n){return isScalar(n)?n.value:null;}
function parse(text){
  if(typeof text!=="string"||text.length>2*1024*1024)return null;
  try{
    const doc=parseDocument(text,{
      version:"1.2",schema:"core",strict:true,uniqueKeys:true,
      stringKeys:true,logLevel:"silent"
    });
    return doc.errors.length?null:doc.contents;
  }catch{return null;}
}
function scope(source,lineStart){
  let nodes=false,node=null,stage=null,argumentsSection=false;
  for(const line of source.slice(0,lineStart).split(/\r?\n/)){
    if(/^nodes:\s*(?:#.*)?$/.test(line)){
      nodes=true;node=null;stage=null;argumentsSection=false;continue;
    }
    if(/^[^\s#]/.test(line)){
      nodes=false;node=null;stage=null;argumentsSection=false;continue;
    }
    if(!nodes)continue;
    const nextNode=/^ {2}([A-Za-z][A-Za-z0-9_-]*):\s*(?:#.*)?$/.exec(line);
    if(nextNode){
      node=nextNode[1];stage=null;argumentsSection=false;continue;
    }
    if(!node)continue;
    const nextStage=/^ {4}(precondition|operation|observation|postcondition):\s*(?:#.*)?$/.exec(line);
    if(nextStage){
      stage=nextStage[1];argumentsSection=false;continue;
    }
    if(/^ {4}[A-Za-z]/.test(line)){
      stage=null;argumentsSection=false;continue;
    }
    const nextSection=/^ {6}(arguments|routes|predicates|tool|script|retryOf):/.exec(line);
    if(nextSection)argumentsSection=nextSection[1]==="arguments";
  }
  return node&&stage&&argumentsSection?{node,stage}:null;
}
function requestTree(snapshot){
  const contract=snapshot.documents.find(d=>d.relativePath==="assurance/contract.yaml");
  if(!contract)return null;
  const root=parse(contract.text);
  if(!isMap(root))return null;
  const request=value(field(root,"requestSchema"));
  if(typeof request!=="string"||!/^schemas\/[A-Za-z0-9_.-]+\.schema\.(?:yaml|yml|json)$/.test(request))
    return null;
  const matches=snapshot.documents.filter(d=>d.relativePath===request&&d.readable!==false);
  if(matches.length!==1)return null;
  return projectSchemaPropertyTree(matches[0].text);
}
function graphInfo(source){
  const root=parse(source),nodes=field(root,"nodes"),start=value(field(root,"start"));
  if(!isMap(nodes)||typeof start!=="string"||!NODE.test(start)||nodes.items.length>256)
    return null;
  const items=new Map();
  for(const entry of nodes.items){
    const id=value(entry.key);
    if(typeof id!=="string"||!NODE.test(id)||!isMap(entry.value)||items.has(id))
      return null;
    items.set(id,entry.value);
  }
  if(!items.has(start))return null;
  const edges=new Map();
  for(const [id,node] of items){
    const out=new Set();
    for(const stage of ["wait",...STAGES]){
      const routes=field(field(node,stage),"routes");
      if(routes===null||routes===undefined)continue;
      if(!isMap(routes))return null;
      for(const route of routes.items){
        const target=value(route.value);
        if(typeof target!=="string")return null;
        if(items.has(target))out.add(target);
        else if(!TERMINALS.has(target))return null;
      }
    }
    edges.set(id,[...out]);
  }
  // Source Projection may be temporarily invalid while the user edits a DAG.
  // Cyclic branches cannot supply a dominance proof.
  const visited=new Set(),active=new Set();
  function visit(node){
    if(active.has(node))return false;
    if(visited.has(node))return true;
    active.add(node);
    for(const target of edges.get(node)??[])if(!visit(target))return false;
    active.delete(node);
    visited.add(node);
    return true;
  }
  for(const id of items.keys())if(!visit(id))return null;
  return {start,items,edges};
}
function reachable(graph,target,excluded=null){
  if(graph.start===excluded)return false;
  const seen=new Set(),queue=[graph.start];
  while(queue.length){
    const id=queue.shift();
    if(id===excluded||seen.has(id))continue;
    if(id===target)return true;
    seen.add(id);
    if(seen.size>256)return false;
    for(const next of graph.edges.get(id)??[])if(!seen.has(next))queue.push(next);
  }
  return false;
}
function canReachFrom(graph,origin,target){
  const seen=new Set(),queue=[origin];
  while(queue.length){
    const item=queue.shift();
    if(item===target)return true;
    if(seen.has(item))continue;
    seen.add(item);
    for(const next of graph.edges.get(item)??[])if(!seen.has(next))queue.push(next);
  }
  return false;
}
function producerTree(snapshot,graph,current,producer,stage){
  if(producer===current||!graph.items.has(producer)||
     !reachable(graph,current)||!reachable(graph,producer)||
     reachable(graph,current,producer))return null;
  const node=graph.items.get(producer),segment=field(node,stage);
  if(!isMap(segment))return null;
  // Node dominance is necessary, not sufficient. An earlier business stage
  // might branch to the consumer before this output was produced.
  for(const earlier of ["wait",...STAGES.slice(0,STAGES.indexOf(stage))]){
    const routes=field(field(node,earlier),"routes");
    if(!isMap(routes))continue;
    for(const item of routes.items){
      const target=value(item.value);
      if(graph.items.has(target)&&canReachFrom(graph,target,current))
        return null;
    }
  }
  const tool=value(field(segment,"tool"));
  if(typeof tool!=="string")return null;
  const matches=(snapshot.schemaCompletionHints??[]).filter(h=>
    h.id===tool&&h.kind===stage&&h.trust==="DECLARATION_ONLY"&&
    Array.isArray(h.outputProperties));
  return matches.length===1?matches[0].outputProperties:null;
}
function descend(tree,segments){
  let level=tree;
  for(const name of segments){
    if(!Array.isArray(level))return null;
    const matches=level.filter(f=>f?.name===name);
    if(matches.length!==1)return null;
    level=matches[0].children;
  }
  return Array.isArray(level)?level:null;
}
export function schemaValuePathCompletions(snapshot,document,prefix,offset,lineStart,lineNumber){
  if(snapshot?.completeness!=="complete"||
     document?.relativePath!=="assurance/procedure.yaml"||
     !Array.isArray(snapshot.documents)||typeof prefix!=="string"||
     !Number.isSafeInteger(offset)||!Number.isSafeInteger(lineStart)||
     !Number.isSafeInteger(lineNumber))return null;
  const active=scope(document.text,lineStart);
  if(!active||!["operation","observation"].includes(active.stage))return null;
  const match=/^ {8}[A-Za-z_][A-Za-z0-9_-]*:\s*((?:context\.request|[A-Za-z][A-Za-z0-9_-]*\.(?:operation|observation)\.output)\.[A-Za-z0-9_.-]*)$/.exec(prefix);
  if(!match)return null;
  const expr=match[1],end=expr.lastIndexOf("."),typed=expr.slice(end+1);
  if(typed&&!NAME.test(typed))return [];
  const base=expr.slice(0,end);
  let tree,path;
  if(base==="context.request"||base.startsWith("context.request.")){
    tree=requestTree(snapshot);
    path=base==="context.request"?[]:base.slice("context.request.".length).split(".");
  }else{
    const producer=/^([A-Za-z][A-Za-z0-9_-]*)\.(operation|observation)\.output(?:\.(.*))?$/.exec(base);
    if(!producer)return null;
    const graph=graphInfo(document.text);
    if(!graph)return [];
    tree=producerTree(snapshot,graph,active.node,producer[1],producer[2]);
    path=producer[3]?producer[3].split("."):[];
  }
  if(!Array.isArray(tree))return [];
  if(path.some(seg=>!NAME.test(seg)))return [];
  const fields=descend(tree,path);
  if(!fields)return [];
  const start=offset-typed.length;
  return fields.filter(f=>typeof f?.name==="string"&&NAME.test(f.name)&&
    f.name.startsWith(typed)).sort((a,b)=>a.name.localeCompare(b.name))
    .map(f=>({
      label:f.name,
      kind:10,
      detail:"Schema "+f.type+" · declared path · AUTH_NOT_CHECKED",
      documentation:f.description??"",
      textEdit:{
        range:{
          start:{line:lineNumber,character:start-lineStart},
          end:{line:lineNumber,character:offset-lineStart}
        },
        newText:f.name
      }
    }));
}
