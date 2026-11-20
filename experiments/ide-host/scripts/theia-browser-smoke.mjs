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
const requireCompilerWorker=process.env.THEIA_REQUIRE_COMPILER_WORKER==="1";
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
if(server&&requireCompilerWorker){
  const compilerAssets=[
    "/hostedPlugin/odango_chan_ca_skill_studio_ide_spike/dist/compiler-worker.js",
    "/hostedPlugin/odango_chan_ca_skill_studio_ide_spike/dist/skillc.wasm",
    "/hostedPlugin/odango_chan_ca_skill_studio_ide_spike/dist/wasm_exec.js"
  ];
  for(const asset of compilerAssets){
    const path=basePath+asset;
    const file=join(root,asset);
    if(!existsSync(file))throw Error("Pinned Compiler asset was not staged: "+file);
    const response=await fetch("http://127.0.0.1:"+server.address().port+path);
    if(!response.ok)throw Error("Pages-base-path Compiler asset route failed: "+path+" status="+response.status);
    const bytes=(await response.arrayBuffer()).byteLength;
    if(bytes<1000)throw Error("Pinned Compiler asset is unexpectedly small: "+path+" bytes="+bytes);
    console.log("STUDIO_THEIA_PAGES_BASE_PATH_COMPILER_ASSET",JSON.stringify({
      path,status:response.status,bytes,basePath
    }));
  }
}
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
let ws,seq=0;const pending=new Map(),exceptions=[],consoleErrors=[],markdownWorkerRequests=[],workspaceReports=[];
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
  if(data.exceptionDetails)throw Error("Chromium evaluate: "+
    (data.exceptionDetails.exception?.description??data.exceptionDetails.text));
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
    if(msg.method==="Runtime.consoleAPICalled"){
      const args=msg.params?.args??[];
      const message=args.map(x=>x.value??x.description??"").join(" ");
      if(message.includes("STUDIO_DEFAULT_WORKSPACE_OPENED")){
        const json=args.map(x=>x.value).find(x=>typeof x==="string"&&x.trim().startsWith("{"));
        if(json){
          try{workspaceReports.push(JSON.parse(json));}
          catch(error){exceptions.push("Invalid workspace identity report: "+String(error));}
        }
      }
      if(msg.params?.type==="error"){
        consoleErrors.push(message);
        const target=workerTargets.get(msg.sessionId);
        if(target)workerRuntimeErrors.push({kind:"console",target,message});
      }
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
      nativeStudioMenu:(()=>{
        const bar=document.querySelector('[id="theia:menubar"].lm-MenuBar');
        const items=[...(bar?.querySelectorAll('.lm-MenuBar-item')??[])]
          .map(node=>String(node.textContent??'').trim());
        return {
          present:items.filter(label=>label==="SKILL Studio").length===1,
          items,
          registryState:document.documentElement?.dataset?.skillStudioNativeMenu??null,
          stylesheet:Boolean(document.querySelector("#skill-studio-brand-theme")?.sheet),
          duplicateBrand:!!bar?.querySelector('.skill-studio-brand')
        };
      })(),
      widgets:document.querySelectorAll(".lm-Widget").length,
      menus:document.querySelectorAll(".p-MenuBar-item,.lm-MenuBar-item").length,
      editor:document.querySelectorAll(".monaco-editor").length,
      bodyLength:document.body?.innerText?.length||0,
      errors:document.querySelectorAll(".theia-error").length
    })`);
    if(view?.appShell&&view.widgets>4&&view.bodyLength>15&&
       view.nativeStudioMenu?.present&&
       view.nativeStudioMenu.registryState==="ready"&&
       view.nativeStudioMenu.items.includes("File")&&
       view.nativeStudioMenu.items.includes("Edit"))break;
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
  let welcome=null,welcomeFrameId=null;
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
            const button=document.querySelector('[data-action="example"]');
            const rect=button?.getBoundingClientRect();
            return {title:document.title,actions,
              visible:!!rect&&rect.width>0&&rect.height>0};
          })()`
        });
        const probe=response.result?.value;
        if(probe?.actions?.some(item=>item.action==='example')){
          welcome={...probe,frameUrl:frame.url};welcomeFrameId=frame.id;break;
        }
      }catch{/* Webview may be loading; inspect the next frame. */}
    }
    if(!welcome)await sleep(150);
  }
  console.log('STUDIO_FIRST_RUN_WELCOME_CHROMIUM',JSON.stringify(welcome));
  const actions=new Set(welcome?.actions?.map(item=>item.action)??[]);
  if(!welcome?.visible||!['newProject','openProject','example','spec','guide']
    .every(action=>actions.has(action)))
    throw Error('The first-run welcome editor did not render all project actions: '+
      JSON.stringify(welcome));
  // Open the actual Theia/Lumino native SKILL Studio top-level menu.
  const studioMenuPosition=await evalJS(`(()=>{
    const item=[...document.querySelectorAll('.lm-MenuBar-item')].find(x=>
      x.innerText.trim()==='SKILL Studio');
    if(!item)return null;
    const r=item.getBoundingClientRect();
    return {x:r.left+r.width/2,y:r.top+r.height/2};
  })()`);
  if(!studioMenuPosition)throw Error('Native SKILL Studio top-level menu is unavailable');
  const pointerHitBefore=await evalJS(`(()=>{
    const item=[...document.querySelectorAll('.lm-MenuBar-item')]
      .find(node=>node.innerText.trim()==='SKILL Studio');
    const r=item?.getBoundingClientRect();
    const x=r?.left+r?.width/2,y=r?.top+r?.height/2;
    const hit=document.elementFromPoint(x,y);
    window.__studioMenuEvents=[];
    for(const type of ['pointerdown','pointerup','mousedown','mouseup','click']){
      document.addEventListener(type,event=>{
        if(window.__studioMenuEvents.length>=30)return;
        window.__studioMenuEvents.push({
          type:event.type,trusted:event.isTrusted,
          target:String(event.target?.className??'').slice(0,160),
          text:String(event.target?.textContent??'').slice(0,100),
          x:event.clientX,y:event.clientY
        });
      },{capture:true});
    }
    return {rect:{x:r?.x,y:r?.y,width:r?.width,height:r?.height},
      targetTag:hit?.tagName??null,targetClass:String(hit?.className??''),
      targetText:String(hit?.textContent??'').slice(0,120),
      insideItem:!!(hit&&item?.contains(hit)),
      pointerEvents:item?getComputedStyle(item).pointerEvents:null};
  })()`);
  console.log('STUDIO_NATIVE_MENU_POINTER_HIT_CHROMIUM',JSON.stringify(pointerHitBefore));

  await command("Input.dispatchMouseEvent",{type:"mouseMoved",...studioMenuPosition});
  await command("Input.dispatchMouseEvent",{type:"mousePressed",...studioMenuPosition,button:"left",clickCount:1});
  await command("Input.dispatchMouseEvent",{type:"mouseReleased",...studioMenuPosition,button:"left",clickCount:1});
  await sleep(400);
  const pointerMenuItems=await evalJS(`[...document.querySelectorAll('.lm-Menu,.p-Menu')]
    .filter(x=>getComputedStyle(x).display!=='none')
    .map(x=>x.innerText).join('\\n')`);
  // Inspect the real native Lumino widget without waiting for a CDP-driven
  // popup reveal, which is unreliable when a sandboxed Webview owns focus.
  const nativeStudioMenuWidget=await evalJS(`(()=>{
    const c=window.theia.container;
    const keys=[...c._bindingDictionary._map.keys()];
    const shellKey=keys.find(k=>
      typeof k==='function'&&k.prototype?.activateWidget&&k.prototype?.addWidget);
    if(!shellKey)throw Error('Theia ApplicationShell is missing for native menu acceptance');
    const bar=c.get(shellKey).topPanel.widgets.find(w=>w.id==='theia:menubar');
    if(!bar?.menus)throw Error('Theia native MenuBarWidget is unavailable');
    const menu=bar.menus.find(item=>item.title.label==='SKILL Studio');
    if(!menu)throw Error('Studio menu is missing from native MenuBarWidget');
    return {nativeMenuBar:true,
      titles:bar.menus.map(item=>item.title.label),
      items:menu.items.map(item=>({label:item.label,type:item.type,
        enabled:item.isEnabled,submenuItems:item.submenu?.items?.map(child=>child.label)??[]})),
      fileActions:(()=> {
        const menuKey=keys.find(k=>typeof k==='function'&&
          k.prototype?.getMenuNode&&k.prototype?.registerMenuAction);
        if(!menuKey)return {new:[],open:[]};
        const registry=c.get(menuKey);
        const newMenu=registry.getMenuNode(['menubar','1_file','1_new']);
        const openMenu=registry.getMenuNode(['menubar','1_file','2_open']);
        return {
          new:(newMenu?.children??[]).map(child=>child.label),
          open:(openMenu?.children??[]).map(child=>child.label)
        };
      })(),
      menuNodeAttached:!!menu.node?.isConnected,
      activeMenu:bar.activeMenu?.title?.label??null};
  })()`);
  const pointerAfter=await evalJS(`(()=>{
    const c=window.theia?.container;
    const keys=[...(c?._bindingDictionary?._map?.keys?.()??[])];
    const shellKey=keys.find(k=>typeof k==='function'&&
      k.prototype?.activateWidget&&k.prototype?.addWidget);
    const bar=shellKey?c.get(shellKey).topPanel.widgets.find(w=>w.id==='theia:menubar'):null;
    const popup=bar?.childMenu??null;
    return {events:window.__studioMenuEvents??[],
      activeMenu:bar?.activeMenu?.title?.label??null,
      childMenu:popup?.title?.label??null,
      attached:!!popup?.node?.isConnected,
      menuNodes:[...document.querySelectorAll('.lm-Menu,.p-Menu')].map(n=>({
        className:n.className,display:getComputedStyle(n).display,
        text:n.textContent?.slice(0,300)??''}))};
  })()`);
  console.log('STUDIO_NATIVE_MENU_POINTER_AFTER_CHROMIUM',JSON.stringify(pointerAfter));
  // Regression gate: use CDP's browser-trusted pointer events against the
  // actual top-level item, and require a real attached Lumino popup. A menu
  // registry snapshot alone cannot establish user clickability.
  const trustedClick=pointerAfter.events?.some(event=>
    event.type==='click'&&event.trusted===true&&
    event.text.includes('SKILL Studio'));
  const trustedPointerDown=pointerAfter.events?.some(event=>
    event.type==='pointerdown'&&event.trusted===true&&
    event.text.includes('SKILL Studio'));
  const popupVisible=pointerAfter.attached===true&&
    pointerAfter.activeMenu==='SKILL Studio'&&
    pointerAfter.childMenu==='SKILL Studio'&&
    pointerAfter.menuNodes?.some(node=>node.display!=='none'&&
      node.text.includes('Project')&&node.text.includes('Skill')&&
      node.text.includes('Dependencies')&&node.text.includes('Authoring')&&
      node.text.includes('Tools')&&node.text.includes('Help'));
  if(!pointerHitBefore.insideItem||pointerHitBefore.pointerEvents==='none'||
     !trustedPointerDown||!trustedClick||!popupVisible)
    throw Error('Native Studio menu did not open from a trusted user pointer click: '+
      JSON.stringify({pointerHitBefore,pointerAfter}));

  console.log('STUDIO_NATIVE_TOP_MENU_CHROMIUM',
    JSON.stringify({pointerMenuItems,nativeStudioMenuWidget}));
  const studioMenuItems=nativeStudioMenuWidget?.items?.map(item=>item.label).join('\n')??'';
  for(const label of ['Project','Skill','Dependencies','Authoring','Tools','Help'])
    if(!studioMenuItems.includes(label))
      throw Error('Native Studio menu missing submenu '+label+': '+studioMenuItems);
  for(const [path,labels] of [
    ['File > New',['New Project']],
    ['File > Open',['Open Project','Open Example Project']]
  ]){
    const actual=path.endsWith('New')
      ?nativeStudioMenuWidget.fileActions?.new??[]
      :nativeStudioMenuWidget.fileActions?.open??[];
    for(const label of labels)
      if(!actual.includes(label))
        throw Error(path+' is missing '+label+': '+JSON.stringify(nativeStudioMenuWidget.fileActions));
  }
  const revealStudioSubmenu=async(label,expected)=>{
    const position=await evalJS(\`(()=>{
      const menus=[...document.querySelectorAll('.lm-Menu,.p-Menu')]
        .filter(menu=>getComputedStyle(menu).display!=='none');
      const candidates=menus.flatMap(menu=>[...menu.querySelectorAll('*')])
        .map(node=>({node,text:(node.textContent||"").replace(/\\s+/g," ").trim(),
          rect:node.getBoundingClientRect()}))
        .filter(item=>item.rect.width>0&&item.rect.height>0&&
          (item.text===\${JSON.stringify(label)}||
           item.text.startsWith(\${JSON.stringify(label)}+" ")));
      candidates.sort((a,b)=>
        a.rect.width*a.rect.height-b.rect.width*b.rect.height);
      if(!candidates.length)return {
        missing:true,
        menus:menus.map(menu=>({
          className:menu.className,text:(menu.innerText||menu.textContent||"").slice(0,500),
          html:menu.outerHTML.slice(0,1600)
        }))
      };
      const r=candidates[0].rect;
      return {x:r.left+r.width/2,y:r.top+r.height/2,text:candidates[0].text};
    })()\`);
    if(!position||position.missing)
      throw Error('Native Studio submenu item is not visible: '+label+
        ' · '+JSON.stringify(position?.menus??null));
    await command("Input.dispatchMouseEvent",{type:"mouseMoved",x:position.x,y:position.y});
    await sleep(350);
    const visibleMenus=await evalJS(\`[...document.querySelectorAll('.lm-Menu,.p-Menu')]
      .filter(node=>getComputedStyle(node).display!=='none')
      .map(node=>node.innerText||node.textContent).join('\\n')`);
    for(const expectedLabel of expected)
      if(!visibleMenus.includes(expectedLabel))
        throw Error('Native Studio '+label+' submenu is missing '+expectedLabel+': '+visibleMenus);
  };
  await revealStudioSubmenu('Project',['New Project','Open Project','Open Example Project']);
  await revealStudioSubmenu('Skill',['Check Skill','Build Skill','Inspect Dependencies']);
  await revealStudioSubmenu('Dependencies',['Add Dependency','Refresh Dependencies']);
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
  const paletteText=(registeredCommands.items??[]).join("\\n")+"\\n"+(registeredCommands.text??"");
  for(const label of [
    "SKILL Studio: Check Skill","SKILL Studio: Build Skill",
    "SKILL Studio: Add Dependency","SKILL Studio: Open Procedure Designer"
  ])if(!paletteText.includes(label))
    throw Error("Command Palette is missing "+label+": "+paletteText);
  const loadExampleRow=await evalJS(`(()=>{
    const node=[...document.querySelectorAll('.monaco-list-row')].find(x=>x.innerText.includes('SKILL Studio: Open Example Project'));
    if(!node)return null;const r=node.getBoundingClientRect();
    return {x:r.left+r.width/2,y:r.top+r.height/2,text:node.innerText};
  })()`);
  if(!loadExampleRow)
    throw Error("Theia does not expose the explicit Open Example Project command");
  // The Command Palette action exists, but run the same command through the
  // Welcome Webview to verify instant, visible acknowledgment before import.
  // The click DOM event is synchronous; the extension-host RPC is asynchronous.
  if(!welcomeFrameId)throw Error("Welcome Webview frame disappeared before import");
  const importWorld=await command("Page.createIsolatedWorld",{
    frameId:welcomeFrameId,worldName:"studio-example-import-acknowledgment",
    grantUniveralAccess:true
  });
  const importClick=await command("Runtime.evaluate",{
    contextId:importWorld.executionContextId,returnByValue:true,
    expression:`(()=>{
      const button=document.querySelector('[data-action="example"]');
      const status=document.getElementById("example-import-status");
      if(!button||!status)return {ready:false};
      const before={disabled:button.disabled,hidden:status.hidden};
      button.click();
      return {ready:true,before,
        disabled:button.disabled,loading:button.dataset.loading,
        ariaBusy:button.getAttribute("aria-busy"),
        statusHidden:status.hidden,statusText:status.textContent,
        ariaLive:status.getAttribute("aria-live"),
        otherButtonsDisabled:[...document.querySelectorAll(".actions button")]
          .every(item=>item.disabled)};
    })()`
  });
  const immediateFeedback=importClick.result?.value;
  console.log("STUDIO_EXAMPLE_IMPORT_IMMEDIATE_FEEDBACK_CHROMIUM",
    JSON.stringify(immediateFeedback));
  if(!immediateFeedback?.ready||immediateFeedback.before.disabled||
     !immediateFeedback.before.hidden||!immediateFeedback.disabled||
     immediateFeedback.loading!=="true"||
     immediateFeedback.ariaBusy!=="true"||
     immediateFeedback.statusHidden||
     immediateFeedback.ariaLive!=="polite"||
     !immediateFeedback.otherButtonsDisabled||
     !/Loading example project|正在加载示例项目/.test(immediateFeedback.statusText??""))
    throw Error("Example Project click had no immediate feedback: "+
      JSON.stringify(immediateFeedback));
  await sleep(350);
  await command("Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
  await command("Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
  // Both hosts must confirm the explicitly opened workspace and 5GC Procedure.
  let exampleLoadReady=false;
  for(let attempt=0;attempt<100;attempt++){
    exampleLoadReady=await evalJS(`[...document.querySelectorAll(
      '.theia-notification-list-item,.theia-notification-message'
    )].some(node=>{
      const message=node.innerText;
      const chineseCurrentProcedure=
        message.includes('示例项目已载入并打开工作区：skill-studio-demo/')&&
        message.includes('默认已打开')&&message.includes('Procedure')&&
        message.includes('DRAFT / NOT_QUALIFIED');
      const englishCurrentProcedure=
        message.includes('Example project opened: skill-studio-demo/')&&
        message.includes('CA-SL current Procedure is open')&&
        message.includes('DRAFT / NOT_QUALIFIED');
      return chineseCurrentProcedure||englishCurrentProcedure;
    })`);
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
      documentTitle:document.title,
      workspaceIdentity:(()=>{
        const c=window.theia?.container;
        const keys=[...(c?._bindingDictionary?._map?.keys?.()??[])];
        const key=keys.find(k=>typeof k==='function'&&
          k.name==='WorkspaceService'&&k.prototype?.open);
        if(!key)return {available:false};
        const service=c.get(key);
        const workspace=service.workspace;
        if(!workspace)return {available:false};
        const workspaceFile=typeof service.isWorkspaceFile==='function'
          ?(service.isWorkspaceFile(workspace)?workspace.resource.toString():null)
          :(String(workspace.resource?.path??'').endsWith('.theia-workspace')
            ?workspace.resource.toString():null);
        return {available:true,name:workspace.name??null,
          root:workspace.resource?.path??null,workspaceFile};
      })(),
      bodyText:document.body.innerText.slice(-2200),
      explorerText:document.querySelector('.theia-Files')?.innerText??'',
      noFolderPrompt:(document.querySelector('.theia-Files')?.innerText??'')
        .includes('You have not yet opened a folder.')||
        (document.querySelector('.theia-Files')?.innerText??'')
        .includes('You have not yet added a folder to the workspace.'),
      workspaceRootVisible:(document.querySelector('.theia-Files')?.innerText??'')
        .toLowerCase().includes('skill-studio-demo'),
      notificationText:[...document.querySelectorAll('.theia-notification-list-item,.theia-notification-message')]
        .map(x=>x.innerText).filter(Boolean).slice(0,7),
      visibleEditors:document.querySelectorAll('.monaco-editor').length,
      iframeSrcs:[...document.querySelectorAll('iframe')].map(x=>x.getAttribute('src')).slice(0,7),
      explorerItems:[...document.querySelectorAll('.theia-TreeNode,.theia-FileTreeNode')]
        .map(x=>x.innerText).filter(Boolean).slice(0,14)
    };
  })()`);
  await sleep(1200);
  const identity=await evalJS(`(async()=>{
    const c=window.theia?.container;
    if(!c)throw Error("Theia frontend container is unavailable");
    const key=[...(c._bindingDictionary?._map?.keys?.()??[])].find(k=>
      typeof k==='function'&&k.prototype?.executeCommand&&
      k.prototype?.registerCommand&&k.prototype?.getCommand);
    if(!key)throw Error("Native Theia command registry is unavailable");
    return c.get(key).executeCommand("skillStudio.internal.workspaceIdentityAcceptance");
  })()`);
  if(!identity||identity.workspaceName!=="skill-studio-demo"||
     identity.workspaceFile!==null||
     !String(identity.root??"").endsWith("/skill-studio-demo")||
     !Array.isArray(identity.workspaceFolders)||identity.workspaceFolders.length!==1||
     identity.workspaceFolders[0]!==identity.root||
     !identity.defaultProcedureExists||!identity.masProcedureExists||
     !afterImport.documentTitle.includes("skill-studio-demo")||
     afterImport.documentTitle.includes("Untitled"))
    throw Error("Example did not open as a named single-folder v1alpha5 workspace: "+
      JSON.stringify({documentTitle:afterImport.documentTitle,
        browserIdentity:afterImport.workspaceIdentity,
        ui:{workspaceRootVisible:afterImport.workspaceRootVisible,
          noFolderPrompt:afterImport.noFolderPrompt,
          explorerText:afterImport.explorerText.slice(0,500)},
        extensionIdentity:identity,
        extensionConsoleReports:workspaceReports.slice(-3)}));
  if(!identity||identity.workspaceName!=="skill-studio-demo"||
     identity.workspaceFile!==null||
     !String(identity.root??"").endsWith("/skill-studio-demo")||
     !Array.isArray(identity.workspaceFolders)||identity.workspaceFolders.length!==1||
     identity.workspaceFolders[0]!==identity.root||
     !identity.defaultProcedureExists||!identity.masProcedureExists||
     !String(identity.defaultProcedure??"").endsWith(
       "/skills/establish-pdu-session/assurance/procedure.yaml")||
     !String(identity.masProcedure??"").endsWith(
       "/skills/establish-pdu-session-mas/assurance/procedure.yaml")||
     !afterImport.documentTitle.includes("skill-studio-demo")||
     afterImport.documentTitle.includes("Untitled"))
    throw Error("Example did not open as the named single-folder v1alpha5 workspace: "+
      JSON.stringify({documentTitle:afterImport.documentTitle,
        browserIdentity:afterImport.workspaceIdentity,
        ui:{workspaceRootVisible:afterImport.workspaceRootVisible,
          noFolderPrompt:afterImport.noFolderPrompt,
          explorerText:afterImport.explorerText.slice(0,500)},
        extensionIdentity:identity,
        extensionConsoleReports:workspaceReports.slice(-3)}));

  const frameTree=await command("Page.getFrameTree");
  const frames=[];
  const walkFrames=node=>{
    if(!node)return;
    frames.push(node.frame);
    for(const child of node.childFrames??[])walkFrames(child);
  };
  walkFrames(frameTree.frameTree);
  const webviewFrames=[];
  for(const frame of frames.filter(item=>/webview/i.test(item.url??""))){
    try{
      const world=await command("Page.createIsolatedWorld",{
        frameId:frame.id,worldName:"skill-studio-v1alpha5-initial-acceptance",
        grantUniveralAccess:true
      });
      const evaluated=await command("Runtime.evaluate",{
        contextId:world.executionContextId,returnByValue:true,awaitPromise:true,
        expression:"(()=>({readyState:document.readyState,title:document.title,"+
          "bodyText:document.body?.innerText?.slice(0,1200)||'',"+
          "timing:document.querySelector('#reactFlowRoot')?.dataset.studioTiming??null,"+
          "procedureRoot:!!document.querySelector('#reactFlowRoot'),"+
          "graphNodes:document.querySelectorAll('.react-flow__node').length,"+
          "graphEdges:document.querySelectorAll('.react-flow__edge').length,"+
          "procedureValue:document.querySelector('#procedureList')?.value??'',"+
          "routeOptions:document.querySelector('#routeList')?.options?.length??0,"+
          "message:document.querySelector('#message')?.textContent??''}))()"
      });
      webviewFrames.push({frame,view:evaluated.result?.value??null});
    }catch(error){webviewFrames.push({frame,error:String(error)});}
  }
  const defaultGraphFrame=webviewFrames.find(item=>
    item.view?.procedureRoot&&item.view.procedureValue==="establish-pdu-session");
  const defaultWebviewView=defaultGraphFrame?.view??null;
  if(requireEditor&&(!defaultGraphFrame||!(defaultWebviewView?.graphNodes>0)))
    throw Error("The default CA-SL Procedure did not render: "+
      JSON.stringify({webviewFrames:webviewFrames.map(item=>({
        url:item.frame.url,error:item.error,view:item.view
      }))}));

  const evalWebviewJS=async expression=>{
    let latest=[];
    for(let attempt=0;attempt<40;attempt++){
      const tree=await command("Page.getFrameTree");
      const current=[];
      const collect=node=>{
        if(!node)return;
        current.push(node.frame);
        for(const child of node.childFrames??[])collect(child);
      };
      collect(tree.frameTree);
      await command("Runtime.enable");
      for(const frame of current.filter(item=>/webview/i.test(item.url??""))){
        try{
          const isolated=await command("Page.createIsolatedWorld",{
            frameId:frame.id,worldName:"skill-studio-v1alpha5-main-world-probe",
            grantUniveralAccess:true
          });
          const probe=await command("Runtime.evaluate",{
            contextId:isolated.executionContextId,returnByValue:true,
            expression:"Boolean(document.querySelector('#downloadPackageZip')&&"+
              "document.querySelector('#exportPackageZip')&&"+
              "document.querySelector('#reactFlowRoot')&&"+
              "document.querySelector('#procedureList')?.value==='establish-pdu-session')"
          });
          latest.push({frame:frame.id,url:frame.url,hasV1alpha5Graph:probe.result?.value===true});
          if(probe.result?.value!==true)continue;
          const contextId=defaultExecutionContexts.get(frame.id);
          if(!contextId)continue;
          return command("Runtime.evaluate",{
            contextId,returnByValue:true,awaitPromise:true,expression
          }).then(result=>result.result?.value??null);
        }catch{/* The active graph frame may be recreated while Source changes. */}
      }
      await sleep(80);
    }
    throw Error("Could not resolve the live v1alpha5 Procedure Webview main realm: "+
      JSON.stringify(latest));
  };

  console.log("STUDIO_THEIA_STAGE","v1alpha5-workbench");
  const workbenchEvidence=await runWorkbenchAcceptance({
    command,evalJS,evalWebviewJS,sleep,requireEditor,requireBrowserLsp,
    requireCompilerWorker,procedureUri:identity.defaultProcedure
  });
  // Native Python TextMate colors must be visible in both hosts, independent
  // of CA-SL semantic token/LSP analysis. Use the extension's exact Example
  // Source opener: Quick Open can inherit focus from Compiler Output.
  if(requireEditor){
    const opened=await evalJS(`(async()=>{
      const c=window.theia.container;
      const key=[...c._bindingDictionary._map.keys()].find(k=>
        typeof k==='function'&&k.prototype?.executeCommand&&
        k.prototype?.registerCommand&&k.prototype?.getCommand);
      if(!key)throw Error('Native command registry missing for Python syntax');
      return c.get(key).executeCommand(
        'skillStudio.internal.openPythonSyntaxAcceptance');
    })()`);
    if(!opened?.uri?.endsWith("/scripts/validate-subscription-request.py")||
       opened.languageId!=="python"||opened.viewColumn!==1)
      throw Error("Exact native Python Source did not open in the primary group: "+
        JSON.stringify(opened));
    let pythonTextMate=null;
    for(let attempt=0;attempt<35;attempt++){
      pythonTextMate=await evalJS(`(()=>{
        const editor=[...document.querySelectorAll('.monaco-editor')]
          .find(node=>{
            const r=node.getBoundingClientRect();
            if(r.width<=150||r.height<=100||!node.querySelector('.view-lines'))
              return false;
            for(let parent=node;parent;parent=parent.parentElement)
              if(String(parent.id??'').includes('validate-subscription-request.py'))
                return true;
            return false;
          });
        const tokens=[...(editor?.querySelectorAll('.view-lines span')??[])];
        return {matchingFile:!!editor,title:document.title,
          tokenCount:tokens.length,
          colors:[...new Set(tokens.map(node=>getComputedStyle(node).color))],
          visibleText:editor?.querySelector('.view-lines')?.innerText?.slice(0,250)??''};
      })()`);
      if(pythonTextMate.matchingFile&&pythonTextMate.colors.length>=3)break;
      await sleep(120);
    }
    console.log("STUDIO_NATIVE_PYTHON_TEXTMATE_CHROMIUM",
      JSON.stringify(pythonTextMate));
    if(!pythonTextMate?.matchingFile||!(pythonTextMate?.colors?.length>=3))
      throw Error("Native Python TextMate colors absent in the exact Source: "+
        JSON.stringify(pythonTextMate));
  }
  const packageOverviewEvidence=workbenchEvidence?.packageOverview
    ?{required:true,twoSkills:true,evidence:workbenchEvidence.packageOverview}
    :{required:false};
  const nativeMarkdownActivation=requireEditor
    ?await evalJS("(async()=>{const c=window.theia.container;"+
      "const key=[...c._bindingDictionary._map.keys()].find(k=>"+
      "typeof k==='function'&&k.prototype?.executeCommand&&"+
      "k.prototype?.registerCommand&&k.prototype?.getCommand);"+
      "if(!key)throw Error('Theia command registry missing');"+
      "return c.get(key).executeCommand('skillStudio.internal.nativeMarkdownLanguageActivationAcceptance');})()")
    :null;
  const markdownLanguageWorker=markdownWorkerRequests.filter(item=>
    item.url.toLowerCase().includes("serverworkermain.js"));
  // The native Markdown extension is a language-service dependency. Its
  // browser Worker starts lazily for operations that need it; Studio's
  // separate Preview Webview must not force a native preview editor launch.
  // Require actual activation, preserving separate reporting of worker IO.
  if(requireEditor&&!nativeMarkdownActivation?.isActive)
    throw Error("Native Markdown language extension did not activate: "+
      JSON.stringify({nativeMarkdownActivation,markdownWorkerRequests}));
  if(workerRuntimeErrors.length)
    throw Error("Native Markdown worker raised runtime errors: "+
      JSON.stringify(workerRuntimeErrors));
  console.log("STUDIO_THEIA_MARKDOWN_LANGUAGE_WORKER_CHROMIUM",
    JSON.stringify({activation:nativeMarkdownActivation,
      requests:markdownLanguageWorker,workerStartup:markdownLanguageWorker.length?"observed":"lazy",
      workerRuntimeErrors}));
  console.log("STUDIO_THEIA_STAGE","v1alpha5-package-overview");

  await evalJS("(async()=>{const c=window.theia.container;"+
    "const key=[...c._bindingDictionary._map.keys()].find(k=>"+
    "typeof k==='function'&&k.prototype?.executeCommand&&"+
    "k.prototype?.registerCommand&&k.prototype?.getCommand);"+
    "if(!key)throw Error('Native command registry missing');"+
    "await c.get(key).executeCommand('workbench.files.action.focusFilesExplorer');return true;})()");
  await sleep(400);
  const nativeExplorer=await evalJS("(()=>{const explorer=document.querySelector('.theia-Files');"+
    "const text=explorer?.innerText??'';return {visible:!!explorer,text,"+
    "noFolderPrompt:text.includes('You have not yet opened a folder.')||"+
    "text.includes('You have not yet added a folder to the workspace.'),"+
    "rootVisible:text.includes('skill-studio-demo')};})()");
  afterImport.explorerText=nativeExplorer.text;
  afterImport.noFolderPrompt=nativeExplorer.noFolderPrompt;
  afterImport.workspaceRootVisible=nativeExplorer.rootVisible;
  afterImport.explorerVisible=nativeExplorer.visible;
  if(!afterImport.statusBar||afterImport.statusBar.noWorkspace||
     !nativeExplorer.visible||nativeExplorer.noFolderPrompt)
    throw Error("The native Explorer still has no active Example project: "+
      JSON.stringify({statusBar:afterImport.statusBar,nativeExplorer}));

  const listingResponse=await fetch(url+"hostedPlugin/list.json");
  const listing=await listingResponse.text();
  const evidence={
    shellReadyMs,workbenchEvidence,packageOverviewEvidence,markdownLanguageWorker,
    view,warningDismissed,diagnostics,paletteBefore,paletteAfter,viewPosition,
    viewMenu,paletteItemPos,paletteMenuOpened,registeredCommands,loadExampleRow,
    afterImport,identity,defaultWebviewView,
    frameCount:frames.length,frameUrls:frames.map(frame=>frame.url),
    webviewFrames,defaultGraphFrame,graphEditability:workbenchEvidence?.graphEditability??null,
    extensionListStatus:listingResponse.status,extensionListPreview:listing.slice(0,500),
    extensionListPresent:listing.includes("ca-skill-studio-ide-spike"),
    requested:requests.size,notFound:[...notFound].slice(0,15),
    networkFailures:networkFailures.slice(-15),
    networkResponses:networkResponses.slice(-30),
    consoleErrors:consoleErrors.slice(0,8),exceptions:exceptions.slice(0,6)
  };
  console.log("STUDIO_THEIA_REAL_CHROMIUM",JSON.stringify(evidence));
  if(!view?.appShell||view.widgets<5||view.bodyLength<15)
    throw Error("Theia browser shell failed to start: "+JSON.stringify(evidence).slice(0,2200));
  if(!view?.nativeCodicons?.fontLoaded||view.nativeCodicons.glyphs<1)
    throw Error("Native Theia Codicon font did not render shell controls: "+
      JSON.stringify(view?.nativeCodicons).slice(0,1200));
  const nativeMenu=view?.nativeStudioMenu;
  if(!nativeMenu?.present||!nativeMenu.stylesheet||nativeMenu.duplicateBrand||
     nativeMenu.registryState!=="ready"||
     nativeMenu.items.filter(label=>label==="SKILL Studio").length!==1||
     !nativeMenu.items.includes("File")||!nativeMenu.items.includes("Edit"))
    throw Error("Studio must be exactly one native top-level menu alongside File/Edit: "+
      JSON.stringify(nativeMenu));
  await command("Emulation.setDeviceMetricsOverride",{
    width:640,height:900,deviceScaleFactor:1,mobile:false
  });
  const narrowMenu=await evalJS("(()=>{const item=[...document.querySelectorAll('.lm-MenuBar-item')]"+
    ".find(x=>x.innerText.trim()==='SKILL Studio');const r=item?.getBoundingClientRect();"+
    "return {present:!!item,visible:!!r&&r.width>0&&r.height>0,label:item?.innerText.trim()??null};})()");
  await command("Emulation.clearDeviceMetricsOverride");
  if(!narrowMenu.present||!narrowMenu.visible)
    throw Error("Native SKILL Studio menu is not visible on narrow screens: "+
      JSON.stringify(narrowMenu));
  console.log("STUDIO_STATUS_BAR_CHROMIUM",JSON.stringify(afterImport.statusBar));
  if(!afterImport.statusBar||
     !["rgb(245, 247, 251)","rgb(229, 246, 239)"].includes(afterImport.statusBar.background))
    throw Error("Theia status bar is not Studio Light: "+JSON.stringify(afterImport.statusBar));
  const importedNotification=afterImport.notificationText.some(message=>
    (message.includes("示例项目已载入并打开工作区：skill-studio-demo/")&&
     message.includes("默认已打开 CA-SL current Procedure（DRAFT / NOT_QUALIFIED）")&&
     message.includes("导入当前 CA-SL Skill 文件 14 个"))||
    (message.includes("Example project opened: skill-studio-demo/")&&
     message.includes("CA-SL current Procedure is open (DRAFT / NOT_QUALIFIED)")&&
     message.includes("Imported 14 current CA-SL Skill files")));
  if(!importedNotification||!afterImport.explorerText.includes("skills")||
     !afterImport.explorerText.includes("establish-pdu-session"))
    throw Error("Theia did not open the current CA-SL Example project: "+
      JSON.stringify({afterImport,registeredCommands}).slice(0,3500));
  if(requireEditor&&(!defaultWebviewView?.procedureRoot||
      defaultWebviewView.graphNodes<1||
      defaultWebviewView.procedureValue!=="establish-pdu-session"))
    throw Error("Default v1alpha5 Procedure CustomEditor did not render: "+
      JSON.stringify({defaultWebviewView,webviewFrames}).slice(0,3000));
  if(requireEditor&&(!workbenchEvidence?.graphEditability?.readOnly||
      !workbenchEvidence.graphEditability.sourceUnchanged))
    throw Error("v1alpha5 Procedure graph did not remain read-only: "+
      JSON.stringify(workbenchEvidence?.graphEditability).slice(0,3000));
  if(requireEditor&&(!workbenchEvidence?.phaseEvidence?.visible||
      !workbenchEvidence.phaseEvidence.sourceOnly||
      !workbenchEvidence?.packageOverview?.skills||
      workbenchEvidence.packageOverview.skills.length!==2))
    throw Error("v1alpha5 Inspector or Package Overview acceptance did not complete: "+
      JSON.stringify({phaseEvidence:workbenchEvidence?.phaseEvidence,
        packageOverview:workbenchEvidence?.packageOverview}).slice(0,3000));

  const highlightingSource=await evalJS(`(async()=>{
    const c=window.theia.container;
    const key=[...c._bindingDictionary._map.keys()].find(k=>
      typeof k==='function'&&k.prototype?.executeCommand&&
      k.prototype?.registerCommand&&k.prototype?.getCommand);
    if(!key)throw Error("Native Theia command registry is unavailable");
    return c.get(key).executeCommand(
      "skillStudio.internal.openProcedureSourceForHighlightDiagnostics",
      ${JSON.stringify(identity.defaultProcedure)}
    );
  })()`);
  if(!highlightingSource?.uri?.endsWith("/assurance/procedure.yaml")||
     highlightingSource.languageId!=="yaml"||highlightingSource.viewColumn!==1)
    throw Error("The exact Procedure did not open as native YAML Source for highlighting: "+
      JSON.stringify(highlightingSource));
  let semanticTokenState=null;
  for(let attempt=0;attempt<50;attempt++){
    semanticTokenState=await evalJS(`(async()=>{
      const c=window.theia.container;
      const key=[...c._bindingDictionary._map.keys()].find(k=>
        typeof k==='function'&&k.prototype?.executeCommand&&
        k.prototype?.registerCommand&&k.prototype?.getCommand);
      return c.get(key).executeCommand("skillStudio.internal.semanticTokenDiagnostics");
    })()`);
    if(semanticTokenState?.lastUri===highlightingSource.uri&&
       semanticTokenState.lastTokenCount>0&&semanticTokenState.renderedTokenCount>0)break;
    await sleep(100);
  }
  const activationDiagnostics=await evalJS(`(async()=>{
    const c=window.theia.container;
    const key=[...c._bindingDictionary._map.keys()].find(k=>
      typeof k==='function'&&k.prototype?.executeCommand&&
      k.prototype?.registerCommand&&k.prototype?.getCommand);
    if(!key)throw Error("Native Theia command registry is unavailable");
    return c.get(key).executeCommand("skillStudio.showActivationDiagnostics");
  })()`);
  if(!activationDiagnostics||activationDiagnostics.failures?.length||
     activationDiagnostics.components?.Workbench!=="READY"||
     activationDiagnostics.components?.["Package Explorer"]!=="READY"||
     activationDiagnostics.packageInventory?.packageCount!==2||
     activationDiagnostics.packageInventory?.state!=="ready"||
     !/^[0-9a-f]{40}$/.test(activationDiagnostics.buildId??"")||
     activationDiagnostics.welcomeCommandRegistered!==true||
     activationDiagnostics.welcome?.createWebviewPanelAvailable!==true||
     activationDiagnostics.semanticTokens?.registered!==true||
     activationDiagnostics.semanticTokens?.renderer!=="theia-text-editor-decoration"||
     activationDiagnostics.semanticTokens?.lastUri!==highlightingSource.uri||
     !(activationDiagnostics.semanticTokens?.lastTokenCount>0)||
     !(activationDiagnostics.semanticTokens?.renderedTokenCount>0)||
     activationDiagnostics.semanticTokens?.renderError)
    throw Error("The primary extension did not report healthy activation, Welcome and semantic highlighting: "+
      JSON.stringify(activationDiagnostics).slice(0,3500));
  console.log("STUDIO_ACTIVATION_DIAGNOSTICS_CHROMIUM",JSON.stringify({
    buildId:activationDiagnostics.buildId,
    components:activationDiagnostics.components,
    welcome:activationDiagnostics.welcome,
    highlightingSource,
    semanticTokens:activationDiagnostics.semanticTokens,
    packageInventory:activationDiagnostics.packageInventory
  }));

  // A restored project must still be able to reopen Welcome on demand. The
  // page is not auto-opened over a user workspace, but its command is always live.
  await evalJS(`(async()=>{
    const c=window.theia.container;
    const key=[...c._bindingDictionary._map.keys()].find(k=>
      typeof k==='function'&&k.prototype?.executeCommand&&
      k.prototype?.registerCommand&&k.prototype?.getCommand);
    return c.get(key).executeCommand("skillStudio.showWelcome");
  })()`);
  let reopenedWelcome=null;
  for(let attempt=0;attempt<40&&!reopenedWelcome;attempt++){
    const currentTree=await command("Page.getFrameTree");
    const currentFrames=[];
    const collect=node=>{
      if(!node)return;
      currentFrames.push(node.frame);
      for(const child of node.childFrames??[])collect(child);
    };
    collect(currentTree.frameTree);
    for(const frame of currentFrames.filter(item=>/webview/i.test(item.url??""))){
      try{
        const world=await command("Page.createIsolatedWorld",{
          frameId:frame.id,worldName:"skill-studio-restored-welcome-probe",
          grantUniveralAccess:true
        });
        const body=await command("Runtime.evaluate",{
          contextId:world.executionContextId,returnByValue:true,
          expression:"document.body?.innerText??''"
        });
        const content=String(body.result?.value??"");
        if(content.includes("Welcome to SKILL Studio")||
           content.includes("欢迎使用 SKILL Studio")){
          reopenedWelcome={frameId:frame.id,url:frame.url,text:content.slice(0,400)};
          break;
        }
      }catch{}
    }
    if(!reopenedWelcome)await sleep(100);
  }
  if(!reopenedWelcome)
    throw Error("The explicit Welcome command did not reopen its editor in an existing workspace");
  const reopenedWelcomeDiagnostics=await evalJS(`(async()=>{
    const c=window.theia.container;
    const key=[...c._bindingDictionary._map.keys()].find(k=>
      typeof k==='function'&&k.prototype?.executeCommand&&
      k.prototype?.registerCommand&&k.prototype?.getCommand);
    return c.get(key).executeCommand("skillStudio.showActivationDiagnostics");
  })()`);
  if(reopenedWelcomeDiagnostics?.welcome?.panelOpen!==true||
     reopenedWelcomeDiagnostics?.welcome?.lastError)
    throw Error("Welcome opened but its live diagnostics do not report a healthy panel: "+
      JSON.stringify(reopenedWelcomeDiagnostics?.welcome));
  console.log("STUDIO_WELCOME_REOPEN_CHROMIUM",JSON.stringify({
    ...reopenedWelcome,welcome:reopenedWelcomeDiagnostics.welcome
  }));

  // Keep the same Chromium user-data directory and OPFS workspace, then reload
  // the page. This is the persistent-profile regression the fresh-profile test
  // previously missed.
  await command("Page.reload",{ignoreCache:false});
  let persistedIdentity=null;
  for(let attempt=0;attempt<120&&!persistedIdentity;attempt++){
    try{
      persistedIdentity=await evalJS(`(async()=>{
        const c=window.theia?.container;
        if(!c)return null;
        const key=[...(c._bindingDictionary?._map?.keys?.()??[])].find(k=>
          typeof k==='function'&&k.prototype?.executeCommand&&
          k.prototype?.registerCommand&&k.prototype?.getCommand);
        if(!key)return null;
        return c.get(key).executeCommand("skillStudio.internal.workspaceIdentityAcceptance");
      })()`);
      if(persistedIdentity?.workspaceName!=="skill-studio-demo")persistedIdentity=null;
    }catch{persistedIdentity=null;}
    if(!persistedIdentity)await sleep(250);
  }
  if(!persistedIdentity||persistedIdentity.workspaceFile!==null||
     !String(persistedIdentity.root??"").endsWith("/skill-studio-demo")||
     persistedIdentity.workspaceFolders?.length!==1)
    throw Error("The existing Example workspace was not restored after a same-profile reload: "+
      JSON.stringify(persistedIdentity));
  // Workspace identity becomes visible before OPFS findFiles and Package
  // inventory finish. Wait for a settled restored scan rather than sampling
  // the transient "loading / 0 Packages" state immediately after activation.
  // This is a wait for readiness, NOT a new Example import or storage reset.
  let persistedEvidence=null;
  for(let attempt=0;attempt<90;attempt++){
    persistedEvidence=await evalJS(`(async()=>{
      const c=window.theia.container;
      const key=[...c._bindingDictionary._map.keys()].find(k=>
        typeof k==='function'&&k.prototype?.executeCommand&&
        k.prototype?.registerCommand&&k.prototype?.getCommand);
      const registry=c.get(key);
      const activation=await registry.executeCommand("skillStudio.showActivationDiagnostics");
      const inventoryState=activation?.packageInventory?.state;
      const inventory=inventoryState==="loading"||inventoryState===null
        ?null:await registry.executeCommand("skillStudio.refreshPackages");
      const semantic=await registry.executeCommand("skillStudio.internal.semanticTokenDiagnostics");
      return {inventory,activation,semantic};
    })()`);
    const inventory=persistedEvidence?.inventory??persistedEvidence?.activation?.packageInventory;
    if(inventory?.state==="ready"&&inventory?.packages?.length===2&&
       persistedEvidence.activation?.workbenchReady===true&&
       persistedEvidence.semantic?.registered===true)break;
    await sleep(200);
  }
  // Normalize the ready inventory captured via activation diagnostics so the
  // following gate can inspect the same evidence shape on both Theia hosts.
  if(!persistedEvidence?.inventory&&persistedEvidence?.activation?.packageInventory)
    persistedEvidence.inventory=persistedEvidence.activation.packageInventory;
  if(persistedEvidence.inventory?.state!=="ready"||
     persistedEvidence.inventory?.packages?.length!==2||
     persistedEvidence.activation?.failures?.length||
     persistedEvidence.activation?.workbenchReady!==true||
     persistedEvidence.semantic?.registered!==true)
    throw Error("The persisted workspace lost Package, Workbench or semantic highlighting after reload: "+
      JSON.stringify(persistedEvidence).slice(0,3500));
  // Simulate a browser profile upgraded from the retired Example. The
  // fixture changes only the dedicated built-in Example root, never a user
  // workspace. The native Project menu must remain the recovery path.
  const seededLegacy=await evalJS("(()=>{const c=window.theia.container;const k=[...c._bindingDictionary._map.keys()].find(x=>typeof x==='function'&&x.prototype?.executeCommand&&x.prototype?.registerCommand&&x.prototype?.getCommand);return c.get(k).executeCommand('skillStudio.internal.seedLegacyExampleAcceptance')})()");
  if(seededLegacy?.seededApiVersion!=="connectionagent.io/v1alpha1")
    throw Error("Could not seed the previous Example profile: "+JSON.stringify(seededLegacy));
  await command("Page.reload",{ignoreCache:false});
  let legacyIdentity=null;
  for(let attempt=0;attempt<120;attempt++){
    try{
      legacyIdentity=await evalJS("(()=>{const c=window.theia?.container;if(!c)return null;const k=[...(c._bindingDictionary?._map?.keys?.()??[])].find(x=>typeof x==='function'&&x.prototype?.executeCommand&&x.prototype?.registerCommand&&x.prototype?.getCommand);return k?c.get(k).executeCommand('skillStudio.internal.workspaceIdentityAcceptance'):null})()");
      if(legacyIdentity?.contractApiVersion==="connectionagent.io/v1alpha1"&&
         legacyIdentity?.procedureApiVersion==="connectionagent.io/v1alpha1")break;
    }catch{legacyIdentity=null;}
    await sleep(250);
  }
  if(legacyIdentity?.workspaceName!=="skill-studio-demo"||
     legacyIdentity.contractApiVersion!=="connectionagent.io/v1alpha1"||
     legacyIdentity.procedureApiVersion!=="connectionagent.io/v1alpha1"||
     !legacyIdentity.libExists||!legacyIdentity.outputExists)
    throw Error("The previous Example profile was not restored as a legacy fixture: "+
      JSON.stringify(legacyIdentity));
  const recoveryMenu=await evalJS("(()=>{const item=[...document.querySelectorAll('.lm-MenuBar-item')].find(x=>x.innerText.trim()==='SKILL Studio');if(!item)return null;const r=item.getBoundingClientRect();return {visible:r.width>0&&r.height>0,label:item.innerText.trim()}})()");
  if(!recoveryMenu?.visible)
    throw Error("SKILL Studio recovery entry disappeared on a pre-existing Example profile");
  await revealStudioSubmenu("Project",["Open Example Project"]);
  const openExamplePosition=await evalJS("(()=>{const item=[...document.querySelectorAll('.lm-Menu-item')].find(x=>x.innerText.trim()==='Open Example Project'||x.innerText.trim()==='打开示例项目');if(!item)return null;const r=item.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,label:item.innerText.trim()}})()");
  if(!openExamplePosition)
    throw Error("Project menu lost its explicit Open Example Project action");
  await command("Input.dispatchMouseEvent",{type:"mouseMoved",x:openExamplePosition.x,y:openExamplePosition.y});
  await command("Input.dispatchMouseEvent",{type:"mousePressed",x:openExamplePosition.x,y:openExamplePosition.y,button:"left",clickCount:1});
  await command("Input.dispatchMouseEvent",{type:"mouseReleased",x:openExamplePosition.x,y:openExamplePosition.y,button:"left",clickCount:1});
  const waitForDialogButton=async labels=>{
    for(let attempt=0;attempt<80;attempt++){
      const position=await evalJS("(()=>{const labels="+JSON.stringify(labels)+";const button=[...document.querySelectorAll('button')].find(item=>{const r=item.getBoundingClientRect();return r.width>0&&r.height>0&&labels.includes(item.innerText.trim())});if(!button)return null;const r=button.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,label:button.innerText.trim()}})()");
      if(position)return position;
      await sleep(100);
    }
    throw Error("The existing Example replacement confirmation did not appear: "+
      (await evalJS("document.body.innerText.slice(-900)")));
  };
  const cancelPosition=await waitForDialogButton(["Cancel","取消"]);
  await command("Input.dispatchMouseEvent",{type:"mouseMoved",x:cancelPosition.x,y:cancelPosition.y});
  await command("Input.dispatchMouseEvent",{type:"mousePressed",x:cancelPosition.x,y:cancelPosition.y,button:"left",clickCount:1});
  await command("Input.dispatchMouseEvent",{type:"mouseReleased",x:cancelPosition.x,y:cancelPosition.y,button:"left",clickCount:1});
  let afterCancel=null;
  for(let attempt=0;attempt<30;attempt++){
    afterCancel=await evalJS("(()=>{const c=window.theia.container;const k=[...c._bindingDictionary._map.keys()].find(x=>typeof x==='function'&&x.prototype?.executeCommand&&x.prototype?.registerCommand&&x.prototype?.getCommand);return c.get(k).executeCommand('skillStudio.internal.workspaceIdentityAcceptance')})()");
    if(afterCancel?.contractApiVersion==="connectionagent.io/v1alpha1")break;
    await sleep(100);
  }
  if(afterCancel?.contractApiVersion!=="connectionagent.io/v1alpha1"||
     afterCancel?.procedureApiVersion!=="connectionagent.io/v1alpha1"||
     !afterCancel.libExists||!afterCancel.outputExists)
    throw Error("Cancel changed the old Example profile; replacement must be explicit: "+
      JSON.stringify(afterCancel));
  // Re-open through the same native menu and explicitly accept full Example
  // replacement. This must remove retired folders and restore only v1alpha5.
  await revealStudioSubmenu("Project",["Open Example Project"]);
  const retryPosition=await evalJS("(()=>{const item=[...document.querySelectorAll('.lm-Menu-item')].find(x=>x.innerText.trim()==='Open Example Project'||x.innerText.trim()==='打开示例项目');if(!item)return null;const r=item.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()");
  if(!retryPosition)throw Error("Open Example Project disappeared after cancelling replacement");
  await command("Input.dispatchMouseEvent",{type:"mouseMoved",...retryPosition});
  await command("Input.dispatchMouseEvent",{type:"mousePressed",...retryPosition,button:"left",clickCount:1});
  await command("Input.dispatchMouseEvent",{type:"mouseReleased",...retryPosition,button:"left",clickCount:1});
  const replacePosition=await waitForDialogButton(["Replace Example","替换 Example"]);
  await command("Input.dispatchMouseEvent",{type:"mouseMoved",x:replacePosition.x,y:replacePosition.y});
  await command("Input.dispatchMouseEvent",{type:"mousePressed",x:replacePosition.x,y:replacePosition.y,button:"left",clickCount:1});
  await command("Input.dispatchMouseEvent",{type:"mouseReleased",x:replacePosition.x,y:replacePosition.y,button:"left",clickCount:1});
  let upgradedIdentity=null,upgradedEvidence=null;
  for(let attempt=0;attempt<120;attempt++){
    try{
      upgradedIdentity=await evalJS("(()=>{const c=window.theia?.container;if(!c)return null;const k=[...(c._bindingDictionary?._map?.keys?.()??[])].find(x=>typeof x==='function'&&x.prototype?.executeCommand&&x.prototype?.registerCommand&&x.prototype?.getCommand);return k?c.get(k).executeCommand('skillStudio.internal.workspaceIdentityAcceptance'):null})()");
      if(upgradedIdentity?.contractApiVersion==="connectionagent.io/v1alpha5"&&
         upgradedIdentity?.procedureApiVersion==="connectionagent.io/v1alpha5"){
        upgradedEvidence=await evalJS("(()=>{const c=window.theia.container;const k=[...c._bindingDictionary._map.keys()].find(x=>typeof x==='function'&&x.prototype?.executeCommand&&x.prototype?.registerCommand&&x.prototype?.getCommand);return c.get(k).executeCommand('skillStudio.showActivationDiagnostics')})()");
        if(upgradedEvidence?.packageInventory?.state==="ready"&&
           upgradedEvidence.packageInventory.packages?.length===2)break;
      }
    }catch{upgradedIdentity=null;}
    await sleep(250);
  }
  if(upgradedIdentity?.contractApiVersion!=="connectionagent.io/v1alpha5"||
     upgradedIdentity?.procedureApiVersion!=="connectionagent.io/v1alpha5"||
     upgradedIdentity?.libExists||upgradedIdentity?.outputExists||
     upgradedIdentity?.workspaceFolders?.length!==1||
     upgradedEvidence?.packageInventory?.packages?.length!==2||
     upgradedEvidence?.failures?.length)
    throw Error("Explicit Example replacement did not restore a clean current v1alpha5 project: "+
      JSON.stringify({identity:upgradedIdentity,activation:upgradedEvidence}).slice(0,3200));
  console.log("STUDIO_LEGACY_EXAMPLE_REPLACEMENT_CHROMIUM_PASS",JSON.stringify({
    menu:recoveryMenu,legacyVersion:legacyIdentity.contractApiVersion,
    cancelPreserved:afterCancel.contractApiVersion,
    upgradedVersion:upgradedIdentity.contractApiVersion,
    libRemoved:!upgradedIdentity.libExists,outputRemoved:!upgradedIdentity.outputExists,
    packages:upgradedEvidence.packageInventory.packages.length
  }));
  console.log("STUDIO_PERSISTED_WORKSPACE_RELOAD_PASS",JSON.stringify({
    workspace:persistedIdentity.workspaceName,
    packages:persistedEvidence.inventory.packages.map(item=>item.name),
    activation:persistedEvidence.activation.components,
    semanticRegistered:persistedEvidence.semantic.registered
  }));
  console.log("STUDIO_V1ALPHA5_ONLY_ACCEPTANCE",JSON.stringify({
    procedure:identity.defaultProcedure,masProcedure:identity.masProcedure,
    packageCount:workbenchEvidence?.packageOverview?.skills?.length??0,
    graphEditability:workbenchEvidence?.graphEditability??null,
    phaseEvidence:workbenchEvidence?.phaseEvidence??null,
    languageServiceStatus:workbenchEvidence?.languageServiceStatus??null
  }));
  if(requireEditor)
    console.log("THEIA_BROWSER_HOST_V1ALPHA5_ACCEPTANCE_PASS");
  else
    console.log("THEIA_BROWSER_ONLY_V1ALPHA5_ACCEPTANCE_PASS");
}catch(error){
  if(process.env.THEIA_FAILURE_SCREENSHOT&&ws?.readyState===1){
    try{
      const screenshot=await command("Page.captureScreenshot",{format:"png"});
      await writeFile(process.env.THEIA_FAILURE_SCREENSHOT,Buffer.from(screenshot.data,"base64"));
      console.error("STUDIO_FAILURE_WORKBENCH",JSON.stringify(await evalJS(`({
        tabs:[...document.querySelectorAll(".lm-TabBar-tab")].map(tab=>({
          label:tab.textContent,rect:tab.getBoundingClientRect().toJSON()})),
        body:document.body.innerText.slice(-2500)
      })`)));
    }catch{}
  }
  throw error;
}finally{
  if(ws?.readyState===1){void command("Browser.close").catch(()=>{});await sleep(700);}
  ws?.close();child.kill("SIGKILL");
  if(server?.listening){server.closeAllConnections();await new Promise(ok=>server.close(ok));}
  await rm(profile,{recursive:true,force:true,maxRetries:4,retryDelay:200});
}
// Exact-head CI note: assert YAML and Python TextMate tokens in both Theia hosts.

