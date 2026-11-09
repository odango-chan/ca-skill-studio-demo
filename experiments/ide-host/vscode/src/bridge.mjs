// Shared source authority: host revalidates every webview patch proposal.
// Never trust a candidate Source string supplied by the Webview.
import {projectWorkspace} from "../../../../site/workspace.mjs";
import {previewTargetPatch} from "./route-target.mjs";
import {proposeCanvasRouteConnection,previewCanvasRouteConnection}
  from "../../../../site/route-connect.mjs";

export const MAX_SOURCE_BYTES=1024*1024;
const SOURCE_PATH="assurance/procedure.yaml";
const NAME=/^[A-Za-z_][A-Za-z0-9_.-]*$/;

export function isProcedurePath(uriPath){
  return typeof uriPath==="string"&&/(?:^|\/)assurance\/procedure\.yaml$/i.test(uriPath);
}
export function validateCanvasRouteCreationProposal(source,currentVersion,proposal){
  if(typeof source!=="string"||source.length>MAX_SOURCE_BYTES||
     !Number.isSafeInteger(currentVersion)||currentVersion<1)
    throw new Error("Invalid live document");
  if(!proposal||proposal.type!=="applyRouteCreation"||
     proposal.expectedVersion!==currentVersion||
     proposal.baseSource!==source)
    throw new Error("Source changed; preview the new Route again");
  const {procedureId,sourceId,targetId,sourceHandle,targetHandle,
    outcome,candidateSource}=proposal;
  if(typeof procedureId!=="string"||!NAME.test(procedureId)||
     typeof sourceId!=="string"||!NAME.test(sourceId)||
     typeof targetId!=="string"||!NAME.test(targetId)||
     typeof sourceHandle!=="string"||
     typeof targetHandle!=="string"||
     typeof outcome!=="string"||!/^[A-Z][A-Z0-9_]*$/.test(outcome)||
     typeof candidateSource!=="string"||candidateSource.length>MAX_SOURCE_BYTES)
    throw new Error("Invalid new Route fields");
  const intent=proposeCanvasRouteConnection({
    source,procedureId,sourceId,targetId,sourceHandle,targetHandle
  });
  const preview=previewCanvasRouteConnection(source,intent,outcome);
  if(preview.candidateSource!==candidateSource||
     (proposal.diff!==undefined&&proposal.diff!==preview.diff))
    throw new Error("Webview proposal does not match host-recomputed Route insertion");
  const {start,end}=preview.sourceSpan??{};
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||
     start<0||end!==start||end>source.length)
    throw new Error("Invalid Route insertion span");
  const newText=candidateSource.slice(start,end);
  if(!newText||source.slice(0,start)+newText+source.slice(end)!==candidateSource)
    throw new Error("New Route would modify unrelated Source text");
  return Object.freeze({start,end,newText,candidateSource,diff:preview.diff,
    procedureId,sourceId,targetId,outcome,routeId:sourceId+":"+outcome});
}

export function validateRouteProposal(source,currentVersion,proposal){
  if(typeof source!=="string"||source.length>MAX_SOURCE_BYTES||
     !Number.isSafeInteger(currentVersion)||currentVersion<1)
    throw new Error("Invalid live document");
  if(!proposal||proposal.type!=="applyRoute"||
     proposal.expectedVersion!==currentVersion||
     proposal.baseSource!==source)
    throw new Error("Source changed; preview the edit again");
  const {procedureId,routeId,newTarget,candidateSource}=proposal;
  if(typeof procedureId!=="string"||!NAME.test(procedureId)||
     typeof routeId!=="string"||routeId.length>300||
     typeof newTarget!=="string"||!NAME.test(newTarget)||
     typeof candidateSource!=="string"||candidateSource.length>MAX_SOURCE_BYTES)
    throw new Error("Invalid patch fields");
  const projection=projectWorkspace(source);
  if(projection.state!=="READY")throw new Error("Current Source cannot be projected");
  const procedure=projection.procedures.get(procedureId);
  if(!procedure)throw new Error("Unknown Procedure");
  const preview=previewTargetPatch(source,procedureId,routeId,newTarget);
  if(preview.candidateSource!==candidateSource)
    throw new Error("Webview patch does not match host-recomputed CST change");
  const {start,end}=preview.sourceSpan??{};
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||
     start<0||end<=start||end>source.length)
    throw new Error("Invalid source span");
  const original=source.slice(start,end);
  if(!original||source.slice(0,start)+newTarget+source.slice(end)!==candidateSource)
    throw new Error("Patch would modify unrelated text");
  return Object.freeze({start,end,newTarget,oldTarget:original,diff:preview.diff,
    candidateSource,procedureId,routeId});
}
