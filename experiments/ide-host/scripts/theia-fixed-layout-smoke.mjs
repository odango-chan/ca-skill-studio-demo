import {createServer} from "node:http";
import {createReadStream,existsSync} from "node:fs";
import {mkdtemp,readFile,rm} from "node:fs/promises";
import {spawn} from "node:child_process";
import {tmpdir} from "node:os";
import {extname,join,resolve,sep} from "node:path";

const root=resolve("experiments/ide-host/theia-online/lib/frontend");
const basePath=(process.env.THEIA_BASE_PATH||"").replace(/\/+$/,"");
const chrome=process.env.CHROME_BIN||
  ["/usr/bin/google-chrome","/usr/bin/google-chrome-stable","/usr/bin/chromium"].find(existsSync);
if(!existsSync(join(root,"index.html")))throw Error("Theia frontend missing");
if(!chrome)throw Error("Chrome unavailable; fixed-layout acceptance NOT_RUN");

const types={".html":"text/html",".js":"text/javascript",".css":"text/css",
  ".json":"application/json",".svg":"image/svg+xml",".wasm":"application/wasm",
  ".ttf":"font/ttf",".woff":"font/woff",".woff2":"font/woff2",".png":"image/png",
  ".ico":"image/x-icon",".map":"application/json"};
const server=createServer((req,res)=>{
  const url=new URL(req.url,"http://localhost");
  let name;
  try{name=decodeURIComponent(url.pathname);}catch{res.writeHead(400).end();return;}
  if(basePath){
    if(name===basePath||name.startsWith(basePath+"/"))name=name.slice(basePath.length)||"/";
    else{res.writeHead(404).end();return;}
  }
  const file=resolve(root,"."+name.replace(/\/$/,"/index.html"));
  if(file!==root&&!file.startsWith(root+sep)){res.writeHead(403).end();return;}
  const stream=createReadStream(file);
  stream.on("error",()=>{if(!res.headersSent)res.writeHead(404);res.end();});
  stream.on("open",()=>{
    res.writeHead(200,{"Content-Type":types[extname(file)]||"application/octet-stream",
      "Cache-Control":"no-store"});stream.pipe(res);
  });
});
await new Promise(ok=>server.listen(0,"127.0.0.1",ok));

const profile=await mkdtemp(join(tmpdir(),"theia-fixed-layout-"));
const child=spawn(chrome,["--headless=new","--no-sandbox","--disable-gpu",
  "--disable-dev-shm-usage","--no-first-run","--no-default-browser-check",
  "--disable-background-networking","--disable-extensions",
  "--remote-debugging-port=0","--user-data-dir="+profile,"about:blank"],
  {stdio:["ignore","ignore","pipe"]});
