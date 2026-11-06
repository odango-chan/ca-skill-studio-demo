// D1-A2c view-only one-hop Procedure graph. The original Procedure/Routes
// remain the ONLY authority; Stage links are explicitly presentation-only.
import {nodeNeighborhood} from "./workbench.mjs";

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
