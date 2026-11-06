// A one-way, source-preserving view model. No YAML mutation and no editable graph store.
// This module deliberately has no React or DOM dependency so it can be regression-tested.
const NODE_WIDTH=238;
const NODE_HEIGHT=80;
export const FLOW_NODE_SIZE=Object.freeze({width:NODE_WIDTH,height:NODE_HEIGHT});

// Route color is a conservative, view-only outcome classification. Never
// paint a mixed success/failure bundle green just because it contains PASS.
const ROUTE_OUTCOMES={
  success:new Set(["PASS","SUCCEEDED","SUCCESS"]),
  failure:new Set(["FAIL","FAILED","ERROR"]),
  uncertain:new Set(["UNKNOWN","OUTCOME_UNKNOWN","UNRESOLVED","TIMEOUT","TIMED_OUT"])
};
export const ROUTE_TONE_COLOR=Object.freeze({
  success:"#138f7a",failure:"#c05a55",uncertain:"#b37a27",
  mixed:"#66899f",neutral:"#66899f"
});
export function classifyRouteTone(outcomes){
  if(!Array.isArray(outcomes)||!outcomes.length)return "neutral";
  const tones=outcomes.map(outcome=>{
    const label=String(outcome).toUpperCase();
    for(const [tone,set] of Object.entries(ROUTE_OUTCOMES))
      if(set.has(label))return tone;
    return "neutral";
  });
  return tones.every(tone=>tone===tones[0])?tones[0]:"mixed";
}

// The node card and contextual legend are read-only views of existing YAML.
// A Phase Step's operator is not a new graph Node or an assertion that TOOL
// and CALL have the same Runtime semantics.
const PHASE_LABELS=Object.freeze({preconditions:"PRE",postconditions:"POST"});
export function summarizeNodePhases(node){
  const phases=[];
  for(const name of ["preconditions","postconditions"]){
    const phase=node?.phases?.find(item=>item.name===name);
    if(!phase)continue;
    const steps=Array.isArray(phase.steps)?phase.steps:[];
    const operators=new Map();
    for(const step of steps){
      const kind=String(step.operator||"").toUpperCase();
      operators.set(kind,(operators.get(kind)||0)+1);
    }
    phases.push({
      name,label:PHASE_LABELS[name],count:steps.length,
      operators:[...operators].map(([kind,count])=>({kind,count})),
      routeCount:phase.routeCount??0
    });
  }
  return phases;
}
export function describeProcedureLegend(procedure,visibleNodes=null){
  const nodes=visibleNodes??procedure?.nodes??[];
  const nodeKinds=new Map(),stepKinds=new Map();
  let preNodes=0,postNodes=0;
  for(const node of nodes){
    const kind=String(node.operator||"").toUpperCase();
    nodeKinds.set(kind,(nodeKinds.get(kind)||0)+1);
    for(const phase of summarizeNodePhases(node)){
      if(phase.name==="preconditions")preNodes++;
      if(phase.name==="postconditions")postNodes++;
      for(const {kind:stepKind,count} of phase.operators)
        stepKinds.set(stepKind,(stepKinds.get(stepKind)||0)+count);
    }
  }
  const entries=map=>[...map.entries()].map(([kind,count])=>({kind,count}));
  return {nodeKinds:entries(nodeKinds),stepKinds:entries(stepKinds),
    nodeCount:nodes.length,preNodes,postNodes};
}
export function routeOrigin(routeSource){
  if(routeSource==="preconditions.on")return "PRE";
  if(routeSource==="postconditions.on")return "POST";
  if(routeSource==="operator.on")return "OP";
  return "OTHER";
}

