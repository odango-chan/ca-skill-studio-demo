// D1-A2c view-only one-hop Procedure graph. The original Procedure/Routes
// remain the ONLY authority; Stage links are explicitly presentation-only.
import {nodeNeighborhood} from "./workbench.mjs";
import {classifyRouteTone,ROUTE_TONE_COLOR,routeOrigin} from "./react-flow-projection.mjs";

const BASE={width:238,height:80};
const stageId=name=>"stage:"+name;
const sourceStage=origin=>origin==="preconditions.on"?"preconditions":
  origin==="postconditions.on"?"postconditions":"operator";
function dim(node){
  if(node.kind==="neighbor")return {...BASE};
  const steps=node.steps??[];
  return {width:272,height:Math.min(520,Math.max(94,64+steps.length*34))};
}
export function projectNodeFocusFlow(procedure,centerId){
  const neighbors=nodeNeighborhood(procedure,centerId);
  if(!neighbors)return null;
  const current=neighbors.node;
  const phases=new Map((current.phases??[]).map(p=>[p.name,p]));
  const stages=["preconditions","operator","postconditions"]
    .filter(name=>name==="operator"||phases.has(name));
  const nodes=[],dimensions=new Map();
  const add=node=>{nodes.push(node);dimensions.set(node.id,dim(node));};
  for(const {node} of neighbors.previous.peers){
    if(node.id===centerId)continue;
    add({id:"before:"+node.id,kind:"neighbor",role:"previous",original:node});
  }
  for(const name of stages){
    const phase=phases.get(name);
    add({id:stageId(name),kind:"stage",stage:name,
      operator:name==="operator"?current.operator:null,
      value:name==="operator"?current.value:null,
      steps:phase?.steps??[],phaseLine:phase?.line??null,
      original:current});
  }
  for(const {node} of neighbors.next.peers){
    if(node.id===centerId)continue;
    add({id:"after:"+node.id,kind:"neighbor",role:"next",original:node});
  }
  const entry=stageId(stages[0]);
  const routes=[];
  for(const route of procedure.routes){
    if(route.source!==centerId&&route.target!==centerId)continue;
    const from=route.source===centerId
      ?stageId(stages.includes(sourceStage(route.routeSource))
        ?sourceStage(route.routeSource):"operator")
      :"before:"+route.source;
    const to=route.target===centerId?entry:"after:"+route.target;
    if(!dimensions.has(from)||!dimensions.has(to))
      throw Error("One-hop Route refers to unavailable visual Node");
    routes.push({...route,source:from,target:to,originalRoute:route,viewOnly:false});
  }
  for(let i=1;i<stages.length;i++){
    routes.push({
      id:"view:phase:"+stages[i-1]+":"+stages[i],
      source:stageId(stages[i-1]),target:stageId(stages[i]),
      routeSource:"view.phase",outcome:"NEXT",line:current.line,
      viewOnly:true
    });
  }
  const realRoutes=routes.filter(r=>!r.viewOnly);
  const expected=procedure.routes.filter(r=>r.source===centerId||r.target===centerId);
  if(realRoutes.length!==expected.length||
     new Set(realRoutes.map(r=>r.id)).size!==realRoutes.length||
     realRoutes.some(r=>r.originalRoute.source!==centerId&&r.originalRoute.target!==centerId))
    throw Error("One-hop Route identity mismatch");
  return {
    name:"view:"+procedure.name+":"+centerId,start:entry,
    nodes,routes,dimensions,stages,focusId:centerId,
    sourceProcedure:procedure,originalRouteCount:realRoutes.length,
    incomingCount:neighbors.previous.routeCount,
    outgoingCount:neighbors.next.routeCount,
    previousCount:neighbors.previous.peers.length,
    nextCount:neighbors.next.peers.length
  };
}

