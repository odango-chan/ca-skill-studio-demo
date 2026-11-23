import React,{useEffect,useMemo,useState} from "react";
import {createRoot} from "react-dom/client";
import {
  ReactFlow,Handle,Position,Background,Controls,MarkerType
} from "@xyflow/react";
import {layoutProcedureELK} from "../../../../site/layout.mjs";
import {makeFlowElements} from "../../../../site/react-flow-projection.mjs";
import "@xyflow/react/dist/style.css";
import "./ai-flow-compare.css";

/**
 * Presentation-only React Flow adapter. Semantic graph identities are produced
 * by the SAME CA-SL v1alpha5 analyzer as the real Procedure Preview; geometry
 * is the SAME ELK layout and React Flow element projection as the preview.
 * No runtime tools, Source writer, reconnect or node creation are exposed.
 */
function focusChange(detail) {
  window.dispatchEvent(new CustomEvent("studio-ai-flow-focus",{detail}));
}
const HandleCard=({data})=>{
  const meta=data?.review??{};
  return <div className={"ai-flow-node status-"+(meta.status??"unchanged")+
    (meta.viewOnly?" is-terminal":"")}
    title={String(data.id)+" · "+(meta.status??"unchanged")+" · Source L"+(meta.line??"?")}>
    <Handle type="target" id="in" position={Position.Top}
      style={{opacity:0,pointerEvents:"none"}} isConnectable={false}/>
    <div className="ai-flow-node-kind">{meta.viewOnly?"TERMINAL":data.operator||"NODE"}
      {meta.status!=="unchanged"&&<strong className="ai-flow-delta">{meta.status}</strong>}
    </div>
    <strong className="ai-flow-node-id">{data.id}</strong>
    {!meta.viewOnly&&<span className="ai-flow-node-stages">{(data.phaseBadges??[])
      .map(x=>x.label).join(" · ")||data.value}</span>}
    <Handle type="source" id="out" position={Position.Bottom}
      style={{opacity:0,pointerEvents:"none"}} isConnectable={false}/>
  </div>;
};
const nodeTypes={reviewNode:HandleCard};

function GraphScene({procedure,layout,change,side,filterChanged}) {
  const [instance,setInstance]=useState(null);
  const elements=useMemo(()=>makeFlowElements(layout,procedure,null,true,null),
    [procedure,layout]);
  const nodeChanges=new Map(change.nodes.map(x=>[x.id,x]));
  const routeChanges=new Map(change.routes.map(x=>[x.id,x]));
  const affected=new Set(change.routes.filter(x=>x.status!=="unchanged")
    .flatMap(x=>[x.source,x.baseTarget,x.candidateTarget]).filter(Boolean));
  const nodes=elements.nodes.map(n=>{
    const d=nodeChanges.get(n.id);
    const status=d?.status!=="unchanged"?d?.status:
      affected.has(n.id)?"affected":"unchanged";
    const node=procedure.nodes.find(x=>x.id===n.id);
    return {...n,type:"reviewNode",
      connectable:false,
      data:{...n.data,review:{status,viewOnly:node?.viewOnly,line:node?.line}},
      style:filterChanged&&!affected.has(n.id)&&d?.status==="unchanged"
        ?{opacity:.28}:undefined,
    };
  });
  const edges=elements.edges.map(edge=>{
    const matches=(edge.data?.bundle?.routes??[])
      .map(route=>routeChanges.get(JSON.stringify([
        route.source,route.routeSource,route.outcome
      ]))).filter(Boolean);
    const changed=matches.filter(x=>x.status!=="unchanged");
    const status=changed.length?changed[0].status:"unchanged";
    const statusColor=changed.length
      ?(status==="removed"?"#bd6059":status==="added"?"#158a71":"#c4882d")
      :"#7991aa";
    return {...edge,
      type:"smoothstep",sourceHandle:"out",targetHandle:"in",
      reconnectable:false,
      label:edge.data?.label??"",
      labelStyle:{fontSize:9,fill:"var(--vscode-foreground,#30445a)"},
      labelBgStyle:{fill:"var(--vscode-editorWidget-background,#fff)",fillOpacity:.87},
      style:{stroke:statusColor,strokeWidth:changed.length?2.9:1.2,
        opacity:filterChanged&&!changed.length?.22:.92},
      markerEnd:{type:MarkerType.Arrow,color:statusColor,width:16,height:16},
      data:{...edge.data,reviewMatches:matches,status},
    };
  });
  useEffect(()=>{
    if(!instance)return;
    const raf=requestAnimationFrame(()=>instance.fitView({
      padding:.16,minZoom:.07,maxZoom:1.1,duration:0
    }));
    return ()=>cancelAnimationFrame(raf);
  },[instance,layout,filterChanged]);

  const onNodeClick=(_event,node)=>{
    const match=nodeChanges.get(node.id);
    focusChange({
      kind:"node",nodeId:node.id,
      groupIds:match?.groupIds??[],
      baseLine:match?.baseLine??null,candidateLine:match?.candidateLine??null,
      side
    });
  };
  const onEdgeClick=(_event,edge)=>{
    const relevant=edge.data?.reviewMatches??[];
    const changed=relevant.filter(x=>x.status!=="unchanged");
    const selection=changed[0]??relevant[0];
    if(!selection)return;
    focusChange({
      kind:"route",nodeId:selection.source,
      outcome:selection.outcome,routeSource:selection.routeSource,
      groupIds:selection.groupIds??[],
      baseLine:selection.baseLine??null,
      candidateLine:selection.candidateLine??null,side
    });
  };
  return <ReactFlow nodes={nodes} edges={edges}
    nodeTypes={nodeTypes}
    onInit={setInstance} onNodeClick={onNodeClick} onEdgeClick={onEdgeClick}
    nodesDraggable={false} nodesConnectable={false} edgesReconnectable={false}
    elementsSelectable={true} deleteKeyCode={null}
    panActivationKeyCode={null} panOnDrag
    zoomOnScroll zoomOnPinch zoomOnDoubleClick={false}
    nodesFocusable edgesFocusable fitView
    minZoom={.07} maxZoom={1.8} attributionPosition="bottom-right">
    <Background gap={20} size={.7}/>
    <Controls showInteractive={false} showZoom showFitView/>
  </ReactFlow>;
}

