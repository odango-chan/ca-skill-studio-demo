import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const html=read("site/index.html"),app=read("site/app.mjs"),css=read("site/light.css");

test("a single Explorer-owned toggle remains mounted in both states",()=>{
  const explorer=html.slice(html.indexOf('<aside class="explorer"'),html.indexOf('</aside>'));
  const toolbar=html.slice(html.indexOf('class="editorbar compact-toolbar"'),html.indexOf('id="editorBody"'));
  assert.match(explorer,/class="explorer-header"/);
  assert.match(explorer,/id="toggleExplorer"/);
  assert.match(explorer,/class="explorer-toggle-caption"[^>]*>展开导航/);
  assert.match(explorer,/aria-controls="explorerPanel"/);
  assert.doesNotMatch(toolbar,/id="toggleExplorer"/);
  assert.doesNotMatch(html,/id="explorerRail"|id="reopenExplorer"/);
  assert.equal((html.match(/id="toggleExplorer"/g)||[]).length,1);
});
test("closing Explorer never sets hidden on the whole aside; the same button reopens it",()=>{
  const start=app.indexOf("function setExplorerOpen(open)");
  const end=app.indexOf('$("inspectorVisibility").addEventListener',start);
  const handler=app.slice(start,end);
  assert.ok(start>=0 && end>start);
  assert.match(handler,/dataset\.explorer=explorerOpen\?"open":"closed"/);
  assert.match(handler,/toggleExplorer"\)\.addEventListener\("click",\(\)=>setExplorerOpen\(!explorerOpen\)\)/);
  assert.doesNotMatch(handler,/explorerPanel"\)\.hidden|explorerRail|reopenExplorer/);
  assert.match(app,/const label=explorerOpen\?"收起左侧导航":"展开左侧导航"/);
  assert.match(app,/nav\.setAttribute\("aria-expanded",String\(explorerOpen\)\)/);
  assert.match(app,/nav\.querySelector\("\.explorer-toggle-icon"\)\.textContent=explorerOpen\?"‹":"›"/);
});
test("the collapsed sidebar and recovery button remain visible across responsive layouts",()=>{
  assert.match(css,/\.workbench\[data-explorer="closed"\] \.explorer\{[^}]*display:flex!important/s);
  assert.match(css,/\.workbench\[data-explorer="closed"\] \.explorer>:not\(\.explorer-header\)\{[^}]*display:none!important/s);
  assert.match(css,/\.workbench\[data-explorer="closed"\] \.explorer-toggle\{[^}]*min-height:120px/s);
  assert.match(css,/\.workbench\[data-explorer="closed"\] \.explorer-toggle-caption\{[^}]*writing-mode:vertical-rl/s);
  assert.match(css,/@media\(max-width:980px\)\{[^]*?\.workbench\[data-inspector="open"\]\[data-explorer="closed"\] \.explorer/s);
  assert.match(css,/@media\(max-width:680px\)\{[^]*?\.workbench\[data-explorer="closed"\] \.explorer-toggle/s);
  assert.doesNotMatch(css,/\.explorer-rail/);
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
