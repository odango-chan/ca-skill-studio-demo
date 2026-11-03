// A one-way, source-preserving view model. No YAML mutation and no editable graph store.
// This module deliberately has no React or DOM dependency so it can be regression-tested.
const NODE_WIDTH=238;
const NODE_HEIGHT=80;
export const FLOW_NODE_SIZE=Object.freeze({width:NODE_WIDTH,height:NODE_HEIGHT});

export function makeFlowElements(graph,procedure,selection=null,showAllLabels=false){
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
    const important=bundle.outcomes.some(x=>x==="PASS"||x==="SUCCEEDED");
    const phase=(bundle.routeSource??"operator.on").replace(/\.on$/,"");
    const label=(phase==="operator"?"":phase+" · ")+bundle.outcomes.join(" / ");
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
        color:important?"#138f7a":"#66899f",
        width:16,height:16,
        strokeWidth:1.2,
        markerUnits:"userSpaceOnUse"
      },
      // Only the verified handler may propose a YAML patch on reconnect.
      reconnectable:true,
      data:{
        bundle,selected,important,label,
        displayLabel:showAllLabels||important||selected,
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
