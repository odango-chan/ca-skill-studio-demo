import { layoutProcedure } from "./graph.mjs";
import { layoutProcedureELK } from "./layout.mjs";
import { projectWorkspace } from "./workspace.mjs";
import { routeEditTargets, previewRouteTargetPatch, applyRouteTargetPatch, createEditorHistory } from "./patch.mjs";
import {procedureItems,nodeItems,nodeDetails,routeDetails,nodeJourney} from "./workbench.mjs";
import {SAMPLE_PACKAGES,packageFilesForSample,createFileWorkspace,markFileEdited,hasUnsavedEdits,fileDirtyState} from "./sample-packages.mjs";
import {zipPackage} from "./zip.mjs";
import {highlightSource} from "./highlight.mjs";
import {renderMarkdown} from "./markdown-preview.mjs";
import {viewKindFor,permittedMode,graphControlsAvailable,isMarkdownFile} from "./view-policy.mjs";
import {visualRouteTargets,previewVisualRouteEdit,dropTargetAllowed} from "./visual-route-edit.mjs";
import {mountProcedureCanvas} from "./react-flow-canvas.tsx";
import {createFileIcon,createFolderIcon} from "./file-icons.mjs";
import {phaseVerifyChoices,previewPhaseVerifyPatch,applyPhaseVerifyPatch,
 createdRouteTargets,previewCreatedRoutePatch,applyCreatedRoutePatch} from "./extended-attributes.mjs";
import {nodeVerifyEditChoices,previewVerifyPredicatePatch,applyVerifyPredicatePatch,
  contractMaxActions,previewContractMaxActionsPatch,applyContractMaxActionsPatch} from "./attribute-patch.mjs";

const $ = (id) => document.getElementById(id);
const source = $("source");
const sourceHighlight=$("sourceHighlight");
const sourceEditor=$("sourceEditor");
function syncHighlightScroll(){
  sourceHighlight.scrollTop=source.scrollTop;
  sourceHighlight.scrollLeft=source.scrollLeft;
}
source.addEventListener("scroll",syncHighlightScroll,{passive:true});
function refreshHighlight(){
  const highlighted=highlightSource(source.value,activeFilePath||filename);
  sourceEditor.dataset.highlight=highlighted.enabled?"on":"off";
  $("sourceLanguage").textContent=highlighted.language.toUpperCase();
  if(highlighted.enabled)sourceHighlight.innerHTML=highlighted.html;
  else sourceHighlight.textContent="";
  syncHighlightScroll();
}
const graphPane = $("graphPane");
const nodeOutline = $("nodeOutline");
const inspector = $("inspector");
const problems = $("problems");
const filePicker = $("filePicker");
const procedureTree = $("procedureTree");
let filename = "ensure-pdu-session.procedure.yaml";
let assetOrigin = "sample";
let localProcedureDocument = false;
let activePackage = null;
let activeFilePath = null;
let initialText = "";
let projection = null;
let lastGood = null;
let lastWorkspace = null;
let activeProcedureId = null;
let graph = null;
let selection = null;
let mode = "visual";
let viewKind = "source";
let projectedText = null;
let history = createEditorHistory("");
let pendingPatch = null;
let inspectorOpen = false;
let explorerOpen = true;
const expandedAssetFolders=new Set(["assurance","schemas","scripts"]);
let procedureNavOpen=true;
let showAllLabels = false;
let layoutDirection = "DOWN";
let neighborView = false;
let layoutTicket = 0;
let layoutTimer = null;

// React Flow is confined to the Procedure canvas. The existing Source, Inspector,
// file workspace and Typed Patch remain the only editing/state authority.
const flowCanvas=mountProcedureCanvas($("reactFlowRoot"),{
  onNodeSelect:id=>selectNode(id),
  onNodeDoubleClick:id=>{
    const node=lastGood?.nodes.find(item=>item.id===id);
    if(node?.children?.length===1)enterProcedure(node.children[0].procedure);
  },
  onEdgeSelect:bundle=>chooseEdgeRoute(bundle),
  onReconnect:(routeId,sourceId,targetId)=>{
    if(projection?.state!=="READY"||!lastGood)return;
    const route=lastGood.routes.find(item=>item.id===routeId);
    if(!route||route.source!==sourceId)return;
    const targets=eligibleGraphRouteTargets(route.id);
    if(!dropTargetAllowed(targets,route.target,targetId)){
      message("未应用：目标节点不在允许的 Route 编辑范围内。");return;
    }
    try{showPreview(previewVisualRouteEdit(currentRouteEditContext(route.id),targetId));}
    catch(error){message("Route 修改未应用："+String(error?.message??error));}
  },
  onAmbiguousReconnect:()=>message("该连线包含多个 Outcome。请先选中具体 Route 再重连。"),
  onCreateUnsupported:()=>message("D1 仅迁移画布；新建 Route 将在 D3 引入 YAML Patch 后开放。"),
  onPaneClick:()=>{if(selection)clearSelection();}
});

