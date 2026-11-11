// Browser smoke via Chrome DevTools Protocol, no third-party test runtime.
import {createServer} from "node:http";
import {readFile,mkdtemp,rm} from "node:fs/promises";
import {existsSync,createReadStream} from "node:fs";
import {spawn} from "node:child_process";
import {runD1Interactions} from "./d1-interaction-smoke.mjs";
import {tmpdir} from "node:os";
import {join,extname,resolve,sep} from "node:path";

const chrome=process.env.CHROME_BIN||
  ["/usr/bin/google-chrome","/usr/bin/google-chrome-stable","/usr/bin/chromium"].find(existsSync);
if(!chrome)throw Error("Chrome unavailable for browser smoke");
const dist=resolve("dist");
for(const asset of ["app.js","editor.worker.js","yaml.worker.js"]){
  if(!existsSync(resolve(dist,asset)))throw Error("Required local Monaco asset missing: "+asset);
}
for(const legacy of ["samples/packages/ensure-pdu-session","samples/ensure-pdu-session.procedure.yaml"]){
  if(existsSync(resolve(dist,legacy)))throw Error("Legacy Ensure asset leaked into Pages dist: "+legacy);
}
const types={".html":"text/html",".css":"text/css",".js":"text/javascript",".yaml":"text/yaml",".md":"text/markdown",".json":"application/json"};
const predecessorFiles=new Set([
  "SKILL.md","assurance/contract.yaml","assurance/predicates.yaml",
  "assurance/procedure.yaml","schemas/transfer-start-evaluation-input.schema.yaml"
]);
const server=createServer((req,res)=>{
  const path=decodeURIComponent(new URL(req.url,"http://localhost").pathname);
  // Legacy Ensure YAML stays in source only, served exclusively by this local test server.
  const testFixture=path==="/__test__/ensure-procedure.yaml";
  const legacy=path.startsWith("/__test__/pre-hold/")
    ? path.slice("/__test__/pre-hold/".length):null;
  const testPredecessor=legacy!==null&&predecessorFiles.has(legacy);
  const file=testPredecessor ? resolve("tests/fixtures/establish-pre-hold",legacy)
    : testFixture ? resolve("site/samples/ensure-pdu-session.procedure.yaml")
    : resolve(dist,"."+path.replace(/\/$/,"/index.html"));
  if(!testPredecessor&&!testFixture&&file!==dist&&!file.startsWith(dist+sep)){
    res.writeHead(403).end();return;
  }
  const stream=createReadStream(file);
  stream.on("error",()=>res.writeHead(404).end());
  stream.on("open",()=>{
    res.writeHead(200,{"Content-Type":types[extname(file)]||"text/plain"});
    stream.pipe(res);
  });
});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
const url="http://127.0.0.1:"+server.address().port+"/";
const temp=await mkdtemp(join(tmpdir(),"studio-chrome-"));
const child=spawn(chrome,["--headless=new","--no-sandbox","--disable-gpu",
  "--disable-dev-shm-usage","--no-first-run","--no-default-browser-check",
  "--remote-debugging-port=0","--user-data-dir="+temp,"about:blank"],{stdio:"ignore"});
