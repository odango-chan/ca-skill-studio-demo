import {FLOW_NODE_SIZE} from "./react-flow-projection.mjs";

// Pure viewport math, shared by full ELK and the large-graph fallback.
// The active Procedure/scope, not the whole document or DOM, defines bounds.
// Fitting one axis deliberately allows overflow in the other axis.
export function axisFitViewport(graph,procedure,viewport,axis,{
  padding=24,minZoom=0.05,maxZoom=2.5
}={}){
  if(!["width","height"].includes(axis)||
    !graph?.positions||!procedure||
    !Number.isFinite(viewport?.width)||!Number.isFinite(viewport?.height)||
    viewport.width<=padding*2||viewport.height<=padding*2)return null;
  const nodes=graph.visibleNodes??procedure.nodes;
  if(!Array.isArray(nodes)||!nodes.length)return null;
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const node of nodes){
    const p=graph.positions.get(node.id);
    if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y))return null;
    minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);
    maxX=Math.max(maxX,p.x+FLOW_NODE_SIZE.width);
    maxY=Math.max(maxY,p.y+FLOW_NODE_SIZE.height);
  }
  if(!Number.isFinite(minX)||!Number.isFinite(minY)||
    !Number.isFinite(maxX)||!Number.isFinite(maxY))return null;
  const span=axis==="width"?maxX-minX:maxY-minY;
  const available=(axis==="width"?viewport.width:viewport.height)-2*padding;
  if(!(span>0)||!(available>0))return null;
  const zoom=Math.min(maxZoom,Math.max(minZoom,available/span));
  const x=viewport.width/2-(minX+maxX)*zoom/2;
  const y=viewport.height/2-(minY+maxY)*zoom/2;
  return {x,y,zoom};
}
