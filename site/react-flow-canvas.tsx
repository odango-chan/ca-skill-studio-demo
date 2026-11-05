import React,{useMemo,useEffect} from "react";
import {createRoot} from "react-dom/client";
import {
  ReactFlow,BaseEdge,EdgeLabelRenderer,Handle,Position,getSmoothStepPath,
  useUpdateNodeInternals
} from "@xyflow/react";
import type {EdgeProps} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {makeFlowElements,resolveReconnectedRoute} from "./react-flow-projection.mjs";
import {axisFitViewport} from "./fit-axis.mjs";
import {iconShapes,operatorIcon} from "./icons.mjs";

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
function OperatorGlyph({operator}){
  const name=operatorIcon(operator);
  return <svg className="studio-icon designer-kind-icon" viewBox="0 0 24 24"
    width="15" height="15" fill="none" stroke="currentColor"
    strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true" focusable="false" data-icon={name}>
    {iconShapes(name).map((item,i)=>
      React.createElement(item.tag,{...item.attrs,key:i}))}
  </svg>;
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
      (data.start?" is-start":"")+
      (data.direction==="RIGHT"?" is-horizontal":"")+
      (selected?" is-selected":"")+
      (data.phaseBadges?.length?" has-phases":"")+
      (data.childProcedure?" is-subflow-invocation":"")
    }>
    <Handle type="target" id="in" position={inputPosition}
      className="designer-port designer-port-fallback designer-port-target"
      title="连接到这个 Node"
      style={{opacity:ports.length?0.3:0.55}}/>
    <Handle type="source" id="out" position={outputPosition}
      className="designer-port designer-port-fallback"
      style={{opacity:ports.length?0:0.55}}/>
    {data.canAddRoute&&<Handle type="source" id="new-route-out"
      position={direction==="DOWN"?Position.Right:Position.Bottom}
      className="designer-port designer-port-create"
      title="拖动以提出新的 operator.on Route（需选择 Outcome 并确认 Diff）"
      aria-label="从此节点添加 Route"/>}
    {ports.map(port=><Handle key={port.id} id={port.id}
      type={port.type} position={sidePositions[port.side]}
      className="designer-port designer-port-elk"
      style={portStyle(port)}/>)}
    <span className="designer-node-kind">
      <OperatorGlyph operator={data.operator}/>
      {String(data.operator).toUpperCase()}
      {data.childProcedure?" · 子流程":data.childCount?" · CHILD":""}
    </span>
    <strong className="designer-node-id" title={data.id}>{data.id}</strong>
    <span className="designer-node-meta" title={data.value}>
      {data.childProcedure?"↳ ":""}{data.value}
    </span>
    {data.childProcedure&&<button type="button"
      className="designer-subflow-enter nodrag nopan"
      aria-label={"进入子流程 "+data.childProcedure}
      title={"进入 "+data.childProcedure+" · 保留调用节点位置"}
      onPointerDown={event=>event.stopPropagation()}
      onClick={event=>{
        event.stopPropagation();
        data.onEnterChild?.();
      }}>进入子流程 <span aria-hidden="true">›</span></button>}
    {Boolean(data.phaseBadges?.length)&&
      <span className="designer-node-phases" aria-label="节点内部阶段">
        {data.phaseBadges.map(phase=><span
          key={phase.name} className={"designer-phase-badge phase-"+phase.name}
          title={phase.label+" · "+phase.count+" Steps"+(phase.operators.length
            ?" · "+phase.operators.map(x=>x.kind+" ×"+x.count).join(" / "):"")}>
          {phase.label} · {phase.count}
        </span>)}
      </span>}
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
      className={"designer-edge tone-"+(data?.tone||"neutral")+
        " origin-"+(data?.origin||"OTHER")+
        (selected?" is-selected":"")}/>
    {show&&<EdgeLabelRenderer>
      <div className={"designer-route-label tone-"+(data?.tone||"neutral")+
          " origin-"+(data?.origin||"OTHER")+
          (selected?" is-selected":"")}
        style={{transform:"translate(-50%,-50%) translate("+lx+"px,"+ly+"px)"}}
        title={label}>{label.length>44?label.slice(0,43)+"…":label}</div>
    </EdgeLabelRenderer>}
  </>;
}
const nodeTypes={procedure:ProcedureCard};
const edgeTypes={"procedure-route":RouteEdge};

function ProcedureScene({scene,callbacks,onReady}){
  const elements=useMemo(()=>
    makeFlowElements(scene.graph,scene.procedure,scene.selection,
      scene.showAllLabels,scene.routeCreationSourceId),
    [scene.graph,scene.procedure,scene.selection,scene.showAllLabels,
      scene.routeCreationSourceId]);
  const selectionId=scene.selection?.kind==="route"?scene.selection.id:null;
  const nodes=elements.nodes.map(node=>node.data.childProcedure?{
    ...node,data:{...node.data,onEnterChild:()=>
      callbacks.onEnterChild(node.id,node.data.childProcedure)}
  }:node);
  return <ReactFlow
    nodes={nodes} edges={elements.edges}
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
    onConnect={connection=>callbacks.onCreateRoute(connection)}
    onPaneClick={()=>callbacks.onPaneClick()}
    nodesDraggable={false}
    nodesConnectable={true}
    nodesFocusable={true}
    edgesFocusable={true}
    edgesReconnectable={true}
    elementsSelectable={true}
    deleteKeyCode={null}
    // Space belongs to the focused Monaco/YAML/Python/Markdown editor.
    // React Flow's default Space pan hotkey listens globally and steals typing.
    // Mouse drag panning remains enabled via panOnDrag below.
    panActivationKeyCode={null}
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
  let scene={graph:null,procedure:null,selection:null,showAllLabels:false,
    routeCreationSourceId:null};
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
    render(graph,procedure,selection,showAllLabels,routeCreationSourceId=null){
      scene={graph,procedure,selection,showAllLabels,routeCreationSourceId};
      root.render(<ProcedureScene scene={scene}
        callbacks={callbacks} onReady={onReady}/>);
    },
    fit,
    fitAxis(axis){
      if(!instance||!scene.graph||!scene.procedure)return false;
      const {width,height}=host.getBoundingClientRect();
      const viewport=axisFitViewport(scene.graph,scene.procedure,
        {width,height},axis);
      if(!viewport)return false;
      requestAnimationFrame(()=>instance?.setViewport(viewport,{duration:150}));
      return true;
    },
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
