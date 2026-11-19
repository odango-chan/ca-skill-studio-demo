import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {projectWorkspace} from "../site/workspace.mjs";
import {layoutProcedureELK} from "../site/layout.mjs";
import {makeFlowElements,resolveReconnectedRoute,flowBundleSelectionId,FLOW_NODE_SIZE,
  classifyRouteTone,ROUTE_TONE_COLOR,summarizeNodeStages,
  describeProcedureLegend,routeOrigin}
  from "../site/react-flow-projection.mjs";

const sampleRoot=new URL("../site/samples/v1alpha5/",import.meta.url);
const read=name=>readFileSync(new URL(name+"/assurance/procedure.yaml",sampleRoot),"utf8");
const created=projectWorkspace(read("establish-pdu-session"));
const mas=projectWorkspace(read("establish-pdu-session-mas"));
assert.equal(created.state,"READY");
assert.equal(mas.state,"READY");

test("React Flow projects the current CA-SL source graph without mutation",async()=>{
  const graph=await layoutProcedureELK(created.procedure);
  const before=JSON.stringify(created.procedure);
  const flow=makeFlowElements(graph,created.procedure);
  assert.equal(flow.direction,"DOWN");
  assert.equal(flow.nodes.length,(graph.visibleNodes??created.procedure.nodes).length);
  assert.equal(flow.edges.length,graph.bundles.length);
  assert.equal(flow.edges.reduce((n,e)=>n+e.data.bundle.routes.length,0),
    created.procedure.routes.length);
  assert.equal(flow.nodes.find(n=>n.id===created.procedure.start).data.start,true);
  assert.deepEqual(flow.nodes.map(n=>n.id),\n    (graph.visibleNodes??created.procedure.nodes).map(n=>n.id));
  assert.ok(flow.nodes.every(n=>n.draggable===false&&\n    n.connectable===!n.data.terminal&&!n.data.viewOnly));
  assert.ok(flow.edges.every(e=>e.reconnectable===false),
    "existing Route targets stay read-only until a current-source patch contract exists");
  assert.ok(flow.edges.every(e=>e.markerEnd?.type==="arrow"));
  assert.ok(flow.edges.every(e=>e.markerEnd?.width===16&&e.markerEnd.height===16));
  assert.ok(flow.edges.every(e=>e.markerEnd?.markerUnits==="userSpaceOnUse"));
  assert.equal(JSON.stringify(created.procedure),before);
});

test("graph interaction policy is independent of language version metadata",async()=>{
  const graph=await layoutProcedureELK(created.procedure);
  const withoutProfile={...created.procedure,profile:undefined};
  const arbitraryProfile={...created.procedure,profile:"arbitrary-source-metadata"};
  const a=makeFlowElements(graph,withoutProfile);
  const b=makeFlowElements(graph,arbitraryProfile);
  assert.deepEqual(a.nodes.map(n=>n.connectable),b.nodes.map(n=>n.connectable));
  assert.deepEqual(a.nodes.map(n=>n.data.canAddRoute),b.nodes.map(n=>n.data.canAddRoute));
  assert.deepEqual(a.edges.map(e=>e.reconnectable),b.edges.map(e=>e.reconnectable));
  assert.ok(a.nodes.every(n=>n.connectable===!n.data.terminal&&!n.data.viewOnly));
  assert.ok(a.edges.every(e=>!e.reconnectable));
});