function Compare({data,layouts}) {
  const [changedOnly,setChangedOnly]=useState(false);
  const {before,after,change}=data;
  return <div className="ai-flow-compare">
    <div className="ai-flow-compare-tools">
      <span>原流程 {change.counts.baseNodes} Nodes / {change.counts.baseRoutes} Routes</span>
      <span>候选流程 {change.counts.candidateNodes} Nodes / {change.counts.candidateRoutes} Routes</span>
      <label><input type="checkbox" checked={changedOnly}
        onChange={e=>setChangedOnly(e.target.checked)}/>淡化未受影响的节点和路由</label>
      <span className="ai-flow-not-qualified">SOURCE PROJECTION · NOT QUALIFIED</span>
    </div>
    <div className="ai-flow-compare-panes" data-ai-flow-ready="true"
      data-ai-flow-before-nodes={change.counts.baseNodes}
      data-ai-flow-after-nodes={change.counts.candidateNodes}
      data-ai-flow-before-routes={change.counts.baseRoutes}
      data-ai-flow-after-routes={change.counts.candidateRoutes}
      data-ai-flow-changed-routes={change.counts.changedRoutes}>
      <div className="ai-flow-panel">
        <strong>当前 Source</strong>
        <div className="ai-flow-canvas">
          <GraphScene procedure={before} layout={layouts[0]}
            change={change} side="before" filterChanged={changedOnly}/>
        </div>
      </div>
      <div className="ai-flow-panel">
        <strong>候选 Source · 所选 Change Set</strong>
        <div className="ai-flow-canvas">
          <GraphScene procedure={after} layout={layouts[1]}
            change={change} side="after" filterChanged={changedOnly}/>
        </div>
      </div>
    </div>
  </div>;
}

const host=document.getElementById("flowCompareCanvas");
if(host) {
  const root=createRoot(host);
  let revision=0,disposed=false;
  function clear(){
    revision++;
    if(disposed)return;
    root.render(null);
    host.removeAttribute("data-ai-flow-ready");
  }
  async function render(data){
    const current=++revision;
    if(!data?.available||data.languageTarget!=="connectionagent.io/v1alpha5"||
       !data.before||!data.after||!data.change) {
      clear();return;
    }
    try {
      const layouts=await Promise.all([
        layoutProcedureELK(data.before,{direction:"DOWN"}),
        layoutProcedureELK(data.after,{direction:"DOWN"})
      ]);
      if(disposed||current!==revision)return;
      if(layouts[0].visibleRoutes.length!==data.before.routes.length||
         layouts[1].visibleRoutes.length!==data.after.routes.length)
        throw new Error("ELK dropped source route entries");
      root.render(<Compare key={current} data={data} layouts={layouts}/>);
      host.dataset.aiFlowReady="true";
      window.dispatchEvent(new CustomEvent("studio-ai-flow-rendered",{
        detail:{nodesBefore:data.change.counts.baseNodes,
          nodesAfter:data.change.counts.candidateNodes,
          routesBefore:data.change.counts.baseRoutes,
          routesAfter:data.change.counts.candidateRoutes,
          changedRoutes:data.change.counts.changedRoutes}
      }));
    } catch {
      if(disposed||current!==revision)return;
      clear();
      host.textContent="流程图投影或布局不可用；请使用下方的语义变化摘要与 YAML Diff。";
    }
  }
  window.skillStudioAiFlowCompare=Object.freeze({render,clear});
  window.addEventListener("pagehide",()=>{disposed=true;revision++;root.unmount();},{once:true});
}
