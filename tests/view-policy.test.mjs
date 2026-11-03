import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {viewKindFor,availableModes,permittedMode,graphControlsAvailable} from "../site/view-policy.mjs";
const file=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
test("Markdown Visual is preview independent of Procedure projection",()=>{
  assert.equal(viewKindFor({path:"SKILL.md",projection:{state:"SOURCE_ONLY"}}),"markdown");
  assert.equal(viewKindFor({path:"README.MD",projection:{state:"UNAVAILABLE"}}),"markdown");
  assert.equal(viewKindFor({path:"SKILL.md",previewAvailable:false}),"source");
  assert.deepEqual(availableModes("markdown"),["visual","source","split"]);
  assert.equal(permittedMode("markdown","visual"),"visual");
});
test("Procedure Visual exists only for a successful current projection",()=>{
  assert.equal(viewKindFor({path:"assurance/procedure.yaml",projection:{state:"READY"}}),"procedure");
  assert.equal(viewKindFor({path:"assurance/procedure.yaml",projection:{state:"UNAVAILABLE"}}),"source");
  assert.deepEqual(availableModes("procedure"),["visual","source","split"]);
  assert.equal(graphControlsAvailable("procedure"),true);
});
test("Contract, Schema, Predicate and Script are source-only",()=>{
  for(const path of ["assurance/contract.yaml","assurance/predicates.yaml",
    "schemas/selection.schema.yaml","scripts/evaluate_udm_read.py","request.json","unknown.txt"]){
    assert.equal(viewKindFor({path,projection:{state:"SOURCE_ONLY"}}),"source");
  }
  assert.deepEqual(availableModes("source"),["source"]);
  assert.equal(permittedMode("source","visual"),"source");
  assert.equal(permittedMode("source","split"),"source");
  assert.equal(graphControlsAvailable("source"),false);
});
test("one toolbar reuses Visual for Markdown and hides unsupported modes",()=>{
  const app=file("site/app.mjs"),html=file("site/index.html");
  assert.match(html,/id="markdownPane"[^>]*hidden/);
  assert.match(html,/id="markdownPreview"/);
  assert.match(html,/id="editorModes"/);
  assert.match(html,/id="graphViewOptions"/);
  assert.match(html,/id="zoomViewOptions"/);
  assert.match(html,/id="viewMenuTitle"/);
  assert.match(app,/function updateViewAvailability\(nextKind\)/);
  assert.match(app,/editorModes"\)\.hidden=!hasVisual/);
  assert.match(app,/graphPane"\)\.hidden=!isGraph/);
  assert.match(app,/markdownPane"\)\.hidden=viewKind!=="markdown"/);
  assert.match(app,/mode-visual"\)\.textContent=viewKind==="markdown"\?"预览":"Visual"/);
  assert.match(app,/if\(!hasVisual&&mode!=="source"\)setMode\("source"\)/);
});
test("projection failure clears stale graph and preserves diagnostics and Source",()=>{
  const app=file("site/app.mjs");
  assert.match(app,/invalidateLayout\(\);\s*lastWorkspace=null;\s*lastGood=null;\s*graph=null;/);
  assert.match(app,/投影失败 · 仅源码/);
  assert.match(app,/function renderProblems\(\)/);
  assert.match(app,/lineJump\(item\.line\)/);
  assert.match(app,/updateViewAvailability\(viewKindFor\(/);
});
test("Markdown renderer stays independent of source history and canonical text",()=>{
  const app=file("site/app.mjs");
  assert.match(app,/renderMarkdown\(text\)/);
  assert.match(app,/markdownPreview"\)\.innerHTML=rendered\.html/);
  assert.match(app,/history\.record\(source\.value\)/);
  assert.match(app,/source\.value\s*=\s*nextSource/);
  assert.doesNotMatch(app,/source\.value\s*=\s*rendered\.html/);
});
