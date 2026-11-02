// UI-only projections. Never infer write capability from view information.
// Source AST and route entries remain the sole semantic inputs.
export function procedureItems(workspace, filter="") {
  if (!workspace || workspace.state!=="READY") return [];
  const query=String(filter).trim().toLowerCase();
  return [...workspace.procedures.values()]
    .map(p=>({
      id:p.name,title:p.name,kind:p.name===workspace.entry?"root":"child",
      nodes:p.nodes.length,routes:p.routes.length,children:p.children?.length??0,
      line:p.line
    }))
    .filter(p=>!query || (p.title+" "+p.kind).toLowerCase().includes(query));
}
export function nodeItems(procedure, filter="") {
  if (!procedure) return [];
  const query=String(filter).trim().toLowerCase();
  return procedure.nodes.map((n,index)=>({
    id:n.id,operator:n.operator,identifier:n.value,position:index+1,
    phaseCount:n.phases?.length??0,childCount:n.children?.length??0,
    isStart:n.id===procedure.start,line:n.line
  })).filter(n=>!query ||
    (n.id+" "+n.operator+" "+n.identifier).toLowerCase().includes(query));
}
export function groupNodeRoutes(procedure, nodeId, direction="outgoing") {
  if (!procedure) return [];
  const match=direction==="incoming" ? r=>r.target===nodeId : r=>r.source===nodeId;
  const groups=new Map();
  for(const route of procedure.routes.filter(match)){
    const source=route.routeSource||"operator.on";
    const key=direction==="incoming" ? route.source+":"+source : source;
    if(!groups.has(key))groups.set(key,{
      key,title:direction==="incoming" ? route.source+" · "+source : source,
      entries:[]
    });
    groups.get(key).entries.push(route);
  }
  return [...groups.values()];
}
export function nodeDetails(procedure, nodeId) {
  const node=procedure?.nodes.find(n=>n.id===nodeId);
  if(!node)return null;
  const conditions=(node.phases||[]).map(phase=>({
    name:phase.name,steps:[...(phase.steps||[])],line:phase.line,
    routeCount:phase.routeCount??0
  }));
  const outgoing=groupNodeRoutes(procedure,nodeId,"outgoing");
  const incoming=groupNodeRoutes(procedure,nodeId,"incoming");
  return {
    node,conditions,outgoing,incoming,
    routeCount:outgoing.reduce((sum,g)=>sum+g.entries.length,0),
    incomingCount:incoming.reduce((sum,g)=>sum+g.entries.length,0),
    childRefs:node.children||[],start:node.id===procedure.start,
    terminal:node.operator==="terminal"
  };
}
export function routeDetails(procedure,routeId) {
  const route=procedure?.routes.find(r=>r.id===routeId);
  if(!route)return null;
  return {
    ...route,
    from:procedure.nodes.find(n=>n.id===route.source),
    to:procedure.nodes.find(n=>n.id===route.target)
  };
}
export function inspectorTabItems(selection) {
  return selection?.kind==="node"
    ? [{id:"overview",name:"概览"},{id:"conditions",name:"条件"},{id:"routes",name:"路由"}]
    : selection?.kind==="route"
    ? [{id:"overview",name:"概览"},{id:"routes",name:"路由"}]
    : [{id:"overview",name:"概览"}];
}
export function preferredTab(selection) {
  return selection?.kind==="route" ? "routes" : "overview";
}