function invalidateLayout() {
  layoutTicket++;
  if (layoutTimer !== null) {
    clearTimeout(layoutTimer);
    layoutTimer = null;
  }
}
function centerNode(id) { flowCanvas.center(id); }
function scheduleELKLayout(wait=0, autoFit=false) {
  invalidateLayout();
  if (projection?.state!=="READY" || !lastGood) return;
  const ticket=layoutTicket;
  const proc=lastGood, procId=activeProcedureId, revision=projectedText;
  const direction=layoutDirection;
  const focus=neighborView && selection?.kind==="node" ? selection.id : null;
  const filtered=Boolean(focus);
  const fallback=layoutProcedure(proc,direction);
  graph={...fallback, visibleNodes:proc.nodes, visibleRoutes:proc.routes, isFiltered:false};
  renderGraph();
  setText("layoutStatus","正在自动布局…");
  layoutTimer=setTimeout(async()=>{
    layoutTimer=null;
    try{
      const result=await layoutProcedureELK(proc,{
        direction,focus,neighborsOnly:filtered
      });
      if(ticket!==layoutTicket || revision!==projectedText ||
        procId!==activeProcedureId || projection?.state!=="READY")return;
      graph=result;
      renderGraph();
      setText("layoutStatus",result.isFiltered?"邻居视图":"");
      if(autoFit || result.isFiltered)fit();
      else if(selection?.kind==="node")centerNode(selection.id);
    }catch(error){
      if(ticket!==layoutTicket)return;
      graph={...fallback,visibleNodes:proc.nodes,visibleRoutes:proc.routes,isFiltered:false};
      renderGraph();
      setText("layoutStatus","自动布局失败 · 使用基础布局");
      message("自动布局失败，已使用基础画布："+String(error?.message??error));
      if(autoFit)fit();
    }
  },wait);
}


function button(label, handler, className = "") {
  const el = document.createElement("button");
  el.type = "button";
  el.textContent = label;
  if (className) el.className = className;
  el.addEventListener("click", handler);
  return el;
}
function setText(id, text) { $(id).textContent = text; }
function message(text) { setText("hint", text); }

function updatePanelControls(){
  const nav=$("toggleExplorer");
  nav.setAttribute("aria-expanded",String(explorerOpen));
  const label=explorerOpen?"收起左侧导航":"展开左侧导航";
  nav.setAttribute("aria-label",label);
  nav.title=label;
  nav.querySelector(".explorer-toggle-icon").textContent=explorerOpen?"‹":"›";
  const detail=$("inspectorVisibility");
  const available=inspectorOpen||
    (viewKind==="procedure"&&Boolean(selection))||
    (activeFilePath==="assurance/contract.yaml"&&Boolean(activePackage));
  detail.hidden=!available;
  detail.setAttribute("aria-pressed",String(inspectorOpen));
  detail.textContent=inspectorOpen?"隐藏右侧属性":"显示右侧属性";
}
function setInspectorOpen(open,recenter=true) {
  inspectorOpen=Boolean(open);
  const pane=$("workbench");
  pane.dataset.inspector=inspectorOpen?"open":"closed";
  $("inspectorPanel").hidden=!inspectorOpen;
  updatePanelControls();
  if(recenter)requestAnimationFrame(()=>{
    if(selection?.kind==="node")centerNode(selection.id);
    else fit();
  });
}
function setExplorerOpen(open) {
  explorerOpen=Boolean(open);
  $("workbench").dataset.explorer=explorerOpen?"open":"closed";
  // Keep the same Explorer and toggle mounted in both states.
  // Collapsed styling hides only its content; the control remains visible.
  updatePanelControls();
  requestAnimationFrame(()=>{
    if(selection?.kind==="node")centerNode(selection.id);
    else fit();
  });
}
$("toggleExplorer").addEventListener("click",()=>setExplorerOpen(!explorerOpen));
$("inspectorVisibility").addEventListener("click",()=>{
  if(inspectorOpen){
    setInspectorOpen(false);
  }else{
    renderInspector();
    setInspectorOpen(true);
  }
});
$("closeInspector").addEventListener("click",()=>setInspectorOpen(false));
$("showAllLabels").addEventListener("click",()=>{
  showAllLabels=!showAllLabels;
  $("showAllLabels").setAttribute("aria-pressed",String(showAllLabels));
  $("showAllLabels").textContent=showAllLabels?"只显示重点 Route 标签":"显示全部 Route 标签";
  graphPane.dataset.labels=showAllLabels?"all":"key";
  renderGraph();
});
function clearSelection() {
  selection=null;
  renderOutline();
  renderProcedureNavigation();
  renderGraph();
  renderInspector();
  setInspectorOpen(false);
}
function onDirtyNavigation(event) {
  if (source.value !== initialText) {
    event.preventDefault();
    event.returnValue = "";
  }
}
window.addEventListener("beforeunload", onDirtyNavigation);

function setMode(next) {
  const allowed=permittedMode(viewKind,next);
  mode=allowed;
  $("editorBody").dataset.mode=allowed;
  for(const id of ["visual","source","split"]){
    const control=$("mode-"+id);
    control.setAttribute("aria-pressed",String(id===mode));
  }
  if(allowed!=="source"&&viewKind==="procedure"&&lastGood)
    requestAnimationFrame(fit);
}
function updateViewAvailability(nextKind) {
  viewKind=nextKind;
  const isGraph=graphControlsAvailable(viewKind);
  const hasVisual=viewKind!=="source";
  $("editorModes").hidden=!hasVisual;
  $("mode-visual").hidden=!hasVisual;
  $("mode-split").hidden=!hasVisual;
  $("mode-visual").title=viewKind==="markdown"?"Markdown 预览":"Procedure 流程图";
  $("mode-visual").textContent=viewKind==="markdown"?"预览":"Visual";
  $("graphPane").hidden=!isGraph;
  $("markdownPane").hidden=viewKind!=="markdown";
  $("graphViewOptions").hidden=!isGraph;
  $("zoomViewOptions").hidden=!isGraph;
  $("fit").hidden=!isGraph;
  $("procedureBreadcrumbs").hidden=!isGraph;
  updatePanelControls();
  if(!hasVisual&&mode!=="source")setMode("source");
}
function updateMarkdownPreview(text) {
  if(!isMarkdownFile(activeFilePath||filename)){
    $("markdownPreview").replaceChildren();
    return false;
  }
  const rendered=renderMarkdown(text);
  if(rendered.available){
    $("markdownPreview").innerHTML=rendered.html;
    return true;
  }
  $("markdownPreview").replaceChildren();
  return false;
}
for (const id of ["visual", "source", "split"]) $("mode-" + id).addEventListener("click", () => setMode(id));

