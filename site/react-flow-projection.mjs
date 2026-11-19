// A one-way, source-preserving view model. No YAML mutation and no editable graph store.
// This module deliberately has no React or DOM dependency so it can be regression-tested.
const NODE_WIDTH=238;
const NODE_HEIGHT=80;
export const FLOW_NODE_SIZE=Object.freeze({width:NODE_WIDTH,height:NODE_HEIGHT});

// Route color is a conservative, view-only outcome classification. Never
// paint a mixed success/failure bundle green just because it contains PASS.
const ROUTE_OUTCOMES={
  success:new Set(["PASS","SUCCEEDED","SUCCESS"]),
  failure:new Set(["FAIL","FAILED","ERROR","DENIED"]),
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
const STAGE_LABELS=Object.freeze({
  precondition:"PRE",operation:"OP",observation:"OBS",postcondition:"POST"
});
export function summarizeNodeStages(node){
  if(!Array.isArray(node?.stages))return [];
  return node.stages.map(stage=>({
    name:stage.name,label:STAGE_LABELS[stage.name]??String(stage.name).toUpperCase(),
    count:Number.isSafeInteger(stage.count)?stage.count:1,
    countLabel:stage.name==="precondition"||stage.name==="postcondition"
      ?"Predicates":"Stage",
    operators:stage.target?[{kind:stage.name==="observation"?"OBSERVATION":
      stage.name==="operation"?"TOOL":"PREDICATE",count:1}]:[],
    routeCount:Array.isArray(stage.routeOutcomes)?stage.routeOutcomes.length:0
  }));
}
export function describeProcedureLegend(procedure,visibleNodes=null){
  const nodes=visibleNodes??procedure?.nodes??[];
  const nodeKinds=new Map(),stepKinds=new Map();
  let preNodes=0,postNodes=0;
  for(const node of nodes){
    const kind=String(node.operator||"").toUpperCase();
    nodeKinds.set(kind,(nodeKinds.get(kind)||0)+1);
    for(const phase of summarizeNodeStages(node)){
      if(phase.name==="precondition")preNodes++;
      if(phase.name==="postcondition")postNodes++;
      for(const {kind:stepKind,count} of phase.operators)
        stepKinds.set(stepKind,(stepKinds.get(stepKind)||0)+count);
    }
  }
  const entries=map=>[...map.entries()].map(([kind,count])=>({kind,count}));
  return {nodeKinds:entries(nodeKinds),stepKinds:entries(stepKinds),
    nodeCount:nodes.length,preNodes,postNodes};
}
export function flowBundleSelectionId(bundle){
  if(!bundle?.routes?.length)return null;
  return bundle.source+"->"+bundle.target+"|"+bundle.routeSource+"|"+
    bundle.routes.map(route=>route.id).sort().join("|");
}
export function routeOrigin(routeSource){
  if(routeSource==="precondition")return "PRE";
  if(routeSource==="postcondition")return "POST";
  if(routeSource==="operation")return "OP";
  if(routeSource==="observation")return "OBS";
  return "OTHER";
}

export function makeFlowElements(graph,procedure,selection=null,showAllLabels=false,
  routeCreationSourceId=null){
  if(!graph||!procedure)return {nodes:[],edges:[],direction:"DOWN"};
  const direction=graph.direction==="RIGHT"?"RIGHT":"DOWN";
  const present=new Set((graph.visibleNodes??procedure.nodes).map(n=>n.id));
  const selectedRoute=selection?.kind==="route"?selection.id:null;
  const selectedBundle=selection?.kind==="bundle"?selection.id:null;
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
      // The current grammar owns all graph interaction policy. Node dragging is
      // disabled; only the explicit selected-node Route creation handle is active.
      connectable:!node.viewOnly&&node.operator!=="terminal",
      selected:selection?.kind==="node"&&selection.id===node.id,
      data:{
        id:node.id,operator:node.operator,value:node.value,
        start:node.id===procedure.start,
        terminal:node.operator==="terminal",
        childCount:node.children?.length??0,direction,
        viewOnly:Boolean(node.viewOnly),
        globalPrecondition:Boolean(node.globalPrecondition),
        finalGoal:Boolean(node.finalGoal),
        // A procedure invocation is a real Node referring to a separate
        // definition. Never inline or duplicate the child in this graph.
        childProcedure:node.operator==="procedure"&&
          node.children?.some(ref=>ref.via==="operator"&&ref.procedure===node.value)
          ?node.value:null,
        phaseBadges:summarizeNodeStages(node),
        hiddenBranchCount:graph.hiddenByNode?.get(node.id)??0,
        branchesExpanded:graph.expandedNodeIds?.has(node.id)??false,
        canAddRoute:!node.viewOnly&&
          node.operator!=="terminal"&&selection?.kind==="node"&&
          selection.id===node.id&&routeCreationSourceId===node.id,
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
    const selected=Boolean(
      (selectedRoute&&bundle.routes.some(r=>r.id===selectedRoute))||
      selectedBundle===flowBundleSelectionId(bundle)
    );
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
      // Existing Routes remain read-only until a current-grammar target-patch
      // contract exists. Route creation is a separate explicit source patch.
      reconnectable:false,
      data:{
        bundle,sourceRouteIds:bundle.routes.map(route=>route.id),
        selected,important,tone,label,origin,
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
