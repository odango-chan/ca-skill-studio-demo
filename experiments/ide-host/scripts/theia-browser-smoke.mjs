import {runPackageOverviewAcceptance,runWorkbenchAcceptance,assertSourceVisualPair} from "./workbench-browser-acceptance.mjs";
// Real Chromium smoke for both Theia browser-only static preview and the
// normal backend-backed browser host. Static mode uses an explicitly isolated
// same-origin demo-only webview adapter; backend mode uses Theia's normal host.
import {createServer} from "node:http";
import {createHash} from "node:crypto";
import {zipPackage} from "../../../site/zip.mjs";
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
  // Non-failing diagnostic of the real browser-side GitHub Release download
  // path. A CI origin is not the production Pages origin, and CORS failure must
  // remain BLOCKED rather than silently falling back to an unpinned URL.
  const releaseBrowserProbe=await evalJS(`(async()=>{
    const tagUrl='https://api.github.com/repos/odango-chan/ca-client-tools/releases/tags/v1.1.0';
    const expected='sha256:cbd8fad939844cda5474f33f18d3cdc015c69dd8c1dc3908e84bd5273ce6e71b';
    try{
      const response=await fetch(tagUrl,{mode:'cors',credentials:'omit',
        headers:{Accept:'application/vnd.github+json'},
        signal:AbortSignal.timeout(8500)});
      if(!response.ok)return {state:'BLOCKED',phase:'release',http:response.status};
      const info=await response.json();
      const asset=info.assets?.find(x=>x.name==='ca-client-tools_interface_1.1.0.zip');
      if(info.tag_name!=='v1.1.0'||!asset?.url)
        return {state:'BLOCKED',phase:'exact-release-asset'};
      const binary=await fetch(asset.url,{mode:'cors',credentials:'omit',
        headers:{Accept:'application/octet-stream'},
        signal:AbortSignal.timeout(8500)});
      const contentType=binary.headers.get('content-type')||'';
      if(!binary.ok||contentType.includes('json'))
        return {state:'BLOCKED',phase:'binary-response',
          http:binary.status,contentType};
      const bytes=new Uint8Array(await binary.arrayBuffer());
      const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
      const digest='sha256:'+Array.from(hash,b=>b.toString(16).padStart(2,'0')).join('');
      return {state:bytes.length===asset.size&&digest===expected?'PASS':'BLOCKED',
        phase:'archive-digest',bytes:bytes.length,assetBytes:asset.size,
        sha256Match:digest===expected,contentType};
    }catch(error){
      return {state:'BLOCKED',phase:'browser-network-or-CORS',
        reason:String(error?.message??error)};
    }
  })()`);
  console.log("STUDIO_INTERFACE_RELEASE_BROWSER_CORS_PROBE",JSON.stringify(releaseBrowserProbe));
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
    const active=await evalJS(`(()=>{
      const c=window.theia.container;
      const keys=[...c._bindingDictionary._map.keys()];
      const key=keys.find(k=>typeof k==='function'&&
        k.prototype?.activateWidget&&k.prototype?.addWidget);
      const bar=key?c.get(key).topPanel.widgets.find(w=>w.id==='theia:menubar'):null;
      return {active:bar?.activeMenu?.title?.label??null};
    })()`);
    if(active?.active!=='SKILL Studio'){
      const top=await evalJS(`(()=>{
        const item=[...document.querySelectorAll('.lm-MenuBar-itemLabel')]
          .find(node=>(node.textContent||'').trim()==='SKILL Studio');
        const r=item?.getBoundingClientRect();
        return r&&r.width>0&&r.height>0?{x:r.left+r.width/2,y:r.top+r.height/2}:null;
      })()`);
      if(!top)throw Error('Native SKILL Studio top-level menu is not visible');
      await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:top.x,y:top.y});
      await command('Input.dispatchMouseEvent',{type:'mousePressed',x:top.x,y:top.y,button:'left',clickCount:1});
      await command('Input.dispatchMouseEvent',{type:'mouseReleased',x:top.x,y:top.y,button:'left',clickCount:1});
      await sleep(250);
    }
    const position=await evalJS(`(()=>{
      const label=${JSON.stringify(label)};
      const popups=[...document.querySelectorAll('.lm-Menu,.p-Menu')]
        .filter(menu=>getComputedStyle(menu).display!=='none');
      const items=popups.flatMap(menu=>[...menu.querySelectorAll('.lm-Menu-item,.p-Menu-item')])
        .filter(item=>{
          const text=(item.querySelector('.lm-Menu-itemLabel,.p-Menu-itemLabel')?.textContent||
            item.textContent||'').replace(/\\s+/g,' ').trim();
          const r=item.getBoundingClientRect();
          return text===label&&r.width>0&&r.height>0;
        });
      if(!items.length)return {missing:true,menus:popups.map(menu=>({
        text:(menu.innerText||menu.textContent||'').slice(0,700),
        html:menu.outerHTML.slice(0,2200)
      }))};
      const r=items[0].getBoundingClientRect();
      return {x:r.left+r.width/2,y:r.top+r.height/2};
    })()`);
    if(!position||position.missing)
      throw Error('Native Studio submenu item is not visible: '+label+' · '+
        JSON.stringify(position?.menus??null));
    await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:position.x,y:position.y});
    await sleep(350);
    const visibleMenus=await evalJS(`[...document.querySelectorAll('.lm-Menu,.p-Menu')]
      .filter(node=>getComputedStyle(node).display!=='none')
      .map(node=>node.innerText||node.textContent).join(' | ')`);
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
  const studioCommand=(id,...args)=>evalJS(`(() => {
    const c=window.theia.container;
    const key=[...c._bindingDictionary._map.keys()].find(k=>
      typeof k==='function'&&k.prototype?.executeCommand&&k.prototype?.getCommand);
    return c.get(key).executeCommand(${JSON.stringify(id)},...${JSON.stringify(args)});
  })()`);
  const readWorkspaceMode=()=>evalJS(`(() => {
    const nav=document.getElementById('skill-studio-workspace-mode');
    return { mode:nav?.querySelector('[aria-pressed="true"]')?.textContent,
      switching:!!nav?.querySelector('button:disabled'),
      groups:window.__skillStudioFixedEditorLayout?.().tabBarCount };
  })()`);
  const switchWorkspaceMode=async label=>{
    const clicked=await evalJS(`(() => {
      const button=[...document.querySelectorAll('#skill-studio-workspace-mode button')]
        .find(item=>item.textContent===${JSON.stringify(label)});
      if(!button || !button.getClientRects().length) return false;
      button.click();
      return true;
    })()`);
    if(!clicked)throw Error("Missing top-level Studio mode control: "+label);
    for(let attempt=0;attempt<100;attempt++){
      const state=await readWorkspaceMode();
      if(state?.mode===label && !state.switching && state.groups===1)return;
      await sleep(100);
    }
    throw Error("Mode switch did not preserve one editor group: "+
      JSON.stringify({label,actual:await readWorkspaceMode()}));
  };
  if(requireEditor){
    let initialMode;
    for(let attempt=0;attempt<100;attempt++){
      initialMode=await readWorkspaceMode();
      if(initialMode?.mode==='AI Workbench' && initialMode.groups===1)break;
      await sleep(100);
    }
    if(initialMode?.mode!=='AI Workbench' || initialMode.groups!==1)
      throw Error("Fresh Studio profile did not open AI Workbench: "+JSON.stringify(initialMode));
    await switchWorkspaceMode('Console');
    console.log("STUDIO_WORKSPACE_MODE_DEFAULT_CHROMIUM_PASS");
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
       "/skills/establish-pdu-session-mas/assurance/procedure.yaml")||
     !String(identity.masProcedure??"").endsWith(
       "/skills/modify-pdu-session-mas/assurance/procedure.yaml")||
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

  if(identity.exampleInterface?.status!=="READY"||
     identity.exampleInterface?.imported!==true||
     identity.exampleInterface?.lockedDependencyCount!==3||
     identity.exampleInterface?.availableCompletionCallables<11||
     identity.exampleInterface?.contextReadHint!==true||
     identity.exampleInterface?.ownerToolCatalog?.available!==true||
     !["SC.CREATE_SM_CONTEXT","UPN.MODIFY_QOS_DELTA","SC.RELEASE_SM_CONTEXT_C"]
       .every(id=>identity.exampleInterface.ownerToolCatalog.operationIds.includes(id))||
     identity.exampleInterface?.qualification!=="AUTH_NOT_CHECKED")
    throw Error("Default Example did not load its exact Client, Host-context and Owner ToolCatalog snapshots: "+
      JSON.stringify(identity.exampleInterface));
  console.log("STUDIO_EXAMPLE_DEPENDENCIES_READY_CHROMIUM",JSON.stringify(
    identity.exampleInterface
  ));
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
    item.view?.procedureRoot&&item.view.procedureValue==="establish-pdu-session-mas");
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
              "document.querySelector('#procedureList')?.value==='establish-pdu-session-mas')"
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
    let opened=null,pythonOpenError=null,pythonOpenAttempts=0;
    for(;pythonOpenAttempts<4;pythonOpenAttempts++){
      try{
        opened=await evalJS(`(async()=>{
          const c=window.theia.container;
          const key=[...c._bindingDictionary._map.keys()].find(k=>
            typeof k==='function'&&k.prototype?.executeCommand&&
            k.prototype?.registerCommand&&k.prototype?.getCommand);
          if(!key)throw Error('Native command registry missing for Python syntax');
          return c.get(key).executeCommand(
            'skillStudio.internal.openPythonSyntaxAcceptance');
        })()`);
        if(opened?.uri)break;
      }catch(error){pythonOpenError=String(error?.message??error);}
      await sleep(250);
    }
    if(!opened?.uri?.endsWith("/browser-acceptance/validate-subscription-request.py")||
       opened.languageId!=="python"||opened.viewColumn!==1)
      throw Error("Exact native Python Source did not open in the primary group after "+
        pythonOpenAttempts+" attempts: "+JSON.stringify({opened,pythonOpenError}));
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
    ?{required:true,threeSkills:true,evidence:workbenchEvidence.packageOverview}
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
     message.includes("导入当前 CA-SL Skill 文件 18 个"))||
    (message.includes("Example project opened: skill-studio-demo/")&&
     message.includes("CA-SL current Procedure is open (DRAFT / NOT_QUALIFIED)")&&
     message.includes("Imported 18 current CA-SL Skill files")));
  if(!importedNotification||!afterImport.explorerText.includes("skills")||
     !afterImport.explorerText.includes("establish-pdu-session-mas"))
    throw Error("Theia did not open the current CA-SL Example project: "+
      JSON.stringify({afterImport,registeredCommands}).slice(0,3500));
  if(requireEditor&&(!defaultWebviewView?.procedureRoot||
      defaultWebviewView.graphNodes<1||
      defaultWebviewView.procedureValue!=="establish-pdu-session-mas"))
    throw Error("Default v1alpha5 Procedure CustomEditor did not render: "+
      JSON.stringify({defaultWebviewView,webviewFrames}).slice(0,3000));
  if(requireEditor&&(!workbenchEvidence?.graphEditability?.readOnly||
      !workbenchEvidence.graphEditability.sourceUnchanged))
    throw Error("v1alpha5 Procedure graph did not remain read-only: "+
      JSON.stringify(workbenchEvidence?.graphEditability).slice(0,3000));
  if(requireEditor&&(!workbenchEvidence?.phaseEvidence?.visible||
      !workbenchEvidence.phaseEvidence.sourceOnly||
      !workbenchEvidence?.packageOverview?.skills||
      workbenchEvidence.packageOverview.skills.length!==3))
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
     activationDiagnostics.packageInventory?.packageCount!==3||
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
    if(inventory?.state==="ready"&&inventory?.packages?.length===3&&
       persistedEvidence.activation?.workbenchReady===true&&
       persistedEvidence.semantic?.registered===true)break;
    await sleep(200);
  }
  // Normalize the ready inventory captured via activation diagnostics so the
  // following gate can inspect the same evidence shape on both Theia hosts.
  if(!persistedEvidence?.inventory&&persistedEvidence?.activation?.packageInventory)
    persistedEvidence.inventory=persistedEvidence.activation.packageInventory;
  if(persistedEvidence.inventory?.state!=="ready"||
     persistedEvidence.inventory?.packages?.length!==3||
     persistedEvidence.activation?.failures?.length||
     persistedEvidence.activation?.workbenchReady!==true||
     persistedEvidence.semantic?.registered!==true)
    throw Error("The persisted workspace lost Package, Workbench or semantic highlighting after reload: "+
      JSON.stringify(persistedEvidence).slice(0,3500));
  // Simulate a browser profile upgraded from the retired Example. The
  // fixture changes only the dedicated built-in Example root, never a user
  // workspace. The native Project menu must remain the recovery path.
  const seededLegacy=await evalJS("(()=>{const c=window.theia.container;const k=[...c._bindingDictionary._map.keys()].find(x=>typeof x==='function'&&x.prototype?.executeCommand&&x.prototype?.registerCommand&&x.prototype?.getCommand);return c.get(k).executeCommand('skillStudio.internal.workspaceIdentityAcceptance',{seedLegacyExample:true})})()");
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
  // A stale built-in Example must not look like a healthy Package with an
  // empty Problems view just because its old Procedure cannot be projected.
  // Assert the real LSP diagnostics reach both the native editor markers and
  // the Problems tree before offering the explicit replacement action.
  let legacyDiagnostics=null,legacyPackageStatus=null,legacySourceDiagnostic=null,
    legacyReadyOtherPackage=null;
  for(let attempt=0;attempt<90;attempt++){
    try{
      legacyDiagnostics=await evalJS("(async()=>{const c=window.theia?.container;if(!c)return null;const k=[...(c._bindingDictionary?._map?.keys?.()??[])].find(x=>typeof x==='function'&&x.prototype?.executeCommand&&x.prototype?.registerCommand&&x.prototype?.getCommand);return k?await c.get(k).executeCommand('skillStudio.internal.semanticTokenDiagnostics'):null})()");
      legacyPackageStatus=(legacyDiagnostics?.packageStatuses??[]).find(item=>
        String(item.rootUri??"").endsWith("/skill-studio-demo/skills/establish-pdu-session-mas"));
      legacyReadyOtherPackage=(legacyDiagnostics?.packageStatuses??[]).find(item=>
        item.rootUri!==legacyPackageStatus?.rootUri&&item.state==="READY");
      legacySourceDiagnostic=(legacyPackageStatus?.analysisDiagnostics??[]).find(item=>
        item.code==="UNKNOWN_FIELD"&&item.relativePath==="assurance/contract.yaml");
      if(legacyPackageStatus?.state==="PARTIAL"&&
         legacyPackageStatus?.procedureState==="UNAVAILABLE"&&
         legacyPackageStatus?.publishedDiagnosticCount>0&&legacySourceDiagnostic&&
         legacyReadyOtherPackage&&
         legacyDiagnostics?.languageStatus==="SKILL LSP: PARTIAL")break;
    }catch{legacyDiagnostics=null;}
    await sleep(200);
  }
  if(legacyPackageStatus?.state!=="PARTIAL"||
     legacyPackageStatus?.procedureState!=="UNAVAILABLE"||
     !(legacyPackageStatus?.publishedDiagnosticCount>0)||
     !legacySourceDiagnostic||!legacyReadyOtherPackage||
     legacyDiagnostics?.languageStatus!=="SKILL LSP: PARTIAL")
    throw Error("The stale v1alpha1 Example was not surfaced as a workspace-level analysis failure: "+
      JSON.stringify({
        languageStatus:legacyDiagnostics?.languageStatus,
        packageStatus:legacyPackageStatus,
        readyOtherPackage:legacyReadyOtherPackage,
        sourceDiagnostic:legacySourceDiagnostic
      }).slice(0,3200));
  console.log("STUDIO_LEGACY_EXAMPLE_ANALYSIS_UNAVAILABLE_CHROMIUM_PASS",JSON.stringify({
    languageStatus:legacyDiagnostics.languageStatus,
    packageState:legacyPackageStatus.state,
    procedureState:legacyPackageStatus.procedureState,
    publishedDiagnosticCount:legacyPackageStatus.publishedDiagnosticCount,
    sourceDiagnostic:{code:legacySourceDiagnostic.code,
      path:legacySourceDiagnostic.relativePath,line:legacySourceDiagnostic.line},
    otherPackage:{rootUri:legacyReadyOtherPackage.rootUri,state:legacyReadyOtherPackage.state},
    packageAuditState:legacyPackageStatus.packageAuditState
  }));
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
      if(upgradedIdentity?.contractCurrentShape===true&&
         upgradedIdentity?.procedureCurrentShape===true){
        upgradedEvidence=await evalJS("(()=>{const c=window.theia.container;const k=[...c._bindingDictionary._map.keys()].find(x=>typeof x==='function'&&x.prototype?.executeCommand&&x.prototype?.registerCommand&&x.prototype?.getCommand);return c.get(k).executeCommand('skillStudio.showActivationDiagnostics')})()");
        if(upgradedEvidence?.packageInventory?.state==="ready"&&
           upgradedEvidence.packageInventory.packages?.length===3)break;
      }
    }catch{upgradedIdentity=null;}
    await sleep(250);
  }
  if(upgradedIdentity?.contractCurrentShape!==true||
     upgradedIdentity?.procedureCurrentShape!==true||
     upgradedIdentity?.libExists||upgradedIdentity?.outputExists||
     upgradedIdentity?.workspaceFolders?.length!==1||
     upgradedEvidence?.packageInventory?.packages?.length!==3||
     upgradedEvidence?.failures?.length){
    try{
      upgradedEvidence=await evalJS("(()=>{const c=window.theia?.container;if(!c)return null;const k=[...(c._bindingDictionary?._map?.keys?.()??[])].find(x=>typeof x==='function'&&x.prototype?.executeCommand&&x.prototype?.registerCommand&&x.prototype?.getCommand);return k?c.get(k).executeCommand('skillStudio.showActivationDiagnostics'):null})()");
    }catch(error){
      upgradedEvidence={diagnosticsError:String(error?.message??error)};
    }
    throw Error("Explicit Example replacement did not restore a clean current v1alpha5 project: "+
      JSON.stringify({identity:upgradedIdentity,activation:upgradedEvidence,
        ui:await evalJS("document.body.innerText.slice(-1800)")}).slice(0,5200));
  }
  console.log("STUDIO_LEGACY_EXAMPLE_REPLACEMENT_CHROMIUM_PASS",JSON.stringify({
    menu:recoveryMenu,legacyVersion:legacyIdentity.contractApiVersion,
    cancelPreserved:afterCancel.contractApiVersion,
    upgradedGrammar:"CA-SL v1alpha5 (top-level Contract + start/nodes)",
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
  if(requireEditor){
    await studioCommand("skillStudio.openProcedure",identity.defaultProcedure);
    const sourceState=action=>evalJS(`(() => {
      const c=window.theia.container;
      const key=[...c._bindingDictionary._map.keys()].find(k=>
        typeof k==='function'&&k.prototype?.getWidgets&&k.prototype?.activateWidget);
      const widget=c.get(key).getCurrentWidget('main');
      const editor=widget?.editor?.getControl?.();
      const model=editor?.getModel();
      if(!model)return null;
      if(${JSON.stringify(action)}==='edit'){
        editor.pushUndoStop();
        editor.executeEdits('mode-acceptance',[{
          range:{startLineNumber:1,startColumn:1,endLineNumber:1,endColumn:1},
          text:'# studio-mode-unsaved-sentinel\\n'
        }]);
        editor.pushUndoStop();
      }
      if(${JSON.stringify(action)}==='undo')editor.trigger('keyboard','undo',null);
      return {uri:model.uri.toString(),text:model.getValue(),dirty:widget.saveable?.dirty};
    })()`);
    await switchWorkspaceMode('Console');
    const original=await sourceState('read');
    const dirty=await sourceState('edit');
    if(!original || !dirty?.text.startsWith('# studio-mode-unsaved-sentinel'))
      throw Error("Unable to prepare native unsaved Source for mode acceptance");
    await switchWorkspaceMode('AI Workbench');
    await switchWorkspaceMode('Console');
    const matchesDirtySource=state=>state?.uri===dirty.uri&&state.text===dirty.text&&
      (dirty.dirty!==true||state.dirty===true);
    let restored=null;
    for(let attempt=0;attempt<50;attempt++){
      restored=await sourceState('read');
      if(matchesDirtySource(restored))break;
      await sleep(100);
    }
    const modeDiagnostics=await studioCommand("skillStudio.internal.workspaceModeDiagnostics");
    console.log("STUDIO_WORKSPACE_MODE_DIAGNOSTICS_CHROMIUM",JSON.stringify(modeDiagnostics));
    if(!matchesDirtySource(restored))
      throw Error("Console round trip lost selected file or unsaved Source: "+
        JSON.stringify({expectedUri:dirty.uri,actualUri:restored?.uri,
          expectedDirty:dirty.dirty,actualDirty:restored?.dirty,modeDiagnostics}));
    await sourceState('undo');
    for(let attempt=0;attempt<40;attempt++){
      if((await sourceState('read'))?.text===original.text)break;
      await sleep(100);
    }
    if((await sourceState('read'))?.text!==original.text)
      throw Error("Native Undo after mode round trip failed");
    // Start the Gateway scenario with a fresh editor context after changing its
    // endpoint. Console mode intentionally keeps the current AI view alive.
    const closed=await evalJS(`(async () => {
      const c=window.theia.container;
      const key=[...c._bindingDictionary._map.keys()].find(k=>
        typeof k==='function'&&k.prototype?.getWidgets&&k.prototype?.closeWidget);
      const shell=c.get(key);
      const ai=shell.getWidgets('main').find(widget=>widget.title.label==='AI Procedure Authoring');
      if(!ai)return false;
      await shell.closeWidget(ai.id);
      return !shell.getWidgets('main').some(widget=>widget.id===ai.id);
    })()`);
    if(!closed)throw Error("Could not close the isolated workspace-mode test tab");
    console.log("STUDIO_WORKSPACE_MODE_DIRTY_BUFFER_CHROMIUM_PASS");
  }
  let aiAuthoringEvidence=null;
  if(requireEditor&&externalUrl){
    const nativeCommand=async(id,...args)=>evalJS(
      "(async()=>{const c=window.theia.container;"+
      "const key=[...c._bindingDictionary._map.keys()].find(k=>"+
      "typeof k==='function'&&k.prototype?.executeCommand&&"+
      "k.prototype?.registerCommand&&k.prototype?.getCommand);"+
      "if(!key)throw Error('Native Theia command registry missing for AI Authoring');"+
      "return c.get(key).executeCommand("+JSON.stringify(id)+
      ",..."+JSON.stringify(args)+");})()");
    // A local OpenAI-compatible mock proves the complete Host-owned request /
    // Proposal / Patch / Compiler path without storing a provider credential in CI.
    const mockProposal={
      schema:"ca-studio.ai-model-proposal/v1",
      summary:"AI Authoring mock proposal: add a temporary acceptance node.",
      plan:["Add one isolated postcondition Node without changing existing 3GPP actions."],
      operations:[{
        type:"node.add",
        target:{nodeId:"ai-authoring-smoke-node"},
        payload:{definition:{postcondition:{
          predicates:[{predicate:"session.goal_satisfied",arguments:[]}],
          routes:{PASS:"SUCCEEDED",FAIL:"FAILED",UNKNOWN:"UNRESOLVED"}
        }}},
        rationale:"Verify that a structured model proposal becomes a Host-owned source-preserving patch.",
        references:["procedure-current"]
      }],
      assumptions:[],
      blockers:[]
    };
    const gatewayRequests=[];
    const mockGateway=createServer((req,res)=>{
      if(req.method==="OPTIONS"){
        res.writeHead(204,{
          "Access-Control-Allow-Origin":"*",
          "Access-Control-Allow-Methods":"POST, OPTIONS",
          "Access-Control-Allow-Headers":"content-type,x-opencode-session,x-gateway-token"
        }).end();
        return;
      }
      if(req.method!=="POST"||req.url!=="/opencode-go/openai/v1/chat/completions"){
        res.writeHead(404).end();return;
      }
      const chunks=[];
      req.on("data",chunk=>chunks.push(chunk));
      req.on("end",()=>{
        try{
          const body=JSON.parse(Buffer.concat(chunks).toString("utf8"));
          gatewayRequests.push({body,headers:req.headers});
          const catalogRequest=body.messages?.[0]?.content?.startsWith("Choose the Package resources");
          const catalog=catalogRequest ? JSON.parse(body.messages[1].content).catalog : [];
          const response=catalogRequest
            ? {resourceIds:catalog.filter(item=>item.kind==="contract").map(item=>item.id)}
            : mockProposal;
          res.writeHead(200,{
            "Content-Type":"application/json",
            "Access-Control-Allow-Origin":"*",
            "x-request-id":"ai-authoring-mock-gateway"
          });
          res.end(JSON.stringify({
            id:"chatcmpl-ai-authoring-acceptance",
            object:"chat.completion",
            model:body.model,
            choices:[{
              index:0,
              message:{role:"assistant",content:JSON.stringify(response)},
              finish_reason:"stop"
            }],
            usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}
          }));
        }catch(error){
          res.writeHead(400,{"Content-Type":"application/json"}).end(
            JSON.stringify({error:String(error?.message??error)}));
        }
      });
    });
    await new Promise(resolve=>mockGateway.listen(0,"127.0.0.1",resolve));
    const gatewayUrl="http://127.0.0.1:"+mockGateway.address().port+"/opencode-go/openai";
    let aiContextId=null;
    let aiFrameId=null;
    const readAiView=async()=>{
      const tree=await command("Page.getFrameTree");
      const frames=[];
      const walk=node=>{
        if(!node)return;
        frames.push(node.frame);
        for(const child of node.childFrames??[])walk(child);
      };
      walk(tree.frameTree);
      for(const frame of frames.filter(item=>/webview/i.test(item.url??""))){
        try{
          const world=await command("Page.createIsolatedWorld",{
            frameId:frame.id,
            worldName:"skill-studio-ai-authoring-acceptance",
            grantUniveralAccess:true
          });
          const evaluated=await command("Runtime.evaluate",{
            contextId:world.executionContextId,
            returnByValue:true,
            expression:"(()=>({title:document.title,"+
              "bodyText:document.body?.innerText??'',"+
              "csp:document.querySelector('meta[http-equiv=\"Content-Security-Policy\" i]')?.content??'',"+
              "gatewayConfigured:document.getElementById('gatewayNotice')?.textContent.includes('已配置')===true,"+
              "contextText:document.getElementById('contextPanel')?.textContent??'',"+
              "proposalSummary:document.getElementById('proposalSummary')?.textContent??'',"+
              "candidateSource:document.getElementById('candidateSource')?.textContent??'',"+
              "compilerStatus:document.getElementById('compilerStatus')?.textContent??'',"+
              "patchState:document.getElementById('patchState')?.textContent??'',"+
              "statusText:document.getElementById('status')?.textContent??'',"+
              "patchError:document.getElementById('patchError')?.textContent??'',"+
              "reviewTabs:[...document.querySelectorAll('[role=tab]')].map(x=>x.textContent),"+
              "flowGroups:document.querySelectorAll('[data-flow-group]').length,"+
              "diffAddedRows:document.querySelectorAll('.diff-row.added').length,"+
              "diffRemovedRows:document.querySelectorAll('.diff-row.removed').length,"+
              "diffSummary:document.getElementById('diffSummary')?.textContent??'',"+
              "validationText:document.getElementById('validationIdentity')?.textContent??'',"+
              "contextVisible:document.getElementById('contextPanel')?.open===true,"+
              "reviewPanelCount:document.querySelectorAll('.review-panel').length,"+
              "chatComposer:document.querySelectorAll('#agentComposer textarea').length,"+
              "composerCount:document.querySelectorAll('#agentComposer textarea').length,"+
              "chatHasLog:document.querySelector('#agentActivity[role=log]')!==null,"+
              "reviewOpen:document.getElementById('agentReview')?.hidden===false,"+
              "applyDisabled:document.getElementById('apply')?.disabled!==false"+
              "}))()"
          });
          const view=evaluated.result?.value;
          if(view?.title==="AI Procedure Authoring"){
            aiContextId=world.executionContextId;
            aiFrameId=frame.id;
            return view;
          }
        }catch{
          // Webview frames can be replaced while the standalone Editor Tab activates.
        }
      }
      return null;
    };
    try{
      const configured=await nativeCommand("skillStudio.internal.configureAiGatewayAcceptance",{
        gatewayUrl,modelId:"deepseek-v4.1-flash"
      });
      if(configured!==true)throw Error("AI Gateway mock route could not be configured in the acceptance host");
      await nativeCommand("skillStudio.openProcedure",identity.defaultProcedure);
      const opened=await nativeCommand("skillStudio.openAiAuthoring");
      if(opened!==true)
        throw Error("AI Procedure Authoring command did not open its standalone Editor Tab");
      let initialView=null;
      let latest=[];
      for(let attempt=0;attempt<120&&!initialView;attempt++){
        initialView=await readAiView();
        if(initialView){
          latest=[{title:initialView.title,bodyText:initialView.bodyText.slice(0,700)}];
          const contextReady=initialView.contextText.includes("上下文来源")&&
            initialView.contextText.includes("assurance/contract.yaml")&&
            initialView.contextText.includes("assurance/predicates.yaml")&&
            initialView.contextText.includes("schemas/establishment-request.schema.yaml");
          if(!contextReady||!initialView.gatewayConfigured)initialView=null;
        }
        if(!initialView)await sleep(100);
      }
      if(!initialView)
        throw Error("AI Procedure Authoring Editor Tab did not load the live Package context and configured Gateway: "+
          JSON.stringify(latest));
      if(initialView.reviewOpen!==false)throw Error("Fresh Agent session must start with the chat surface");
      if(!initialView.csp.includes("default-src 'none'")||
         !initialView.csp.includes("connect-src 'none'")||
         !initialView.csp.includes("script-src 'nonce-"))
        throw Error("AI Authoring Webview CSP did not retain nonce-only scripts and a disabled direct network path: "+initialView.csp);

      const task="Add one temporary postcondition node named ai-authoring-smoke-node to verify the authoring pipeline. Do not change existing 3GPP actions.";
      const clicked=await command("Runtime.evaluate",{
        contextId:aiContextId,
        returnByValue:true,
        expression:"(()=>{const task=document.getElementById('task');const button=document.getElementById('sendTask');document.getElementById('sendMode').value='generate';"+
          "if(!task||!button||button.disabled)return {ok:false,reason:'Generate control unavailable'};"+
          "task.value="+JSON.stringify(task)+";task.dispatchEvent(new Event('input',{bubbles:true}));"+
          "button.click();return {ok:true};})()"
      });
      if(clicked.result?.value?.ok!==true)
        throw Error("AI Authoring Generate control could not be activated: "+JSON.stringify(clicked.result?.value));
      const waitForDialogButton=async labels=>{
        for(let attempt=0;attempt<100;attempt++){
          const position=await evalJS(
            "(()=>{const labels="+JSON.stringify(labels)+
            ";const button=[...document.querySelectorAll('button,[role=\"button\"]')].find(item=>{"+
            "const r=item.getBoundingClientRect();return r.width>0&&r.height>0&&labels.includes(item.innerText.trim())});"+
            "if(!button)return null;const r=button.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,label:button.innerText.trim()}})()");
          if(position)return position;
          await sleep(100);
        }
        throw Error("AI Authoring data-disclosure confirmation did not appear: "+
          JSON.stringify({workbench:await evalJS("document.body.innerText.slice(-1000)"),agent:(await readAiView())?.bodyText?.slice(-1000)}));
      };
      const sendPosition=await waitForDialogButton(["发送并生成提案"]);
      await command("Input.dispatchMouseEvent",{type:"mouseMoved",x:sendPosition.x,y:sendPosition.y});
      await command("Input.dispatchMouseEvent",{type:"mousePressed",x:sendPosition.x,y:sendPosition.y,button:"left",clickCount:1});
      await command("Input.dispatchMouseEvent",{type:"mouseReleased",x:sendPosition.x,y:sendPosition.y,button:"left",clickCount:1});

      for(let attempt=0;attempt<120&&gatewayRequests.length===0;attempt++)await sleep(100);
      if(gatewayRequests.length!==1)
        throw Error("AI Gateway mock did not receive exactly one model request: "+gatewayRequests.length);
      const gatewayRequest=gatewayRequests[0];
      if(gatewayRequest.body?.model!=="deepseek-v4.1-flash"||
         gatewayRequest.body?.stream!==false||
         gatewayRequest.body?.response_format?.type!=="json_object"||
         !Array.isArray(gatewayRequest.body?.messages)||
         !gatewayRequest.body.messages[1]?.content?.includes("CONTEXT ITEM procedure-current")||
         !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(gatewayRequest.headers["x-opencode-session"]??""))
        throw Error("AI Gateway request did not match the expected OpenAI-compatible v1 Chat Completions contract");

      let proposalView=null;
      // Allow the Host's 60-second Compiler Worker timeout to settle and
      // report a real terminal result before asserting the Patch preview.
      const proposalDeadline=Date.now()+70000;
      while(Date.now()<proposalDeadline&&!proposalView){
        const view=await readAiView();
        if(view?.proposalSummary.includes("AI Authoring mock proposal")&&
           view.candidateSource.includes("ai-authoring-smoke-node"))proposalView=view;
        if(!proposalView)await sleep(100);
      }
      if(!proposalView){
        const finalView=await readAiView();
        throw Error("Mock model response did not become a source-preserving Patch preview: "+
          JSON.stringify({
            gatewayRequestCount:gatewayRequests.length,
            model:gatewayRequests[0]?.body?.model,
            responseFormat:gatewayRequests[0]?.body?.response_format,
            sessionHeaderPresent:Boolean(gatewayRequests[0]?.headers?.["x-opencode-session"]),
            view:finalView?{
              bodyText:finalView.bodyText.slice(-1400),
              proposalSummary:finalView.proposalSummary,
              compilerStatus:finalView.compilerStatus,
              patchState:finalView.patchState,
              statusText:finalView.statusText,
              patchError:finalView.patchError,
              applyDisabled:finalView.applyDisabled
            }:null
          }));
      }
      if(proposalView.chatComposer!==1||proposalView.composerCount!==1||proposalView.chatHasLog!==true||
         proposalView.reviewOpen!==true||proposalView.reviewPanelCount!==1||proposalView.contextVisible!==false||
         JSON.stringify(proposalView.reviewTabs)!==JSON.stringify(["Plan","Flow Changes","YAML Diff","Validation"])||
         proposalView.flowGroups<1||proposalView.diffAddedRows<1||
         proposalView.diffRemovedRows<0||!proposalView.diffSummary.includes("新增")||
         !proposalView.validationText.includes("FAIL")) {
        throw Error("AI Workbench three-region semantic/Source/Compiler review did not render: "+
          JSON.stringify({tabs:proposalView.reviewTabs,flowGroups:proposalView.flowGroups,
            added:proposalView.diffAddedRows,removed:proposalView.diffRemovedRows,
            summary:proposalView.diffSummary,validation:proposalView.validationText}));
      }
      // F3 must prove the bundled Monaco Diff actually initialized in the
      // isolated Webview, not merely that its HTML/assets exist. The line
      // review remains available only as a truthful fallback.
      const diffSelected=await command("Runtime.evaluate",{
        contextId:aiContextId,returnByValue:true,
        expression:"(()=>{document.getElementById('tab-diff').click();"+
          "return document.getElementById('tab-diff').getAttribute('aria-selected')==='true';})()"
      });
      if(diffSelected.result?.value!==true)
        throw Error("F3 YAML Diff tab could not be opened");
      let monacoEvidence=null;
      for(let attempt=0;attempt<120&&!monacoEvidence;attempt++){
        const evaluated=await command("Runtime.evaluate",{
          contextId:aiContextId,returnByValue:true,
          expression:"(()=>{const surface=document.getElementById('monacoDiffSurface');"+
            "const editor=surface?.querySelector('.monaco-diff-editor');"+
            "const r=surface?.getBoundingClientRect();"+
            "return {initialized:!!editor,shown:surface?.hidden===false,"+
            "width:r?.width||0,height:r?.height||0,changedNodeVisible:surface?.innerText.includes(\'ai-authoring-smoke-node\')===true,"+
            "fallbackHidden:document.getElementById('diffRows')?.hidden===true,"+
            "mainWorldAdapterNotObservable:true,"+
            "notice:document.getElementById('monacoDiffNotice')?.textContent||''};})()"
        });
        const v=evaluated.result?.value;
        if(v?.initialized&&v.shown&&v.width>0&&v.height>0&&
           v.changedNodeVisible&&v.notice.includes("Monaco 只读 Diff"))monacoEvidence=v;
        if(!monacoEvidence)await sleep(100);
      }
      if(!monacoEvidence){
        const diagnostic=await command("Runtime.evaluate",{
          contextId:aiContextId,returnByValue:true,
          expression:"(()=>({notice:document.getElementById('monacoDiffNotice')?.textContent,"+
            "scripts:[...document.querySelectorAll('script[src]')].map(x=>x.src),"+
            "styles:[...document.querySelectorAll('link[rel=stylesheet]')].map(x=>x.href),"+
            "surface:document.getElementById('monacoDiffSurface')?.innerText.slice(0,300),"+
            "surfaceRect:(()=>{const r=document.getElementById('monacoDiffSurface')?.getBoundingClientRect();return {width:r?.width,height:r?.height}})(),"+
            "identity:window.skillStudioAiYamlDiff?.identity,renderedEditorCount:document.getElementById('monacoDiffSurface')?.querySelectorAll('.monaco-diff-editor').length}))()"
        });
        throw Error("F3 Monaco Diff did not render with non-empty exact candidate in Chromium: "+
          JSON.stringify(diagnostic.result?.value));
      }
      // CDP intentionally executes in an isolated world. Its window globals
      // do NOT expose main-world adapter objects; validate shared DOM only.
      let diffMode=null;
      for(let attempt=0;attempt<40;attempt++){
        diffMode=await command("Runtime.evaluate",{
          contextId:aiContextId,returnByValue:true,
          expression:"(()=>{try{const select=document.getElementById('monacoDiffMode');"+
            "const controls=document.getElementById('monacoDiffControls');"+
            "const surface=document.getElementById('monacoDiffSurface');"+
            "if(!select||!surface||!controls)return {ok:false,selectPresent:!!select,"+
              "controlsPresent:!!controls,surfacePresent:!!surface,title:document.title};"+
            "select.value='inline';select.dispatchEvent(new Event('change',{bubbles:true}));"+
            "document.getElementById('monacoDiffNext')?.click();"+
            "document.getElementById('monacoDiffPrevious')?.click();"+
            "select.value='side-by-side';select.dispatchEvent(new Event('change',{bubbles:true}));"+
            "return {ok:select.value==='side-by-side'&&!surface.hidden,"+
              "value:select.value,hidden:surface.hidden,controlsVisible:controls.hidden===false};"+
            "}catch(error){return {ok:false,error:String(error?.stack||error)}}})()"
        });
        if(diffMode.result?.value?.ok===true)break;
        await sleep(100);
      }
      if(diffMode?.result?.value?.ok!==true)
        throw Error("F3 Monaco Diff controls failed in Chromium: "+
          JSON.stringify({value:diffMode?.result?.value,exception:diffMode?.exceptionDetails}));
      // F2 must render actual React Flow canvases from the pinned v1alpha5
      // Source projection, not just the F1 text summary.
      const graphTab=await command("Runtime.evaluate",{
        contextId:aiContextId,returnByValue:true,
        expression:"(()=>{const tab=document.getElementById('tab-flow');"+
          "if(!tab)return false;tab.click();return "+
          "tab.getAttribute('aria-selected')==='true';})()"
      });
      if(graphTab.result?.value!==true)
        throw Error("F2 Flow Changes tab could not be opened");
      let graphView=null;
      for(let attempt=0;attempt<120&&!graphView;attempt++){
        const evaluated=await command("Runtime.evaluate",{
          contextId:aiContextId,returnByValue:true,
          expression:"(()=>{const c=document.querySelector('#flowCompareCanvas .ai-flow-compare-panes');"+
            "const panes=[...document.querySelectorAll('#flowCompareCanvas .ai-flow-panel')];"+
            "return {ready:!!c,panes:panes.length,"+
            "nodeCounts:panes.map(p=>p.querySelectorAll('.react-flow__node').length),"+
            "edgeCounts:panes.map(p=>p.querySelectorAll('.react-flow__edge').length),"+
            "changedRoutes:Number(c?.dataset.aiFlowChangedRoutes||0),"+
            "candidateAdded:panes[1]?.querySelectorAll('.ai-flow-node.status-added').length||0,"+
            "nodeIdPresent:panes[1]?.innerText.includes('ai-authoring-smoke-node')===true,"+
            "notice:document.getElementById('flowCompareNotice')?.textContent||''};})()"
        });
        const v=evaluated.result?.value;
        if(v?.ready&&v.panes===2&&v.nodeCounts.every(x=>x>=4)&&
           v.edgeCounts.every(x=>x>=1)&&v.candidateAdded>=1&&
           v.nodeIdPresent)graphView=v;
        if(!graphView)await sleep(100);
      }
      if(!graphView){
        const diagnostic=await command("Runtime.evaluate",{
          contextId:aiContextId,returnByValue:true,
          expression:"(()=>({html:document.getElementById('flowCompareCanvas')?.innerText.slice(0,500),"+
            "panes:document.querySelectorAll('.ai-flow-panel').length,"+
            "resourceScripts:[...document.querySelectorAll('script[src]')].map(x=>x.src),"+
            "css:[...document.querySelectorAll('link[rel=stylesheet]')].map(x=>x.href)}))()"
        });
        throw Error("Actual React Flow before/after graph did not render in Chromium: "+
          JSON.stringify(diagnostic.result?.value));
      }
      const toggledPath=await command("Runtime.evaluate",{
        contextId:aiContextId,returnByValue:true,
        expression:"(()=>{const label=[...document.querySelectorAll('#flowCompareCanvas label')]"+
          ".find(x=>x.textContent.includes('正常路径'));"+
          "const input=label?.querySelector('input');"+
          "if(!input||input.checked)return false;input.click();return true;})()"
      });
      if(toggledPath.result?.value!==true)
        throw Error("F2 normal-route collapse control was unavailable");
      let collapsed=false;
      for(let attempt=0;attempt<50&&!collapsed;attempt++){
        const v=await command("Runtime.evaluate",{
          contextId:aiContextId,returnByValue:true,
          expression:"document.querySelector('#flowCompareCanvas [data-ai-flow-path-mode]')"+
            "?.dataset.aiFlowPathMode"
        });
        collapsed=v.result?.value==="normal";
        if(!collapsed)await sleep(100);
      }
      if(!collapsed)throw Error("F2 normal-path collapse did not switch the graph mode");
      const restoredPath=await command("Runtime.evaluate",{
        contextId:aiContextId,returnByValue:true,
        expression:"(()=>{const label=[...document.querySelectorAll('#flowCompareCanvas label')]"+
          ".find(x=>x.textContent.includes('正常路径'));"+
          "const input=label?.querySelector('input');"+
          "if(!input||!input.checked)return false;input.click();return true;})()"
      });
      if(restoredPath.result?.value!==true)
        throw Error("F2 complete-route view could not be restored");
      const focused=await command("Runtime.evaluate",{
        contextId:aiContextId,returnByValue:true,
        expression:"(()=>{const card=[...document.querySelectorAll('.ai-flow-panel')][1]"+
          "?.querySelector('.ai-flow-node.status-added');"+
          "if(!card)return false;card.click();"+
          "return document.getElementById('flowFocusInfo')?.hidden===false&&"+
          "document.getElementById('flowFocusInfo')?.textContent.includes('ai-authoring-smoke-node');})()"
      });
      if(focused.result?.value!==true)
        throw Error("F2 graph Node click did not reveal source line / group focus");
      // Restore the pre-existing Plan tab and keyboard focus before the native
      // Apply/Undo acceptance, to avoid Theia editor-focus interference.
      await command("Runtime.evaluate",{
        contextId:aiContextId,returnByValue:true,
        expression:"(()=>{document.getElementById('tab-plan').click();"+
          "document.activeElement?.blur();return true;})()"
      });
      const tabNavigation=await command("Runtime.evaluate",{
        contextId:aiContextId,
        returnByValue:true,
        expression:"(()=>{const diff=document.getElementById('tab-diff');"+
          "diff.click();const opened=diff.getAttribute('aria-selected')==='true'&&"+
          "!document.getElementById('view-diff').hidden;"+
          "diff.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));"+
          "const keyboard=document.getElementById('tab-validation').getAttribute('aria-selected')==='true'&&"+
          "!document.getElementById('view-validation').hidden;"+
          "document.getElementById('tab-plan').click();"+
          "document.activeElement?.blur();"+
          "return {opened,keyboard,restored:document.getElementById('tab-plan').getAttribute('aria-selected')==='true'};})()"
      });
      if(!tabNavigation.result?.value?.opened||!tabNavigation.result?.value?.keyboard||!tabNavigation.result?.value?.restored)
        throw Error("AI Workbench keyboard-accessible review tabs failed in Chromium");
      if(!proposalView.compilerStatus.includes("Compiler v2.0.2 Check: FAIL")||
         !proposalView.patchState.includes("Compiler Check failed")||
         !proposalView.applyDisabled)
        throw Error("Compiler failure did not keep the candidate PREVIEW ONLY: "+JSON.stringify({
          compilerStatus:proposalView.compilerStatus,patchState:proposalView.patchState,
          applyDisabled:proposalView.applyDisabled
        }));
      // F4: real production Editor Tab -> Gateway, two disclosed model
      // rounds and read-only session history. No real 5GC qualification.
      const firstHistory=await command("Runtime.evaluate",{
        contextId:aiContextId,returnByValue:true,
        expression:"(()=>({count:document.querySelectorAll('#revisionTimeline .revision-entry').length,"+
          "refineEnabled:document.getElementById('continueOption')?.disabled===false}))()"
      });
      if(firstHistory.result?.value?.count!==1||
         firstHistory.result?.value?.refineEnabled!==true)
        throw Error("F4 initial proposal missing an active session revision: "+
          JSON.stringify(firstHistory.result?.value));
      const refineClicked=await command("Runtime.evaluate",{
        contextId:aiContextId,returnByValue:true,
        expression:"(()=>{const task=document.getElementById('task');"+
          "const button=document.getElementById('sendTask');"+
          "if(!task||!button||button.disabled)return false;"+
          "task.value='Keep the temporary Node but clarify the final outcome explanation.';"+
          "task.dispatchEvent(new Event('input',{bubbles:true}));"+
          "button.click();return true;})()"
      });
      if(refineClicked.result?.value!==true)
        throw Error("F4 Refine action was not available after initial proposal");
      const refineApproval=await waitForDialogButton(["发送并生成提案"]);
      await command("Input.dispatchMouseEvent",{type:"mouseMoved",x:refineApproval.x,y:refineApproval.y});
      await command("Input.dispatchMouseEvent",{type:"mousePressed",x:refineApproval.x,y:refineApproval.y,button:"left",clickCount:1});
      await command("Input.dispatchMouseEvent",{type:"mouseReleased",x:refineApproval.x,y:refineApproval.y,button:"left",clickCount:1});
      let historyRendered=false;
      for(let attempt=0;attempt<120&&!historyRendered;attempt++){
        const result=await command("Runtime.evaluate",{
          contextId:aiContextId,returnByValue:true,
          expression:"(()=>({count:document.querySelectorAll('#revisionTimeline .revision-entry').length,"+
            "refineEnabled:document.getElementById('continueOption')?.disabled===false,"+
            "candidate:document.getElementById('candidateSource')?.textContent.includes('ai-authoring-smoke-node')}))()"
        });
        const value=result.result?.value;
        historyRendered=value?.count===2&&value.refineEnabled&&value.candidate;
        if(!historyRendered)await sleep(100);
      }
      if(!historyRendered||gatewayRequests.length!==2||
         !gatewayRequests[1].body.messages[1].content.includes("REFINE THE PREVIOUS SEMANTIC PROPOSAL")||
         !gatewayRequests[1].body.messages[1].content.includes("node.add"))
        throw Error("F4 expected two disclosed proposals and Host session revisions; calls="+
          gatewayRequests.length);
      await command("Runtime.evaluate",{
        contextId:aiContextId,returnByValue:true,
        expression:"document.getElementById('task').value='unsent refine draft'"
      });
      await switchWorkspaceMode('Console');
      await switchWorkspaceMode('AI Workbench');
      const resumed=await readAiView();
      const retained=await command("Runtime.evaluate",{
        contextId:aiContextId,returnByValue:true,
        expression:"(()=>({history:document.querySelectorAll('#revisionTimeline .revision-entry').length,"+
          "groups:document.querySelectorAll('#groups input:checked').length,"+
          "refine:document.getElementById('task')?.value}))()"
      });
      if(!resumed?.proposalSummary || !resumed.candidateSource ||
          retained.result?.value?.history!==2 || retained.result.value.groups<1 ||
          retained.result.value.refine!=='unsent refine draft')
        throw Error("AI Workbench round trip lost proposal, candidate, groups, refine or history");
      console.log("STUDIO_WORKSPACE_MODE_AI_STATE_CHROMIUM_PASS");
      const clickedHistory=await command("Runtime.evaluate",{
        contextId:aiContextId,returnByValue:true,
        expression:"(()=>{const buttons=[...document.querySelectorAll('#revisionTimeline .revision-entry button')];"+
          "if(buttons.length!==2)return false;buttons[1].click();return true;})()"
      });
      if(clickedHistory.result?.value!==true)
        throw Error("F4 historical inspection control unavailable");
      let historicalReadOnly=false;
      for(let attempt=0;attempt<80&&!historicalReadOnly;attempt++){
        const result=await command("Runtime.evaluate",{
          contextId:aiContextId,returnByValue:true,
          expression:"(()=>({patch:document.getElementById('patchState')?.textContent||''," +
            "applyDisabled:document.getElementById('apply')?.disabled===true,"+
            "refineDisabled:document.getElementById('continueOption')?.disabled===true,"+
            "groupsDisabled:[...document.querySelectorAll('#groups input')].every(x=>x.disabled)}))()"
        });
        const value=result.result?.value;
        historicalReadOnly=value?.patch.includes("HISTORY · READ ONLY")&&
          value.applyDisabled&&value.refineDisabled&&value.groupsDisabled;
        if(!historicalReadOnly)await sleep(100);
      }
      if(!historicalReadOnly)
        throw Error("F4 historical inspection did not revoke Compiler Apply authority");
      const agentStart=await command("Runtime.evaluate",{
        contextId:aiContextId,returnByValue:true,
        expression:`(()=>{
          const button=document.getElementById('sendTask');
          if(!button || button.disabled)return false;
          document.getElementById('sendMode').value='runAgent';
          document.getElementById('task').value='Find the relevant Package contract and prepare a candidate';
          button.click();
          return true;
        })()`
      });
      if(agentStart.result?.value!==true)throw Error("Skill Package Agent entry is unavailable");
      const agentApproval=await waitForDialogButton(["发送并生成提案"]);
      await command("Input.dispatchMouseEvent",{type:"mouseMoved",x:agentApproval.x,y:agentApproval.y});
      await command("Input.dispatchMouseEvent",{type:"mousePressed",x:agentApproval.x,y:agentApproval.y,button:"left",clickCount:1});
      await command("Input.dispatchMouseEvent",{type:"mouseReleased",x:agentApproval.x,y:agentApproval.y,button:"left",clickCount:1});
      let agentReady=false, lastAgentActivity;
      const agentDeadline=Date.now()+140000;
      while(!agentReady && Date.now()<agentDeadline){
        const activity=await command("Runtime.evaluate",{
          contextId:aiContextId,returnByValue:true,
          expression:`({
            status:document.getElementById('status').textContent,
            log:document.getElementById('agentActivity').textContent,
            user:document.querySelector('#agentActivity [data-role=user]:last-of-type')?.textContent||
              [...document.querySelectorAll('#agentActivity [data-role=user]')].at(-1)?.textContent,
            reply:[...document.querySelectorAll('#agentActivity [data-role=agent]')].at(-1)?.textContent,
            candidate:document.getElementById('candidateSource').textContent,
            busy:!document.getElementById('cancel').disabled
          })`
        });
        const value=activity.result?.value;
        lastAgentActivity=value;
        agentReady=value?.log.includes("读取本轮资料")&&
          value.user?.includes("Find the relevant Package contract")&&
          value.reply?.includes("AI Authoring mock proposal")&&
          value.candidate.includes("ai-authoring-smoke-node")&&!value.busy;
        if(!agentReady)await sleep(100);
      }
      const catalogMessage=gatewayRequests[2]?.body.messages[1].content;
      const selectedContext=gatewayRequests[3]?.body.messages[1].content;
      if(!agentReady||!catalogMessage?.includes("assurance/contract.yaml")||
         catalogMessage.includes("CONTEXT ITEM")||!selectedContext?.includes("label: assurance/contract.yaml")||
         selectedContext.includes("label: assurance/predicates.yaml")||
         ![4,5].includes(gatewayRequests.length))
        throw Error("Agent did not select and read only the disclosed Package resource: "+JSON.stringify({
          ready: agentReady, requestCount: gatewayRequests.length,
          hasCatalog: Boolean(catalogMessage?.includes("assurance/contract.yaml")),
          hasSelectedContract: Boolean(selectedContext?.includes("label: assurance/contract.yaml")),
          status: lastAgentActivity?.status, busy: lastAgentActivity?.busy,
          hasCandidate: Boolean(lastAgentActivity?.candidate)
        }));
      console.log("STUDIO_PACKAGE_AGENT_BOUND_CONTEXT_CHROMIUM_PASS");
      // F4 disposal gate: close the specific AI Editor Tab in Theia's
      // actual main shell. A history inspection must not leave the Webview
      // focused while the subsequent independent native Undo fixture runs.
      const closedAiTab=await evalJS(
        "(async()=>{const c=window.theia.container;"+
        "const key=[...c._bindingDictionary._map.keys()].find(k=>"+
        "typeof k==='function'&&k.prototype?.activateWidget&&k.prototype?.addWidget);"+
        "if(!key)throw Error('Theia application shell not found');"+
        "const shell=c.get(key);"+
        "const widget=shell.getWidgets('main').find(w=>w.title?.label==='AI Procedure Authoring');"+
        "if(!widget)return {closed:false,reason:'AI Editor Tab missing before disposal'};"+
        "await shell.closeWidget(widget.id);"+
        "return {closed:!shell.getWidgets('main').some(w=>w.id===widget.id),id:widget.id};})()"
      );
      if(closedAiTab?.closed!==true)
        throw Error("F4 session Editor Tab did not dispose cleanly: "+JSON.stringify(closedAiTab));
      await nativeCommand("skillStudio.openProcedure",identity.defaultProcedure);
      const nativeChatStart=await evalJS(`(async()=>{
        const c=window.theia.container;
        const keys=[...c._bindingDictionary._map.keys()];
        const service=k=>keys.find(key=>String(key)==='Symbol('+k+')');
        const chat=c.get(service('ChatService')),agents=c.get(service('ChatAgentService'));
        const agent=agents.getAgents().find(item=>item.id==='SkillStudio');
        if(!agent)return false;
        const session=chat.createSession('panel',undefined,agent);
        const invocation=await chat.sendRequest(session.id,{text:'Prepare a Package candidate in native AI Chat'});
        if(!invocation)return false;
        window.__studioNativeAiAcceptance=null;
        void invocation.responseCompleted.then(response=>{window.__studioNativeAiAcceptance=response.response.asString();});
        return true;
      })()`);
      if(!nativeChatStart)throw Error("Native Theia SkillStudio agent did not start");
      const nativeApproval=await waitForDialogButton(["发送并生成提案"]);
      await command("Input.dispatchMouseEvent",{type:"mouseMoved",x:nativeApproval.x,y:nativeApproval.y});
      await command("Input.dispatchMouseEvent",{type:"mousePressed",x:nativeApproval.x,y:nativeApproval.y,button:"left",clickCount:1});
      await command("Input.dispatchMouseEvent",{type:"mouseReleased",x:nativeApproval.x,y:nativeApproval.y,button:"left",clickCount:1});
      let nativeReply;
      const nativeDeadline=Date.now()+140000;
      while(!nativeReply && Date.now()<nativeDeadline){
        nativeReply=await evalJS('window.__studioNativeAiAcceptance');
        if(!nativeReply)await sleep(100);
      }
      if(!nativeReply?.includes("AI Authoring mock proposal") || !nativeReply.includes("Compiler Check"))
        throw Error("Native Theia SkillStudio reply did not report the candidate: "+nativeReply);
      // Opening the review must replay the candidate without starting a new model request.
      const nativeRequests=gatewayRequests.length;
      await nativeCommand("skillStudio.openAiAuthoring");
      let nativeReview;
      for(let attempt=0;attempt<80;attempt++){
        nativeReview=await readAiView();
        if(nativeReview?.candidateSource.includes("ai-authoring-smoke-node"))break;
        await sleep(100);
      }
      if(!nativeReview?.candidateSource.includes("ai-authoring-smoke-node") ||
         gatewayRequests.length!==nativeRequests) throw Error("Native Chat candidate was lost before Studio review");
      await evalJS(`(async()=>{
        const c=window.theia.container;
        const key=[...c._bindingDictionary._map.keys()].find(k=>
          typeof k==='function'&&k.prototype?.getWidgets&&k.prototype?.closeWidget);
        const shell=c.get(key);
        const widget=shell.getWidgets('main').find(w=>w.title?.label==='AI Procedure Authoring');
        if(widget)await shell.closeWidget(widget.id);
      })()`);
      console.log("STUDIO_NATIVE_SKILL_CHAT_GATEWAY_REVIEW_CHROMIUM_PASS");
      console.log("STUDIO_AI_AUTHORING_REFINEMENT_HISTORY_CHROMIUM_PASS",JSON.stringify({
        modelRequests:2,sessionRevisions:2,repeatedDisclosure:true,
        refinementUsesSemanticHistory:true,historicalApplyBlocked:true
      }));
      aiAuthoringEvidence={
        title:initialView.title,
        packageContext:["assurance/contract.yaml","assurance/predicates.yaml",
          "schemas/establishment-request.schema.yaml"],
        cspDefaultNone:true,
        cspConnectNone:true,
        nonceScriptPolicy:true,
        gatewayConfigured:true,
        mockGatewayRequest:"PASS",
        openAiCompatibleRequest:"PASS",
        stableSessionHeader:"PASS",
        structuredModelProposal:"PASS",
        sourcePreservingPatchPreview:"PASS",
        workbenchThreeRegion:"PASS",
        flowChangesSourceOutline:"PASS",
        lineDiffReview:"PASS",
        monacoDiffReadOnlyChromium:"PASS",
        monacoDiffModesAndNavigation:"PASS",
        compilerDiagnosticsReview:"PASS",
        keyboardReviewTabs:"PASS",
        reactFlowTwoSource:"PASS",
        reactFlowReadOnly:"PASS",
        sourceBackedChangedNode:"PASS",
        graphFocusChangeSet:"PASS",
        normalPathBranchCollapse:"PASS",
        compilerCheck:"FAIL_AS_EXPECTED_FOR_UNQUALIFIED_5GC_EXAMPLE",
        applyBlocked:true
      };
      console.log("STUDIO_AI_AUTHORING_MOCK_GATEWAY_E2E_CHROMIUM",JSON.stringify(aiAuthoringEvidence));
    }finally{
      try{
        await nativeCommand("skillStudio.internal.configureAiGatewayAcceptance",{
          gatewayUrl:"",modelId:"deepseek-v4.1-flash"
        });
      }catch{/* The acceptance profile is ephemeral; never hide the primary failure. */}
      await new Promise(resolve=>mockGateway.close(resolve));
    }
    // The backend CI host enables this fixture-only command explicitly.
    // Unlike the unqualified 5GC mock proposal above, this verifies an exact
    // Compiler-qualified candidate in the native VS Code/Theia editor.
    const synthetic=await nativeCommand("skillStudio.internal.syntheticAuthoringApplyAcceptance");
    if(synthetic?.compilerVersion!=="v2.0.2"||
       synthetic?.qualification!=="SYNTHETIC_TEST_ONLY"||
       synthetic?.compilerBaseline?.errors!==0||
       synthetic?.compilerCandidate?.errors!==0||
       synthetic?.atomicGroupCount!==1||
       synthetic?.nativeWorkspaceEdit!=="PASS"||
       synthetic?.pendingUndo!==true||
       synthetic?.unsavedDiskUnchanged!==true||
       synthetic?.autoSaved!==false){
      throw Error("Synthetic Compiler-qualified native Editor Apply acceptance failed: "+
        JSON.stringify(synthetic));
    }
    const undoCommand=await evalJS(
      "(async()=>{const c=window.theia.container;"+
      "const key=[...c._bindingDictionary._map.keys()].find(k=>"+
      "typeof k==='function'&&k.prototype?.executeCommand&&"+
      "k.prototype?.registerCommand&&k.prototype?.getCommand);"+
      "if(!key)throw Error('Native Theia CommandRegistry missing for Undo');"+
      "const commands=c.get(key);"+
      "const available=['undo','core.undo'].filter(id=>commands.getCommand(id));"+
      "const enabled=available.find(id=>commands.isEnabled(id));"+
      "if(!enabled)throw Error('No enabled frontend Monaco Undo command: '+available);"+
      "await commands.executeCommand(enabled);return enabled;})()");
    const undo=await nativeCommand("skillStudio.internal.syntheticAuthoringVerifyUndo");
    if(undo?.nativeUndo!=="PASS"||undo?.restoredOriginal!==true||
       undo?.unsavedDiskUnchanged!==true||undo?.autoSaved!==false){
      throw Error("Theia frontend Undo did not restore the synthetic editor buffer: "+
        JSON.stringify({undoCommand,undo}));
    }
    console.log("STUDIO_AI_AUTHORING_SYNTHETIC_NATIVE_EDIT_UNDO_CHROMIUM_PASS",
      JSON.stringify({...synthetic,...undo,pendingUndo:false,undoCommand}));

    // This additional PASS must be produced from the actual standalone
    // AI Editor Tab, not from the independent native-edit acceptance command.
    // The Node test host stages the official pinned Compiler v2.0.2 fixture
    // under an isolated temporary directory, never a real 5GC Package.
    const prepared=await nativeCommand("skillStudio.internal.prepareSyntheticEditorTabAcceptance");
    if(prepared?.ready!==true||prepared?.syntheticOnly!==true)
      throw Error("Trusted synthetic Editor Tab fixture did not prepare");
    const positiveProposal={
      schema:"ca-studio.ai-model-proposal/v1",
      summary:"Synthetic Editor Tab proposal: adjust the final failure terminal.",
      plan:["Preserve all stages and change only the final postcondition FAIL route."],
      operations:[{
        type:"stage.route.set",
        target:{nodeId:"final",stage:"postcondition",outcome:"FAIL"},
        payload:{targetNodeId:"FAILED"},
        rationale:"Prove the exact model-shaped patch and Compiler-qualified UI Apply.",
        references:["procedure-current"]
      }],
      assumptions:[],blockers:[]
    };
    const positiveRequests=[];
    const positiveGateway=createServer((req,res)=>{
      if(req.method!=="POST"||req.url!=="/opencode-go/openai/v1/chat/completions"){
        res.writeHead(404).end();return;
      }
      const chunks=[];
      req.on("data",chunk=>chunks.push(chunk));
      req.on("end",()=>{
        try{
          const body=JSON.parse(Buffer.concat(chunks).toString("utf8"));
          positiveRequests.push({model:body.model,session:req.headers["x-opencode-session"]});
          res.writeHead(200,{"Content-Type":"application/json"});
          res.end(JSON.stringify({
            id:"synthetic-editor-tab-compiler-pass",
            object:"chat.completion",
            model:body.model,
            choices:[{
              index:0,
              message:{role:"assistant",content:JSON.stringify(positiveProposal)},
              finish_reason:"stop"
            }]
          }));
        }catch{
          res.writeHead(400).end("Invalid synthetic Gateway request");
        }
      });
    });
    await new Promise(resolve=>positiveGateway.listen(0,"127.0.0.1",resolve));
    try{
      const syntheticGatewayUrl="http://127.0.0.1:"+
        positiveGateway.address().port+"/opencode-go/openai";
      await nativeCommand("skillStudio.internal.configureAiGatewayAcceptance",{
        gatewayUrl:syntheticGatewayUrl,modelId:"deepseek-v4.1-flash"
      });
      const opened=await nativeCommand("skillStudio.openAiAuthoring");
      if(opened!==true)throw Error("Synthetic production Editor Tab did not open");
      let positiveReady=false;
      for(let attempt=0;attempt<100;attempt++){
        const view=await readAiView();
        if(view?.gatewayConfigured&&view.bodyText.includes("example")&&
           view.contextText.includes("上下文来源")){
          positiveReady=true;break;
        }
        await sleep(100);
      }
      if(!positiveReady)
        throw Error("Synthetic production Editor Tab context is not ready");
      const task="Change only the synthetic final postcondition FAIL route from SAFE_STOPPED to FAILED. Keep every other route and all nodes unchanged.";
      const clicked=await command("Runtime.evaluate",{
        contextId:aiContextId,
        returnByValue:true,
        expression:"(()=>{const task=document.getElementById('task');"+
          "const button=document.getElementById('sendTask');"+
          "document.getElementById('sendMode').value='generate';"+
          "if(!task||!button||button.disabled)return false;"+
          "task.value="+JSON.stringify(task)+";"+
          "task.dispatchEvent(new Event('input',{bubbles:true}));"+
          "button.click();return true;})()"
      });
      if(clicked.result?.value!==true)
        throw Error("Synthetic Editor Tab Generate control is disabled");
      let approval=null;
      for(let attempt=0;attempt<100&&!approval;attempt++){
        approval=await evalJS(
          "(()=>{const button=[...document.querySelectorAll('button,[role=\\\"button\\\"]')]"+
          ".find(item=>item.innerText.trim()==='发送并生成提案'&&"+
          "item.getBoundingClientRect().width>0);"+
          "if(!button)return null;const r=button.getBoundingClientRect();"+
          "return {x:r.left+r.width/2,y:r.top+r.height/2}})()");
        if(!approval)await sleep(100);
      }
      if(!approval)throw Error("Synthetic Editor Tab disclosure approval was missing");
      await command("Input.dispatchMouseEvent",{type:"mouseMoved",x:approval.x,y:approval.y});
      await command("Input.dispatchMouseEvent",{type:"mousePressed",x:approval.x,y:approval.y,button:"left",clickCount:1});
      await command("Input.dispatchMouseEvent",{type:"mouseReleased",x:approval.x,y:approval.y,button:"left",clickCount:1});
      let readyView=null;
      const qualifiedDeadline=Date.now()+70000;
      while(Date.now()<qualifiedDeadline&&!readyView){
        const view=await readAiView();
        if(view?.candidateSource.includes("FAIL: FAILED")&&
           view.compilerStatus.includes("Compiler v2.0.2 Check: PASS")&&
           view.applyDisabled===false)readyView=view;
        if(!readyView)await sleep(100);
      }
      if(!readyView){
        const view=await readAiView();
        throw Error("Production Editor Tab did not yield qualified synthetic Apply: "+
          JSON.stringify({requests:positiveRequests.length,
            compilerStatus:view?.compilerStatus,patchState:view?.patchState,
            patchError:view?.patchError,applyDisabled:view?.applyDisabled,
            status:view?.statusText}));
      }
      if(positiveRequests.length!==1||
         positiveRequests[0].model!=="deepseek-v4.1-flash"||
         !positiveRequests[0].session)
        throw Error("Expected one Host-owned model request for synthetic Editor Tab");
      await switchWorkspaceMode('Console');
      await switchWorkspaceMode('AI Workbench');
      const qualifiedAfterSwitch=await readAiView();
      if(qualifiedAfterSwitch?.applyDisabled!==false ||
         qualifiedAfterSwitch.candidateSource!==readyView.candidateSource)
        throw Error("Mode round trip lost the Compiler-qualified candidate");
      const applied=await command("Runtime.evaluate",{
        contextId:aiContextId,
        returnByValue:true,
        expression:"(()=>{const button=document.getElementById('apply');"+
          "if(!button||button.disabled)return false;button.click();return true;})()"
      });
      if(applied.result?.value!==true)
        throw Error("Compiler-qualified Editor Tab Apply button was not clickable");
      const verified=await nativeCommand("skillStudio.internal.verifySyntheticEditorTabApplied");
      if(verified?.nativeWorkspaceEdit!=="PASS"||
         verified?.unsavedDiskUnchanged!==true||verified?.autoSaved!==false)
        throw Error("Editor Tab did not apply only to the native unsaved buffer");
      const undoCommandForTab=await evalJS(
        "(async()=>{const c=window.theia.container;"+
        "const key=[...c._bindingDictionary._map.keys()].find(k=>"+
        "typeof k==='function'&&k.prototype?.executeCommand&&"+
        "k.prototype?.registerCommand&&k.prototype?.getCommand);"+
        "const commands=c.get(key);"+
        "const enabled=['undo','core.undo'].find(id=>"+
        "commands.getCommand(id)&&commands.isEnabled(id));"+
        "if(!enabled)throw Error('Frontend Undo unavailable');"+
        "await commands.executeCommand(enabled);return enabled;})()");
      const restored=await nativeCommand("skillStudio.internal.verifySyntheticEditorTabUndo");
      if(restored?.nativeUndo!=="PASS"||restored?.restoredOriginal!==true||
         restored?.unsavedDiskUnchanged!==true)
        throw Error("Production Editor Tab frontend Undo did not restore synthetic source");
      console.log("STUDIO_AI_EDITOR_TAB_SYNTHETIC_PROPOSAL_COMPILER_APPLY_UNDO_PASS",
        JSON.stringify({
          qualification:"SYNTHETIC_TEST_ONLY",modelSource:"MOCK_GATEWAY",
          modelProposalSchema:"PASS",selectedPatch:"PASS",
          compilerVersion:"v2.0.2",compilerCheck:"PASS",
          nativeWorkspaceEdit:"PASS",frontendUndo:"PASS",
          unsavedDiskUnchanged:true,autoSaved:false,
          undoCommand:undoCommandForTab,
          realProvider:"NOT_CLAIMED",real5gcQualification:"NOT_CLAIMED"
        }));
    }finally{
      try{
        await nativeCommand("skillStudio.internal.configureAiGatewayAcceptance",{
          gatewayUrl:"",modelId:"deepseek-v4.1-flash"
        });
      }catch{}
      await new Promise(resolve=>positiveGateway.close(resolve));
    }
  }
  if(requireEditor){
    const nativeSidebar=await evalJS(`(async()=>{
      const c=window.theia.container;
      const keys=[...c._bindingDictionary._map.keys()];
      const commandKey=keys.find(k=>typeof k==='function'&&k.prototype?.executeCommand&&k.prototype?.getCommand);
      const shellKey=keys.find(k=>typeof k==='function'&&k.prototype?.getWidgets&&k.prototype?.activateWidget);
      const commands=c.get(commandKey),shell=c.get(shellKey);
      const find=()=>shell.getWidgets('right').find(item=>item.id==='chat-view-widget');
      if(!find()?.isVisible)await commands.executeCommand('aiChat:toggle');
      return {visible:find()?.isVisible===true,groups:window.__skillStudioFixedEditorLayout().tabBarCount};
    })()`);
    if(nativeSidebar?.visible!==true||nativeSidebar.groups!==1)
      throw Error("Theia native AI Chat did not open in the existing right sidebar: "+JSON.stringify(nativeSidebar));
    console.log("STUDIO_NATIVE_SKILL_CHAT_SIDEBAR_CHROMIUM_PASS");
    if(!externalUrl){
      // In the static build, the safety notice must remain visible at both
      // widths without covering any part of the real native Chat sidebar.
      for(const width of [1440, 960]){
        await command("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:false});
        const noteLayout=await evalJS(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>{
          const note=document.getElementById('skill-studio-preview-warning');
          const chat=document.getElementById('chat-view-widget');
          const warning=note?.getBoundingClientRect(),sidebar=chat?.getBoundingClientRect();
          if(!warning||!sidebar){resolve(null);return;}
          const overlaps=warning.left<sidebar.right&&warning.right>sidebar.left&&
            warning.top<sidebar.bottom&&warning.bottom>sidebar.top;
          resolve({visible:warning.width>0&&warning.height>0&&getComputedStyle(note).visibility==='visible',
            docked:note.closest('#skill-studio-workspace-mode')!==null,overlaps,
            sidebarVisible:sidebar.width>0&&sidebar.height>0});
        })))`);
        if(!noteLayout?.visible||!noteLayout.docked||noteLayout.overlaps||!noteLayout.sidebarVisible)
          throw Error("Static safety notice overlapped or disappeared next to native AI Chat at "+width+"px: "+
            JSON.stringify(noteLayout));
      }
      console.log("STUDIO_NATIVE_CHAT_WARNING_NO_OVERLAP_CHROMIUM_PASS");
    }
  }
  if(requireEditor&&requireBrowserLsp){
    const readonly=await evalJS(`(async()=>{
      const c=window.theia?.container;
      if(!c)throw Error('Theia container unavailable');
      const key=[...(c._bindingDictionary?._map?.keys?.()??[])].find(k=>
        typeof k==='function'&&k.prototype?.executeCommand&&
        k.prototype?.registerCommand&&k.prototype?.getCommand);
      if(!key)throw Error('Native Theia command service missing');
      return await c.get(key).executeCommand(
        'skillStudio.internal.interfaceReadonlySourceAcceptance');
    })()`);
    if(readonly?.syntheticOnly!==true||
       readonly?.scheme!=='skill-studio-dependency'||
       readonly?.languageId!=='json'||readonly?.sourceUnchanged!==true||
       readonly?.editorColumn!==1||
       !readonly?.virtualPath?.includes('/schemas/source-probe.schema.json'))
      throw Error("Native Theia readonly Interface Schema source/Preview failed: "+
        JSON.stringify(readonly));
    console.log("STUDIO_INTERFACE_SCHEMA_NATIVE_READONLY_CHROMIUM_PASS",
      JSON.stringify(readonly));
  }
  if(requireEditor&&requireBrowserLsp){
    const started=await evalJS("(()=>{"+
      "const c=window.theia.container;"+
      "const k=[...c._bindingDictionary._map.keys()].find(k=>"+
      "typeof k==='function'&&k.prototype?.executeCommand&&"+
      "k.prototype?.registerCommand&&k.prototype?.getCommand);"+
      "if(!k)throw Error('Theia command service unavailable');"+
      "window.__studioZipPickerAcceptance=c.get(k).executeCommand("+
      "'skillStudio.internal.browserZipPickerAcceptance');"+
      "return true;})()");
    if(started!==true)throw Error("Cannot open browser-local ZIP picker");
    let fileInput=null;
    for(let attempt=0;attempt<60&&!fileInput;attempt++){
      const tree=await command("Page.getFrameTree");
      const frames=[],collect=node=>{
        if(!node)return;frames.push(node.frame);
        for(const child of node.childFrames??[])collect(child);
      };
      collect(tree.frameTree);
      for(const frame of frames.filter(f=>/webview/i.test(f.url??""))){
        try{
          const world=await command("Page.createIsolatedWorld",{
            frameId:frame.id,worldName:"studio-browser-zip-file-input",
            grantUniveralAccess:true
          });
          const result=await command("Runtime.evaluate",{
            contextId:world.executionContextId,
            returnByValue:true,awaitPromise:true,
            expression:"(()=>({input:!!document.querySelector('input[type=file]'),"+
              "csp:document.querySelector('meta[http-equiv=Content-Security-Policy]')?.content??''}))()"
          });
          if(result.result?.value?.input){
            fileInput={contextId:world.executionContextId,...result.result.value};
            break;
          }
        }catch{}
      }
      if(!fileInput)await sleep(150);
    }
    if(!fileInput||!fileInput.csp.includes("script-src 'nonce-"))
      throw Error("Browser ZIP device file input/CSP was not rendered: "+
        JSON.stringify(fileInput));
    await command("Runtime.evaluate",{
      contextId:fileInput.contextId,returnByValue:true,
      expression:"document.getElementById('cancel').click();true"
    });
    const cancelled=await evalJS("window.__studioZipPickerAcceptance");
    if(cancelled?.status!=="CANCELLED")
      throw Error("Browser ZIP picker did not cancel cleanly: "+JSON.stringify(cancelled));
    console.log("STUDIO_BROWSER_LOCAL_INTERFACE_ZIP_PICKER_CHROMIUM_PASS",JSON.stringify({
      input:true,nonceCsp:true,cancellation:"PASS",projectFilesUnchanged:true
    }));
    // Actual Chrome DOM.setFileInputFiles -> HTML File API -> chunked webview
    // bridge -> extension host -> formal ZIP/manifest/hash decoder. Synthetic
    // release-shaped bytes; no project lock or Owner trust is created.
    const syntheticSchema=JSON.stringify({
      $schema:'https://json-schema.org/draft/2020-12/schema',
      $id:'urn:wtlab:browser-upload-probe:v1',
      type:'object',properties:{supi:{type:'string'}}
    });
    const hash=source=>'sha256:'+createHash('sha256')
      .update(new TextEncoder().encode(source)).digest('hex');
    const syntheticManifest={
      apiVersion:'connectionagent.io/interface-package/v1alpha1',
      languageTarget:'connectionagent.io/v1alpha5',
      packageId:'urn:wtlab:browser-upload-acceptance',
      version:'1.0.0',publisher:'wtlab',
      dependencies:[],
      files:[{path:'schemas/input.schema.json',sha256:hash(syntheticSchema)}],
      exports:[{kind:'Schema',id:'urn:wtlab:browser-upload-probe:v1',
        path:'schemas/input.schema.json'}]
    };
    const syntheticZip=zipPackage([
      {path:'package.json',text:JSON.stringify(syntheticManifest)},
      {path:'schemas/input.schema.json',text:syntheticSchema}
    ]);
    const uploadPath=join(profile,'synthetic-interface-package.zip');
    await writeFile(uploadPath,syntheticZip);
    const accepted=await evalJS("(()=>{"+
      "const c=window.theia.container;"+
      "const k=[...c._bindingDictionary._map.keys()].find(k=>"+
      "typeof k==='function'&&k.prototype?.executeCommand&&"+
      "k.prototype?.registerCommand&&k.prototype?.getCommand);"+
      "window.__studioZipPickerUploaded=c.get(k).executeCommand("+
      "'skillStudio.internal.browserZipPickerAcceptance');"+
      "return true;})()");
    if(accepted!==true)throw Error('Browser ZIP upload command did not open');
    let inputObjectId=null;
    for(let attempt=0;attempt<80&&!inputObjectId;attempt++){
      const tree=await command('Page.getFrameTree');
      const frames=[],walk=node=>{
        if(!node)return;frames.push(node.frame);
        for(const child of node.childFrames??[])walk(child);
      };
      walk(tree.frameTree);
      for(const frame of frames.filter(item=>/webview/i.test(item.url??''))){
        try{
          const world=await command('Page.createIsolatedWorld',{
            frameId:frame.id,worldName:'studio-upload-file-selection',
            grantUniveralAccess:true
          });
          const evaluated=await command('Runtime.evaluate',{
            contextId:world.executionContextId,
            expression:"document.querySelector('input[type=file]')",
            returnByValue:false
          });
          inputObjectId=evaluated.result?.objectId??null;
          if(inputObjectId)break;
        }catch{}
      }
      if(!inputObjectId)await sleep(150);
    }
    if(!inputObjectId)
      throw Error('Native browser File API input not found for ZIP upload');
    await command('DOM.setFileInputFiles',{
      files:[uploadPath],objectId:inputObjectId
    });
    const imported=await evalJS('window.__studioZipPickerUploaded');
    const expectedDigest='sha256:'+createHash('sha256')
      .update(syntheticZip).digest('hex');
    if(imported?.status!=='VERIFIED'||imported.syntheticOnly!==true||
       imported.packageId!==syntheticManifest.packageId||
       imported.version!=='1.0.0'||imported.digest!==expectedDigest||
       imported.bytes!==syntheticZip.length||imported.exportCount!==1)
      throw Error('Browser File API ZIP upload or manifest verification failed: '+
        JSON.stringify(imported));
    console.log('STUDIO_BROWSER_DEVICE_INTERFACE_ZIP_UPLOAD_CHROMIUM_PASS',JSON.stringify({
      qualification:'SYNTHETIC_ONLY',fileInput:true,chunkedWebviewTransfer:true,
      sha256Verified:true,manifestVerified:true,workspaceLockUnchanged:true
    }));

  }
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

