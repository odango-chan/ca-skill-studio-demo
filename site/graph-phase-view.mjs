// D1-A1: read-only semantics for the current Procedure canvas and legend.
// Phase Step kinds are NOT additional business Nodes. The YAML projection
// remains the only source of truth for every count and Route origin.
const KIND_ORDER=["call","tool","script","verify","predicate","procedure","reconcile","terminal"];
const KINDS=Object.freeze({
  call:"调用能力",tool:"工具操作",script:"本地脚本",
  verify:"验证",predicate:"谓词",procedure:"子流程",
  reconcile:"对账",terminal:"结束"
});
const PHASES=Object.freeze([
  {name:"preconditions",tag:"PRE",label:"准备阶段"},
  {name:"postconditions",tag:"POST",label:"确认阶段"}
]);
const ORIGINS=Object.freeze([
  {source:"preconditions.on",kind:"preconditions",tag:"PRE",label:"准备阶段 Route"},
  {source:"operator.on",kind:"operator",tag:"OP",label:"主操作 Route"},
  {source:"postconditions.on",kind:"postconditions",tag:"POST",label:"确认阶段 Route"}
]);
function counts(items){
  const result=new Map();
  for(const value of items)result.set(value,(result.get(value)||0)+1);
  return KIND_ORDER.filter(kind=>result.has(kind))
    .map(kind=>({kind,label:KINDS[kind],count:result.get(kind)}));
}
export function routeOrigin(source){
  return ORIGINS.find(item=>item.source===source)||
    {source:String(source??"unknown"),kind:"unknown",tag:"?",label:"未识别 Route 来源"};
}
export function nodePhaseChips(node){
  const phases=Array.isArray(node?.phases)?node.phases:[];
  return PHASES.flatMap(phase=>{
    const found=phases.find(item=>item.name===phase.name);
    if(!found)return [];
    const steps=Array.isArray(found.steps)?found.steps:[];
    const kinds=counts(steps.map(step=>step.operator));
    const routeCount=Number.isInteger(found.routeCount)?found.routeCount:0;
    return [{
      kind:phase.name,tag:phase.tag,label:phase.label,
      stepCount:steps.length,routeCount,kinds,
      title:phase.label+" · "+steps.length+" steps"+
        (kinds.length?"（"+kinds.map(item=>item.kind.toUpperCase()+" ×"+item.count).join("、")+"）":"")+
        (routeCount?" · "+routeCount+" Route":"")
    }];
  });
}
export function graphLegendSummary(procedure,visibleNodes=null,visibleRoutes=null){
  const nodes=Array.isArray(visibleNodes)?visibleNodes:
    Array.isArray(procedure?.nodes)?procedure.nodes:[];
  const ids=new Set(nodes.map(node=>node.id));
  const routes=Array.isArray(visibleRoutes)?visibleRoutes:
    (procedure?.routes||[]).filter(route=>ids.has(route.source)&&ids.has(route.target));
  const steps=nodes.flatMap(node=>
    (node.phases||[]).flatMap(phase=>phase.steps||[]));
  const origins=ORIGINS.map(origin=>({
    ...origin,count:routes.filter(route=>route.routeSource===origin.source).length
  })).filter(origin=>origin.count>0);
  const unknownOrigins=routes.filter(route=>!ORIGINS.some(origin=>origin.source===route.routeSource));
  if(unknownOrigins.length)origins.push({
    ...routeOrigin("unknown"),count:unknownOrigins.length
  });
  return {
    nodeCount:nodes.length,stepCount:steps.length,routeCount:routes.length,
    nodeKinds:counts(nodes.map(node=>node.operator)),
    stepKinds:counts(steps.map(step=>step.operator)),
    origins
  };
}
