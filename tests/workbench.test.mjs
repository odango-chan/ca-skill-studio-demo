import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { projectWorkspace } from "../site/workspace.mjs";
import {
  procedureItems, nodeItems, nodeDetails, routeDetails, groupNodeRoutes,
  inspectorTabItems, preferredTab
} from "../site/workbench.mjs";

const fixture = name => readFileSync(new URL("../site/samples/"+name+".procedure.yaml",import.meta.url),"utf8");
const ensure=projectWorkspace(fixture("ensure-pdu-session"));
const establish=projectWorkspace(fixture("establish-pdu-session"));
assert.equal(ensure.state,"READY");
assert.equal(establish.state,"READY");

test("Explorer presents six source-backed procedures with explicit root identity",()=>{
  const items=procedureItems(establish);
  assert.equal(items.length,6);
  assert.equal(items[0].kind,"root");
  assert.equal(items[0].nodes,17);
  assert.equal(items[0].routes,65);
  assert.equal(items.filter(item=>item.kind==="child").length,5);
  assert.deepEqual(procedureItems(establish,"await-n4").map(x=>x.id),
    ["await-n4-forwarding-convergence"]);
});
test("Explorer searches active procedure nodes without inventing graph nodes",()=>{
  const root=establish.procedure;
  assert.equal(nodeItems(root).length,17);
  assert.equal(nodeItems(root).filter(x=>x.isStart).length,1);
  assert.deepEqual(nodeItems(root,"pcf").map(x=>x.id),
    ["npcf-sm-policy-control-create","reconcile-npcf-sm-policy-control-create"]);
  assert.deepEqual(nodeItems(root,"nothing-like-this-operator"),[]);
});
test("node Inspector derives conditions in declared YAML order",()=>{
  const model=nodeDetails(establish.procedure,"nudm-sdm-subscribe");
  assert.equal(model.node.operator,"call");
  assert.deepEqual(model.conditions.map(x=>x.name),["preconditions","postconditions"]);
  assert.deepEqual(model.conditions[0].steps.map(x=>x.operator),
    ["script","call","verify","verify","verify"]);
  assert.ok(model.conditions[0].steps.every((step,i,a)=>i===0||step.line>a[i-1].line));
});
test("node Inspector keeps Child call origins distinct",()=>{
  const model=nodeDetails(establish.procedure,"finalize-success");
  assert.equal(model.childRefs.length,2);
  assert.deepEqual(model.childRefs.map(x=>x.via),
    ["preconditions.steps[0]","operator"]);
});
test("routes tab groups by exact YAML origin without merging conditions and operator",()=>{
  const model=nodeDetails(establish.procedure,"nudm-sdm-get");
  assert.deepEqual(model.outgoing.map(x=>x.title),["postconditions.on","operator.on"]);
  assert.equal(model.routeCount,6);
  assert.equal(model.outgoing[0].entries[0].outcome,"PASS");
  assert.equal(model.outgoing[1].entries[0].outcome,"FAILED");
});
test("route and node navigation uses real ids, line positions and targets",()=>{
  const p=establish.procedure;
  const r=routeDetails(p,"nudm-sdm-get:postconditions:PASS");
  assert.equal(r.target,"nudm-sdm-subscribe");
  assert.equal(r.from.id,"nudm-sdm-get");
  assert.equal(r.to.id,"nudm-sdm-subscribe");
  assert.ok(r.line>1);
  const incoming=groupNodeRoutes(p,"nudm-sdm-subscribe","incoming");
  assert.ok(incoming.some(x=>x.title.includes("nudm-sdm-get")));
});
test("tab model never exposes a fake edit tab or unsupported field",()=>{
  assert.deepEqual(inspectorTabItems(null).map(x=>x.id),["overview"]);
  assert.deepEqual(inspectorTabItems({kind:"node"}).map(x=>x.id),
    ["overview","conditions","routes"]);
  assert.deepEqual(inspectorTabItems({kind:"route"}).map(x=>x.id),
    ["overview","routes"]);
  assert.equal(preferredTab({kind:"node"}),"overview");
  assert.equal(preferredTab({kind:"route"}),"routes");
});
test("undefined selection and non-ready projection fail closed",()=>{
  assert.equal(nodeDetails(establish.procedure,"does-not-exist"),null);
  assert.equal(routeDetails(establish.procedure,"does-not-exist"),null);
  assert.deepEqual(procedureItems({state:"UNAVAILABLE"}),[]);
  assert.deepEqual(nodeItems(null),[]);
});
test("product shell includes all referenced static controls",()=>{
  const app=readFileSync(new URL("../site/app.mjs",import.meta.url),"utf8");
  const html=readFileSync(new URL("../site/index.html",import.meta.url),"utf8");
  const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
  const referenced=[...new Set([...app.matchAll(/\$\("([A-Za-z][A-Za-z0-9-]*)"\)/g)].map(m=>m[1]))];
  assert.deepEqual(referenced.filter(id=>!ids.has(id)),[]);
  for(const id of ["assetTree","procedureTree","nodeOutlineDisclosure","inspectorContext","source",
    "canvas","patchDialog","downloadButton","fileStatus","resetButton","viewMenu",
    "toggleExplorer","closeInspector","showAllLabels","layoutDirection","neighborsOnly"]){
    assert.ok(ids.has(id),id);
  }
});
test("source-preserving guard controls remain in editor and patch modules",()=>{
  const app=readFileSync(new URL("../site/app.mjs",import.meta.url),"utf8");
  const patch=readFileSync(new URL("../site/patch.mjs",import.meta.url),"utf8");
  assert.match(app,/previewRouteTargetPatch\(source\.value/);
  assert.match(app,/applyRouteTargetPatch\(source\.value/);
  assert.match(app,/history\.record\(nextSource\)/);
  assert.match(patch,/currentSource !== preview\.baseSource/);
  assert.match(patch,/routeEditTargets/);
});
