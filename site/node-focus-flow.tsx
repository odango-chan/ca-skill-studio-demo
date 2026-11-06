import React,{useEffect,useMemo} from "react";
import {createRoot} from "react-dom/client";
import {ReactFlow,BaseEdge,Handle,Position,useUpdateNodeInternals,getSmoothStepPath}
  from "@xyflow/react";
import type {EdgeProps} from "@xyflow/react";
import {RouteEdge,portStyle} from "./react-flow-canvas.tsx";
import {makeNodeFocusElements} from "./node-focus-graph.mjs";

const sides={top:Position.Top,bottom:Position.Bottom,left:Position.Left,right:Position.Right};

// Render only authentic neighbor Nodes and the current Node's source-backed
// PRE/OP/POST stages. No editable fake business Nodes or hidden Route path.
function FocusNode({data}){
  const update=useUpdateNodeInternals();
  const ports=data.ports??[];
  useEffect(()=>{update(data.id);},
    [update,data.id,data.portSignature,data.dimensions?.height]);
  const stage=data.kind==="stage";
  const dims=data.dimensions;
  const label=data.stage==="preconditions"?"PRE · 前置条件":
    data.stage==="postconditions"?"POST · 后置条件":
    "OP · "+data.original.operator.toUpperCase();
  return <div className={"focus-graph-card "+(stage?"is-stage stage-"+data.stage:
      "is-neighbor role-"+data.role)}
    style={{width:dims.width,height:dims.height}}>
    <Handle type="target" id="in" position={Position.Left}
      className="designer-port designer-port-fallback"
      style={{opacity:ports.length?0:0.5}}/>
    <Handle type="source" id="out" position={Position.Right}
      className="designer-port designer-port-fallback"
      style={{opacity:ports.length?0:0.5}}/>
    {ports.map(port=><Handle key={port.id} id={port.id}
      type={port.type} position={sides[port.side]}
      className="designer-port designer-port-elk"
      style={portStyle(port)}/>)}
    {stage?<>
      <div className="focus-graph-card-title">
        <strong>{label}</strong>
        <span>{data.stage==="operator"?"NODE":"STEPS · "+data.steps.length}</span>
      </div>
      {data.stage==="operator"?
        <div className="focus-graph-op">
          <strong title={data.original.id}>{data.original.id}</strong>
          <span title={data.value}>{data.value}</span>
        </div>:
        <div className="focus-graph-steps">
          {data.steps.map((step,i)=><div className="focus-graph-step" key={i}>
            <strong>{String(step.operator).toUpperCase()}</strong>
            <span title={step.value}>
              {step.name?<b>{step.name}: </b>:null}{step.value}
            </span>
            <button type="button" className="nodrag nopan focus-graph-source"
              title={"在 Source 定位 Step · L"+step.line}
              onPointerDown={event=>event.stopPropagation()}
              onClick={event=>{event.stopPropagation();data.onSource?.(step.line);}}>
              L{step.line}
            </button>
          </div>)}
          {!data.steps.length&&<span className="focus-graph-no-steps">无 Step</span>}
        </div>}
    </>:<>
      <div className="focus-graph-card-title">
        <strong>{data.role==="previous"?"上一跳":"下一跳"}</strong>
        <span>{String(data.original.operator).toUpperCase()}</span>
      </div>
      <strong className="focus-graph-neighbor-name" title={data.original.id}>
        {data.original.id}
      </strong>
      <button className="nodrag nopan focus-graph-pivot" type="button"
        title={"以 "+data.original.id+" 为中心查看局部流程图"}
        onPointerDown={event=>event.stopPropagation()}
        onClick={event=>{event.stopPropagation();data.onPivot?.(data.original.id);}}>
        以此为中心 <span aria-hidden="true">›</span>
      </button>
    </>}
  </div>;
}
function PhaseLink(props:EdgeProps){
  const data:any=props.data;
  const [fallback]=getSmoothStepPath({
    sourceX:props.sourceX,sourceY:props.sourceY,
    targetX:props.targetX,targetY:props.targetY,
    sourcePosition:props.sourcePosition,targetPosition:props.targetPosition
  });
  return <BaseEdge id={props.id} path={data?.path||fallback}
    markerEnd={props.markerEnd}
    className="focus-graph-phase-link" interactionWidth={0}/>;
}
const nodeTypes={"focus-node":FocusNode};
const edgeTypes={"procedure-route":RouteEdge,"focus-phase-link":PhaseLink};
function NodeFocusScene({local,layout,callbacks,onReady}){
  const elements=useMemo(()=>makeNodeFocusElements(local,layout),[local,layout]);
  const nodes=elements.nodes.map(node=>({
    ...node,data:{...node.data,
      onPivot:callbacks.onPivot,onSource:callbacks.onSource}
  }));
  return <ReactFlow
    nodes={nodes} edges={elements.edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
    onInit={onReady}
    onNodeClick={(_event,node)=>{
      const data:any=node.data;
      if(data.kind==="neighbor")callbacks.onPivot(data.original.id);
    }}
    onNodeDoubleClick={(_event,node)=>{
      if(node.data.kind==="neighbor")callbacks.onPivot(node.data.original.id);
    }}
    nodesDraggable={false} nodesConnectable={false}
    nodesFocusable edgesFocusable edgesReconnectable={false}
    elementsSelectable={false} deleteKeyCode={null}
    panActivationKeyCode={null} panOnDrag selectNodesOnDrag={false}
    zoomOnScroll zoomOnPinch zoomOnDoubleClick={false}
    minZoom={0.08} maxZoom={2.2}
    fitView fitViewOptions={{padding:0.22,minZoom:0.08,maxZoom:1.15}}
    className="procedure-flow focus-procedure-flow"
  />;
}
export function mountNodeFocusCanvas(host,callbacks){
  if(!host)throw Error("Node focus graph host missing");
  const root=createRoot(host);
  let instance=null,local=null;
  const fit=()=>requestAnimationFrame(()=>instance?.fitView({
    padding:0.24,duration:120,minZoom:0.08,maxZoom:1.15}));
  return {
    render(nextLocal,layout){
      local=nextLocal;
      root.render(<NodeFocusScene local={nextLocal} layout={layout}
        callbacks={callbacks} onReady={flow=>{instance=flow;fit();}}/>);
      requestAnimationFrame(()=>requestAnimationFrame(fit));
    },
    clear(){
      local=null;instance=null;root.render(null);
    },
    fit,
    dispose(){root.unmount();instance=null;local=null;}
  };
}
