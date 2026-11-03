import {parseDocument,isMap,isScalar} from "yaml";
import {projectWorkspace} from "./workspace.mjs";

// D3-A1 (bounded): append one new Outcome to an existing operator.on map.
// Never create an on-map, guess an Outcome name, mutate a graph model, or
// treat the current file's observed Outcomes as Runtime certification.
const ID=/^[A-Za-z_][A-Za-z0-9_.-]*$/;
const KEY=/^[A-Z][A-Z0-9_]*$/;
const reject=reason=>{throw new Error(reason);};

function signature(projected){
  return [...projected.procedures.values()].map(proc=>({
    name:proc.name,start:proc.start,
    nodes:proc.nodes.map(n=>({
      id:n.id,operator:n.operator,value:n.value,
      phases:n.phases.map(p=>({name:p.name,steps:p.steps.map(s=>({
        index:s.index,name:s.name,operator:s.operator,value:s.value
      }))})),
      children:n.children.map(c=>({procedure:c.procedure,via:c.via,line:undefined}))
    })),
    routes:proc.routes.map(r=>({
      id:r.id,source:r.source,target:r.target,
      routeSource:r.routeSource,outcome:r.outcome
    }))
  }));
}
function sourceContext(source,procedureId,nodeId){
  if(typeof source!=="string"||source.length>1024*1024||
    !ID.test(procedureId||"")||!ID.test(nodeId||""))reject("Invalid edit identity");
  const before=projectWorkspace(source);
  if(before.state!=="READY")reject("Procedure Source is not safely projected");
  const procedure=before.procedures.get(procedureId);
  const node=procedure?.nodes.find(n=>n.id===nodeId);
  if(!node||node.operator==="terminal"||procedure.routes.length>=1600)
    reject("Node is not eligible for adding an Outcome");
  const doc=parseDocument(source,{
    version:"1.2",schema:"core",strict:true,uniqueKeys:true,stringKeys:true,
    keepSourceTokens:true,logLevel:"silent"
  });
  if(doc.errors.length)reject("YAML cannot be safely patched");
  const nodeMap=doc.getIn(["procedures",procedureId,"nodes",nodeId],true);
  if(!isMap(nodeMap))reject("Node mapping is not available");
  const onPair=nodeMap.items.find(pair=>isScalar(pair.key)&&pair.key.value==="on");
  if(!onPair||!isScalar(onPair.key)||!Array.isArray(onPair.key.range)||
    source.slice(onPair.key.range[0],onPair.key.range[1])!=="'on'")
    reject("Only an existing explicit quoted 'on' map is eligible");
  const routeMap=onPair.value;
  if(!isMap(routeMap)||!routeMap.items.length)
    reject("The on map must already have at least one Route");
  const routeRows=[];
  for(const pair of routeMap.items){
    if(!isScalar(pair.key)||!isScalar(pair.value)||
      typeof pair.key.value!=="string"||typeof pair.value.value!=="string"||
      !Array.isArray(pair.key.range)||!Array.isArray(pair.value.range)||
      !KEY.test(pair.key.value)||
      source.slice(pair.key.range[0],pair.key.range[1])!==pair.key.value||
      source.slice(pair.value.range[0],pair.value.range[1])!==pair.value.value)
      reject("Quoted/complex Route entry is not eligible");
    const at=pair.key.range[0],start=source.lastIndexOf("\n",at-1)+1;
    const indent=source.slice(start,at);
    if(!/^ {6,28}$/.test(indent)||indent.includes("\r"))
      reject("Unsupported Route indentation");
    routeRows.push({outcome:pair.key.value,target:pair.value.value,
      start,indent,keyStart:at,valueEnd:pair.value.range[1]});
  }
  if(new Set(routeRows.map(r=>r.outcome)).size!==routeRows.length)
    reject("Duplicate existing Outcomes");
  if(routeRows.some(r=>r.indent!==routeRows[0].indent))
    reject("Mixed Route indentation");
  // Append after the final physical route line, preserving its inline
  // comment and all unrelated source bytes. Never touch a preceding comment.
  const last=routeRows.at(-1);
  const endOfLine=source.indexOf("\n",last.valueEnd);
  if(endOfLine<0)reject("Route map must end with a newline");
  const suffix=source.slice(last.valueEnd,endOfLine).replace(/\r$/,"");
  if(!/^[ \t]*(?:#.*)?$/.test(suffix))
    reject("Route value has a complex suffix");
  const eol=source.includes("\r\n")?"\r\n":"\n";
  if(eol==="\r\n"&&/(^|[^\r])\n/.test(source))
    reject("Mixed line endings");
  if(/\r(?!\n)/.test(source))reject("Unsupported line endings");
  const insertAt=endOfLine+1;
  // Candidate outcomes only from current *observed* source, for identical
  // operation identity; generic verify/predicate verdicts can be shared
  // across nodes of that same operator kind. This is an authoring hint.
  const known=new Set();
  for(const proc of before.procedures.values())
    for(const other of proc.nodes){
      if(other.operator!==node.operator)continue;
      if(other.value!==node.value&&
        !["verify","predicate"].includes(node.operator))continue;
      for(const route of proc.routes)
        if(route.source===other.id&&route.routeSource==="operator.on"&&
          KEY.test(route.outcome))known.add(route.outcome);
    }
  for(const existing of routeRows)known.delete(existing.outcome);
  return {before,procedure,node,routeRows,known:[...known].sort(),
    indent:routeRows[0].indent,eol,insertAt};
}
export function addRouteOutcomeOptions(source,procedureId,nodeId){
  try{
    const ctx=sourceContext(source,procedureId,nodeId);
    if(!ctx.known.length)return null;
    return Object.freeze({
      procedureId,nodeId,routeSource:"operator.on",
      outcomes:Object.freeze(ctx.known),
      targets:Object.freeze(ctx.procedure.nodes.map(n=>n.id)),
      warning:"Outcome suggestions are observed editor hints, not Runtime qualification"
    });
  }catch{return null;}
}
function compute(source,procedureId,nodeId,outcome,target){
  const ctx=sourceContext(source,procedureId,nodeId);
  if(!ctx.known.includes(outcome)||!KEY.test(outcome)||
    !ctx.procedure.nodes.some(n=>n.id===target))
    reject("Outcome/Target is outside the explicit qualified choices");
  const newLine=ctx.indent+outcome+": "+target+ctx.eol;
  const candidateSource=source.slice(0,ctx.insertAt)+newLine+
    source.slice(ctx.insertAt);
  const after=projectWorkspace(candidateSource);
  if(after.state!=="READY")
    reject("New Outcome does not reproject: "+(after.diagnostics?.[0]?.message??"unknown"));
  const expected=signature(ctx.before);
  const item=expected.find(p=>p.name===procedureId);
  const newRoute={id:nodeId+":"+outcome,source:nodeId,target,
    outcome,routeSource:"operator.on"};
  const lastIndex=item.routes.findLastIndex(r=>
    r.source===nodeId&&r.routeSource==="operator.on");
  if(lastIndex<0)reject("Missing existing operator Route");
  item.routes.splice(lastIndex+1,0,newRoute);
  const actual=signature(after);
  if(JSON.stringify(expected)!==JSON.stringify(actual)){
    const beforeString=JSON.stringify(expected),afterString=JSON.stringify(actual);
    let at=0;while(at<Math.min(beforeString.length,afterString.length)&&
      beforeString[at]===afterString[at])at++;
    reject("New Outcome changed unrelated Procedure, Node, Phase or Route at "+
      at+" expected="+beforeString.slice(at,at+130)+
      " actual="+afterString.slice(at,at+130));
  }
  const line=source.slice(0,ctx.insertAt).split("\n").length;
  const preview={
    type:"AddRouteOutcome",profile:"d3-a1-observed-operator-on-v1",
    procedureId,nodeId,routeSource:"operator.on",outcome,target,
    baseSource:source,candidateSource,
    sourceSpan:{start:ctx.insertAt,end:ctx.insertAt},
    diff:"@@ -"+line+",0 +"+line+",1 @@\n+"+newLine.trimEnd(),
    summary:"新增 "+nodeId+" · operator.on · "+outcome+" → "+target+
      "（仅编辑期来源提示，非 Runtime 验证）"
  };
  return Object.freeze(preview);
}
export function previewAddRouteOutcome(source,procedureId,nodeId,outcome,target){
  return compute(source,procedureId,nodeId,outcome,target);
}
export function applyAddRouteOutcome(source,preview){
  if(!preview||preview.type!=="AddRouteOutcome"||
    source!==preview.baseSource)reject("Stale/unsupported Route preview");
  const again=compute(source,preview.procedureId,preview.nodeId,
    preview.outcome,preview.target);
  const a=Object.keys(again),b=Object.keys(preview);
  if(a.length!==b.length||a.some(k=>!b.includes(k)||
    JSON.stringify(preview[k])!==JSON.stringify(again[k])))
    reject("Route preview was modified");
  return again.candidateSource;
}