// A read-only React Flow backdrop. It groups the current Node's PRE/OP/POST
// visually without parenting or changing ELK geometry/handles/source Routes.
export function currentNodeBoundary(local,layout){
  if(!local||!layout)return null;
  const stages=local.nodes.filter(node=>node.kind==="stage");
  if(!stages.length)return null;
  const rects=stages.map(node=>{
    const position=layout.positions.get(node.id);
    const size=local.dimensions.get(node.id);
    if(!position||!size)return null;
    return {left:position.x,top:position.y,
      right:position.x+size.width,bottom:position.y+size.height};
  });
  if(rects.some(rect=>!rect))return null;
  const left=Math.min(...rects.map(x=>x.left));
  const top=Math.min(...rects.map(x=>x.top));
  const right=Math.max(...rects.map(x=>x.right));
  const bottom=Math.max(...rects.map(x=>x.bottom));
  const padding={left:18,right:18,top:39,bottom:18};
  return {position:{x:left-padding.left,y:top-padding.top},
    width:right-left+padding.left+padding.right,
    height:bottom-top+padding.top+padding.bottom};
}

export function makeNodeFocusElements(local,layout){
  if(!local||!layout)return {nodes:[],edges:[]};
  const ports=new Map(local.nodes.map(node=>[node.id,[]]));
  for(const [i,b] of layout.bundles.entries()){
    if(!b.path||!b.anchors)continue;
    ports.get(b.source)?.push({id:"focus-edge-"+i+"-out",type:"source",
      ...b.anchors.source});
    ports.get(b.target)?.push({id:"focus-edge-"+i+"-in",type:"target",
      ...b.anchors.target});
  }
  const boundary=currentNodeBoundary(local,layout);
  if(!boundary)throw Error("Current Node phase boundary cannot be positioned");
  const nodes=local.nodes.map(node=>{
    const position=layout.positions.get(node.id),dimensions=local.dimensions.get(node.id);
    if(!position||!dimensions)throw Error("Missing positioned local flow Node: "+node.id);
    const nodePorts=ports.get(node.id);
    return {id:node.id,type:"focus-node",position,draggable:false,
      selectable:false,
      data:{...node,dimensions,ports:nodePorts,direction:"RIGHT",
        portSignature:nodePorts.map(p=>p.id+":"+p.side+":"+p.offset).join("|")}};
  });
  // The outline is an explanatory visual Node, not a Procedure business Node.
  // It owns no handles, Routes, editing actions or Runtime identity.
  nodes.unshift({
    id:"view:current-node-boundary",type:"focus-boundary",
    position:boundary.position,draggable:false,selectable:false,
    focusable:false,connectable:false,zIndex:-1,
    style:{width:boundary.width,height:boundary.height,pointerEvents:"none"},
    data:{centerId:local.focusId,width:boundary.width,height:boundary.height,
      viewOnly:true}
  });
  const edges=layout.bundles.map((b,i)=>{
    const internal=b.routeSource==="view.phase";
    if(internal!==b.routes.every(route=>Boolean(route.viewOnly)))
      throw Error("Mixed view-only and real Routes in local graph");
    const tone=internal?"neutral":classifyRouteTone(b.outcomes);
    const origin=internal?"VIEW":routeOrigin(b.routeSource);
    const hasAnchors=Boolean(b.path&&b.anchors);
    return {id:"focus-edge-"+i,source:b.source,target:b.target,
      type:internal?"focus-phase-link":"procedure-route",
      sourceHandle:hasAnchors?"focus-edge-"+i+"-out":"out",
      targetHandle:hasAnchors?"focus-edge-"+i+"-in":"in",
      selectable:false,reconnectable:false,
      markerEnd:{type:"arrow",width:15,height:15,strokeWidth:1.2,
        markerUnits:"userSpaceOnUse",
        color:internal?"#a7b7c7":ROUTE_TONE_COLOR[tone]},
      data:{bundle:b,tone,origin,selected:false,
        path:b.path??null,labelPosition:b.label??null,
        displayLabel:!internal,
        label:internal?"阶段顺序":origin+" · "+b.outcomes.join(" / "),
        sourceRouteIds:internal?[]:b.routes.map(r=>r.originalRoute.id)}};
  });
  const accounted=edges.flatMap(e=>e.data.sourceRouteIds);
  const expected=local.routes.filter(r=>!r.viewOnly).map(r=>r.originalRoute.id);
  if(accounted.length!==local.originalRouteCount||
     accounted.length!==expected.length||
     accounted.some((id,i)=>!expected.includes(id))||
     new Set(accounted).size!==accounted.length)
    throw Error("Local flow silently lost or duplicated an original Route");
  return {nodes,edges};
}
