import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {projectWorkspace} from "../site/workspace.mjs";
import {layoutProcedureELK} from "../site/layout.mjs";
import {makeFlowElements} from "../site/react-flow-projection.mjs";
import {graphLegendSummary,nodePhaseChips,routeOrigin}
  from "../site/graph-phase-view.mjs";

const text=readFileSync(new URL(
  "../site/samples/packages/establish-pdu-session/assurance/procedure.yaml",
  import.meta.url),"utf8");
const projected=projectWorkspace(text);
assert.equal(projected.state,"READY");
const root=projected.procedure;

test("current root legend lists only actual business kinds and independent Phase Steps",()=>{
  const snapshot=JSON.stringify(root);
  const legend=graphLegendSummary(root);
  assert.equal(legend.nodeCount,17);
  assert.deepEqual(legend.nodeKinds.map(x=>[x.kind,x.count]),[
    ["call",4],["procedure",6],["reconcile",3],["terminal",4]
  ]);
  assert.deepEqual(legend.stepKinds.map(x=>[x.kind,x.count]),[
    ["call",6],["script",1],["verify",14]
  ]);
  assert.equal(legend.stepCount,21);
  assert.equal(legend.routeCount,65);
  assert.deepEqual(legend.origins.map(x=>x.source),[
    "preconditions.on","operator.on","postconditions.on"
  ]);
  assert.equal(legend.nodeKinds.some(x=>x.kind==="tool"),false);
  assert.equal(legend.stepKinds.some(x=>x.kind==="tool"),false);
  assert.equal(JSON.stringify(root),snapshot);
});

test("PRE and POST badges reflect only phases and step counts present in YAML",()=>{
  const node=id=>root.nodes.find(item=>item.id===id);
  const subscribe=nodePhaseChips(node("nudm-sdm-subscribe"));
  assert.deepEqual(subscribe.map(x=>[x.tag,x.stepCount]),[["PRE",5],["POST",1]]);
  assert.deepEqual(subscribe[0].kinds.map(x=>[x.kind,x.count]),[
    ["call",1],["script",1],["verify",3]
  ]);
  assert.ok(subscribe[0].title.includes("SCRIPT ×1"));
  assert.deepEqual(nodePhaseChips(node("nudm-sdm-get"))
    .map(x=>[x.tag,x.stepCount]),[["POST",1]]);
  assert.deepEqual(nodePhaseChips(node("n4-session-establishment")),[]);
  assert.deepEqual(nodePhaseChips(null),[]);
});

test("child Procedure starts have POST without fabricating a PRE or TOOL",()=>{
  const child=projected.procedures.get("await-initial-n4-session-establishment");
  assert.ok(child);
  const legend=graphLegendSummary(child);
  assert.equal(legend.nodeCount,4);
  assert.deepEqual(legend.nodeKinds.map(x=>[x.kind,x.count]),[
    ["call",1],["terminal",3]
  ]);
  assert.deepEqual(legend.stepKinds.map(x=>[x.kind,x.count]),[
    ["verify",1]
  ]);
  assert.ok(child.nodes.every(n=>!nodePhaseChips(n).some(chip=>chip.tag==="PRE")));
  assert.deepEqual(nodePhaseChips(child.nodes.find(n=>n.operator==="call"))
    .map(x=>x.tag),["POST"]);
});

test("visible-neighbor legend never counts hidden Nodes, steps or Routes",()=>{
  const visible=root.nodes.filter(n=>["nudm-sdm-get","nudm-sdm-subscribe"].includes(n.id));
  const routes=root.routes.filter(r=>visible.some(n=>n.id===r.source)&&
    visible.some(n=>n.id===r.target));
  const partial=graphLegendSummary(root,visible,routes);
  assert.equal(partial.nodeCount,2);
  assert.deepEqual(partial.nodeKinds.map(x=>[x.kind,x.count]),[["call",2]]);
  assert.deepEqual(partial.stepKinds.map(x=>[x.kind,x.count]),[
    ["call",1],["script",1],["verify",4]
  ]);
  assert.equal(partial.routeCount,routes.length);
  assert.ok(partial.routeCount<root.routes.length);
  assert.deepEqual(graphLegendSummary(null).nodeKinds,[]);
});

test("explicit TOOL is represented only when actually present in a Node or Phase Step",()=>{
  const fake={nodes:[
    {id:"x",operator:"tool",phases:[{name:"preconditions",steps:[{operator:"tool"}],routeCount:0}]},
    {id:"y",operator:"call",phases:[]}
  ],routes:[]};
  const legend=graphLegendSummary(fake);
  assert.deepEqual(legend.nodeKinds.map(x=>x.kind),["call","tool"]);
  assert.deepEqual(legend.stepKinds.map(x=>x.kind),["tool"]);
  const chips=nodePhaseChips(fake.nodes[0]);
  assert.deepEqual(chips.map(x=>[x.tag,x.stepCount]),[["PRE",1]]);
  assert.deepEqual(nodePhaseChips({phases:[{name:"postconditions",steps:[],routeCount:2}]}).
    map(x=>[x.tag,x.stepCount,x.routeCount]),[["POST",0,2]]);
});

test("PRE / OP / POST are precise Source origins; they never override outcome tone",async()=>{
  for(const [source,kind,tag] of [
    ["preconditions.on","preconditions","PRE"],
    ["operator.on","operator","OP"],
    ["postconditions.on","postconditions","POST"]
  ]){
    assert.deepEqual([routeOrigin(source).kind,routeOrigin(source).tag],[kind,tag]);
  }
  assert.equal(routeOrigin("future.on").kind,"unknown");
  const graph=await layoutProcedureELK(root);
  const sourceSnapshot=JSON.stringify(root);
  const flow=makeFlowElements(graph,root);
  assert.equal(flow.nodes.length,17);
  assert.equal(flow.edges.reduce((n,e)=>n+e.data.bundle.routes.length,0),65);
  assert.deepEqual(flow.nodes.find(n=>n.id==="nudm-sdm-subscribe").data.phaseChips
    .map(x=>x.tag),["PRE","POST"]);
  for(const edge of flow.edges){
    const origin=routeOrigin(edge.data.bundle.routeSource);
    assert.equal(edge.data.origin,origin.kind);
    assert.ok(edge.data.label.startsWith(origin.tag+" · "));
    assert.ok(edge.data.fullLabel.startsWith(origin.source+" · "));
    assert.deepEqual(edge.data.bundle.routes.map(x=>x.id).length,
      edge.data.bundle.outcomes.length);
  }
  assert.equal(JSON.stringify(root),sourceSnapshot);
});