const sleep=t=>new Promise(r=>setTimeout(r,t));
let ws=null,seq=0;
const pending=new Map(),exceptions=[],warnings=[];
function command(method,params={}){
  const id=++seq;
  return new Promise((res,rej)=>{pending.set(id,{res,rej});
    ws.send(JSON.stringify({id,method,params}));});
}
async function evaluate(expression){
  const obj=await command("Runtime.evaluate",{
    expression,returnByValue:true,awaitPromise:true});
  if(obj.exceptionDetails)throw Error("Runtime evaluation: "+obj.exceptionDetails.text);
  return obj.result?.value;
}
try{
  let port=null;
  for(let i=0;i<120;i++){
    try{port=Number((await readFile(join(temp,"DevToolsActivePort"),"utf8")).split("\n")[0]);break;}
    catch{if(child.exitCode!==null)throw Error("Chrome exited: "+child.exitCode);}
    await sleep(100);
  }
  if(!port)throw Error("Chrome debugging port not ready");
  const tabs=await (await fetch("http://127.0.0.1:"+port+"/json")).json();
  const page=tabs.find(t=>t.type==="page");
  if(!page)throw Error("Chrome page unavailable");
  ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ws.addEventListener("open",res,{once:true});
    ws.addEventListener("error",rej,{once:true});});
  ws.addEventListener("message",event=>{
    const msg=JSON.parse(event.data);
    if(msg.method==="Runtime.exceptionThrown"){
      const details=msg.params?.exceptionDetails;
      exceptions.push({
        text:details?.text,
        message:details?.exception?.description||details?.exception?.value,
        stack:details?.stackTrace?.callFrames?.slice(0,6).map(frame=>({
          url:frame.url,line:frame.lineNumber+1,column:frame.columnNumber+1,function:frame.functionName
        }))
      });
    }
    if(msg.method==="Runtime.consoleAPICalled"&&["warning","error"].includes(msg.params?.type))warnings.push(msg.params.args?.map(a=>a.value||a.description).join(" "));
    if(msg.id&&pending.has(msg.id)){
      const task=pending.get(msg.id);pending.delete(msg.id);
      if(msg.error)task.rej(Error(msg.error.message));else task.res(msg.result);
    }
  });
  await command("Page.enable");
  await command("Runtime.enable");
  await command("Page.navigate",{url});
  const expr=[
    "(async()=>{",
    " const sleep=t=>new Promise(r=>setTimeout(r,t));",
    " for(let i=0;i<180;i++){",
    "  const n=document.querySelectorAll('.react-flow__node').length;",
    "  const e=document.querySelectorAll('.react-flow__edge-path').length;",
    "  if(n>0&&n<17&&e>0&&",
    "    document.getElementById('layoutStatus')?.textContent.includes('路径聚焦'))break;",
    "  await sleep(100);",
    " }",
    " const mode=document.getElementById('rootPathMode');",
    " const before=document.getElementById('source').value;",
    " const focusNodes=document.querySelectorAll('.react-flow__node').length;",
    " const focusEdges=document.querySelectorAll('.react-flow__edge-path').length;",
    " const rootDefault=mode?.value==='normal'&&focusNodes>0&&focusNodes<17&&focusEdges<46;",
    " const start=()=>document.querySelector('.react-flow__node[data-id=\\\"nudm-sdm-get\\\"]');",
    " const toggle=()=>start()?.querySelector('.designer-hidden-branches');",
    " const view=()=>start()?.querySelector('.designer-view-node');",
    " const viewCount=document.querySelectorAll('#reactFlowRoot .designer-view-node').length;",
    " const badgeBefore=toggle()?.textContent||'';",
    " const center=()=>{const r=start()?.getBoundingClientRect();",
    "  return r?{x:r.x+r.width/2,y:r.y+r.height/2}:null;};",
    " const zoom=()=>new DOMMatrix(getComputedStyle(",
    "  document.querySelector('.react-flow__viewport')).transform).a;",
    " const distance=(a,b)=>a&&b?Math.hypot(a.x-b.x,a.y-b.y):Infinity;",
    " await sleep(240);",
    " const atStart=center(),zoomAtStart=zoom();",
    " toggle()?.click();",
    " for(let i=0;i<110;i++){",
    "  if(toggle()?.getAttribute('aria-pressed')==='true'&&",
    "    document.querySelectorAll('.react-flow__node').length>focusNodes&&",
    "    document.getElementById('layoutStatus')?.textContent.includes('路径聚焦'))break;",
    "  await sleep(90);",
    " }",
    " const expanded=toggle()?.textContent==='收起';",
    " const expandedNodes=document.querySelectorAll('.react-flow__node').length;",
    " const atExpanded=center(),zoomAtExpanded=zoom();",
    " toggle()?.click();",
    " for(let i=0;i<110;i++){",
    "  if(toggle()?.getAttribute('aria-pressed')==='false'&&",
    "    document.querySelectorAll('.react-flow__node').length===focusNodes&&",
    "    document.getElementById('layoutStatus')?.textContent.includes('路径聚焦'))break;",
    "  await sleep(90);",
    " }",
    " const collapsed=toggle()?.textContent===badgeBefore&&",
    "   document.querySelectorAll('.react-flow__node').length===focusNodes;",
    " const atCollapsed=center(),zoomAtCollapsed=zoom();",
    " const anchorError=Math.max(distance(atStart,atExpanded),",
    "   distance(atStart,atCollapsed));",
    " const zoomPreserved=Math.abs(zoomAtStart-zoomAtExpanded)<0.001&&",
    "   Math.abs(zoomAtStart-zoomAtCollapsed)<0.001;",
    " view()?.click();",
    " for(let i=0;i<80;i++){",
    "  if(document.getElementById('nodeFocus')?.hidden===false&&",
    "    document.getElementById('nodeFocusTitle')?.textContent==='nudm-sdm-get')break;",
    "  await sleep(60);",
    " }",
    " const viewOpened=document.getElementById('nodeFocus')?.hidden===false;",
    " document.getElementById('nodeFocusReturn')?.click();",
    " await sleep(100);",
    " const viewReturned=document.getElementById('nodeFocus')?.hidden===true;",
    " document.getElementById('closeInspector')?.click();",
    " const viewStable=viewCount===focusNodes&&viewOpened&&viewReturned;",
    " mode.value='custom';mode.dispatchEvent(new Event('change',{bubbles:true}));",
    " for(let i=0;i<45;i++){",
    "  if(!document.getElementById('rootPathFilters').hidden)break;",
    "  await sleep(100);",
    " }",
    " document.getElementById('pathFailure').click();",
    " for(let i=0;i<90;i++){",
    "  if(document.querySelectorAll('.react-flow__node').length>focusNodes&&",
    "    document.getElementById('layoutStatus')?.textContent.includes('路径聚焦'))break;",
    "  await sleep(90);",
    " }",
    " const customNodes=document.querySelectorAll('.react-flow__node').length;",
    " const branchShown=customNodes>focusNodes;",
    " mode.value='all';mode.dispatchEvent(new Event('change',{bubbles:true}));",
    " for(let i=0;i<130;i++){",
    "  if(document.querySelectorAll('.react-flow__node').length===17 &&",
    "    document.querySelectorAll('.react-flow__edge-path').length===46 &&",
    "    document.querySelectorAll('.react-flow__handle[data-handleid^=edge-]').length===92 &&",
    "    document.getElementById('layoutStatus')?.textContent!=='正在自动布局…')break;",
    "  await sleep(100);",
    " }",
    " await sleep(300);",
    " const paths=[...document.querySelectorAll('.react-flow__edge-path')];",
    " const info=paths.map(el=>{const c=getComputedStyle(el);",
    "  let length=0;try{length=el.getTotalLength();}catch{}",
    "  return {d:el.getAttribute('d'),length,stroke:c.stroke,",
    "    opacity:c.opacity,display:c.display,visibility:c.visibility,",
    "    strokeWidth:c.strokeWidth,vectorEffect:c.vectorEffect,markerEnd:c.markerEnd};",
    " });",
    " const portGaps=[];",
    " for(const edge of document.querySelectorAll('.react-flow__edge')){",
    "  const id=edge.getAttribute('data-id');",
    "  const i=Number(id?.replace('flow-edge-',''));",
    "  const path=edge.querySelector('.react-flow__edge-path');",
    "  const source=document.querySelector('[data-handleid=\"edge-'+i+'-out\"]');",
    "  const target=document.querySelector('[data-handleid=\"edge-'+i+'-in\"]');",
    "  if(!path||!source||!target)continue;",
    "  const matrix=path.getScreenCTM();",
    "  if(!matrix)continue;",
    "  const last=path.getTotalLength();",
    "  for(const [el,p] of [[source,path.getPointAtLength(0)],[target,path.getPointAtLength(last)]]){",
    "   const screen=new DOMPoint(p.x,p.y).matrixTransform(matrix);",
    "   const rect=el.getBoundingClientRect();",
    "   const dx=screen.x-(rect.x+rect.width/2),dy=screen.y-(rect.y+rect.height/2);",
    "   portGaps.push({id,kind:el===source?'source':'target',",
    "     dx,dy,dist:Math.hypot(dx,dy)});",
    "  }",
    " }",
    " const ids=[...document.querySelectorAll('.react-flow__edge')].map(x=>x.getAttribute('data-id'));",
    " const expected=Array.from({length:46},(_,i)=>'flow-edge-'+i);",
    " return {rootFocus:{rootDefault,branchShown,focusNodes,focusEdges,customNodes,",
    "   badgeBefore,expanded,expandedNodes,collapsed,viewStable,viewCount,",
    "   anchorError,zoomPreserved,zoomAtStart,zoomAtExpanded,zoomAtCollapsed,",
    "   sourcePreserved:document.getElementById('source').value===before},",
    "  nodes:document.querySelectorAll('.react-flow__node').length,",
    "  edges:paths.length,edgeIds:ids,missing:expected.filter(x=>!ids.includes(x)),",
    "  handles:document.querySelectorAll('.react-flow__handle').length,",
    "  attachedPorts:portGaps.length,maxPortGap:Math.max(0,...portGaps.map(p=>p.dist)),",
    "  worstPorts:portGaps.sort((a,b)=>b.dist-a.dist).slice(0,10),",
    "  edgesOverflow:getComputedStyle(document.querySelector('.react-flow__edges')).overflow,",
    "  valid:info.filter(e=>e.length>1&&e.stroke!=='none'&&",
    "    e.display!=='none'&&e.visibility!=='hidden'&&",
    "    Number(e.opacity)>0&&parseFloat(e.strokeWidth)>0&&",
    "    e.vectorEffect==='non-scaling-stroke').length,",
    "  markersOk:info.filter(x=>x.markerEnd?.includes('height=16')&&",
    "    x.markerEnd?.includes('type=arrow&')).length,",
    "  samples:info.slice(0,4),",
    "  status:document.getElementById('layoutStatus')?.textContent,",
    "  zoomTransform:getComputedStyle(document.querySelector('.react-flow__viewport')).transform,",
    "  graph:document.getElementById('graphPane')?.getBoundingClientRect().toJSON(),",
    "  styles:[...document.styleSheets].map(x=>x.href).filter(Boolean)};",
    "})()"
  ].join("\n");
  const result=await evaluate(expr);
  console.log("CREATED_SESSION_EDGE_SMOKE",JSON.stringify(result));
  if(!result?.rootFocus?.rootDefault||!result.rootFocus.branchShown||
     !result.rootFocus.expanded||!result.rootFocus.collapsed||
     result.rootFocus.anchorError>2||!result.rootFocus.zoomPreserved||
     !result.rootFocus.viewStable||
     !result.rootFocus.sourcePreserved||
     result?.nodes!==17||result.edges!==46||result.valid!==46||result.markersOk!==46||
     result.attachedPorts!==92||result.maxPortGap>1.5)
    throw Error("CreatedSession visible edges FAIL");
  console.log("CreatedSession visible paths and aligned React Flow ports PASS: "+
    result.valid+" / "+result.attachedPorts);

  // A single app menu delegates to real actions; double-click no longer
  // navigates to Node Focus now that every card has an explicit View button.
  const menuUX=await evaluate([
    "(async()=>{",
    " const sleep=t=>new Promise(r=>setTimeout(r,t));",
    " const menu=document.getElementById('applicationMenu');",
    " const menus=[...menu.querySelectorAll('details.application-menu')];",
    " const group=name=>menu.querySelector('details[data-app-menu='+name+']');",
    " const file=group('file'),edit=group('edit'),view=group('view'),help=group('help');",
    " const summary=d=>d.querySelector('summary');",
    " const item=id=>[...menu.querySelectorAll('[data-studio-command]')].find(b=>b.dataset.studioCommand===id);",
    " const before=document.getElementById('source').value;",
    " const labels=menus.map(d=>summary(d).textContent.trim());",
    " const context=document.querySelector('.top-context');",
    " const contextWidth=context.getBoundingClientRect().width;",
    " const contextVisible=contextWidth>160&&getComputedStyle(context).display!=='none'&&",
    "  document.getElementById('fileName').textContent.trim().length>0;",
    " summary(file).click();await sleep(70);",
    " const opened=file.open===true;",
    " const groups=menu.querySelectorAll('.application-menu-group').length;",
    " const disabledSave=item('file.saveDirectory')?.disabled===true;",
    " const openFileAvailable=item('file.open')?.disabled===false;",
    " const openDirectoryAvailable=item('file.openDirectory')?.disabled===false;",
    " const sampleAvailable=item('file.loadSample')?.disabled===false;",
    " const zipAvailable=item('file.exportPackage')?.disabled===false;",
    " const exportAvailable=item('file.export')?.disabled===false;",
    " const bridge=document.querySelector('.explorer-command-bridge');",
    " const bridgeHidden=getComputedStyle(bridge).display==='none';",
    " const visibleExplorerActions=[...document.querySelectorAll('.explorer-bottom>.explorer-action')].filter(x=>!x.hidden).map(x=>x.id);",
    " const compactExplorer=bridgeHidden&&visibleExplorerActions.length===1&&",
    "  visibleExplorerActions[0]==='openDirectoryButton';",
    " summary(view).click();await sleep(70);",
    " const exclusiveView=view.open&&menus.filter(x=>x.open).length===1;",
    " const disabledUndo=item('edit.undo')?.disabled===true;",
    " item('view.source')?.click();await sleep(50);",
    " const sourceMode=document.getElementById('editorBody').dataset.mode==='source'&&!view.open;",
    " summary(view).click();await sleep(50);",
    " item('view.visual')?.click();await sleep(70);",
    " const visualMode=document.getElementById('editorBody').dataset.mode==='visual';",
    " const card=document.querySelector('.react-flow__node[data-id=nudm-sdm-get] .designer-node');",
    " card?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true}));",
    " await sleep(70);",
    " const doubleClickInert=document.getElementById('nodeFocus').hidden;",
    " summary(file).click();await sleep(50);",
    " summary(file).dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));",
    " await sleep(50);",
    " const arrowSwitch=edit.open&&menus.filter(x=>x.open).length===1&&",
    "  document.activeElement===summary(edit);",
    " document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));",
    " const escapeClosed=menus.every(x=>!x.open);",
    " summary(help).click();await sleep(50);",
    " const helpLinks=help.querySelectorAll('a').length;",
    " document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));",
    " const outsideClosed=menus.every(x=>!x.open);",
    " return {opened,groups,labels,contextVisible,contextWidth,exclusiveView,arrowSwitch,",
    "  disabledSave,openFileAvailable,openDirectoryAvailable,sampleAvailable,zipAvailable,",
    "  compactExplorer,visibleExplorerActions,exportAvailable,disabledUndo,",
    "  sourceMode,visualMode,doubleClickInert,helpLinks,escapeClosed,outsideClosed,",
    "  sourcePreserved:before===document.getElementById('source').value};",
    "})()"
  ].join("\n"));
  console.log("STUDIO_APP_MENU_SMOKE",JSON.stringify(menuUX));
  if(!menuUX?.opened||menuUX.groups!==3||
     menuUX.labels?.join("/")!=="文件/编辑/视图/帮助"||
     !menuUX.contextVisible||!menuUX.exclusiveView||!menuUX.arrowSwitch||
     !menuUX.disabledSave||!menuUX.openFileAvailable||!menuUX.openDirectoryAvailable||
     !menuUX.sampleAvailable||!menuUX.zipAvailable||!menuUX.compactExplorer||
     !menuUX.exportAvailable||!menuUX.disabledUndo||!menuUX.sourceMode||
     !menuUX.visualMode||!menuUX.doubleClickInert||menuUX.helpLinks!==2||
     !menuUX.escapeClosed||!menuUX.outsideClosed||!menuUX.sourcePreserved)
    throw Error("Studio top-level menus and context FAIL: "+JSON.stringify(menuUX));

  // D1 visual-only START, outcome-colored lines and on-canvas legend.
  // The 17 real YAML Nodes / 46 current owner Route bundles are unchanged.
  const graphDisplay=await evaluate([
    "(()=>{",
    " const node=document.querySelector('.designer-node.is-start');",
    " const badge=node?getComputedStyle(node,'::before'):null;",
    " const kind=node?.querySelector('.designer-node-kind')?.textContent||'';",
    " const panel=document.getElementById('graphLegend');",
    " const pos=panel?getComputedStyle(panel).position:'';",
    " const summary=panel?.querySelector('summary');",
    " summary?.click();const opened=panel?.open===true;",
    " const types=panel?.querySelectorAll('#graphLegendNodeTypes code').length;",
    " const steps=panel?.querySelectorAll('#graphLegendStepTypes code').length;",
    " const nodeKinds=[...panel.querySelectorAll('#graphLegendNodeTypes code')].map(x=>x.textContent).sort().join(',');",
    " const stepKinds=[...panel.querySelectorAll('#graphLegendStepTypes code')].map(x=>x.textContent).sort().join(',');",
    " const preBadge=document.querySelector('.designer-node-phases .phase-preconditions');",
    " const postBadge=document.querySelector('.designer-node-phases .phase-postconditions');",
    " const preRoutes=[...document.querySelectorAll('.react-flow__edge-path.designer-edge.origin-PRE')];",
    " const postRoutes=[...document.querySelectorAll('.react-flow__edge-path.designer-edge.origin-POST')];",
    " const opRoutes=[...document.querySelectorAll('.react-flow__edge-path.designer-edge.origin-OP')];",
    " const routeSourcesPreserved=preRoutes.length>0&&postRoutes.length>0&&opRoutes.length>0&&",
    "   preRoutes.every(x=>getComputedStyle(x).strokeDasharray!=='none')&&",
    "   postRoutes.every(x=>getComputedStyle(x).strokeDasharray!=='none')&&",
    "   opRoutes.every(x=>getComputedStyle(x).strokeDasharray==='none');",
    " const lineTypes=panel?.querySelectorAll('.graph-legend-line').length;",
    " summary?.click();const collapsed=panel?.open===false;",
    " const tonePaths=[...document.querySelectorAll('.react-flow__edge-path.designer-edge')];",
    " const success=tonePaths.filter(x=>x.classList.contains('tone-success'));",
    " const green=success.length>0&&success.every(x=>getComputedStyle(x).stroke==='rgb(19, 143, 122)');",
    " const hasNoFalseGreen=tonePaths.filter(x=>x.classList.contains('tone-failure')||",
    "   x.classList.contains('tone-uncertain')||x.classList.contains('tone-mixed'))",
    "   .every(x=>getComputedStyle(x).stroke!=='rgb(19, 143, 122)');",
    " return {hasStart:!!node,marker:badge?.content,kind,position:pos,",
    "   opened,collapsed,types,steps,nodeKinds,stepKinds,preBadge:preBadge?.textContent,",
    "   postBadge:postBadge?.textContent,routeSourcesPreserved,lineTypes,green,successCount:success.length,",
    "   hasNoFalseGreen,sourceNodes:document.querySelectorAll('.react-flow__node').length,",
    "   routePaths:tonePaths.length};",
    "})()"
  ].join("\n"));
  console.log("D1_START_LEGEND_OUTCOME_STYLES",JSON.stringify(graphDisplay));
  if(!graphDisplay?.hasStart||!graphDisplay.marker.includes('START')||
     graphDisplay.kind.includes('START')||graphDisplay.position!=='absolute'||
     !graphDisplay.opened||!graphDisplay.collapsed||graphDisplay.types!==4||
     graphDisplay.steps!==3||graphDisplay.nodeKinds!=="CALL,PROCEDURE,RECONCILE,TERMINAL"||
     graphDisplay.stepKinds!=="CALL,SCRIPT,VERIFY"||
     !graphDisplay.preBadge?.includes("PRE")||!graphDisplay.postBadge?.includes("POST")||
     !graphDisplay.routeSourcesPreserved||
     graphDisplay.lineTypes!==4||!graphDisplay.green||
     !graphDisplay.hasNoFalseGreen||
     graphDisplay.sourceNodes!==17||graphDisplay.routePaths!==46)
    throw Error("D1 visual START / legend / Route tone FAIL: "+
      JSON.stringify(graphDisplay));

  // D1-A1: actual Child has POST Verify but no PRE, then Root state recovers.
  const childPhases=await evaluate([
    " (async()=>{",
    " const sleep=ms=>new Promise(r=>setTimeout(r,ms));",
    " const child=[...document.querySelectorAll(\'#procedureTree button.child\')].find(x=>",
    "   x.textContent.includes(\'await-initial-n4-session-establishment\'));",
    " if(!child)return {error:\'child navigation missing\'};",
    " child.click();",
    " for(let i=0;i<80;i++){if(document.querySelectorAll(\'.react-flow__node\').length===4)break;await sleep(50);}",
    " const panel=document.getElementById(\'graphLegend\');",
    " const kinds=[...panel.querySelectorAll(\'#graphLegendNodeTypes code\')].map(x=>x.textContent).sort().join(\',\');",
    " const steps=[...panel.querySelectorAll(\'#graphLegendStepTypes code\')].map(x=>x.textContent).sort().join(\',\');",
    " const scope=panel.querySelector(\'#graphLegendScope\').textContent;",
    " const badges=[...document.querySelectorAll(\'.designer-phase-badge\')].map(x=>x.textContent);",
    " const nodeCount=document.querySelectorAll(\'.react-flow__node\').length;",
    " document.getElementById(\'backProcedure\').click();",
    " for(let i=0;i<80;i++){if(document.querySelectorAll(\'.react-flow__node\').length===17)break;await sleep(50);}",
    " const restored=document.querySelectorAll(\'.react-flow__node\').length===17&&",
    "   document.getElementById(\'graphLegendScope\').textContent.includes(\'PRE 3 / POST 4\');",
    " return {nodeCount,kinds,steps,scope,badges,restored};",
    " })()",
  ].join("\n"));
  console.log("D1_A1_CHILD_PHASE_LEGEND",JSON.stringify(childPhases));
  if(childPhases?.nodeCount!==4||childPhases.kinds!=="CALL,TERMINAL"||
     childPhases.steps!=="VERIFY"||!childPhases.scope.includes("PRE 0 / POST 1")||
     childPhases.badges.some(x=>x.includes("PRE"))||
     !childPhases.badges.some(x=>x.includes("POST"))||!childPhases.restored)
    throw Error("D1-A1 child Phase semantics or Root return FAIL: "+JSON.stringify(childPhases));
  // D1-A2: do not clone shared Children or fabricate a caller on direct browse.
  const subflowNav=await evaluate([
    "(async()=>{",
    "  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));",
    "  const count=()=>document.querySelectorAll('.react-flow__node').length;",
    "  const wait=async n=>{for(let i=0;i<90&&count()!==n;i++)await sleep(50);};",
    "  const card=id=>document.querySelector('.react-flow__node[data-id=\"'+id+'\"]');",
    "  const open=id=>card(id)?.querySelector('button.designer-subflow-enter')?.click();",
    "  const rootSource=document.getElementById('source').value;",
    "  const rootCards=document.querySelectorAll('.designer-node.is-subflow-invocation').length;",
    "  const openButtons=document.querySelectorAll('button.designer-subflow-enter').length;",
    "  open('n4-session-establishment');await wait(4);",
    "  const scope=document.getElementById('procedureScope');",
    "  const pane=document.getElementById('graphPane');",
    "  const n4={",
    "    nodes:count(),boundaryVisible:!scope.hidden,",
    "    name:document.getElementById('procedureScopeName').textContent,",
    "    context:document.getElementById('procedureScopeContext').textContent,",
    "    bread:document.getElementById('procedureBread').textContent,",
    "    paneScope:pane.dataset.procedureScope,",
    "    border:getComputedStyle(pane,'::before').borderTopStyle,",
    "    returnText:document.getElementById('procedureScopeReturn').textContent",
    "  };",
    "  document.getElementById('procedureScopeReturn').click();await wait(17);",
    "  await sleep(250);",
    "  const returnedToN4=count()===17&&",
    "    card('n4-session-establishment')?.querySelector('.designer-node.is-selected')!==null&&",
    "    document.getElementById('procedureScope').hidden;",
    "  open('finalize-failed');await wait(5);",
    "  const failedCtx=document.getElementById('procedureScopeContext').textContent;",
    "  document.getElementById('backProcedure').click();await wait(17);",
    "  open('finalize-success');await wait(5);",
    "  const successCtx=document.getElementById('procedureScopeContext').textContent;",
    "  document.getElementById('procedureScopeReturn').click();await wait(17);",
    "  const tree=[...document.querySelectorAll('#procedureTree button.child')]",
    "    .find(x=>x.textContent.includes('await-initial-n4-session-establishment'));",
    "  tree?.click();await wait(4);",
    "  const directContext=document.getElementById('procedureScopeContext').textContent;",
    "  const directReturn=document.getElementById('procedureScopeReturn').textContent;",
    "  const directNoGuess=!directContext.includes('调用位置')&&",
    "    directContext.includes('直接打开')&&directReturn==='返回 Root';",
    "  document.getElementById('procedureScopeReturn').click();await wait(17);",
    "  const sourcePreserved=document.getElementById('source').value===rootSource;",
    "  const restored=count()===17&&",
    "    document.querySelectorAll('.react-flow__edge-path').length===46;",
    "  return {rootCards,openButtons,n4,returnedToN4,failedCtx,successCtx,",
    "    directContext,directReturn,directNoGuess,sourcePreserved,restored};",
    "})()",
  ].join("\n"));
  console.log("D1_A2_SUBFLOW_CONTEXT",JSON.stringify(subflowNav));
  if(subflowNav?.rootCards!==6||subflowNav.openButtons!==6||
     subflowNav.n4?.nodes!==4||!subflowNav.n4.boundaryVisible||
     subflowNav.n4.name!=="await-initial-n4-session-establishment"||
     !subflowNav.n4.context.includes("n4-session-establishment")||
     !subflowNav.n4.bread.includes("n4-session-establishment")||
     subflowNav.n4.paneScope!=="child"||subflowNav.n4.border!=="dashed"||
     subflowNav.n4.returnText!=="返回调用节点"||!subflowNav.returnedToN4||
     !subflowNav.failedCtx.includes("finalize-failed")||
     !subflowNav.successCtx.includes("finalize-success")||
     subflowNav.failedCtx===subflowNav.successCtx||
     !subflowNav.directNoGuess||!subflowNav.sourcePreserved||
     !subflowNav.restored)
    throw Error("D1-A2 Child call-site navigation FAIL: "+JSON.stringify(subflowNav));

  // D1-A2c: real React Flow + ELK local diagram, not disconnected details.
  const focusGraph=await evaluate([
    "(async()=>{",
    "  const sleep=ms=>new Promise(r=>setTimeout(r,ms));",
    "  const wait=async test=>{for(let i=0;i<100;i++){if(test())return true;await sleep(40);}return false;};",
    "  const main=document.getElementById('reactFlowRoot');",
    "  const host=document.getElementById('nodeFocusFlow');",
    "  const focus=document.getElementById('nodeFocus');",
    "  const title=document.getElementById('nodeFocusTitle');",
    "  const stats=document.getElementById('nodeFocusStats');",
    "  const back=document.getElementById('nodeFocusReturn');",
    "  const src=document.getElementById('source').value;",
    "  const ids=[...main.querySelectorAll('.react-flow__node')].map(x=>x.getAttribute('data-id'));",
    "  const open=id=>[...main.querySelectorAll('.react-flow__node')].find(n=>n.dataset.id===id)?.querySelector('.designer-view-node')?.click();",
    "  const nodes=()=>[...host.querySelectorAll('.react-flow__node')];",
    "  const labels=()=>[...host.querySelectorAll('.designer-route-label[data-route-ids]')];",
    "  const realIds=()=>labels().flatMap(x=>x.dataset.routeIds.split(',').filter(Boolean));",
    "  const failures=[],samples={};",
    "  for(const id of ids){",
    "    open(id);",
    "    const ok=await wait(()=>!focus.hidden&&title.textContent===id&&",
    "      !!host.querySelector('.react-flow__node[data-id=\"stage:operator\"]'));",
    "    if(!ok){failures.push('not rendered '+id+': '+stats.textContent);back.click();continue;}",
    "    const stages=nodes().filter(x=>x.getAttribute('data-id').startsWith('stage:'))",
    "      .map(x=>x.getAttribute('data-id'));",
    "    if(!stages.includes('stage:operator'))failures.push('no OP '+id);",
    "    const boundary=nodes().find(n=>n.getAttribute('data-id')==='view:current-node-boundary');",
    "    const frame=boundary?.querySelector('.focus-current-boundary');",
    "    if(!frame||getComputedStyle(frame).borderTopStyle!=='dashed'||",
    "       !frame.textContent.includes(id))failures.push('current Node boundary '+id);",
    "    if(id==='nudm-sdm-subscribe'){",
    "      await wait(()=>labels().length>0);",
    "      samples.subscribe={",
    "        stages,",
    "        preSteps:host.querySelectorAll('.react-flow__node[data-id=\"stage:preconditions\"] .focus-graph-step').length,",
    "        postSteps:host.querySelectorAll('.react-flow__node[data-id=\"stage:postconditions\"] .focus-graph-step').length,",
    "        before:nodes().filter(x=>x.getAttribute('data-id').startsWith('before:')).length,",
    "        after:nodes().filter(x=>x.getAttribute('data-id').startsWith('after:')).length,",
    "        realRouteIds:realIds(),",
    "        origins:[...new Set(labels().map(x=>x.dataset.routeSource))],",
    "        phaseLinks:host.querySelectorAll('.react-flow__edge-path.focus-graph-phase-link').length",
    "      };",
    "    }",
    "    if(id==='safe-stopped')samples.terminal={stages,realRouteIds:realIds()};",
    "    if(id==='n4-session-establishment')",
    "      samples.procedure={stages,childButton:!!document.querySelector('#nodeFocusChildren .node-focus-subflow')};",
    "    back.click();",
    "    if(!(await wait(()=>focus.hidden)))failures.push('return '+id);",
    "  }",
    "  open('nudm-sdm-subscribe');",
    "  await wait(()=>title.textContent==='nudm-sdm-subscribe'&&",
    "    !!host.querySelector('.react-flow__node[data-id=\"after:npcf-sm-policy-control-create\"]'));",
    "  host.querySelector('.react-flow__node[data-id=\"after:npcf-sm-policy-control-create\"] .focus-graph-pivot')?.click();",
    "  await wait(()=>title.textContent==='npcf-sm-policy-control-create'&&",
    "    !!host.querySelector('.react-flow__node[data-id=\"before:nudm-sdm-subscribe\"]'));",
    "  const forward={title:title.textContent,backLink:!!host.querySelector(",
    "    '.react-flow__node[data-id=\"before:nudm-sdm-subscribe\"]')};",
    "  host.querySelector('.react-flow__node[data-id=\"before:nudm-sdm-subscribe\"] .focus-graph-pivot')?.click();",
    "  await wait(()=>title.textContent==='nudm-sdm-subscribe');",
    "  const returned=title.textContent;",
    "  back.click();await wait(()=>focus.hidden);",
    "  open('n4-session-establishment');",
    "  await wait(()=>!!document.querySelector('#nodeFocusChildren .node-focus-subflow'));",
    "  document.querySelector('#nodeFocusChildren .node-focus-subflow')?.click();",
    "  const childOk=await wait(()=>focus.hidden&&document.querySelectorAll('#reactFlowRoot .react-flow__node').length===4&&",
    "    !document.getElementById('procedureScope').hidden);",
    "  document.getElementById('procedureScopeReturn').click();",
    "  await wait(()=>document.querySelectorAll('#reactFlowRoot .react-flow__node').length===17);",
    "  return {count:ids.length,failures,samples,forward,returned,childOk,",
    "    rootRestored:document.querySelectorAll('#reactFlowRoot .react-flow__node').length===17&&",
    "      document.querySelectorAll('#reactFlowRoot .react-flow__edge-path.designer-edge').length===46,",
    "    sourceUnchanged:document.getElementById('source').value===src};",
    "})()",
  ].join("\n"));
  console.log("D1_A2C_LOCAL_FLOW",JSON.stringify(focusGraph));
  const subscribe=focusGraph?.samples.subscribe;
  if(focusGraph?.count!==17||focusGraph.failures.length||
     subscribe?.preSteps!==5||subscribe.postSteps!==1||
     subscribe.before!==1||subscribe.after!==6||
     subscribe.realRouteIds.length!==10||
     new Set(subscribe.realRouteIds).size!==10||
     !subscribe.origins.includes("preconditions.on")||
     !subscribe.origins.includes("postconditions.on")||
     !subscribe.origins.includes("operator.on")||
     subscribe.phaseLinks!==2||
     focusGraph.samples.terminal?.stages.length!==1||
     !focusGraph.samples.procedure?.childButton||
     focusGraph.forward.title!=="npcf-sm-policy-control-create"||
     !focusGraph.forward.backLink||
     focusGraph.returned!=="nudm-sdm-subscribe"||
     !focusGraph.childOk||!focusGraph.rootRestored||
     !focusGraph.sourceUnchanged)
    throw Error("D1-A2c local flow diagram FAIL: "+JSON.stringify(focusGraph));

  // The same real browser also validates the Explorer's suffix theme.
  const iconResult=await evaluate([
    "(()=>{",
    " const files=[...document.querySelectorAll('.asset-file-icon')].map(svg=>({",
    "   kind:svg.getAttribute('data-icon-kind'),",
    "   path:svg.closest('button')?.getAttribute('aria-label'),",
    "   hidden:svg.getAttribute('aria-hidden'),",
    "   colors:[...svg.querySelectorAll('path')].map(p=>p.getAttribute('stroke'))",
    " }));",
    " const folders=[...document.querySelectorAll('.asset-folder-icon')];",
    " const folderPaths=[...document.querySelectorAll('#assetTree .asset-folder-title')].map(x=>x.title);",
    " return {fileCount:files.length,folderCount:folders.length,folderPaths,",
    "  kinds:[...new Set(files.map(x=>x.kind))],",
    "  missingAccessible:files.filter(x=>!x.path||x.hidden!=='true').length,",
    "  yaml:files.filter(x=>x.kind==='yaml').length,",
    "  markdown:files.filter(x=>x.kind==='markdown').length,",
    "  python:files.filter(x=>x.kind==='python').length,",
    "  samples:files.slice(0,7)};",
    "})()"
  ].join("\n"));
  console.log("CREATED_SESSION_FILE_ICON_SMOKE",JSON.stringify(iconResult));
  if(iconResult?.fileCount!==16||iconResult.folderCount!==4||
     iconResult.yaml!==9||iconResult.markdown!==4||iconResult.python!==3||
     !iconResult.folderPaths?.includes("references/")||
     iconResult.missingAccessible!==0){
    throw Error("Explorer themed icons FAIL: "+JSON.stringify(iconResult));
  }
  console.log("CreatedSession themed file icons PASS");

  // E1-A2 must show the *actual* Monaco editor, not only a fallback
  // textarea or the old syntax-highlight overlay.
  const monacoReady=await evaluate([
    "(async()=>{",
    " const sleep=t=>new Promise(r=>setTimeout(r,t));",
    " const root=document.getElementById('sourceEditor');",
    " for(let i=0;i<170&&root?.dataset.monaco!=='on';i++)await sleep(100);",
    " const host=document.getElementById('monacoHost');",
    " const mirror=document.getElementById('source');",
    " const css=getComputedStyle(host);",
    " return {ok:root?.dataset.monaco==='on'&&!!host?.querySelector('.monaco-editor')&&",
    "  mirror?.getAttribute('aria-hidden')==='true'&&",
    "  !!mirror.value.includes('procedures:'),",
    "  status:root?.dataset.monaco,language:host?.dataset.language,display:css.display};",
    "})()"
  ].join("\n"));
  console.log("E1_MONACO_READY",JSON.stringify(monacoReady));
  if(!monacoReady?.ok||monacoReady.language!=="yaml")
    throw Error("E1 Monaco was not mounted over YAML Source: "+JSON.stringify(monacoReady));

  const initialSource=await evaluate("document.getElementById('source').value");
  const focused=await evaluate([
    "(async()=>{",
    " const click=el=>el?.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));",
    " click(document.getElementById('mode-source'));",
    " await new Promise(r=>setTimeout(r,250));",
    " const host=document.getElementById('monacoHost');",
    " const area=host.querySelector('.monaco-editor .inputarea')||",
    "  host.querySelector('.monaco-editor textarea')||",
    "  host.querySelector('.monaco-editor [contenteditable]');",
    " area?.focus();",
    " return {focused:!!area&&host.contains(document.activeElement),visible:",
    "  getComputedStyle(host).display!=='none',candidate:area?.outerHTML.slice(0,200),",
    "  active:document.activeElement?.outerHTML.slice(0,200)};",
    "})()"
  ].join("\n"));
  if(!focused?.visible)
    throw Error("E1 Monaco Source surface hidden: "+JSON.stringify(focused));

  // Semantic tokens must be emitted by the registered provider AND painted by
  // the active Studio Light Monaco theme. A provider-only unit test is not enough.
  const semanticRendering=await evaluate([
    "(async()=>{",
    " const host=document.getElementById('monacoHost');",
    " const lines=[...host.querySelectorAll('.view-line')];",
    " const line=lines.find(item=>item.textContent.replace(/\\u00a0/g,' ').includes('createdsession.ingress.eligible: PASS'));",
    " const token=(value)=>[...(line?.querySelectorAll('span')||[])]",
    "  .find(item=>item.textContent===value);",
    " const reference=token('createdsession.ingress.eligible'),outcome=token('PASS');",
    " const referenceColor=reference?getComputedStyle(reference).color:null;",
    " const outcomeColor=outcome?getComputedStyle(outcome).color:null;",
    " return {ok:host.dataset.language==='yaml'&&!!line&&",
    "   referenceColor==='rgb(123, 91, 167)'&&outcomeColor==='rgb(173, 101, 23)',",
    "  referenceColor,outcomeColor,line:line?.textContent,",
    "  referenceHtml:reference?.outerHTML,outcomeHtml:outcome?.outerHTML,lineHtml:line?.innerHTML,",
    "  fileName:document.getElementById('fileName')?.textContent,",
    "  sourceStart:document.getElementById('source')?.value.slice(0,420),",
    "  renderedLineTexts:lines.slice(0,24).map(item=>item.textContent),",
    "  renderedLines:lines.length,theme:getComputedStyle(host).color};",
    "})()"
  ].join("\n"));
  console.log("E1_MONACO_SEMANTIC_TOKEN_RENDERING",JSON.stringify(semanticRendering));
  if(!semanticRendering?.ok)
    throw Error("Monaco semantic token registration/rendering FAIL: "+JSON.stringify(semanticRendering));

  // Trusted CDP click activates Monaco's own input controller, unlike DOM focus.
  const pos=await evaluate("(()=>{const r=document.getElementById('monacoHost').getBoundingClientRect();return {x:r.x+120,y:r.y+60,width:r.width,height:r.height}})()");
  if(pos.width<200||pos.height<120)throw Error("Monaco canvas has no editable bounds");
  await command("Input.dispatchMouseEvent",{type:"mousePressed",x:pos.x,y:pos.y,button:"left",clickCount:1});
  await command("Input.dispatchMouseEvent",{type:"mouseReleased",x:pos.x,y:pos.y,button:"left",clickCount:1});

  // Regression: React Flow panActivationKeyCode defaults to Space and can
  // prevent a REAL physical Space key from reaching Monaco on this same page.
  // Input.insertText alone cannot detect that keydown interception.
  await command("Input.dispatchKeyEvent",{type:"keyDown",key:" ",code:"Space",
    windowsVirtualKeyCode:32,nativeVirtualKeyCode:32,text:" ",unmodifiedText:" "});
  await command("Input.dispatchKeyEvent",{type:"keyUp",key:" ",code:"Space",
    windowsVirtualKeyCode:32,nativeVirtualKeyCode:32});
  await sleep(200);
  const spaceSource=await evaluate("document.getElementById('source').value");
  const spaceInserted=spaceSource.length===initialSource.length+1 &&
    [...spaceSource].some((char,i)=>char===" "&&
      spaceSource.slice(0,i)===initialSource.slice(0,i)&&
      spaceSource.slice(i+1)===initialSource.slice(i));
  console.log("E1_MONACO_PHYSICAL_SPACE",JSON.stringify({
    inserted:spaceInserted,sourceLengthBefore:initialSource.length,
    sourceLengthAfter:spaceSource.length
  }));
  if(!spaceInserted)throw Error("Physical Space key was stolen before reaching Monaco");
  await evaluate("document.getElementById('undoButton').click()");
  await sleep(100);
  if(await evaluate("document.getElementById('source').value")!==initialSource)
    throw Error("Physical Space key did not participate in shared Source Undo");
  
  await command("Input.insertText",{text:"E1_MONACO_INPUT"});
  await sleep(250);
  const typedSource=await evaluate("document.getElementById('source').value");
  if(typedSource===initialSource||!typedSource.includes("E1_MONACO_INPUT")){
    const debug=await evaluate("(()=>{const h=document.getElementById('monacoHost');return {active:document.activeElement?.outerHTML.slice(0,240),hostContains:h.contains(document.activeElement),mirror:document.getElementById('source').value.slice(0,100),rendered:h.querySelector('.view-lines')?.textContent?.slice(0,160)}})()");
    throw Error("E1 Monaco typing did not reach shared Source buffer: "+JSON.stringify(debug));
  }
  // A single CDP Input.insertText may be emitted by Monaco as several model
  // changes. Verify *complete* round-trip through the shared Studio history
  // rather than incorrectly assuming all characters form one transaction.
  const historyResult=await evaluate([
    "(async()=>{",
    " const sleep=t=>new Promise(r=>setTimeout(r,t));",
    " const source=document.getElementById('source');",
    " const undo=document.getElementById('undoButton');",
    " const redo=document.getElementById('redoButton');",
    " let undos=0,redos=0,restores=0;",
    " while(source.value.length>"+initialSource.length+"&&undos<40&&!undo.disabled){undo.click();undos++;await sleep(25);}",
    " const undone=source.value;",
    " while(source.value.length<"+typedSource.length+"&&redos<40&&!redo.disabled){redo.click();redos++;await sleep(25);}",
    " const redone=source.value;",
    " while(source.value.length>"+initialSource.length+"&&restores<40&&!undo.disabled){undo.click();restores++;await sleep(25);}",
    " return {undos,redos,restores,undone,redone,final:source.value};",
    "})()"
  ].join("\n"));
  if(historyResult.undone!==initialSource||historyResult.redone!==typedSource||
     historyResult.final!==initialSource||
     historyResult.undos!==historyResult.redos||
     historyResult.undos!==historyResult.restores)
    throw Error("E1 Source/Visual shared history round-trip failed: "+JSON.stringify({
      undos:historyResult.undos,redos:historyResult.redos,restores:historyResult.restores,
      initialRecovered:historyResult.undone===initialSource,typedRecovered:historyResult.redone===typedSource,
      finalRecovered:historyResult.final===initialSource
    }));
  const switched=await evaluate([
    "(async()=>{",
    " const sleep=t=>new Promise(r=>setTimeout(r,t));",
    " const file=path=>[...document.querySelectorAll('#assetTree button.asset-file')]",
    "  .find(el=>el.getAttribute('aria-label')===path);",
    " file('scripts/evaluate_udm_read.py')?.click();await sleep(160);",
    " const python=document.getElementById('monacoHost').dataset.language;",
    " file('references/session-selection.md')?.click();await sleep(160);",
    " const markdown=document.getElementById('monacoHost').dataset.language;",
    " file('assurance/procedure.yaml')?.click();await sleep(160);",
    " const yaml=document.getElementById('monacoHost').dataset.language;",
    " document.getElementById('mode-visual')?.click();await sleep(250);",
    " return {python,markdown,yaml,source:document.getElementById('source').value};",
    "})()"
  ].join("\n"));
  console.log("E1_MONACO_SOURCE_HISTORY",JSON.stringify({
    typed:true,undo:true,redo:true,languageModes:[switched.python,switched.markdown,switched.yaml]
  }));
  if(switched.python!=="python"||switched.markdown!=="markdown"||
     switched.yaml!=="yaml"||switched.source!==initialSource)
    throw Error("E1 Monaco file switch or history FAIL: "+JSON.stringify({
      python:switched.python,markdown:switched.markdown,yaml:switched.yaml,
      originalLength:initialSource.length,actualLength:switched.source?.length
    }));

  // The latest owner Skill is smoke-tested above (17 nodes / 46 bundles).
  // D1 historical edit cases need the PRE-HOLD authored source because their
  // precise Step order and qualified AST spans are frozen regression subjects.
  // Load it only into this browser-test session, NEVER the published sample.
  const pinnedSource=await evaluate([
    "(async()=>{",
    " const sleep=t=>new Promise(r=>setTimeout(r,t));",
    " const base='./samples/packages/establish-pdu-session/';",
    " const paths=new Set(['SKILL.md','assurance/contract.yaml',",
    "   'assurance/predicates.yaml','assurance/procedure.yaml',",
    "   'schemas/transfer-start-evaluation-input.schema.yaml']);",
    " const original=window.fetch,oldConfirm=window.confirm;",
    " window.fetch=function(input,init){",
    "  const url=String(input);",
    "  const relative=url.startsWith(base)?url.slice(base.length):null;",
    "  if(relative&&paths.has(relative))",
    "    return original.call(window,'/__test__/pre-hold/'+relative,init);",
    "  return original.call(window,input,init);",
    " };",
    " try{",
    "  window.confirm=()=>true;",
    "  const menu=document.getElementById('applicationMenu');",
    "  menu.querySelector('summary').click();",
    "  [...menu.querySelectorAll('[data-studio-command]')].find(x=>x.dataset.studioCommand==='file.loadSample')?.click();",
    "  for(let i=0;i<140;i++){",
    "   const src=document.getElementById('source')?.value||'';",
    "   if(src.includes('resolve-pcf-create-inputs')&&!src.includes('bind-udm-hold'))break;",
    "   await sleep(80);",
    "  }",
    "  const src=document.getElementById('source')?.value||'';",
    "  return {old:src.includes('resolve-pcf-create-inputs')&&!src.includes('bind-udm-hold'),",
    "    length:src.length};",
    " }finally{window.fetch=original;window.confirm=oldConfirm;}",
    "})()"
  ].join("\n"));
  console.log("D1_FROZEN_FIXTURE_LOADED",JSON.stringify(pinnedSource));
  if(!pinnedSource?.old)throw Error("Frozen D1 browser fixture not loaded");
  // Historical D1 authoring cases assert the complete frozen graph. Explicitly
  // restore Full here; the public Root default remains Main Path.
  const frozenFull=await evaluate([
    "(async()=>{",
    " const sleep=t=>new Promise(r=>setTimeout(r,t));",
    " const mode=document.getElementById('rootPathMode');",
    " mode.value='all';mode.dispatchEvent(new Event('change',{bubbles:true}));",
    " for(let i=0;i<150;i++){",
    "  if(document.querySelectorAll('.react-flow__node').length===17&&",
    "    document.querySelectorAll('.react-flow__edge-path').length===48)break;",
    "  await sleep(100);",
    " }",
    " return {nodes:document.querySelectorAll('.react-flow__node').length,",
    "  edges:document.querySelectorAll('.react-flow__edge-path').length};",
    "})()"
  ].join("\n"));
  if(frozenFull.nodes!==17||frozenFull.edges!==48)
    throw Error("Frozen full-graph acceptance setup FAIL: "+JSON.stringify(frozenFull));
  await runD1Interactions(evaluate,command);
  // A clean page navigation resets Inspector/selection state left by the
  // historical D1 interaction tests. All subsequent E2/E3/E4 browser checks
  // execute against the *new* owner sample, not the predecessor fixture.
  await command("Page.reload",{ignoreCache:true});
  await sleep(1000);
  const restoredOwner=await evaluate([
    "(async()=>{",
    " const sleep=t=>new Promise(r=>setTimeout(r,t));",
    " for(let i=0;i<150;i++){",
    "  const src=document.getElementById('source')?.value||'';",
    "  if(src.includes('bind-udm-hold')){",
    "   const mode=document.getElementById('rootPathMode');",
    "   if(mode.value!=='all'){mode.value='all';mode.dispatchEvent(new Event('change',{bubbles:true}));}",
    "  }",
    "  if(src.includes('bind-udm-hold')&&",
    "    document.querySelectorAll('.react-flow__node').length===17&&",
    "    document.querySelectorAll('.react-flow__edge-path').length===46)break;",
    "  await sleep(100);",
    " }",
    " const src=document.getElementById('source')?.value||'';",
    " return {owner:src.includes('bind-udm-hold'),",
    "  nodes:document.querySelectorAll('.react-flow__node').length,",
    "  edges:document.querySelectorAll('.react-flow__edge-path').length,",
    "  length:src.length};",
    "})()"
  ].join("\n"));
  console.log("D1_CURRENT_OWNER_RESTORED",JSON.stringify(restoredOwner));
  if(!restoredOwner?.owner||restoredOwner.nodes!==17||restoredOwner.edges!==46)
    throw Error("Current owner sample not cleanly loaded after D1");

  // D4 UX: check the real, currently selected owner Source without edits.
  const phaseEvidence=await evaluate([
    "(async()=>{",
    " const sleep=t=>new Promise(r=>setTimeout(r,t));",
    " const before=document.getElementById('source').value;",
    " const select=async id=>{",
    "  const el=document.querySelector('.react-flow__node[data-id=\"'+id+'\"]');",
    "  el?.click();await sleep(170);",
    "  const stage=[...document.querySelectorAll('#inspector .journey-stage')]",
    "    .find(x=>x.querySelector('summary')?.textContent.includes('准备'));",
    "  if(stage)stage.open=true;",
    "  return stage;",
    " };",
    " const udm=await select('nudm-sdm-subscribe');",
    " const call=udm?.querySelector('[data-phase-step-evidence=\"preconditions:2\"]');",
    " const verify=udm?.querySelector('[data-phase-step-evidence=\"preconditions:3\"]');",
    " const details=udm?.querySelector('[data-phase-dependency-step=\"preconditions:3\"]');",
    " if(details)details.open=true;",
    " const evidence=details?.querySelector('[data-binding-key=\"udmHoldRef\"]');",
    " const goodUdm=call?.dataset.evidenceCode==='CONSUMER_ABI_UNPROVEN'&&",
    "  verify?.dataset.evidenceCode==='PRODUCER_SCHEMA_UNPROVEN'&&",
    "  evidence?.dataset.evidenceCode==='PRODUCER_SCHEMA_UNPROVEN'&&",
    "  evidence.textContent.includes('当前 Package')&&",
    "  evidence.textContent.includes('输出 Schema')&&",
    "  !details.querySelector('input,select,textarea');",
    " const pcf=await select('npcf-sm-policy-control-create');",
    " const pcfVerify=pcf?.querySelector('[data-phase-step-evidence=\"preconditions:2\"]');",
    " const pcfDetails=pcf?.querySelector('[data-phase-dependency-step=\"preconditions:2\"]');",
    " if(pcfDetails)pcfDetails.open=true;",
    " const pcfHold=pcfDetails?.querySelector('[data-binding-key=\"pcfHoldRef\"]');",
    " const goodPcf=pcfVerify?.dataset.evidenceCode==='PRODUCER_SCHEMA_UNPROVEN'&&",
    "  pcfHold?.dataset.evidenceCode==='PRODUCER_SCHEMA_UNPROVEN'&&",
    "  !pcfDetails.querySelector('input,select,textarea');",
    " const unchanged=document.getElementById('source').value===before;",
    " return {ok:goodUdm&&goodPcf&&unchanged,goodUdm,goodPcf,unchanged,",
    "  udm:call?.textContent,pcf:pcfVerify?.textContent};",
    "})()"
  ].join("\n"));
  console.log("D4_CURRENT_OWNER_PHASE_EVIDENCE",JSON.stringify(phaseEvidence));
  if(!phaseEvidence?.ok)throw Error("D4 evidence UX smoke failed: "+
    JSON.stringify(phaseEvidence));

  // E2-A2: real Owner schemas, schema diagnostics, completion and hover.
  // Wide desktop scripts default to the read-only reference panel.
  await command("Emulation.setDeviceMetricsOverride",{
    width:1440,height:900,deviceScaleFactor:1,mobile:false
  });
  // E3-A1: actual script Inspector links switch Package Source files, without
  // executing Python or applying a Visual mutation.
  const scriptLinks=await evaluate([
    "(async()=>{",
    " const sleep=t=>new Promise(r=>setTimeout(r,t));",
    " const file=path=>[...document.querySelectorAll('#assetTree button.asset-file')]",
    "  .find(el=>el.getAttribute('aria-label')===path);",
    " file('scripts/evaluate_udm_read.py')?.click();await sleep(240);",
    " const control=document.getElementById('inspectorVisibility');",
    " const panel=document.getElementById('inspectorPanel');",
    " const wide=window.matchMedia('(min-width: 1180px)').matches;",
    " const defaultOpen=!panel.hidden&&control.getAttribute('aria-pressed')==='true';",
    " const available=!control.hidden;",
    " control.click();await sleep(80);",
    " const collapsed=panel.hidden&&control.getAttribute('aria-pressed')==='false';",
    " document.getElementById('source').dispatchEvent(new Event('input',{bubbles:true}));",
    " await sleep(90);",
    " const staysCollapsed=panel.hidden;",
    " control.click();await sleep(80);",
    " const manualReopen=!panel.hidden;",
    " const links=()=>[...document.querySelectorAll('#inspector button.source-link')];",
    " const labels=links().map(b=>b.textContent);",
    " const caller=links().find(b=>b.textContent.includes('Predicate'));",
    " caller?.click();await sleep(240);",
    " const callerOk=document.getElementById('fileName').textContent.includes('assurance/predicates.yaml')&&",
    "  document.getElementById('source').value.includes('ref: skill.evaluate-udm-read');",
    " const nonScriptClosed=panel.hidden;",
    " file('scripts/evaluate_udm_read.py')?.click();await sleep(200);",
    " const reopenedOnReturn=!panel.hidden;",
    " const schema=links().find(b=>b.textContent.includes('输入'));",
    " schema?.click();await sleep(240);",
    " const schemaOk=document.getElementById('fileName').textContent.includes('schemas/udm-read-evaluation-input.schema.yaml')&&",
    "  document.getElementById('source').value.includes('title: UdmReadEvaluationInput');",
    " return {wide,defaultOpen,available,collapsed,staysCollapsed,manualReopen,",
    "  reopenedOnReturn,nonScriptClosed,labels,callerOk,schemaOk};",
    "})()"
  ].join("\n"));
  console.log("E3_SCRIPT_REFERENCE_NAVIGATION",JSON.stringify(scriptLinks));
  if(!scriptLinks?.wide||!scriptLinks.defaultOpen||!scriptLinks.available||
     !scriptLinks.collapsed||!scriptLinks.staysCollapsed||
     !scriptLinks.manualReopen||!scriptLinks.reopenedOnReturn||
     !scriptLinks.nonScriptClosed||!scriptLinks.callerOk||
     !scriptLinks.schemaOk||scriptLinks.labels.length<3)
    throw Error("E3 script reference navigation failed: "+JSON.stringify(scriptLinks));

  // E3-A2: actual Chromium clicks the conservative Python symbol outline.
  const symbolNavigation=await evaluate([
    "(async()=>{",
    " const sleep=t=>new Promise(r=>setTimeout(r,t));",
    " const file=path=>[...document.querySelectorAll('#assetTree button.asset-file')]",
    "  .find(el=>el.getAttribute('aria-label')===path);",
    " const names=['evaluate_udm_read.py','evaluate_transfer_start.py','select_establishment_configuration.py'];",
    " const results=[];",
    " for(const name of names){",
    "  file('scripts/'+name)?.click();await sleep(180);",
    "  const before=document.getElementById('source').value;",
    "  const autoOpened=document.getElementById('workbench').dataset.inspector==='open';",
    "  const links=[...document.querySelectorAll('#inspector button.source-link')];",
    "  const main=links.find(el=>/^def main · L[0-9]+$/.test(el.textContent||''));",
    "  const classes=links.filter(el=>(el.textContent||'').startsWith('class '));",
    "  const line=Number(main?.textContent?.match(/L([0-9]+)$/)?.[1]);",
    "  main?.click();await sleep(100);",
    "  const focused=document.getElementById('monacoHost').contains(document.activeElement);",
    "  const unchanged=document.getElementById('source').value===before;",
    "  const expected=before.split(/\\r?\\n/)[line-1]||'';",
    "  results.push({name,line,autoOpened,main:!!main,classes:classes.length,focused,unchanged,",
    "    language:document.getElementById('monacoHost').dataset.language,expected});",
    " }",
    " return results;",
    "})()"
  ].join("\n"));
  console.log("E3_PYTHON_SYMBOL_NAVIGATION",JSON.stringify(symbolNavigation));
  if(!symbolNavigation||symbolNavigation.length!==3||
     symbolNavigation.some(x=>!x.autoOpened||!x.main||!x.classes||
       !x.focused||!x.unchanged||x.language!=="python"||
       !/^def main\(/.test(x.expected)))
    throw Error("E3 Python symbol navigation failed: "+JSON.stringify(symbolNavigation));

  // A narrow viewport must not force the Inspector over the editor.
  await command("Emulation.setDeviceMetricsOverride",{
    width:800,height:850,deviceScaleFactor:1,mobile:false
  });
  const narrowScript=await evaluate([
    "(async()=>{",
    " const sleep=t=>new Promise(r=>setTimeout(r,t));",
    " const pick=p=>[...document.querySelectorAll('#assetTree button.asset-file')]",
    "  .find(el=>el.getAttribute('aria-label')===p);",
    " pick('assurance/procedure.yaml')?.click();await sleep(150);",
    " pick('scripts/evaluate_udm_read.py')?.click();await sleep(170);",
    " const closed=document.getElementById('workbench').dataset.inspector==='closed';",
    " const available=!document.getElementById('inspectorVisibility').hidden;",
    " return {width:innerWidth,closed,available};",
    "})()"
  ].join("\n"));
  console.log("E3_NARROW_SCRIPT_INSPECTOR",JSON.stringify(narrowScript));
  if(!narrowScript?.closed||!narrowScript.available||narrowScript.width>980)
    throw Error("Narrow Python Inspector unexpectedly auto-opened: "+
      JSON.stringify(narrowScript));
  // Restore the desktop viewport for the existing Monaco popup/hover
  // coordinates; CDP clear reverts to a small headless default viewport.
  await command("Emulation.setDeviceMetricsOverride",{
    width:1440,height:900,deviceScaleFactor:1,mobile:false
  });
  await sleep(180);

  const ownerSchemaSmoke=await evaluate([
    "(async()=>{",
    " const sleep=t=>new Promise(r=>setTimeout(r,t));",
    " const host=document.getElementById('monacoHost');",
    " const source=document.getElementById('source');",
    " const file=path=>[...document.querySelectorAll('#assetTree button.asset-file')]",
    "  .find(el=>el.getAttribute('aria-label')===path);",
    " const markers=()=>host.querySelectorAll('.squiggly-error,.squiggly-warning').length;",
    " const waitFor=async fn=>{for(let i=0;i<35;i++){if(fn())return true;await sleep(100)}return false};",
    " const open=async path=>{file(path)?.click();await sleep(1000);return source.value};",
    " const dispatch=()=>source.dispatchEvent(new Event('input',{bubbles:true}));",
    " const contract=await open('assurance/contract.yaml');",
    " const contractPolicy=host.dataset.yamlSchemaCapability;",
    " await sleep(700);const contractValid=markers()===0;",
    " source.value=contract.replace('spec:\\n','spec:\\n  studioUnknownProbe: true\\n');dispatch();",
    " const contractRejectsUnknown=await waitFor(()=>markers()>0);",
    " source.value=contract;dispatch();",
    " await sleep(700);const contractRestored=markers()===0;",
    " const predicates=await open('assurance/predicates.yaml');",
    " const predicatePolicy=host.dataset.yamlSchemaCapability;",
    " await sleep(700);const predicateValid=markers()===0;",
    " source.value=predicates.replace('metadata:\\n  skill:','metadata:\\n  studioUnknownProbe: true\\n  skill:');dispatch();",
    " const predicateRejectsUnknown=await waitFor(()=>markers()>0);",
    " source.value=predicates;dispatch();",
    " await sleep(700);const predicateRestored=markers()===0;",
    " const procedure=await open('assurance/procedure.yaml');",
    " const procedurePolicy=host.dataset.yamlSchemaCapability;",
    " await sleep(900);const procedureValid=markers()===0;",
    " source.value='procedures: [\\n';dispatch();",
    " const procedureSyntaxError=await waitFor(()=>markers()>0);",
    " source.value=procedure;dispatch();",
    " await sleep(900);const procedureRestored=markers()===0;",
    " return {ok:host.dataset.yamlSchemaEngine==='monaco-yaml@5.5.1'&&",
    "  contractPolicy==='owner-schema-v1alpha1'&&predicatePolicy==='owner-schema-v1alpha1'&&",
    "  procedurePolicy==='procedure-schema-incompatible'&&contractValid&&contractRejectsUnknown&&",
    "  contractRestored&&predicateValid&&predicateRejectsUnknown&&predicateRestored&&",
    "  procedureValid&&procedureSyntaxError&&procedureRestored,",
    "  engine:host.dataset.yamlSchemaEngine,contractPolicy,predicatePolicy,procedurePolicy,",
    "  contractValid,contractRejectsUnknown,contractRestored,",
    "  predicateValid,predicateRejectsUnknown,predicateRestored,",
    "  procedureValid,procedureSyntaxError,procedureRestored};",
    "})()"
  ].join("\n"));
  console.log("E2_OWNER_SCHEMA_VALIDATION",JSON.stringify(ownerSchemaSmoke));
  if(!ownerSchemaSmoke?.ok)
    throw Error("E2 Owner schema validation / offline Procedure boundary FAIL: "+JSON.stringify(ownerSchemaSmoke));

  // Exercise schema-based completion and hover through the actual Monaco UI.
  const completionSetup=await evaluate([
    "(async()=>{",
    " const sleep=t=>new Promise(r=>setTimeout(r,t));",
    " const host=document.getElementById('monacoHost');",
    " const source=document.getElementById('source');",
    " const file=path=>[...document.querySelectorAll('#assetTree button.asset-file')]",
    "  .find(el=>el.getAttribute('aria-label')===path);",
    " file('assurance/contract.yaml')?.click();await sleep(900);",
    " document.getElementById('mode-source')?.click();",
    " const skeleton=['apiVersion: connectionagent.io/v1alpha1','kind: SkillContract',",
    "  'metadata:','  name: sample','spec:','  '].join('\\n');",
    " source.value=skeleton;source.dispatchEvent(new Event('input',{bubbles:true}));",
    " await sleep(350);",

    " const rows=[...host.querySelectorAll('.view-line')];",
    " const index=rows.findIndex(el=>el.textContent.trim()==='spec:');",
    " const blank=rows[index+1];",
    " const rect=host.getBoundingClientRect(),line=blank?.getBoundingClientRect();",
    " const x=line?line.x+30:rect.x+110,y=line?line.y+line.height/2:rect.y+150;",
    " return {x,y,policy:host.dataset.yamlSchemaCapability,",
    "  hit:document.elementFromPoint(x,y)?.className||null,",
    "  editorCount:host.querySelectorAll('.monaco-editor').length,",
    "  width:rect.width,height:rect.height,found:index>=0&&!!blank,",
    "  row:blank?.textContent||'',index};",
    "})()"
  ].join("\n"));
  console.log("E2_COMPLETION_SETUP",JSON.stringify(completionSetup));
  if(!completionSetup?.found||completionSetup.policy!=="owner-schema-v1alpha1"||completionSetup.width<200||completionSetup.height<120)
    throw Error("E2 completion editor position unavailable: "+JSON.stringify(completionSetup));
  await command("Input.dispatchMouseEvent",{type:"mousePressed",x:completionSetup.x,y:completionSetup.y,button:"left",clickCount:1});
  await command("Input.dispatchMouseEvent",{type:"mouseReleased",x:completionSetup.x,y:completionSetup.y,button:"left",clickCount:1});
  await command("Input.dispatchKeyEvent",{type:"rawKeyDown",key:"Control",code:"ControlLeft",modifiers:2,windowsVirtualKeyCode:17,nativeVirtualKeyCode:17});
  await command("Input.dispatchKeyEvent",{type:"rawKeyDown",key:" ",code:"Space",modifiers:2,windowsVirtualKeyCode:32,nativeVirtualKeyCode:32});
  await command("Input.dispatchKeyEvent",{type:"keyUp",key:" ",code:"Space",modifiers:2,windowsVirtualKeyCode:32,nativeVirtualKeyCode:32});
  await command("Input.dispatchKeyEvent",{type:"keyUp",key:"Control",code:"ControlLeft",modifiers:0,windowsVirtualKeyCode:17,nativeVirtualKeyCode:17});
  console.log("E2_COMPLETION_FOCUS",JSON.stringify(await evaluate("({active:document.activeElement?.className||document.activeElement?.tagName,aria:document.activeElement?.getAttribute?.('aria-label'),input:document.querySelector('.monaco-editor textarea.inputarea')===document.activeElement})")));
  await sleep(900);
  const completion=await evaluate([
    "(()=>{const widget=document.querySelector('.suggest-widget');",
    " const labels=[...document.querySelectorAll('.suggest-widget .monaco-list-row')]",
    "  .map(el=>el.innerText||el.textContent||'').join(' ');",
    " return {visible:!!widget&&getComputedStyle(widget).display!=='none',labels};})()"
  ].join("\n"));
  console.log("E2_OWNER_SCHEMA_COMPLETION",JSON.stringify(completion));
  if(!completion?.visible||!/(skillType|goal|entryProcedure)/.test(completion.labels))
    throw Error("E2 Owner schema completion did not surface Contract fields: "+JSON.stringify(completion));

  // Hover on the constrained skillType property must expose owner schema values.
  const hover=await evaluate([
    "(async()=>{",
    " const sleep=t=>new Promise(r=>setTimeout(r,t));",
    " const host=document.getElementById('monacoHost'),source=document.getElementById('source');",
    " source.value=['apiVersion: connectionagent.io/v1alpha1','kind: SkillContract',",
    "  'metadata:','  name: sample','spec:','  skillType: executable'].join('\\n');",
    " source.dispatchEvent(new Event('input',{bubbles:true}));await sleep(500);",
    " const row=[...host.querySelectorAll('.view-line')].find(el=>el.textContent.includes('skillType:'));",
    " const rect=row?.getBoundingClientRect();",
    " return {x:rect?rect.x+105:0,y:rect?rect.y+rect.height/2:0,found:!!rect};",
    "})()"
  ].join("\n"));
  if(!hover?.found)throw Error("E2 schema hover target unavailable");
  await command("Input.dispatchMouseEvent",{type:"mouseMoved",x:hover.x,y:hover.y});
  await sleep(900);
  const hoverText=await evaluate("document.querySelector('.monaco-hover-content')?.innerText||''");
  console.log("E2_OWNER_SCHEMA_HOVER",JSON.stringify({text:hoverText}));
  if(!/executable|authoring_assistant/.test(hoverText))
    throw Error("E2 Owner schema hover did not expose enum: "+hoverText);

  // Right click a visible Monaco text row, not the previous hover tooltip.
  const menuPoint=await evaluate([
    "(async()=>{",
    " document.getElementById('mode-source').click();",
    " await new Promise(r=>setTimeout(r,180));",
    " const host=document.querySelector('#monacoHost .monaco-editor');",
    " const rect=host?.getBoundingClientRect();",
    " return {found:!!rect,x:rect?rect.x+Math.min(170,rect.width/3):0,",
    "  y:rect?rect.y+Math.min(125,rect.height/3):0};",
    "})()"
  ].join("\n"));
  if(!menuPoint.found)throw Error("Monaco edit surface unavailable");
  await command("Input.dispatchMouseEvent",{
    type:"mouseMoved",x:menuPoint.x,y:menuPoint.y
  });
  await sleep(120);
  await command("Input.dispatchMouseEvent",{
    type:"mousePressed",x:menuPoint.x,y:menuPoint.y,
    button:"right",buttons:2,clickCount:1
  });
  await command("Input.dispatchMouseEvent",{
    type:"mouseReleased",x:menuPoint.x,y:menuPoint.y,
    button:"right",buttons:0,clickCount:1
  });
  await sleep(350);
  const contextMenu=await evaluate([
    "(()=>{",
    " const elements=[...document.querySelectorAll('.context-view,.monaco-menu-container,.monaco-menu')];",
    " const visible=elements.filter(el=>{const r=el.getBoundingClientRect();return r.width>70&&r.height>40});",
    " const menu=visible.find(el=>el.classList.contains('monaco-menu-container'))||",
    "  visible.find(el=>el.classList.contains('monaco-menu'));",
    " const surface=menu?.querySelector('.monaco-menu')||menu;",
    " const bg=surface?getComputedStyle(surface).backgroundColor:'';",
    " return {visible:!!menu,opaque:bg==='rgb(255, 255, 255)',bg,",
    "  hasActions:!!menu?.querySelector('.action-item'),",
    "  label:menu?.textContent?.trim().slice(0,80)||'',",
    "  candidates:visible.map(el=>({cls:el.className,bg:getComputedStyle(el).backgroundColor}))};",
    "})()"
  ].join("\n"));
  console.log("MONACO_CONTEXT_MENU_OPAQUE",JSON.stringify(contextMenu));
  if(contextMenu?.visible){
    if(!contextMenu.opaque||!contextMenu.hasActions)
      throw Error("Real Monaco context menu is not opaque: "+JSON.stringify(contextMenu));
  }else{
    // Headless Linux may not display an OS/context-menu overlay in response
    // to a CDP right-click. Verify *computed* CSS on the exact Monaco menu
    // DOM classes; do not mislabel this fallback as an actual OS popup PASS.
    const styleProbe=await evaluate([
      "(()=>{",
      " const shell=document.createElement('div');",
      " shell.className='context-view monaco-menu-container';",
      " shell.style.position='fixed';shell.style.left='15px';shell.style.top='15px';",
      " shell.style.width='240px';shell.style.height='120px';",
      " const menu=document.createElement('div');menu.className='monaco-menu';",
      " shell.appendChild(menu);document.body.appendChild(shell);",
      " const root=getComputedStyle(shell),inner=getComputedStyle(menu);",
      " const result={outer:root.backgroundColor,inner:inner.backgroundColor,",
      "  ink:inner.color,opaque:root.backgroundColor==='rgb(255, 255, 255)'&&",
      "    inner.backgroundColor==='rgb(255, 255, 255)'};",
      " shell.remove();return result;",
      "})()"
    ].join("\n"));
    console.log("MONACO_CONTEXT_MENU_STYLES_FALLBACK",JSON.stringify(styleProbe));
    if(!styleProbe.opaque)throw Error("Monaco menu stylesheet still transparent: "+
      JSON.stringify(styleProbe));
  }
  await command("Input.dispatchKeyEvent",{
    type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27
  });
  await command("Input.dispatchKeyEvent",{
    type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27
  });

  // E4-A1: real Chromium UI receives a directory-shaped FileList, opens a
  // source-backed multi-file Package and ZIP-exports exact opaque bytes.
  // This is an in-browser FileList event, not an OS chooser / disk-write test.
  const directorySmoke=await evaluate([
    "(async()=>{",
    " const sleep=t=>new Promise(r=>setTimeout(r,t));",
    " const sourceUrl='./samples/packages/establish-pdu-session/assurance/procedure.yaml';",
    " const proc=await (await fetch(sourceUrl)).text();",
    " const files=[",
    "  ['local-e4/SKILL.md','# Local E4\\n'],",
    "  ['local-e4/assurance/procedure.yaml',proc],",
    "  ['local-e4/references/test.md','# Reference\\n'],",
    "  ['local-e4/assets/blob.bin',new Uint8Array([0,255,137,80,78,71,0])],",
    "  ['local-e4/custom/unknown.xyz',new Uint8Array([0,200,201,0])]",
    " ];",
    " const dt=new DataTransfer();",
    " for(const [path,data] of files){",
    "  const file=new File([data],path.split('/').at(-1));",
    "  Object.defineProperty(file,'webkitRelativePath',{value:path});",
    "  dt.items.add(file);",
    " }",
    " const inp=document.getElementById('directoryPicker');",
    " const oldConfirm=window.confirm;",
    " window.confirm=()=>true;",
    " inp.files=dt.files;",
    " const selected=[...inp.files].map(f=>f.webkitRelativePath);",
    " inp.dispatchEvent(new Event('change',{bubbles:true}));",
    " for(let i=0;i<80&&!document.getElementById('fileName')?.textContent.includes('local-e4');i++)await sleep(80);",
    " const name=document.getElementById('fileName').textContent;",
    " const count=document.getElementById('fileCount').textContent;",
    " const opaque=[...document.querySelectorAll('#assetTree button.asset-file')].filter(b=>b.disabled);",
    " const raw=document.getElementById('source').value;",
    " const source=document.getElementById('source');",
    " source.value='# E4 edited\\n'+raw;",
    " source.dispatchEvent(new Event('input',{bubbles:true}));",
    " await sleep(150);",
    " let blob=null;",
    " const objectUrl=URL.createObjectURL;",
    " URL.createObjectURL=function(value){blob=value;return objectUrl.call(URL,value)};",
    " document.getElementById('exportPackageButton').click();",
    " URL.createObjectURL=objectUrl;",
    " window.confirm=oldConfirm;",
    " const zip=new Uint8Array(await blob?.arrayBuffer());",
    " const view=new DataView(zip.buffer),reader=new TextDecoder();",
    " const entries=new Map();let p=0;",
    " while(p+30<zip.length&&view.getUint32(p,true)===0x04034b50){",
    "  const n=view.getUint16(p+26,true),size=view.getUint32(p+18,true);",
    "  const path=reader.decode(zip.slice(p+30,p+30+n));",
    "  entries.set(path,zip.slice(p+30+n,p+30+n+size));",
    "  p+=30+n+size;",
    " }",
    " const opaqueBytes=entries.get('assets/blob.bin');",
    " const unknown=entries.get('custom/unknown.xyz');",
    " const procZip=entries.get('assurance/procedure.yaml');",
    " const skillZip=entries.get('SKILL.md');",
    " return {selected,name,count,disabled:opaque.length,",
    "  problems:document.getElementById('projectionState').textContent,",
    "  zipCount:entries.size,zipPaths:[...entries.keys()],",
    "  rawPreserved:raw===proc,",
    "  modified:reader.decode(procZip||new Uint8Array()).startsWith('# E4 edited\\n'),",
    "  skillIntact:reader.decode(skillZip||new Uint8Array())==='# Local E4\\n',",
    "  opaqueIntact:String(opaqueBytes)==='0,255,137,80,78,71,0',",
    "  unknownIntact:String(unknown)==='0,200,201,0',",
    "  message:document.getElementById('hint').textContent};",
    "})()"
  ].join("\n"));
  console.log("E4_LOCAL_DIRECTORY_IMPORT",JSON.stringify(directorySmoke));
  if(directorySmoke?.selected.length!==5||
    !directorySmoke.name.includes("local-e4 / assurance/procedure.yaml")||
    directorySmoke.count!=="5 文件"||directorySmoke.disabled!==2||
    directorySmoke.zipCount!==5||!directorySmoke.rawPreserved||
    !directorySmoke.modified||!directorySmoke.skillIntact||
    !directorySmoke.opaqueIntact||!directorySmoke.unknownIntact)
    throw Error("E4 directory browser import/ZIP FAIL: "+JSON.stringify(directorySmoke));

  // E4-A2: real Chromium FileSystemWritableFileStream in the origin-private
  // file system, with a picker stub. This never selects/writes an OS directory.
  const e4DiskSave=await evaluate([
    "(async()=>{",
    " const sleep=t=>new Promise(r=>setTimeout(r,t));",
    " const originalPicker=window.showDirectoryPicker,originalConfirm=window.confirm;",
    " const root=await navigator.storage.getDirectory();",
    " const folder=await root.getDirectoryHandle('local-e4',{create:true});",
    " const original=await (await fetch('./samples/packages/establish-pdu-session/assurance/procedure.yaml')).text();",
    " const files=[['SKILL.md','# Local E4\\n'],",
    "  ['assurance/procedure.yaml',original],",
    "  ['references/test.md','# Reference\\n'],",
    "  ['assets/blob.bin',new Uint8Array([0,255,137,80,78,71,0])],",
    "  ['custom/unknown.xyz',new Uint8Array([0,200,201,0])]];",
    " const getFile=async path=>{",
    "  const bits=path.split('/'),name=bits.pop();let dir=folder;",
    "  for(const bit of bits)dir=await dir.getDirectoryHandle(bit,{create:true});",
    "  return dir.getFileHandle(name,{create:true});",
    " };",
    " for(const [path,data] of files){",
    "  const handle=await getFile(path),writer=await handle.createWritable();",
    "  await writer.write(data);await writer.close();",
    " }",
    " const perms=await folder.queryPermission({mode:'readwrite'});",
    " const modes=[];",
    " window.showDirectoryPicker=async opts=>{modes.push(opts?.mode);return folder;};",
    " const confirmations=[];",
    " window.confirm=msg=>{confirmations.push(String(msg));return true;};",
    " const firstSource=document.getElementById('source');",
    " firstSource.value='# E4 short\\n';",
    " firstSource.dispatchEvent(new Event('input',{bubbles:true}));",
    " await sleep(160);",
    " const btn=document.getElementById('saveDirectoryButton');",
    " const eligible=!btn.hidden&&!btn.disabled;",
    " let saved=false,conflicted=false,opaqueIntact=false,unchanged=true;",
    " try{",
    "  btn.click();",
    "  for(let i=0;i<100;i++){",
    "   if(document.getElementById('saveNotice').dataset.status==='SAVED')break;",
    "   await sleep(60);",
    "  }",
    "  saved=document.getElementById('saveNotice').dataset.status==='SAVED';",
    "  const value=new TextDecoder().decode(await (await (await getFile('assurance/procedure.yaml')).getFile()).arrayBuffer());",
    "  const opq=new Uint8Array(await (await (await getFile('assets/blob.bin')).getFile()).arrayBuffer());",
    "  unchanged=files.length===[...document.querySelectorAll('#assetTree button.asset-file')].length;",
    "  opaqueIntact=String(opq)==='0,255,137,80,78,71,0';",
    "  saved=saved&&value==='# E4 short\\n'&&value.length<original.length;",
    "  // Next save cannot clobber an unrelated external edit in the same Package.",
    "  const target=await getFile('SKILL.md'),w=await target.createWritable();",
    "  await w.write('# external change\\n');await w.close();",
    "  const source=document.getElementById('source');",
    "  source.value='# E4 second change\\n'+value;",
    "  source.dispatchEvent(new Event('input',{bubbles:true}));",
    "  await sleep(140);",
    "  btn.click();",
    "  for(let i=0;i<100;i++){",
    "   if(document.getElementById('saveNotice').dataset.status==='CONFLICT')break;",
    "   await sleep(60);",
    "  }",
    "  const after=new TextDecoder().decode(await (await (await getFile('assurance/procedure.yaml')).getFile()).arrayBuffer());",
    "  conflicted=document.getElementById('saveNotice').dataset.status==='CONFLICT'&&after===value;",
    "  return {eligible,perms,modes,saved,conflicted,opaqueIntact,unchanged,",
    "    warned:confirmations.length===1&&confirmations[0].includes('不能证明')&&confirmations[0].includes('原始物理目录'),",
    "    info:document.getElementById('saveNotice').textContent};",
    " }finally{",
    "  window.showDirectoryPicker=originalPicker;window.confirm=originalConfirm;",
    " }",
    "})()"
  ].join("\n"));
  console.log("E4_SAFE_ORIGINAL_SAVE",JSON.stringify(e4DiskSave));
  if(!e4DiskSave?.eligible||e4DiskSave.perms!=="granted"||
     e4DiskSave.modes.join(",")!=="readwrite,readwrite"||
     !e4DiskSave.saved||!e4DiskSave.conflicted||
     !e4DiskSave.opaqueIntact||!e4DiskSave.unchanged||
     !e4DiskSave.warned)
    throw Error("E4-A2 writable-stream / external conflict smoke failed: "+JSON.stringify(e4DiskSave));

  // E4 session handle: true read-only opener + permission-on-save.
  // Picker is stubbed but OPFS reads and writes are real browser operations.
  const sessionSave=await evaluate(String.raw`
    (async()=>{
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      const store=await navigator.storage.getDirectory();
      const folder=await store.getDirectoryHandle('session-e4',{create:true});
      const skill=await folder.getFileHandle('SKILL.md',{create:true});
      const writer=await skill.createWritable();
      await writer.write('# Session E4\n');await writer.close();
      const pickerModes=[],permissionModes=[],confirmations=[];
      const session={kind:'directory',name:'session-e4',
        entries:()=>folder.entries(),
        queryPermission:async()=> 'granted',
        requestPermission:async({mode})=>{
          permissionModes.push(mode);return 'granted';
        }};
      const oldPicker=window.showDirectoryPicker,oldConfirm=window.confirm;
      window.showDirectoryPicker=async opts=>{
        pickerModes.push(opts?.mode);return session;
      };
      window.confirm=msg=>{confirmations.push(String(msg));return true};
      try{
        document.getElementById('openDirectoryButton').click();
        for(let i=0;i<80;i++){
          if(document.getElementById('fileName').textContent.includes('session-e4'))break;
          await sleep(75);
        }
        const imported=document.getElementById('fileName').textContent.includes('session-e4')&&
          document.getElementById('fileCount').textContent==='1 文件';
        const notice=document.getElementById('directoryOpenNotice');
        const openedNotice=!notice.hidden&&notice.textContent.includes('已打开');
        const btn=document.getElementById('saveDirectoryButton');
        const visible=!btn.hidden;
        const disabled=btn.disabled;
        const source=document.getElementById('source');
        source.value='# Session E4 edited\n';
        source.dispatchEvent(new Event('input',{bubbles:true}));
        await sleep(150);
        const ready=!btn.disabled;
        btn.click();
        for(let i=0;i<100;i++){
          if(document.getElementById('saveNotice').dataset.status==='SAVED')break;
          await sleep(65);
        }
        const saved=document.getElementById('saveNotice').dataset.status==='SAVED';
        const onDisk=await (await skill.getFile()).text();
        // A denied second write grant must preserve bytes and the open handle.
        session.requestPermission=async({mode})=>{
          permissionModes.push('denied:'+mode);return 'denied';
        };
        source.value='# Denied subsequent save\n';
        source.dispatchEvent(new Event('input',{bubbles:true}));
        await sleep(130);
        btn.click();
        for(let i=0;i<50;i++){
          if(document.getElementById('saveNotice').dataset.status==='BLOCKED')break;
          await sleep(55);
        }
        const denied=document.getElementById('saveNotice').dataset.status==='BLOCKED';
        const afterDenied=await (await skill.getFile()).text();
        return {imported,openedNotice,visible,disabled,ready,saved,denied,
          preserved:afterDenied===onDisk,exact:onDisk==='# Session E4 edited\n',
          pickerModes,permissionModes,
          writeConfirmations:confirmations.filter(x=>x.includes('即将写入')).length,
          confirmationText:confirmations.at(-1)?.slice(0,190)};
      }finally{
        window.showDirectoryPicker=oldPicker;
        window.confirm=oldConfirm;
      }
    })()
  `);
  console.log("E4_SESSION_DIRECTORY_SAVE",JSON.stringify(sessionSave));
  if(!sessionSave?.imported||!sessionSave.openedNotice||
     !sessionSave.visible||!sessionSave.disabled||!sessionSave.ready||
     !sessionSave.saved||!sessionSave.denied||!sessionSave.preserved||
     !sessionSave.exact||sessionSave.pickerModes.join(",")!=="read"||
     sessionSave.permissionModes.join(",")!=="readwrite,denied:readwrite"||
     sessionSave.writeConfirmations!==1||
     !sessionSave.confirmationText.includes('本次会话'))
    throw Error("E4 session handle permission/save smoke failed: "+
      JSON.stringify(sessionSave));

  // Evaluate browser diagnostics after all E2 YAML interactions have run.
  if(warnings.length)console.log("BROWSER_WARNINGS",JSON.stringify(warnings));
  if(exceptions.length)throw Error("Browser JS exceptions: "+JSON.stringify(exceptions));


}finally{
  if(ws)ws.close();
  // Chromium may still be writing its profile after SIGKILL is sent.
  // Wait for process exit before removing the temporary profile; otherwise
  // Node 24 can fail with ENOTEMPTY while the browser tests already passed.
  const exited=new Promise(resolve=>{
    if(child.exitCode!==null||child.signalCode!==null){resolve();return;}
    child.once("exit",resolve);
  });
  if(child.exitCode===null&&child.signalCode===null)child.kill("SIGKILL");
  await Promise.race([exited,sleep(1500)]);
  await rm(temp,{recursive:true,force:true,maxRetries:8,retryDelay:120});
  await new Promise(r=>server.close(r));
}