function loadDocument(name,text,origin="local",{initial=text,historyState=null}={}) {
  filename=name.split("/").at(-1);
  assetOrigin=origin;
  localProcedureDocument=origin==="local"&&/\.ya?ml$/i.test(filename)&&
    (/\bprocedures\s*:/m.test(initial)||/procedure\.ya?ml$/i.test(filename));
  source.scrollTop=0;source.scrollLeft=0;
  initialText=initial;
  source.value=text;
  history=historyState||createEditorHistory(text);
  closePreview();
  selection = null;
  setInspectorOpen(false,false);
  $("search").value = "";
  lastGood = null;
  lastWorkspace = null;
  activeProcedureId = null;
  neighborView = false;
  $("neighborsOnly").setAttribute("aria-pressed","false");
  invalidateLayout();
  projectedText = null;
  setText("fileName", activePackage && activeFilePath
    ? activePackage.name+" / "+activeFilePath : name);
  setText("hint", "");
  refresh(true);
  setMode(viewKind==="source"?"source":"visual");
}
function refresh(refit = false) {
  const text = source.value;
  refreshHighlight();
  const dirty = text !== initialText;
  $("fileStatus").classList.toggle("is-dirty",dirty);
  $("fileStatus").lastChild.textContent = dirty ? "已修改" : "未修改";
  setText("stats", text.split("\n").length + " 行");
  $("undoButton").disabled = !history.canUndo();
  $("redoButton").disabled = !history.canRedo();
  if(activePackage && activeFilePath)
    markFileEdited(activePackage,activeFilePath,text,history);
  const isProcedure=activeFilePath==="assurance/procedure.yaml" || localProcedureDocument;
  const parsed=isProcedure ? projectWorkspace(text)
    : {state:"SOURCE_ONLY",diagnostics:[],entry:null,procedures:new Map(),procedure:null};
  projection=parsed;
  if (parsed.state === "READY") {
    lastWorkspace = parsed;
    if (!activeProcedureId || !parsed.procedures.has(activeProcedureId)) {
      activeProcedureId = parsed.entry;
      selection = null;
    }
    lastGood = parsed.procedures.get(activeProcedureId);
    projectedText = text;
    graph = layoutProcedure(lastGood);
    if (selection && selection.kind === "node" && !lastGood.nodes.some(n => n.id === selection.id)) selection = null;
    if (selection && selection.kind === "route" && !lastGood.routes.some(r => r.id === selection.id)) selection = null;
    setText("projectionState", "图形就绪");
  } else {
    invalidateLayout();
    lastWorkspace=null;
    lastGood=null;
    graph=null;
    activeProcedureId=null;
    selection=null;
    projectedText=null;
    if(parsed.state==="SOURCE_ONLY")
      setText("projectionState","源码编辑");
    else {
      setText("projectionState","投影失败 · 仅源码");
      if(inspectorOpen)setInspectorOpen(false,false);
    }
  }
  const markdownAvailable=updateMarkdownPreview(text);
  updateViewAvailability(viewKindFor({
    path:activeFilePath||filename,projection:parsed,
    previewAvailable:markdownAvailable
  }));
  if(viewKind==="markdown")setText("projectionState","Markdown 预览");
  if(isMarkdownFile(activeFilePath||filename)&&!markdownAvailable)
    setText("projectionState","文件过大 · 仅源码");
  $("graphWarning").hidden=true;
  setText("graphWarning","");
  renderAssetNavigation();
  renderProcedureNavigation();
  renderOutline();
  renderInspector();
  renderProblems();
  renderGraph();
  if (parsed.state === "READY") scheduleELKLayout(refit?0:180,refit);
  else invalidateLayout();
  if (refit && graph) requestAnimationFrame(fit);
}
source.addEventListener("input", () => {
  history.record(source.value);
  closePreview();
  refresh(false);
});

