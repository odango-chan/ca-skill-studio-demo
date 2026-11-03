import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const html=read("site/index.html");
const app=read("site/app.mjs");
const css=read("site/light.css");

test("Procedure tree has one stable DOM identity originating inside the asset explorer",()=>{
  assert.equal((html.match(/\bid="procedureTree"/g)||[]).length,1);
  assert.match(html,/<div id="assetTree" class="asset-tree">\s*<nav id="procedureTree"/);
  assert.doesNotMatch(html,/<\/div>\s*<nav id="procedureTree"/);
  assert.match(app,/const procedureTree = \$\("procedureTree"\)/);
});
test("Procedure navigation is parented immediately under its procedure.yaml entry, not appended after all files",()=>{
  assert.match(app,/const isProcedureFile=file\.path==="assurance\/procedure\.yaml"\|\|/);
  assert.match(app,/const group=el\("div","asset-procedure-entry"\)/);
  assert.match(app,/const row=el\("div","asset-procedure-row"\)/);
  assert.match(app,/row\.append\(toggle,btn\)/);
  assert.match(app,/group\.appendChild\(row\);\s*procedureTree\.hidden=!expanded;\s*group\.appendChild\(procedureTree\);\s*parent\.appendChild\(group\)/);
  assert.match(app,/else parent\.appendChild\(btn\)/);
});
test("File row and Procedure subtree have separate click/collapse controls and accessible state",()=>{
  assert.match(app,/const toggle=button\(expanded\?"▾":"▸"/);
  assert.match(app,/toggle\.setAttribute\("aria-expanded",String\(expanded\)\)/);
  assert.match(app,/toggle\.setAttribute\("aria-controls","procedureTree"\)/);
  assert.match(app,/toggle\.disabled=current&&projection\?\.state!=="READY"/);
  assert.match(app,/if\(!current\)\{\s*procedureNavOpen=true;\s*switchFile\(file\.path\)/);
  assert.match(app,/procedureNavOpen=!procedureNavOpen;\s*renderAssetNavigation\(\);\s*renderProcedureNavigation\(\)/);
  assert.match(app,/b\.addEventListener\("click",\(\)=>enterProcedure\(item\.id\)\)/);
});
test("Refresh reattaches before repainting nested Procedure items; parse failure hides the subtree",()=>{
  const refresh=app.slice(app.indexOf("function refresh(refit"),app.indexOf('source.addEventListener("input"'));
  assert.ok(refresh.indexOf("renderAssetNavigation();")>=0);
  assert.ok(refresh.indexOf("renderProcedureNavigation();")>refresh.indexOf("renderAssetNavigation();"));
  assert.match(app,/const expanded=current&&procedureNavOpen&&projection\?\.state==="READY"/);
  assert.match(app,/procedureTree\.replaceChildren\(\)/);
  assert.match(app,/let procedureNavOpen=true/);
  assert.match(app,/localProcedureDocument/);
  assert.match(app,/expandedAssetFolders\.has\(folderPath\)/);
});
test("Procedure subtree is indented and respects single-line file labels",()=>{
  assert.match(css,/\.asset-procedure-row\{[^}]*display:flex/s);
  assert.match(css,/\.asset-procedure-entry \.procedure-tree\{[^}]*border-left:1px solid/s);
  assert.match(css,/\.asset-procedure-entry \.procedure-tree\[hidden\]\{display:none!important\}/);
  assert.match(css,/\.asset-file-label\{[^}]*text-overflow:ellipsis/s);
});