test("all current Route ids and Stage origins survive React Flow projection",async()=>{
  const graph=await layoutProcedureELK(created.procedure);
  const flow=makeFlowElements(graph,created.procedure);
  const fromEdges=flow.edges.flatMap(e=>e.data.bundle.routes.map(r=>r.id)).sort();
  const fromSource=created.procedure.routes.map(r=>r.id).sort();
  assert.deepEqual(fromEdges,fromSource);
  for(const edge of flow.edges){
    assert.deepEqual(edge.data.sourceRouteIds,
      edge.data.bundle.routes.map(route=>route.id));
    assert.equal(edge.data.origin,routeOrigin(edge.data.bundle.routeSource));
  }
  assert.ok(flow.edges.some(e=>e.data.origin==="PRE"));
  assert.ok(flow.edges.some(e=>e.data.origin==="OP"));
  assert.ok(flow.edges.some(e=>e.data.origin==="OBS"));
  assert.ok(flow.edges.some(e=>e.data.origin==="POST"));
  assert.equal(routeOrigin("precondition"),"PRE");
  assert.equal(routeOrigin("operation"),"OP");
  assert.equal(routeOrigin("observation"),"OBS");
  assert.equal(routeOrigin("postcondition"),"POST");
  assert.equal(routeOrigin("preconditions.on"),"OTHER");
  assert.equal(routeOrigin("operator.on"),"OTHER");
});

test("selection, labels and direction remain UI-only",async()=>{
  const graph=await layoutProcedureELK(mas.procedure,{direction:"RIGHT"});
  const source=JSON.stringify(mas.procedure);
  const picked=mas.procedure.routes[0];
  const flow=makeFlowElements(graph,mas.procedure,{kind:"route",id:picked.id},true);
  assert.equal(flow.direction,"RIGHT");
  assert.ok(flow.nodes.every(n=>n.sourcePosition==="right"&&n.targetPosition==="left"));
  assert.ok(flow.edges.every(e=>e.data.displayLabel));
  assert.equal(flow.edges.filter(e=>e.selected).length,1);
  assert.equal(flow.edges.find(e=>e.selected).markerEnd.color,"#087e71");
  assert.equal(JSON.stringify(mas.procedure),source);
});

test("ambiguous Route bundles stay selected as bundles without inventing a Route",()=>{
  const routes=[
    {id:"node-a.operation.FAILED",source:"node-a",target:"FAILED",
      routeSource:"operation",outcome:"FAILED"},
    {id:"node-a.operation.DENIED",source:"node-a",target:"FAILED",
      routeSource:"operation",outcome:"DENIED"}
  ];
  const bundle={source:"node-a",target:"FAILED",routeSource:"operation",
    routes,outcomes:["FAILED","DENIED"]};
  const procedure={start:"node-a",nodes:[
    {id:"node-a",operator:"node",value:"operation",children:[],stages:[]},
    {id:"FAILED",operator:"terminal",value:"FAILED",children:[],stages:[]}
  ],routes};
  const graph={direction:"DOWN",visibleNodes:procedure.nodes,visibleRoutes:routes,
    bundles:[bundle],positions:new Map([
      ["node-a",{x:0,y:0}],["FAILED",{x:0,y:160}]
    ]),expandedNodeIds:new Set(),hiddenByNode:new Map()};
  const flow=makeFlowElements(graph,procedure,{
    kind:"bundle",id:flowBundleSelectionId(bundle)
  });
  assert.equal(flow.edges.length,1);
  assert.equal(flow.edges[0].selected,true);
  assert.equal(flow.edges[0].data.bundle.source,"node-a");
  assert.equal(flow.edges[0].data.bundle.target,"FAILED");
  assert.equal(resolveReconnectedRoute(bundle,null),null);
  assert.equal(resolveReconnectedRoute(bundle,routes[1].id).id,routes[1].id);
  assert.equal(resolveReconnectedRoute(bundle,"not-a-route"),null);
});

