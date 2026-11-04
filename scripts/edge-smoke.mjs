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
for(const legacy of ["samples/packages/ensure-pdu-session","samples/ensure-pdu-session.procedure.yaml"]){
  if(existsSync(resolve(dist,legacy)))throw Error("Legacy Ensure asset leaked into Pages dist: "+legacy);
}
const types={".html":"text/html",".css":"text/css",".js":"text/javascript",".yaml":"text/yaml",".md":"text/markdown",".json":"application/json"};
const server=createServer((req,res)=>{
  const path=decodeURIComponent(new URL(req.url,"http://localhost").pathname);
  // Legacy Ensure YAML stays in source only, served exclusively by this local test server.
  const testFixture=path==="/__test__/ensure-procedure.yaml";
  const file=testFixture ? resolve("site/samples/ensure-pdu-session.procedure.yaml")
    : resolve(dist,"."+path.replace(/\/$/,"/index.html"));
  if(!testFixture&&file!==dist&&!file.startsWith(dist+sep)){res.writeHead(403).end();return;}
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
    if(msg.method==="Runtime.exceptionThrown")exceptions.push(msg.params?.exceptionDetails?.text);
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
    " for(let i=0;i<110;i++){",
    "  if(document.querySelectorAll('.react-flow__node').length>=11)break;",
    "  await sleep(100);",
    " }",
    " const button=document.getElementById('establishSampleButton');",
    " if(!button)return {error:'CreatedSession sample button missing'};",
    " button.click();",
    " for(let i=0;i<130;i++){",
    "  if(document.querySelectorAll('.react-flow__node').length===17 &&",
    "    document.querySelectorAll('.react-flow__edge-path').length===48 &&",
    "    document.querySelectorAll('.react-flow__handle[data-handleid^=edge-]').length===96 &&",
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
    " const expected=Array.from({length:48},(_,i)=>'flow-edge-'+i);",
    " return {nodes:document.querySelectorAll('.react-flow__node').length,",
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
  if(result?.nodes!==17||result.edges!==48||result.valid!==48||result.markersOk!==48||
     result.attachedPorts!==96||result.maxPortGap>1.5)
    throw Error("CreatedSession visible edges FAIL");
  if(warnings.length)console.log("BROWSER_WARNINGS",JSON.stringify(warnings));
  if(exceptions.length)throw Error("Browser JS exceptions: "+JSON.stringify(exceptions));
  console.log("CreatedSession visible paths and aligned React Flow ports PASS: "+
    result.valid+" / "+result.attachedPorts);

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
    " const area=document.querySelector('#monacoHost .monaco-editor textarea.inputarea');",
    " area?.focus();",
    " return {focused:!!area&&document.activeElement===area,visible:",
    "  getComputedStyle(document.getElementById('monacoHost')).display!=='none'};",
    "})()"
  ].join("\n"));
  if(!focused?.focused||!focused?.visible)
    throw Error("E1 Monaco keyboard focus FAIL: "+JSON.stringify(focused));
  await command("Input.insertText",{text:"# E1 Monaco keyboard input\n"});
  await sleep(180);
  const typedSource=await evaluate("document.getElementById('source').value");
  if(typedSource===initialSource||!typedSource.includes("# E1 Monaco keyboard input"))
    throw Error("E1 Monaco typing did not reach shared Source buffer");
  await evaluate("document.getElementById('undoButton').click()");
  await sleep(120);
  const undone=await evaluate("document.getElementById('source').value");
  await evaluate("document.getElementById('redoButton').click()");
  await sleep(120);
  const redone=await evaluate("document.getElementById('source').value");
  await evaluate("document.getElementById('undoButton').click()");
  await sleep(150);
  if(undone!==initialSource||redone!==typedSource)
    throw Error("E1 Monaco typing, undo and redo drifted from Studio history");
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

  await runD1Interactions(evaluate,command);

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
