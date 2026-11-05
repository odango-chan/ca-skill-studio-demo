import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {projectWorkspace} from "../site/workspace.mjs";
import {layoutProcedureELK} from "../site/layout.mjs";
import {makeFlowElements,resolveReconnectedRoute,FLOW_NODE_SIZE,
  classifyRouteTone,ROUTE_TONE_COLOR,summarizeNodePhases,
  describeProcedureLegend,routeOrigin}
  from "../site/react-flow-projection.mjs";

const read=name=>readFileSync(
  new URL("../site/samples/"+name+".procedure.yaml",import.meta.url),"utf8");
const created=projectWorkspace(read("establish-pdu-session"));
const ensure=projectWorkspace(read("ensure-pdu-session"));
assert.equal(created.state,"READY");
assert.equal(ensure.state,"READY");

test("D1 projects the real CreatedSession 17-node / 65-Outcome graph unchanged",async()=>{
  const graph=await layoutProcedureELK(created.procedure);
  const before=JSON.stringify(created.procedure);
  const flow=makeFlowElements(graph,created.procedure);
  assert.equal(flow.direction,"DOWN");
  assert.equal(flow.nodes.length,17);
  assert.equal(flow.edges.length,48);
  assert.equal(flow.edges.reduce((n,e)=>n+e.data.bundle.routes.length,0),65);
  assert.equal(flow.nodes.find(n=>n.id===created.procedure.start).data.start,true);
  assert.equal(new Set(flow.nodes.map(n=>n.id)).size,flow.nodes.length);
  assert.equal(new Set(flow.edges.map(e=>e.id)).size,flow.edges.length);
  assert.deepEqual(
    flow.nodes.map(n=>n.id),created.procedure.nodes.map(n=>n.id));
  assert.ok(flow.nodes.every(n=>n.draggable===false));
  assert.ok(flow.edges.every(e=>e.reconnectable===true));
  assert.ok(flow.edges.every(e=>e.markerEnd?.type==="arrow"));
  assert.ok(flow.edges.every(e=>e.markerEnd?.width===16&&e.markerEnd.height===16));
  assert.ok(flow.edges.every(e=>e.markerEnd?.markerUnits==="userSpaceOnUse"));
  assert.equal(JSON.stringify(created.procedure),before);
});
test("routeSource and all exact Outcome ids survive React Flow projection",async()=>{
  const graph=await layoutProcedureELK(created.procedure);
  const flow=makeFlowElements(graph,created.procedure);
  const fromEdges=flow.edges.flatMap(e=>e.data.bundle.routes.map(r=>r.id)).sort();
  const fromSource=created.procedure.routes.map(r=>r.id).sort();
  assert.deepEqual(fromEdges,fromSource);
  assert.ok(flow.edges.some(e=>e.data.bundle.routeSource==="postconditions.on"));
  assert.ok(flow.edges.some(e=>e.data.bundle.routeSource==="operator.on"));
});
test("selection, labels and direction remain UI-only",async()=>{
  const graph=await layoutProcedureELK(ensure.procedure,{direction:"RIGHT"});
  const source=JSON.stringify(ensure.procedure);
  const picked=ensure.procedure.routes[0];
  const flow=makeFlowElements(graph,ensure.procedure,{kind:"route",id:picked.id},true);
  assert.equal(flow.direction,"RIGHT");
  assert.ok(flow.nodes.every(n=>n.sourcePosition==="right"&&n.targetPosition==="left"));
  assert.ok(flow.edges.every(e=>e.data.displayLabel));
  assert.equal(flow.edges.filter(e=>e.selected).length,1);
  assert.equal(flow.edges.find(e=>e.selected).markerEnd.color,"#087e71");
  assert.equal(JSON.stringify(ensure.procedure),source);
});
test("multi-outcome edge cannot rewire an arbitrary Outcome without selection",async()=>{
  const graph=await layoutProcedureELK(created.procedure);
  const bundle=graph.bundles.find(b=>b.routes.length>1);
  assert.ok(bundle);
  assert.equal(resolveReconnectedRoute(bundle,null),null);
  const id=bundle.routes[1].id;
  assert.equal(resolveReconnectedRoute(bundle,id).id,id);
  assert.equal(resolveReconnectedRoute(bundle,"not-a-route"),null);
  assert.equal(resolveReconnectedRoute({routes:[bundle.routes[0]]},null),bundle.routes[0]);
});
test("fail-closed graph input refuses missing positions or dangling bundles",async()=>{
  const graph=await layoutProcedureELK(ensure.procedure);
  const original=graph.positions;
  const broken={...graph,positions:new Map(original)};
  broken.positions.delete(ensure.procedure.start);
  assert.throws(()=>makeFlowElements(broken,ensure.procedure),/Missing or invalid/);
  const dangling={...graph,bundles:[...graph.bundles,{
    source:"missing",target:"done",routes:[{id:"fake"}],outcomes:["PASS"]}]};
  assert.throws(()=>makeFlowElements(dangling,ensure.procedure),/Unresolved flow edge/);
});
test("D1 keeps SVG source logic outside React Flow and retains Typed Patch authority",()=>{
  const app=readFileSync(new URL("../site/app.mjs",import.meta.url),"utf8");
  const html=readFileSync(new URL("../site/index.html",import.meta.url),"utf8");
  const canvas=readFileSync(new URL("../site/react-flow-canvas.tsx",import.meta.url),"utf8");
  assert.match(app,/mountProcedureCanvas\(\$\("reactFlowRoot"\)/);
  assert.match(html,/id="reactFlowRoot"/);
  assert.doesNotMatch(html,/id="world"|id="canvas"/);
  assert.match(canvas,/onReconnect=/);
  assert.match(app,/previewVisualRouteEdit\(currentRouteEditContext\(route.id\),targetId\)/);
  assert.match(app,/showPreview\(/);
  assert.match(app,/history\.record\(source\.value\)/);
  assert.match(app,/projectWorkspace\(/);
  assert.match(canvas,/nodesDraggable=\{false\}/);
  assert.match(canvas,/deleteKeyCode=\{null\}/);
  assert.deepEqual(FLOW_NODE_SIZE,{width:238,height:80});
});

test("React Flow edges keep screen-space stroke width at default fit zoom",()=>{
  const css=readFileSync(new URL("../site/light.css",import.meta.url),"utf8");
  const old=readFileSync(new URL("../site/studio.css",import.meta.url),"utf8");
  const jsx=readFileSync(new URL("../site/react-flow-canvas.tsx",import.meta.url),"utf8");
  assert.match(css,/\.procedure-flow \.react-flow__edge-path\.designer-edge\{/);
  assert.match(css,/vector-effect:non-scaling-stroke/);
  assert.match(css,/\.procedure-flow \.react-flow__edge-interaction\{/);
  assert.match(css,/\.procedure-flow \.react-flow__edges\{[^}]*overflow:visible/s);
  assert.doesNotMatch(css,/\.procedure-flow \.react-flow__edges\{[^}]*pointer-events:none/s);
  assert.doesNotMatch(old,/\.graph-pane svg\{/);
  assert.match(jsx,/markerEnd=\{props\.markerEnd\}/);
  assert.match(jsx,/interactionWidth=\{16\}/);
});

test("ELK endpoints and React Flow per-edge ports coincide, not just their center handles",async()=>{
  const graph=await layoutProcedureELK(created.procedure);
  const flow=makeFlowElements(graph,created.procedure);
  const nodes=new Map(flow.nodes.map(n=>[n.id,n]));
  let anchored=0;
  for(const edge of flow.edges){
    const bundle=edge.data.bundle;
    if(!bundle.path||!bundle.anchors){
      assert.equal(edge.sourceHandle,"out");
      assert.equal(edge.targetHandle,"in");
      continue;
    }
    anchored++;
    const pathPoints=[...bundle.path.matchAll(/[ML]\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)]
      .map(m=>({x:Number(m[1]),y:Number(m[2])}));
    const starts=[pathPoints[0],pathPoints.at(-1)];
    const nodesFor=[nodes.get(edge.source),nodes.get(edge.target)];
    const portsFor=[edge.sourceHandle,edge.targetHandle];
    for(let k=0;k<2;k++){
      const node=nodesFor[k];
      const port=node.data.ports.find(p=>p.id===portsFor[k]);
      assert.ok(port,edge.id+" missing "+(k?"target":"source")+" handle");
      const local=port.side==="top"?{x:port.offset,y:0}:
        port.side==="bottom"?{x:port.offset,y:80}:
        port.side==="left"?{x:0,y:port.offset}:{x:238,y:port.offset};
      const global={x:node.position.x+local.x,y:node.position.y+local.y};
      assert.ok(Math.hypot(global.x-starts[k].x,global.y-starts[k].y)<1.2,
        edge.id+" ELK path and handle do not meet");
    }
  }
  assert.equal(anchored,48,"all CreatedSession ELK routes require exact handles");
  assert.equal(flow.edges.reduce((sum,e)=>sum+e.data.bundle.routes.length,0),65);
});
test("React Flow uses its built-in thin open arrow, not a second hand-drawn arrow",()=>{
  const canvas=readFileSync(new URL("../site/react-flow-canvas.tsx",import.meta.url),"utf8");
  const css=readFileSync(new URL("../site/light.css",import.meta.url),"utf8");
  assert.match(canvas,/useUpdateNodeInternals/);
  assert.match(canvas,/ports\.map\(port=><Handle/);
  assert.match(canvas,/style=\{portStyle\(port\)\}/);
  assert.match(canvas,/function portStyle\(port\)/);
  assert.match(css,/--port-border-left:4px/);
  assert.match(css,/--port-border-top:2px/);
  assert.match(canvas,/markerEnd=\{props\.markerEnd\}/);
  assert.match(css,/\.procedure-flow \.designer-port-elk\{/);
  assert.match(css,/stroke-width:2\.1px/);
});


test("D3-A3 source-only creation affordance is explicit, selected and never terminal",async()=>{
  const graph=await layoutProcedureELK(ensure.procedure);
  const chosen=ensure.procedure.nodes.find(n=>n.id===ensure.procedure.start);
  assert.ok(chosen&&chosen.operator!=="terminal");
  const baseline=makeFlowElements(graph,ensure.procedure);
  assert.ok(baseline.nodes.every(n=>!n.data.canAddRoute));
  const enabled=makeFlowElements(graph,ensure.procedure,
    {kind:"node",id:chosen.id},false,chosen.id);
  assert.equal(enabled.nodes.filter(n=>n.data.canAddRoute).length,1);
  assert.equal(enabled.nodes.find(n=>n.id===chosen.id).data.canAddRoute,true);
  const blocked=makeFlowElements(graph,ensure.procedure,
    {kind:"node",id:chosen.id},false,"done");
  assert.ok(blocked.nodes.every(n=>!n.data.canAddRoute));
  const canvas=readFileSync(new URL("../site/react-flow-canvas.tsx",import.meta.url),"utf8");
  assert.match(canvas,/onConnect=\{connection=>callbacks\.onCreateRoute\(connection\)\}/);
  assert.match(canvas,/id="new-route-out"/);
  assert.match(canvas,/data\.canAddRoute/);
  assert.match(canvas,/title="连接到这个 Node"/);
  assert.ok(enabled.edges.every(e=>!e.id.startsWith("new-route-")));
});


test("Procedure toolbar keeps full, horizontal and vertical fit controls separate from zoom",()=>{
  const html=readFileSync(new URL("../site/index.html",import.meta.url),"utf8");
  const canvas=readFileSync(new URL("../site/react-flow-canvas.tsx",import.meta.url),"utf8");
  const app=readFileSync(new URL("../site/app.mjs",import.meta.url),"utf8");
  const icons=readFileSync(new URL("../site/icons.mjs",import.meta.url),"utf8");
  const css=readFileSync(new URL("../site/light.css",import.meta.url),"utf8");
  for(const id of ["fit","fitWidth","fitHeight","zoomIn","zoomOut"])
    assert.ok(html.includes('id="'+id+'"'),id);
  assert.match(canvas,/axisFitViewport/);
  assert.match(canvas,/fitAxis\(axis\)/);
  assert.match(canvas,/instance\?\.setViewport\(viewport,\{duration:150\}\)/);
  assert.match(app,/\$\("fitWidth"\)\.addEventListener\("click"/);
  assert.match(app,/\$\("fitHeight"\)\.addEventListener\("click"/);
  assert.match(app,/let fitMode = "all"/);
  assert.match(css,/\.compact-toolbar \.toolbar-axis-fit/);
  assert.match(icons,/"fit-width":\[/);
  assert.match(icons,/"fit-height":\[/);
});

test("visual START is separate from the business operator, without changing Source or Route counts",async()=>{
  const graph=await layoutProcedureELK(created.procedure);
  const before=JSON.stringify(created.procedure);
  for(const direction of ["DOWN","RIGHT"]){
    const layout=direction==="DOWN"?graph:
      await layoutProcedureELK(created.procedure,{direction});
    const flow=makeFlowElements(layout,created.procedure);
    const start=flow.nodes.find(node=>node.id===created.procedure.start);
    assert.ok(start);
    assert.equal(start.data.start,true);
    assert.equal(start.data.operator,"call");
    assert.equal(flow.nodes.length,created.procedure.nodes.length);
    assert.equal(flow.edges.length,layout.bundles.length);
  }
  const jsx=readFileSync(new URL("../site/react-flow-canvas.tsx",import.meta.url),"utf8");
  const css=readFileSync(new URL("../site/light.css",import.meta.url),"utf8");
  assert.doesNotMatch(jsx,/ · START/);
  assert.match(css,/\.designer-node\.is-start::before\{/);
  assert.match(css,/\.designer-node\.is-start\.is-horizontal::before\{/);
  assert.equal(JSON.stringify(created.procedure),before);
});

test("Route outcome colors never turn mixed success/failure green",async()=>{
  assert.equal(classifyRouteTone(["PASS"]),"success");
  assert.equal(classifyRouteTone(["SUCCEEDED","SUCCESS"]),"success");
  assert.equal(classifyRouteTone(["FAIL"]),"failure");
  assert.equal(classifyRouteTone(["ERROR","FAILED"]),"failure");
  assert.equal(classifyRouteTone(["UNKNOWN"]),"uncertain");
  assert.equal(classifyRouteTone(["TIMEOUT"]),"uncertain");
  assert.equal(classifyRouteTone(["PASS","FAIL"]),"mixed");
  assert.equal(classifyRouteTone(["PASS","OTHER"]),"mixed");
  assert.equal(classifyRouteTone(["OTHER"]),"neutral");
  assert.equal(classifyRouteTone([]),"neutral");
  const graph=await layoutProcedureELK(created.procedure);
  const flow=makeFlowElements(graph,created.procedure);
  assert.equal(flow.edges.length,graph.bundles.length);
  for(const edge of flow.edges){
    assert.equal(edge.markerEnd.color,ROUTE_TONE_COLOR[edge.data.tone]);
    assert.equal(edge.data.tone,classifyRouteTone(edge.data.bundle.outcomes));
  }
});

test("legend dynamically separates Node operators from Phase Step operators",()=>{
  const graph=describeProcedureLegend(created.procedure);
  assert.deepEqual(Object.fromEntries(graph.nodeKinds.map(x=>[x.kind,x.count])),{
    CALL:4,PROCEDURE:6,RECONCILE:3,TERMINAL:4
  });
  assert.deepEqual(Object.fromEntries(graph.stepKinds.map(x=>[x.kind,x.count])),{
    VERIFY:14,SCRIPT:1,CALL:6
  });
  assert.equal(graph.nodeCount,17);
  assert.equal(graph.preNodes,3);
  assert.equal(graph.postNodes,4);
  assert.equal(graph.nodeKinds.some(x=>x.kind==="TOOL"),false);
  assert.equal(graph.stepKinds.some(x=>x.kind==="TOOL"),false);
  const child=created.procedures.get("await-initial-n4-session-establishment");
  assert.ok(child);
  const childLegend=describeProcedureLegend(child);
  assert.equal(childLegend.preNodes,0);
  assert.equal(childLegend.postNodes,1);
  assert.deepEqual(childLegend.stepKinds,[{kind:"VERIFY",count:1}]);
  // A filtered graph must describe only the visible scope, not claim all 17.
  assert.equal(describeProcedureLegend(created.procedure,created.procedure.nodes.slice(0,1)).nodeCount,1);
});

test("PRE/POST badges come only from existing Phase Steps, without new graph Nodes",async()=>{
  const graph=await layoutProcedureELK(created.procedure);
  const before=JSON.stringify(created.procedure);
  const flow=makeFlowElements(graph,created.procedure);
  assert.equal(flow.nodes.length,17);
  assert.equal(flow.edges.length,48);
  const subscribe=flow.nodes.find(n=>n.id==="nudm-sdm-subscribe");
  assert.ok(subscribe);
  assert.deepEqual(subscribe.data.phaseBadges.map(x=>[x.label,x.count]),[
    ["PRE",5],["POST",1]
  ]);
  assert.deepEqual(Object.fromEntries(subscribe.data.phaseBadges[0].operators.map(x=>[x.kind,x.count])),{
    SCRIPT:1,CALL:1,VERIFY:3
  });
  assert.deepEqual(summarizeNodePhases({phases:[]}),[]);
  const terminal=flow.nodes.find(x=>x.data.operator==="terminal");
  assert.deepEqual(terminal.data.phaseBadges,[]);
  assert.equal(JSON.stringify(created.procedure),before);
});

test("route origin and outcome color are orthogonal; no Phase source is hidden",async()=>{
  assert.equal(routeOrigin("preconditions.on"),"PRE");
  assert.equal(routeOrigin("operator.on"),"OP");
  assert.equal(routeOrigin("postconditions.on"),"POST");
  assert.equal(routeOrigin("unknown.on"),"OTHER");
  const graph=await layoutProcedureELK(created.procedure);
  const flow=makeFlowElements(graph,created.procedure);
  assert.ok(flow.edges.some(x=>x.data.origin==="PRE"));
  assert.ok(flow.edges.some(x=>x.data.origin==="POST"));
  assert.ok(flow.edges.some(x=>x.data.origin==="OP"));
  for(const edge of flow.edges){
    assert.equal(edge.data.label.startsWith(edge.data.origin+" · "),true);
    assert.equal(edge.data.origin,routeOrigin(edge.data.bundle.routeSource));
    if(edge.data.origin!=="OP")assert.equal(edge.data.displayLabel,true);
    assert.equal(edge.markerEnd.color,ROUTE_TONE_COLOR[edge.data.tone]);
  }
  // A neutral operator Outcome remains hidden by default, not misrepresented as PASS.
  assert.equal(flow.edges.some(x=>x.data.origin==="OP"&&
    x.data.tone==="neutral"&&!x.data.displayLabel),true);
});

test("graph legend is floating and contextual; Node types differ from Step types",()=>{
  const html=readFileSync(new URL("../site/index.html",import.meta.url),"utf8");
  const css=readFileSync(new URL("../site/light.css",import.meta.url),"utf8");
  const jsx=readFileSync(new URL("../site/react-flow-canvas.tsx",import.meta.url),"utf8");
  const app=readFileSync(new URL("../site/app.mjs",import.meta.url),"utf8");
  assert.match(html,/<details id="graphLegend" class="graph-legend"/);
  for(const id of ["graphLegendNodeTypes","graphLegendStepTypes","graphLegendScope"])
    assert.ok(html.includes('id="'+id+'"'));
  assert.doesNotMatch(html,/<code>TOOL<\/code>/);
  assert.match(app,/describeProcedureLegend\(lastGood,visible\)/);
  assert.match(app,/function renderGraphLegend\(\)/);
  for(const origin of ["PRE","OP","POST"])
    assert.ok(html.includes("graph-legend-origin origin-"+origin));
  for(const tone of ["success","failure","uncertain","neutral"])
    assert.ok(html.includes("graph-legend-line tone-"+tone),tone);
  assert.match(css,/\.graph-legend\{[^}]*position:absolute/s);
  assert.match(css,/designer-node\.has-phases/);
  assert.match(css,/designer-edge\.origin-PRE/);
  assert.match(css,/designer-edge\.origin-POST/);
  assert.match(jsx,/designer-phase-badge phase-/);
  assert.match(jsx,/designer-edge tone-/);
  assert.match(jsx,/designer-route-label tone-/);
});