test("fail-closed graph input refuses missing positions or dangling bundles",async()=>{
  const graph=await layoutProcedureELK(mas.procedure);
  const broken={...graph,positions:new Map(graph.positions)};
  broken.positions.delete(mas.procedure.start);
  assert.throws(()=>makeFlowElements(broken,mas.procedure),/Missing or invalid/);
  const dangling={...graph,bundles:[...graph.bundles,{
    source:"missing",target:"FAILED",routes:[{id:"fake"}],outcomes:["FAILED"]}]};
  assert.throws(()=>makeFlowElements(dangling,mas.procedure),/Unresolved flow edge/);
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

test("ELK endpoints and React Flow per-edge ports coincide",async()=>{
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
        port.side==="bottom"?{x:port.offset,y:FLOW_NODE_SIZE.height}:
        port.side==="left"?{x:0,y:port.offset}:{x:FLOW_NODE_SIZE.width,y:port.offset};
      const global={x:node.position.x+local.x,y:node.position.y+local.y};
      assert.ok(Math.hypot(global.x-starts[k].x,global.y-starts[k].y)<1.2,
        edge.id+" ELK path and handle do not meet");
    }
  }
  assert.ok(anchored>0,"current source graph should use exact per-edge handles");
});

test("source-only Route creation affordance is explicit, selected and never terminal",async()=>{
  const graph=await layoutProcedureELK(mas.procedure);
  const chosen=mas.procedure.nodes.find(n=>n.id===mas.procedure.start);
  assert.ok(chosen);
  const baseline=makeFlowElements(graph,mas.procedure);
  assert.ok(baseline.nodes.every(n=>!n.data.canAddRoute));
  const enabled=makeFlowElements(graph,mas.procedure,
    {kind:"node",id:chosen.id},false,chosen.id);
  assert.equal(enabled.nodes.filter(n=>n.data.canAddRoute).length,1);
  assert.equal(enabled.nodes.find(n=>n.id===chosen.id).data.canAddRoute,true);
  const blocked=makeFlowElements(graph,mas.procedure,
    {kind:"node",id:chosen.id},false,"different-node");
  assert.ok(blocked.nodes.every(n=>!n.data.canAddRoute));
  const canvas=readFileSync(new URL("../site/react-flow-canvas.tsx",import.meta.url),"utf8");
  assert.match(canvas,/onConnect=\{connection=>callbacks\.onCreateRoute\(connection\)\}/);
  assert.match(canvas,/id="new-route-out"/);
  assert.match(canvas,/data\.canAddRoute/);
  assert.match(canvas,/title="连接到这个 Node"/);
  assert.ok(enabled.edges.every(e=>!e.id.startsWith("new-route-")));
});

test("visual START is separate from the business operator without changing Source",async()=>{
  const graph=await layoutProcedureELK(created.procedure);
  const before=JSON.stringify(created.procedure);
  const flow=makeFlowElements(graph,created.procedure);
  const start=flow.nodes.find(node=>node.id===created.procedure.start);
  assert.ok(start);
  assert.equal(start.data.start,true);
  assert.equal(start.data.operator,created.procedure.nodes.find(
    node=>node.id===created.procedure.start).operator);
  assert.equal(flow.nodes.length,(graph.visibleNodes??created.procedure.nodes).length);
  assert.equal(JSON.stringify(created.procedure),before);
});

test("current Stage legend and badges are derived only from current stage declarations",()=>{
  const legend=describeProcedureLegend(created.procedure);
  assert.equal(legend.nodeCount,created.procedure.nodes.length);
  assert.ok(legend.preNodes>0);
  assert.ok(legend.postNodes>0);
  assert.ok(legend.stepKinds.some(item=>item.kind==="TOOL"));
  assert.ok(legend.stepKinds.some(item=>item.kind==="OBSERVATION"));
  const node=created.procedure.nodes.find(item=>item.stages?.length);
  assert.ok(node);
  assert.deepEqual(summarizeNodeStages({phases:[{name:"preconditions",steps:[]}]}),[]);
  assert.deepEqual(summarizeNodeStages(node).map(item=>item.name),node.stages.map(item=>item.name));
});

test("Route outcome colors never turn mixed success/failure green",()=>{
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
  for(const edge of flow.edges){
    assert.equal(edge.markerEnd.color,ROUTE_TONE_COLOR[edge.data.tone]);
    assert.equal(edge.data.tone,classifyRouteTone(edge.data.bundle.outcomes));
  }
});
