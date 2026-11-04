import {parseDocument,isMap,isScalar} from "yaml";
import {projectWorkspace} from "./workspace.mjs";
import {routeProjectionSignature} from "./route-create.mjs";

// D4-A4a: only retarget an EXISTING pre/postcondition failure Route.
// Candidates must be observed on the same Phase + Outcome inside the same
// Procedure. This is editor-tier source authoring, NOT a Runtime branch proof.
const ID=/^[A-Za-z_][A-Za-z0-9_.-]*$/;
const PHASE_OUTCOMES=Object.freeze({
  preconditions:new Set(["FAILED","UNRESOLVED"]),
  postconditions:new Set(["FAIL","UNKNOWN"])
});
const fail=message=>{throw Error(message);};
const freeze=Object.freeze;

function reachable(proc){
  const edges=new Map(proc.nodes.map(n=>[n.id,[]]));
  for(const r of proc.routes)edges.get(r.source)?.push(r.target);
  const visited=new Set([proc.start]),queue=[proc.start];
  for(let i=0;i<queue.length;i++)
    for(const next of edges.get(queue[i])??[])
      if(!visited.has(next)){visited.add(next);queue.push(next);}
  return [...visited].sort().join("|");
}

function sourceContext(source,procedureId,routeId){
  if(typeof source!=="string"||source.length>1024*1024||
     !ID.test(procedureId??"")||typeof routeId!=="string"||
     routeId.length>300)fail("Invalid Phase Route identity");
  if(/\r(?!\n)/.test(source)||
     (source.includes("\r\n")&&/(^|[^\r])\n/.test(source)))
    fail("Mixed/unsupported Source newlines");
  const before=projectWorkspace(source);
  const proc=before.procedures.get(procedureId);
  const route=proc?.routes.find(x=>x.id===routeId);
  const node=proc?.nodes.find(x=>x.id===route?.source);
  if(before.state!=="READY"||!route||!node||node.operator==="terminal"||
     !route.patchable||!route.sourceSpan)fail("Phase Route is not projectable");
  const phaseName=route.routeSource.replace(/\.on$/,"");
  if(!PHASE_OUTCOMES[phaseName]?.has(route.outcome)||
    route.routeSource!==phaseName+".on"||
    !node.phases.some(p=>p.name===phaseName))
    fail("Only authored Phase failure/unknown routes qualify");
  const doc=parseDocument(source,{version:"1.2",schema:"core",
    uniqueKeys:true,stringKeys:true,strict:true,keepSourceTokens:true,
    logLevel:"silent"});
  if(doc.errors.length)fail("YAML Source is not unambiguous");
  const map=doc.getIn(["procedures",procedureId,"nodes",node.id,
    phaseName],true);
  if(!isMap(map))fail("Phase source map not found");
  const on=map.items.find(p=>p.key?.value==="on");
  if(!on||!isScalar(on.key)||!Array.isArray(on.key.range)||
     source.slice(on.key.range[0],on.key.range[1])!=="'on'"||
     !isMap(on.value)||on.value.items.length===0)
    fail("Phase must own a literal quoted 'on' mapping");
  const keyRows=[];
  for(const pair of on.value.items){
    const key=pair.key,val=pair.value;
    if(!isScalar(key)||!isScalar(val)||typeof key.value!=="string"||
       typeof val.value!=="string"||!Array.isArray(key.range)||
       !Array.isArray(val.range)||key.anchor||key.tag||val.anchor||val.tag||
       !/^[A-Z][A-Z0-9_]*$/.test(key.value)||!ID.test(val.value)||
       source.slice(key.range[0],key.range[1])!==key.value||
       source.slice(val.range[0],val.range[1])!==val.value)
      fail("Quoted, aliased or complex Phase Route is Source-only");
    const start=source.lastIndexOf("\n",Math.max(0,key.range[0]-1))+1;
    const endOfLine=source.indexOf("\n",val.range[1]);
    if(endOfLine<0)fail("Phase Route needs a newline");
    const raw=source.slice(start,endOfLine+1);
    const line=/^( {8,28})([A-Z][A-Z0-9_]*): ([A-Za-z_][A-Za-z0-9_.-]*)\r?\n$/.exec(raw);
    if(!line||line[2]!==key.value||line[3]!==val.value||
       key.range[0]!==start+line[1].length||
       val.range[0]!==key.range[1]+2)
      fail("Phase Route is not a standalone plain Source row");
    keyRows.push({key:key.value,val:val.value,start,raw,
      keyStart:key.range[0],valStart:val.range[0],valEnd:val.range[1],
      indent:line[1],line:source.slice(0,start).split("\n").length});
  }
  if(keyRows.some((x,i)=>i>0&&
       keyRows[i-1].start+keyRows[i-1].raw.length!==x.start))
    fail("Phase Route map has a blank/comment gap between rows");
  if(new Set(keyRows.map(x=>x.key)).size!==keyRows.length||
     keyRows.some(x=>x.indent!==keyRows[0].indent))
    fail("Ambiguous or mixed Phase Route rows");
  const row=keyRows.find(x=>x.key===route.outcome&&x.val===route.target);
  if(!row||route.sourceSpan.start!==row.valStart||
     route.sourceSpan.end!==row.valEnd)
    fail("Phase Route source span or projection identity mismatch");
  const preceding=source.slice(0,row.start).split(/\r?\n/).at(-2)??"";
  if(preceding.trimStart().startsWith("#"))
    fail("Attached Route comment requires Source-only edit");
  const targetNodes=new Set(proc.nodes.map(x=>x.id));
  const options=[...new Set(proc.routes.filter(x=>
    x.routeSource===route.routeSource&&x.outcome===route.outcome&&
    x.source!==node.id&&x.target!==route.target&&x.target!==node.id&&
    targetNodes.has(x.target)).map(x=>x.target))].sort();
  return {source,before,proc,node,route,row,phaseName,options};
}