function enterProcedure(name) {
  if (projection?.state !== "READY" || !lastWorkspace?.procedures.has(name)) return;
  if (activeProcedureId === name) return;
  activeProcedureId = name;
  lastGood = lastWorkspace.procedures.get(name);
  graph = layoutProcedure(lastGood);
  selection = null;
  setInspectorOpen(false,false);
  neighborView = false;
  $("neighborsOnly").setAttribute("aria-pressed","false");
  renderProcedureNavigation();
  renderOutline();
  renderInspector();
  renderGraph();
  scheduleELKLayout(0,true);
  requestAnimationFrame(fit);
}
function renderAssetNavigation(){
  const tree=$("assetTree");
  tree.replaceChildren();
  const files=activePackage?[...activePackage.files.values()]:[];
  $("fileCount").textContent=files.length+" 文件";
  $("exportPackageButton").hidden=!activePackage||files.length<=1;
  if(!files.length)return;
  const folders=new Map();
  for(const file of files){
    const parts=file.path.split("/");
    let parent=tree;
    for(let level=0;level<parts.length-1;level++){
      const name=parts[level];
      const folderPath=parts.slice(0,level+1).join("/");
      if(!folders.has(folderPath)){
        const disclosure=el("details","asset-folder-group");
        disclosure.open=expandedAssetFolders.has(folderPath);
        const summary=el("summary","asset-folder-title");
        summary.title=folderPath+"/";
        summary.append(createFolderIcon(document),el("span","asset-folder-label",name+"/"));
        const children=el("div","asset-folder-children");
        disclosure.append(summary,children);
        disclosure.addEventListener("toggle",()=>{
          if(disclosure.open)expandedAssetFolders.add(folderPath);
          else expandedAssetFolders.delete(folderPath);
        });
        parent.appendChild(disclosure);
        folders.set(folderPath,children);
      }
      parent=folders.get(folderPath);
    }
    const dirty=fileDirtyState(activePackage,file.path);
    const current=file.path===activeFilePath;
    const isProcedureFile=file.path==="assurance/procedure.yaml"||
      (current&&localProcedureDocument);
    const btn=button("",()=>{
      if(isProcedureFile&&current&&!procedureNavOpen&&projection?.state==="READY"){
        procedureNavOpen=true;
        renderAssetNavigation();
        renderProcedureNavigation();
      }else switchFile(file.path);
    },"asset-file"+(current?" active":""));
    btn.title=file.path+(dirty?" · 修改未导出":"");
    btn.setAttribute("aria-label",file.path+(dirty?" · 已修改":""));
    btn.setAttribute("aria-current",current?"page":"false");
    const glyph=createFileIcon(document,file.path);
    const title=el("span","asset-file-label",parts.at(-1));
    btn.append(glyph,title);
    if(dirty){
      const mark=el("span","asset-dirty","●");
      mark.setAttribute("aria-label","有未导出修改");
      btn.appendChild(mark);
    }
    if(isProcedureFile){
      const group=el("div","asset-procedure-entry");
      const row=el("div","asset-file-row asset-procedure-row");
      const expanded=current&&procedureNavOpen&&projection?.state==="READY";
      const toggle=button(expanded?"▾":"▸",()=>{
        if(!current){
          procedureNavOpen=true;
          switchFile(file.path);
          return;
        }
        if(projection?.state!=="READY")return;
        procedureNavOpen=!procedureNavOpen;
        renderAssetNavigation();
        renderProcedureNavigation();
      },"asset-procedure-toggle");
      toggle.title=expanded?"收起此文件中的 Procedure":"展开此文件中的 Procedure";
      toggle.setAttribute("aria-label",toggle.title);
      toggle.setAttribute("aria-expanded",String(expanded));
      toggle.setAttribute("aria-controls","procedureTree");
      toggle.disabled=current&&projection?.state!=="READY";
      row.append(toggle,btn);
      group.appendChild(row);
      procedureTree.hidden=!expanded;
      group.appendChild(procedureTree);
      parent.appendChild(group);
    }else{
      const row=el("div","asset-file-row");
      const gutter=el("span","asset-file-gutter");
      gutter.setAttribute("aria-hidden","true");
      row.append(gutter,btn);
      parent.appendChild(row);
    }
  }
}
function switchFile(path){
  const file=activePackage?.files.get(path);
  if(!file||path===activeFilePath)return;
  if(activeFilePath)markFileEdited(activePackage,activeFilePath,source.value,history);
  activeFilePath=path;
  loadDocument(path,file.text,"sample",{
    initial:file.initialText,historyState:file.history
  });
  if(path==="assurance/contract.yaml"&&contractMaxActions(source.value,activePackage.name)){
    setInspectorOpen(true,false);
    renderInspector();
  }
}
function renderProcedureNavigation() {
  const picker = $("procedurePicker");
  const unavailable = projection?.state !== "READY";
  picker.replaceChildren();
  procedureTree.replaceChildren();
  const items=procedureItems(lastWorkspace);
  setText("procedureCount",items.length);
  for(const [index,item] of items.entries()){
    const option=document.createElement("option");
    option.value=item.id;option.textContent=item.id;
    picker.appendChild(option);
    const b=document.createElement("button");
    b.replaceChildren();
    b.type="button";
    b.className=(item.kind==="child"?"child ":"")+(item.id===activeProcedureId?"active":"");
    b.setAttribute("aria-current",item.id===activeProcedureId?"page":"false");
    b.disabled=unavailable;
    const emblem=document.createElement("span");emblem.className="tree-icon";
    emblem.textContent=item.kind==="root"?"◆":index===items.length-1?"└":"├";
    const body=document.createElement("span");body.className="tree-info";
    const title=document.createElement("span");title.className="tree-title";title.textContent=item.title;
    const meta=document.createElement("span");meta.className="tree-description";
    meta.textContent=(item.kind==="root"?"主流程":"子流程")+" · "+item.nodes+" Nodes";
    body.append(title,meta);b.append(emblem,body);
    b.addEventListener("click",()=>enterProcedure(item.id));
    procedureTree.appendChild(b);
  }
  $("nodeOutlineDisclosure").hidden=unavailable;
  if(activeProcedureId)picker.value=activeProcedureId;
  picker.disabled=unavailable;
  const root=Boolean(lastWorkspace&&activeProcedureId===lastWorkspace.entry);
  $("backProcedure").hidden=unavailable||root;
  $("backProcedure").disabled=unavailable||root;
  setText("procedureBread",unavailable?"当前投影不可用":activeProcedureId||"Procedure");
}
$("procedurePicker").addEventListener("change", value => enterProcedure(value.target.value));
$("backProcedure").addEventListener("click", () => {
  if (lastWorkspace) enterProcedure(lastWorkspace.entry);
});

function renderOutline() {
  nodeOutline.replaceChildren();
  const items=nodeItems(lastGood,$("search").value);
  setText("outlineCount",items.length+"/"+(lastGood?.nodes.length??0));
  if(!lastGood || !items.length) {
    const li=document.createElement("li");
    li.className="empty-state";
    li.textContent=lastGood?"没有匹配的节点":"暂无节点";
    nodeOutline.appendChild(li);return;
  }
  for(const item of items){
    const li=document.createElement("li");
    const b=button("",()=>selectNode(item.id));
    const selected=selection?.kind==="node"&&selection.id===item.id;
    if(selected)b.className="active";
    b.disabled=projection?.state!=="READY";
    b.title=item.operator+": "+item.identifier;
    const op=document.createElement("span");
    op.className="outline-kind"+(item.operator==="terminal"?" terminal":"");
    op.textContent=item.operator==="procedure"?"PROC":item.operator==="terminal"?"END":item.operator==="verify"?"CHK":item.operator==="reconcile"?"REC":"CALL";
    const name=document.createElement("span");name.className="outline-name";name.textContent=item.id;
    b.append(op,name);
    if(item.isStart||item.childCount){
      const badge=document.createElement("span");badge.className="outline-arrow";
      badge.textContent=item.isStart?"●":"↗";b.append(badge);
    }
    li.appendChild(b);nodeOutline.appendChild(li);
  }
}
$("search").addEventListener("input",renderOutline);

