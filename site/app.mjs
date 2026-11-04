import { layoutProcedure } from "./graph.mjs";
import { layoutProcedureELK,selectGraphScope } from "./layout.mjs";
import {detailedLayoutAllowed} from "./graph-scale.mjs";
import {auditPackageWorkspace} from "./package-audit.mjs";
import { projectWorkspace } from "./workspace.mjs";
import { routeEditTargets, previewRouteTargetPatch, applyRouteTargetPatch, createEditorHistory } from "./patch.mjs";
import {procedureItems,nodeItems,nodeDetails,routeDetails,nodeJourney} from "./workbench.mjs";
import {SAMPLE_PACKAGES,packageFilesForSample,createFileWorkspace,markFileEdited,hasUnsavedEdits,fileDirtyState} from "./sample-packages.mjs";
import {zipPackage} from "./zip.mjs";
import {highlightSource} from "./highlight.mjs";
import {createSourceEditorAdapter, createTextareaSourceBackend} from "./source-editor-adapter.mjs";
import {renderMarkdown} from "./markdown-preview.mjs";
import {viewKindFor,permittedMode,graphControlsAvailable,isMarkdownFile} from "./view-policy.mjs";
import {visualRouteTargets,previewVisualRouteEdit,dropTargetAllowed} from "./visual-route-edit.mjs";
import {mountProcedureCanvas} from "./react-flow-canvas.tsx";
import {createFileIcon,createFolderIcon} from "./file-icons.mjs";
import {createIcon,operatorIcon} from "./icons.mjs";
import {nodeRenameAvailable,previewNodeRename,applyNodeRename} from "./node-designer.mjs";
import {insertNodeOptions,previewNodeInsert,applyNodeInsert} from "./node-create.mjs";
import {deleteNodeOptions,previewNodeDelete,applyNodeDelete} from "./node-delete.mjs";
import {addRouteOutcomeOptions,previewAddRouteOutcome,applyAddRouteOutcome}
  from "./route-create.mjs";
import {routeOutcomeEditOptions,previewRenameRouteOutcome,
  previewDeleteRouteOutcome,applyRenameRouteOutcome,applyDeleteRouteOutcome}
  from "./route-mutate.mjs";
import {proposeCanvasRouteConnection,previewCanvasRouteConnection}
  from "./route-connect.mjs";
import {nodeAttributeState,previewNodeOperatorValue,applyNodeOperatorValue,
 previewNodeBindingFrom,applyNodeBindingFrom} from "./node-attributes.mjs";
import {phaseVerifyChoices,previewPhaseVerifyPatch,applyPhaseVerifyPatch,
 createdRouteTargets,previewCreatedRoutePatch,applyCreatedRoutePatch} from "./extended-attributes.mjs";
import {phaseStepBindingOptions,previewPhaseInputBinding,applyPhaseInputBinding}
  from "./phase-bindings.mjs";
import {phaseOutputReferenceOptions,previewPhaseOutputReference,
  applyPhaseOutputReference} from "./phase-output-refs.mjs";
import {phaseStepDependencyReport} from "./phase-dataflow.mjs";
import {phaseConsumerContractReport} from "./phase-consumer-contract.mjs";
import {nodeVerifyEditChoices,previewVerifyPredicatePatch,applyVerifyPredicatePatch,
  contractMaxActions,previewContractMaxActionsPatch,applyContractMaxActionsPatch} from "./attribute-patch.mjs";