export function makeFlowElements(graph,procedure,selection=null,showAllLabels=false,
  routeCreationSourceId=null){
  if(!graph||!procedure)return {nodes:[],edges:[],direction:"DOWN"};
  const direction=graph.direction==="RIGHT"?"RIGHT":"DOWN";
  const present=new Set((graph.visibleNodes??procedure.nodes).map(n=>n.id));
  const selectedRoute=selection?.kind==="route"?selection.id:null;
  const ports=new Map([...present].map(id=>[id,[]]));
  for(const [i,bundle] of graph.bundles.entries()){
    const anchors=bundle.anchors;
    if(!anchors||!bundle.path)continue;
    const src=ports.get(bundle.source),dst=ports.get(bundle.target);
    if(!src||!dst)throw Error("Route ports have dangling nodes");
    src.push({id:"edge-"+i+"-out",type:"source",...anchors.source});
    dst.push({id:"edge-"+i+"-in",type:"target",...anchors.target});
  }
  const nodes=(graph.visibleNodes??procedure.nodes).map(node=>{
    const position=graph.positions.get(node.id);
    if(!position||!Number.isFinite(position.x)||!Number.isFinite(position.y))
      throw new Error("Missing or invalid ELK node position: "+node.id);
    return {
      id:node.id,
      type:"procedure",
      position:{x:position.x,y:position.y},
      sourcePosition:direction==="DOWN"?"bottom":"right",
      targetPosition:direction==="DOWN"?"top":"left",
      draggable:false,
      selectable:true,
      selected:selection?.kind==="node"&&selection.id===node.id,
      data:{
        id:node.id,operator:node.operator,value:node.value,
        start:node.id===procedure.start,
        terminal:node.operator==="terminal",
        childCount:node.children?.length??0,direction,
        // A procedure invocation is a real Node referring to a separate
        // definition. Never inline or duplicate the child in this graph.
        childProcedure:node.operator==="procedure"&&
          node.children?.some(ref=>ref.via==="operator"&&ref.procedure===node.value)
          ?node.value:null,
        phaseBadges:summarizeNodePhases(node),
        hiddenBranchCount:graph.hiddenByNode?.get(node.id)??0,
        branchesExpanded:graph.expandedNodeIds?.has(node.id)??false,
        canAddRoute:node.operator!=="terminal"&&
          selection?.kind==="node"&&selection.id===node.id&&
          routeCreationSourceId===node.id,
        ports:ports.get(node.id)??[],
        portSignature:(ports.get(node.id)??[])
          .map(port=>port.id+":"+port.side+":"+port.offset).join("|")
      }
    };
  });
  const edges=graph.bundles.map((bundle,i)=>{
    if(!present.has(bundle.source)||!present.has(bundle.target))
      throw new Error("Unresolved flow edge: "+bundle.source+" -> "+bundle.target);
    if(!bundle.routes?.length)throw new Error("Empty Route bundle");
    const selected=Boolean(selectedRoute&&bundle.routes.some(r=>r.id===selectedRoute));
    const tone=classifyRouteTone(bundle.outcomes);
    const important=tone==="success";
    const origin=routeOrigin(bundle.routeSource);
    const label=origin+" · "+bundle.outcomes.join(" / ");
    return {
      id:"flow-edge-"+i,
      source:bundle.source,target:bundle.target,
      sourceHandle:bundle.anchors&&bundle.path?"edge-"+i+"-out":"out",
      targetHandle:bundle.anchors&&bundle.path?"edge-"+i+"-in":"in",
      type:"procedure-route",selectable:true,
      selected,
      // Use React Flow's built-in slender open marker, not an oversized,
      // filled 24x24 closed arrow. Its color follows the corresponding edge.
      markerEnd:{
        type:"arrow",
        color:selected?"#087e71":ROUTE_TONE_COLOR[tone],
        width:16,height:16,
        strokeWidth:1.2,
        markerUnits:"userSpaceOnUse"
      },
      // Only the verified handler may propose a YAML patch on reconnect.
      reconnectable:true,
      data:{
        bundle,selected,important,tone,label,origin,
        displayLabel:showAllLabels||origin!=="OP"||["success","failure","uncertain"].includes(tone)||selected,
        path:bundle.path??null,
        labelPosition:bundle.label??null,direction
      }
    };
  });
  const accounted=edges.reduce((n,e)=>n+e.data.bundle.routes.length,0);
  if(accounted!==(graph.visibleRoutes??procedure.routes).length)
    throw new Error("React Flow projection dropped or duplicated a Route");
  return {nodes,edges,direction};
}

export function resolveReconnectedRoute(bundle,selectedRouteId){
  if(!bundle?.routes?.length)return null;
  if(selectedRouteId){
    const selected=bundle.routes.find(route=>route.id===selectedRouteId);
    if(selected)return selected;
  }
  // Bundles with multiple Outcomes require an explicit selection first.
  return bundle.routes.length===1?bundle.routes[0]:null;
}
