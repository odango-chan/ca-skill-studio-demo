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
  assert.equal(flow.edges.length,39);
  assert.equal(flow.edges.reduce((n,e)=>n+e.data.bundle.routes.length,0),65);
  assert.equal(flow.nodes.find(n=>n.id===created.procedure.start).data.start,true);
  assert.equal(new Set(flow.nodes.map(n=>n.id)).size,flow.nodes.length);
  assert.equal(new Set(flow.edges.map(e=>e.id)).size,flow.edges.length);
  assert.deepEqual(
    flow.nodes.map(n=>n.id),created.procedure.nodes.map(n=>n.id));
  assert.ok(flow.nodes.every(n=>n.draggable===false));
  assert.ok(flow.edges.every(e=>e.reconnectable===true));
  assert.ok(flow.edges.every(e=>e.markerEnd?.type==="arrowclosed"));
  assert.ok(flow.edges.every(e=>e.markerEnd?.width>=20));
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