let stderr="";
child.stderr?.on("data",chunk=>{stderr=(stderr+chunk.toString()).slice(-4000);});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let ws,sequence=0;
const pending=new Map();
const command=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
  const id=++sequence;
  const timer=setTimeout(()=>{
    pending.delete(id);
    reject(Error("Chromium command timed out: "+method));
  },30000);
  pending.set(id,{resolve,reject,timer});
  ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
});
const evaluate=async expression=>{
  const result=await command("Runtime.evaluate",{
    expression,returnByValue:true,awaitPromise:true
  });
  if(result.exceptionDetails)throw Error("Chromium evaluate failed: "+
    (result.exceptionDetails.exception?.description??result.exceptionDetails.text));
  return result.result?.value;
};
try{
  let port=null;
  for(let i=0;i<600;i++){
    try{port=Number((await readFile(join(profile,"DevToolsActivePort"),"utf8")).split("\n")[0]);break;}
    catch{
      if(child.exitCode!==null)throw Error("Chrome exited before DevTools startup: "+
        JSON.stringify({code:child.exitCode,signal:child.signalCode,stderr}));
    }
    await sleep(100);
  }
  if(!port)throw Error("Chrome DevTools port unavailable: "+stderr);
  const tabs=await(await fetch("http://127.0.0.1:"+port+"/json")).json();
  const page=tabs.find(tab=>tab.type==="page");
  if(!page)throw Error("Chromium page target absent");
  ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{
    ws.addEventListener("open",resolve,{once:true});
    ws.addEventListener("error",reject,{once:true});
  });
  ws.addEventListener("message",event=>{
    const message=JSON.parse(event.data);
    if(message.id&&pending.has(message.id)){
      const call=pending.get(message.id);pending.delete(message.id);
      clearTimeout(call.timer);
      if(message.error)call.reject(Error(message.error.message));
      else call.resolve(message.result);
    }
  });
  await command("Page.enable");
  await command("Runtime.enable");
  await command("Emulation.setDeviceMetricsOverride",{
    width:1440,height:1000,deviceScaleFactor:1,mobile:false
  });
  const target=new URL("http://127.0.0.1:"+server.address().port+basePath+"/");
  await command("Page.navigate",{url:target.toString()});

  let state=null;
  for(let attempt=0;attempt<300;attempt++){
    state=await evaluate(`(()=>{
      const inspect=window.__skillStudioFixedEditorLayout;
      return {
        readyState:document.readyState,
        title:document.title,
        appShell:!!document.querySelector("#theia-app-shell"),
        fixedPanel:!!document.querySelector(".skill-studio-fixed-editor-group"),
        layout:typeof inspect==="function"?inspect():null,
        body:document.body?.innerText?.slice(0,400)??""
      };
    })()`);
    if(state?.appShell&&state?.layout)break;
    await sleep(100);
  }
  console.log("STUDIO_THEIA_FIXED_EDITOR_LAYOUT",JSON.stringify(state));
  if(!state?.appShell||!state.fixedPanel||state.layout?.mode!=="single-document"||
     !Number.isSafeInteger(state.layout?.tabBarCount)||state.layout.tabBarCount>1)
    throw Error("Theia Main Editor did not enforce a single-document DockPanel: "+
      JSON.stringify(state));
  console.log("THEIA_FIXED_EDITOR_LAYOUT_SMOKE_PASS");

  // Regression: browser tabs share localStorage, but their first Preview
  // reveal must be independent. Earlier production builds persisted a
  // site-wide one-shot flag, causing tab B's YAML Preview to stay hidden
  // after tab A had successfully opened Markdown.
  const originalTab=await evaluate(`(()=>{
    const id=window.location.hash;
    const key="skill-studio.preview.auto-revealed.v2:"+id;
    window.localStorage.setItem("skill-studio.preview.auto-revealed.v1","1");
    window.sessionStorage.setItem(key,"1");
    return {url:window.location.href,key,
      legacyFlag:window.localStorage.getItem("skill-studio.preview.auto-revealed.v1"),
      tabFlag:window.sessionStorage.getItem(key)};
  })()`);
  if(originalTab.legacyFlag!=="1"||originalTab.tabFlag!=="1")
    throw Error("Could not seed the first tab's Preview state");
  const created=await command("Target.createTarget",{url:originalTab.url});
  if(!created?.targetId)throw Error("Could not open an independent Chromium tab");
  const attached=await command("Target.attachToTarget",{
    targetId:created.targetId,flatten:true
  });
  if(!attached?.sessionId)throw Error("Could not attach to the second Chromium tab");
  const secondSession=attached.sessionId;
  await command("Runtime.enable",{},secondSession);
  let secondTab=null;
  for(let attempt=0;attempt<300;attempt++){
    const result=await command("Runtime.evaluate",{
      expression:`(()=>{
        const probe=window.__skillStudioPreviewActivation;
        if(typeof probe!=="function")return null;
        const key="skill-studio.preview.auto-revealed.v2:"+window.location.hash;
        return {url:window.location.href,key,
          legacyFlag:window.localStorage.getItem("skill-studio.preview.auto-revealed.v1"),
          tabFlag:window.sessionStorage.getItem(key),
          activation:probe()};
      })()`,
      returnByValue:true
    },secondSession);
    if(result.exceptionDetails)throw Error("Second tab evaluation failed: "+
      (result.exceptionDetails.exception?.description??result.exceptionDetails.text));
    secondTab=result.result?.value;
    if(secondTab?.activation)break;
    await sleep(100);
  }
  if(!secondTab?.activation?.autoRevealPending||
     secondTab.tabFlag!==null||secondTab.legacyFlag!=="1"||
     secondTab.key!==originalTab.key)
    throw Error("A newly opened YAML tab inherited another tab's Preview reveal: "+
      JSON.stringify({originalTab,secondTab}));
  console.log("THEIA_PREVIEW_TAB_ISOLATION_CHROMIUM_PASS",
    JSON.stringify({originalTab,secondTab}));
  await command("Target.closeTarget",{targetId:created.targetId});

}catch(error){
  console.error("THEIA_FIXED_EDITOR_LAYOUT_SMOKE_FAIL",String(error?.stack??error));
  throw error;
}finally{
  if(ws?.readyState===1){void command("Browser.close").catch(()=>{});await sleep(500);}
  ws?.close();
  child.kill("SIGKILL");
  if(server.listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  await rm(profile,{recursive:true,force:true,maxRetries:4,retryDelay:200});
}