function lineJump(line) {
  if (!line || line < 1) return;
  if (mode === "visual") setMode("split");
  setInspectorOpen(false,false);
  const lines = source.value.split("\n");
  const before = lines.slice(0, line - 1);
  const index = before.join("\n").length + (before.length ? 1 : 0);
  source.focus();
  source.setSelectionRange(index, index + (lines[line - 1] || "").length);
  const lineHeight = Number.parseFloat(getComputedStyle(source).lineHeight) || 20;
  source.scrollTop = Math.max(0, (line - 4) * lineHeight);
}
function el(tag,className="",text) {
  const item=document.createElement(tag);
  if(className)item.className=className;
  if(text!==undefined)item.textContent=String(text);
  return item;
}
function inspectorLine(label,value,parent=inspector) {
  const row=el("div","inspector-row");
  row.append(el("span","muted",label),el("span","code-value",value));
  parent.appendChild(row);
}
function inspectorTitle(title,parent=inspector) {
  parent.appendChild(el("h3","",title));
}
function inspectorNote(text,parent=inspector) {
  parent.appendChild(el("p","subtle-note",text));
}
function section(title,count) {
  const outer=el("section","inspector-section");
  const head=el("div","inspector-section-head");
  head.append(el("span","",title),el("span","section-count",count));
  const body=el("div","inspector-section-body");
  outer.append(head,body);inspector.appendChild(outer);
  return body;
}
function inspectorRoute(route,parent=inspector) {
  const row=el("div","route-row");
  const b=button(route.outcome+" → "+route.target,()=>selectRoute(route.id),
    selection?.kind==="route" && route.id===selection.id?"active":"");
  b.disabled=projection?.state!=="READY";
  b.title=route.routeSource+" · "+route.id;
  const jump=button("L"+route.line,()=>lineJump(route.line),"source-link");
  row.append(b,jump);parent.appendChild(row);
}

