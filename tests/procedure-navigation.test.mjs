import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {projectWorkspace} from "../site/workspace.mjs";
import {layoutProcedureELK} from "../site/layout.mjs";
import {makeFlowElements} from "../site/react-flow-projection.mjs";
import {nodeJourney} from "../site/workbench.mjs";
import {resolveProcedureCall,retainProcedureTrail,procedureCallers}
  from "../site/procedure-navigation.mjs";

const owner=projectWorkspace(readFileSync(
  new URL("../site/samples/packages/establish-pdu-session/assurance/procedure.yaml",
    import.meta.url),"utf8"));
assert.equal(owner.state,"READY");
const root=owner.procedures.get(owner.entry);

test("A2 distinguishes all six real Root invocations, only four Child definitions",async()=>{
  const graph=await layoutProcedureELK(root);
  const before=JSON.stringify(root);
  const flow=makeFlowElements(graph,root);
  const invocations=flow.nodes.filter(n=>n.data.childProcedure);
  assert.equal(invocations.length,6);
  assert.deepEqual(new Set(invocations.map(n=>n.data.childProcedure)),new Set([
    "await-initial-n4-session-establishment","await-pdu-session-resource-setup",
    "await-n4-forwarding-convergence","finalize-resource-responsibility"
  ]));
  assert.ok(invocations.every(n=>n.data.operator==="procedure"));
  assert.equal(flow.nodes.length,17);
  assert.equal(flow.edges.length,46);
  assert.equal(JSON.stringify(root),before);
});

test("A2 same Child definition retains its exact, distinct caller site",()=>{
  const child="finalize-resource-responsibility";
  const callers=procedureCallers(owner,child);
  assert.equal(callers.length,3);
  assert.deepEqual(callers.map(x=>x.callerId).sort(),[
    "finalize-failed","finalize-success","finalize-unresolved"
  ]);
  for(const context of callers){
    assert.equal(context.parentProcedure,owner.entry);
    assert.equal(context.childProcedure,child);
    assert.equal(context.via,"operator");
    assert.ok(Number.isInteger(context.line)&&context.line>0);
    assert.deepEqual(retainProcedureTrail(owner,[context],child),[context]);
  }
  assert.equal(resolveProcedureCall(owner,owner.entry,"nudm-sdm-get",child),null);
  assert.equal(resolveProcedureCall(owner,owner.entry,"finalize-failed",
    "await-initial-n4-session-establishment"),null);
  assert.equal(resolveProcedureCall(owner,"missing","finalize-failed",child),null);
  assert.equal(resolveProcedureCall(owner,owner.entry,"finalize-failed","missing"),null);
});

test("A2 direct Child browse never fabricates a parent; stale trail fails closed",()=>{
  const context=resolveProcedureCall(owner,owner.entry,"n4-session-establishment",
    "await-initial-n4-session-establishment");
  assert.ok(context);
  assert.deepEqual(retainProcedureTrail(owner,[],context.childProcedure),[]);
  assert.deepEqual(retainProcedureTrail(owner,[context],owner.entry),[]);
  assert.deepEqual(retainProcedureTrail(owner,[{...context,via:"postconditions.steps[0]"}],
    context.childProcedure),[]);
  assert.deepEqual(retainProcedureTrail(owner,[{...context,callerId:"missing"}],
    context.childProcedure),[]);
  assert.deepEqual(retainProcedureTrail(null,[context],context.childProcedure),[]);
  assert.deepEqual(procedureCallers(null,context.childProcedure),[]);
  assert.deepEqual(procedureCallers(owner,"missing"),[]);
});

