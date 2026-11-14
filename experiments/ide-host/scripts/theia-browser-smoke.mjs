import {runPackageOverviewAcceptance,runWorkbenchAcceptance,assertSourceVisualPair} from "./workbench-browser-acceptance.mjs";
// Real Chromium smoke for both Theia browser-only static preview and the
// normal backend-backed browser host. Static mode uses an explicitly isolated
// same-origin demo-only webview adapter; backend mode uses Theia's normal host.
import {createServer} from "node:http";
import {createReadStream,existsSync} from "node:fs";
import {mkdtemp,readFile,rm,writeFile} from "node:fs/promises";
import {spawn} from "node:child_process";
import {tmpdir} from "node:os";
import {extname,join,resolve,sep} from "node:path";

const root=resolve("experiments/ide-host/theia-online/lib/frontend");
const externalUrl=process.env.THEIA_URL;
const basePath=(process.env.THEIA_BASE_PATH||"").replace(/\/+$/,"");
const requireWebview=process.env.THEIA_REQUIRE_WEBVIEW==="1";
const requireBrowserLsp=process.env.THEIA_REQUIRE_BROWSER_LSP==="1";
const requireEditor=Boolean(externalUrl)||requireWebview;
const chrome=process.env.CHROME_BIN||
  ["/usr/bin/google-chrome","/usr/bin/google-chrome-stable","/usr/bin/chromium"].find(existsSync);
if(!externalUrl&&!existsSync(join(root,"index.html")))throw Error("Theia frontend missing");
if(!chrome)throw Error("Chrome unavailable; browser acceptance NOT_RUN");
const types={".html":"text/html",".js":"text/javascript",".css":"text/css",
  ".json":"application/json",".svg":"image/svg+xml",".wasm":"application/wasm",
  ".ttf":"font/ttf",".woff":"font/woff",".woff2":"font/woff2",".png":"image/png",
  ".ico":"image/x-icon",".map":"application/json"};
const requests=new Set(),notFound=new Set(),networkFailures=[],networkResponses=[];
const defaultExecutionContexts=new Map();
const server=externalUrl?null:createServer((req,res)=>{
  const url=new URL(req.url,"http://localhost");
  let name;
  try{name=decodeURIComponent(url.pathname);}catch{res.writeHead(400).end();return;}
  if(basePath){
    if(name===basePath||name.startsWith(basePath+"/")){
      name=name.slice(basePath.length)||"/";
    }else{
      // Match GitHub Pages project-site routing: the artifact exists below
      // /<repository>/, not at the origin root. Root-relative plugin URLs must
      // fail here instead of being silently mapped to the project artifact.
      res.writeHead(404).end();return;
    }
  }
  requests.add(name);
  const file=resolve(root,"."+name.replace(/\/$/,"/index.html"));
  if(file!==root&&!file.startsWith(root+sep)){res.writeHead(403).end();return;}
  const stream=createReadStream(file);
  stream.on("error",()=>{notFound.add(name);if(!res.headersSent)res.writeHead(404);res.end();});
  stream.on("open",()=>{
    res.writeHead(200,{"Content-Type":types[extname(file)]||"application/octet-stream",
      "Cache-Control":"no-store"});stream.pipe(res);
  });
});
if(server)await new Promise(ok=>server.listen(0,"127.0.0.1",ok));
if(server){
  const workerAssetPath="/hostedPlugin/vscode_markdown_language_features/dist/browser/serverWorkerMain.js";
  const workerPath=basePath+workerAssetPath;
  const workerFile=join(root,workerAssetPath);
  if(!existsSync(workerFile))
    throw Error("Pinned native Markdown Worker was not staged: "+workerFile);
  const workerProbe=await fetch("http://127.0.0.1:"+server.address().port+workerPath);
  if(!workerProbe.ok)
    throw Error("Theia Pages-base-path hostedPlugin Worker route failed: "+
      workerPath+" status="+workerProbe.status);
  console.log("STUDIO_THEIA_PAGES_BASE_PATH_PLUGIN_WORKER",JSON.stringify({
    path:workerPath,status:workerProbe.status,bytes:(await workerProbe.arrayBuffer()).byteLength,
    basePath
  }));
}
const url=externalUrl||("http://127.0.0.1:"+server.address().port+basePath+"/");
const profile=await mkdtemp(join(tmpdir(),"theia-online-chrome-"));
const child=spawn(chrome,["--headless=new","--no-sandbox","--disable-gpu",
  "--disable-dev-shm-usage","--no-first-run","--no-default-browser-check",
  "--disable-background-networking","--disable-extensions",
  "--remote-debugging-port=0","--user-data-dir="+profile,"about:blank"],
  {stdio:["ignore","ignore","pipe"]});