function setInspectorContext(title,caption,kind="") {
  const wrap=$("inspectorContext");
  wrap.replaceChildren();
  if(kind)wrap.appendChild(el("span","kind-label",kind));
  wrap.appendChild(el("h2","",title));
  if(caption)wrap.appendChild(el("p","",caption));
}
function inspectorSourceAction(line,label="查看 YAML") {
  inspector.appendChild(button(label+" · L"+line,()=>lineJump(line),"source-link"));
}
function currentRouteEditContext(routeId){
  return {
    source:source.value,
    procedure:lastGood,
    procedureId:activeProcedureId,
    routeId,
    packageName:activePackage?.name
  };
}
function eligibleGraphRouteTargets(routeId){
  if(viewKind!=="procedure"||projection?.state!=="READY"||!lastGood)return [];
  return visualRouteTargets(currentRouteEditContext(routeId));
}
function addPatchControls(route) {
  const eligible=eligibleGraphRouteTargets(route.id);
  if(!eligible.length)return false;
  const ensure=routeEditTargets(lastGood,route.id).length>0;
  const body=section("Route Target",eligible.length+" 选项");
  const note=ensure?
    "Ensure 仅允许修改两条失败 Route 的终态。":
    "目标来自当前 Procedure 的 Node。可在图上选中连线后拖动 ↗ 到目标节点；修改需预览 Diff。";
  body.appendChild(el("p","small-edit-note",note));
  const select=el("select","target-select");
  select.setAttribute("aria-label","选择当前 Procedure 中的 Route Target");
  for(const target of eligible){
    const opt=el("option","",target);opt.value=target;select.appendChild(opt);
  }
  select.value=route.target;body.appendChild(select);
  const preview=button("预览 Route 修改",()=>{
    try{showPreview(previewVisualRouteEdit(currentRouteEditContext(route.id),select.value));}
    catch(error){message("未应用："+String(error?.message??error));}
  },"preview-button");
  preview.disabled=true;
  select.addEventListener("change",()=>{preview.disabled=select.value===route.target;});
  body.appendChild(preview);
  return true;
}
function packagePredicateSource(){
  return activePackage?.files.get("assurance/predicates.yaml")?.text??null;
}
function selectedPredicateSource(){
  if(activePackage?.name!=="ensure-pdu-session"||
     activeFilePath!=="assurance/procedure.yaml")return null;
  return packagePredicateSource();
}
function verifyNodeChoices(nodeId){
  const predicates=selectedPredicateSource();
  return predicates===null?[]:nodeVerifyEditChoices(source.value,
    activeProcedureId,nodeId,predicates);
}
function addNodeAttributeEditor(model){
  const choices=verifyNodeChoices(model.node.id);
  if(!choices.length)return false;
  const body=section("Verify Predicate","EDITABLE");
  const select=el("select","target-select");
  select.setAttribute("aria-label","选择当前 Package 中的 Predicate");
  for(const predicate of choices){
    const option=el("option","",predicate);option.value=predicate;
    select.appendChild(option);
  }
  select.value=model.node.value;
  const preview=button("预览属性修改",()=>{
    try{
      const predicates=selectedPredicateSource();
      showPreview(previewVerifyPredicatePatch(source.value,activeProcedureId,
        model.node.id,select.value,predicates));
    }catch(error){message("未应用："+String(error?.message??error));}
  },"preview-button");
  preview.disabled=select.value===model.node.value;
  select.addEventListener("change",()=>{
    preview.disabled=select.value===model.node.value;
  });
  body.append(select,preview);
  body.append(el("p","small-edit-note","修改验证引用可能影响业务门禁；此处仅验证源码结构，不运行完整 Runtime Validator。"));
  return true;
}
function renderContractAttributes(){
  const value=contractMaxActions(source.value,activePackage?.name);
  if(!value)return false;
  setInspectorContext("Contract","规划设置","SKILL CONTRACT");
  $("inspectorState").textContent="可修改";
  const body=section("Planning","EDITABLE");
  const label=el("label","attribute-label","maxActions (1–128)");
  const input=el("input","attribute-input");
  input.type="number";input.min="1";input.max="128";input.step="1";
  input.value=String(value.value);input.setAttribute("aria-label","maxActions");
  label.appendChild(input);body.appendChild(label);
  const preview=button("预览属性修改",()=>{
    try{
      showPreview(previewContractMaxActionsPatch(source.value,
        activePackage.name,Number(input.value)));
    }catch(error){message("未应用："+String(error?.message??error));}
  },"preview-button");
  preview.disabled=true;
  input.addEventListener("input",()=>{
    preview.disabled=input.value===""||!input.checkValidity()||
      Number(input.value)===value.value;
  });
  body.appendChild(preview);
  const presets=[4,6,8,12,16,24,32,48,64,96,128];
  const preset=el("select","target-select");
  preset.setAttribute("aria-label","选择常用 maxActions 预算");
  const placeholder=el("option","","选择常用值…");placeholder.value="";
  preset.appendChild(placeholder);
  for(const n of presets){
    const opt=el("option","",String(n));opt.value=String(n);preset.appendChild(opt);
  }
  preset.addEventListener("change",()=>{
    if(!preset.value)return;
    input.value=preset.value;
    preview.disabled=Number(input.value)===value.value;
  });
  body.appendChild(preset);
  inspectorSourceAction(value.line,"查看 YAML");
  body.appendChild(el("p","small-edit-note",
    "只写回 planning.maxActions 的整数标量；其他 Contract 字段可在 Source 修改。"));
  return true;
}
function journeyStage(index,title,summaryText,{expanded=true}={}) {
  const outer=el("details","journey-stage");
  outer.open=expanded;
  const head=el("summary","journey-head");
  const copy=el("span","journey-copy");
  copy.append(el("strong","",title));
  if(summaryText)copy.appendChild(el("small","",summaryText));
  head.append(copy,el("span","journey-chevron","⌄"));
  const body=el("div","journey-body");
  outer.append(head,body);inspector.appendChild(outer);
  return body;
}
function addPhaseVerifyEditor(phase,step,container){
  if(activePackage?.name!=="establish-pdu-session"||
     activeFilePath!=="assurance/procedure.yaml"||
     selection?.kind!=="node"||step.operator!=="verify")return;
  const predicates=packagePredicateSource();
  if(!predicates)return;
  const stepIndex=step.index-1;
  const choices=phaseVerifyChoices(source.value,activePackage.name,
    activeProcedureId,selection.id,phase.name,stepIndex,predicates);
  if(choices.length<2)return;
  const disclosure=el("details","step-enum");
  const summary=el("summary","", "选择 Verify Predicate · "+choices.length+" 项");
  const controls=el("div","step-enum-controls");
  const select=el("select","target-select");
  select.setAttribute("aria-label","选择 "+phase.name+" Step "+step.index+" 的 Predicate");
  for(const choice of choices){
    const option=el("option","",choice);option.value=choice;select.appendChild(option);
  }
  select.value=step.value;
  const preview=button("预览修改",()=>{
    try{
      showPreview(previewPhaseVerifyPatch(source.value,activePackage.name,
        activeProcedureId,selection.id,phase.name,stepIndex,select.value,
        packagePredicateSource()));
    }catch(error){message("未应用："+String(error?.message??error));}
  },"preview-button");
  preview.disabled=true;
  select.addEventListener("change",()=>{
    preview.disabled=select.value===step.value;
  });
  controls.append(select,preview);
  disclosure.append(summary,controls);container.appendChild(disclosure);
}
function renderPhase(phase,body,phaseChildren) {
  if(!phase)return;
  for(const step of phase.steps||[]){
    const item=el("div","journey-step");
    const meta=el("div","step-copy");
    meta.append(el("span","step-op",step.operator.toUpperCase()),
      el("strong","step-value",step.name||step.value));
    if(step.name)meta.append(el("small","",step.value));
    const jump=button("L"+step.line,()=>lineJump(step.line),"source-link");
    item.append(meta,jump);body.appendChild(item);
    addPhaseVerifyEditor(phase,step,body);
    const ref=phaseChildren.find(c=>c.via.startsWith(phase.name+".steps[") &&
      c.procedure===step.value && c.line===step.line);
    if(ref)body.appendChild(button("进入子过程 · "+ref.procedure,
      ()=>enterProcedure(ref.procedure),"journey-child"));
  }

}
function routeFriendlySource(routeSource){
  return routeSource==="preconditions.on"?"准备阶段"
    :routeSource==="postconditions.on"?"确认阶段"
    :routeSource==="operator.on"?"主执行"
    :routeSource;
}
function renderNodeJourney(model) {
  const node=model.node;
  addNodeAttributeEditor(model);
  if(model.prepare.phase || model.prepare.routes.length){
    const body=journeyStage(1,"准备",
      model.prepare.phase?.steps.length ? model.prepare.phase.steps.length+" steps" : "",
      {expanded:false});
    renderPhase(model.prepare.phase,body,model.children);
  }
  const main=journeyStage(2,"执行","");
  const action=el("div","journey-operation");
  action.appendChild(el("strong","step-value",model.execute.value));
  main.appendChild(action);
  main.appendChild(button("查看源码 · L"+node.line,()=>lineJump(node.line),"source-link"));
  for(const child of model.execute.children){
    main.appendChild(button("进入 · "+child.procedure,
      ()=>enterProcedure(child.procedure),"journey-child"));
  }
  if(model.confirm.phase || model.confirm.routes.length){
    const body=journeyStage(3,"确认",
      model.confirm.phase?.steps.length ? model.confirm.phase.steps.length+" steps" : "",
      {expanded:false});
    renderPhase(model.confirm.phase,body,model.children);
  }
  if(model.routeCount){
    const branches=journeyStage(4,"路由",model.routeCount+" 条",{expanded:model.routeCount<=3});
    for(const group of model.branches){
      branches.appendChild(el("div","stage-caption",routeFriendlySource(group.title)));
      for(const route of group.entries)inspectorRoute(route,branches);
    }
  }
  if(model.incoming.length){
    const incoming=el("details","journey-incoming");
    incoming.append(el("summary","","入站路由 · "+
      model.incoming.reduce((n,g)=>n+g.entries.length,0)));
    const body=el("div","journey-body");
    for(const group of model.incoming)
      for(const route of group.entries)inspectorRoute(route,body);
    incoming.appendChild(body);
    inspector.appendChild(incoming);
  }
}
function renderInspector() {
  inspector.replaceChildren();
  if(!lastGood){
    if(activeFilePath==="assurance/contract.yaml"&&renderContractAttributes())return;
    setInspectorContext("文件源码","当前文件可直接在 Source 编辑。");
    $("inspectorState").textContent="SOURCE";
    inspectorNote("当前文件只能使用 Source 工作区。");return;
  }
  if(projection?.state!=="READY"){
    setInspectorContext("投影不可用","当前 Source 的解析诊断尚未解决。");
    $("inspectorState").textContent="STALE";
    inspectorNote("图形已过期且不可操作。请先检查下方 Problems。");return;
  }
  const route=selection?.kind==="route"?routeDetails(lastGood,selection.id):null;
  const model=selection?.kind==="node"?nodeJourney(lastGood,selection.id):null;
  const editable=Boolean(route&&eligibleGraphRouteTargets(route.id).length)||
    Boolean(model&&(verifyNodeChoices(model.node.id).length||
      (activePackage?.name==="establish-pdu-session"&&
       model.node.phases.some(p=>p.steps.some(step=>step.operator==="verify")))));
  $("inspectorState").textContent=editable?"可修改":"只读";
  if(model){
    setInspectorContext(model.node.id,"",
      model.node.operator.toUpperCase()+(model.node.id===lastGood.start?" · START":""));
    renderNodeJourney(model);
    return;
  }
  if(route){
    setInspectorContext(route.source+" → "+route.target,
      route.outcome+" · "+routeFriendlySource(route.routeSource),"ROUTE");
    inspector.appendChild(button("← 来源节点",()=>selectNode(route.source),"journey-back"));
    inspectorLine("Route Source",route.routeSource);
    inspectorSourceAction(route.line,"查看源码");
    addPatchControls(route);
    return;
  }
  setInspectorContext(lastGood.name,"选择一个节点或路由","PROCEDURE");
  inspectorSourceAction(lastGood.line,"查看源码");
}

