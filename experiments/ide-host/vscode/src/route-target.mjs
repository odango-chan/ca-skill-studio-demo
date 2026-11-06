// EXPERIMENTAL host-neutral, source-authoritative Route target patch.
// Reuses current Studio projection; does not claim Runtime/3GPP qualification.
// Only a plain-scalar existing operator.on Route; never serialize YAML.
import {projectWorkspace} from "../../../../site/workspace.mjs";
const NAME=/^[A-Za-z_][A-Za-z0-9_.-]*$/;
function fail(message){throw new Error(message);}
function project(source){
  if(typeof source!=="string"||source.length>1024*1024)
    fail("Source must be bounded text");
  const result=projectWorkspace(source);
  if(result.state!=="READY")fail("Source cannot be safely projected");
  return result;
}
export function routeTargetChoices(procedure,routeId){
  const route=procedure?.routes.find(r=>r.id===routeId);
  if(!route||route.routeSource!=="operator.on"||
     !route.patchable||!route.sourceSpan)
    return [];
  return procedure.nodes.map(n=>n.id).filter(id=>id!==route.target);
}
export function previewTargetPatch(source,procedureId,routeId,newTarget){
  if(!NAME.test(procedureId??"")||typeof routeId!=="string"||
     !NAME.test(newTarget??""))fail("Invalid route selector or new target");
  const before=project(source);
  const proc=before.procedures.get(procedureId);
  const route=proc?.routes.find(r=>r.id===routeId);
  if(!route||!routeTargetChoices(proc,routeId).includes(newTarget))
    fail("No source-qualified operator.on Route target candidate");
  const {start,end}=route.sourceSpan??{};
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||
     start<0||end<=start||end>source.length||
     source.slice(start,end)!==route.target)
    fail("CST scalar range is stale, ambiguous or quoted");
  const candidateSource=source.slice(0,start)+newTarget+source.slice(end);
  const after=project(candidateSource);
  if(before.procedures.size!==after.procedures.size)
    fail("Procedure count changed");
  for(const [name,oldProc] of before.procedures){
    const nextProc=after.procedures.get(name);
    if(!nextProc||nextProc.start!==oldProc.start||
       JSON.stringify(nextProc.nodes)!==JSON.stringify(oldProc.nodes)||
       nextProc.routes.length!==oldProc.routes.length)
      fail("Unrelated Procedure/Node changed");
    for(let i=0;i<oldProc.routes.length;i++){
      const old=oldProc.routes[i],next=nextProc.routes[i];
      if(!next||old.id!==next.id||old.source!==next.source||
         old.routeSource!==next.routeSource||old.outcome!==next.outcome||
         old.line!==next.line||
         next.target!==(name===procedureId&&old.id===routeId?newTarget:old.target))
        fail("Patch changed another Route or identity");
    }
  }
  const lineStart=source.lastIndexOf("\n",Math.max(0,start-1))+1;
  const lineEnd=source.indexOf("\n",end);
  const oldLine=source.slice(lineStart,lineEnd<0?source.length:lineEnd).replace(/\r$/,"");
  const newLine=oldLine.slice(0,start-lineStart)+newTarget+oldLine.slice(end-lineStart);
  const diff="@@ -"+route.line+",1 +"+route.line+",1 @@\n-"+oldLine+"\n+"+newLine;
  return Object.freeze({procedureId,routeId,newTarget,oldTarget:route.target,
    sourceSpan:{start,end},baseSource:source,candidateSource,diff,
    profile:"ide-spike-operator-target-only-v1"});
}
