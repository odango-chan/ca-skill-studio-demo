import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const html=read("site/index.html");
const app=read("site/app.mjs");
const css=read("site/light.css");

test("toolbar keeps modes visible, while panel and fit actions live inside View menu",()=>{
  const toolbar=html.slice(html.indexOf('class="editorbar compact-toolbar"'),
    html.indexOf('<div id="editorBody"'));
  const menu=toolbar.slice(toolbar.indexOf('id="viewMenu"'));
  const beforeMenu=toolbar.slice(0,toolbar.indexOf('id="viewMenu"'));
  for(const id of ["toggleExplorer","inspectorVisibility","fit"]){
    assert.match(menu,new RegExp('id="'+id+'"'));
    assert.doesNotMatch(beforeMenu,new RegExp('id="'+id+'"'));
    assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1);
  }
  for(const id of ["mode-visual","mode-source","mode-split"])
    assert.match(beforeMenu,new RegExp('id="'+id+'"'));
  assert.match(menu,/id="graphViewOptions"/);
  assert.match(menu,/id="zoomViewOptions"/);
  assert.match(menu,/id="resetButton"/);
});
test("menu toggles are real actions, preserve visibility state, and restore focus",()=>{
  assert.match(app,/function updatePanelMenu\(\)/);
  assert.match(app,/setExplorerOpen\(!explorerOpen\)/);
  assert.match(app,/setInspectorOpen\(true\)/);
  assert.match(app,/setInspectorOpen\(false\)/);
  assert.match(app,/detail\.hidden=!available/);
  assert.match(app,/nav\.setAttribute\("aria-pressed",String\(explorerOpen\)\)/);
  assert.match(app,/detail\.setAttribute\("aria-pressed",String\(inspectorOpen\)\)/);
  assert.match(app,/closeViewMenu\(\)/);
  assert.match(app,/viewMenu"\)\.querySelector\("summary"\)\.focus\(\)/);
  assert.match(app,/fit\(\);closeViewMenu\(\)/);
});
test("navigation renders nested real file groups and preserves their expansion on source edits",()=>{
  assert.match(app,/const expandedAssetFolders=new Set\(/);
  assert.match(app,/const folderPath=parts\.slice\(0,level\+1\)\.join\("\/"\)/);
  assert.match(app,/disclosure\.open=expandedAssetFolders\.has\(folderPath\)/);
  assert.match(app,/disclosure\.addEventListener\("toggle"/);
  assert.match(app,/folders\.set\(folderPath,children\)/);
  assert.match(app,/btn\.append\(glyph,title\)/);
  assert.match(app,/fileDirtyState\(activePackage,file\.path\)/);
  assert.match(css,/\.asset-folder-children\{[^}]*border-left:1px solid/s);
  assert.match(css,/\.asset-file-label\{[^}]*text-overflow:ellipsis/s);
  assert.match(html,/id="assetTree"/);
});
test("Procedure and Node navigation have lightweight branch symbols and clear indentation",()=>{
  assert.match(app,/index===items\.length-1\?"└":"├"/);
  assert.match(app,/item\.kind==="root"\?"◆"/);
  assert.match(css,/\.procedure-tree button\.child\{padding-left:14px\}/);
  assert.match(css,/\.asset-section \.procedure-tree\{[^}]*border-left:1px solid/s);
  assert.match(css,/\.explorer-nodes\[open\] \.outline\{[^}]*border-left:1px solid/s);
});
test("source-only and Markdown continue to suppress unavailable graph tools",()=>{
  assert.match(app,/graphViewOptions"\)\.hidden=!isGraph/);
  assert.match(app,/zoomViewOptions"\)\.hidden=!isGraph/);
  assert.match(app,/fit"\)\.hidden=!isGraph/);
  assert.match(app,/viewKind==="procedure"&&Boolean\(selection\)/);
});