function renderProblems() {
  const items=projection?.diagnostics??[];
  problems.hidden=items.length===0;
  problems.replaceChildren();
  if(!items.length)return;
  problems.appendChild(el("strong","","问题 · "+items.length));
  for(const item of items){
    problems.appendChild(button("L"+item.line+" · "+item.message,
      ()=>lineJump(item.line)));
  }
}
function selectNode(id) {
  if(projection?.state!=="READY")return;
  selection={kind:"node",id};
  setInspectorOpen(true,false);
  renderOutline();
  renderProcedureNavigation();
  renderInspector();
  if(neighborView)scheduleELKLayout(0,true);
  else{
    renderGraph();
    requestAnimationFrame(()=>centerNode(id));
  }
}
function selectRoute(id) {
  if(projection?.state!=="READY")return;
  selection={kind:"route",id};
  setInspectorOpen(true,false);
  renderOutline();
  renderProcedureNavigation();
  renderInspector();
  renderGraph();
}
function fit(){ if(graph&&lastGood)flowCanvas.fit(); }
$("zoomIn").addEventListener("click",()=>flowCanvas.zoomIn());
$("zoomOut").addEventListener("click",()=>flowCanvas.zoomOut());
$("fit").addEventListener("click",fit);
window.addEventListener("resize",()=>{if(mode!=="source")fit();});
$("layoutDirection").addEventListener("change", event=>{
  const value=event.currentTarget.value;
  if(value!=="RIGHT"&&value!=="DOWN")return;
  layoutDirection=value;
  if(viewKind==="procedure")scheduleELKLayout(0,true);
});
$("neighborsOnly").addEventListener("click",()=>{
  neighborView=!neighborView;
  $("neighborsOnly").setAttribute("aria-pressed",String(neighborView));
  scheduleELKLayout(0,true);
});
$("centerSelection").addEventListener("click",()=>{
  if(selection?.kind==="node")centerNode(selection.id);
  else fit();
});
function chooseEdgeRoute(bundle) {
  const i=bundle.routes.findIndex(r=>selection?.kind==="route"&&selection.id===r.id);
  selectRoute(bundle.routes[(i+1)%bundle.routes.length].id);
}


