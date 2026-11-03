// D1 integration acceptance: real Chromium DOM events against React Flow,
// the existing Inspector, YAML Diff, history and responsive workbench.
// Source YAML is restored after each test. No backend/network integration.
const wrap=(lines)=>["(async()=>{",...lines,"})()"].join("\n");

async function check(evaluate,name,lines){
  const result=await evaluate(wrap(lines));
  console.log("D1_BROWSER_"+name,JSON.stringify(result));
  if(!result?.ok)throw Error("D1 "+name+" FAIL: "+JSON.stringify(result));
  return result;
}

const sleepLine=" const sleep=t=>new Promise(r=>setTimeout(r,t));";
const clickLine=" const click=el=>el?.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));";

export async function runD1Interactions(evaluate,command){
  await check(evaluate,"NODE_INSPECTOR",[
    sleepLine,clickLine,
    " const node=document.querySelector('.react-flow__node');",
    " const id=node?.getAttribute('data-id');",
    " click(node);",
    " for(let i=0;i<30;i++){",
    "  if(document.querySelector('#inspectorContext h2')?.textContent===id)break;",
    "  await sleep(80);",
    " }",
    " const title=document.querySelector('#inspectorContext h2')?.textContent;",
    " const highlighted=document.querySelectorAll('.designer-node.is-selected').length;",
    " return {ok:!!id&&title===id&&highlighted===1&&document.getElementById('workbench').dataset.inspector==='open',",
    "  id,title,inspectorState:document.getElementById('inspectorState')?.textContent,",
    "  nodeSelected:highlighted,wrapperSelected:document.querySelectorAll('.react-flow__node.selected').length};"
  ]);

  await check(evaluate,"ROUTE_DIFF_HISTORY",[
    sleepLine,clickLine,
    " const source=document.getElementById('source');",
    " const before=source.value;",
    " let selected=null,changedTo=null;",
    " for(let i=0;i<48;i++){",
    "  const edge=document.querySelector('.react-flow__edge[data-id=\"flow-edge-'+i+'\"]');",
    "  if(!edge)continue;",
    "  click(edge);await sleep(55);",
    "  const select=document.querySelector('#inspector select[aria-label=\"选择当前 Procedure 中的 Route Target\"]');",
    "  const choice=select&&[...select.options].find(o=>o.value!==select.value);",
    "  if(choice){selected={edge:'flow-edge-'+i,old:select.value};changedTo=choice.value;break;}",
    " }",
    " if(!selected)return {ok:false,reason:'no editable route found from graph edge'};",
    " const context=document.getElementById('inspectorContext')?.textContent;",
    " const routeSelected=context?.includes('ROUTE');",
    " const select=document.querySelector('#inspector select[aria-label=\"选择当前 Procedure 中的 Route Target\"]');",
    " select.value=changedTo;select.dispatchEvent(new Event('change',{bubbles:true}));",
    " const preview=document.querySelector('#inspector .preview-button');",
    " if(!preview||preview.disabled)return {ok:false,reason:'preview disabled',selected,changedTo};",
    " click(preview);await sleep(55);",
    " const dialog=document.getElementById('patchDialog');",
    " const diff=document.getElementById('patchDiff')?.textContent;",
    " const previewed=!dialog.hidden&&diff?.includes('@@')&&source.value===before;",
    " click(document.getElementById('closePatch'));await sleep(30);",
    " const cancelled=dialog.hidden&&source.value===before;",
    " click(preview);await sleep(40);",
    " if(dialog.hidden)return {ok:false,reason:'preview did not reopen',selected};",
    " click(document.getElementById('applyPatch'));await sleep(75);",
    " const modified=source.value;",
    " const applied=dialog.hidden&&modified!==before&&",
    "  !document.getElementById('undoButton').disabled;",
    " click(document.getElementById('undoButton'));await sleep(60);",
    " const undone=source.value===before&&!document.getElementById('redoButton').disabled;",
    " click(document.getElementById('redoButton'));await sleep(65);",
    " const redone=source.value===modified;",
    " click(document.getElementById('undoButton'));await sleep(70);",
    " const restored=source.value===before;",
    " return {ok:Boolean(routeSelected&&previewed&&cancelled&&applied&&undone&&redone&&restored),",
    "  selected,changedTo,routeSelected,previewed,cancelled,applied,undone,redone,restored,",
    "  diffSnippet:diff?.slice(0,160),projection:document.getElementById('projectionState')?.textContent};"
  ]);

  await check(evaluate,"SOURCE_SPLIT_FAIL_CLOSED",[
    sleepLine,clickLine,
    " const source=document.getElementById('source');",
    " const before=source.value;",
    " click(document.getElementById('mode-split'));",
    " for(let i=0;i<55;i++){",
    "  if(document.getElementById('layoutStatus')?.textContent!=='正在自动布局…'&&",
    "    document.querySelectorAll('.react-flow__edge-path').length===48)break;",
    "  await sleep(100);",
    " }",
    " const split=document.getElementById('editorBody').dataset.mode==='split';",
    " const edgeCount=document.querySelectorAll('.react-flow__edge-path').length;",
    " const hasGraph=edgeCount===48;",
    " click(document.getElementById('mode-source'));",
    " const sourceMode=document.getElementById('editorBody').dataset.mode==='source';",
    " click(document.getElementById('mode-split'));",
    " const edit=before+'\\n# D1 browser Source sync\\n';",
    " source.value=edit;source.dispatchEvent(new Event('input',{bubbles:true}));",
    " await sleep(300);",
    " const synced=document.getElementById('projectionState')?.textContent==='图形就绪'&&",
    "  document.querySelectorAll('.react-flow__node').length===17;",
    " click(document.getElementById('undoButton'));await sleep(220);",
    " const undo=source.value===before;",
    " click(document.getElementById('redoButton'));await sleep(220);",
    " const redo=source.value===edit;",
    " click(document.getElementById('undoButton'));await sleep(220);",
    " source.value='kind: [\\n';source.dispatchEvent(new Event('input',{bubbles:true}));",
    " await sleep(170);",
    " const invalid=document.getElementById('projectionState')?.textContent?.includes('投影失败')&&",
    "  document.querySelectorAll('.react-flow__node').length===0;",
    " click(document.getElementById('undoButton'));await sleep(620);",
    " const recovered=source.value===before&&",
    "  document.getElementById('projectionState')?.textContent==='图形就绪'&&",
    "  document.querySelectorAll('.react-flow__node').length===17;",
    " click(document.getElementById('mode-visual'));await sleep(160);",
    " return {ok:Boolean(split&&hasGraph&&sourceMode&&synced&&undo&&redo&&invalid&&recovered),",
    "  split,hasGraph,edgeCount,sourceMode,synced,undo,redo,invalid,recovered,",
    "  currentMode:document.getElementById('editorBody').dataset.mode};"
  ]);

  await check(evaluate,"CHILD_NAVIGATION",[
    sleepLine,clickLine,
    " const child=document.querySelector('#procedureTree button.child');",
    " const childName=child?.textContent;",
    " if(!child)return {ok:false,reason:'no Child Procedure navigation'};",
    " click(child);",
    " for(let i=0;i<60;i++){",
    "  if(document.querySelectorAll('.react-flow__node').length!==17&&",
    "    document.getElementById('backProcedure')?.hidden===false)break;",
    "  await sleep(100);",
    " }",
    " const childNodes=document.querySelectorAll('.react-flow__node').length;",
    " const bread=document.getElementById('procedureBread')?.textContent;",
    " const entered=childNodes>0&&childNodes!==17&&",
    "  document.getElementById('backProcedure').hidden===false;",
    " click(document.getElementById('backProcedure'));",
    " for(let i=0;i<80;i++){",
    "  if(document.querySelectorAll('.react-flow__node').length===17&&",
    "    document.querySelectorAll('.react-flow__edge-path').length===48)break;",
    "  await sleep(110);",
    " }",
    " const root=document.querySelectorAll('.react-flow__node').length===17&&",
    "  document.querySelectorAll('.react-flow__edge-path').length===48;",
    " return {ok:Boolean(entered&&root),childName,bread,childNodes,entered,root};"
  ]);

  await check(evaluate,"NAV_ZOOM_LAYOUT",[
    sleepLine,clickLine,
    " const workbench=document.getElementById('workbench');",
    " const toggle=document.getElementById('toggleExplorer');",
    " click(toggle);await sleep(150);",
    " const hidden=workbench.dataset.explorer==='closed'&&",
    "  toggle.getBoundingClientRect().width>10&&getComputedStyle(toggle).display!=='none';",
    " click(toggle);await sleep(150);",
    " const reopened=workbench.dataset.explorer==='open';",
    " const viewport=document.querySelector('.react-flow__viewport');",
    " const transform=()=>getComputedStyle(viewport).transform;",
    " const original=transform();",
    " click(document.getElementById('zoomIn'));await sleep(400);",
    " const zoomed=transform()!==original;",
    " click(document.getElementById('zoomOut'));await sleep(350);",
    " const layout=document.getElementById('layoutDirection');",
    " layout.value='RIGHT';layout.dispatchEvent(new Event('change',{bubbles:true}));",
    " for(let i=0;i<70;i++){",
    "  if(document.getElementById('layoutStatus')?.textContent!=='正在自动布局…'&&",
    "    document.querySelectorAll('.react-flow__edge-path').length===48)break;",
    "  await sleep(100);",
    " }",
    " const horizontal=document.querySelectorAll('.react-flow__node').length===17&&",
    "  document.querySelectorAll('.react-flow__edge-path').length===48;",
    " layout.value='DOWN';layout.dispatchEvent(new Event('change',{bubbles:true}));",
    " await sleep(800);click(document.getElementById('fit'));",
    " return {ok:Boolean(hidden&&reopened&&zoomed&&horizontal),",
    "  hidden,reopened,zoomed,horizontal,original,afterZoom:transform()};"
  ]);

  await command("Emulation.setDeviceMetricsOverride",{
    width:390,height:844,deviceScaleFactor:1,mobile:true
  });
  try{
    await check(evaluate,"MOBILE_RECOVERY",[
      sleepLine,clickLine,
      " const workbench=document.getElementById('workbench');",
      " const toggle=document.getElementById('toggleExplorer');",
      " click(toggle);await sleep(200);",
      " const rect=toggle.getBoundingClientRect();",
      " const visible=workbench.dataset.explorer==='closed'&&",
      "  rect.width>20&&rect.height>20&&rect.left>=0&&rect.right<=window.innerWidth;",
      " const caption=toggle.querySelector('.explorer-toggle-caption');",
      " const text=caption?.textContent;",
      " click(toggle);await sleep(200);",
      " return {ok:visible&&workbench.dataset.explorer==='open',",
      "  width:window.innerWidth,visible,text,toggleRect:rect.toJSON(),",
      "  reopened:workbench.dataset.explorer==='open'};"
    ]);
  }finally{
    await command("Emulation.clearDeviceMetricsOverride");
  }
}
