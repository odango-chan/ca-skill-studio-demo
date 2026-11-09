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
      widgets:document.querySelectorAll(".lm-Widget").length,
      menus:document.querySelectorAll(".p-MenuBar-item,.lm-MenuBar-item").length,
      editor:document.querySelectorAll(".monaco-editor").length,
      bodyLength:document.body?.innerText?.length||0,
      errors:document.querySelectorAll(".theia-error").length
    })`);
    if(view?.appShell&&view.widgets>4&&view.bodyLength>15)break;
    await sleep(150);
  }
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
        const editor=editors.find(item=>{
          const rect=item.querySelector(".view-lines")?.getBoundingClientRect();
          return rect&&rect.width>0&&rect.height>0;
        });
        const lines=editor?.querySelector(".view-lines");
        const rect=lines?.getBoundingClientRect();
        return {editorCount:editors.length,ready:Boolean(rect),
          rect:rect?{x:rect.left,y:rect.top,width:rect.width,height:rect.height}:null,
          visibleText:lines?.innerText?.slice(0,500)??""};
      })()`);
      if(!editorTarget?.ready)
        throw Error("Native Theia Source editor is not visible: "+JSON.stringify(editorTarget));
      const clickX=editorTarget.rect.x+Math.min(90,editorTarget.rect.width/2);
      const clickY=editorTarget.rect.y+Math.min(18,editorTarget.rect.height/2);
      await command("Input.dispatchMouseEvent",{
        type:"mousePressed",x:clickX,y:clickY,button:"left",clickCount:1
      });
      await command("Input.dispatchMouseEvent",{
        type:"mouseReleased",x:clickX,y:clickY,button:"left",clickCount:1
      });
      // The imported sample has four DENIED routes. Starting at the top and
      // advancing once selects the one in await-initial-n4-session-establishment
      // (the second occurrence), which is the isolated create-Route fixture.
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
      await key("Home","Home",2,36);
      await key("f","KeyF",2,70);
      await command("Input.insertText",{text:"DENIED: failed"});
      await sleep(250);
      const findState=await evalJS(`({
        active:document.activeElement?.outerHTML?.slice(0,500)??"",
        value:document.activeElement?.value??"",
        findWidgets:document.querySelectorAll(".find-widget").length,
        matchCount:document.querySelector(".find-widget .matchesCount")?.textContent??""
      })`);
      if(findState.value!=="DENIED: failed"||findState.findWidgets<1)
        throw Error("Native editor Find did not receive the exact fixture query: "+JSON.stringify(findState));
      await key("Enter","Enter",0,13);
      const secondMatch=await evalJS(`({
        value:document.activeElement?.value??"",
        matchCount:document.querySelector(".find-widget .matchesCount")?.textContent??""
      })`);
      await key("Escape","Escape",0,27);
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
      const routeFixtureEditor=await evalJS(`({
        editorCount:document.querySelectorAll(".monaco-editor").length,
        active:document.activeElement?.className??"",
        visibleText:[...document.querySelectorAll(".monaco-editor .view-line")]
          .map(line=>line.innerText).join("\\n").slice(0,1400)
      })`);
      const routeFixture={
        ready:routeFixtureEditor.editorCount>0&&
          /TextDocument v\\d+/.test(routeFixtureView.result?.value?.revision??"")&&
          routeFixtureView.result?.value?.procedure==="await-initial-n4-session-establishment"&&
          routeFixtureView.result?.value?.graphEdges===routeOriginalView.result?.value?.graphEdges-1,
        editor:editorTarget,find:findState,secondMatch,
        original:routeOriginalView.result?.value??null,
        view:routeFixtureView.result?.value??null,after:routeFixtureEditor
      };
      if(!routeFixture.ready)
        throw Error("Could not prepare the isolated Route-creation fixture using the native editor: "+
          JSON.stringify(routeFixture).slice(0,3000));
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
        ready:/TextDocument v\\d+/.test(routeApplied.result?.value?.revision??""),
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
        ready:/TextDocument v\\d+/.test(routeUndo.result?.value?.revision??""),
        revision:routeUndo.result?.value?.revision??"",
        graphEdges:routeUndo.result?.value?.graphEdges??0
      };
      patchEvidence.routeCreate={
        fixture:routeFixture,gesture:routeGesture,
        proposal:routeProposalValue,preview:routePreviewValue,
        applied:routeApplied.result?.value??null,appliedSource:routeAppliedSource,
        undo:routeUndo.result?.value??null,undoSource:routeUndoSource
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
      !patchEvidence.nodeFocus?.returned?.mainGraphVisible||
      !patchEvidence.routeCreate?.fixture?.ready||
      !patchEvidence.routeCreate?.gesture?.ready||
      !patchEvidence.routeCreate?.proposal?.visible||
      !patchEvidence.routeCreate?.preview?.ready||
      !patchEvidence.routeCreate?.appliedSource?.ready||
      !patchEvidence.routeCreate?.undoSource?.ready||
      patchEvidence.routeCreate?.undoSource?.graphEdges!==
        patchEvidence.routeCreate?.fixture?.view?.graphEdges))
    throw Error("Theia Node Focus / PRE-OP-POST / Source line jump acceptance failed: "+
      JSON.stringify({nodeFocus:patchEvidence.nodeFocus,routeCreate:patchEvidence.routeCreate}).slice(0,5000));
  if(requireEditor)
    console.log("THEIA_SAMPLE_IMPORT_PASS; PROCEDURE_CUSTOM_EDITOR_GRAPH_PASS; SOURCE_PATCH_APPLY_PASS; NATIVE_SOURCE_UNDO_PASS; NODE_FOCUS_PRE_OP_POST_PASS; SOURCE_LINE_JUMP_PASS; CANVAS_ROUTE_CREATE_DIFF_APPLY_UNDO_PASS");
  else
    console.log("THEIA_BROWSER_ONLY_SAMPLE_IMPORT_PASS; WEBVIEW_CUSTOM_EDITOR_NOT_REQUIRED");
}finally{
  ws?.close();child.kill("SIGKILL");
  if(server?.listening)await new Promise(ok=>server.close(ok));
  await rm(profile,{recursive:true,force:true,maxRetries:4,retryDelay:200});
}
