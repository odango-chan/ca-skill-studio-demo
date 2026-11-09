// A thin IDE-host adapter around the exact Studio projection and ReactFlow.
// No second file tree, Monaco, save buffer, or JS filesystem abstraction.
import "../../../../site/studio.css";
import "../../../../site/light.css";
import "./webview.css";
import {projectWorkspace} from "../../../../site/workspace.mjs";
import {layoutProcedureELK} from "../../../../site/layout.mjs";
import {mountProcedureCanvas} from "../../../../site/react-flow-canvas.tsx";
import {mountNodeFocusCanvas} from "../../../../site/node-focus-flow.tsx";
import {projectNodeFocusFlow} from "../../../../site/node-focus-graph.mjs";
import {routeTargetChoices,previewTargetPatch} from "./route-target.mjs";

const vscode=acquireVsCodeApi();
const $=id=>document.getElementById(id);
let state={text:"",version:0,procedures:null,procedureId:null,graph:null,
  selection:null,pending:null,nodeFocusId:null},epoch=0,focusTicket=0;
const status=text=>{$("message").textContent=text;};
const canvas=mountProcedureCanvas($("reactFlowRoot"),{
  onNodeSelect(id){
    state.selection={kind:"node",id};
    repaint();
    status("已选择节点 "+id+" · 使用右下角 Route 操作区预览受限修改");
  },
  onEdgeSelect(bundle){
    const first=bundle?.routes?.[0];
    if(!first)return;
    state.selection={kind:"route",id:first.id};
    $("routeList").value=first.id;
    refreshTargets();
    repaint();
  },
  onPaneClick(){state.selection=null;repaint();},
  onViewDetails(id){openNodeFocus(id);},
  onEnterChild(_caller,procedureId){if(state.procedures?.has(procedureId))void showProcedure(procedureId);},
  onToggleBranches(){status("分支筛选仍保留在原网页 Demo；此处显示完整声明图");},
  onReconnect(){status("禁止直接拖线修改。请在右下方选择 Route → 预览 Diff → 确认");},
  onCreateRoute(){status("此试验不支持创建 Route");},
  onAmbiguousReconnect(){status("Bundle 含多个 Outcome，必须先选择确切 Route");}
});
const nodeFocusCanvas=mountNodeFocusCanvas($("nodeFocusFlow"),{
  onPivot:id=>openNodeFocus(id),
  onSource:line=>{
    status("正在打开原生 Source 并定位到第 "+line+" 行…");
    vscode.postMessage({type:"revealSourceLine",line});
  }
});
function repaint(){
  if(state.graph&&!state.nodeFocusId){
    canvas.render(state.graph,state.procedures.get(state.procedureId),state.selection,false);
  }
}
function option(select,text,value){
  const o=document.createElement("option");
  o.value=value;o.textContent=text;
  select.appendChild(o);
}
function getProcedure(){return state.procedures?.get(state.procedureId)??null;}
function clearNodeFocus(){
  focusTicket++;
  state.nodeFocusId=null;
  nodeFocusCanvas.clear();
  $("nodeFocus").hidden=true;
  $("reactFlowRoot").hidden=false;
}
function closeNodeFocus(){
  if(!state.nodeFocusId)return;
  clearNodeFocus();
  renderRoutes();
  requestAnimationFrame(()=>canvas.fit());
  status("已返回完整 Procedure 流程图；Source 未被修改。");
}
function openNodeFocus(id){
  const procedure=getProcedure();
  const node=procedure?.nodes.find(item=>item.id===id);
  if(!procedure||!node)return;
  let local;
  try{local=projectNodeFocusFlow(procedure,id);}
  catch(error){
    status("节点局部图不可用："+String(error?.message??error));
    return;
  }
  if(!local)return;
  const ticket=++focusTicket;
  state.nodeFocusId=id;
  state.selection={kind:"node",id};
  state.pending=null;
  $("reactFlowRoot").hidden=true;
  $("nodeFocus").hidden=false;
  $("patch").hidden=true;
  $("nodeFocusTitle").textContent=node.id;
  $("nodeFocusSubtitle").textContent=
    state.procedureId+" · "+node.operator.toUpperCase()+" · L"+node.line;
  $("nodeFocusStats").textContent=local.previousCount+" 上一跳 / "+
    local.nextCount+" 下一跳 · "+local.originalRouteCount+
    " 条真实 Route（灰线仅表示内部阶段顺序）"+
    (!local.previousCount?" · 无上一跳":"")+
    (!local.nextCount?" · 无下一跳":"");
  const children=$("nodeFocusChildren");
  children.replaceChildren();
  for(const ref of node.children??[]){
    if(!state.procedures?.has(ref.procedure))continue;
    const enter=document.createElement("button");
    enter.type="button";
    enter.className="node-focus-subflow";
    enter.textContent="进入子流程 · "+ref.procedure;
    enter.title=ref.via+" · L"+ref.line;
    enter.addEventListener("click",()=>void showProcedure(ref.procedure));
    children.appendChild(enter);
  }
  nodeFocusCanvas.clear();
  status("正在布局 "+id+" 的上一跳、PRE/OP/POST 与下一跳…");
  layoutProcedureELK(local,{direction:"RIGHT",dimensions:local.dimensions})
    .then(layout=>{
      if(ticket!==focusTicket||state.nodeFocusId!==id||
         getProcedure()!==procedure||$("nodeFocus").hidden)return;
      nodeFocusCanvas.render(local,layout);
      status(id+" · "+local.previousCount+" 上一跳 / "+
        local.nextCount+" 下一跳 / "+local.originalRouteCount+
        " 条真实 Route · 只读局部视图");
    })
    .catch(error=>{
      if(ticket!==focusTicket||state.nodeFocusId!==id)return;
      nodeFocusCanvas.clear();
      $("nodeFocusStats").textContent=
        "局部图布局不可用："+String(error?.message??error);
      status("节点局部图布局失败；原始 YAML 未修改。");
    });
}
function routeChoices(routeId){
  const procedure=getProcedure();
  if(!procedure)return [];
  return routeTargetChoices(procedure,routeId);
}
function refreshTargets(){
  state.pending=null;$("commit").disabled=true;$("diff").textContent="";
  const procedure=getProcedure(),routeId=$("routeList").value;
  const route=procedure?.routes.find(r=>r.id===routeId);
  const targets=routeChoices(routeId).filter(x=>x!==route?.target);
  const menu=$("targetList");
  menu.replaceChildren();
  for(const name of targets)option(menu,name,name);
  $("preview").disabled=!targets.length;
  if(!targets.length)status("该 Route 不满足当前 Source-backed Patch 资格；仍可原生编辑 YAML");
  if(route)state.selection={kind:"route",id:route.id};
  repaint();
}
function renderRoutes(){
  const procedure=getProcedure(),list=$("routeList");
  list.replaceChildren();
  for(const route of procedure?.routes??[]){
    const usable=routeChoices(route.id).some(x=>x!==route.target);
    if(usable)option(list,route.source+" / "+route.outcome+
      " ["+route.routeSource+"] → "+route.target,route.id);
  }
  $("patch").hidden=Boolean(state.nodeFocusId)||!list.options.length;
  if(list.options.length)refreshTargets();
}
async function showProcedure(id){
  const procedure=state.procedures?.get(id);
  if(!procedure)return;
  clearNodeFocus();
  const ticket=++epoch;
  state.procedureId=id;state.selection=null;state.graph=null;state.pending=null;
  $("procedureList").value=id;
  $("patch").hidden=true;
  status("ELK 正在布局 "+id+"（不修改 YAML）…");
  try{
    const graph=await layoutProcedureELK(procedure,{direction:"DOWN"});
    if(ticket!==epoch)return;
    state.graph=graph;repaint();renderRoutes();canvas.fit();
    status(id+" · "+procedure.nodes.length+" Nodes / "+procedure.routes.length+
      " Outcomes / "+graph.bundles.length+" Bundles · YAML Source 由 IDE 管理");
  }catch(error){
    if(ticket!==epoch)return;
    status("布局失败："+String(error?.message??error));
  }
}
function receiveSnapshot(data){
  if(typeof data.text!=="string"||data.text.length>1024*1024||
     !Number.isSafeInteger(data.version))return;
  ++epoch;
  clearNodeFocus();
  state={...state,text:data.text,version:data.version,graph:null,selection:null,pending:null};
  $("revision").textContent="TextDocument v"+data.version;
  $("patch").hidden=true;
  const model=projectWorkspace(data.text);
  if(model.state!=="READY"){
    state.procedures=null;
    canvas.render(null,null,null,false);
    status("Source-only · "+(model.diagnostics?.[0]?.message||"当前 YAML 无法安全投影"));
    return;
  }
  const previous=state.procedureId;
  state.procedures=model.procedures;
  const list=$("procedureList");list.replaceChildren();
  for(const proc of model.procedures.values())
    option(list,proc.name+" ("+proc.nodes.length+" Nodes)",proc.name);
  void showProcedure(model.procedures.has(previous)?previous:model.entry);
}
$("procedureList").addEventListener("change",event=>void showProcedure(event.target.value));
$("routeList").addEventListener("change",refreshTargets);
$("targetList").addEventListener("change",()=>{
  state.pending=null;$("commit").disabled=true;$("diff").textContent="";
});
$("openSource").addEventListener("click",()=>vscode.postMessage({type:"openSource"}));
$("nodeFocusReturn").addEventListener("click",closeNodeFocus);
$("nodeFocusFit").addEventListener("click",()=>nodeFocusCanvas.fit());
$("preview").addEventListener("click",()=>{
  const procedure=getProcedure();
  if(!procedure)return;
  try{
    const preview=previewTargetPatch(state.text,state.procedureId,
      $("routeList").value,$("targetList").value);
    state.pending=preview;
    $("diff").textContent=preview.diff;
    $("commit").disabled=false;
    status("只生成 Diff；尚未修改文件。请检查后显式确认。");
  }catch(error){
    state.pending=null;$("commit").disabled=true;
    status("Patch 预览失败："+String(error?.message??error));
  }
});
$("commit").addEventListener("click",()=>{
  const p=state.pending;if(!p)return;
  const procedureId=state.procedureId,routeId=$("routeList").value;
  $("commit").disabled=true;
  // Host independently recomputes the exact bounded patch against the
  // current TextDocument version; untrusted webview candidate cannot bypass it.
  vscode.postMessage({type:"applyRoute",expectedVersion:state.version,
    baseSource:state.text,candidateSource:p.candidateSource,
    procedureId,routeId,newTarget:$("targetList").value});
  status("已提交 Patch 请求；等待原生 TextDocument 确认…");
});
window.addEventListener("message",event=>{
  const data=event.data;
  if(!data||typeof data!=="object")return;
  if(data.type==="snapshot")receiveSnapshot(data);
  else if(data.type==="error")status("操作失败："+data.message);
  else if(data.type==="applied")status("WorkspaceEdit 已应用；IDE 负责撤销、保存和文件事件");
});
vscode.postMessage({type:"ready"});
