import { layoutProcedure } from "./graph.mjs";
import { layoutProcedureELK } from "./layout.mjs";
import { projectWorkspace } from "./workspace.mjs";
import { routeEditTargets, previewRouteTargetPatch, applyRouteTargetPatch, createEditorHistory } from "./patch.mjs";
import {procedureItems,nodeItems,nodeDetails,routeDetails,nodeJourney} from "./workbench.mjs";

const $ = (id) => document.getElementById(id);
const SVG_NS = "http://www.w3.org/2000/svg";
const source = $("source");
const graphPane = $("graphPane");
const svg = $("canvas");
const world = $("world");
const nodeOutline = $("nodeOutline");
const inspector = $("inspector");
const problems = $("problems");
const filePicker = $("filePicker");
const procedureTree = $("procedureTree");
let filename = "ensure-pdu-session.procedure.yaml";
let assetOrigin = "sample";
let initialText = "";
let projection = null;
let lastGood = null;
let lastWorkspace = null;
let activeProcedureId = null;
let graph = null;
let selection = null;
let mode = "visual";
let camera = { x: 0, y: 0, scale: 1 };
let dragging = null;
let projectedText = null;
let history = createEditorHistory("");
let pendingPatch = null;
let inspectorOpen = false;
let explorerOpen = true;
let showAllLabels = false;
let layoutDirection = "RIGHT";
let neighborView = false;
let layoutTicket = 0;
let layoutTimer = null;

function invalidateLayout() {
  layoutTicket++;
  if (layoutTimer !== null) {
    clearTimeout(layoutTimer);
    layoutTimer = null;
  }
}
function centerNode(id) {
  const p=graph?.positions.get(id);
  if (!p) return;
  const rect=graphPane.getBoundingClientRect();
  camera.x=rect.width/2-(p.x+119)*camera.scale;
  camera.y=rect.height/2-(p.y+40)*camera.scale;
  transform();
}
function scheduleELKLayout(wait=0, autoFit=false) {
  invalidateLayout();
  if (projection?.state!=="READY" || !lastGood) return;
  const ticket=layoutTicket;
  const proc=lastGood, procId=activeProcedureId, revision=projectedText;
  const direction=layoutDirection;
  const focus=neighborView && selection?.kind==="node" ? selection.id : null;
  const filtered=Boolean(focus);
  const fallback=layoutProcedure(proc);
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
      setText("layoutStatus",(result.isFiltered ? "相邻视图 · " : "全图 · ")+
        result.visibleNodes.length+" Node / "+result.visibleRoutes.length+
        " Route · ELK");
      if(autoFit || result.isFiltered)fit();
      else if(selection?.kind==="node")centerNode(selection.id);
    }catch(error){
      if(ticket!==layoutTicket)return;
      graph={...fallback,visibleNodes:proc.nodes,visibleRoutes:proc.routes,isFiltered:false};
      renderGraph();
      setText("layoutStatus","ELK 不可用，回退到基础布局");
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
function svgEl(name, attrs = {}, text) {
  const element = document.createElementNS(SVG_NS, name);
  Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, String(value)));
  if (text !== undefined) element.textContent = String(text);
  return element;
}
function message(text) { setText("hint", text); }

