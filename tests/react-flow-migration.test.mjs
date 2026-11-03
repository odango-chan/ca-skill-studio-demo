import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {projectWorkspace} from "../site/workspace.mjs";
import {layoutProcedureELK} from "../site/layout.mjs";
import {makeFlowElements,resolveReconnectedRoute,FLOW_NODE_SIZE}
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
  assert.ok(flow.edges.every(e=>e.markerEnd?.width<=13));
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
  assert.match(canvas,/style=\{port\.side==="top"/);
  assert.match(canvas,/markerEnd=\{props\.markerEnd\}/);
  assert.match(css,/\.procedure-flow \.designer-port-elk\{/);
  assert.match(css,/stroke-width:2\.1px/);
});
