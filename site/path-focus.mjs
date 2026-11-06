// Root-only, read-only route visibility. Never changes Source or Runtime semantics.
// A happy path is the union of explicit success-outcome routes that can reach
// an explicitly successful terminal, not a name-based or arbitrary shortest path.
const GOOD=new Set(["PASS","SUCCEEDED","SUCCESS","COMMITTED"]);
const BAD=new Set(["FAIL","FAILED","ERROR","NOT_COMMITTED","DENIED"]);
const UNCERTAIN=new Set(["UNKNOWN","UNRESOLVED","OUTCOME_UNKNOWN","TIMEOUT","TIMED_OUT"]);
// SAFE_STOPPED is a declared stopped disposition, never a successful path.
const KNOWN=new Set([...GOOD,...BAD,...UNCERTAIN,"SAFE_STOPPED"]);
const SUCCESS_TERMINAL=new Set(["PASS","SUCCESS","SUCCEEDED"]);

export function branchCategory(route,nodeById){
  const source=nodeById.get(route.source),target=nodeById.get(route.target);
  if(source?.operator==="reconcile"||target?.operator==="reconcile")
    return "recovery";
  const outcome=String(route.outcome).toUpperCase();
  if(BAD.has(outcome))return "failure";
  if(UNCERTAIN.has(outcome))return "uncertain";
  return "other";
}

function reachable(initial,routes,reverse=false){
  const links=new Map();
  for(const route of routes){
    const src=reverse?route.target:route.source;
    const dst=reverse?route.source:route.target;
    if(!links.has(src))links.set(src,[]);
    links.get(src).push(dst);
  }
  const seen=new Set(initial),queue=[...seen];
  for(let i=0;i<queue.length;i++)
    for(const dst of links.get(queue[i])??[])
      if(!seen.has(dst)){seen.add(dst);queue.push(dst);}
  return seen;
}

function full(procedure,reason=null){
  return {nodes:procedure.nodes,routes:procedure.routes,
    isFiltered:false,hiddenByNode:new Map(),reason};
}

export function projectPathFocus(procedure,{
  mode="normal",categories=[],expandedNodes=[]
}={}){
  if(mode==="all")return full(procedure);
  if(mode!=="normal"&&mode!=="custom")return full(procedure,"未知路径视图");
  const nodes=procedure?.nodes??[],routes=procedure?.routes??[];
  const byId=new Map(nodes.map(n=>[n.id,n]));
  if(!byId.has(procedure?.start)||routes.some(r=>
    !byId.has(r.source)||!byId.has(r.target)||!KNOWN.has(String(r.outcome).toUpperCase())))
    return full(procedure,"存在无法可靠分类的 Route，显示全部路径");
  const ends=nodes.filter(n=>n.operator==="terminal"&&
    SUCCESS_TERMINAL.has(String(n.value).toUpperCase())).map(n=>n.id);
  if(!ends.length)return full(procedure,"没有明确的成功终态，显示全部路径");
  const success=routes.filter(r=>GOOD.has(String(r.outcome).toUpperCase()));
  const fromStart=reachable([procedure.start],success);
  const toSuccess=reachable(ends,success,true);
  if(!ends.some(id=>fromStart.has(id)))
    return full(procedure,"无法证明通向成功终态的主路径，显示全部路径");
  // Keep ALL valid success paths including joins and parallel alternatives.
  const primary=success.filter(r=>fromStart.has(r.source)&&toSuccess.has(r.target));
  const selected=new Set(primary.map(r=>r.id));
  const primaryNodes=new Set([procedure.start]);
  for(const route of primary){primaryNodes.add(route.source);primaryNodes.add(route.target);}
  const visibleNodes=new Set(primaryNodes);
  const outgoing=new Map();
  for(const route of routes){
    if(!outgoing.has(route.source))outgoing.set(route.source,[]);
    outgoing.get(route.source).push(route);
  }
  // A selected detour reveals its complete downstream subgraph until it
  // rejoins the success backbone. Do not invent a single execution trace.
  function addDetour(seed){
    const queue=[seed],visited=new Set();
    while(queue.length){
      const route=queue.shift();
      if(!route||selected.has(route.id))continue;
      selected.add(route.id);
      visibleNodes.add(route.source);visibleNodes.add(route.target);
      if(primaryNodes.has(route.target)||visited.has(route.target))continue;
      visited.add(route.target);
      for(const next of outgoing.get(route.target)??[])queue.push(next);
    }
  }
  if(mode==="custom"){
    const wanted=new Set(categories);
    for(const route of routes)
      if(primaryNodes.has(route.source)&&!selected.has(route.id)&&
         (wanted.has(branchCategory(route,byId))||
          (wanted.has("recovery")&&branchCategory(route,byId)==="other")))addDetour(route);
    const expanded=new Set(expandedNodes);
    // A newly revealed non-primary node may itself be expanded. Each node is
    // visited once, and Route identities are never copied or synthesized.
    for(let i=0;i<=expanded.size;i++){
      let changed=false;
      for(const id of expanded){
        if(!visibleNodes.has(id))continue;
        for(const route of outgoing.get(id)??[]){
          if(selected.has(route.id))continue;
          addDetour(route);changed=true;
        }
      }
      if(!changed)break;
    }
  }
  const resultRoutes=routes.filter(r=>selected.has(r.id));
  const resultNodes=nodes.filter(n=>visibleNodes.has(n.id));
  const hiddenByNode=new Map();
  for(const node of resultNodes){
    const hidden=(outgoing.get(node.id)??[]).filter(r=>!selected.has(r.id)).length;
    if(hidden)hiddenByNode.set(node.id,hidden);
  }
  return {nodes:resultNodes,routes:resultRoutes,
    isFiltered:resultRoutes.length!==routes.length||resultNodes.length!==nodes.length,
    hiddenByNode,reason:null};
}