const $ = (id) => document.getElementById(id);
const source = createSourceEditorAdapter(createTextareaSourceBackend($("source")));
const sourceHighlight=$("sourceHighlight");
const sourceEditor=$("sourceEditor");
let monacoBackend=null;
function syncHighlightScroll(){
  sourceHighlight.scrollTop=source.scrollTop;
  sourceHighlight.scrollLeft=source.scrollLeft;
}
source.addEventListener("scroll",syncHighlightScroll,{passive:true});
function refreshHighlight(){
  if(sourceEditor.dataset.monaco==="on"){
    $("sourceLanguage").textContent=languageForMonaco(activeFilePath||filename);
    return;
  }
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
let filename = "establish-pdu-session.procedure.yaml";
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
let canvasRouteProposal = null; // UI-only intent, never a persisted graph edge
let packageDiagnostics = [];
let nodeEditorCache = null;
let inspectorOpen = false;
let explorerOpen = true;
const expandedAssetFolders=new Set(["assurance","schemas","scripts","references"]);
let procedureNavOpen=true;
let showAllLabels = false;
let layoutDirection = "DOWN";
let fitMode = "all"; // a chosen axis survives layout and window resize
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
  onCreateRoute:connection=>{
    if(projection?.state!=="READY"||!lastGood||
       viewKind!=="procedure"||mode==="source")return;
    try{
      const intent=proposeCanvasRouteConnection({
        source:source.value,procedureId:activeProcedureId,
        sourceId:connection.source,targetId:connection.target,
        sourceHandle:connection.sourceHandle,targetHandle:connection.targetHandle
      });
      canvasRouteProposal=intent;
      selectNode(intent.sourceId);
      message("连线只生成了提案；请在右侧选择 Outcome 并预览 Diff。");
    }catch(error){
      canvasRouteProposal=null;
      message("新建 Route 未应用："+String(error?.message??error));
    }
  },
  onPaneClick:()=>{if(canvasRouteProposal)return;if(selection)clearSelection();}
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
  const scope=selectGraphScope(proc,focus,filtered);
  const basic=scope.isFiltered
    ? {...proc,start:focus,nodes:scope.nodes,routes:scope.routes}
    : proc;
  const fallback=layoutProcedure(basic,direction);
  graph={...fallback,visibleNodes:scope.nodes,visibleRoutes:scope.routes,
    isFiltered:scope.isFiltered};
  renderGraph();
  if(!detailedLayoutAllowed(scope)){
    setText("layoutStatus","大型流程 · 基础布局（可使用邻居视图）");
    if(autoFit || scope.isFiltered)requestAnimationFrame(fit);
    return;
  }
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
      graph={...fallback,visibleNodes:scope.nodes,visibleRoutes:scope.routes,
        isFiltered:scope.isFiltered};
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
// Keep labels and stable DOM ids; only the decorative SVG changes.
function setIconLabel(node,name,label){
  node.replaceChildren(createIcon(document,name),
    document.createTextNode(label));
}
function setIconOnly(node,name){
  node.replaceChildren(createIcon(document,name));
}
function decorateToolbar(){
  for(const [id,name] of Object.entries({
    undoButton:"undo-2",redoButton:"redo-2",zoomIn:"zoom-in",
    zoomOut:"zoom-out",backProcedure:"arrow-left",
    closeInspector:"panel-right-close"
  }))setIconOnly($(id),name);
  for(const [id,name,label] of [
    ["downloadButton","download","导出文件"],
    ["openButton","folder-plus","打开本地文件"],
    ["exportPackageButton","archive","导出整个 Package (.zip)"],
    ["mode-source","code-2","Source"],
    ["mode-split","columns-2","Split"],
    ["neighborsOnly","git-branch","邻居"],
    ["centerSelection","locate-fixed","定位"],
    ["fit","maximize","适配"],
    ["fitWidth","fit-width","横向"],
    ["fitHeight","fit-height","纵向"],
    ["resetButton","rotate-ccw","恢复"]
  ])setIconLabel($(id),name,label);
  setIconLabel($("mode-visual"),"network","Visual");
  setIconLabel($("showAllLabels"),"eye","标签");
  setIconLabel($("inspectorVisibility"),"panel-right-open","显示右侧属性");
  const layout=$("layoutDirection").parentElement;
  layout.prepend(createIcon(document,"workflow",{size:15}));
  const search=$("search").parentElement.querySelector("span");
  search.replaceChildren(createIcon(document,"search"));
  for(const element of [
    $("nodeOutlineDisclosure").querySelector("summary"),
    document.querySelector(".sample-picker summary")
  ])element.prepend(createIcon(document,"chevron-right",{
    size:13,className:"disclosure-chevron"
  }));
}
decorateToolbar();
function setText(id, text) { $(id).textContent = text; }
function message(text) { setText("hint", text); }

function updatePanelControls(){
  const nav=$("toggleExplorer");
  nav.setAttribute("aria-expanded",String(explorerOpen));
  const label=explorerOpen?"收起左侧导航":"展开左侧导航";
  nav.setAttribute("aria-label",label);
  nav.title=label;
  nav.querySelector(".explorer-toggle-icon").replaceChildren(createIcon(document,
    explorerOpen?"panel-left-close":"panel-left-open",{size:17}));
  const detail=$("inspectorVisibility");
  const available=inspectorOpen||
    (viewKind==="procedure"&&Boolean(selection))||
    (activeFilePath==="assurance/contract.yaml"&&Boolean(activePackage));
  detail.hidden=!available;
  detail.setAttribute("aria-pressed",String(inspectorOpen));
  setIconLabel(detail,inspectorOpen?"panel-right-close":"panel-right-open",
    inspectorOpen?"隐藏右侧属性":"显示右侧属性");
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
  setIconLabel($("showAllLabels"),"eye",
    showAllLabels?"只显示重点 Route 标签":"显示全部 Route 标签");
  graphPane.dataset.labels=showAllLabels?"all":"key";
  renderGraph();
});
function clearSelection() {
  canvasRouteProposal=null;
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
  if(allowed!=="visual")requestAnimationFrame(()=>source.layout());
}
function updateViewAvailability(nextKind) {
  viewKind=nextKind;
  const isGraph=graphControlsAvailable(viewKind);
  const hasVisual=viewKind!=="source";
  $("editorModes").hidden=!hasVisual;
  $("mode-visual").hidden=!hasVisual;
  $("mode-split").hidden=!hasVisual;
  $("mode-visual").title=viewKind==="markdown"?"Markdown 预览":"Procedure 流程图";
  setIconLabel($("mode-visual"),viewKind==="markdown"?"file-text":"network",
    viewKind==="markdown"?"预览":"Visual");
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
  source.openDocument(name,text);
  history=historyState||createEditorHistory(text);
  closePreview();
  canvasRouteProposal=null;
  fitMode="all";
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
  if(canvasRouteProposal && (canvasRouteProposal.baseSource!==text||
    canvasRouteProposal.procedureId!==activeProcedureId))
    canvasRouteProposal=null;
  refreshHighlight();
  const dirty = text !== initialText;
  $("fileStatus").classList.toggle("is-dirty",dirty);
  $("fileStatus").lastChild.textContent = dirty ? "已修改" : "未修改";
  setText("stats", text.split("\n").length + " 行");
  $("undoButton").disabled = !history.canUndo();
  $("redoButton").disabled = !history.canRedo();
  if(activePackage && activeFilePath)
    markFileEdited(activePackage,activeFilePath,text,history);
  nodeEditorCache=null;
  const isProcedure=activeFilePath==="assurance/procedure.yaml" || localProcedureDocument;
  const parsed=isProcedure ? projectWorkspace(text)
    : {state:"SOURCE_ONLY",diagnostics:[],entry:null,procedures:new Map(),procedure:null};
  projection=parsed;
  // A5 package hints are advisory; a broken Procedure uses the existing
  // authoritative Source parser diagnosis instead of duplicating it here.
  packageDiagnostics=parsed.state==="UNAVAILABLE"?[]:
    auditPackageWorkspace(activePackage,
      activeFilePath==="assurance/procedure.yaml"?text:null);
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
    // Preserve identities through a transient Source parse failure. With
    // graph=null all graphic operations are disabled until valid reprojection.
    if(parsed.state==="SOURCE_ONLY"){
      activeProcedureId=null;
      selection=null;
    }
    projectedText=null;
    if(parsed.state==="SOURCE_ONLY")
      setText("projectionState","源码编辑");
    else {
      setText("projectionState","投影失败 · 仅源码");
      // Keep disclosure state; repairing Source restores Node/Procedure focus.
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
  canvasRouteProposal=null;
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
        summary.append(
          createIcon(document,"chevron-right",{size:13,className:"disclosure-chevron"}),
          createFolderIcon(document),el("span","asset-folder-label",name+"/"));
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
      const toggle=button("",()=>{
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
      setIconOnly(toggle,expanded?"chevron-down":"chevron-right");
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
    const emblem=document.createElement("span");
    emblem.className="tree-icon "+(item.kind==="root"?"tree-icon-root":"tree-icon-child");
    emblem.appendChild(createIcon(document,item.kind==="root"?"workflow":"git-branch",{size:17}));
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
    op.title=item.operator;
    op.appendChild(createIcon(document,operatorIcon(item.operator),{size:16}));
    const name=document.createElement("span");name.className="outline-name";name.textContent=item.id;
    b.append(op,name);
    if(item.isStart||item.childCount){
      const badge=document.createElement("span");badge.className="outline-arrow";
      badge.title=item.isStart?"Start Node":"包含子 Procedure";
      badge.appendChild(createIcon(document,item.isStart?"flag":"git-branch",{size:12}));
      b.append(badge);
    }
    li.appendChild(b);nodeOutline.appendChild(li);
  }
}
$("search").addEventListener("input",renderOutline);

function lineJump(line) {
  if (!line || line < 1) return;
  if (mode === "visual") setMode("split");
  setInspectorOpen(false,false);
  requestAnimationFrame(()=>source.revealLine(line));
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
function addRouteMutationEditor(route,options){
  if(!options)return false;
  const body=section("修改 Outcome","D3-A2 · operator.on");
  body.appendChild(el("p","small-edit-note",
    "仅修改所选原始 Route；同目标的其他 Outcome 不受影响。" +
    "候选来自已观察 Source，结构检查不代表 Runtime 分支完整性。"));
  if(options.renameChoices.length){
    const label=el("label","attribute-label","重命名 Outcome");
    const select=el("select","target-select");
    select.setAttribute("aria-label","D3 重命名 Outcome");
    const placeholder=el("option","","请选择已有候选 Outcome");
    placeholder.value="";select.append(placeholder);
    for(const value of options.renameChoices){
      const opt=el("option","",value);opt.value=value;select.append(opt);
    }
    select.value="";
    label.append(select);body.append(label);
    const preview=button("预览重命名 Outcome",()=>{
      try{
        showPreview(previewRenameRouteOutcome(source.value,activeProcedureId,
          route.id,select.value));
      }catch(error){message("未应用："+String(error?.message??error));}
    },"preview-button");
    preview.disabled=true;
    select.addEventListener("change",()=>{preview.disabled=!select.value;});
    body.append(preview);
  }
  if(options.canDelete){
    body.appendChild(el("p","small-edit-note",
      "删除会丢失此条件的处理分支；必须确认业务允许遗漏该 Outcome。" +
      "受保护状态、最后出口和失去可达性的编辑会被拒绝。"));
    const preview=button("预览删除 Outcome",()=>{
      try{
        showPreview(previewDeleteRouteOutcome(source.value,
          activeProcedureId,route.id));
      }catch(error){message("未应用："+String(error?.message??error));}
    },"preview-button");
    body.append(preview);
  }else if(options.deleteBlockedReason)
    body.appendChild(el("p","small-edit-note",
      "删除已保护："+options.deleteBlockedReason));
  return true;
}

function addInsertNodeEditor(route){
  const options=insertNodeOptions(source.value,activeProcedureId,route.id,
    packagePredicateSource(),activePackage?.name);
  if(!options)return false;
  const body=section("在此 Route 后插入 Node","D2-A2");
  const desc=el("p","small-edit-note",
    "原 Route 将先进入新 Node；Call / Verify 通过指定 Outcome 回到原目标。仅编辑源码，不验证运行时行为。");
  body.append(desc);
  const idLabel=el("label","attribute-label","新 Node ID");
  const idInput=el("input","attribute-input");
  idInput.type="text";idInput.value="new-node";idInput.maxLength=80;
  idInput.setAttribute("aria-label","新 Node ID");
  idLabel.append(idInput);body.append(idLabel);
  const typeLabel=el("label","attribute-label","Operator");
  const type=el("select","target-select");
  type.setAttribute("aria-label","新 Node Operator");
  for(const key of ["terminal","call",...(options.predicates.length?["verify"]:[])]){
    const option=el("option","",key);option.value=key;type.append(option);
  }
  typeLabel.append(type);body.append(typeLabel);
  const valueHost=el("div","node-create-value");
  const outcomeHost=el("div","node-create-outcome");
  body.append(valueHost,outcomeHost);
  const preview=button("预览插入 Node",()=>{
    try{
      const value=valueHost.querySelector("input,select")?.value??"";
      const outcome=type.value==="terminal"?"":outcomeHost.querySelector("input")?.value??"";
      showPreview(previewNodeInsert(source.value,activeProcedureId,route.id,
        {nodeId:idInput.value,operator:type.value,value,outcome},
        packagePredicateSource(),activePackage?.name));
    }catch(error){message("未应用："+String(error?.message??error));}
  },"preview-button");
  function update(){
    const name=idInput.value;
    const val=valueHost.querySelector("input,select")?.value??"";
    const outcome=type.value==="terminal"?"":outcomeHost.querySelector("input")?.value??"";
    preview.disabled=!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name)||
      name.length>80||lastGood.nodes.some(n=>n.id===name)||
      !/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(val)||
      (type.value!=="terminal"&&!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(outcome));
  }
  function fields(){
    valueHost.replaceChildren();outcomeHost.replaceChildren();
    const label=el("label","attribute-label",
      type.value==="terminal"?"Terminal status":
      type.value==="verify"?"Predicate":"Call operation");
    const values=type.value==="terminal"?options.terminalValues:
      type.value==="verify"?options.predicates:null;
    let input;
    if(values){
      input=el("select","target-select");
      for(const value of values){
        const opt=el("option","",value);opt.value=value;input.append(opt);
      }
    }else{
      input=el("input","attribute-input");
      input.type="text";input.placeholder="tool.operation.name";
    }
    input.setAttribute("aria-label","新 Node 值");
    input.addEventListener("input",update);input.addEventListener("change",update);
    label.append(input);valueHost.append(label);
    if(type.value!=="terminal"){
      const routeLabel=el("label","attribute-label","新 Node Outcome");
      const routeInput=el("input","attribute-input");
      routeInput.type="text";
      routeInput.value=type.value==="verify"?"PASS":"COMMITTED";
      routeInput.maxLength=80;
      routeInput.setAttribute("aria-label","新 Node Outcome");
      routeInput.addEventListener("input",update);
      routeLabel.append(routeInput);outcomeHost.append(routeLabel);
    }
    update();
  }
  idInput.addEventListener("input",update);
  type.addEventListener("change",fields);
  body.append(preview);
  fields();
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
function addNodeRenameEditor(model,available){
  if(!available)return false;
  const body=section("Node ID","D2-A1");
  const label=el("label","attribute-label","Node ID");
  const input=el("input","attribute-input");
  input.type="text";input.value=model.node.id;input.maxLength=80;
  input.setAttribute("aria-label","重命名 Node ID");
  input.setAttribute("autocomplete","off");input.setAttribute("spellcheck","false");
  label.appendChild(input);body.appendChild(label);
  const preview=button("预览 Node 重命名",()=>{
    try{
      showPreview(previewNodeRename(source.value,activeProcedureId,model.node.id,input.value));
    }catch(error){message("未应用："+String(error?.message??error));}
  },"preview-button");
  preview.disabled=true;
  input.addEventListener("input",()=>{
    preview.disabled=input.value===model.node.id||
      !/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(input.value);
  });
  body.append(preview,el("p","small-edit-note",
    "同步调整当前 Procedure 的 start、Route 目标和可识别的 from 引用；必须确认 Diff。跨文件语义仍需验证。"));
  return true;
}

function currentNodeAttributes(nodeId){
  return nodeAttributeState(source.value,activeProcedureId,nodeId,
    packagePredicateSource(),activePackage?.name);
}
function addNodeOperatorEditor(model,attributes){
  const operator=attributes?.operator;
  if(!operator)return false;
  const body=section("Operator Value","D2-A4");
  const label=el("label","attribute-label",model.node.operator+" 值");
  let input;
  if(operator.type==="select"){
    input=el("select","target-select");
    for(const v of operator.values){
      const option=el("option","",v);option.value=v;input.append(option);
    }
  }else{
    input=el("input","attribute-input");
    input.type="text";input.maxLength=120;
    input.setAttribute("spellcheck","false");
  }
  input.value=operator.value;
  input.setAttribute("aria-label","编辑 Node Operator 值");
  label.append(input);body.append(label);
  const preview=button("预览 Operator 修改",()=>{
    try{
      showPreview(previewNodeOperatorValue(source.value,activeProcedureId,
        model.node.id,input.value,packagePredicateSource(),activePackage?.name));
    }catch(error){message("Operator 未应用："+String(error?.message??error));}
  },"preview-button");
  const update=()=>{
    preview.disabled=input.value===operator.value||
      !/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(input.value);
  };
  input.addEventListener("input",update);
  input.addEventListener("change",update);
  update();body.append(preview);
  body.append(el("p","small-edit-note",
    "这里只修改现有 Operator 的值，不切换类型。Tool/Call 能否执行、结果类型是否兼容，需另做 Runtime 校验。"));
  return true;
}
function addNodeBindingEditors(model,attributes){
  if(!attributes?.bindings?.length)return false;
  const body=section("with / from",attributes.bindings.length+" BINDINGS · D2-A4");
  body.append(el("p","small-edit-note",
    "仅能将已有 with.<参数>.from 替换为本 Procedure 中出现过的来源或已声明 input；不生成新的输出路径。"));
  for(const binding of attributes.bindings){
    const label=el("label","attribute-label",binding.key+" · from");
    const select=el("select","target-select");
    select.setAttribute("aria-label","Binding 来源 · "+binding.key);
    for(const ref of binding.choices){
      const option=el("option","",ref);option.value=ref;select.append(option);
    }
    select.value=binding.value;label.append(select);body.append(label);
    const preview=button("预览 Binding 修改",()=>{
      try{
        showPreview(previewNodeBindingFrom(source.value,activeProcedureId,
          model.node.id,binding.key,select.value));
      }catch(error){message("Binding 未应用："+String(error?.message??error));}
    },"preview-button");
    preview.disabled=true;
    select.addEventListener("change",()=>{preview.disabled=select.value===binding.value;});
    body.append(preview);
  }
  body.append(el("p","small-edit-note",
    "Binding 类型、操作参数契约和生产者输出结构尚未进行全 Package 验证。"));
  return true;
}

function addCanvasConnectionProposalEditor(model){
  const intent=canvasRouteProposal;
  if(!intent||intent.sourceId!==model.node.id||
    intent.procedureId!==activeProcedureId||
    intent.baseSource!==source.value)return false;
  const body=section("画布连线提案","D3-A3 · operator.on");
  body.appendChild(el("p","small-edit-note",
    intent.sourceId+" → "+intent.targetId+
    "。尚未修改 YAML；请明确选择此连线对应的 Outcome。" +
    " 候选来自当前已观察 Source，不等于 Runtime 允许的结果集合。"));
  const label=el("label","attribute-label","这条新连线的 Outcome");
  const select=el("select","target-select");
  select.setAttribute("aria-label","D3 画布连线 Outcome");
  const placeholder=el("option","","请选择 Outcome");
  placeholder.value="";select.append(placeholder);
  for(const value of intent.outcomes){
    const option=el("option","",value);option.value=value;select.append(option);
  }
  select.value="";label.append(select);body.append(label);
  const preview=button("预览连线新增 Route",()=>{
    try{
      showPreview(previewCanvasRouteConnection(source.value,intent,select.value));
    }catch(error){message("连线提案未应用："+String(error?.message??error));}
  },"preview-button");
  preview.disabled=true;
  select.addEventListener("change",()=>{preview.disabled=!select.value;});
  const cancel=button("放弃连线提案",()=>{
    canvasRouteProposal=null;renderInspector();renderGraph();
    message("连线提案已取消；YAML 未变化。");
  },"");
  body.append(preview,cancel);
  return true;
}

function addRouteOutcomeEditor(model,options){
  if(!options?.outcomes?.length||!options?.targets?.length)return false;
  const body=section("新增 Outcome","D3-A1 · operator.on");
  body.appendChild(el("p","small-edit-note",
    "仅提供当前 Source 中同类 Operator 的已观察 Outcome。" +
    "这是编辑期候选，不能证明 Runtime 接受该 Outcome。"));
  const label=el("label","attribute-label","新增 Outcome");
  const outcome=el("select","target-select");
  outcome.setAttribute("aria-label","D3 新增 Outcome");
  const outcomePlaceholder=el("option","","请选择 Outcome");
  outcomePlaceholder.value="";outcome.append(outcomePlaceholder);
  for(const value of options.outcomes){
    const elOption=el("option","",value);elOption.value=value;
    outcome.append(elOption);
  }
  outcome.value="";label.append(outcome);body.append(label);
  const targetLabel=el("label","attribute-label","Route Target");
  const target=el("select","target-select");
  target.setAttribute("aria-label","D3 新增 Route Target");
  const targetPlaceholder=el("option","","请选择目标 Node");
  targetPlaceholder.value="";target.append(targetPlaceholder);
  for(const value of options.targets){
    const elOption=el("option","",value);elOption.value=value;
    target.append(elOption);
  }
  target.value="";targetLabel.append(target);body.append(targetLabel);
  const preview=button("预览新增 Outcome",()=>{
    try{
      showPreview(previewAddRouteOutcome(source.value,activeProcedureId,
        model.node.id,outcome.value,target.value));
    }catch(error){
      message("新增 Route 未应用："+String(error?.message??error));
    }
  },"preview-button");
  preview.disabled=true;
  const update=()=>preview.disabled=!(outcome.value&&target.value);
  outcome.addEventListener("change",update);
  target.addEventListener("change",update);
  body.append(preview);
  return true;
}

function addNodeDeleteEditor(model,options){
  if(!options)return false;
  const body=section("删除 Node","D2-A3");
  body.append(el("p","small-edit-note",
    options.mode==="merge-terminal"
      ?"将此终态的全部入站 Route 合并到同状态的另一终态。"
      :"此 Node 只有一条出口，可将其入站 Route 转向唯一出口目标。"));
  const label=el("label","attribute-label",
    "入站 Route 重定向目标（"+options.incomingCount+" 条）");
  const select=el("select","target-select");
  select.setAttribute("aria-label","删除 Node 后的重定向目标");
  for(const target of options.targets){
    const opt=el("option","",target);opt.value=target;select.append(opt);
  }
  label.append(select);body.append(label);
  const preview=button("预览删除 Node",()=>{
    try{
      showPreview(previewNodeDelete(source.value,activeProcedureId,model.node.id,
        select.value));
    }catch(error){message("删除未应用："+String(error?.message??error));}
  },"preview-button");
  body.append(preview);
  body.append(el("p","small-edit-note",
    "删除会移除选中 Node 及其出站 Route；仅有界结构检查，不代替业务确认或 Runtime Validator。"));
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
function addPhaseInputBindingEditors(phase,step,container,bindings){
  const options=bindings?.filter(b=>b.phaseName===phase.name&&
    b.stepIndex===step.index-1);
  if(!options?.length)return false;
  const disclosure=el("details","step-enum");
  disclosure.dataset.phaseInputStep=phase.name+":"+step.index;
  disclosure.appendChild(el("summary","",
    "编辑输入绑定 · "+options.length+" 项 · D4-A1"));
  const controls=el("div","step-enum-controls");
  controls.appendChild(el("p","small-edit-note",
    "只允许换成当前 Procedure 已声明且类型相同的 input 来源。" +
    "这是 Source 编辑资格，不保证消费端参数语义或 Runtime 类型完全兼容。"));
  for(const option of options){
    const label=el("label","attribute-label",
      option.bindingKey+" · "+option.inputType+" · from");
    const select=el("select","target-select");
    select.setAttribute("aria-label","D4 "+phase.name+" Step "+step.index+
      " Binding "+option.bindingKey);
    for(const choice of option.choices){
      const row=el("option","",choice);row.value=choice;select.append(row);
    }
    select.value=option.value;
    label.append(select);controls.append(label);
    const preview=button("预览 Phase Binding 修改",()=>{
      try{
        showPreview(previewPhaseInputBinding(source.value,activeProcedureId,
          selection.id,phase.name,step.index-1,option.bindingKey,select.value));
      }catch(error){message("Phase Binding 未应用："+String(error?.message??error));}
    },"preview-button");
    preview.disabled=true;
    select.addEventListener("change",()=>{
      preview.disabled=select.value===option.value;
    });
    controls.append(preview);
  }
  disclosure.append(controls);
  container.append(disclosure);
  return true;
}

function addPhaseOutputReferenceEditors(phase,step,container,references){
  const options=references?.filter(r=>r.phaseName===phase.name&&
    r.stepIndex===step.index-1);
  if(!options?.length)return false;
  const disclosure=el("details","step-enum");
  disclosure.dataset.phaseOutputStep=phase.name+":"+step.index;
  disclosure.appendChild(el("summary","",
    "输出引用写法 · "+options.length+" 项 · D4-A2"));
  const controls=el("div","step-enum-controls");
  controls.appendChild(el("p","small-edit-note",
    "仅切换当前 Source 已使用过的两种等价定位写法：生产者 Step 和输出字段不变，" +
    "且生产者必须早于当前 Step。此操作未验证 Runtime 对引用别名的解释。"));
  for(const option of options){
    const label=el("label","attribute-label",
      option.bindingKey+" · "+option.producerPhase+"."+
      option.producerStep+".output"+option.outputSuffix);
    const select=el("select","target-select");
    select.setAttribute("aria-label","D4 输出引用 "+phase.name+" Step "+
      step.index+" Binding "+option.bindingKey);
    for(const value of option.choices){
      const row=el("option","",value);row.value=value;select.append(row);
    }
    select.value=option.value;
    label.append(select);
    controls.append(label);
    const preview=button("预览 Output Reference 修改",()=>{
      try{
        showPreview(previewPhaseOutputReference(source.value,
          activeProcedureId,selection.id,phase.name,step.index-1,
          option.bindingKey,select.value));
      }catch(error){
        message("输出引用未应用："+String(error?.message??error));
      }
    },"preview-button");
    preview.disabled=true;
    select.addEventListener("change",()=>{
      preview.disabled=select.value===option.value;
    });
    controls.append(preview);
  }
  disclosure.append(controls);container.append(disclosure);
  return true;
}

function addPhaseDependencyInspector(phase,step,container,report,contracts){
  const bindings=report?.status==="READY"?report.bindings.filter(b=>
    b.phaseName===phase.name&&b.stepIndex===step.index-1):[];
  if(!bindings.length)return false;
  const details=el("details","step-enum phase-dependency-review");
  details.dataset.phaseDependencyStep=phase.name+":"+step.index;
  details.appendChild(el("summary","",
    "数据依赖 · "+bindings.length+" 项 · D4-A2.2"));
  const body=el("div","step-enum-controls");
  body.appendChild(el("p","small-edit-note",
    "只读 · 按现有 YAML 追溯生产者和执行顺序。生产者可定位不代表输出可用，"+
    "脚本 schema 存在也不代表消费参数兼容；不开放跨生产者改绑。"));
  for(const entry of bindings){
    const abi=contracts?.status==="READY"?contracts.bindings.find(x=>
      x.phaseName===entry.phaseName&&x.stepIndex===entry.stepIndex&&
      x.bindingKey===entry.bindingKey):null;
    const item=el("div","phase-dependency-item");
    item.dataset.bindingKey=entry.bindingKey;
    item.dataset.producerStatus=entry.status;
    item.dataset.contractStatus=entry.contractStatus;
    item.dataset.consumerStatus=abi?.consumerStatus??"CONSUMER_ABI_UNAVAILABLE";
    item.dataset.typeRelation=abi?.typeRelation??"CONSUMER_ABI_UNPROVEN";
    item.appendChild(el("strong","",entry.bindingKey+" · "+entry.value));
    item.appendChild(el("small","",
      (entry.producerNodeId?
        "生产者 "+entry.producerNodeId+
        (entry.producerPhase?" / "+entry.producerPhase:"")+
        (entry.producerStep?" / "+entry.producerStep:""):
        "Procedure input 或未解析来源")+
      " · "+entry.reason));
    if(entry.contractSchema){
      item.appendChild(el("small","",
        "输出 schema 证据："+entry.contractSchema+
        (entry.outputType?" · 声明类型 "+entry.outputType:"")+
        "；消费参数 ABI 未验证"));
    }else if(entry.outputType){
      item.appendChild(el("small","",
        "输入声明类型："+entry.outputType+"；消费参数 ABI 未验证"));
    }
    if(abi?.consumerSchema){
      item.appendChild(el("small","",
        "消费者输入 schema："+abi.consumerSchema+
        (abi.consumerType?" · 参数类型 "+abi.consumerType:"")+
        (abi.consumerRequired===true?" · 必填":"")+
        (abi.consumerConstraints.length?" · 未核验约束 "+
          abi.consumerConstraints.join(", "):"")));
    }else{
      item.appendChild(el("small","",
        "消费者 ABI："+(abi?.consumerStatus??"未获得声明")+
        " · 无法从当前 Package 确认"));
    }
    const typeText=abi?.typeRelation==="TYPE_ONLY_MATCH"?
      "仅声明类型一致，未验证字段约束、值含义及 Runtime 可用性":
      abi?.typeRelation==="TYPE_MISMATCH"?
        "生产来源与消费参数声明类型不同":
        "生产者/消费者类型、执行依赖或 ABI 证据不足";
    item.appendChild(el("small","phase-contract-verdict",
      "类型对照："+typeText+"；不授权重新绑定"));
    item.appendChild(button("查看源码 · L"+entry.line,()=>lineJump(entry.line),
      "source-link"));
    body.appendChild(item);
  }
  details.append(body);container.append(details);
  return true;
}

function renderPhase(phase,body,phaseChildren,phaseBindings=[],phaseOutputs=[],
  lineage=null,contracts=null) {
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
    addPhaseInputBindingEditors(phase,step,body,phaseBindings);
    addPhaseOutputReferenceEditors(phase,step,body,phaseOutputs);
    addPhaseDependencyInspector(phase,step,body,lineage,contracts);
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
function nodeEditorCapabilities(nodeId){
  const text=source.value,ps=packagePredicateSource(),skill=activePackage?.name;
  if(nodeEditorCache&&nodeEditorCache.text===text&&
     nodeEditorCache.procedure===activeProcedureId&&nodeEditorCache.nodeId===nodeId&&
     nodeEditorCache.predicateSource===ps&&nodeEditorCache.skill===skill)
    return nodeEditorCache.value;
  // One expensive source-backed qualification pass per Inspector selection.
  // A new Source revision or Package PredicateSet invalidates the cache.
  const value={
    attributes:currentNodeAttributes(nodeId),
    deletion:deleteNodeOptions(text,activeProcedureId,nodeId),
    rename:nodeRenameAvailable(text,activeProcedureId,nodeId),
    verify:verifyNodeChoices(nodeId),
    newRoute:addRouteOutcomeOptions(text,activeProcedureId,nodeId),
    phaseBindings:phaseStepBindingOptions(text,activeProcedureId,nodeId),
    phaseOutputs:phaseOutputReferenceOptions(text,activeProcedureId,nodeId)
  };
  nodeEditorCache={text,procedure:activeProcedureId,nodeId,
    predicateSource:ps,skill,value};
  return value;
}

function renderNodeJourney(model,caps) {
  const node=model.node;
  // Uses the current package files for schema evidence, not a cached graph
  // snapshot. This analysis is intentionally read-only.
  const lineage=phaseStepDependencyReport(source.value,
    activeProcedureId,node.id,activePackage?.files);
  const consumerContracts=phaseConsumerContractReport(source.value,
    activeProcedureId,node.id,activePackage?.files,lineage);
  addNodeRenameEditor(model,caps.rename);
  addNodeOperatorEditor(model,caps.attributes);
  addNodeBindingEditors(model,caps.attributes);
  addNodeDeleteEditor(model,caps.deletion);
  addCanvasConnectionProposalEditor(model);
  addRouteOutcomeEditor(model,caps.newRoute);
  if(model.prepare.phase || model.prepare.routes.length){
    const body=journeyStage(1,"准备",
      model.prepare.phase?.steps.length ? model.prepare.phase.steps.length+" steps" : "",
      {expanded:false});
    renderPhase(model.prepare.phase,body,model.children,
      caps.phaseBindings,caps.phaseOutputs,lineage,consumerContracts);
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
    renderPhase(model.confirm.phase,body,model.children,
      caps.phaseBindings,caps.phaseOutputs,lineage,consumerContracts);
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
  if(projection?.state==="UNAVAILABLE"){
    setInspectorContext("投影不可用","Source 修复后可恢复 Procedure / Node 选择");
    $("inspectorState").textContent="STALE";
    inspectorNote("图形编辑已暂停。可在 Source 修复或使用 Undo 恢复。");
    return;
  }
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
  const caps=model?nodeEditorCapabilities(model.node.id):null;
  const mutation=route?routeOutcomeEditOptions(source.value,
    activeProcedureId,route.id):null;
  const editable=Boolean(route&&(eligibleGraphRouteTargets(route.id).length||
    mutation||insertNodeOptions(source.value,activeProcedureId,route.id,
      packagePredicateSource(),activePackage?.name)))||
    Boolean(model&&((caps.attributes?.operator||caps.attributes?.bindings?.length)||
      caps.deletion||caps.rename||caps.verify.length||caps.newRoute||
      caps.phaseBindings?.length||caps.phaseOutputs?.length||
      (activePackage?.name==="establish-pdu-session"&&
       model.node.phases.some(p=>p.steps.some(step=>step.operator==="verify")))));
  $("inspectorState").textContent=editable?"可修改":"只读";
  if(model){
    setInspectorContext(model.node.id,"",
      model.node.operator.toUpperCase()+(model.node.id===lastGood.start?" · START":""));
    renderNodeJourney(model,caps);
    return;
  }
  if(route){
    setInspectorContext(route.source+" → "+route.target,
      route.outcome+" · "+routeFriendlySource(route.routeSource),"ROUTE");
    inspector.appendChild(button("← 来源节点",()=>selectNode(route.source),"journey-back"));
    inspectorLine("Route Source",route.routeSource);
    inspectorSourceAction(route.line,"查看源码");
    addPatchControls(route);
    addRouteMutationEditor(route,mutation);
    addInsertNodeEditor(route);
    return;
  }
  setInspectorContext(lastGood.name,"选择一个节点或路由","PROCEDURE");
  inspectorSourceAction(lastGood.line,"查看源码");
}

function renderProblems() {
  const errors=projection?.diagnostics??[];
  const items=[...errors,...packageDiagnostics];
  problems.hidden=items.length===0;
  problems.replaceChildren();
  if(!items.length)return;
  problems.appendChild(el("strong","",
    errors.length?"问题 · "+errors.length+" / 编辑期提示 · "+packageDiagnostics.length:
      "编辑期提示 · "+packageDiagnostics.length));
  for(const item of items){
    const path=item.path||activeFilePath;
    const label=(item.code?"⚠ ":"")+(path?path+" · ":"")+
      "L"+item.line+" · "+item.message;
    problems.appendChild(button(label,()=>{
      if(path&&activePackage?.files.has(path)&&path!==activeFilePath)
        switchFile(path);
      lineJump(item.line);
    }));
  }
}
function selectNode(id) {
  if(projection?.state!=="READY")return;
  if(canvasRouteProposal&&canvasRouteProposal.sourceId!==id)
    canvasRouteProposal=null;
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
  canvasRouteProposal=null;
  selection={kind:"route",id};
  setInspectorOpen(true,false);
  renderOutline();
  renderProcedureNavigation();
  renderInspector();
  renderGraph();
}
function fit(){
  if(!graph||!lastGood)return;
  if(fitMode!=="all"&&flowCanvas.fitAxis(fitMode))return;
  flowCanvas.fit();
}
$("zoomIn").addEventListener("click",()=>flowCanvas.zoomIn());
$("zoomOut").addEventListener("click",()=>flowCanvas.zoomOut());
$("fit").addEventListener("click",()=>{fitMode="all";fit();});
$("fitWidth").addEventListener("click",()=>{fitMode="width";fit();});
$("fitHeight").addEventListener("click",()=>{fitMode="height";fit();});
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
  const sourceId=selection?.kind==="node"&&
    nodeEditorCapabilities(selection.id).newRoute?.outcomes?.length
    ? selection.id:null;
  flowCanvas.render(graph,lastGood,selection,showAllLabels,sourceId);
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
$("establishSampleButton").addEventListener("click",async()=>{
  if(hasUnsavedEdits(activePackage)&&!confirm("当前 Package 还有未导出的修改。确定重新载入示例？"))return;
  await loadSample("establish");
});
async function loadSample(sample="establish"){
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
  const baseSummary=preview.summary??(preview.routeId+" · "+preview.oldTarget+" → "+preview.newTarget);
  let added=0;
  if(activeFilePath==="assurance/procedure.yaml"&&
     typeof preview.candidateSource==="string"){
    const after=auditPackageWorkspace(activePackage,preview.candidateSource);
    const old=new Set(packageDiagnostics.map(d=>d.code+"|"+d.message));
    added=after.filter(d=>!old.has(d.code+"|"+d.message)).length;
  }
  setText("patchSummary",baseSummary+(added?" · 新增 "+added+" 条编辑期提示（非 Runtime 校验）":""));
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
    else if(pendingPatch.type==="SetPhaseInputFrom")
      nextSource=applyPhaseInputBinding(source.value,pendingPatch);
    else if(pendingPatch.type==="NormalizePhaseOutputReference")
      nextSource=applyPhaseOutputReference(source.value,pendingPatch);
    else if(pendingPatch.type==="SetCreatedRouteTarget")
      nextSource=applyCreatedRoutePatch(source.value,pendingPatch);
    else if(pendingPatch.type==="RenameNode")
      nextSource=applyNodeRename(source.value,pendingPatch);
    else if(pendingPatch.type==="InsertNode")
      nextSource=applyNodeInsert(source.value,pendingPatch,
        packagePredicateSource(),activePackage?.name);
    else if(pendingPatch.type==="DeleteNode")
      nextSource=applyNodeDelete(source.value,pendingPatch);
    else if(pendingPatch.type==="SetNodeOperatorValue")
      nextSource=applyNodeOperatorValue(source.value,pendingPatch,
        packagePredicateSource(),activePackage?.name);
    else if(pendingPatch.type==="SetNodeBindingFrom")
      nextSource=applyNodeBindingFrom(source.value,pendingPatch);
    else if(pendingPatch.type==="AddRouteOutcome")
      nextSource=applyAddRouteOutcome(source.value,pendingPatch);
    else if(pendingPatch.type==="RenameRouteOutcome")
      nextSource=applyRenameRouteOutcome(source.value,pendingPatch);
    else if(pendingPatch.type==="DeleteRouteOutcome")
      nextSource=applyDeleteRouteOutcome(source.value,pendingPatch);
    else throw new Error("未知的属性 Patch 类型");
    if(pendingPatch.type==="RenameNode"&&selection?.kind==="node"&&
       activeProcedureId===pendingPatch.procedureId&&selection.id===pendingPatch.nodeId)
      selection={kind:"node",id:pendingPatch.newId};
    if(pendingPatch.type==="InsertNode"&&activeProcedureId===pendingPatch.procedureId)
      selection={kind:"node",id:pendingPatch.nodeId};
    if(pendingPatch.type==="DeleteNode"&&activeProcedureId===pendingPatch.procedureId)
      selection=null;
    if(pendingPatch.type==="AddRouteOutcome"&&
       activeProcedureId===pendingPatch.procedureId){
      selection={kind:"route",id:pendingPatch.nodeId+":"+pendingPatch.outcome};
      canvasRouteProposal=null;
    }
    if(pendingPatch.type==="RenameRouteOutcome"&&
       activeProcedureId===pendingPatch.procedureId)
      selection={kind:"route",id:pendingPatch.nodeId+":"+pendingPatch.newOutcome};
    if(pendingPatch.type==="DeleteRouteOutcome"&&
       activeProcedureId===pendingPatch.procedureId)
      selection={kind:"node",id:pendingPatch.nodeId};
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
  // Monaco owns its shortcuts while focused; avoid recording two transactions.
  if(sourceEditor.dataset.monaco==="on"&&sourceEditor.contains(document.activeElement))return;
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
// The fallback textarea stays functional until Monaco and its bundled worker
// are available. Source/Visual share the existing adapter throughout.
function languageForMonaco(path){
  return (String(path).match(/\\.([^.]+)$/)?.[1]||"TEXT").replace(/^yml$/i,"YAML").toUpperCase();
}
async function initializeMonaco(){
  const host=$("monacoHost"),mirror=$("source");
  let candidate=null;
  try{
    // Created before importing Monaco: workers are emitted as local Pages assets.
    self.MonacoEnvironment={
      getWorker:()=>new Worker(new URL("./editor.worker.js",import.meta.url),{type:"module"})
    };
    const {createMonacoSourceBackend}=await import("./monaco-source-backend.mjs");
    candidate=createMonacoSourceBackend(host,{
      mirror,
      onUndo:()=>runHistory("undo"),
      onRedo:()=>runHistory("redo"),
      onSave:()=>$("downloadButton").click()
    });
    source.useBackend(candidate);
    monacoBackend=candidate;
    sourceEditor.dataset.monaco="on";
    mirror.setAttribute("aria-hidden","true");
    mirror.tabIndex=-1;
    refreshHighlight();
    requestAnimationFrame(()=>source.layout());
  }catch(error){
    candidate?.dispose();
    // Fail open to the original Source editor, never claim Monaco is available.
    sourceEditor.dataset.monaco="fallback";
    message("Monaco 初始化失败，已保留原始 Source 编辑器："+String(error?.message??error));
  }
}
loadSample().then(initializeMonaco);
