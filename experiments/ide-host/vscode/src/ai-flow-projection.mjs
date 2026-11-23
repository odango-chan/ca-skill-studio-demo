import { analyzeCurrentSource } from "../../../../language/core/source.ts";

/**
 * Authoritative editor-time graph projection for AI review. Both snapshots
 * run through the SAME CA-SL v1alpha5 analyzer used by Procedure Preview.
 * Neither ModelProposal nor Patch Plan may supply graph nodes or edges.
 */
export function projectAiReviewProcedure(snapshot, source) {
  if (!snapshot || snapshot.completeness !== "complete" ||
      !Array.isArray(snapshot.documents) || typeof source !== "string") {
    throw new Error("A complete Package snapshot and exact Procedure bytes are required.");
  }
  const original = snapshot.documents.find(doc => doc.relativePath === "assurance/procedure.yaml");
  if (!original || !Number.isSafeInteger(original.version) ||
      source.length > 1024 * 1024) {
    throw new Error("The current v1alpha5 Procedure snapshot is unavailable or exceeds the graph limit.");
  }
  const overlay = new Map(snapshot.documents.map(doc => [
    doc.relativePath, doc.relativePath === "assurance/procedure.yaml"
      ? { ...doc, text: source }
      : doc
  ]));
  const projected = analyzeCurrentSource(overlay, snapshot.packageName);
  if (projected.procedure.state !== "READY" ||
      projected.procedure.procedures.length !== 1) {
    throw new Error("Source-backed v1alpha5 graph projection is unavailable; use YAML Diff.");
  }
  const procedure = projected.procedure.procedures[0];
  if (procedure.nodes.length > 300 || procedure.routes.length > 1600 ||
      !procedure.nodes.length) {
    throw new Error("Procedure graph exceeds the read-only review limits.");
  }
  return procedure;
}

const stages = node => JSON.stringify((node.stages ?? []).map(stage=>({
  name:stage.name, count:stage.count,target:stage.target ?? "",
  routeOutcomes:stage.routeOutcomes,
  calls:stage.calls?.map(c=>({predicate:c.predicate,arguments:c.arguments})) ?? [],
  arguments:stage.arguments?.map(a=>({name:a.name,value:a.value})) ?? []
})));
const signature = node=>JSON.stringify({
  stages:stages(node),
  wait:node.wait ? {
    event:node.wait.event,timeout:node.wait.timeout,
    timeoutTarget:node.wait.timeoutTarget,responseAfter:node.wait.responseAfter
  } : null
});
const routeIdentity=route=>JSON.stringify([
  route.source,route.routeSource,route.outcome
]);
function checkProcedure(procedure) {
  if(!procedure||typeof procedure.start!=="string"||
      !Array.isArray(procedure.nodes)||!Array.isArray(procedure.routes)) {
    throw new Error("Incomplete source-backed flow projection.");
  }
  const ids=new Set();
  for(const node of procedure.nodes) {
    if(typeof node.id!=="string"||ids.has(node.id))throw new Error("Duplicated source Node identity");
    ids.add(node.id);
  }
  if(!ids.has(procedure.start))throw new Error("Source start Node missing");
  const routeIds=new Set();
  for(const route of procedure.routes) {
    const key=routeIdentity(route);
    if(routeIds.has(key)||!ids.has(route.source)||!ids.has(route.target))
      throw new Error("Unresolved or duplicated Route identity");
    routeIds.add(key);
  }
}

/**
 * Compute statuses from TWO real projected source snapshots, not from the
 * untrusted semantic proposal. Patch Plan group associations are hints for
 * review focus only and never permission for edits.
 */
export function compareAiReviewProcedures(before,after,flowGroups=[]) {
  checkProcedure(before);checkProcedure(after);
  const baseNodes=new Map(before.nodes.map(node=>[node.id,node]));
  const nextNodes=new Map(after.nodes.map(node=>[node.id,node]));
  const baseRoutes=new Map(before.routes.map(route=>[routeIdentity(route),route]));
  const nextRoutes=new Map(after.routes.map(route=>[routeIdentity(route),route]));
  const groups=Array.isArray(flowGroups)?flowGroups:[];
  const operationHints=groups.flatMap(group=>(group.operations??[]).map(op=>({groupId:group.id,op})));
  const groupFor=(nodeId,stage="",outcome="")=>{
    const ids=[];
    for(const {groupId,op} of operationHints) {
      if(op.nodeId!==nodeId)continue;
      if(stage && op.stage && op.stage!==stage)continue;
      if(outcome && op.outcome && op.outcome!==outcome)continue;
      if(!ids.includes(groupId))ids.push(groupId);
    }
    return ids;
  };
  const allNodeIds=[...new Set([...baseNodes.keys(),...nextNodes.keys()])];
  const nodes=allNodeIds.map(id=>{
    const a=baseNodes.get(id),b=nextNodes.get(id);
    let status=!a?"added":!b?"removed":
      signature(a)!==signature(b)?"changed":"unchanged";
    if(status==="unchanged" && before.start!==after.start &&
        (before.start===id||after.start===id))status="changed";
    return {id,status,baseLine:a?.line??null,candidateLine:b?.line??null,
      groupIds: status==="unchanged"?[]:groupFor(id)};
  });
  const allRouteIds=[...new Set([...baseRoutes.keys(),...nextRoutes.keys()])];
  const routes=allRouteIds.map(id=>{
    const a=baseRoutes.get(id),b=nextRoutes.get(id);
    const actual=a??b;
    const status=!a?"added":!b?"removed":a.target!==b.target?"retargeted":"unchanged";
    return {id,source:actual.source,routeSource:actual.routeSource,outcome:actual.outcome,
      baseTarget:a?.target??null,candidateTarget:b?.target??null,
      baseLine:a?.line??null,candidateLine:b?.line??null,
      status,groupIds:status==="unchanged"?[]:groupFor(actual.source,actual.routeSource,actual.outcome)};
  });
  return Object.freeze({
    nodes, routes,
    counts:Object.freeze({
      baseNodes:before.nodes.filter(x=>!x.viewOnly).length,
      candidateNodes:after.nodes.filter(x=>!x.viewOnly).length,
      baseRoutes:before.routes.length,candidateRoutes:after.routes.length,
      addedNodes:nodes.filter(x=>x.status==="added").length,
      modifiedNodes:nodes.filter(x=>x.status==="changed").length,
      changedRoutes:routes.filter(x=>x.status!=="unchanged").length,
    })
  });
}

export function buildAiFlowGraphReview({snapshot,baseSource,candidateSource,flowGroups=[]}={}) {
  if(typeof baseSource!=="string"||typeof candidateSource!=="string")
    throw new Error("Exact Host source bytes are required for flow comparison.");
  const before=projectAiReviewProcedure(snapshot,baseSource);
  const after=projectAiReviewProcedure(snapshot,candidateSource);
  const change=compareAiReviewProcedures(before,after,flowGroups);
  return Object.freeze({
    available:true, languageTarget:"connectionagent.io/v1alpha5",
    before,after,change,
    qualified:false,
    graphAuthority:"Studio v1alpha5 Source Projection (read-only)"
  });
}