test("A2 Child invocation CTA and frame remain view-only and keyboard accessible",()=>{
  const tsx=readFileSync(new URL("../site/react-flow-canvas.tsx",import.meta.url),"utf8");
  const html=readFileSync(new URL("../site/index.html",import.meta.url),"utf8");
  const app=readFileSync(new URL("../site/app.mjs",import.meta.url),"utf8");
  const css=readFileSync(new URL("../site/light.css",import.meta.url),"utf8");
  assert.match(tsx,/is-subflow-invocation/);
  assert.match(tsx,/className="designer-subflow-enter nodrag nopan"/);
  assert.match(tsx,/aria-label=\{"进入子流程 "/);
  assert.match(tsx,/event\.stopPropagation\(\)/);
  assert.match(tsx,/callbacks\.onEnterChild/);
  assert.match(html,/id="procedureScope"/);
  assert.match(html,/id="procedureScopeReturn"/);
  assert.match(app,/resolveProcedureCall\(lastWorkspace/);
  assert.match(app,/retainProcedureTrail\(parsed,procedureTrail,activeProcedureId\)/);
  assert.match(app,/function returnFromProcedure\(\)/);
  assert.match(css,/\.designer-node\.is-subflow-invocation/);
  assert.match(css,/graph-pane\[data-procedure-scope="child"\]::before/);
  assert.match(css,/\.procedure-scope-return:focus-visible/);
  assert.doesNotMatch(tsx,/nodesDraggable=\{true\}/);
});

test("A2 every real Node can project a local PRE / OP / POST view",()=>{
  assert.equal(root.nodes.length,17);
  for(const node of root.nodes){
    const model=nodeJourney(root,node.id);
    assert.equal(model.node.id,node.id);
    assert.equal(model.execute.operator,node.operator);
    assert.equal(model.execute.value,node.value);
    for(const route of model.prepare.routes)
      assert.equal(route.routeSource,"preconditions.on");
    for(const route of model.execute.routes)
      assert.equal(route.routeSource,"operator.on");
    for(const route of model.confirm.routes)
      assert.equal(route.routeSource,"postconditions.on");
  }
  const subscribe=nodeJourney(root,"nudm-sdm-subscribe");
  assert.equal(subscribe.prepare.phase.steps.length,5);
  assert.equal(subscribe.confirm.phase.steps.length,1);
  const terminal=root.nodes.find(node=>node.operator==="terminal");
  assert.ok(terminal);
  const end=nodeJourney(root,terminal.id);
  assert.equal(end.prepare.phase,null);
  assert.equal(end.confirm.phase,null);
  assert.equal(end.execute.operator,"terminal");
  assert.equal(nodeJourney(root,"missing"),null);
});
test("A2 Node View is explicit; real Child navigation remains independent",()=>{
  const tsx=readFileSync(new URL("../site/react-flow-canvas.tsx",import.meta.url),"utf8");
  const html=readFileSync(new URL("../site/index.html",import.meta.url),"utf8");
  const app=readFileSync(new URL("../site/app.mjs",import.meta.url),"utf8");
  const css=readFileSync(new URL("../site/light.css",import.meta.url),"utf8");
  assert.doesNotMatch(tsx,/onNodeDoubleClick=/);
  assert.doesNotMatch(app,/onNodeDoubleClick:id=>openNodeFocus\(id\)/);
  assert.match(tsx,/className="designer-view-node/);
  assert.match(tsx,/callbacks.onViewDetails\(node.id\)/);
  assert.match(app,/onViewDetails:id=>openNodeFocus\(id\)/);
  assert.match(tsx,/data.onEnterChild\?\.\(\)/);
  assert.match(app,/function renderNodeFocus\(\)/);
  assert.match(app,/function openNodeFocus\(id\)/);
  assert.match(app,/function closeNodeFocus\(\)/);
  assert.match(app,/projectNodeFocusFlow\(lastGood,nodeFocusId\)/);
  assert.match(app,/nodeJourney\(lastGood,nodeFocusId\)/);
  assert.match(html,/id="nodeFocus"[^>]*aria-label="节点上下游与内部流程"/);
  assert.match(html,/id="nodeFocusFlow"/);
  assert.match(html,/id="nodeFocusReturn"/);
  assert.match(css,/\.graph-pane \.node-focus\[hidden\]/);
  assert.match(css,/\.focus-graph-card\.is-stage/);
  assert.match(css,/\.node-focus-flow-host/);
  assert.match(app,/if\(visible\)\$\("reactFlowRoot"\)\.setAttribute\("aria-hidden","true"\)/);
});
