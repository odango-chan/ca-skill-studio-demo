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
  // Trusted CDP click activates Monaco's own input controller, unlike DOM focus.
  const pos=await evaluate("(()=>{const r=document.getElementById('monacoHost').getBoundingClientRect();return {x:r.x+120,y:r.y+60,width:r.width,height:r.height}})()");
  if(pos.width<200||pos.height<120)throw Error("Monaco canvas has no editable bounds");
  await command("Input.dispatchMouseEvent",{type:"mousePressed",x:pos.x,y:pos.y,button:"left",clickCount:1});
  await command("Input.dispatchMouseEvent",{type:"mouseReleased",x:pos.x,y:pos.y,button:"left",clickCount:1});
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

  await runD1Interactions(evaluate,command);

  // E2-A2: real Owner schemas, schema diagnostics, completion and hover.
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
  if(!completionSetup?.found||completionSetup.policy!=="owner-schema-v1alpha1"||completionSetup.width<200||completionSetup.height<120)
    throw Error("E2 completion editor position unavailable: "+JSON.stringify(completionSetup));
  await command("Input.dispatchMouseEvent",{type:"mousePressed",x:completionSetup.x,y:completionSetup.y,button:"left",clickCount:1});
  await command("Input.dispatchMouseEvent",{type:"mouseReleased",x:completionSetup.x,y:completionSetup.y,button:"left",clickCount:1});
  await command("Input.dispatchKeyEvent",{type:"keyDown",key:"Control",code:"ControlLeft",modifiers:2});
  await command("Input.dispatchKeyEvent",{type:"keyDown",key:" ",code:"Space",modifiers:2});
  await command("Input.dispatchKeyEvent",{type:"keyUp",key:" ",code:"Space",modifiers:2});
  await command("Input.dispatchKeyEvent",{type:"keyUp",key:"Control",code:"ControlLeft",modifiers:0});
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