function setInspectorOpen(open,recenter=true) {
  inspectorOpen=Boolean(open);
  const pane=$("workbench");
  pane.dataset.inspector=inspectorOpen?"open":"closed";
  $("inspectorPanel").hidden=!inspectorOpen;
  if(recenter)requestAnimationFrame(()=>{
    if(selection?.kind==="node")centerNode(selection.id);
    else fit();
  });
}
function setExplorerOpen(open) {
  explorerOpen=Boolean(open);
  $("workbench").dataset.explorer=explorerOpen?"open":"closed";
  $("toggleExplorer").setAttribute("aria-expanded",String(explorerOpen));
  $("explorerPanel").hidden=!explorerOpen;
  requestAnimationFrame(()=>{
    if(selection?.kind==="node")centerNode(selection.id);
    else fit();
  });
}
$("toggleExplorer").addEventListener("click",()=>setExplorerOpen(!explorerOpen));
$("closeInspector").addEventListener("click",()=>setInspectorOpen(false));
$("showAllLabels").addEventListener("click",()=>{
  showAllLabels=!showAllLabels;
  $("showAllLabels").setAttribute("aria-pressed",String(showAllLabels));
  $("showAllLabels").textContent=showAllLabels?"只显示重点 Route 标签":"显示全部 Route 标签";
  graphPane.dataset.labels=showAllLabels?"all":"key";
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
  mode = next;
  $("editorBody").dataset.mode = next;
  for (const id of ["visual", "source", "split"]) {
    const el = $("mode-" + id);
    el.setAttribute("aria-pressed", id === mode ? "true" : "false");
  }
  if (next !== "source" && lastGood) requestAnimationFrame(fit);
}
for (const id of ["visual", "source", "split"]) $("mode-" + id).addEventListener("click", () => setMode(id));

function loadDocument(name, text, origin="local") {
  filename = name;
  assetOrigin = origin;
  initialText = text;
  source.value = text;
  history = createEditorHistory(text);
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
  setText("fileName", name);
  setText("titleFile", name);
  setText("hint", "本地 Source 工作缓冲区；不会上传或执行");
  refresh(true);
  if (!lastGood) setMode("source");
  else setMode("visual");
}
function refresh(refit = false) {
  const text = source.value;
  const dirty = text !== initialText;
  setText("dirty", dirty ? "有未导出修改" : "初始版本");
  $("dirty").classList.toggle("is-dirty",dirty);
  $("fileStatus").classList.toggle("is-dirty",dirty);
  $("fileStatus").lastChild.textContent = dirty ? "待导出" : "未修改";
  setText("stats", text.split("\n").length + " 行 · " + new TextEncoder().encode(text).length + " bytes");
  $("undoButton").disabled = !history.canUndo();
  $("redoButton").disabled = !history.canRedo();
  const parsed = projectWorkspace(text);
  projection = parsed;
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
    setText("projectionState", "READY · " + parsed.procedures.size + " Procedures");
  } else {
    setText("projectionState", lastGood ? "STALE · source changed" : "UNAVAILABLE");
    if (!lastGood) graph = null;
  }
  $("graphWarning").hidden = parsed.state === "READY";
  setText("graphWarning", parsed.state === "READY" ? "" : (lastGood ? "Graph 已过期，仅供对照，不能代表当前 Source。" : "当前 Source 无可用的 Procedure 投影。") + " " + (parsed.diagnostics[0]?.message ?? ""));
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
function renderAssetNavigation() {
  const tree=$("assetTree");
  tree.replaceChildren();
  if(assetOrigin==="sample"){
    const folder=el("div","asset-folder");
    folder.textContent="⌄  assurance/";
    tree.appendChild(folder);
  }
  const file=button("▤  "+(assetOrigin==="sample"?"procedure.yaml":filename),
    ()=>{setMode("source");source.focus();},"asset-file active");
  file.title=filename+" · 当前已加载的唯一文件";
  file.setAttribute("aria-current","page");
  tree.appendChild(file);
}
function renderProcedureNavigation() {
  const picker = $("procedurePicker");
  const unavailable = projection?.state !== "READY";
  picker.replaceChildren();
  procedureTree.replaceChildren();
  const items=procedureItems(lastWorkspace);
  setText("procedureCount",items.length);
  for(const item of items){
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
    emblem.textContent=item.kind==="root"?"◆":"◇";
    const body=document.createElement("span");body.className="tree-info";
    const title=document.createElement("span");title.className="tree-title";title.textContent=item.title;
    const meta=document.createElement("span");meta.className="tree-description";
    meta.textContent=(item.kind==="root"?"主流程":"子流程")+" · "+item.nodes+" Nodes";
    body.append(title,meta);b.append(emblem,body);
    b.addEventListener("click",()=>enterProcedure(item.id));
    procedureTree.appendChild(b);
  }
  if(activeProcedureId)picker.value=activeProcedureId;
  picker.disabled=unavailable;
  $("backProcedure").disabled=unavailable||!lastWorkspace||
    activeProcedureId===lastWorkspace.entry;
  setText("procedureBread",unavailable?"当前投影不可用":activeProcedureId||"Procedure");
  setText("workspaceSummary",unavailable?"图形投影不可用":(items.length+" 个 Procedure"));
  setText("editorContext",unavailable?"检查 Source 诊断":
    (selection?.kind==="node"?"已选择节点":selection?.kind==="route"?"已选择路由":"选择节点查看属性"));
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
  wrap.appendChild(el("p","",caption));
}
function inspectorHero(value,description) {
  const hero=el("div","info-hero");
  hero.append(el("strong","",value),el("p","",description));
  inspector.appendChild(hero);
}
function inspectorStats(stats) {
  const grid=el("div","info-stats");
  for(const [number,title] of stats){
    const box=el("div","info-stat");
    box.append(el("strong","",number),el("span","",title));
    grid.appendChild(box);
  }
  inspector.appendChild(grid);
}
function inspectorSourceAction(line,label="查看 YAML") {
  inspector.appendChild(button(label+" · L"+line,()=>lineJump(line),"source-link"));
}
function addPatchControls(route) {
  const eligible=routeEditTargets(lastGood,route.id);
  if(!eligible.length || lastWorkspace?.procedures.size!==1)return false;
  const body=section("允许修改的目标","PATCH");
  body.appendChild(el("p","subtle-note",
    "仅固定 ensure 的两条失败 Route 支持目标修改，必须先预览源码差异；不代表完整 Validator 通过。"));
  const select=el("select","target-select");
  select.setAttribute("aria-label","选择新的终态目标");
  for(const target of eligible){
    const opt=el("option","",target);
    opt.value=target;select.appendChild(opt);
  }
  select.value=route.target;body.appendChild(select);
  const preview=button("预览 YAML 差异",()=>{
    try{showPreview(previewRouteTargetPatch(source.value,route.id,select.value));}
    catch(error){message("未应用："+String(error?.message??error));}
  },"preview-button");
  preview.disabled=true;
  select.addEventListener("change",()=>{preview.disabled=select.value===route.target;});
  body.appendChild(preview);
  return true;
}
function journeyStage(index,title,summaryText,{expanded=true}={}) {
  const outer=el("details","journey-stage");
  outer.open=expanded;
  const head=el("summary","journey-head");
  const number=el("span","journey-number",String(index).padStart(2,"0"));
  const copy=el("span","journey-copy");
  copy.append(el("strong","",title),el("small","",summaryText));
  head.append(number,copy,el("span","journey-chevron","⌄"));
  const body=el("div","journey-body");
  outer.append(head,body);inspector.appendChild(outer);
  return body;
}
function renderPhase(phase,body,phaseChildren) {
  if(!phase){
    body.appendChild(el("p","journey-empty","未声明这一阶段，直接进入下一步。"));return;
  }
  if(!phase.steps?.length){
    body.appendChild(el("p","journey-empty","本阶段没有显式 Steps。"));
  }
  for(const step of phase.steps||[]){
    const item=el("div","journey-step");
    const meta=el("div","step-copy");
    meta.append(el("span","step-op",step.operator.toUpperCase()),
      el("strong","step-value",step.name||step.value));
    if(step.name)meta.append(el("small","",step.value));
    const jump=button("L"+step.line,()=>lineJump(step.line),"source-link");
    item.append(meta,jump);body.appendChild(item);
    const ref=phaseChildren.find(c=>c.via.startsWith(phase.name+".steps[") &&
      c.procedure===step.value && c.line===step.line);
    if(ref)body.appendChild(button("进入子过程 · "+ref.procedure,
      ()=>enterProcedure(ref.procedure),"journey-child"));
  }
  const phaseRoutes=(lastGood?.routes||[]).filter(r=>r.source===selection?.id && r.routeSource===phase.name+".on");
  if(phaseRoutes.length)body.appendChild(el("div","stage-caption",
    phaseRoutes.length+" 条阶段分支 · 见下方「后续分支」"));
}
function routeFriendlySource(routeSource){
  return routeSource==="preconditions.on"?"准备阶段"
    :routeSource==="postconditions.on"?"确认阶段"
    :routeSource==="operator.on"?"主执行"
    :routeSource;
}
function renderNodeJourney(model) {
  const node=model.node;
  const phaseStepCount=p=>p?.phase?.steps?.length??0;
  const prepare=journeyStage(1,"执行前准备",
    model.prepare.phase?phaseStepCount(model.prepare)+" 个 Step":"未声明",{expanded:false});
  renderPhase(model.prepare.phase,prepare,model.children);
  const main=journeyStage(2,"执行 Operator",
    model.execute.operator.toUpperCase()+" · "+model.execute.value);
  const action=el("div","journey-operation");
  action.append(el("span","step-op",model.execute.operator.toUpperCase()),
    el("strong","step-value",model.execute.value));
  main.appendChild(action);
  main.appendChild(button("打开 Operator 对应 YAML · L"+node.line,()=>lineJump(node.line),"source-link"));
  for(const child of model.execute.children){
    main.appendChild(button("进入子过程 · "+child.procedure,
      ()=>enterProcedure(child.procedure),"journey-child"));
  }
  const confirm=journeyStage(3,"执行后确认",
    model.confirm.phase?phaseStepCount(model.confirm)+" 个 Step":"未声明",
    {expanded:false});
  renderPhase(model.confirm.phase,confirm,model.children);
  const branches=journeyStage(4,"后续分支",
    model.routeCount+" 条 Route · "+model.branches.length+" 个来源",{expanded:model.routeCount<=3});
  if(!model.branches.length)branches.appendChild(el("p","journey-empty","终态：没有后续 Route。"));
  for(const group of model.branches){
    const heading=el("div","stage-caption",routeFriendlySource(group.title)+" · "+group.entries.length);
    branches.appendChild(heading);
    for(const route of group.entries)inspectorRoute(route,branches);
  }
  if(model.incoming.length){
    const incoming=el("details","journey-incoming");
    incoming.append(el("summary","", "来自其他节点 · "+
      model.incoming.reduce((n,g)=>n+g.entries.length,0)+" 条"));
    const body=el("div","journey-body");
    for(const group of model.incoming)
      for(const route of group.entries)inspectorRoute(route,body);
    incoming.appendChild(body);inspector.appendChild(incoming);
  }
}
function renderInspector() {
  inspector.replaceChildren();
  if(!lastGood){
    setInspectorContext("尚未载入 Procedure","打开 YAML 文件或加载示例。");
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
  const editable=Boolean(route&&routeEditTargets(lastGood,route.id).length&&lastWorkspace?.procedures.size===1);
  $("inspectorState").textContent=editable?"PATCH AVAILABLE":"READ ONLY";
  if(model){
    setInspectorContext(model.node.id,model.node.value,
      model.node.operator.toUpperCase()+(model.node.id===lastGood.start?" · START":""));
    renderNodeJourney(model);
    return;
  }
  if(route){
    setInspectorContext(route.outcome+" → "+route.target,
      route.source+" · "+routeFriendlySource(route.routeSource),"ROUTE");
    const back=button("← 返回来源节点",()=>selectNode(route.source),"journey-back");
    inspector.appendChild(back);
    const body=section("Route 映射","SOURCE");
    inspectorLine("From",route.source,body);
    inspectorLine("Outcome",route.outcome,body);
    inspectorLine("To",route.target,body);
    inspectorLine("阶段",routeFriendlySource(route.routeSource),body);
    inspectorLine("YAML 行号","L"+route.line,body);
    inspectorSourceAction(route.line,"打开 Route 源码");
    if(!addPatchControls(route))inspectorNote(
      "这条 Route 没有图形修改权限。可以在 Source 中修改 YAML，但需自行校验语义。");
    return;
  }
  setInspectorContext(lastGood.name,
    lastGood.nodes.length+" 个 Node · "+lastGood.routes.length+" 条 Route","PROCEDURE");
  inspectorHero("选择画布中的节点","从 Node 开始，顺着「准备 → 执行 → 确认 → 分支」阅读，再按需打开原始 YAML。");
  inspectorStats([[lastGood.nodes.length,"节点"],[lastGood.routes.length,"路由"],
    [lastGood.children?.length??0,"Child 调用"],[lastWorkspace?.procedures.size??1,"Procedure"]]);
  inspectorSourceAction(lastGood.line,"打开当前 Procedure 源码");
}

function renderProblems() {
  problems.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = "Problems";
  problems.appendChild(title);
  const items = projection?.diagnostics ?? [];
  if (!items.length) {
    const text = document.createElement("span");
    text.className = "problem-success";
    text.textContent = "0";
    text.title = "仅表示当前文件能够进行有限图形投影；不是 Runtime Validator 结论";
    problems.appendChild(text);
  } else {
    for (const item of items) {
      const b = button("L" + item.line + " · " + item.message, () => lineJump(item.line));
      problems.appendChild(b);
    }
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
function transform() { world.setAttribute("transform", "translate(" + camera.x + "," + camera.y + ") scale(" + camera.scale + ")"); }
function fit() {
  if (!graph) return;
  const rect = graphPane.getBoundingClientRect();
  if (rect.width < 80 || rect.height < 80) return;
  const scale = Math.min(1.25, Math.max(0.035, Math.min((rect.width - 60) / graph.width, (rect.height - 60) / graph.height)));
  camera = { scale, x: (rect.width - graph.width * scale) / 2, y: (rect.height - graph.height * scale) / 2 };
  transform();
}
function zoomTo(scale, x = svg.clientWidth / 2, y = svg.clientHeight / 2) {
  const updated = Math.min(2.5, Math.max(0.035, scale));
  const ratio = updated / camera.scale;
  camera.x = x - (x - camera.x) * ratio;
  camera.y = y - (y - camera.y) * ratio;
  camera.scale = updated;
  transform();
}
$("zoomIn").addEventListener("click", () => zoomTo(camera.scale * 1.18));
$("zoomOut").addEventListener("click", () => zoomTo(camera.scale / 1.18));
$("fit").addEventListener("click", fit);
svg.addEventListener("wheel", event => {
  event.preventDefault();
  const rect = svg.getBoundingClientRect();
  zoomTo(camera.scale * (event.deltaY < 0 ? 1.12 : 0.88), event.clientX - rect.left, event.clientY - rect.top);
}, { passive: false });
svg.addEventListener("pointerdown", event => {
  if (event.button !== 0 || event.target.closest("[data-selectable]")) return;
  dragging = { x: event.clientX, y: event.clientY, startX: camera.x, startY: camera.y };
  svg.setPointerCapture(event.pointerId);
});
svg.addEventListener("pointermove", event => {
  if (!dragging) return;
  camera.x = dragging.startX + event.clientX - dragging.x;
  camera.y = dragging.startY + event.clientY - dragging.y;
  transform();
});
svg.addEventListener("pointerup", () => { dragging = null; });
svg.addEventListener("pointercancel", () => { dragging = null; });
window.addEventListener("resize", () => { if (mode !== "source") fit(); });
$("layoutDirection").addEventListener("change", next=>{
  layoutDirection=next;
  scheduleELKLayout(0,true);
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
  world.replaceChildren();
  if (!graph || !lastGood) return;
  const edgesGroup = svgEl("g", { class: "edges" });
  for (const bundle of graph.bundles) {
    const a = graph.positions.get(bundle.source);
    const b = graph.positions.get(bundle.target);
    if (!a || !b) continue;
    const selected = selection?.kind === "route" && bundle.routes.some(r => r.id === selection.id);
    const reverse = b.x <= a.x;
    const nodeWidth=graph.engine==="ELK layered"?238:222;
    const nodeHeight=graph.engine==="ELK layered"?80:74;
    const sx = a.x + nodeWidth, sy = a.y + nodeHeight/2, tx = reverse ? b.x + nodeWidth/2 : b.x, ty = b.y + nodeHeight/2;
    const bend = reverse ? Math.max(110, Math.abs(tx - sx) * .5) : Math.max(50, (tx - sx) * .52);
    const d = bundle.path || ("M " + sx + " " + sy + " C " + (sx + bend) + " " + sy + ", " + (tx - bend) + " " + ty + ", " + tx + " " + ty);
    const keyRoute=bundle.outcomes.some(o=>["PASS","SUCCEEDED"].includes(o));
    const edgeClass="edge"+(selected?" selected":"")+(keyRoute?"":" secondary-label");
    const group = svgEl("g", { class: edgeClass, "data-selectable": "route", tabindex: "0", role: "button", "aria-label": bundle.source + " to " + bundle.target + ": " + bundle.outcomes.join(", ") });
    group.appendChild(svgEl("path", { d, class: "edge-path", "marker-end": "url(#arrowhead)" }));
    group.appendChild(svgEl("path", { d, class: "edge-hit" }));
    const cx = bundle.label?.x ?? (sx + tx) / 2, cy = bundle.label?.y ?? ((sy + ty) / 2 - 8);
    const phase=bundle.routeSource?.replace(".on","")??"operator";
    const text = (phase==="operator"?"":phase+" · ")+bundle.outcomes.join(" / ");
    const short = text.length > 34 ? text.slice(0, 31) + "…" : text;
    group.appendChild(svgEl("rect", { x: cx - Math.max(33, short.length * 3.2 + 12), y: cy - 14, rx: 8, width: Math.max(66, short.length * 6.4 + 24), height: 23, class: "edge-label-bg" }));
    group.appendChild(svgEl("text", { x: cx, y: cy + 2, "text-anchor": "middle", class: "edge-label" }, short));
    group.appendChild(svgEl("title",{},
      bundle.routes.map(r=>r.routeSource+" · "+r.outcome+" → "+r.target).join("\n")));
    group.addEventListener("click",()=>chooseEdgeRoute(bundle));
    group.addEventListener("keydown",event=>{
      if(event.key==="Enter"||event.key===" "){event.preventDefault();chooseEdgeRoute(bundle);}
    });
    edgesGroup.appendChild(group);
  }
  const nodesGroup = svgEl("g", { class: "nodes" });
  for (const node of graph.visibleNodes??lastGood.nodes) {
    const p = graph.positions.get(node.id);
    const selected = selection?.kind === "node" && selection.id === node.id;
    const classes = "node " + (node.operator === "terminal" ? "terminal " : "") + (selected ? "selected" : "");
    const group = svgEl("g", { transform: "translate(" + p.x + "," + p.y + ")", class: classes, "data-selectable": "node", tabindex: "0", role: "button", "aria-label": node.id + ", " + node.operator + " " + node.value });
    group.appendChild(svgEl("rect", { width: graph.engine==="ELK layered"?238:222, height: graph.engine==="ELK layered"?80:74, rx: 13, class: "node-body" }));
    group.appendChild(svgEl("text", { x: 13, y: 19, class: "node-kind" }, node.operator.toUpperCase() + (node.id === lastGood.start ? " · START" : "") + (node.children?.length ? " · CHILD ↗" : "")));
    group.appendChild(svgEl("text", { x: 13, y: 40, class: "node-title" }, node.id.length > 28 ? node.id.slice(0, 27) + "…" : node.id));
    group.appendChild(svgEl("text", { x: 13, y: 59, class: "node-meta" }, node.value.length > 30 ? node.value.slice(0, 29) + "…" : node.value));
    group.addEventListener("click", () => selectNode(node.id));
    group.addEventListener("dblclick", () => {
      if (node.children?.length === 1) enterProcedure(node.children[0].procedure);
    });
    group.addEventListener("keydown", event => { if (event.key === "Enter") selectNode(node.id); });
    nodesGroup.appendChild(group);
  }
  world.append(edgesGroup, nodesGroup);
  transform();
}
$("openButton").addEventListener("click", () => filePicker.click());
filePicker.addEventListener("change", async () => {
  const file = filePicker.files?.[0];
  if (!file) return;
  filePicker.value = "";
  if (file.size > 1024 * 1024) { message("只支持 1 MiB 以内的本地文本文件"); return; }
  if (source.value !== initialText && !confirm("尚有未导出的修改。确定载入其他文件？")) return;
  try {
    const text = await file.text();
    if (text.includes("\u0000")) throw new Error("检测到二进制内容");
    loadDocument(file.name, text);
  } catch (error) { message("本地读取失败：" + String(error?.message ?? error)); }
});
$("sampleButton").addEventListener("click", async () => {
  if (source.value !== initialText && !confirm("尚有未导出的修改。确定重载样本？")) return;
  await loadSample("ensure");
});
$("establishSampleButton").addEventListener("click", async () => {
  if (source.value !== initialText && !confirm("尚有未导出的修改。确定打开 CreatedSession 样本？")) return;
  await loadSample("establish");
});
async function loadSample(sample = "ensure") {
  try {
    const name = sample === "establish" ? "establish-pdu-session" : "ensure-pdu-session";
    const filename = name + ".procedure.yaml";
    const response = await fetch("./samples/" + filename, { cache: "no-cache" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    loadDocument(filename, await response.text(),"sample");
  } catch (error) {
    message("样本加载失败，请从本地打开 YAML：" + String(error?.message ?? error));
    setMode("source");
  }
}
$("downloadButton").addEventListener("click", () => {
  const data = new Blob([source.value], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  message("已请求浏览器导出；请确认下载完成。工作区文件未被直接覆盖。");
});
$("resetButton").addEventListener("click", () => {
  if (source.value !== initialText && !confirm("丢弃全部本地修改？")) return;
  source.value = initialText;
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
  setText("patchSummary", preview.routeId + " · " + preview.oldTarget + " → " + preview.newTarget);
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
    const nextSource = applyRouteTargetPatch(source.value, pendingPatch);
    source.value = nextSource;
    history.record(nextSource);
    closePreview();
    refresh(false);
    message("SetRouteTarget 已应用到工作缓冲区；请审查 Diff 后导出。未运行完整 Validator。");
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
  if (event.key === "Escape" && $("viewMenu").open) {
    $("viewMenu").open=false;
    $("viewMenu").querySelector("summary").focus();
    return;
  }
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
