import { layoutProcedure } from "./graph.mjs";
import { layoutProcedureELK } from "./layout.mjs";
import { projectWorkspace } from "./workspace.mjs";
import { routeEditTargets, previewRouteTargetPatch, applyRouteTargetPatch, createEditorHistory } from "./patch.mjs";
import {procedureItems,nodeItems,nodeDetails,routeDetails,inspectorTabItems,preferredTab} from "./workbench.mjs";

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
let inspectorTab = "overview";
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

function loadDocument(name, text) {
  filename = name;
  initialText = text;
  source.value = text;
  history = createEditorHistory(text);
  closePreview();
  selection = null;
  inspectorTab = "overview";
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
  inspectorTab = "overview";
  neighborView = false;
  $("neighborsOnly").setAttribute("aria-pressed","false");
  renderProcedureNavigation();
  renderOutline();
  renderInspector();
  renderGraph();
  scheduleELKLayout(0,true);
  requestAnimationFrame(fit);
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
function inspectorNavigation() {
  const tablist=$("inspectorTabs");
  tablist.replaceChildren();
  const items=inspectorTabItems(selection);
  if(!items.some(item=>item.id===inspectorTab))inspectorTab="overview";
  for(const item of items){
    const tab=button(item.name,()=>{
      inspectorTab=item.id;
      renderInspector();
    });
    tab.setAttribute("role","tab");
    tab.setAttribute("aria-selected",String(inspectorTab===item.id));
    tab.setAttribute("tabindex",inspectorTab===item.id?"0":"-1");
    tab.addEventListener("keydown",event=>{
      if(event.key!=="ArrowLeft" && event.key!=="ArrowRight")return;
      event.preventDefault();
      const idx=items.findIndex(x=>x.id===inspectorTab);
      const next=items[(idx+(event.key==="ArrowRight"?1:items.length-1))%items.length];
      inspectorTab=next.id;renderInspector();
      [...tablist.querySelectorAll('button')].find(b=>b.textContent===next.name)?.focus();
    });
    tablist.appendChild(tab);
  }
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
function inspectorSourceAction(line,label="在 Source 中定位") {
  inspector.appendChild(button(label+" · L"+line,()=>lineJump(line),"source-link"));
}
function addPatchControls(route) {
  const eligible=routeEditTargets(lastGood,route.id);
  if(!eligible.length || lastWorkspace?.procedures.size!==1)return false;
  const body=section("修改目标 · 有限授权","PATCH");
  const note=el("p","subtle-note",
    "仅固定 ensure 的两条失败 Route 可修改目标。Source Diff 确认后应用；不代表完整 Validator 通过。");
  body.appendChild(note);
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
function renderInspector() {
  inspector.replaceChildren();
  if(!lastGood){
    setInspectorContext("尚未载入 Procedure","打开一个 YAML 文件或加载示例。");
    $("inspectorState").textContent="SOURCE";
    inspectorTab="overview";inspectorNavigation();
    inspectorNote("当前文件仅可在 Source 工作区查看或编辑。");return;
  }
  if(projection?.state!=="READY"){
    setInspectorContext("投影不可用","当前 Source 与图形不同步。");
    $("inspectorState").textContent="STALE";
    inspectorTab="overview";inspectorNavigation();
    inspectorNote("Source 存在无法安全投影的修改。请先解决诊断；图形及 Inspector 的选择已停用。");return;
  }
  const route=selection?.kind==="route" ? routeDetails(lastGood,selection.id):null;
  const node=selection?.kind==="node" ? nodeDetails(lastGood,selection.id):null;
  const editable=Boolean(route&&routeEditTargets(lastGood,route.id).length&&lastWorkspace?.procedures.size===1);
  $("inspectorState").textContent=editable?"PATCH":"READ ONLY";
  if(!node&&!route){
    setInspectorContext(lastGood.name,"Procedure · "+lastGood.nodes.length+" Nodes / "+lastGood.routes.length+" Routes","PROCEDURE");
    inspectorTab="overview";inspectorNavigation();
    inspectorHero("从画布开始","点击节点查看 Operator、Condition 与 Route。也可以从左侧的 Node 列表快速定位。");
    inspectorStats([[lastGood.nodes.length,"Nodes"],[lastGood.routes.length,"Route entries"],
      [lastGood.children?.length??0,"Child calls"],[lastWorkspace?.procedures.size??1,"Procedures"]]);
    const details=section("当前 Procedure","SOURCE");
    inspectorLine("Start",lastGood.start,details);
    inspectorLine("Source", "L"+lastGood.line,details);
    inspectorLine("可视化","源文件只读投影",details);
    inspectorSourceAction(lastGood.line,"查看 Procedure 定义");
    return;
  }
  if(node){
    setInspectorContext(node.node.id,node.node.value,node.node.operator.toUpperCase()+(node.start?" · START":""));
    inspectorNavigation();
    if(inspectorTab==="overview"){
      inspectorHero(node.node.operator.toUpperCase()+" · "+node.node.value,
        node.childRefs.length?"此节点包含 Child Procedure 调用。":"当前节点的主要 Operator 与基本信息。");
      const meta=section("基础属性","SOURCE");
      inspectorLine("Node ID",node.node.id,meta);
      inspectorLine("Operator",node.node.operator.toUpperCase(),meta);
      inspectorLine("行号","L"+node.node.line,meta);
      inspectorLine("Start",node.start?"是":"否",meta);
      inspectorSourceAction(node.node.line,"定位节点定义");
      if(node.childRefs.length){
        const children=section("子过程调用",node.childRefs.length);
        for(const child of node.childRefs){
          inspectorLine("来源",child.via+" · L"+child.line,children);
          children.appendChild(button("进入 · "+child.procedure,
            ()=>enterProcedure(child.procedure),"preview-button"));
        }
      }
      inspectorStats([[node.conditions.reduce((n,p)=>n+p.steps.length,0),"Phase steps"],
        [node.routeCount,"Outgoing routes"]]);
    }else if(inspectorTab==="conditions"){
      if(!node.conditions.length){
        inspectorHero("未定义前后置条件","此节点没有显式的 Preconditions 或 Postconditions；不会自动创建额外的检查节点。");
      }else{
        for(const phase of node.conditions){
          const body=section(phase.name==="preconditions"?"前置条件":"后置条件",
            phase.steps.length+" STEPS");
          inspectorLine("YAML 位置","L"+phase.line,body);
          for(const step of phase.steps){
            const label=step.index+". "+(step.name?step.name+" · ":"")+
              step.operator.toUpperCase()+" "+step.value;
            const control=button(label,()=>lineJump(step.line),"phase-step");
            control.title="定位 Source L"+step.line;
            body.appendChild(control);
          }
          if(!phase.steps.length)body.appendChild(el("p","muted","无显式 Steps"));
          inspectorLine("Phase routes",phase.routeCount,body);
        }
      }
      inspectorNote("Phase Steps 属于局部过程，按 YAML 顺序展示，不会作为单独业务 Node 插入流程图。");
    }else if(inspectorTab==="routes"){
      if(!node.outgoing.length)inspectorHero("终态节点","当前节点没有 Outgoing Route。");
      for(const group of node.outgoing){
        const body=section("出站 · "+group.title,group.entries.length);
        for(const item of group.entries)inspectorRoute(item,body);
      }
      if(node.incoming.length){
        for(const group of node.incoming){
          const body=section("入站 · "+group.title,group.entries.length);
          for(const item of group.entries)inspectorRoute(item,body);
        }
      }
    }
  }else if(route){
    setInspectorContext(route.outcome+" → "+route.target,
      route.source+" · "+route.routeSource,"ROUTE");
    inspectorNavigation();
    if(inspectorTab==="overview"){
      inspectorHero("来源明确的 Route","当前连线由 YAML 中的明确 Outcome 映射生成，视图中的分组不会合并原始 Route。");
      const meta=section("Route 信息","SOURCE");
      inspectorLine("Source",route.source,meta);
      inspectorLine("Outcome",route.outcome,meta);
      inspectorLine("Target",route.target,meta);
      inspectorLine("来源",route.routeSource,meta);
      inspectorSourceAction(route.line,"定位 YAML Route");
    }else{
      const meta=section("路由映射","SOURCE");
      inspectorLine("From",route.source,meta);
      inspectorLine("Outcome",route.outcome,meta);
      inspectorLine("To",route.target,meta);
      inspectorLine("Route Source",route.routeSource,meta);
      inspectorLine("行号","L"+route.line,meta);
      inspectorSourceAction(route.line,"跳转到 Route 源码");
      addPatchControls(route);
    }
  }
  inspectorNote(lastWorkspace?.procedures.size>1
    ?"当前多 Procedure 与 Phase 保持只读；可在 Source 编辑，图形不获得新的修改授权。"
    :"仅特定 ensure 失败 Route 允许受限修改；其他结构仍为只读。");
}
function renderProblems() {
  problems.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = "PROBLEMS";
  problems.appendChild(title);
  const items = projection?.diagnostics ?? [];
  if (!items.length) {
    const text = document.createElement("span");
    text.className = "problem-success";
    text.textContent = "0 个投影问题";
    problems.appendChild(text);
    problems.appendChild(el("span","muted",
      "本地结构投影 · 不代表完整 Runtime Validator PASS"));
  } else {
    for (const item of items) {
      const b = button("L" + item.line + " · " + item.message, () => lineJump(item.line));
      problems.appendChild(b);
    }
  }
}
function selectNode(id) {
  if (projection?.state !== "READY") return;
  selection = {kind:"node",id};
  inspectorTab = preferredTab(selection);
  renderOutline();
  renderProcedureNavigation();
  renderInspector();
  if(neighborView)scheduleELKLayout(0,true);
  else{
    renderGraph();
    centerNode(id);
  }
}
function selectRoute(id) {
  if(projection?.state!=="READY")return;
  selection={kind:"route",id};
  inspectorTab=preferredTab(selection);
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
    const group = svgEl("g", { class: selected ? "edge selected" : "edge", "data-selectable": "route", tabindex: "0", role: "button", "aria-label": bundle.source + " to " + bundle.target + ": " + bundle.outcomes.join(", ") });
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
    loadDocument(filename, await response.text());
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
