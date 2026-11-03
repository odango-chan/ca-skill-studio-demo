import {routeEditTargets,previewRouteTargetPatch} from "./patch.mjs";
import {createdRouteTargets,previewCreatedRoutePatch} from "./extended-attributes.mjs";

// A graphic gesture only proposes one existing Route target edit.
// It never creates a Route, updates layout data in YAML, or skips the Diff dialog.
export function visualRouteTargets({source,procedure,procedureId,routeId,packageName}){
  if(typeof source!=="string"||!procedure||!routeId)return [];
  const ensure=routeEditTargets(procedure,routeId);
  if(ensure.length)return ensure;
  if(packageName!=="establish-pdu-session")return [];
  return createdRouteTargets(source,packageName,procedureId,routeId);
}
export function previewVisualRouteEdit(context,target){
  const choices=visualRouteTargets(context);
  const route=context.procedure?.routes.find(r=>r.id===context.routeId);
  if(!route||!choices.includes(target)||target===route.target)
    throw new Error("Route 或目标不存在、无变化，或当前编辑资格不足");
  if(routeEditTargets(context.procedure,context.routeId).length)
    return previewRouteTargetPatch(context.source,context.routeId,target);
  if(context.packageName==="establish-pdu-session")
    return previewCreatedRoutePatch(context.source,context.packageName,
      context.procedureId,context.routeId,target);
  throw new Error("未授权的图形 Route 修改");
}
export function dropTargetAllowed(choices,currentTarget,dropTarget){
  return typeof dropTarget==="string"&&dropTarget!==currentTarget&&
    choices.includes(dropTarget);
}
