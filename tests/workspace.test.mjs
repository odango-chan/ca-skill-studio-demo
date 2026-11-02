import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { projectWorkspace } from "../site/workspace.mjs";
import { routeEditTargets, previewRouteTargetPatch } from "../site/patch.mjs";

const ensure = readFileSync(new URL("../site/samples/ensure-pdu-session.procedure.yaml", import.meta.url), "utf8");
const establish = readFileSync(new URL("../site/samples/establish-pdu-session.procedure.yaml", import.meta.url), "utf8");

function ready(source) {
  const result=projectWorkspace(source);
  assert.equal(result.state,"READY",JSON.stringify(result.diagnostics));
  return result;
}
test("ensure remains one Procedure / 11 nodes / 24 outcome route entries",()=>{
  const p=ready(ensure);
  assert.equal(p.procedures.size,1);
  assert.equal(p.entry,"ensure-session");
  assert.equal(p.procedure.nodes.length,11);
  assert.equal(p.procedure.routes.length,24);
  assert.equal(p.procedure.children.length,0);
  assert.equal(p.procedure.routes.find(r=>r.id==="verify-created-target:FAIL").patchable,true);
});
test("establish fixture has Root 17 nodes and 65 real outcome route entries",()=>{
  const p=ready(establish);
  assert.equal(p.entry,"ue-requested-pdu-session-establishment");
  assert.equal(p.procedures.size,6);
  const root=p.procedure;
  assert.equal(root.nodes.length,17);
  assert.equal(root.routes.length,65);
  assert.equal(new Set(root.routes.map(r=>r.id)).size,65);
  assert.equal(root.start,"nudm-sdm-get");
  assert.equal(root.nodes.filter(n=>n.operator==="reconcile").length,3);
});
test("five child definitions exist and each has a valid local start and route graph",()=>{
  const p=ready(establish);
  const expected=["await-initial-n4-session-establishment","await-pdu-session-resource-setup",
    "await-n4-forwarding-convergence","await-ue-session-configuration","finalize-resource-responsibility"];
  assert.deepEqual([...p.procedures.keys()].slice(1),expected);
  for(const name of expected){
    const proc=p.procedures.get(name);
    assert.ok(proc.nodes.some(n=>n.id===proc.start),name);
    assert.ok(proc.routes.length>0,name);
    for(const r of proc.routes)assert.ok(proc.nodes.some(n=>n.id===r.target),name+"/"+r.id);
  }
});
test("operator, preconditions and postconditions routes are kept distinct",()=>{
  const p=ready(establish).procedure;
  const a=p.routes.filter(r=>r.source==="nudm-sdm-get");
  assert.equal(a.length,6);
  assert.equal(a.filter(r=>r.routeSource==="postconditions.on").length,3);
  assert.equal(a.filter(r=>r.routeSource==="operator.on").length,3);
  assert.equal(p.routes.find(r=>r.id==="nudm-sdm-get:postconditions:PASS").target,"nudm-sdm-subscribe");
  assert.equal(p.routes.find(r=>r.id==="nudm-sdm-get:FAILED").target,"failed");
  const b=p.routes.filter(r=>r.source==="nudm-sdm-subscribe");
  assert.ok(b.some(r=>r.routeSource==="preconditions.on"));
  assert.ok(b.some(r=>r.routeSource==="postconditions.on"));
  assert.ok(b.some(r=>r.routeSource==="operator.on"));
});
test("phase steps remain ordered and are not invented graph nodes",()=>{
  const p=ready(establish).procedure;
  const sub=p.nodes.find(n=>n.id==="nudm-sdm-subscribe");
  const pre=sub.phases.find(x=>x.name==="preconditions");
  assert.deepEqual(pre.steps.map(x=>x.operator),["script","call","verify","verify","verify"]);
  assert.equal(pre.steps[0].name,"select-subscription-configuration");
  assert.equal(pre.steps[0].value,"scripts/select_establishment_configuration.py");
  assert.ok(pre.steps[0].line<pre.steps[1].line);
  assert.equal(p.nodes.some(n=>n.id==="select-subscription-configuration"),false);
});
test("root operator child and phase-step child are both navigable but distinct",()=>{
  const p=ready(establish);
  const root=p.procedure;
  const finish=root.nodes.find(n=>n.id==="finalize-success");
  assert.equal(finish.operator,"procedure");
  assert.equal(finish.value,"finalize-resource-responsibility");
  assert.deepEqual(finish.children.map(x=>x.procedure),[
    "await-ue-session-configuration","finalize-resource-responsibility"
  ]);
  assert.deepEqual(finish.children.map(x=>x.via),[
    "preconditions.steps[0]","operator"
  ]);
  assert.equal(root.nodes.find(n=>n.id==="n4-session-modification").children[0].procedure,
    "await-n4-forwarding-convergence");
});
test("every outcome points to original Source span even in nested Phase on",()=>{
  const p=ready(establish);
  for(const proc of p.procedures.values()) {
    for(const route of proc.routes){
      assert.equal(establish.slice(route.sourceSpan.start,route.sourceSpan.end),route.target);
      assert.ok(route.line>=proc.line);
      const line=establish.slice(0,route.sourceSpan.start).split("\n").length;
      assert.equal(line,route.line);
    }
  }
});
test("read-only multi-procedure never admits Visual mutation even with valid routes",()=>{
  const p=ready(establish);
  assert.deepEqual(routeEditTargets(p.procedure,"nudm-sdm-get:FAILED"),[]);
  assert.throws(()=>previewRouteTargetPatch(establish,"verify-created-target:FAIL","safe-stopped"));
});
test("missing child ref fails closed",()=>{
  const malformed=establish.replace("procedure: await-initial-n4-session-establishment",
    "procedure: missing-child");
  const p=projectWorkspace(malformed);
  assert.equal(p.state,"UNAVAILABLE");
  assert.match(p.diagnostics[0].message,/Child Procedure/);
});
test("phase route failure is diagnosed without silently falling back to operator on",()=>{
  const malformed=establish.replace("PASS: nudm-sdm-subscribe","PASS: nowhere");
  const p=projectWorkspace(malformed);
  assert.equal(p.state,"UNAVAILABLE");
  assert.match(p.diagnostics[0].message,/悬空/);
});
test("duplicated nested route outcome refuses graph",()=>{
  const malformed=establish.replace("PASS: nudm-sdm-subscribe\n            FAIL: failed",
    "PASS: nudm-sdm-subscribe\n            PASS: failed");
  assert.equal(projectWorkspace(malformed).state,"UNAVAILABLE");
});
test("unknown node key or phase step type remains Source-only",()=>{
  const a=establish.replace("        call: sbi.udm.sm_data.get",
    "        unknown-operator: sbi.udm.sm_data.get");
  assert.equal(projectWorkspace(a).state,"UNAVAILABLE");
  const b=establish.replace("- verify: createdsession.udm.subscription_usable",
    "- something: createdsession.udm.subscription_usable");
  assert.equal(projectWorkspace(b).state,"UNAVAILABLE");
});
test("CRLF/BOM read-only projection keeps unchanged input intact",()=>{
  const raw="\uFEFF"+establish.replace(/\n/g,"\r\n");
  const p=ready(raw);
  assert.equal(p.procedure.routes.length,65);
  assert.ok(raw.startsWith("\uFEFF"));
  assert.ok(raw.includes("\r\n"));
});