let chromeStderr="";
child.stderr?.on("data",chunk=>{
  chromeStderr=(chromeStderr+chunk.toString()).slice(-5000);
});
child.on("error",error=>{
  chromeStderr=(chromeStderr+"\\nspawn error: "+String(error)).slice(-5000);
});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let ws,seq=0;const pending=new Map(),exceptions=[],consoleErrors=[],markdownWorkerRequests=[];
const command=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
  const id=++seq;
  const timer=setTimeout(()=>{pending.delete(id);reject(Error("Chromium command timed out: "+method+" "+String(params.expression??"").slice(0,200)));},30000);
  pending.set(id,{resolve,reject,timer});
  ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
});
const workerTargets=new Map(),workerTargetSetupErrors=[],discoveredTargets=[],workerRuntimeErrors=[];
const enableTargetSession=async(sessionId,targetInfo)=>{
  const type=targetInfo?.type??"unknown";
  const targetUrl=targetInfo?.url??"";
  // Observe dedicated/shared workers without pausing them. The Markdown
  // extension is activated later by acceptance, after this Network domain is
  // enabled on Theia's plugin worker, so its serverWorkerMain request is seen.
  // Never pause the workbench or service worker: doing so can stall Webviews.
  if(type!=="worker"&&type!=="shared_worker")return;
  try{
    await command("Runtime.enable",{},sessionId);
    await command("Network.enable",{},sessionId);
    await command("Target.setAutoAttach",{
      autoAttach:true,waitForDebuggerOnStart:false,flatten:true
    },sessionId);
  }catch(error){
    workerTargetSetupErrors.push({target:targetUrl,type,
      phase:"enable-worker-observation",error:String(error)});
  }
};
const evalJS=async expression=>{
  const data=await command("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});
  if(data.exceptionDetails)throw Error("Chromium evaluate: "+data.exceptionDetails.text);
  return data.result?.value;
};
try{
  let port=null;
  for(let i=0;i<600;i++){
    try{port=Number((await readFile(join(profile,"DevToolsActivePort"),"utf8")).split("\n")[0]);break;}
    catch{
      if(child.exitCode!==null)throw Error("Chrome exited before DevTools startup "+
        JSON.stringify({code:child.exitCode,signal:child.signalCode,stderr:chromeStderr}));
    }
    await sleep(100);
  }
  if(!port)throw Error("Chrome DevTools debugging port unavailable: "+
    JSON.stringify({code:child.exitCode,signal:child.signalCode,stderr:chromeStderr}));
  const tabs=await(await fetch("http://127.0.0.1:"+port+"/json")).json();
  const page=tabs.find(t=>t.type==="page");
  if(!page)throw Error("Chromium page target absent");
  ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok,fail)=>{ws.addEventListener("open",ok,{once:true});
    ws.addEventListener("error",fail,{once:true});});
  ws.addEventListener("message",event=>{
    const msg=JSON.parse(event.data);
    if(msg.method==="Page.javascriptDialogOpening"&&msg.params?.type==="beforeunload"){
      console.log("STUDIO_TEST_BEFOREUNLOAD_ACCEPTED");
      void command("Page.handleJavaScriptDialog",{accept:true}).catch(error=>exceptions.push(String(error)));
    }
    if(msg.method==="Target.targetCreated"){
      const targetInfo=msg.params?.targetInfo;
      if(targetInfo)discoveredTargets.push({type:targetInfo.type??"unknown",url:targetInfo.url??""});
    }
    if(msg.method==="Target.attachedToTarget"){
      const {sessionId,targetInfo}=msg.params??{};
      if(sessionId){
        workerTargets.set(sessionId,{type:targetInfo?.type??"unknown",url:targetInfo?.url??""});
        void enableTargetSession(sessionId,targetInfo).catch(error=>{
          workerTargetSetupErrors.push({target:targetInfo?.url??"",type:targetInfo?.type??"unknown",error:String(error)});
        });
      }
    }
    if(msg.method==="Target.detachedFromTarget")workerTargets.delete(msg.params?.sessionId);
    if(msg.method==="Runtime.executionContextCreated"){
      const context=msg.params?.context,frameId=context?.auxData?.frameId;
      if(context?.auxData?.isDefault&&frameId)
        defaultExecutionContexts.set(frameId,context.id);
    }
    if(msg.method==="Runtime.executionContextDestroyed"){
      for(const [frameId,id] of defaultExecutionContexts)
        if(id===msg.params?.executionContextId)defaultExecutionContexts.delete(frameId);
    }
    if(msg.method==="Runtime.executionContextsCleared")defaultExecutionContexts.clear();
    if(msg.method==="Runtime.exceptionThrown"){
      const message=msg.params?.exceptionDetails?.exception?.description||
        msg.params?.exceptionDetails?.text||"Unknown worker exception";
      exceptions.push(message);
      const target=workerTargets.get(msg.sessionId);
      if(target)workerRuntimeErrors.push({kind:"exception",target,message});
    }
    if(msg.method==="Network.requestWillBeSent"&&
       /markdown-language-features.*serverWorkerMain\.js|vscode_markdown_language_features.*serverWorkerMain\.js/i.test(msg.params?.request?.url??""))
      markdownWorkerRequests.push({url:msg.params.request.url,initiator:msg.params.initiator?.type??null,
        sessionId:msg.sessionId??null,target:workerTargets.get(msg.sessionId)??null});
    if(msg.method==="Network.loadingFailed")
      networkFailures.push({requestId:msg.params.requestId,errorText:msg.params.errorText,
        canceled:msg.params.canceled,blockedReason:msg.params.blockedReason});
    if(msg.method==="Network.responseReceived"&&networkResponses.length<80)
      networkResponses.push({url:msg.params.response.url,status:msg.params.response.status,
        type:msg.params.type});
    if(msg.method==="Runtime.consoleAPICalled"&&msg.params?.type==="error"){
      const message=msg.params.args?.map(x=>x.value||x.description).join(" ");
      consoleErrors.push(message);
      const target=workerTargets.get(msg.sessionId);
      if(target)workerRuntimeErrors.push({kind:"console",target,message});
    }
    if(msg.id&&pending.has(msg.id)){
      const call=pending.get(msg.id);pending.delete(msg.id);clearTimeout(call.timer);
      if(msg.error)call.reject(Error(msg.error.message));else call.resolve(msg.result);
    }
  });
  await command("Page.enable");
  await command("Runtime.enable");
  await command("Network.enable");
  // Worker scripts load in separate CDP targets (including nested workers in
  // Theia's hosted extension worker). Attach recursively so the Markdown
  // Language Server request is observed in its own target, not just the page.
  await command("Target.setAutoAttach",{
    autoAttach:true,waitForDebuggerOnStart:false,flatten:true
  });
  // Use a realistic desktop workbench viewport; the default headless size can
  // collapse Theia's editor groups and make native Source interactions invalid.
  await command("Emulation.setDeviceMetricsOverride",{
    width:1440,height:1000,deviceScaleFactor:1,mobile:false
  });
  const navigatedAt=performance.now();
  await command("Page.navigate",{url});
  let view=null;
  for(let i=0;i<250;i++){
    view=await evalJS(`({
      readyState:document.readyState,title:document.title,
      text:document.body?.innerText?.slice(0,950)||"",
      appShell:!!document.querySelector("#theia-app-shell"),
      nativeCodicons:(()=>{
        const icons=[...document.querySelectorAll(".theia-app-sides .codicon")];
        const glyphs=icons.filter(icon=>{
          const style=getComputedStyle(icon,"::before");
          return style.content!=="none"&&style.content!=='""'&&
            style.fontFamily.toLowerCase().includes("codicon");
        }).length;
        return {fontLoaded:document.fonts.check("16px codicon"),
          activityIcons:icons.length,glyphs};
      })(),
      brand:(()=>{
        const brand=document.querySelector('[id="theia:menubar"].lm-MenuBar > .skill-studio-brand');
        const bar=brand?.parentElement;
        const menuContent=bar&&Array.from(bar.children).find(child=>
          child.classList.contains("lm-MenuBar-content")
        );
        const a=brand?.getBoundingClientRect();
        const b=menuContent?.getBoundingClientRect();
        const nativeMenus=menuContent?(menuContent.textContent||"").replace(/\\s+/g," ").trim():"";
        return {
          present:Boolean(brand),
          label:brand?.querySelector(".skill-studio-brand-label")?.textContent.trim()||"",
          stylesheet:Boolean(document.querySelector("#skill-studio-brand-theme")?.sheet),
          beforeNativeMenus:Boolean(brand&&menuContent&&brand.nextElementSibling===menuContent),
          sameRow:Boolean(a&&b)&&Math.abs((a.top+a.bottom)/2-(b.top+b.bottom)/2)<3,
          nativeMenus
        };
      })(),
      widgets:document.querySelectorAll(".lm-Widget").length,
      menus:document.querySelectorAll(".p-MenuBar-item,.lm-MenuBar-item").length,
      editor:document.querySelectorAll(".monaco-editor").length,
      bodyLength:document.body?.innerText?.length||0,
      errors:document.querySelectorAll(".theia-error").length
    })`);
    if(view?.appShell&&view.widgets>4&&view.bodyLength>15&&
       view.brand?.present&&view.brand.nativeMenus.includes("File")&&
       view.brand.nativeMenus.includes("Edit"))break;
    await sleep(150);
  }
  const shellReadyMs=performance.now()-navigatedAt;
  const warningDismissed=await evalJS(`(()=>{
    const candidates=[...document.querySelectorAll('button,[role="button"]')];
    const ok=candidates.find(x=>x.innerText.trim()==="OK");
    if(ok){ok.click();return true;}
    return false;
  })()`);
  await sleep(300);
  const diagnostics=await evalJS(`({
    htmlClass:document.documentElement.className,
    bodyStyle:document.body?.getAttribute('style'),
    bodyDisplay:getComputedStyle(document.body).display,
    bodyVisibility:getComputedStyle(document.body).visibility,
    bodyChildren:[...document.body.children].map(x=>({
      tag:x.tagName,id:x.id,className:String(x.className).slice(0,180),
      text:x.innerText?.slice(0,110)||"",
      display:getComputedStyle(x).display,
      visibility:getComputedStyle(x).visibility
    })).slice(0,14),
    shellHtml:document.querySelector('#theia-app-shell')?.outerHTML.slice(0,2300),
    menuItems:[...document.querySelectorAll('[role="menuitem"]')].slice(0,10).map(x=>x.textContent),
    ariaLabels:[...document.querySelectorAll('[aria-label]')].slice(0,25).map(x=>x.getAttribute('aria-label')),
    title:document.title
  })`);
  // Theia does not render built-in Explorer viewsWelcome without a folder.
  // Inspect the real first-run Webview editor in a live Chromium frame.
  const welcomeTab=await evalJS(`[...document.querySelectorAll('.lm-TabBar-tab')]
    .some(tab=>tab.innerText.includes('SKILL Studio Welcome'))`);
  let welcome=null;
  for(let attempt=0;attempt<50&&!welcome;attempt++){
    const tree=await command('Page.getFrameTree');
    const frames=[];
    const walk=node=>{if(!node)return;frames.push(node.frame);
      for(const child of node.childFrames??[])walk(child);};
    walk(tree.frameTree);
    for(const frame of frames.filter(item=>
      item.url.includes('/webview/index.html')||item.url.includes('.webview.'))){
      try{
        const world=await command('Page.createIsolatedWorld',{
          frameId:frame.id,worldName:'studio-welcome-check',
          grantUniveralAccess:true
        });
        const response=await command('Runtime.evaluate',{
          contextId:world.executionContextId,returnByValue:true,
          expression:`(()=>{
            const actions=[...document.querySelectorAll('[data-action]')]
              .map(el=>({action:el.dataset.action,text:el.innerText}));
            return {title:document.title,actions};
          })()`
        });
        const probe=response.result?.value;
        if(probe?.actions?.some(item=>item.action==='example')){
          welcome={...probe,frameUrl:frame.url};break;
        }
      }catch{/* Webview may be loading; inspect the next frame. */}
    }
    if(!welcome)await sleep(150);
  }
  console.log('STUDIO_FIRST_RUN_WELCOME_CHROMIUM',
    JSON.stringify({tabVisible:welcomeTab,...welcome}));
  const actions=new Set(welcome?.actions?.map(item=>item.action)??[]);
  if(!welcomeTab||!['newProject','openProject','example','spec','guide']
    .every(action=>actions.has(action)))
    throw Error('The first-run welcome editor did not render all project actions: '+
      JSON.stringify({tabVisible:welcomeTab,welcome}));
  // Verify the user-facing Help menu, not only the manifest's command entries.
  const helpPosition=await evalJS(`(()=>{
    const item=[...document.querySelectorAll('.lm-MenuBar-item')].find(x=>x.innerText.trim()==='Help');
    if(!item)return null;
    const r=item.getBoundingClientRect();
    return {x:r.left+r.width/2,y:r.top+r.height/2};
  })()`);
  if(!helpPosition)throw Error('Native Help menu is unavailable');
  await command("Input.dispatchMouseEvent",{type:"mouseMoved",...helpPosition});
  await command("Input.dispatchMouseEvent",{type:"mousePressed",...helpPosition,button:"left",clickCount:1});
  await command("Input.dispatchMouseEvent",{type:"mouseReleased",...helpPosition,button:"left",clickCount:1});
  await sleep(350);
  const helpItems=await evalJS(`[...document.querySelectorAll('.lm-Menu')]
    .filter(x=>getComputedStyle(x).display!=='none')
    .map(x=>x.innerText).join('\\n')`);
  console.log('STUDIO_HELP_MENU_CHROMIUM',JSON.stringify(helpItems));
  if(!helpItems.includes('Skill Language Specification')||
     !helpItems.includes('Authoring Guide'))
    throw Error('Native Help menu is missing the authoritative Skill documentation: '+helpItems);
  await command("Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
  await command("Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
  await command("Input.dispatchMouseEvent",{type:"mousePressed",x:390,y:270,button:"left",clickCount:1});
  await command("Input.dispatchMouseEvent",{type:"mouseReleased",x:390,y:270,button:"left",clickCount:1});
  await command("Input.dispatchKeyEvent",{type:"keyDown",key:"F1",code:"F1",windowsVirtualKeyCode:112});
  await command("Input.dispatchKeyEvent",{type:"keyUp",key:"F1",code:"F1",windowsVirtualKeyCode:112});
  await sleep(350);
  const paletteBefore=await evalJS(`({
    inputs:[...document.querySelectorAll('input')].filter(x=>x.offsetParent!==null).map(x=>({className:x.className,placeholder:x.placeholder,value:x.value})).slice(0,8),
    quickHtml:document.querySelector('.quick-input-widget')?.outerHTML.slice(0,850),
    bodyText:document.body.innerText.slice(-650),
    active:document.activeElement?.outerHTML.slice(0,450)
  })`);
  await command("Input.insertText",{text:"SKILL Studio"});
  await sleep(1000);
  const paletteAfter=await evalJS(`({
    inputs:[...document.querySelectorAll('input')].filter(x=>x.offsetParent!==null).map(x=>({className:x.className,placeholder:x.placeholder,value:x.value})).slice(0,8),
    commands:[...document.querySelectorAll('.monaco-list-row,.quick-input-list .monaco-list-row')].map(x=>x.innerText).filter(Boolean).slice(0,12),
    bodyText:document.body.innerText.slice(-900),
    active:document.activeElement?.outerHTML.slice(0,450)
  })`);
  await command("Page.bringToFront");
  const viewPosition=await evalJS(`(()=>{
    const item=[...document.querySelectorAll('.lm-MenuBar-item')].find(x=>x.innerText.trim()==='View');
    if(!item)return null;
    const r=item.getBoundingClientRect();
    return {x:r.left+r.width/2,y:r.top+r.height/2};
  })()`);
  if(viewPosition){
    await command("Input.dispatchMouseEvent",{type:"mouseMoved",...viewPosition});
    await command("Input.dispatchMouseEvent",{type:"mousePressed",...viewPosition,button:"left",clickCount:1});
    await command("Input.dispatchMouseEvent",{type:"mouseReleased",...viewPosition,button:"left",clickCount:1});
    await sleep(550);
  }
  const viewMenu=await evalJS(`({
    menus:[...document.querySelectorAll('.lm-Menu')].map(x=>({
      visible:getComputedStyle(x).display!=='none',
      text:x.innerText.slice(0,1400)
    })).slice(0,6),
    bodyText:document.body?.innerText.slice(-850),
    focus:document.activeElement?.outerHTML.slice(0,350)
  })`);
  const paletteItemPos=await evalJS(`(()=>{
    const el=[...document.querySelectorAll('.lm-Menu-item')].find(x=>x.innerText.includes('Command Palette'));
    if(!el)return null;const r=el.getBoundingClientRect();
    return {x:r.left+r.width/2,y:r.top+r.height/2};
  })()`);
  if(paletteItemPos){
    await command("Input.dispatchMouseEvent",{type:"mouseMoved",...paletteItemPos});
    await command("Input.dispatchMouseEvent",{type:"mousePressed",...paletteItemPos,button:"left",clickCount:1});
    await command("Input.dispatchMouseEvent",{type:"mouseReleased",...paletteItemPos,button:"left",clickCount:1});
    await sleep(400);
  }
  const paletteMenuOpened=await evalJS(`({
    inputs:[...document.querySelectorAll('input')].filter(x=>x.offsetParent!==null).map(x=>({
      value:x.value,placeholder:x.placeholder,html:x.outerHTML.slice(0,300)
    })).slice(0,10),
    active:document.activeElement?.outerHTML.slice(0,400),
    text:document.body.innerText.slice(-800)
  })`);
  if(paletteMenuOpened.inputs.length){
    await command("Input.insertText",{text:"SKILL Studio"});
    await sleep(850);
  }
  const registeredCommands=await evalJS(`({
    inputs:[...document.querySelectorAll('input')].filter(x=>x.offsetParent!==null).map(x=>x.value),
    items:[...document.querySelectorAll('.monaco-list-row,.quick-input-list .monaco-list-row')].map(x=>x.innerText).filter(Boolean).slice(0,20),
    text:document.body.innerText.slice(-1050)
  })`);
  const loadExampleRow=await evalJS(`(()=>{
    const node=[...document.querySelectorAll('.monaco-list-row')].find(x=>x.innerText.includes('SKILL Studio: Open Example Project'));
    if(!node)return null;const r=node.getBoundingClientRect();
    return {x:r.left+r.width/2,y:r.top+r.height/2,text:node.innerText};
  })()`);
  if(!loadExampleRow)
    throw Error("Theia does not expose the explicit Open Example Project command");
  await command("Input.dispatchMouseEvent",{type:"mouseMoved",x:loadExampleRow.x,y:loadExampleRow.y});
  await command("Input.dispatchMouseEvent",{type:"mousePressed",x:loadExampleRow.x,y:loadExampleRow.y,button:"left",clickCount:1});
  await command("Input.dispatchMouseEvent",{type:"mouseReleased",x:loadExampleRow.x,y:loadExampleRow.y,button:"left",clickCount:1});
  await sleep(350);
  await command("Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
  await command("Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
  // Both hosts must confirm the explicitly opened workspace and 5GC Procedure.
  let exampleLoadReady=false;
  for(let attempt=0;attempt<100;attempt++){
    exampleLoadReady=await evalJS(`[...document.querySelectorAll(
      '.theia-notification-list-item,.theia-notification-message'
    )].some(node=>node.innerText.includes(
      '示例项目已载入并打开工作区：skill-studio-demo/'
    )&&node.innerText.includes('默认已打开传统 5GC Procedure'))`);
    if(exampleLoadReady)break;
    await sleep(150);
  }
  if(!exampleLoadReady){
    const startupDiagnostics=await evalJS(`({
      title:document.title,
      notifications:[...document.querySelectorAll(
        '.theia-notification-list-item,.theia-notification-message'
      )].map(node=>node.innerText).filter(Boolean).slice(0,12),
      explorer:document.querySelector('.theia-Files')?.innerText??'',
      body:document.body.innerText.slice(-1600)
    })`);
    throw Error("The explicit example import did not open its project and 5GC Procedure: "+
      JSON.stringify(startupDiagnostics).slice(0,3200));
  }
  const afterImport=await evalJS(`(async()=>{
    const names=[];let opfsError=null;
    try{
      const dir=await navigator.storage.getDirectory();
      for await(const [name,handle] of dir.entries())
        names.push({name,kind:handle.kind});
    }catch(error){opfsError=String(error);}
    return {
      folders:names,opfsError,
      statusBar:(()=>{
        const element=document.querySelector("#theia-statusBar");
        if(!element)return null;
        const style=getComputedStyle(element);
        return {background:style.backgroundColor,foreground:style.color,
          noWorkspace:document.body.classList.contains("theia-no-open-workspace")};
      })(),
      bodyText:document.body.innerText.slice(-2200),
      explorerText:document.querySelector('.theia-Files')?.innerText??'',
      noFolderPrompt:(document.querySelector('.theia-Files')?.innerText??'')
        .includes('You have not yet opened a folder.')||
        (document.querySelector('.theia-Files')?.innerText??'')
        .includes('You have not yet added a folder to the workspace.'),
      workspaceRootVisible:(document.querySelector('.theia-Files')?.innerText??'')
        .includes('skill-studio-demo'),
      notificationText:[...document.querySelectorAll('.theia-notification-list-item,.theia-notification-message')]
        .map(x=>x.innerText).filter(Boolean).slice(0,7),
      visibleEditors:document.querySelectorAll('.monaco-editor').length,
      iframeSrcs:[...document.querySelectorAll('iframe')].map(x=>x.getAttribute('src')).slice(0,7),
      explorerItems:[...document.querySelectorAll('.theia-TreeNode,.theia-FileTreeNode')]
        .map(x=>x.innerText).filter(Boolean).slice(0,14)
    };
  })()`);
  await sleep(1200);
  const frameTree=await command("Page.getFrameTree");
  const frames=[];
  const walkFrames=node=>{
    if(!node)return;
    frames.push(node.frame);
    for(const child of node.childFrames??[])walkFrames(child);
  };
  walkFrames(frameTree.frameTree);
  const webviewFrames=[];
  for(const frame of frames.filter(item=>item.url.includes("/webview/index.html")||
      item.url.includes(".webview."))){
    try{
      const world=await command("Page.createIsolatedWorld",{
        frameId:frame.id,worldName:"skill-studio-acceptance",grantUniveralAccess:true
      });
      const evaluated=await command("Runtime.evaluate",{
        contextId:world.executionContextId,returnByValue:true,awaitPromise:true,
        expression:`({
          readyState:document.readyState,title:document.title,
          bodyText:document.body?.innerText?.slice(0,1200)||"",
          timing:document.querySelector("#reactFlowRoot")?.dataset.studioTiming,
          procedureRoot:!!document.querySelector("#reactFlowRoot"),
          graphNodes:document.querySelectorAll(".react-flow__node").length,
          graphEdges:document.querySelectorAll(".react-flow__edge").length,
          procedureValue:document.querySelector("#procedureList")?.value||"",
          routeOptions:document.querySelector("#routeList")?.options?.length||0,
          message:document.querySelector("#message")?.textContent||"",
          patchVisible:!document.querySelector("#patch")?.hidden,
          html:document.documentElement?.outerHTML?.slice(0,5000)||"",
          nestedFrames:[...document.querySelectorAll("iframe")].map(child=>({
            src:child.getAttribute("src"),title:child.title,html:child.outerHTML.slice(0,500)
          }))
        })`
      });
      webviewFrames.push({frame,view:evaluated.result?.value??null});
    }catch(error){
      webviewFrames.push({frame,error:String(error)});
    }
  }
  console.log("STUDIO_THEIA_STAGE","initial-graph");
  const graphFrame=webviewFrames.find(item=>item.view?.procedureRoot&&item.view.graphNodes>0);
  const webviewFrame=graphFrame?.frame??webviewFrames[0]?.frame??null;
  let webviewView=graphFrame?.view??webviewFrames[0]?.view??null;
  const webviewFrameError=webviewFrames.find(item=>item.error)?.error??null;
  let patchEvidence=null;
  let canvasIconEvidence=null;
  if(graphFrame){
    await assertSourceVisualPair(evalJS,sleep,'procedure.yaml','Initial Procedure Designer');
    const world=await command("Page.createIsolatedWorld",{
      frameId:graphFrame.frame.id,worldName:"skill-studio-patch-acceptance",grantUniveralAccess:true
    });
    const iconResult=await command("Runtime.evaluate",{
      contextId:world.executionContextId,returnByValue:true,
      expression:`[...document.querySelectorAll("#graphTools svg[data-icon]")].map(el=>{
        const r=el.getBoundingClientRect();
        return {name:el.getAttribute("data-icon"),visible:r.width>0&&r.height>0,
          color:getComputedStyle(el).color};
      })`
    });
    canvasIconEvidence=iconResult.result?.value??[];
    const expectedIcons=["columns-2","git-branch","network","eye","locate-fixed",
      "zoom-out","zoom-in","maximize","fit-width","fit-height"];
    if(expectedIcons.some(name=>!canvasIconEvidence.some(item=>
      item.name===name&&item.visible)))
      throw Error("Studio canvas icon artwork missing from native toolbar: "+
        JSON.stringify({expectedIcons,canvasIconEvidence}));
    console.log("STUDIO_CANVAS_ICONS_CHROMIUM",JSON.stringify(canvasIconEvidence));
    const preview=await command("Runtime.evaluate",{
      contextId:world.executionContextId,returnByValue:true,awaitPromise:true,
      expression:`(()=>{
        const routes=document.querySelector("#routeList");
        const targets=document.querySelector("#targetList");
        if(!routes||!targets||routes.options.length<2)
          return {ready:false,reason:"No source-qualified Route choices",routeOptions:routes?.options.length??0};
        // Index 0 is the explicit "choose a Route" placeholder.
        routes.selectedIndex=1;
        routes.dispatchEvent(new Event("change",{bubbles:true}));
        if(targets.options.length<1)
          return {ready:false,reason:"No qualified target choices",routeOptions:routes.options.length};
        targets.selectedIndex=0;
        targets.dispatchEvent(new Event("change",{bubbles:true}));
        document.querySelector("#preview")?.click();
        return {
          ready:!document.querySelector("#commit")?.disabled,
          routeOptions:routes.options.length,targetOptions:targets.options.length,
          route:routes.value,target:targets.value,
          diff:document.querySelector("#diff")?.textContent||"",
          revision:document.querySelector("#revision")?.textContent||""
        };
      })()`
    });
    const previewEvidence=preview.result?.value??null;
    if(previewEvidence?.ready){
      await command("Runtime.evaluate",{
        contextId:world.executionContextId,returnByValue:true,awaitPromise:true,
        expression:`document.querySelector("#commit")?.click(); true`
      });
      await sleep(2200);
      const applied=await command("Runtime.evaluate",{
        contextId:world.executionContextId,returnByValue:true,awaitPromise:true,
        expression:`({
          revision:document.querySelector("#revision")?.textContent||"",
          message:document.querySelector("#message")?.textContent||"",
          procedureValue:document.querySelector("#procedureList")?.value||"",
          graphNodes:document.querySelectorAll(".react-flow__node").length,
          graphEdges:document.querySelectorAll(".react-flow__edge").length
        })`
      });
      patchEvidence={preview:previewEvidence,applied:applied.result?.value??null};
      webviewView={...webviewView,...(applied.result?.value??{})};
      // Verify the host's native Source editor can open and own undo after
      // the webview-originated WorkspaceEdit. The sample workspace is isolated.
      await command("Runtime.evaluate",{
        contextId:world.executionContextId,returnByValue:true,awaitPromise:true,
        expression:`document.querySelector("#openSource")?.click(); true`
      });
      await sleep(1200);
      const sourceEditor=await evalJS(`({
        monacoEditors:document.querySelectorAll(".monaco-editor").length,
        bodyText:document.body.innerText.slice(-900),
        editorTabs:[...document.querySelectorAll(".theia-tab,.lm-TabBar-tab")].map(x=>x.innerText).filter(Boolean).slice(-8)
      })`);
      // Real native YAML tokenization must not depend on deferred LSP features.
      let yamlSyntax=null;
      for(let attempt=0;attempt<35;attempt++){
        yamlSyntax=await evalJS(`(()=>{
          const editor=[...document.querySelectorAll('.monaco-editor')]
            .find(el=>el.getBoundingClientRect().width>150&&
              el.querySelector('.view-lines'));
          const spans=[...(editor?.querySelectorAll('.view-lines span')??[])];
          const tokenColors=[...new Set(spans.map(el=>getComputedStyle(el).color))];
          const items=[...document.querySelectorAll('.theia-status-bar-item')]
            .map(el=>el.textContent?.trim()).filter(Boolean);
          return {items,tokenCount:spans.length,tokenColors,visible:!!editor};
        })()`);
        if(yamlSyntax?.tokenCount>=50&&yamlSyntax?.tokenColors?.length>=2)break;
        await sleep(120);
      }
      console.log("STUDIO_NATIVE_YAML_SYNTAX_CHROMIUM",JSON.stringify(yamlSyntax));
      // Theia 1.76 uses a non-VS-Code status-bar DOM, so text-based
      // '.theia-status-bar-item' selectors are not authoritative here.
      // Require native Monaco to display multiple actual syntax token colors.
      if(!(yamlSyntax?.tokenCount>=50&&yamlSyntax?.tokenColors?.length>=2))
        throw Error("Native YAML syntax tokenization not active: "+JSON.stringify(yamlSyntax));
      patchEvidence.yamlSyntax=yamlSyntax;

      // The native VS Code/Theia editor must render the same CA semantic
      // identities from the shared source classifier. Theia 1.76 receives the
      // LSP SemanticTokens, then the extension-host adapter projects those
      // exact ranges through TextEditor decorations using the shared theme.
      // TextMate colors or provider registration alone do not satisfy this check.
      let semanticRendering=null,semanticProviderDiagnostics=null;
      // Package attachment and initial Worker analysis are asynchronous in the
      // browser-only shell. Wait for the actual semantic-token request/render,
      // not merely for SKILL LSP: READY or a fixed short delay.
      for(let attempt=0;attempt<120;attempt++){
        semanticRendering=await evalJS(`(()=> {
          const editor=[...document.querySelectorAll('.monaco-editor')]
            .find(el=>el.getBoundingClientRect().width>150&&el.querySelector('.view-lines'));
          const lines=[...(editor?.querySelectorAll('.view-line')??[])];
          const line=lines.find(el=>el.textContent.replace(/\\u00a0/g,' ')
            .includes('createdsession.ingress.eligible: PASS'));
          const token=value=>[...(line?.querySelectorAll('span')??[])]
            .find(el=>el.textContent===value);
          const reference=token('createdsession.ingress.eligible');
          const outcome=token('PASS');
          return {
            referenceColor:reference?getComputedStyle(reference).color:null,
            outcomeColor:outcome?getComputedStyle(outcome).color:null,
            referenceClass:reference?.className??null,
            outcomeClass:outcome?.className??null,
            line:line?.textContent??null,
            lineHtml:line?.innerHTML??null,
            visible:!!editor
          };
        })()`);
        semanticProviderDiagnostics=await evalJS(`(async()=>{
          const c=window.theia.container;
          const key=[...c._bindingDictionary._map.keys()].find(k=>
            typeof k==='function'&&k.prototype?.executeCommand&&
            k.prototype?.registerCommand&&k.prototype?.getCommand);
          if(!key)throw Error('Native command registry missing');
          return c.get(key).executeCommand('skillStudio.internal.semanticTokenDiagnostics');
        })()`);
        if(semanticProviderDiagnostics?.lastTokenCount>0&&
           semanticProviderDiagnostics?.renderedTokenCount>0&&
           semanticProviderDiagnostics?.renderedTypeCount>=2&&
           semanticRendering?.referenceColor==='rgb(49, 125, 192)'&&
           semanticRendering?.outcomeColor==='rgb(173, 101, 23)')break;
        await sleep(150);
      }
      semanticRendering.diagnostics=semanticProviderDiagnostics;
      console.log("STUDIO_NATIVE_SEMANTIC_COLORS_CHROMIUM",
        JSON.stringify(semanticRendering));
      if(semanticProviderDiagnostics?.registered!==true||
         !(semanticProviderDiagnostics?.requests>0)||
         !(semanticProviderDiagnostics?.lastTokenCount>0)||
         semanticProviderDiagnostics?.renderer!=="theia-text-editor-decoration"||
         !(semanticProviderDiagnostics?.renderedTokenCount>0)||
         !(semanticProviderDiagnostics?.renderedTypeCount>=2)||
         semanticProviderDiagnostics?.renderError||
         ![true,"configuredByTheme"].includes(
           semanticProviderDiagnostics?.semanticHighlightingEnabled)||
         semanticRendering?.referenceColor!=='rgb(49, 125, 192)'||
         semanticRendering?.outcomeColor!=='rgb(173, 101, 23)')
        throw Error("Native semantic tokens were not registered, requested and rendered by Studio Light: "+
          JSON.stringify(semanticRendering));
      patchEvidence.lspSemanticColors=semanticRendering;
      // The initial Package analysis must be owned by Package discovery, not
      // by a user's first edit or by opening a Procedure Designer. Browser-only
      // Pages uses the Worker Language Client; backend-backed Theia's Node host
      // deliberately has no browser Worker and keeps its native editor path.
      let initialPackageAnalysis=null;
      for(let attempt=0;attempt<120;attempt++){
        initialPackageAnalysis=await evalJS(`(async()=>{
          const c=window.theia.container;
          const key=[...c._bindingDictionary._map.keys()].find(k=>
            typeof k==='function'&&k.prototype?.executeCommand&&
            k.prototype?.registerCommand&&k.prototype?.getCommand);
          return c.get(key).executeCommand('skillStudio.internal.semanticTokenDiagnostics');
        })()`);
        const packageStates=initialPackageAnalysis?.packageStatuses??[];
        if(initialPackageAnalysis?.languageClientStarted&&
           initialPackageAnalysis?.packageLifecycle?.attached?.length>0&&
           packageStates.some(item=>item.state==='READY'||item.state==='PARTIAL'))break;
        if(initialPackageAnalysis?.lastPackageAttachReason===
           'browser Worker or location is unavailable')break;
        await sleep(100);
      }
      const initialPackageStates=initialPackageAnalysis?.packageStatuses??[];
      const browserWorkerLspExpected=initialPackageAnalysis?.lastPackageAttachReason!==
        'browser Worker or location is unavailable';
      if(browserWorkerLspExpected&&
         (!(initialPackageAnalysis?.languageClientStarted)||
          !(initialPackageAnalysis?.packageLifecycle?.attached?.length>0)||
          !initialPackageStates.some(item=>item.state==='READY'||item.state==='PARTIAL')))
        throw Error("Package discovery did not complete initial LSP analysis without file edits: "+
          JSON.stringify(initialPackageAnalysis));
      if(browserWorkerLspExpected){
        console.log("STUDIO_PACKAGE_INITIAL_LSP_ANALYSIS_CHROMIUM",JSON.stringify({
          lifecycle:initialPackageAnalysis.packageLifecycle,
          statuses:initialPackageStates.map(item=>({rootUri:item.rootUri,state:item.state,
            generation:item.generation,diagnostics:item.publishedDiagnosticCount??null}))
        }));
        patchEvidence.initialPackageLspAnalysis={
          lifecycle:initialPackageAnalysis.packageLifecycle,
          statuses:initialPackageStates
        };
      }else{
        console.log("STUDIO_PACKAGE_LSP_NODE_HOST_SCOPE",JSON.stringify({
          reason:initialPackageAnalysis.lastPackageAttachReason,
          note:"Browser Worker LSP acceptance is covered by the browser-only Pages host"
        }));
      }

      // This probe opens a pinned owner script in the native workbench.
      // Open a real bundled Python source through Theia's native Quick Open.
      // This verifies the Python TextMate grammar in the same editor host.
      const yamlEditorRect=await evalJS(`(()=>{
        const el=[...document.querySelectorAll('.monaco-editor')]
          .find(x=>x.getBoundingClientRect().width>150&&x.querySelector('.view-lines'));
        const r=el?.getBoundingClientRect();
        return r?{x:r.x+Math.min(120,r.width/2),y:r.y+Math.min(60,r.height/2)}:null;
      })()`);
      if(!yamlEditorRect)throw Error("Native YAML editor is not visible before Python syntax probe");
      await command("Input.dispatchMouseEvent",{type:"mousePressed",x:yamlEditorRect.x,y:yamlEditorRect.y,button:"left",clickCount:1});
      await command("Input.dispatchMouseEvent",{type:"mouseReleased",x:yamlEditorRect.x,y:yamlEditorRect.y,button:"left",clickCount:1});
      await command("Input.dispatchKeyEvent",{type:"keyDown",key:"p",code:"KeyP",modifiers:2,windowsVirtualKeyCode:80,nativeVirtualKeyCode:80});
      await command("Input.dispatchKeyEvent",{type:"keyUp",key:"p",code:"KeyP",modifiers:2,windowsVirtualKeyCode:80,nativeVirtualKeyCode:80});
      let quickOpen=null;
      for(let attempt=0;attempt<30;attempt++){
        quickOpen=await evalJS(`(()=>{
          const inputs=[...document.querySelectorAll('input')].filter(el=>{
            const r=el.getBoundingClientRect();return r.width>0&&r.height>0;
          });
          const input=inputs.find(el=>el.closest('.quick-input-widget,.monaco-quick-open-widget,.theia-quick-view'))||
            inputs.find(el=>/quick|file|search/i.test(el.getAttribute('aria-label')||el.placeholder||''));
          return input?{tag:input.tagName,placeholder:input.placeholder||'',
            aria:input.getAttribute('aria-label')||'',value:input.value||''}:null;
        })()`);
        if(quickOpen)break;
        await sleep(100);
      }
      if(!quickOpen)throw Error("Native Quick Open did not appear for Python syntax probe");
      await command("Input.insertText",{text:"evaluate_transfer_start.py"});
      await sleep(600);
      const quickResults=await evalJS(`document.body.innerText.slice(-1200)`);
      if(!quickResults.includes("evaluate_transfer_start.py"))
        throw Error("Native Quick Open did not find the bundled Python script: "+quickResults);
      await command("Input.dispatchKeyEvent",{type:"keyDown",key:"Enter",code:"Enter",windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
      await command("Input.dispatchKeyEvent",{type:"keyUp",key:"Enter",code:"Enter",windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
      await sleep(900);
      const pythonSyntax=await evalJS(`(()=>{
        const editors=[...document.querySelectorAll('.monaco-editor')]
          .filter(el=>el.getBoundingClientRect().width>150&&el.querySelector('.view-lines'));
        const editor=editors.find(el=>el.contains(document.activeElement))||editors.at(-1);
        const spans=[...(editor?.querySelectorAll('.view-lines span')??[])];
        return {visibleEditors:editors.length,active:Boolean(editor?.contains(document.activeElement)),
          tokenCount:spans.length,tokenColors:[...new Set(spans.map(el=>getComputedStyle(el).color))],
          text:editor?.querySelector('.view-lines')?.innerText?.slice(0,500)||'',
          bodyTail:document.body.innerText.slice(-350)};
      })()`);
      console.log("STUDIO_NATIVE_PYTHON_SYNTAX_CHROMIUM",JSON.stringify(pythonSyntax));
      if(!(pythonSyntax?.tokenColors?.length>=3)||
         !pythonSyntax.text.replace(/\u00a0/g," ").includes("def main"))
        throw Error("Native Python syntax tokenization not active: "+JSON.stringify(pythonSyntax));
      patchEvidence.pythonSyntax=pythonSyntax;
      // Exercise the exact multi-Designer -> Python -> ordinary YAML -> another
      // Designer sequence in the real Theia extension host, not a mocked API.
      const editorGroupPlacement=await evalJS(`(async()=>{
        const c=window.theia.container;
        const key=[...c._bindingDictionary._map.keys()].find(k=>
          typeof k==='function'&&k.prototype?.executeCommand&&
          k.prototype?.registerCommand&&k.prototype?.getCommand);
        if(!key)throw Error('Native command registry missing for editor-group acceptance');
        return c.get(key).executeCommand('skillStudio.internal.editorGroupAcceptance');
      })()`);
      console.log("STUDIO_EDITOR_GROUP_PLACEMENT_CHROMIUM",JSON.stringify(editorGroupPlacement));
      if(!(editorGroupPlacement?.openedVisualCount>=3)||
         !(editorGroupPlacement?.groupCount>=1)||editorGroupPlacement?.groupCount>2||
         editorGroupPlacement?.maxViewColumn>2||
         editorGroupPlacement?.pythonColumn!==1||
         editorGroupPlacement?.ordinaryYamlColumn!==1)
        throw Error("Theia editor groups did not remain a stable two-column layout: "+
          JSON.stringify(editorGroupPlacement));
      patchEvidence.editorGroupPlacement=editorGroupPlacement;
      // Return to the authoritative Procedure Source editor before testing Undo.
      await command("Runtime.evaluate",{
        contextId:world.executionContextId,returnByValue:true,awaitPromise:true,
        expression:`document.querySelector("#openSource")?.click();true`
      });
      await sleep(700);
      await command("Input.dispatchKeyEvent",{
        type:"keyDown",key:"z",code:"KeyZ",modifiers:2,windowsVirtualKeyCode:90,nativeVirtualKeyCode:90
      });
      await command("Input.dispatchKeyEvent",{
        type:"keyUp",key:"z",code:"KeyZ",modifiers:2,windowsVirtualKeyCode:90,nativeVirtualKeyCode:90
      });
      await sleep(2600);
      const afterUndoTree=await command("Page.getFrameTree");
      const undoFrames=[];
      frames.length=0;
      walkFrames(afterUndoTree.frameTree);
      for(const frame of frames.filter(item=>item.url.includes("/webview/index.html")||
          item.url.includes(".webview."))){
        try{
          const undoWorld=await command("Page.createIsolatedWorld",{
            frameId:frame.id,worldName:"skill-studio-undo-acceptance",grantUniveralAccess:true
          });
          const undone=await command("Runtime.evaluate",{
            contextId:undoWorld.executionContextId,returnByValue:true,awaitPromise:true,
            expression:`({
              revision:document.querySelector("#revision")?.textContent||"",
              graphNodes:document.querySelectorAll(".react-flow__node").length,
              graphEdges:document.querySelectorAll(".react-flow__edge").length,
              procedureRoot:!!document.querySelector("#reactFlowRoot")
            })`
          });
          if(undone.result?.value?.procedureRoot)undoFrames.push(undone.result.value);
        }catch{}
      }
      console.log("STUDIO_THEIA_STAGE","native-source-undo");
      patchEvidence.sourceEditor=sourceEditor;
      patchEvidence.undo=undoFrames[0]??null;

      // Check real Webview toolbar interaction before later Node/Route gestures.
      // The original root is focused by default, but all routes remain selectable
      // for the existing route editor fixture after explicitly choosing All.
      const toolbarBefore=await command("Runtime.evaluate",{
        contextId:world.executionContextId,returnByValue:true,awaitPromise:true,
        expression:`({
          layout:document.querySelector("#layoutDirection")?.value,
          rootMode:document.querySelector("#rootPathMode")?.value,
          rootVisible:!document.querySelector("#rootPathToolbar")?.hidden,
          toolbarVisible:!document.querySelector("#graphTools")?.hidden,
          nodes:document.querySelectorAll("#reactFlowRoot .react-flow__node").length
        })`
      });
      const initialToolbar=toolbarBefore.result?.value??null;
      if(initialToolbar?.layout!=="DOWN"||initialToolbar?.rootMode!=="normal"||
         !initialToolbar.rootVisible||!initialToolbar.toolbarVisible)
        throw Error("Missing/default-incorrect Theia toolbar: "+JSON.stringify(initialToolbar));
      await command("Runtime.evaluate",{
        contextId:world.executionContextId,returnByValue:true,awaitPromise:true,
        expression:`(()=>{const select=document.querySelector("#layoutDirection");
          select.value="RIGHT";select.dispatchEvent(new Event("change",{bubbles:true}));return true;})()`
      });
      await sleep(1000);
      const horizontal=await command("Runtime.evaluate",{
        contextId:world.executionContextId,returnByValue:true,
        expression:`({
          layout:document.querySelector("#layoutDirection")?.value,
          horizontal:document.querySelectorAll("#reactFlowRoot .designer-node.is-horizontal").length,
          nodes:document.querySelectorAll("#reactFlowRoot .react-flow__node").length
        })`
      });
      if(horizontal.result?.value?.layout!=="RIGHT"||!(horizontal.result.value.horizontal>0))
        throw Error("Theia toolbar failed to relayout RIGHT: "+JSON.stringify(horizontal.result?.value));
      await command("Runtime.evaluate",{
        contextId:world.executionContextId,returnByValue:true,awaitPromise:true,
        expression:`(()=>{const select=document.querySelector("#layoutDirection");
          select.value="DOWN";select.dispatchEvent(new Event("change",{bubbles:true}));
          document.querySelector("#fitWidth").click();
          document.querySelector("#fitHeight").click();
          document.querySelector("#fit").click();
          document.querySelector("#zoomIn").click();
          document.querySelector("#zoomOut").click();
          return true;})()`
      });
      await sleep(1000);
      const vertical=await command("Runtime.evaluate",{
        contextId:world.executionContextId,returnByValue:true,
        expression:`({
          layout:document.querySelector("#layoutDirection")?.value,
          horizontal:document.querySelectorAll("#reactFlowRoot .designer-node.is-horizontal").length,
          nodes:document.querySelectorAll("#reactFlowRoot .react-flow__node").length
        })`
      });
      if(vertical.result?.value?.layout!=="DOWN"||vertical.result.value.horizontal!==0||
        !(vertical.result.value.nodes>0))
        throw Error("Theia toolbar failed to restore DOWN: "+JSON.stringify(vertical.result?.value));
      await command("Runtime.evaluate",{
        contextId:world.executionContextId,returnByValue:true,awaitPromise:true,
        expression:`(()=>{const select=document.querySelector("#rootPathMode");
          select.value="all";select.dispatchEvent(new Event("change",{bubbles:true}));return true;})()`
      });
      await sleep(1000);
      const fullPaths=await command("Runtime.evaluate",{
        contextId:world.executionContextId,returnByValue:true,
        expression:`({
          rootMode:document.querySelector("#rootPathMode")?.value,
          nodes:document.querySelectorAll("#reactFlowRoot .react-flow__node").length,
          edges:document.querySelectorAll("#reactFlowRoot .react-flow__edge").length,
          branchControls:document.querySelectorAll("#reactFlowRoot .designer-hidden-branches").length
        })`
      });
      if(fullPaths.result?.value?.rootMode!=="all"||
         !(fullPaths.result.value.nodes>=initialToolbar.nodes))
        throw Error("Theia Root path filter did not restore full graph: "+
          JSON.stringify({initialToolbar,fullPaths:fullPaths.result?.value}));
      patchEvidence.canvasToolbar={initial:initialToolbar,horizontal:horizontal.result?.value,
        vertical:vertical.result?.value,allPaths:fullPaths.result?.value};
      console.log("STUDIO_CANVAS_TOOLBAR_CHROMIUM",JSON.stringify(patchEvidence.canvasToolbar));

      // The shared one-hop Node view is reused inside the host CustomEditor:
      // real neighbor Nodes/Routes plus read-only PRE/OP/POST stages.
      console.log("STUDIO_THEIA_STAGE","node-focus");
      const focusWorld=await command("Page.createIsolatedWorld",{
        frameId:graphFrame.frame.id,worldName:"skill-studio-node-focus-acceptance",grantUniveralAccess:true
      });
      const focusOpen=await command("Runtime.evaluate",{
        contextId:focusWorld.executionContextId,returnByValue:true,awaitPromise:true,
        expression:`(()=> {
          const node=document.querySelector('#reactFlowRoot .react-flow__node[data-id="nudm-sdm-subscribe"]');
          const button=node?.querySelector(".designer-view-node");
          if(!button)return {clicked:false,reason:"Node View action missing"};
          button.click();
          return {clicked:true,nodeId:node.getAttribute("data-id")};
        })()`
      });
      await sleep(1800);
      const focusView=await command("Runtime.evaluate",{
        contextId:focusWorld.executionContextId,returnByValue:true,awaitPromise:true,
        expression:`({
          visible:!document.querySelector("#nodeFocus")?.hidden,
          title:document.querySelector("#nodeFocusTitle")?.textContent||"",
          stats:document.querySelector("#nodeFocusStats")?.textContent||"",
          preSteps:document.querySelectorAll("#nodeFocusFlow .stage-preconditions .focus-graph-step").length,
          postSteps:document.querySelectorAll("#nodeFocusFlow .stage-postconditions .focus-graph-step").length,
          neighbors:document.querySelectorAll("#nodeFocusFlow .is-neighbor").length,
          graphNodes:document.querySelectorAll("#nodeFocusFlow .react-flow__node").length,
          graphEdges:document.querySelectorAll("#nodeFocusFlow .react-flow__edge").length
        })`
      });
      const sourceJump=await command("Runtime.evaluate",{
        contextId:focusWorld.executionContextId,returnByValue:true,awaitPromise:true,
        expression:`(()=> {
          const button=document.querySelector("#nodeFocusFlow .focus-graph-source");
          if(!button)return {ready:false,reason:"Source line action missing"};
          const line=button.textContent.trim();
          button.click();
          return {ready:true,line};
        })()`
      });
      await sleep(900);
      const sourceJumpView=await evalJS(`({
        monacoEditors:document.querySelectorAll(".monaco-editor").length,
        activeElement:document.activeElement?.className||"",
        bodyText:document.body.innerText.slice(-650)
      })`);
      await command("Runtime.evaluate",{
        contextId:focusWorld.executionContextId,returnByValue:true,awaitPromise:true,
        expression:`document.querySelector("#nodeFocusReturn")?.click(); true`
      });
      await sleep(300);
      const focusReturn=await command("Runtime.evaluate",{
        contextId:focusWorld.executionContextId,returnByValue:true,awaitPromise:true,
        expression:`({
          returned:Boolean(document.querySelector("#nodeFocus")?.hidden),
          mainGraphVisible:!document.querySelector("#reactFlowRoot")?.hidden
        })`
      });
      patchEvidence.nodeFocus={
        open:focusOpen.result?.value??null,
        view:focusView.result?.value??null,
        sourceJump:sourceJump.result?.value??null,
        sourceJumpView,
        returned:focusReturn.result?.value??null
      };

      const routeOriginalMode=await command("Runtime.evaluate",{
        contextId:focusWorld.executionContextId,returnByValue:true,awaitPromise:true,
        expression:`(()=> {
          const select=document.querySelector("#procedureList");
          if(!select)return {ready:false,reason:"Procedure selector missing"};
          select.value="await-initial-n4-session-establishment";
          select.dispatchEvent(new Event("change",{bubbles:true}));
          return {ready:true,value:select.value};
        })()`
      });
      await sleep(1500);
      const routeOriginalView=await command("Runtime.evaluate",{
        contextId:focusWorld.executionContextId,returnByValue:true,awaitPromise:true,
        expression:`({
          revision:document.querySelector("#revision")?.textContent||"",
          procedure:document.querySelector("#procedureList")?.value||"",
          graphNodes:document.querySelectorAll("#reactFlowRoot .react-flow__node").length,
          graphEdges:document.querySelectorAll("#reactFlowRoot .react-flow__edge").length
        })`
      });
      if(!routeOriginalMode.result?.value?.ready||
         routeOriginalView.result?.value?.procedure!=="await-initial-n4-session-establishment"||
         !(routeOriginalView.result?.value?.graphEdges>0))
        throw Error("The original Route fixture Procedure did not render: "+
          JSON.stringify({mode:routeOriginalMode.result?.value,view:routeOriginalView.result?.value}));
      // Prepare a real browser fixture through the native Theia text editor.
      // Monaco's AMD module is not exposed as window.monaco in Theia, so this
      // deliberately uses the public editor UI and keyboard instead of
      // reaching into private editor models.
      await command("Runtime.evaluate",{
        contextId:focusWorld.executionContextId,returnByValue:true,awaitPromise:true,
        expression:`document.querySelector("#openSource")?.click(); true`
      });
      await sleep(700);
      const editorTarget=await evalJS(`(()=> {
        const editors=[...document.querySelectorAll(".monaco-editor")];
        const candidates=editors.map((editor,index)=>{
          const root=editor.getBoundingClientRect();
          // Monaco's view-lines rectangle spans the whole document. The
          // scrollable element is the actual clipped editor viewport.
          const viewport=editor.querySelector(".monaco-scrollable-element")??editor;
          const rect=viewport.getBoundingClientRect();
          const lines=editor.querySelector(".view-lines");
          const text=(lines?.innerText??"").replace(/\u00a0/g," ");
          const visible=rect.width>30&&rect.height>100&&
            rect.bottom>0&&rect.top<window.innerHeight&&
            rect.right>0&&rect.left<window.innerWidth;
          // The active Source editor initially shows the first Procedure;
          // Go to Line below moves it to the isolated N4 fixture.
          const hasFixture=text.includes("FAILED: failed")&&
            text.includes("DENIED: failed");
          return {index,visible,hasFixture,
            rect:{x:rect.left,y:rect.top,width:rect.width,height:rect.height},
            rootRect:{x:root.left,y:root.top,width:root.width,height:root.height},
            text:text.slice(0,700)};
        });
        const chosen=candidates.find(item=>item.visible&&item.hasFixture);
        return {ready:Boolean(chosen),editorCount:editors.length,chosen,candidates,
          viewport:{width:window.innerWidth,height:window.innerHeight}};
      })()`);
      if(!editorTarget?.ready)
        throw Error("Native Theia Source editor viewport not found: "+JSON.stringify({editorTarget,consoleErrors,exceptions,body:await evalJS(`document.body.innerText`)}));
      const key=async(key,code,modifiers=0,virtualKeyCode)=>{
        await command("Input.dispatchKeyEvent",{
          type:"keyDown",key,code,modifiers,
          windowsVirtualKeyCode:virtualKeyCode,nativeVirtualKeyCode:virtualKeyCode
        });
        await command("Input.dispatchKeyEvent",{
          type:"keyUp",key,code,modifiers,
          windowsVirtualKeyCode:virtualKeyCode,nativeVirtualKeyCode:virtualKeyCode
        });
      };
      const focusTarget=await evalJS(`(()=>{
        const editor=document.querySelectorAll(".monaco-editor")[${editorTarget.chosen.index}];
        const viewport=editor?.querySelector(".monaco-scrollable-element")??editor;
        const r=viewport?.getBoundingClientRect();
        if(!editor||!r)return {found:false};
        const xs=[r.x+Math.min(90,r.width/3),r.x+r.width/2,
          r.right-Math.min(90,r.width/3)];
        const ys=[r.y+Math.min(24,r.height/3),r.y+r.height/2,
          r.bottom-Math.min(24,r.height/3)];
        const candidates=ys.flatMap(y=>xs.map(x=>({x,y})));
        const hit=candidates.find(({x,y})=>x>0&&y>0&&x<innerWidth&&y<innerHeight&&
          document.elementFromPoint(x,y)?.closest(".monaco-editor")===editor);
        return {found:!!hit,point:hit??null,editorCount:document.querySelectorAll(".monaco-editor").length,
          viewport:{x:r.x,y:r.y,width:r.width,height:r.height}};
      })()`);
      if(!focusTarget?.found)
        throw Error("Visible Procedure Source is not hit-testable: "+
          JSON.stringify({editorTarget,focusTarget}));
      await command("Input.dispatchMouseEvent",{
        type:"mouseMoved",x:focusTarget.point.x,y:focusTarget.point.y
      });
      await command("Input.dispatchMouseEvent",{
        type:"mousePressed",x:focusTarget.point.x,y:focusTarget.point.y,button:"left",clickCount:1
      });
      await command("Input.dispatchMouseEvent",{
        type:"mouseReleased",x:focusTarget.point.x,y:focusTarget.point.y,button:"left",clickCount:1
      });
      const focusedSource=await evalJS(`(()=>{
        const current=document.activeElement?.closest(".monaco-editor");
        const editors=[...document.querySelectorAll(".monaco-editor")];
        return {focusedIndex:editors.indexOf(current),
          activeClass:document.activeElement?.className??null,
          activeTag:document.activeElement?.tagName??null,
          activeEditorCount:editors.length};
      })()`);
      console.log("STUDIO_GOTO_SOURCE_FOCUS",JSON.stringify({
        expectedIndex:editorTarget.chosen.index,focusTarget,focusedSource
      }));
      if(focusedSource?.focusedIndex!==editorTarget.chosen.index)
        throw Error("Clicked Procedure Source did not gain native keyboard focus: "+
          JSON.stringify({editorTarget,focusTarget,focusedSource}));
      // Resolve the fixture line from the *same pinned owner Source* that
      // the browser actually imported. A numeric hard-coded line silently
      // breaks when a legitimate owner SKILL refresh adds comments/Steps.
      const ownerProcedure=(await readFile(
        resolve("site/samples/skills/establish-pdu-session/assurance/procedure.yaml"),
        "utf8")).split("\n");
      const n4Start=ownerProcedure.findIndex(x=>
        /^  await-initial-n4-session-establishment:\s*$/.test(x));
      const nextProcedure=ownerProcedure.findIndex((x,i)=>i>n4Start&&
        /^  [a-z0-9-]+:\s*$/.test(x));
      const n4End=nextProcedure<0?ownerProcedure.length:nextProcedure;
      const candidates=ownerProcedure
        .map((x,i)=>i>=n4Start&&i<n4End&&
          /^          DENIED: failed\s*$/.test(x)?i+1:null)
        .filter(Boolean);
      if(n4Start<0||candidates.length!==1)
        throw Error("Pinned owner N4 DENIED Route line is not unique");
      const n4RouteLine=candidates[0];
      // This uses the native editor's public keyboard UI, not Monaco internals.
      await key("g","KeyG",2,71);
      await sleep(150);
      const gotoState=await evalJS(`({
        activeTag:document.activeElement?.tagName??"",
        activeClass:document.activeElement?.className??"",
        activeValue:document.activeElement?.value??"",
        ariaLabel:document.activeElement?.getAttribute("aria-label")??"",
        visibleWidgets:[...document.querySelectorAll(".monaco-editor .zone-widget,.quick-input-widget,.quick-input-box,.goto-line-widget")]
          .map(item=>({className:item.className,text:item.innerText?.slice(0,120)}))
      })`);
      await command("Input.insertText",{text:String(n4RouteLine)});
      await sleep(100);
      const gotoTyped=await evalJS(`({
        activeValue:document.activeElement?.value??"",
        ariaLabel:document.activeElement?.getAttribute("aria-label")??""
      })`);
      if(!String(gotoTyped.activeValue??"").includes(String(n4RouteLine)))
        throw Error("Native editor Go to Line did not receive fixture line "+n4RouteLine+": "+
          JSON.stringify({gotoState,gotoTyped}));
      await key("Enter","Enter",0,13);
      // Theia can replace a native Source editor while Go to Line closes.
      // Match the actual rendered Route fixture, not a stale Monaco DOM index.
      let gotoLineView=null;
      for(let attempt=0;attempt<30;attempt++){
        gotoLineView=await evalJS(`(()=> {
          const candidates=[...document.querySelectorAll(".monaco-editor")]
            .map((editor,index)=>{
              const viewport=editor.querySelector(".monaco-scrollable-element")??editor;
              const rect=viewport.getBoundingClientRect();
              const visible=rect.width>30&&rect.height>100&&
                rect.bottom>0&&rect.top<innerHeight&&rect.right>0&&rect.left<innerWidth;
              const text=(editor.querySelector(".view-lines")?.innerText??"")
                .replaceAll(String.fromCharCode(160)," ");
              return {index,visible,text};
            });
          const chosen=candidates.find(item=>item.visible&&
            item.text.includes("FAILED: unresolved")&&
            item.text.includes("UNKNOWN: unresolved")&&
            item.text.includes("DENIED: failed"));
          return chosen?{index:chosen.index,text:chosen.text,editorVisible:true}:
            {editorVisible:false,candidates:candidates.map(item=>({
              index:item.index,visible:item.visible,text:item.text.slice(0,1200)
            }))};
        })()`);
        if(gotoLineView.editorVisible)break;
        await sleep(100);
      }
      if(!gotoLineView?.editorVisible)
        throw Error("Go to Line did not land on the intended Route fixture: "+
          JSON.stringify({gotoState,gotoTyped,gotoLineView}).slice(0,3200));
      editorTarget.chosen.index=gotoLineView.index;
      // Home twice is Monaco's stable route to column zero (first
      // non-whitespace, then physical line start); replace the whole line.
      await key("Home","Home",0,36);
      await key("Home","Home",0,36);
      await key("End","End",8,35);
      // Remove this one existing Route so DENIED becomes an observed,
      // currently-unmapped Outcome eligible for the create-Route proposal.
      await key("Backspace","Backspace",0,8);
      await sleep(1500);
      const routeFixtureView=await command("Runtime.evaluate",{
        contextId:focusWorld.executionContextId,returnByValue:true,awaitPromise:true,
        expression:`({
          revision:document.querySelector("#revision")?.textContent||"",
          procedure:document.querySelector("#procedureList")?.value||"",
          graphNodes:document.querySelectorAll("#reactFlowRoot .react-flow__node").length,
          graphEdges:document.querySelectorAll("#reactFlowRoot .react-flow__edge").length
        })`
      });
      const routeFixtureEditor=await evalJS(`(()=> {
        const editor=document.querySelectorAll(".monaco-editor")[${editorTarget.chosen.index}];
        return {
          editorCount:document.querySelectorAll(".monaco-editor").length,
          activeTag:document.activeElement?.tagName??"",
          activeClass:document.activeElement?.className??"",
          visibleText:[...(editor?.querySelectorAll(".view-line")??[])]
            .map(line=>line.innerText.replace(/\u00a0/g," ")).join("\\n").slice(0,1800)
        };
      })()`);
      const routeFixture={
        ready:routeFixtureEditor.editorCount>0&&
          /TextDocument v\d+/.test(routeFixtureView.result?.value?.revision??"")&&
          routeFixtureView.result?.value?.procedure==="await-initial-n4-session-establishment"&&
          routeFixtureView.result?.value?.graphEdges===routeOriginalView.result?.value?.graphEdges-1&&
          routeFixtureEditor.visibleText.includes("UNKNOWN: unresolved")&&
          !routeFixtureEditor.visibleText.includes("DENIED: failed"),
        editor:editorTarget,goto:gotoState,gotoTyped,gotoLineView,
        original:routeOriginalView.result?.value??null,
        view:routeFixtureView.result?.value??null,after:routeFixtureEditor
      };
      if(!routeFixture.ready)
        throw Error("Could not prepare the isolated Route-creation fixture using the native editor: "+
          JSON.stringify(routeFixture).slice(0,9000));
      // Editing the fixture activates the Source tab. Bring the existing
      // Visual back to the foreground before sending trusted pointer input.
      await evalJS(`(async()=>{
        const container=window.theia.container;
        const openerKey=[...container._bindingDictionary._map.keys()].find(
          key=>String(key)==="Symbol(OpenerService)");
        const openers=await container.get(openerKey).getOpeners();
        const custom=openers.find(opener=>opener.id==="custom-editor-skillStudio.procedurePreview");
        const widget=custom?.widgetManager.getWidgets("plugin-custom-editor").find(
          item=>item.resource?.path.toString().endsWith(
            "/skills/establish-pdu-session/assurance/procedure.yaml"));
        if(!widget)throw Error("Procedure Visual tab is missing after Source editing");
        const shellKey=[...container._bindingDictionary._map.keys()].find(
          key=>typeof key==="function"&&key.prototype?.activateWidget&&key.prototype?.addWidget);
        if(!shellKey)throw Error("Theia application shell is missing");
        await container.get(shellKey).activateWidget(widget.id);
        return true;
      })()`);
      const routeMode=await command("Runtime.evaluate",{
        contextId:focusWorld.executionContextId,returnByValue:true,awaitPromise:true,
        expression:`(()=> {
          const select=document.querySelector("#procedureList");
          if(!select)return {ready:false,reason:"Procedure selector missing"};
          select.value="await-initial-n4-session-establishment";
          select.dispatchEvent(new Event("change",{bubbles:true}));
          return {ready:true,value:select.value};
        })()`
      });
      await sleep(1500);
      const selectRouteSource=await command("Runtime.evaluate",{
        contextId:focusWorld.executionContextId,returnByValue:true,awaitPromise:true,
        expression:`(()=> {
          const node=document.querySelector('#reactFlowRoot .react-flow__node[data-id="await-initial-resources"]');
          if(!node)return {ready:false,reason:"Source Node missing"};
          node.dispatchEvent(new MouseEvent("click",{bubbles:true}));
          return {ready:true,nodeId:node.getAttribute("data-id")};
        })()`
      });
      await sleep(350);
      // The Packages sidebar reduces the graph viewport on first import.
      // Use the real Fit control so both handles are on screen before
      // dispatching trusted Chromium pointer events.
      await command("Runtime.evaluate",{
        contextId:focusWorld.executionContextId,returnByValue:true,awaitPromise:true,
        expression:`document.querySelector("#fit")?.click(); true`
      });
      await sleep(500);
      const routeGestureInfo=await command("Runtime.evaluate",{
        contextId:focusWorld.executionContextId,returnByValue:true,awaitPromise:true,
        expression:`(()=> {
          const node=document.querySelector('#reactFlowRoot .react-flow__node[data-id="await-initial-resources"]');
          const targetNode=document.querySelector('#reactFlowRoot .react-flow__node[data-id="failed"]');
          if(!node||!targetNode)return {ready:false,reason:"Source/target Node missing"};
          const source=node.querySelector('.react-flow__handle[data-handleid="new-route-out"]');
          const target=targetNode.querySelector('.react-flow__handle[data-handleid="in"]');
          if(!source||!target)return {ready:false,reason:"Dedicated add-Route or target handle missing",
            source:Boolean(source),target:Boolean(target)};
          const center=element=>{const r=element.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};};
          return {ready:true,source:center(source),target:center(target),
            width:window.innerWidth,height:window.innerHeight,
            sourceHandle:source.getAttribute("data-handleid"),targetHandle:target.getAttribute("data-handleid")};
        })()`
      });
      const routeGesture=routeGestureInfo.result?.value??null;
      if(!routeGesture?.ready)
        throw Error("Dedicated Route handles are not rendered: "+JSON.stringify(routeGesture));
      await command("DOM.enable");
      const frameOwner=await command("DOM.getFrameOwner",{frameId:graphFrame.frame.id});
      const frameBox=await command("DOM.getBoxModel",{backendNodeId:frameOwner.backendNodeId});
      const quad=frameBox.model.content;
      const scaleX=(quad[2]-quad[0])/routeGesture.width;
      const scaleY=(quad[5]-quad[1])/routeGesture.height;
      const toPage=point=>({x:quad[0]+point.x*scaleX,y:quad[1]+point.y*scaleY});
      const fromPage=toPage(routeGesture.source),toPagePoint=toPage(routeGesture.target);
      const midPage={x:(fromPage.x+toPagePoint.x)/2,y:(fromPage.y+toPagePoint.y)/2};
      await command("Input.dispatchMouseEvent",{
        type:"mousePressed",x:fromPage.x,y:fromPage.y,button:"left",buttons:1,clickCount:1
      });
      await command("Input.dispatchMouseEvent",{
        type:"mouseMoved",x:midPage.x,y:midPage.y,button:"left",buttons:1
      });
      await command("Input.dispatchMouseEvent",{
        type:"mouseMoved",x:toPagePoint.x,y:toPagePoint.y,button:"left",buttons:1
      });
      await command("Input.dispatchMouseEvent",{
        type:"mouseReleased",x:toPagePoint.x,y:toPagePoint.y,button:"left",buttons:0,clickCount:1
      });
      await sleep(800);
      const routeProposal=await command("Runtime.evaluate",{
        contextId:focusWorld.executionContextId,returnByValue:true,awaitPromise:true,
        expression:`({
          visible:!document.querySelector("#newRouteEditor")?.hidden,
          summary:document.querySelector("#newRouteSummary")?.textContent||"",
          outcomes:[...(document.querySelector("#newRouteOutcome")?.options??[])].map(x=>x.value),
          message:document.querySelector("#message")?.textContent||""
        })`
      });
      const routeProposalValue=routeProposal.result?.value??null;
      if(!selectRouteSource.result?.value?.ready||!routeGesture?.ready||!routeProposalValue?.visible||
         !routeProposalValue.outcomes.includes("DENIED"))
        throw Error("Canvas Route proposal did not expose the observed DENIED Outcome: "+
          JSON.stringify({routeFixture,routeMode:routeMode.result?.value,
            selectRouteSource:selectRouteSource.result?.value,
            routeGesture,routeProposal:routeProposalValue}));
      const routePreview=await command("Runtime.evaluate",{
        contextId:focusWorld.executionContextId,returnByValue:true,awaitPromise:true,
        expression:`(()=> {
          const outcome=document.querySelector("#newRouteOutcome");
          outcome.value="DENIED";outcome.dispatchEvent(new Event("change",{bubbles:true}));
          document.querySelector("#newRoutePreview")?.click();
          return {ready:!document.querySelector("#commit")?.disabled,
            diff:document.querySelector("#diff")?.textContent||"",
            summary:document.querySelector("#newRouteSummary")?.textContent||""};
        })()`
      });
      const routePreviewValue=routePreview.result?.value??null;
      if(!routePreviewValue?.ready||!routePreviewValue.diff.includes("+")||
         !routePreviewValue.diff.includes("DENIED: failed"))
        throw Error("Canvas Route Diff preview did not qualify the selected Outcome: "+
          JSON.stringify(routePreviewValue));
      await command("Runtime.evaluate",{
        contextId:focusWorld.executionContextId,returnByValue:true,awaitPromise:true,
        expression:`document.querySelector("#commit")?.click(); true`
      });
      await sleep(1800);
      const routeApplied=await command("Runtime.evaluate",{
        contextId:focusWorld.executionContextId,returnByValue:true,awaitPromise:true,
        expression:`({
          revision:document.querySelector("#revision")?.textContent||"",
          message:document.querySelector("#message")?.textContent||"",
          procedure:document.querySelector("#procedureList")?.value||"",
          graphEdges:document.querySelectorAll("#reactFlowRoot .react-flow__edge").length,
          patchVisible:!document.querySelector("#patch")?.hidden
        })`
      });
      const routeAppliedSource={
        ready:/TextDocument v\d+/.test(routeApplied.result?.value?.revision??""),
        revision:routeApplied.result?.value?.revision??"",
        graphEdges:routeApplied.result?.value?.graphEdges??0
      };
      if(!routeAppliedSource.ready||
         routeAppliedSource.graphEdges!==routeFixture.view.graphEdges+1)
        throw Error("Host Source snapshot did not add exactly one projected Route: "+
          JSON.stringify({fixture:routeFixture.view,applied:routeApplied.result?.value}));
      await command("Runtime.evaluate",{
        contextId:focusWorld.executionContextId,returnByValue:true,awaitPromise:true,
        expression:`document.querySelector("#openSource")?.click(); true`
      });
      await sleep(700);
      await command("Input.dispatchKeyEvent",{
        type:"keyDown",key:"z",code:"KeyZ",modifiers:2,windowsVirtualKeyCode:90,nativeVirtualKeyCode:90
      });
      await command("Input.dispatchKeyEvent",{
        type:"keyUp",key:"z",code:"KeyZ",modifiers:2,windowsVirtualKeyCode:90,nativeVirtualKeyCode:90
      });
      await sleep(1800);
      const routeUndo=await command("Runtime.evaluate",{
        contextId:focusWorld.executionContextId,returnByValue:true,awaitPromise:true,
        expression:`({
          revision:document.querySelector("#revision")?.textContent||"",
          message:document.querySelector("#message")?.textContent||"",
          procedure:document.querySelector("#procedureList")?.value||"",
          graphEdges:document.querySelectorAll("#reactFlowRoot .react-flow__edge").length
        })`
      });
      const routeUndoSource={
        ready:/TextDocument v\d+/.test(routeUndo.result?.value?.revision??""),
        revision:routeUndo.result?.value?.revision??"",
        graphEdges:routeUndo.result?.value?.graphEdges??0
      };

      // Reconnect a specific member of a multi-Outcome edge bundle. Clicking
      // the bundle must not silently pick its first Route; the Route selector
      // is the explicit disambiguation step before the target endpoint drag.
      const reconnectEdgeInfo=await command("Runtime.evaluate",{
        contextId:focusWorld.executionContextId,returnByValue:true,awaitPromise:true,
        expression:`(()=> {
          const source=document.querySelector('#reactFlowRoot .react-flow__node[data-id="await-initial-resources"]');
          const oldTarget=document.querySelector('#reactFlowRoot .react-flow__node[data-id="unresolved"]');
          const newTarget=document.querySelector('#reactFlowRoot .react-flow__node[data-id="failed"]');
          if(!source||!oldTarget||!newTarget)return {ready:false,reason:"Reconnect Nodes missing"};
          const pairs=[...source.querySelectorAll('.react-flow__handle[data-handleid^="edge-"][data-handleid$="-out"]')]
            .map(handle=>{
              const match=handle.getAttribute("data-handleid")?.match(/^edge-(\\d+)-out$/);
              if(!match)return null;
              const index=Number(match[1]),targetHandle=oldTarget.querySelector(
                '.react-flow__handle[data-handleid="edge-'+index+'-in"]');
              if(!targetHandle)return null;
              const edge=document.querySelector('#reactFlowRoot .react-flow__edge[data-id="flow-edge-'+index+'"]');
              const path=edge?.querySelector(".react-flow__edge-path");
              const target=newTarget.querySelector('.react-flow__handle[data-handleid="in"]');
              if(!path||!target)return null;
              const point=path.ownerSVGElement.createSVGPoint();
              const middle=path.getPointAtLength(path.getTotalLength()/2);
              point.x=middle.x;point.y=middle.y;
              const screenPoint=point.matrixTransform(path.getScreenCTM());
              const oldRect=targetHandle.getBoundingClientRect();
              const newRect=target.getBoundingClientRect();
              return {index,edgeId:edge.getAttribute("data-id"),
                pathPoint:{x:screenPoint.x,y:screenPoint.y},
                oldTargetPoint:{x:oldRect.left+oldRect.width/2,y:oldRect.top+oldRect.height/2},
                newTargetPoint:{x:newRect.left+newRect.width/2,y:newRect.top+newRect.height/2},
                sourceHandle:handle.getAttribute("data-handleid"),
                targetHandle:targetHandle.getAttribute("data-handleid")};
            }).filter(Boolean);
          return {ready:pairs.length>0,candidates:pairs,
            width:window.innerWidth,height:window.innerHeight};
        })()`
      });
      const reconnectCandidates=reconnectEdgeInfo.result?.value?.candidates??[];
      if(!reconnectEdgeInfo.result?.value?.ready||!reconnectCandidates.length)
        throw Error("Could not locate an existing Route bundle to unresolved: "+
          JSON.stringify(reconnectEdgeInfo.result?.value));
      let reconnectEdge=null,ambiguousValue=null,lastBundleValue=null;
      for(const candidate of reconnectCandidates){
        const edgeClick=toPage(candidate.pathPoint);
        await command("Input.dispatchMouseEvent",{
          type:"mousePressed",x:edgeClick.x,y:edgeClick.y,button:"left",clickCount:1
        });
        await command("Input.dispatchMouseEvent",{
          type:"mouseReleased",x:edgeClick.x,y:edgeClick.y,button:"left",clickCount:1
        });
        await sleep(350);
        const selectedBundle=await command("Runtime.evaluate",{
          contextId:focusWorld.executionContextId,returnByValue:true,awaitPromise:true,
          expression:`({
            selectedRoute:document.querySelector("#routeList")?.value??"",
            message:document.querySelector("#message")?.textContent??"",
            selectedLabels:[...document.querySelectorAll(".designer-route-label.is-selected")]
              .map(label=>({
                routeSource:label.getAttribute("data-route-source")??"",
                routeIds:(label.getAttribute("data-route-ids")??"").split(",").filter(Boolean)
              }))
          })`
        });
        const value=selectedBundle.result?.value??null;
        lastBundleValue=value;
        const exactBundle=value?.selectedLabels?.some(label=>
          label.routeSource==="operator.on"&&
          label.routeIds.includes("await-initial-resources:FAILED")&&
          label.routeIds.includes("await-initial-resources:UNKNOWN")
        );
        if(value?.selectedRoute===""&&
           String(value?.message??"").includes("多个 Outcome")&&exactBundle){
          reconnectEdge=candidate;
          ambiguousValue=value;
          break;
        }
      }
      if(!reconnectEdge||!ambiguousValue)
        throw Error("Could not select the ambiguous operator.on Route bundle without selecting an Outcome: "+
          JSON.stringify({candidates:reconnectCandidates,selection:lastBundleValue,
            lastMessage:lastBundleValue?.message??""}));
      const chooseReconnectRoute=await command("Runtime.evaluate",{
        contextId:focusWorld.executionContextId,returnByValue:true,awaitPromise:true,
        expression:`(()=> {
          const select=document.querySelector("#routeList");
          const routeId="await-initial-resources:FAILED";
          if(!select||![...select.options].some(item=>item.value===routeId))
            return {ready:false,reason:"Specific FAILED Route is not selectable",
              options:[...(select?.options??[])].map(x=>({value:x.value,label:x.textContent}))};
          select.value=routeId;select.dispatchEvent(new Event("change",{bubbles:true}));
          const targets=document.querySelector("#targetList");
          return {ready:true,route:select.value,targetOptions:[...(targets?.options??[])].map(x=>x.value)};
        })()`
      });
      const chooseReconnectValue=chooseReconnectRoute.result?.value??null;
      if(!chooseReconnectValue?.ready||!chooseReconnectValue.targetOptions.includes("failed"))
        throw Error("Could not explicitly qualify the Route target change: "+JSON.stringify(chooseReconnectValue));
      await sleep(350);
      await command("Runtime.evaluate",{
        contextId:focusWorld.executionContextId,returnByValue:true,awaitPromise:true,
        expression:`document.querySelector("#fit")?.click(); true`
      });
      await sleep(500);
      const updaterInfo=await command("Runtime.evaluate",{
        contextId:focusWorld.executionContextId,returnByValue:true,awaitPromise:true,
        expression:`(()=> {
          const routeId="await-initial-resources:FAILED";
          const source=document.querySelector('#reactFlowRoot .react-flow__node[data-id="await-initial-resources"]');
          const oldTarget=document.querySelector('#reactFlowRoot .react-flow__node[data-id="unresolved"]');
          const newTarget=document.querySelector('#reactFlowRoot .react-flow__node[data-id="failed"]');
          const labels=[...document.querySelectorAll(".designer-route-label.is-selected")];
          const label=labels.find(item=>item.getAttribute("data-route-source")==="operator.on"&&
            (item.getAttribute("data-route-ids")??"").split(",").includes(routeId));
          const edges=[...document.querySelectorAll("#reactFlowRoot .react-flow__edge")];
          const selectedEdges=edges.filter(item=>item.querySelector(".designer-edge.is-selected"));
          const edge=selectedEdges.find(item=>{
            const index=item.getAttribute("data-id")?.match(/^flow-edge-(\\d+)$/)?.[1];
            return index&&oldTarget?.querySelector(
              '.react-flow__handle[data-handleid="edge-'+index+'-in"]');
          });
          const index=Number(edge?.getAttribute("data-id")?.match(/^flow-edge-(\\d+)$/)?.[1]??-1);
          const oldHandle=index>=0?oldTarget?.querySelector(
            '.react-flow__handle[data-handleid="edge-'+index+'-in"]'):null;
          const target=newTarget?.querySelector('.react-flow__handle[data-handleid="in"]');
          const rect=element=>{const r=element.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};};
          const updaters=[...(edge?.querySelectorAll(".react-flow__edgeupdater")??[])];
          const oldPoint=oldHandle?rect(oldHandle):null;
          const chosen=oldPoint?updaters.map(element=>({element,point:rect(element)}))
            .sort((a,b)=>Math.hypot(a.point.x-oldPoint.x,a.point.y-oldPoint.y)-
              Math.hypot(b.point.x-oldPoint.x,b.point.y-oldPoint.y))[0]:null;
          return {ready:Boolean(label&&edge&&chosen&&target),updaterCount:updaters.length,index,
            label:label?{source:label.getAttribute("data-route-source"),ids:label.getAttribute("data-route-ids")} :null,
            selectedEdgeCount:selectedEdges.length,
            updater:chosen?.point??null,target:target?rect(target):null,
            oldPoint,updaterHtml:chosen?.element?.outerHTML??"",
            edgeHtml:edge?.outerHTML?.slice(0,1800)??""};
        })()`
      });
      const updaterValue=updaterInfo.result?.value??null;
      if(!updaterValue?.ready)
        throw Error("Selected edge did not expose a reconnect target handle: "+
          JSON.stringify({ambiguous:ambiguousValue,selected:chooseReconnectValue,updater:updaterValue}));
      const reconnectFromPage=toPage(updaterValue.updater);
      const reconnectToPage=toPage(updaterValue.target);
      const reconnectMidPage={x:(reconnectFromPage.x+reconnectToPage.x)/2,
        y:(reconnectFromPage.y+reconnectToPage.y)/2};
      await command("Input.dispatchMouseEvent",{
        type:"mousePressed",x:reconnectFromPage.x,y:reconnectFromPage.y,
        button:"left",buttons:1,clickCount:1
      });
      await command("Input.dispatchMouseEvent",{
        type:"mouseMoved",x:reconnectMidPage.x,y:reconnectMidPage.y,
        button:"left",buttons:1
      });
      await command("Input.dispatchMouseEvent",{
        type:"mouseMoved",x:reconnectToPage.x,y:reconnectToPage.y,
        button:"left",buttons:1
      });
      await command("Input.dispatchMouseEvent",{
        type:"mouseReleased",x:reconnectToPage.x,y:reconnectToPage.y,
        button:"left",buttons:0,clickCount:1
      });
      await sleep(600);
      const reconnectProposal=await command("Runtime.evaluate",{
        contextId:focusWorld.executionContextId,returnByValue:true,awaitPromise:true,
        expression:`({
          route:document.querySelector("#routeList")?.value??"",
          target:document.querySelector("#targetList")?.value??"",
          targets:[...(document.querySelector("#targetList")?.options??[])].map(x=>x.value),
          previewDisabled:Boolean(document.querySelector("#preview")?.disabled),
          message:document.querySelector("#message")?.textContent??""
        })`
      });
      const reconnectProposalValue=reconnectProposal.result?.value??null;
      if(reconnectProposalValue?.route!=="await-initial-resources:FAILED"||
         reconnectProposalValue?.target!=="failed")
        throw Error("Canvas reconnect did not propose the selected Route's target: "+
          JSON.stringify({edge:reconnectEdge,updater:updaterValue,proposal:reconnectProposalValue}));
      await command("Runtime.evaluate",{
        contextId:focusWorld.executionContextId,returnByValue:true,awaitPromise:true,
        expression:`document.querySelector("#preview")?.click(); true`
      });
      await sleep(250);
      const reconnectDiff=await command("Runtime.evaluate",{
        contextId:focusWorld.executionContextId,returnByValue:true,awaitPromise:true,
        expression:`({
          ready:!document.querySelector("#commit")?.disabled,
          diff:document.querySelector("#diff")?.textContent??""
        })`
      });
      const reconnectDiffValue=reconnectDiff.result?.value??null;
      if(!reconnectDiffValue?.ready||
         !reconnectDiffValue.diff.includes("unresolved")||
         !reconnectDiffValue.diff.includes("failed"))
        throw Error("Reconnect Diff did not qualify the exact target replacement: "+JSON.stringify(reconnectDiffValue));
      await command("Runtime.evaluate",{
        contextId:focusWorld.executionContextId,returnByValue:true,awaitPromise:true,
        expression:`document.querySelector("#commit")?.click(); true`
      });
      await sleep(1800);
      const reconnectApplied=await command("Runtime.evaluate",{
        contextId:focusWorld.executionContextId,returnByValue:true,awaitPromise:true,
        expression:`({
          revision:document.querySelector("#revision")?.textContent??"",
          graphEdges:document.querySelectorAll("#reactFlowRoot .react-flow__edge").length,
          routeOption:[...(document.querySelector("#routeList")?.options??[])]
            .find(x=>x.value==="await-initial-resources:FAILED")?.textContent??"",
          message:document.querySelector("#message")?.textContent??""
        })`
      });
      const reconnectAppliedValue=reconnectApplied.result?.value??null;
      // Moving FAILED out of the shared operator.on -> unresolved Bundle
      // splits that visual Bundle into two. Route count is stable; edge count
      // correctly increases by one until native Undo restores the original Bundle.
      if(!/TextDocument v\d+/.test(reconnectAppliedValue?.revision??"")||
         !String(reconnectAppliedValue?.routeOption??"").includes("→ failed")||
         reconnectAppliedValue?.graphEdges!==routeFixture.view.graphEdges+1)
        throw Error("Native TextDocument did not apply the reconnect Patch: "+
          JSON.stringify({fixture:routeFixture.view,applied:reconnectAppliedValue}));
      await command("Runtime.evaluate",{
        contextId:focusWorld.executionContextId,returnByValue:true,awaitPromise:true,
        expression:`document.querySelector("#openSource")?.click(); true`
      });
      await sleep(500);
      await key("z","KeyZ",2,90);
      await sleep(1700);
      const reconnectUndo=await command("Runtime.evaluate",{
        contextId:focusWorld.executionContextId,returnByValue:true,awaitPromise:true,
        expression:`({
          revision:document.querySelector("#revision")?.textContent??"",
          graphEdges:document.querySelectorAll("#reactFlowRoot .react-flow__edge").length,
          routeOption:[...(document.querySelector("#routeList")?.options??[])]
            .find(x=>x.value==="await-initial-resources:FAILED")?.textContent??""
        })`
      });
      const reconnectUndoValue=reconnectUndo.result?.value??null;
      if(!/TextDocument v\d+/.test(reconnectUndoValue?.revision??"")||
         !String(reconnectUndoValue?.routeOption??"").includes("→ unresolved")||
         reconnectUndoValue?.graphEdges!==routeFixture.view.graphEdges)
        throw Error("Native Undo did not restore the original Route target: "+JSON.stringify(reconnectUndoValue));
      const routeReconnect={
        edge:reconnectEdge,ambiguous:ambiguousValue,selected:chooseReconnectValue,
        updater:updaterValue,proposal:reconnectProposalValue,diff:reconnectDiffValue,
        applied:reconnectAppliedValue,undo:reconnectUndoValue
      };
      patchEvidence.routeCreate={
        fixture:routeFixture,gesture:routeGesture,
        proposal:routeProposalValue,preview:routePreviewValue,
        applied:routeApplied.result?.value??null,appliedSource:routeAppliedSource,
        undo:routeUndo.result?.value??null,undoSource:routeUndoSource,
        reconnect:routeReconnect
      };
    }else{
      patchEvidence={preview:previewEvidence,applied:null};
    }
  }
  console.log("STUDIO_THEIA_STAGE","native-workbench");
  const evalWebviewJS=async expression=>{
    // Native editor interactions above can recreate the Webview iframe.
    // Refresh CDP execution contexts and resolve the current frame each time
    // rather than retaining an executionContextId from an earlier render.
    const tree=await command("Page.getFrameTree");
    const currentFrames=[];
    const collect=node=>{
      if(!node)return;
      currentFrames.push(node.frame);
      for(const child of node.childFrames??[])collect(child);
    };
    collect(tree.frameTree);
    const expectedPath=(webviewFrame?.url??"").split("?")[0];
    const candidates=currentFrames.filter(frame=>
      (frame.url.includes("/webview/index.html")||frame.url.includes(".webview."))&&
      (!expectedPath||frame.url.split("?")[0]===expectedPath));
    await command("Runtime.enable");
    await sleep(40);
    let frame=null,contextId=null;
    const probes=[];
    for(const candidate of candidates){
      const isolated=await command("Page.createIsolatedWorld",{
        frameId:candidate.id,worldName:"skill-studio-live-webview-probe",
        grantUniveralAccess:true
      });
      const probe=await command("Runtime.evaluate",{
        contextId:isolated.executionContextId,returnByValue:true,
        expression:`Boolean(document.querySelector("#downloadPackageZip")&&
          document.querySelector("#exportPackageZip")&&
          document.querySelector("#reactFlowRoot"))`
      });
      probes.push({id:candidate.id,url:candidate.url,hasStudioControls:probe.result?.value===true});
      if(probe.result?.value!==true)continue;
      const id=defaultExecutionContexts.get(candidate.id);
      if(id){frame=candidate;contextId=id;break;}
    }
    if(!contextId)
      throw Error("Active Procedure Webview main context is unavailable: "+
        JSON.stringify({expectedPath,probes,known:[...defaultExecutionContexts.entries()]}));
    const data=await command("Runtime.evaluate",{
      contextId,expression,returnByValue:true,awaitPromise:true
    });
    if(data.exceptionDetails)
      throw Error("Procedure Webview evaluate: "+JSON.stringify({
        text:data.exceptionDetails.text,
        exception:data.exceptionDetails.exception?.description??null,
        line:data.exceptionDetails.lineNumber,column:data.exceptionDetails.columnNumber
      }));
    return data.result?.value;
  };
  let workbenchEvidence;
  try{workbenchEvidence=await runWorkbenchAcceptance({
    command,evalJS,evalWebviewJS,sleep,requireEditor,requireBrowserLsp
  });}
  catch(error){console.log("STUDIO_NATIVE_MARKDOWN_LANGUAGE_SERVER_DIAGNOSTIC",JSON.stringify({workerRequests:markdownWorkerRequests,targets:[...workerTargets.values()],discoveredTargets,targetSetupErrors:workerTargetSetupErrors,serverErrors:consoleErrors.filter(message=>/Client Markdown Language Server|markdown.*language server|language server.*markdown/i.test(message)),networkFailures:networkFailures.filter(x=>/worker|plugin/i.test(x.errorText??""))}));console.log("STUDIO_WORKBENCH_ERROR",String(error));console.log("STUDIO_WORKBENCH_FAILURE",JSON.stringify(await evalJS(`({text:document.body.innerText,activities:[...document.querySelectorAll(".theia-app-sides [title],.theia-app-sides [aria-label]")].map(x=>({title:x.title,aria:x.getAttribute("aria-label")})),tabs:[...document.querySelectorAll(".lm-TabBar-tab")].map(x=>({text:x.textContent,className:x.className}))})`)));throw error;}
  const markdownServerErrors=consoleErrors.filter(message=>/Client Markdown Language Server|markdown.*language server|language server.*markdown/i.test(message));
  const markdownWorkerRuntimeErrors=workerRuntimeErrors.filter(({target,message})=>
    /vscode_markdown_language_features|markdown-language-features|serverWorkerMain\.js/i.test(target?.url??"")||
    /Client Markdown Language Server|markdown.*language server|language server.*markdown/i.test(message??""));
  const expectedMarkdownWorkerPath=basePath+
    "/hostedPlugin/vscode_markdown_language_features/dist/browser/serverWorkerMain.js";
  const observedMarkdownWorkerPaths=markdownWorkerRequests.map(request=>{
    try{return new URL(request.url).pathname;}catch{return request.url;}
  });
  const markdownWorkerPathObserved=observedMarkdownWorkerPaths.includes(expectedMarkdownWorkerPath);
  const rootRelativeMarkdownWorkerRequests=basePath
    ?observedMarkdownWorkerPaths.filter(path=>path==="/hostedPlugin/vscode_markdown_language_features/dist/browser/serverWorkerMain.js")
    :[];
  const markdownWorkerEvidence={
    requests:markdownWorkerRequests,
    expectedWorkerPath:expectedMarkdownWorkerPath,
    observedWorkerPaths:observedMarkdownWorkerPaths,
    workerPathObserved:markdownWorkerPathObserved,
    rootRelativeWorkerRequests:rootRelativeMarkdownWorkerRequests,
    targets:[...workerTargets.values()],discoveredTargets,
    targetSetupErrors:workerTargetSetupErrors,
    serverErrors:markdownServerErrors,
    workerRuntimeErrors:markdownWorkerRuntimeErrors
  };
  console.log("STUDIO_NATIVE_MARKDOWN_LANGUAGE_SERVER_CHROMIUM",JSON.stringify(markdownWorkerEvidence));
  if((requireWebview||requireBrowserLsp)&&
     (!markdownWorkerPathObserved||rootRelativeMarkdownWorkerRequests.length||
      markdownServerErrors.length||markdownWorkerRuntimeErrors.length))
    throw Error("Native Markdown Language Server did not start cleanly under the configured Pages path: "+
      JSON.stringify(markdownWorkerEvidence));
  if(!requireBrowserLsp)
    console.log("STUDIO_NATIVE_MARKDOWN_HOST_DIAGNOSTIC",JSON.stringify({browserWorkerExpected:false,diagnostics:markdownWorkerEvidence}));
  // Run Package Overview last: opening the second Skill's visual Source must
  // not alter the Procedure Webview used by the preceding authoring regression.
  const packageOverviewEvidence=await runPackageOverviewAcceptance({
    command,evalJS,sleep,requireEditor
  });
  if(requireEditor&&(!packageOverviewEvidence?.twoSkills||
      packageOverviewEvidence.evidence?.skills?.length!==2))
    throw Error("Two-SKILL Package Overview Chromium acceptance did not complete: "+
      JSON.stringify(packageOverviewEvidence));
  console.log("STUDIO_THEIA_STAGE","package-overview");
  // Inspect the native Explorer itself, not Package Overview's fallback scan
  // over open documents. This is the regression that the old smoke missed.
  await command("Input.dispatchKeyEvent",{type:"keyDown",key:"F1",code:"F1",windowsVirtualKeyCode:112});
  await command("Input.dispatchKeyEvent",{type:"keyUp",key:"F1",code:"F1",windowsVirtualKeyCode:112});
  await sleep(300);
  await command("Input.insertText",{text:"Focus on Files Explorer"});
  await sleep(500);
  const focusExplorerRow=await evalJS(`(()=>{
    const node=[...document.querySelectorAll('.monaco-list-row')].find(x=>
      x.innerText.includes('Focus on Files Explorer'));
    if(!node)return null;
    const r=node.getBoundingClientRect();
    return {x:r.left+r.width/2,y:r.top+r.height/2,text:node.innerText};
  })()`);
  if(!focusExplorerRow)
    throw Error("The native Focus on Files Explorer command is unavailable");
  await command("Input.dispatchMouseEvent",{type:"mouseMoved",x:focusExplorerRow.x,y:focusExplorerRow.y});
  await command("Input.dispatchMouseEvent",{type:"mousePressed",x:focusExplorerRow.x,y:focusExplorerRow.y,button:"left",clickCount:1});
  await command("Input.dispatchMouseEvent",{type:"mouseReleased",x:focusExplorerRow.x,y:focusExplorerRow.y,button:"left",clickCount:1});
  await sleep(500);
  const nativeExplorer=await evalJS(`(()=>{
    const explorer=document.querySelector('.theia-Files');
    const text=explorer?.innerText??'';
    return {visible:Boolean(explorer),text,
      noFolderPrompt:text.includes('You have not yet opened a folder.')||
        text.includes('You have not yet added a folder to the workspace.'),
      rootVisible:text.includes('skill-studio-demo')};
  })()`);
  afterImport.explorerText=nativeExplorer.text;
  afterImport.noFolderPrompt=nativeExplorer.noFolderPrompt;
  afterImport.workspaceRootVisible=nativeExplorer.rootVisible;
  afterImport.explorerVisible=nativeExplorer.visible;
  if(!afterImport.statusBar||afterImport.statusBar.noWorkspace||
     !nativeExplorer.visible||nativeExplorer.noFolderPrompt||!nativeExplorer.rootVisible)
    throw Error("The native Explorer still has no default project root: "+
      JSON.stringify({statusBar:afterImport.statusBar,nativeExplorer}));
  const listingResponse=await fetch(url+"hostedPlugin/list.json");
  const listing=await listingResponse.text();
  const evidence={shellReadyMs,workbenchEvidence,packageOverviewEvidence,view,warningDismissed,diagnostics,paletteBefore,paletteAfter,viewPosition,viewMenu,paletteItemPos,paletteMenuOpened,registeredCommands,loadExampleRow,afterImport,
    frameCount:frames.length,frameUrls:frames.map(frame=>frame.url),webviewFrames,webviewFrame,webviewView,webviewFrameError,patchEvidence,
    extensionListStatus:listingResponse.status,extensionListPreview:listing.slice(0,500),
    extensionListPresent:listing.includes("ca-skill-studio-ide-spike"),
    requested:requests.size,notFound:[...notFound].slice(0,15),
    networkFailures:networkFailures.slice(-15),networkResponses:networkResponses.slice(-30),
    consoleErrors:consoleErrors.slice(0,8),exceptions:exceptions.slice(0,6)};
  console.log("STUDIO_THEIA_REAL_CHROMIUM",JSON.stringify(evidence));
  if(!view?.appShell||view.widgets<5||view.bodyLength<15)
    throw Error("Theia browser shell failed to start: "+JSON.stringify(evidence).slice(0,2200));
  if(!view?.nativeCodicons?.fontLoaded||view.nativeCodicons.glyphs<1)
    throw Error("Native Theia Codicon font did not render shell controls: "+
      JSON.stringify(view?.nativeCodicons).slice(0,1200));
  if(!view?.brand?.present||!view.brand.stylesheet||
     !view.brand.beforeNativeMenus||!view.brand.sameRow||
     view.brand.label!=="SKILL Studio"||
     !view.brand.nativeMenus.includes("File")||
     !view.brand.nativeMenus.includes("Edit"))
    throw Error("SKILL Studio brand must share the native File/Edit menu row: "+
      JSON.stringify(view?.brand));
  await command("Emulation.setDeviceMetricsOverride",{
    width:640,height:900,deviceScaleFactor:1,mobile:false
  });
  const narrowBrand=await evalJS(`(()=>{
    const brand=document.querySelector('[id="theia:menubar"].lm-MenuBar > .skill-studio-brand');
    const label=brand?.querySelector(".skill-studio-brand-label");
    const mark=brand?.querySelector(".skill-studio-brand-mark");
    return {
      present:Boolean(brand),
      labelDisplay:label?getComputedStyle(label).display:"missing",
      markVisible:Boolean(mark)&&getComputedStyle(mark).display!=="none"&&mark.getBoundingClientRect().width>0
    };
  })()`);
  await command("Emulation.clearDeviceMetricsOverride");
  if(!narrowBrand.present||narrowBrand.labelDisplay!=="none"||!narrowBrand.markVisible)
    throw Error("SKILL Studio brand did not compact cleanly on narrow screens: "+
      JSON.stringify(narrowBrand));
  console.log("STUDIO_STATUS_BAR_CHROMIUM",JSON.stringify(afterImport.statusBar));
  if(!afterImport.statusBar||
     !["rgb(245, 247, 251)","rgb(229, 246, 239)"].includes(
       afterImport.statusBar.background))
    throw Error("Theia status bar is not Studio Light: "+
      JSON.stringify(afterImport.statusBar));
  if(!afterImport.notificationText.some(message=>
       message.includes("示例项目已载入并打开工作区：skill-studio-demo/")&&
       message.includes("默认已打开传统 5GC Procedure")&&
       message.includes("同步 18 个官方文件"))||
     afterImport.noFolderPrompt||!afterImport.workspaceRootVisible||
     !afterImport.explorerText.includes("skills")||
     !afterImport.explorerText.includes("establish-pdu-session")||
     !afterImport.explorerText.includes("procedure.yaml"))
    throw Error("Theia did not open the real default project workspace: "+JSON.stringify({afterImport,registeredCommands}).slice(0,3500));
  if(requireEditor&&(!webviewFrame||!webviewView?.procedureRoot||webviewView.graphNodes<1||
      webviewView.procedureValue!=="ue-requested-pdu-session-establishment"))
    throw Error("Procedure Custom Editor webview did not render a graph: "+
      JSON.stringify({webviewFrame,webviewView,webviewFrameError,networkFailures}).slice(0,3000));
  if(requireEditor&&(!patchEvidence?.preview?.ready||
      !String(patchEvidence.preview.diff).includes("-")||
      !String(patchEvidence.preview.diff).includes("+")||
      !/TextDocument v[2-9]/.test(patchEvidence.applied?.revision??"")))
    throw Error("Source-backed Patch preview/apply did not update the TextDocument: "+
      JSON.stringify(patchEvidence).slice(0,3000));
  // The default Root view is the proven success path (9 nodes / 8 bundled
  // edges); the old smoke asserted 46 full-graph edges even before switching
  // to All Paths. Require both the default restored view and the full graph.
  if(requireEditor&&(!(patchEvidence.sourceEditor?.monacoEditors>0)||
      !/TextDocument v[3-9]/.test(patchEvidence.undo?.revision??"")||
      patchEvidence.undo?.graphNodes!==9||
      patchEvidence.undo?.graphEdges!==8||
      patchEvidence.canvasToolbar?.allPaths?.nodes!==17||
      patchEvidence.canvasToolbar?.allPaths?.edges!==46))
    throw Error("Native Source editor/undo did not restore the original Procedure projection: "+
      JSON.stringify(patchEvidence).slice(0,3000));
  if(requireEditor&&(!workbenchEvidence?.phaseEvidence?.ready||
      !workbenchEvidence.phaseEvidence.dataflowRows||
      !workbenchEvidence.phaseEvidence.consumerAbiRows||
      !workbenchEvidence.phaseEvidence.readOnly))
    throw Error("Native read-only Producer / Consumer Evidence acceptance failed: "+
      JSON.stringify(workbenchEvidence?.phaseEvidence).slice(0,3000));
  if(requireEditor&&(!workbenchEvidence?.namedStepRename?.accepted||
      !workbenchEvidence.namedStepRename.applied||
      !workbenchEvidence.namedStepRename.undo||
      workbenchEvidence.namedStepRename.applied===workbenchEvidence.namedStepRename.undo||
      !workbenchEvidence?.namedVerifyName?.applied||
      !workbenchEvidence.namedVerifyName.undone||
      workbenchEvidence.namedVerifyName.applied===workbenchEvidence.namedVerifyName.undone))
    throw Error("Named Phase Step / Verify native authoring and Undo acceptance failed: "+
      JSON.stringify(workbenchEvidence).slice(0,4000));
  if(requireEditor&&(!patchEvidence.nodeFocus?.open?.clicked||
      !patchEvidence.nodeFocus?.view?.visible||
      patchEvidence.nodeFocus.view.title!=="nudm-sdm-subscribe"||
      patchEvidence.nodeFocus.view.preSteps!==5||
      patchEvidence.nodeFocus.view.postSteps!==1||
      patchEvidence.nodeFocus.view.neighbors<1||
      patchEvidence.nodeFocus.view.graphNodes<4||
      !patchEvidence.nodeFocus?.sourceJump?.ready||
      !(patchEvidence.nodeFocus?.sourceJumpView?.monacoEditors>0)||
      !patchEvidence.nodeFocus?.returned?.returned||
      !patchEvidence.nodeFocus?.returned?.mainGraphVisible||
      !patchEvidence.routeCreate?.fixture?.ready||
      !patchEvidence.routeCreate?.gesture?.ready||
      !patchEvidence.routeCreate?.proposal?.visible||
      !patchEvidence.routeCreate?.preview?.ready||
      !patchEvidence.routeCreate?.appliedSource?.ready||
      !patchEvidence.routeCreate?.undoSource?.ready||
      patchEvidence.routeCreate?.undoSource?.graphEdges!==
        patchEvidence.routeCreate?.fixture?.view?.graphEdges||
      !patchEvidence.routeCreate?.reconnect?.ambiguous||
      !patchEvidence.routeCreate?.reconnect?.selected?.ready||
      !patchEvidence.routeCreate?.reconnect?.updater?.ready||
      patchEvidence.routeCreate?.reconnect?.proposal?.target!=="failed"||
      !patchEvidence.routeCreate?.reconnect?.diff?.ready||
      !String(patchEvidence.routeCreate?.reconnect?.applied?.routeOption??"").includes("→ failed")||
      !String(patchEvidence.routeCreate?.reconnect?.undo?.routeOption??"").includes("→ unresolved")))
    throw Error("Theia Node Focus / PRE-OP-POST / Source line jump acceptance failed: "+
      JSON.stringify({nodeFocus:patchEvidence.nodeFocus,routeCreate:patchEvidence.routeCreate}).slice(0,5000));
  if(requireEditor)
    console.log("THEIA_SAMPLE_IMPORT_PASS; THEIA_NATIVE_CODICONS_PASS; SKILL_STUDIO_BRAND_PASS; PROCEDURE_CUSTOM_EDITOR_GRAPH_PASS; SOURCE_PATCH_APPLY_PASS; NATIVE_SOURCE_UNDO_PASS; PHASE_NAMED_STEP_RENAME_PASS; NAMED_VERIFY_AUTHORING_PASS; PHASE_DATAFLOW_EVIDENCE_PASS; NODE_FOCUS_PRE_OP_POST_PASS; SOURCE_LINE_JUMP_PASS; CANVAS_ROUTE_CREATE_DIFF_APPLY_UNDO_PASS; CANVAS_ROUTE_RECONNECT_AMBIGUITY_DIFF_APPLY_UNDO_PASS; PACKAGE_OVERVIEW_TWO_SKILLS_PASS");
  else
    console.log("THEIA_BROWSER_ONLY_SAMPLE_IMPORT_PASS; THEIA_NATIVE_CODICONS_PASS; SKILL_STUDIO_BRAND_PASS; WEBVIEW_CUSTOM_EDITOR_NOT_REQUIRED");
}catch(error){
  if(process.env.THEIA_FAILURE_SCREENSHOT&&ws?.readyState===1){
    try{
      const screenshot=await command('Page.captureScreenshot',{format:'png'});
      await writeFile(process.env.THEIA_FAILURE_SCREENSHOT,Buffer.from(screenshot.data,'base64'));
      console.error('STUDIO_FAILURE_WORKBENCH',JSON.stringify(await evalJS(`({
        tabs:[...document.querySelectorAll('.lm-TabBar-tab')].map(tab=>({
          label:tab.textContent,rect:tab.getBoundingClientRect().toJSON()})),
        body:document.body.innerText.slice(-2500)
      })`)));
    }catch{}
  }
  throw error;
}finally{
  // Windows Edge launchers can hand off to the browser process and exit 0.
  // Close the actual browser over CDP before removing its isolated profile.
  if(ws?.readyState===1){void command("Browser.close").catch(()=>{});await sleep(700);}
  ws?.close();child.kill("SIGKILL");
  if(server?.listening){server.closeAllConnections();await new Promise(ok=>server.close(ok));}
  await rm(profile,{recursive:true,force:true,maxRetries:4,retryDelay:200});
}
// Exact-head CI note: assert YAML and Python TextMate tokens in both Theia hosts.
