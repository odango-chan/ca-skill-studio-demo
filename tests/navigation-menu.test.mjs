import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const html=read("site/index.html"),app=read("site/app.mjs"),css=read("site/light.css");

test("sidebar toggle lives in its own Explorer header, with a separate reopen rail",()=>{
  const explorer=html.slice(html.indexOf('<aside class="explorer"'),html.indexOf('</aside>'));
  const rail=html.slice(html.indexOf('id="explorerRail"'),html.indexOf('class="editor"'));
  const toolbar=html.slice(html.indexOf('class="editorbar compact-toolbar"'),html.indexOf('id="editorBody"'));
  assert.match(explorer,/class="explorer-header"/);
  assert.match(explorer,/id="toggleExplorer"/);
  assert.match(rail,/id="reopenExplorer"/);
  assert.match(rail,/aria-controls="explorerPanel"/);
  assert.doesNotMatch(toolbar,/id="toggleExplorer"|id="reopenExplorer"/);
  for(const id of ["toggleExplorer","explorerRail","reopenExplorer"])
    assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1);
});
test("sidebar can be reopened after closing, without relying on an editor menu",()=>{
  assert.match(app,/function updatePanelControls\(\)/);
  assert.match(app,/explorerRail"\)\.hidden=explorerOpen/);
  assert.match(app,/explorerPanel"\)\.hidden=!explorerOpen/);
  assert.match(app,/reopenExplorer"\)\.addEventListener\("click",\(\)=>setExplorerOpen\(true\)\)/);
  assert.match(app,/toggleExplorer"\)\.addEventListener\("click",\(\)=>setExplorerOpen\(false\)\)/);
  assert.match(app,/aria-expanded",String\(explorerOpen\)/);
  assert.match(css,/\.workbench\[data-explorer="closed"\]\{grid-template-columns:38px minmax\(0,1fr\)/);
  assert.match(css,/\.explorer-rail\{/);
});
test("graph display controls are not hidden in a View menu",()=>{
  const toolbar=html.slice(html.indexOf('class="editorbar compact-toolbar"'),html.indexOf('id="editorBody"'));
  assert.doesNotMatch(html,/id="viewMenu"|id="viewMenuTitle"/);
  for(const id of ["editorModes","mode-visual","mode-source","mode-split",
    "graphViewOptions","layoutDirection","neighborsOnly","showAllLabels",
    "centerSelection","fit","inspectorVisibility","resetButton"]){
    assert.match(toolbar,new RegExp('id="'+id+'"'));
  }
  assert.match(app,/graphViewOptions"\)\.hidden=!isGraph/);
  assert.match(app,/fit"\)\.hidden=!isGraph/);
  assert.match(app,/inspectorVisibility"\)\.addEventListener\("click"/);
  assert.doesNotMatch(app,/viewMenu|closeViewMenu/);
});
test("zoom controls are at the left of the graph, not inside toolbar or menu",()=>{
  const graph=html.slice(html.indexOf('<div id="graphPane"'),html.indexOf('<div id="markdownPane"'));
  const toolbar=html.slice(html.indexOf('class="editorbar compact-toolbar"'),html.indexOf('id="editorBody"'));
  for(const id of ["zoomViewOptions","zoomIn","zoomOut"]){
    assert.match(graph,new RegExp('id="'+id+'"'));
    assert.doesNotMatch(toolbar,new RegExp('id="'+id+'"'));
  }
  assert.match(css,/\.graph-pane \.canvas-zoom-tools\{[^}]*left:12px;bottom:12px/s);
  assert.match(app,/zoomViewOptions"\)\.hidden=!isGraph/);
});
test("contract and procedure file names align despite procedure disclosure arrow",()=>{
  assert.match(app,/const row=el\("div","asset-file-row asset-procedure-row"\)/);
  assert.match(app,/const row=el\("div","asset-file-row"\)/);
  assert.match(app,/const gutter=el\("span","asset-file-gutter"\)/);
  assert.match(app,/row\.append\(gutter,btn\)/);
  assert.match(app,/row\.append\(toggle,btn\)/);
  assert.match(app,/group\.appendChild\(procedureTree\)/);
  assert.match(css,/\.asset-tree \.asset-file-gutter,\s*\.asset-tree \.asset-procedure-toggle\{/);
  assert.match(css,/\.asset-tree \.asset-file-row>\.asset-file\{/);
  assert.match(css,/\.asset-tree \.asset-procedure-entry \.procedure-tree\{/);
});
test("navigation remains hierarchical and source remains authoritative",()=>{
  assert.match(app,/const expandedAssetFolders=new Set\(/);
  assert.match(app,/disclosure\.open=expandedAssetFolders\.has\(folderPath\)/);
  assert.match(app,/procedureTree\.hidden=!expanded/);
  assert.match(app,/fileDirtyState\(activePackage,file\.path\)/);
  assert.match(app,/history\.record\(source\.value\)/);
  assert.match(app,/previewVisualRouteEdit/);
});
