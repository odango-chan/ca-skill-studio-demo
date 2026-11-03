import {parseDocument,isMap,isScalar} from "yaml";
import {projectWorkspace} from "./workspace.mjs";
import {predicateChoices} from "./attribute-patch.mjs";

// D2-A2: insert a typed Node into ONE existing Route. The YAML is the only
// authority. This protects projection structure; it is NOT a Runtime validator.
const ID=/^[A-Za-z_][A-Za-z0-9_.-]*$/;
const OPERATORS=new Set(["terminal","call","verify"]);
const fail=message=>{throw new Error(message);};
function plainScalar(text,node,expected){
  if(!isScalar(node)||typeof node.value!=="string"||
     node.value!==expected||!Array.isArray(node.range))
    fail("Source scalar missing");
  const [start,end]=node.range;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||
     start<0||end<=start||text.slice(start,end)!==expected)
    fail("Route target is quoted or not a plain scalar");
  return {start,end};
}
function snapshot(model){
  return [...model.procedures.values()].map(p=>({
    name:p.name,start:p.start,
    nodes:p.nodes.map(n=>({
      id:n.id,operator:n.operator,value:n.value,
      phases:n.phases.map(ph=>({name:ph.name,
        steps:ph.steps.map(st=>({name:st.name,operator:st.operator,value:st.value}))})),
      children:n.children.map(c=>({procedure:c.procedure,via:c.via,caller:c.caller}))
    })),
    routes:p.routes.map(r=>({
      id:r.id,source:r.source,outcome:r.outcome,
      target:r.target,routeSource:r.routeSource
    }))
  }));
}
function predicateSet(source,skillName){
  if(typeof source!=="string"||!ID.test(skillName))return [];
  const doc=parseDocument(source,{version:"1.2",schema:"core",
    uniqueKeys:true,strict:true,logLevel:"silent"});
  if(doc.errors.length||doc.get("kind")!=="PredicateSet"||
     doc.getIn(["metadata","skill"])!==skillName)return [];
  return predicateChoices(source);
}
function context(source,procedureId,routeId){
  if(typeof source!=="string"||!ID.test(procedureId)||
    typeof routeId!=="string"||routeId.length>240)
    fail("Invalid Procedure or Route");
  const before=projectWorkspace(source);
  if(before.state!=="READY")fail("Procedure Source cannot be projected");
  const procedure=before.procedures.get(procedureId);
  if(!procedure||procedure.nodes.length>=300||procedure.routes.length>=1600)
    fail("Procedure missing or exceeds editing budget");
  const route=procedure.routes.find(r=>r.id===routeId);
  if(!route||!route.patchable||!route.sourceSpan)
    fail("Route is not eligible for insertion");
  const doc=parseDocument(source,{version:"1.2",schema:"core",
    strict:true,uniqueKeys:true,stringKeys:true,keepSourceTokens:true,logLevel:"silent"});
  if(doc.errors.length)fail("YAML parse failed");
  const nodeMap=doc.getIn(["procedures",procedureId,"nodes"],true);
  if(!isMap(nodeMap)||!nodeMap.items.length)fail("Node map is empty or invalid");
  const first=nodeMap.items[0].key;
  if(!isScalar(first)||!first.range)fail("Cannot anchor insertion");
  const insertAt=first.range[0];
  if(!Number.isSafeInteger(insertAt)||insertAt<0||insertAt>source.length)
    fail("Invalid insertion offset");
  const lineStart=source.lastIndexOf("\n",insertAt-1)+1;
  const indent=source.slice(lineStart,insertAt);
  if(!/^ {2,24}$/.test(indent)||indent.length>20)
    fail("Node indentation is not qualified for insertion");
  if(/\r(?!\n)/.test(source))fail("Unsupported newline format");
  const eol=source.includes("\r\n")?"\r\n":"\n";
  if(eol==="\r\n"&&/(^|[^\r])\n/.test(source))
    fail("Mixed newlines are not qualified");
  const routePath=["procedures",procedureId,"nodes",route.source];
  if(route.routeSource!=="operator.on"){
    if(!["preconditions.on","postconditions.on"].includes(route.routeSource))
      fail("Unknown Route origin");
    routePath.push(route.routeSource.split(".")[0]);
  }
  routePath.push("on",route.outcome);
  const routeSpan=plainScalar(source,doc.getIn(routePath,true),route.target);
  if(routeSpan.start<=insertAt)fail("Route precedes the Node insertion anchor");
  return {before,procedure,route,insertAt,indent,eol,routeSpan};
}
export function insertNodeOptions(source,procedureId,routeId,predicateSource=null,skillName=null){
  try{
    const c=context(source,procedureId,routeId);
    const statuses=[...new Set(c.procedure.nodes.filter(n=>n.operator==="terminal")
      .map(n=>n.value))];
    const predicates=predicateSet(predicateSource,skillName);
    return Object.freeze({terminalValues:statuses,predicates,
      target:c.route.target,routeId});
  }catch{return null;}
}
function compute(source,procedureId,routeId,spec,predicateSource,skillName){
  const c=context(source,procedureId,routeId);
  if(!spec||typeof spec!=="object")fail("Missing Node specification");
  const {nodeId,operator,value,outcome}=spec;
  if(typeof nodeId!=="string"||!ID.test(nodeId)||nodeId.length>80||
     c.procedure.nodes.some(n=>n.id===nodeId))
    fail("Invalid or duplicate Node ID");
  if(!OPERATORS.has(operator)||typeof value!=="string"||!ID.test(value)||
     value.length>120)fail("Invalid Operator or value");
  if(operator==="terminal"){
    const values=c.procedure.nodes.filter(n=>n.operator==="terminal").map(n=>n.value);
    if(!values.includes(value)||outcome!=="")fail("Unqualified terminal status");
  }else{
    if(typeof outcome!=="string"||!ID.test(outcome)||outcome.length>80)
      fail("An explicit Outcome is required");
    if(operator==="verify"&&!predicateSet(predicateSource,skillName).includes(value))
      fail("Verify Predicate is not in the active Skill Package");
    if(c.procedure.routes.length+1>1600)fail("Route budget exceeded");
  }
  const {indent,eol,insertAt,routeSpan,route,procedure}=c;
  const details=[indent+"  "+operator+": "+value];
  if(operator!=="terminal")
    details.push(indent+"  'on':",indent+"    "+outcome+": "+route.target);
  const insertText=nodeId+":"+eol+details.join(eol)+eol+indent;
  const edits=[
    {start:insertAt,end:insertAt,oldValue:"",newValue:insertText},
    {start:routeSpan.start,end:routeSpan.end,
      oldValue:route.target,newValue:nodeId}
  ];
  let candidateSource=source;
  for(const edit of [...edits].sort((a,b)=>b.start-a.start)){
    if(source.slice(edit.start,edit.end)!==edit.oldValue)
      fail("Source drift at edit location");
    candidateSource=candidateSource.slice(0,edit.start)+edit.newValue+
      candidateSource.slice(edit.end);
  }
  const after=projectWorkspace(candidateSource);
  if(after.state!=="READY")fail("Node insertion cannot reproject: "+
    (after.diagnostics?.[0]?.message??"unknown"));
  const expected=snapshot(c.before);
  const p=expected.find(x=>x.name===procedureId);
  p.nodes.unshift({id:nodeId,operator,value,phases:[],children:[]});
  if(operator!=="terminal")
    p.routes.unshift({id:nodeId+":"+outcome,source:nodeId,outcome,
      target:route.target,routeSource:"operator.on"});
  const oldRoute=p.routes.find(r=>r.id===routeId);
  if(!oldRoute)fail("Original Route disappeared");
  oldRoute.target=nodeId;
  if(JSON.stringify(expected)!==JSON.stringify(snapshot(after)))
    fail("Insertion modified unrelated Procedure, Node or Route");
  const insertLine=source.slice(0,insertAt).split("\n").length;
  const routeLine=source.slice(0,routeSpan.start).split("\n").length;
  const lineStart=source.lastIndexOf("\n",routeSpan.start-1)+1;
  const lineEnd=source.indexOf("\n",routeSpan.end);
  const oldLine=source.slice(lineStart,lineEnd<0?source.length:lineEnd).replace(/\r$/,"");
  const newLine=oldLine.slice(0,routeSpan.start-lineStart)+nodeId+
    oldLine.slice(routeSpan.end-lineStart);
  const diff="@@ -"+insertLine+",0 +"+insertLine+","+(
    details.length+1)+" @@\n+"+([indent+nodeId+":",...details]
      .join("\n+"))+"\n@@ -"+routeLine+",1 +"+routeLine+",1 @@\n-"+
      oldLine+"\n+"+newLine;
  return Object.freeze({
    type:"InsertNode",profile:"d2-route-insert-v1",
    procedureId,routeId,nodeId,operator,value,outcome,
    oldTarget:route.target,baseSource:source,candidateSource,
    sourceSpans:edits.map(x=>Object.freeze(x)),
    diff,summary:"Route "+routeId+" → "+nodeId+" ("+operator+
      (operator==="terminal"?"":", "+outcome+" → "+route.target)+")"
  });
}
export function previewNodeInsert(source,procedureId,routeId,spec,
                                 predicateSource=null,skillName=null){
  return compute(source,procedureId,routeId,spec,predicateSource,skillName);
}
export function applyNodeInsert(source,preview,predicateSource=null,skillName=null){
  if(!preview||preview.type!=="InsertNode"||source!==preview.baseSource)
    fail("Stale or unsupported Node insertion");
  const expected=compute(source,preview.procedureId,preview.routeId,{
    nodeId:preview.nodeId,operator:preview.operator,
    value:preview.value,outcome:preview.outcome
  },predicateSource,skillName);
  const actualKeys=Object.keys(preview),expectedKeys=Object.keys(expected);
  if(actualKeys.length!==expectedKeys.length||
     actualKeys.some(key=>!expectedKeys.includes(key)||
       JSON.stringify(preview[key])!==JSON.stringify(expected[key])))
    fail("Node insertion preview has changed");
  return expected.candidateSource;
}
