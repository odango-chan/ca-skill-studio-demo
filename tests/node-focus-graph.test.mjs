import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {projectWorkspace} from "../site/workspace.mjs";
import {layoutProcedureELK} from "../site/layout.mjs";
import {projectNodeFocusFlow,makeNodeFocusElements,currentNodeBoundary}
  from "../site/node-focus-graph.mjs";

const owner=projectWorkspace(readFileSync(new URL(
  "../site/samples/packages/establish-pdu-session/assurance/procedure.yaml",
  import.meta.url),"utf8"));
assert.equal(owner.state,"READY");
const procedure=owner.procedure;

test("A2c each of 17 Nodes projects only its own one-hop real Routes",async()=>{
  const original=JSON.stringify(procedure);
  for(const node of procedure.nodes){
    const local=projectNodeFocusFlow(procedure,node.id);
    assert.ok(local);
    const expected=procedure.routes.filter(r=>r.source===node.id||r.target===node.id);
    const real=local.routes.filter(r=>!r.viewOnly);
    assert.deepEqual(real.map(r=>r.originalRoute.id),expected.map(r=>r.id));
    assert.ok(local.nodes.filter(n=>n.kind==="stage").some(n=>n.stage==="operator"));
    assert.equal(local.nodes.filter(n=>n.kind==="stage").length,
      1+node.phases.length);
    assert.equal(local.routes.filter(r=>r.viewOnly).length,
      node.phases.length);
    assert.equal(local.originalRouteCount,real.length);
    const graph=await layoutProcedureELK(local,{
      direction:"RIGHT",dimensions:local.dimensions
    });
    const flow=makeNodeFocusElements(local,graph);
    assert.equal(flow.nodes.length,local.nodes.length+1);
    const container=flow.nodes.find(n=>n.type==="focus-boundary");
    assert.ok(container,"every focus graph needs a local Stage boundary");
    assert.equal(container.data.centerId,node.id);
    assert.equal(container.data.viewOnly,true);
    assert.equal(container.draggable,false);
    assert.equal(container.selectable,false);
    const frame=currentNodeBoundary(local,graph);
    assert.deepEqual(container.position,frame.position);
    assert.equal(container.style.width,frame.width);
    assert.equal(container.style.height,frame.height);
    assert.ok(local.nodes.filter(n=>n.kind==="stage").every(stage=>{
      const p=graph.positions.get(stage.id);
      const d=local.dimensions.get(stage.id);
      return p.x>=frame.position.x&&p.y>=frame.position.y&&
        p.x+d.width<=frame.position.x+frame.width&&
        p.y+d.height<=frame.position.y+frame.height;
    }));
    assert.ok(flow.edges.every(e=>e.source!==container.id&&
      e.target!==container.id));
    assert.equal(flow.edges.length,graph.bundles.length);
    assert.ok(flow.edges.every(e=>e.reconnectable===false));
    assert.deepEqual(flow.edges.flatMap(e=>e.data.sourceRouteIds).sort(),
      expected.map(r=>r.id).sort());
    assert.equal(flow.edges.filter(e=>e.type==="focus-phase-link").length,
      local.stages.length-1);
  }
  assert.equal(JSON.stringify(procedure),original);
});

test("A2c UDM Subscribe displays PRE 5 -> OP -> POST 1 and true outcomes",async()=>{
  const local=projectNodeFocusFlow(procedure,"nudm-sdm-subscribe");
  assert.deepEqual(local.stages,["preconditions","operator","postconditions"]);
  assert.equal(local.nodes.find(n=>n.id==="stage:preconditions").steps.length,5);
  assert.equal(local.nodes.find(n=>n.id==="stage:postconditions").steps.length,1);
  assert.equal(local.incomingCount,1);
  assert.equal(local.outgoingCount,9);
  const original=procedure.routes.filter(r=>r.source==="nudm-sdm-subscribe"||
    r.target==="nudm-sdm-subscribe");
  const graph=await layoutProcedureELK(local,{direction:"RIGHT",dimensions:local.dimensions});
  const view=makeNodeFocusElements(local,graph);
  assert.deepEqual(view.edges.flatMap(e=>e.data.sourceRouteIds).sort(),
    original.map(r=>r.id).sort());
  assert.ok(view.edges.some(e=>e.data.origin==="PRE"&&
    e.data.sourceRouteIds.length));
  assert.ok(view.edges.some(e=>e.data.origin==="POST"&&
    e.data.sourceRouteIds.length));
  assert.ok(view.edges.some(e=>e.data.origin==="OP"&&
    e.data.sourceRouteIds.length));
  assert.ok(view.edges.some(e=>e.type==="focus-phase-link"));
  assert.ok(view.nodes.some(n=>n.type==="focus-node"&&
    n.data.kind==="neighbor"&&n.data.role==="previous"));
  assert.ok(view.nodes.some(n=>n.type==="focus-node"&&
    n.data.kind==="neighbor"&&n.data.role==="next"));
});

