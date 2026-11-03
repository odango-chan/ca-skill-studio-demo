import React,{useMemo,useEffect} from "react";
import {createRoot} from "react-dom/client";
import {
  ReactFlow,BaseEdge,EdgeLabelRenderer,Handle,Position,getSmoothStepPath,
  useUpdateNodeInternals
} from "@xyflow/react";
import type {EdgeProps} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {makeFlowElements,resolveReconnectedRoute} from "./react-flow-projection.mjs";

// D1 is a view adapter, not a second workflow store.
// All gestures delegate to the existing source-backed Inspector and Typed Patch.
const sidePositions={top:Position.Top,bottom:Position.Bottom,
  left:Position.Left,right:Position.Right};
function portStyle(port){
  const offset=port.offset+"px";
  const left="calc("+offset+" - var(--port-border-left))";
  const top="calc("+offset+" - var(--port-border-top))";
  if(port.side==="top")return {left,top:"calc(0px - var(--port-border-top))"};
  if(port.side==="bottom")return {left,bottom:"calc(0px - var(--port-border-bottom))"};
  if(port.side==="left")return {top,left:"calc(0px - var(--port-border-left))"};
  return {top,right:"calc(0px - var(--port-border-right))"};
}
function ProcedureCard({data,selected}){
  const direction=data.direction==="RIGHT"?"RIGHT":"DOWN";
  const inputPosition=direction==="DOWN"?Position.Top:Position.Left;
  const outputPosition=direction==="DOWN"?Position.Bottom:Position.Right;
  const updateNodeInternals=useUpdateNodeInternals();
  const ports=data.ports??[];
  // ELK initially follows a temporary fallback layout. Once exact port
  // positions arrive, React Flow must remeasure the new handle boundaries.
  useEffect(()=>{
    updateNodeInternals(data.id);
  },[updateNodeInternals,data.id,data.portSignature,direction]);
  return <div className={
      "designer-node"+(data.terminal?" is-terminal":"")+
      (data.start?" is-start":"")+(selected?" is-selected":"")
    }>
    <Handle type="target" id="in" position={inputPosition}
      className="designer-port designer-port-fallback"
      style={{opacity:ports.length?0:0.55}}/>
    <Handle type="source" id="out" position={outputPosition}
      className="designer-port designer-port-fallback"
      style={{opacity:ports.length?0:0.55}}/>
    {ports.map(port=><Handle key={port.id} id={port.id}
      type={port.type} position={sidePositions[port.side]}
      className="designer-port designer-port-elk"
      style={portStyle(port)}/>)}
    <span className="designer-node-kind">{String(data.operator).toUpperCase()}
      {data.start?" · START":""}{data.childCount?" · CHILD ↗":""}
    </span>
    <strong className="designer-node-id" title={data.id}>{data.id}</strong>
    <span className="designer-node-meta" title={data.value}>{data.value}</span>
  </div>;
}

function RouteEdge(props:EdgeProps){
  const {id,sourceX,sourceY,targetX,targetY,sourcePosition,targetPosition,selected}=props;
  const data:any=props.data;
  const [fallback,fx,fy]=getSmoothStepPath({
    sourceX,sourceY,targetX,targetY,sourcePosition,targetPosition,
    borderRadius:10,offset:24
  });
  const d=data?.path||fallback;
  const lx=data?.labelPosition?.x??fx;
  const ly=data?.labelPosition?.y??fy;
  const label=String(data?.label??"");
  const show=Boolean(data?.displayLabel||selected);
  return <>
    <BaseEdge id={id} path={d} markerEnd={props.markerEnd}
      interactionWidth={16}
      className={"designer-edge"+(data?.important?" is-primary":"")+
        (selected?" is-selected":"")}/>
    {show&&<EdgeLabelRenderer>
      <div className={"designer-route-label"+(selected?" is-selected":"")}
        style={{transform:"translate(-50%,-50%) translate("+lx+"px,"+ly+"px)"}}
        title={label}>{label.length>44?label.slice(0,43)+"…":label}</div>
    </EdgeLabelRenderer>}
  </>;
}
const nodeTypes={procedure:ProcedureCard};
const edgeTypes={"procedure-route":RouteEdge};

function ProcedureScene({scene,callbacks,onReady}){
  const elements=useMemo(()=>
    makeFlowElements(scene.graph,scene.procedure,scene.selection,scene.showAllLabels),
    [scene.graph,scene.procedure,scene.selection,scene.showAllLabels]);
  const selectionId=scene.selection?.kind==="route"?scene.selection.id:null;
  return <ReactFlow
    nodes={elements.nodes} edges={elements.edges}
    nodeTypes={nodeTypes} edgeTypes={edgeTypes}
    onInit={onReady}
    onNodeClick={(_event,node)=>callbacks.onNodeSelect(node.id)}
    onNodeDoubleClick={(_event,node)=>callbacks.onNodeDoubleClick(node.id)}
    onEdgeClick={(_event,edge)=>callbacks.onEdgeSelect(edge.data.bundle)}
    onReconnect={(edge,connection)=>{
      const route=resolveReconnectedRoute(edge.data?.bundle,selectionId);
      if(!route){callbacks.onAmbiguousReconnect();return;}
      callbacks.onReconnect(route.id,connection.source,connection.target);
    }}
    onConnect={()=>callbacks.onCreateUnsupported()}
    onPaneClick={()=>callbacks.onPaneClick()}
    nodesDraggable={false}
    nodesConnectable={true}
    nodesFocusable={true}
    edgesFocusable={true}
    edgesReconnectable={true}
    elementsSelectable={true}
    deleteKeyCode={null}
    selectNodesOnDrag={false}
    panOnDrag
    zoomOnScroll zoomOnPinch zoomOnDoubleClick
    minZoom={0.05} maxZoom={2.5}
    fitView fitViewOptions={{padding:0.18,minZoom:0.05,maxZoom:1.25}}
    attributionPosition="bottom-right"
    className="procedure-flow"
  />;
}

export function mountProcedureCanvas(host,callbacks){
  if(!host)throw new Error("React Flow mount element missing");
  const root=createRoot(host);
  let instance=null;
  let scene={graph:null,procedure:null,selection:null,showAllLabels:false};
  let pendingFit=false;
  const fit=()=>{
    if(!instance){pendingFit=true;return;}
    requestAnimationFrame(()=>{instance?.fitView({padding:0.18,duration:150,
      minZoom:0.05,maxZoom:1.25});});
  };
  const onReady=flow=>{
    instance=flow;
    if(pendingFit||scene.graph){pendingFit=false;fit();}
  };
  const api={
    render(graph,procedure,selection,showAllLabels){
      scene={graph,procedure,selection,showAllLabels};
      root.render(<ProcedureScene scene={scene}
        callbacks={callbacks} onReady={onReady}/>);
    },
    fit,
    center(id){
      const p=scene.graph?.positions.get(id);
      if(!p||!instance)return;
      const width=238,height=80;
      const zoom=instance.getZoom();
      requestAnimationFrame(()=>instance?.setCenter(p.x+width/2,p.y+height/2,
        {zoom,duration:150}));
    },
    zoomIn(){instance?.zoomIn({duration:130});},
    zoomOut(){instance?.zoomOut({duration:130});},
    dispose(){root.unmount();instance=null;}
  };
  return api;
}
