// Real Chromium smoke for both Theia browser-only static preview and the
// normal backend-backed browser host. Static mode uses an explicitly isolated
// same-origin demo-only webview adapter; backend mode uses Theia's normal host.
import {createServer} from "node:http";
import {createReadStream,existsSync} from "node:fs";
import {mkdtemp,readFile,rm} from "node:fs/promises";
import {spawn} from "node:child_process";
import {tmpdir} from "node:os";
import {extname,join,resolve,sep} from "node:path";

const root=resolve("experiments/ide-host/theia-online/lib/frontend");
const externalUrl=process.env.THEIA_URL;
const basePath=(process.env.THEIA_BASE_PATH||"").replace(/\/+$/,"");
const requireWebview=process.env.THEIA_REQUIRE_WEBVIEW==="1";
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
const server=externalUrl?null:createServer((req,res)=>{
  const url=new URL(req.url,"http://localhost");
  let name;
  try{name=decodeURIComponent(url.pathname);}catch{res.writeHead(400).end();return;}
  if(basePath){
    if(name!==basePath&&!name.startsWith(basePath+"/")){res.writeHead(404).end();return;}
    name=name.slice(basePath.length)||"/";
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
const url=externalUrl||("http://127.0.0.1:"+server.address().port+basePath+"/");
const profile=await mkdtemp(join(tmpdir(),"theia-online-chrome-"));
const child=spawn(chrome,["--headless=new","--no-sandbox","--disable-gpu",
  "--disable-dev-shm-usage","--no-first-run","--no-default-browser-check",
  "--remote-debugging-port=0","--user-data-dir="+profile,"about:blank"],{stdio:"ignore"});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let ws,seq=0;const pending=new Map(),exceptions=[],consoleErrors=[];
const command=(method,params={})=>new Promise((resolve,reject)=>{
  const id=++seq;pending.set(id,{resolve,reject});
  ws.send(JSON.stringify({id,method,params}));
});
const evalJS=async expression=>{
  const data=await command("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});
  if(data.exceptionDetails)throw Error("Chromium evaluate: "+data.exceptionDetails.text);
  return data.result?.value;
};
try{
  let port=null;
  for(let i=0;i<250;i++){
    try{port=Number((await readFile(join(profile,"DevToolsActivePort"),"utf8")).split("\n")[0]);break;}
    catch{if(child.exitCode!==null)throw Error("Chrome exited "+child.exitCode);}
    await sleep(100);
  }
  if(!port)throw Error("Chrome DevTools debugging port unavailable");
  const tabs=await(await fetch("http://127.0.0.1:"+port+"/json")).json();
  const page=tabs.find(t=>t.type==="page");
  if(!page)throw Error("Chromium page target absent");
  ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok,fail)=>{ws.addEventListener("open",ok,{once:true});
    ws.addEventListener("error",fail,{once:true});});
  ws.addEventListener("message",event=>{
    const msg=JSON.parse(event.data);
    if(msg.method==="Runtime.exceptionThrown")
      exceptions.push(msg.params?.exceptionDetails?.exception?.description||msg.params?.exceptionDetails?.text);
    if(msg.method==="Network.loadingFailed")
      networkFailures.push({requestId:msg.params.requestId,errorText:msg.params.errorText,
        canceled:msg.params.canceled,blockedReason:msg.params.blockedReason});
    if(msg.method==="Network.responseReceived"&&networkResponses.length<80)
      networkResponses.push({url:msg.params.response.url,status:msg.params.response.status,
        type:msg.params.type});
    if(msg.method==="Runtime.consoleAPICalled"&&msg.params?.type==="error")
      consoleErrors.push(msg.params.args?.map(x=>x.value||x.description).join(" "));
    if(msg.id&&pending.has(msg.id)){
      const call=pending.get(msg.id);pending.delete(msg.id);
      if(msg.error)call.reject(Error(msg.error.message));else call.resolve(msg.result);
    }
  });
  await command("Page.enable");
  await command("Runtime.enable");
  await command("Network.enable");
  await command("Page.navigate",{url});
  let view=null;
  for(let i=0;i<250;i++){
    view=await evalJS(`({
      readyState:document.readyState,title:document.title,
      text:document.body?.innerText?.slice(0,950)||"",
      appShell:!!document.querySelector("#theia-app-shell"),
      classicIcons:(()=>{
        const link=document.querySelector("#skill-studio-classic-icon-theme");
        const icons=[...document.querySelectorAll(".theia-app-sides .codicon")];
        const mapped=icons.filter(icon=>
          getComputedStyle(icon,"::before").maskImage.includes("data:image/svg+xml")
        ).length;
        return {loaded:Boolean(link?.sheet),activityIcons:icons.length,mapped};
      })(),
      brand:(()=>{
        const brand=document.querySelector('[id="theia:menubar"].lm-MenuBar > .skill-studio-brand');
        const bar=brand?.parentElement;
        const content=bar&&Array.from(bar.children).find(child=>
          child.classList.contains("lm-MenuBar-content")
        );
        const a=brand?.getBoundingClientRect();
        const b=content?.getBoundingClientRect();
        const nativeMenus=content?(content.textContent||"").replace(/\\s+/g," ").trim():"";
        return {
          present:Boolean(brand),
          label:brand?.querySelector(".skill-studio-brand-label")?.textContent.trim()||"",
          stylesheet:Boolean(document.querySelector("#skill-studio-brand-theme")?.sheet),
          beforeNativeMenus:Boolean(brand&&content&&brand.nextElementSibling===content),
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
    const node=[...document.querySelectorAll('.monaco-list-row')].find(x=>x.innerText.includes('SKILL Studio: Load Example'));
    if(!node)return null;const r=node.getBoundingClientRect();
    return {x:r.left+r.width/2,y:r.top+r.height/2,text:node.innerText};
  })()`);
  if(loadExampleRow){
    await command("Input.dispatchMouseEvent",{type:"mouseMoved",x:loadExampleRow.x,y:loadExampleRow.y});
    await command("Input.dispatchMouseEvent",{type:"mousePressed",x:loadExampleRow.x,y:loadExampleRow.y,button:"left",clickCount:1});
    await command("Input.dispatchMouseEvent",{type:"mouseReleased",x:loadExampleRow.x,y:loadExampleRow.y,button:"left",clickCount:1});
    await sleep(3400);
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
      bodyText:document.body.innerText.slice(-1400),
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
  const graphFrame=webviewFrames.find(item=>item.view?.procedureRoot&&item.view.graphNodes>0);
  const webviewFrame=graphFrame?.frame??webviewFrames[0]?.frame??null;
  let webviewView=graphFrame?.view??webviewFrames[0]?.view??null;
  const webviewFrameError=webviewFrames.find(item=>item.error)?.error??null;
  let patchEvidence=null;
  if(graphFrame){
    const world=await command("Page.createIsolatedWorld",{
      frameId:graphFrame.frame.id,worldName:"skill-studio-patch-acceptance",grantUniveralAccess:true
    });
    const preview=await command("Runtime.evaluate",{
      contextId:world.executionContextId,returnByValue:true,awaitPromise:true,
      expression:`(()=>{
        const routes=document.querySelector("#routeList");
        const targets=document.querySelector("#targetList");
        if(!routes||!targets||routes.options.length<1)
          return {ready:false,reason:"No source-qualified Route choices",routeOptions:routes?.options.length??0};
        routes.selectedIndex=0;
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
      patchEvidence.sourceEditor=sourceEditor;
      patchEvidence.undo=undoFrames[0]??null;

      // The Classic one-hop Node view is reused inside the host CustomEditor:
      // real neighbor Nodes/Routes plus read-only PRE/OP/POST stages.
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
    }else{
      patchEvidence={preview:previewEvidence,applied:null};
    }
  }
  const listingResponse=await fetch(url+"hostedPlugin/list.json");
  const listing=await listingResponse.text();
  const evidence={view,warningDismissed,diagnostics,paletteBefore,paletteAfter,viewPosition,viewMenu,paletteItemPos,paletteMenuOpened,registeredCommands,loadExampleRow,afterImport,
    frameCount:frames.length,frameUrls:frames.map(frame=>frame.url),webviewFrames,webviewFrame,webviewView,webviewFrameError,patchEvidence,
    extensionListStatus:listingResponse.status,extensionListPreview:listing.slice(0,500),
    extensionListPresent:listing.includes("ca-skill-studio-ide-spike"),
    requested:requests.size,notFound:[...notFound].slice(0,15),
    networkFailures:networkFailures.slice(-15),networkResponses:networkResponses.slice(-30),
    consoleErrors:consoleErrors.slice(0,8),exceptions:exceptions.slice(0,6)};
  console.log("STUDIO_THEIA_REAL_CHROMIUM",JSON.stringify(evidence));
  if(!view?.appShell||view.widgets<5||view.bodyLength<15)
    throw Error("Theia browser shell failed to start: "+JSON.stringify(evidence).slice(0,2200));
  if(!view?.classicIcons?.loaded||view.classicIcons.mapped<1)
    throw Error("Classic icon artwork was not applied to Theia shell controls: "+
      JSON.stringify(view?.classicIcons).slice(0,1200));
  if(!afterImport.notificationText.some(message=>message.includes("示例 SKILL 已载入浏览器工作区"))||
     !afterImport.bodyText.includes("establish-pdu-session")||
     !afterImport.bodyText.includes("procedure.yaml"))
    throw Error("Theia sample import into browser workspace failed: "+JSON.stringify({afterImport,registeredCommands}).slice(0,3000));
  if(requireEditor&&(!webviewFrame||!webviewView?.procedureRoot||webviewView.graphNodes<1))
    throw Error("Procedure Custom Editor webview did not render a graph: "+
      JSON.stringify({webviewFrame,webviewView,webviewFrameError,networkFailures}).slice(0,3000));
  if(requireEditor&&(!patchEvidence?.preview?.ready||
      !String(patchEvidence.preview.diff).includes("-")||
      !String(patchEvidence.preview.diff).includes("+")||
      !/TextDocument v[2-9]/.test(patchEvidence.applied?.revision??"")))
    throw Error("Source-backed Patch preview/apply did not update the TextDocument: "+
      JSON.stringify(patchEvidence).slice(0,3000));
  if(requireEditor&&(!(patchEvidence.sourceEditor?.monacoEditors>0)||
      !/TextDocument v[3-9]/.test(patchEvidence.undo?.revision??"")||
      patchEvidence.undo?.graphEdges!==46))
    throw Error("Native Source editor/undo did not restore the original Procedure projection: "+
      JSON.stringify(patchEvidence).slice(0,3000));
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
      !patchEvidence.nodeFocus?.returned?.mainGraphVisible))
    throw Error("Theia Node Focus / PRE-OP-POST / Source line jump acceptance failed: "+
      JSON.stringify(patchEvidence.nodeFocus).slice(0,3500));
  if(requireEditor)
    console.log("THEIA_SAMPLE_IMPORT_PASS; CLASSIC_SHELL_ICONS_PASS; SKILL_STUDIO_BRAND_PASS; PROCEDURE_CUSTOM_EDITOR_GRAPH_PASS; SOURCE_PATCH_APPLY_PASS; NATIVE_SOURCE_UNDO_PASS; NODE_FOCUS_PRE_OP_POST_PASS; SOURCE_LINE_JUMP_PASS");
  else
    console.log("THEIA_BROWSER_ONLY_SAMPLE_IMPORT_PASS; CLASSIC_SHELL_ICONS_PASS; SKILL_STUDIO_BRAND_PASS; WEBVIEW_CUSTOM_EDITOR_NOT_REQUIRED");
}finally{
  ws?.close();child.kill("SIGKILL");
  if(server?.listening)await new Promise(ok=>server.close(ok));
  await rm(profile,{recursive:true,force:true,maxRetries:4,retryDelay:200});
}