test("v1alpha4 Node focus preserves ordered Operation / Observation stages and Route origins",async()=>{
  const node=(id,stages,extra={})=>({
    id,operator:"node",value:stages.map(x=>x.name).join(" → "),line:1,
    phases:[],children:[],stages,...extra
  });
  const terminal=id=>({id,operator:"terminal",value:id,line:0,
    phases:[],children:[],viewOnly:true});
  const procedure={
    name:"sample",start:"check",profile:"CA-SL v1alpha4",
    nodes:[
      node("check",[{name:"precondition",line:2,count:1,routeOutcomes:["PASS","FAIL"]}]),
      node("read",[
        {name:"operation",line:5,count:1,target:"ca::session.read",routeOutcomes:["SUCCEEDED"]},
        {name:"observation",line:8,count:1,target:"ca::session.observe",routeOutcomes:["SUCCEEDED"]}
      ]),
      node("verify",[{name:"postcondition",line:12,count:1,routeOutcomes:["PASS"]}],
        {finalGoal:true}),
      terminal("SUCCEEDED"),terminal("FAILED")
    ],
    routes:[
      {id:"check.PASS",source:"check",target:"read",routeSource:"precondition",outcome:"PASS",line:3},
      {id:"check.FAIL",source:"check",target:"FAILED",routeSource:"precondition",outcome:"FAIL",line:4},
      {id:"read.OP",source:"read",target:"verify",routeSource:"operation",outcome:"SUCCEEDED",line:7},
      {id:"read.OBS",source:"read",target:"verify",routeSource:"observation",outcome:"SUCCEEDED",line:10},
      {id:"verify.PASS",source:"verify",target:"SUCCEEDED",routeSource:"postcondition",outcome:"PASS",line:14}
    ]
  };
  const local=projectNodeFocusFlow(procedure,"read");
  assert.deepEqual(local.stages,["operation","observation"]);
  assert.ok(local.routes.some(route=>route.originalRoute?.id==="read.OP"&&
    route.source==="stage:operation"));
  assert.ok(local.routes.some(route=>route.originalRoute?.id==="read.OBS"&&
    route.source==="stage:observation"));
  assert.equal(local.routes.filter(route=>route.viewOnly).length,1);
  const graph=await layoutProcedureELK(local,{direction:"RIGHT",dimensions:local.dimensions});
  const flow=makeNodeFocusElements(local,graph);
  assert.ok(flow.edges.some(edge=>edge.data.origin==="OP"));
  assert.ok(flow.edges.some(edge=>edge.data.origin==="OBS"));
});

test("A2c multiple outcomes, cycles, and missing PRE/POST do not invent Route IDs",async()=>{
  const mk=id=>({id,operator:id==="c"?"terminal":"call",value:id,
    line:1,phases:id==="b"?[
      {name:"preconditions",steps:[{operator:"verify",value:"p",line:2}],line:2},
      {name:"postconditions",steps:[],line:3}]:[],children:[]});
  const nodes=["a","b","c"].map(mk);
  const routes=[
    {id:"a:P",source:"a",target:"b",routeSource:"operator.on",outcome:"PASS",line:5},
    {id:"a:F",source:"a",target:"b",routeSource:"operator.on",outcome:"FAIL",line:6},
    {id:"b:R",source:"b",target:"b",routeSource:"preconditions.on",outcome:"RETRY",line:7},
    {id:"b:U",source:"b",target:"c",routeSource:"postconditions.on",outcome:"UNKNOWN",line:8}
  ];
  const procedure={name:"fixture",start:"a",nodes,routes};
  const local=projectNodeFocusFlow(procedure,"b");
  assert.equal(local.originalRouteCount,4);
  assert.equal(local.routes.filter(r=>r.viewOnly).length,2);
  assert.ok(local.routes.some(r=>r.id==="b:R"&&r.source==="stage:preconditions"&&
    r.target==="stage:preconditions"));
  const layout=await layoutProcedureELK(local,{direction:"RIGHT",dimensions:local.dimensions});
  const flow=makeNodeFocusElements(local,layout);
  assert.deepEqual(flow.edges.flatMap(e=>e.data.sourceRouteIds).sort(),routes.map(r=>r.id).sort());
  assert.ok(flow.edges.some(e=>e.data.tone==="mixed"&&e.data.sourceRouteIds.length===2));
  const terminal=projectNodeFocusFlow(procedure,"c");
  assert.deepEqual(terminal.stages,["operator"]);
  assert.equal(terminal.routes.filter(r=>r.viewOnly).length,0);
  assert.equal(terminal.outgoingCount,0);
  assert.equal(projectNodeFocusFlow(procedure,"missing"),null);
  await assert.rejects(()=>layoutProcedureELK(local,{
    direction:"RIGHT",dimensions:new Map()
  }),/Invalid visual-only node dimensions/);
});

