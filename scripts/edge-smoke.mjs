// Browser smoke via Chrome DevTools Protocol, no third-party test runtime.
import {createServer} from "node:http";
import {readFile,mkdtemp,rm} from "node:fs/promises";
import {existsSync,createReadStream} from "node:fs";
import {spawn} from "node:child_process";
import {tmpdir} from "node:os";
import {join,extname,resolve,sep} from "node:path";

const chrome=process.env.CHROME_BIN||
  ["/usr/bin/google-chrome","/usr/bin/google-chrome-stable","/usr/bin/chromium"].find(existsSync);
if(!chrome)throw Error("Chrome unavailable for browser smoke");
const dist=resolve("dist");
const types={".html":"text/html",".css":"text/css",".js":"text/javascript",".yaml":"text/yaml",".md":"text/markdown",".json":"application/json"};
const server=createServer((req,res)=>{
  const path=decodeURIComponent(new URL(req.url,"http://localhost").pathname);
  const file=resolve(dist,"."+path.replace(/\/$/,"/index.html"));
  if(file!==dist&&!file.startsWith(dist+sep)){res.writeHead(403).end();return;}
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
const pending=new Map(),exceptions=[];
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
    "    document.getElementById('layoutStatus')?.textContent!=='正在自动布局…')break;",
    "  await sleep(100);",
    " }",
    " const paths=[...document.querySelectorAll('.react-flow__edge-path')];",
    " const info=paths.map(el=>{const c=getComputedStyle(el);",
    "  let length=0;try{length=el.getTotalLength();}catch{}",
    "  return {d:el.getAttribute('d'),length,stroke:c.stroke,",
    "    opacity:c.opacity,display:c.display,visibility:c.visibility,",
    "    strokeWidth:c.strokeWidth,vectorEffect:c.vectorEffect,markerEnd:c.markerEnd};",
    " });",
    " return {nodes:document.querySelectorAll('.react-flow__node').length,",
    "  edges:paths.length,valid:info.filter(e=>e.length>1&&e.stroke!=='none'&&",
    "    e.display!=='none'&&e.visibility!=='hidden'&&",
    "    Number(e.opacity)>0&&parseFloat(e.strokeWidth)>0&&",
    "    e.vectorEffect==='non-scaling-stroke').length,",
    "  samples:info.slice(0,4),",
    "  status:document.getElementById('layoutStatus')?.textContent,",
    "  zoomTransform:getComputedStyle(document.querySelector('.react-flow__viewport')).transform,",
    "  graph:document.getElementById('graphPane')?.getBoundingClientRect().toJSON(),",
    "  styles:[...document.styleSheets].map(x=>x.href).filter(Boolean)};",
    "})()"
  ].join("\n");
  const result=await evaluate(expr);
  console.log("CREATED_SESSION_EDGE_SMOKE",JSON.stringify(result));
  if(result?.nodes!==17||result.edges<1||result.valid!==result.edges)
    throw Error("CreatedSession visible edges FAIL");
  if(exceptions.length)throw Error("Browser JS exceptions: "+JSON.stringify(exceptions));
  console.log("CreatedSession visible paths PASS: "+result.valid);
}finally{
  if(ws)ws.close();
  child.kill("SIGKILL");
  await rm(temp,{recursive:true,force:true});
  await new Promise(r=>server.close(r));
}