function compute(source,procedureId,routeId,newTarget){
  const ctx=sourceContext(source,procedureId,routeId);
  if(!ctx.options.includes(newTarget))
    fail("Target is not an observed same-Phase/same-Outcome choice");
  const {row,route,proc}=ctx;
  const candidateSource=source.slice(0,row.valStart)+newTarget+
    source.slice(row.valEnd);
  const after=projectWorkspace(candidateSource);
  if(after.state!=="READY")fail("Phase Route candidate cannot reproject");
  const expected=routeProjectionSignature(ctx.before);
  const matched=expected.find(p=>p.name===procedureId)?.routes
    .find(r=>r.id===routeId);
  if(!matched||matched.routeSource!==route.routeSource||
     matched.target!==route.target)
    fail("Target Route is no longer identical");
  matched.target=newTarget;
  if(JSON.stringify(expected)!==JSON.stringify(routeProjectionSignature(after)))
    fail("Phase Route edit changed an unrelated Procedure/Node/Route");
  const next=after.procedures.get(procedureId);
  if(reachable(proc)!==reachable(next))
    fail("Phase Route change would alter the reachable Node set");
  const oldLine=row.raw.trimEnd(),newLine=oldLine.slice(0,row.valStart-row.start)+
    newTarget+oldLine.slice(row.valEnd-row.start);
  return freeze({
    type:"SetPhaseRouteTarget",profile:"d4-a4a-observed-phase-failure-v1",
    procedureId,nodeId:ctx.node.id,routeId,phaseName:ctx.phaseName,
    routeSource:route.routeSource,outcome:route.outcome,
    oldTarget:route.target,newTarget,baseSource:source,candidateSource,
    sourceSpan:freeze({start:row.valStart,end:row.valEnd}),
    diff:"@@ -"+row.line+",1 +"+row.line+",1 @@\n-"+
      oldLine+"\n+"+newLine,
    summary:"修改 "+ctx.node.id+" · "+route.routeSource+" · "+
      route.outcome+" → "+newTarget+
      "；可能改变失败收尾与资源清理路径；Runtime/5GC 未验证"
  });
}

export function phaseRouteTargetOptions(source,procedureId,nodeId){
  try{
    if(!ID.test(nodeId??""))return freeze([]);
    const before=projectWorkspace(source);
    const proc=before.procedures.get(procedureId);
    if(before.state!=="READY"||!proc?.nodes.some(n=>n.id===nodeId))
      return freeze([]);
    const results=[];
    for(const route of proc.routes.filter(r=>r.source===nodeId&&
      ["preconditions.on","postconditions.on"].includes(r.routeSource))){
      try{
        const ctx=sourceContext(source,procedureId,route.id);
        const qualified=ctx.options.filter(target=>{
          try{compute(source,procedureId,route.id,target);return true;}
          catch{return false;}
        });
        if(qualified.length)results.push(freeze({
          routeId:route.id,phaseName:ctx.phaseName,
          routeSource:route.routeSource,outcome:route.outcome,
          target:route.target,targets:freeze(qualified),
          line:ctx.row.line
        }));
      }catch{/* ambiguous Source stays Source-only */}
    }
    return freeze(results);
  }catch{return freeze([]);}
}
export function previewPhaseRouteTarget(source,procedureId,routeId,newTarget){
  return compute(source,procedureId,routeId,newTarget);
}
export function applyPhaseRouteTarget(source,preview){
  if(!preview||preview.type!=="SetPhaseRouteTarget"||
    source!==preview.baseSource)
    fail("Stale or unsupported Phase Route Patch");
  const expected=compute(source,preview.procedureId,preview.routeId,
    preview.newTarget);
  const keys=Object.keys(expected);
  if(Object.keys(preview).length!==keys.length||
     keys.some(key=>JSON.stringify(preview[key])!==JSON.stringify(expected[key])))
    fail("Phase Route Preview was changed or expired");
  return expected.candidateSource;
}
