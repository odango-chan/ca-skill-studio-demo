import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const html=read("site/index.html");
const app=read("site/app.mjs");
const css=read("site/light.css");

test("one file identity, one edit status, one compact editor toolbar",()=>{
  assert.equal((html.match(/\bid="fileName"/g)||[]).length,1);
  assert.equal((html.match(/\bid="fileStatus"/g)||[]).length,1);
  assert.equal((html.match(/class="editorbar compact-toolbar"/g)||[]).length,1);
  assert.doesNotMatch(html,/class="procedure-navigation"/);
  assert.doesNotMatch(html,/class="modebar"/);
  assert.doesNotMatch(html,/\bid="titleFile"|\bid="dirty"/);
  assert.doesNotMatch(html,/\bid="workspaceSummary"|\bid="editorContext"/);
});
test("editor uses progressive disclosure without duplicating object panels",()=>{
  assert.match(html,/id="nodeOutlineDisclosure"/);
  assert.match(html,/class="sample-picker"/);
  assert.match(html,/id="viewMenu"/);
  assert.match(html,/id="inspectorPanel"/);
  assert.doesNotMatch(html,/id="nodeQuickCard"|id="toggleInspector"/);
  assert.doesNotMatch(html,/class="inspector-footer"|class="inspector-sequence"/);
  assert.match(css,/\.compact-toolbar/);
});
test("actual Package example files are navigable without an invented disk workspace",()=>{
  assert.match(html,/id="assetTree"/);
  assert.match(html,/id="fileCount"/);
  assert.match(html,/id="exportPackageButton"/);
  assert.match(app,/packageFilesForSample\(sample\)/);
  assert.match(app,/function switchFile\(path\)/);
  assert.match(app,/markFileEdited\(activePackage/);
  assert.match(app,/zipPackage\(entries\)/);
});
test("zero diagnostics do not create a persistent problems strip",()=>{
  assert.match(html,/id="problems"[^>]*hidden/);
  assert.match(app,/problems\.hidden=items\.length===0/);
  assert.match(app,/problems\.replaceChildren\(\)/);
});
test("node journey hides absent stages while preserving source route identity",()=>{
  assert.match(app,/if\(model\.prepare\.phase \|\| model\.prepare\.routes\.length\)/);
  assert.match(app,/if\(model\.confirm\.phase \|\| model\.confirm\.routes\.length\)/);
  assert.match(app,/if\(model\.routeCount\)/);
  assert.match(app,/routeFriendlySource\(group\.title\)/);
  assert.match(app,/inspectorRoute\(route,branches\)/);
});
test("every referenced control has one DOM identity",()=>{
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(new Set(ids).size,ids.length,"HTML duplicate id");
  const refs=[...new Set([...app.matchAll(/\$\("([A-Za-z][A-Za-z0-9-]*)"\)/g)].map(m=>m[1]))];
  assert.deepEqual(refs.filter(id=>!ids.includes(id)),[]);
});
test("important source and safety feedback remains visible on demand",()=>{
  assert.match(html,/id="graphWarning"[^>]*role="alert"/);
  assert.match(html,/id="fileStatus"[^>]*role="status"/);
  assert.match(html,/id="projectionState"[^>]*role="status"/);
  assert.match(html,/id="patchDialog"/);
  assert.match(app,/history\.record\(source\.value\)/);
  assert.match(app,/previewRouteTargetPatch\(source\.value/);
  assert.match(app,/applyRouteTargetPatch\(source\.value/);
  assert.match(app,/setInspectorOpen\(true,false\)/);
});
test("main toolbar still lets authors switch Source, Visual and Split",()=>{
  for(const name of ["visual","source","split"])
    assert.match(html,new RegExp('id="mode-'+name+'"'));
  assert.match(html,/id="resetButton"/);
  assert.match(html,/id="downloadButton"/);
  assert.match(html,/id="fit"/);
});