function renderGraph() {
  flowCanvas.render(graph,lastGood,selection,showAllLabels);
}
function activateWorkspace(workspace,entry,origin="sample") {
  activePackage=workspace;
  activeFilePath=null;
  const file=workspace.files.get(entry);
  if(!file)throw new Error("Workspace entry not found");
  activeFilePath=entry;
  loadDocument(entry,file.text,origin,{initial:file.initialText,historyState:file.history});
}
$("openButton").addEventListener("click",()=>filePicker.click());
filePicker.addEventListener("change",async()=>{
  const file=filePicker.files?.[0];
  if(!file)return;
  filePicker.value="";
  if(file.size>1024*1024){message("仅支持 1 MiB 以内的文本文件");return;}
  if(hasUnsavedEdits(activePackage)&&!confirm("当前工作区还有未导出的修改。确定替换？"))return;
  try{
    const text=await file.text();
    if(text.includes("\u0000"))throw new Error("不支持二进制文件");
    const workspace=createFileWorkspace("local",[{path:file.name,text}]);
    activateWorkspace(workspace,file.name,"local");
  }catch(error){message("本地文件读取失败："+String(error?.message??error));}
});
$("sampleButton").addEventListener("click",async()=>{
  if(hasUnsavedEdits(activePackage)&&!confirm("当前 Package 还有未导出的修改。确定重新载入示例？"))return;
  await loadSample("ensure");
});
$("establishSampleButton").addEventListener("click",async()=>{
  if(hasUnsavedEdits(activePackage)&&!confirm("当前 Package 还有未导出的修改。确定重新载入示例？"))return;
  await loadSample("establish");
});
async function loadSample(sample="ensure"){
  try{
    const spec=SAMPLE_PACKAGES[sample];
    if(!spec)throw new Error("未知示例");
    const files=await Promise.all(packageFilesForSample(sample).map(async item=>{
      const response=await fetch(item.url,{cache:"no-cache"});
      if(!response.ok)throw new Error(item.path+" HTTP "+response.status);
      const text=await response.text();
      return {path:item.path,text};
    }));
    const workspace=createFileWorkspace(spec.name,files);
    activateWorkspace(workspace,spec.entry,"sample");
  }catch(error){
    message("Package 示例读取失败："+String(error?.message??error));
  }
}
function downloadBlob(data,name,type="text/plain;charset=utf-8"){
  const blob=data instanceof Blob?data:new Blob([data],{type});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;a.download=name;
  document.body.appendChild(a);a.click();a.remove();
  window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$("downloadButton").addEventListener("click",()=>{
  downloadBlob(source.value,filename);
  message("已请求下载当前文件；不会直接覆盖本地原文件。");
});
$("exportPackageButton").addEventListener("click",()=>{
  try{
    if(!activePackage||activePackage.files.size<2)return;
    markFileEdited(activePackage,activeFilePath,source.value,history);
    const entries=[...activePackage.files.values()].map(({path,text})=>({path,text}));
    const bytes=zipPackage(entries);
    downloadBlob(bytes,activePackage.name+".zip","application/zip");
    message("已请求下载 Package ZIP（"+entries.length+" 文件）；工作区不变。");
  }catch(error){
    message("导出 Package 失败："+String(error?.message??error));
  }
});
$("resetButton").addEventListener("click",()=>{
  if(source.value!==initialText&&!confirm("丢弃当前文件的修改？"))return;
  source.value=initialText;
  history.record(source.value);
  closePreview();
  refresh(true);
});
function closePreview() {
  pendingPatch = null;
  $("patchDialog").hidden = true;
}
function showPreview(preview) {
  pendingPatch = preview;
  setText("patchDiff", preview.diff);
  setText("patchSummary",preview.summary??(preview.routeId+" · "+preview.oldTarget+" → "+preview.newTarget));
  $("patchDialog").hidden = false;
  $("applyPatch").focus();
}
$("closePatch").addEventListener("click", closePreview);
$("patchDialog").addEventListener("click", event => {
  if (event.target === $("patchDialog")) closePreview();
});
$("applyPatch").addEventListener("click", () => {
  if (!pendingPatch) return;
  try {
    let nextSource;
    if(pendingPatch.type==="SetRouteTarget")
      nextSource=applyRouteTargetPatch(source.value,pendingPatch);
    else if(pendingPatch.type==="SetVerifyPredicate")
      nextSource=applyVerifyPredicatePatch(source.value,pendingPatch,selectedPredicateSource());
    else if(pendingPatch.type==="SetMaxActions")
      nextSource=applyContractMaxActionsPatch(source.value,pendingPatch);
    else if(pendingPatch.type==="SetPhaseVerify")
      nextSource=applyPhaseVerifyPatch(source.value,pendingPatch,packagePredicateSource());
    else if(pendingPatch.type==="SetCreatedRouteTarget")
      nextSource=applyCreatedRoutePatch(source.value,pendingPatch);
    else throw new Error("未知的属性 Patch 类型");
    source.value = nextSource;
    history.record(nextSource);
    closePreview();
    refresh(false);
    message("属性修改已应用到工作缓冲区。可撤销；未执行完整 Runtime Validator。");
  } catch (error) {
    closePreview();
    message("Patch 拒绝应用：" + String(error?.message ?? error));
  }
});
function runHistory(action) {
  closePreview();
  const next = action === "undo" ? history.undo() : history.redo();
  if (next === null) return;
  source.value = next;
  refresh(false);
  message(action === "undo" ? "已撤销一次 Source / Visual 修改" : "已重做一次 Source / Visual 修改");
}
$("undoButton").addEventListener("click", () => runHistory("undo"));
$("redoButton").addEventListener("click", () => runHistory("redo"));
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !$("patchDialog").hidden) { closePreview(); return; }
  if (event.key === "Escape" && !["INPUT","TEXTAREA","SELECT"].includes(document.activeElement?.tagName)) {
    clearSelection();return;
  }
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key === "s") {
    event.preventDefault();
    $("downloadButton").click();
  } else if (key === "z") {
    event.preventDefault();
    runHistory(event.shiftKey ? "redo" : "undo");
  } else if (key === "y") {
    event.preventDefault();
    runHistory("redo");
  }
});
loadSample();
