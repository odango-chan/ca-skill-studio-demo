import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { projectWorkspace } from "../site/workspace.mjs";
import { nodeJourney } from "../site/workbench.mjs";
const src=name=>readFileSync(new URL("../site/samples/"+name+".procedure.yaml",import.meta.url),"utf8");
const real=projectWorkspace(src("establish-pdu-session"));
const ensure=projectWorkspace(src("ensure-pdu-session"));
assert.equal(real.state,"READY");
assert.equal(ensure.state,"READY");

test("journey is composed from original YAML phases and operator with stable order",()=>{
  const journey=nodeJourney(real.procedure,"nudm-sdm-subscribe");
  assert.ok(journey);
  assert.equal(journey.node.id,"nudm-sdm-subscribe");
  assert.equal(journey.prepare.phase.name,"preconditions");
  assert.deepEqual(journey.prepare.phase.steps.map(s=>s.operator),
    ["script","call","verify","verify","verify"]);
  assert.equal(journey.execute.operator,"call");
  assert.equal(journey.execute.value,"sbi.udm.sdm_subscription.create");
  assert.equal(journey.confirm.phase.name,"postconditions");
  assert.equal(journey.confirm.phase.steps[0].value,"createdsession.udm.subscription_owned");
  assert.ok(journey.routeCount>0);
});
test("phase routes and main operation routes remain separate in journey",()=>{
  const j=nodeJourney(real.procedure,"nudm-sdm-get");
  assert.equal(j.prepare.phase,null);
  assert.equal(j.confirm.routes.length,3);
  assert.equal(j.execute.routes.length,3);
  assert.equal(j.branches.length,2);
  assert.equal(j.routeCount,6);
  assert.equal(j.confirm.routes.find(r=>r.outcome==="PASS").target,"nudm-sdm-subscribe");
});
test("child procedure calls in phases and operator never collapse",()=>{
  const j=nodeJourney(real.procedure,"finalize-success");
  assert.equal(j.execute.operator,"procedure");
  assert.equal(j.execute.children[0].procedure,"finalize-resource-responsibility");
  assert.equal(j.prepare.phase.steps[0].value,"await-ue-session-configuration");
  assert.deepEqual(j.children.map(c=>c.via),
    ["preconditions.steps[0]","operator"]);
});
test("terminal is a real Node with no synthetic branches",()=>{
  const j=nodeJourney(real.procedure,"done");
  assert.equal(j.execute.operator,"terminal");
  assert.equal(j.routeCount,0);
  assert.equal(j.prepare.phase,null);
  assert.equal(j.confirm.phase,null);
});
test("invalid selection returns null and never yields an editable model",()=>{
  assert.equal(nodeJourney(real.procedure,"not-a-node"),null);
  assert.equal(nodeJourney(null,"a"),null);
});
test("journey projection does not mutate source or procedure",()=>{
  const original=JSON.stringify(real.procedure);
  const j=nodeJourney(real.procedure,"nudm-sdm-get");
  j.branches.pop();
  assert.equal(JSON.stringify(real.procedure),original);
});
test("light theme and view controls are declared without remote assets",()=>{
  const html=readFileSync(new URL("../site/index.html",import.meta.url),"utf8");
  const css=readFileSync(new URL("../site/light.css",import.meta.url),"utf8");
  assert.match(html,/name="color-scheme" content="light"/);
  assert.match(html,/href="\.\/light\.css"/);
  assert.match(html,/id="workbench" data-explorer="open" data-inspector="closed"/);
  assert.doesNotMatch(html,/id="nodeQuickCard"/);
  assert.match(html,/id="assetTree"/);
  assert.doesNotMatch(html,/id="viewMenu"/);
  assert.match(html,/id="explorerRail"/);
  assert.match(html,/id="nodeOutlineDisclosure"/);
  assert.match(html,/id="showAllLabels"/);
  assert.match(css,/color-scheme:\s*light/);
  assert.match(css,/\.node-body/);
  assert.match(css,/\.modal-content/);
  assert.doesNotMatch(css,/url\s*\(\s*["']?https?:/);
});
test("source guard and controlled inspector disclosure remain wired",()=>{
  const app=readFileSync(new URL("../site/app.mjs",import.meta.url),"utf8");
  assert.match(app,/function setInspectorOpen\(/);
  assert.match(app,/function setExplorerOpen\(/);
  assert.match(app,/function renderAssetNavigation\(/);
  assert.doesNotMatch(app,/renderQuickCard|quickDetails|toggleInspector/);
  assert.match(app,/function renderNodeJourney\(/);
  assert.match(app,/setInspectorOpen\(true,false\)/);
  assert.match(app,/previewVisualRouteEdit\(currentRouteEditContext/);
  assert.match(readFileSync(new URL("../site/visual-route-edit.mjs",import.meta.url),"utf8"),/previewRouteTargetPatch\(context\.source/);
  assert.match(app,/applyRouteTargetPatch\(source\.value/);
  assert.doesNotMatch(app,/inspectorTabItems|preferredTab|inspectorTabs/);
});
