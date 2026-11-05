// Windows Chrome E4-A2 native OS-file acceptance runner.
// No real Skill sources are ever read, selected or overwritten by this Node
// process. Chrome writes only after the user selects a nonce-verified fixture.
// Usage (Node 24, Windows): npm run test:e4:native
import {createServer} from "node:http";
import {createReadStream,existsSync} from "node:fs";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {spawn} from "node:child_process";
import {join,resolve} from "node:path";
import {createNativeFixture,verifyNativeFixture} from "./e4-native-fixture.mjs";

if(process.platform!=="win32"){
  console.error("E4_NATIVE_NOT_RUN: this acceptance runner requires interactive Windows Chrome.");
  process.exit(2);
}
const locations=[
  process.env.CHROME_BIN,
  process.env.PROGRAMFILES&&join(process.env.PROGRAMFILES,"Google","Chrome","Application","chrome.exe"),
  process.env["PROGRAMFILES(X86)"]&&
    join(process.env["PROGRAMFILES(X86)"],"Google","Chrome","Application","chrome.exe"),
  process.env.LOCALAPPDATA&&join(process.env.LOCALAPPDATA,"Google","Chrome","Application","chrome.exe")
].filter(Boolean);
const chrome=locations.find(existsSync);
if(!chrome){
  console.error("E4_NATIVE_NOT_RUN: Windows Google Chrome not found; set CHROME_BIN.");
  process.exit(2);
}
const base=resolve(process.env.CA_AGENT_TMPDIR||".agent-tmp");
await mkdir(base,{recursive:true});
const fixture=await createNativeFixture(base);
const profile=join(fixture.root,"chrome-profile");
const allow=new Map([
  ["/",["e4-native-accept.html","text/html;charset=utf-8"]],
  ["/harness.mjs",["e4-native-accept-browser.mjs","text/javascript;charset=utf-8"]]
]);
const siteModules=new Set([
  "directory-save.mjs","directory-import.mjs","sample-packages.mjs"
]);
let received=false,settle;
const done=new Promise(resolve=>{settle=resolve;});
const server=createServer(async(req,res)=>{
  try{
    const pathname=new URL(req.url,"http://127.0.0.1").pathname;
    res.setHeader("Cache-Control","no-store");
    res.setHeader("X-Content-Type-Options","nosniff");
    if(req.method==="GET"&&allow.has(pathname)){
      const [name,type]=allow.get(pathname);
      res.writeHead(200,{"Content-Type":type});
      createReadStream(new URL("./"+name,import.meta.url)).pipe(res);
      return;
    }
    if(req.method==="GET"&&pathname.startsWith("/site/")){
      const name=pathname.slice("/site/".length);
      if(!siteModules.has(name)){res.writeHead(404).end();return;}
      res.writeHead(200,{"Content-Type":"text/javascript;charset=utf-8"});
      createReadStream(new URL("../site/"+name,import.meta.url)).pipe(res);
      return;
    }
    if(req.method==="GET"&&pathname==="/spec"){
      const files=Object.fromEntries([...fixture.originals].map(
        ([path,bytes])=>[path,Buffer.from(bytes).toString("base64")]));
      res.writeHead(200,{"Content-Type":"application/json;charset=utf-8"});
      res.end(JSON.stringify({name:fixture.name,token:fixture.token,
        fixturePath:fixture.folder,files}));
      return;
    }
    if(req.method==="POST"&&pathname==="/report"){
      if(received){res.writeHead(409).end('Already reported');return;}
      let raw="";
      for await(const chunk of req){
        raw+=chunk;
        if(raw.length>16384){res.writeHead(413).end();return;}
      }
      const info=JSON.parse(raw);
      if(info?.token!==fixture.token||
         !["PASS","NOT_PASS"].includes(info.status)||
         !Array.isArray(info.checks)){
        res.writeHead(400).end("Invalid fixture token/report");return;
      }
      received=true;
      const diskVerification=await verifyNativeFixture(fixture.folder,fixture.token,{
        final:info.status==="PASS"
      });
      const required=[
        "DISPOSABLE_NONCE_AND_ALL_ORIGINAL_BYTES",
        "NATIVE_READWRITE_PERMISSION",
        "REAL_DISK_E4_A1_IMPORT",
        "NATIVE_WRITE_READBACK_BOM_CRLF_AND_SHORTENING",
        "UNTOUCHED_AND_BINARY_BYTES",
        "NATIVE_EXTERNAL_CONTENT_CONFLICT_NO_OVERWRITE",
        "NATIVE_ADDED_FILE_CONFLICT_NO_OVERWRITE",
        "NO_SIDECAR_FILES"
      ];
      const passed=info.status==="PASS"&&diskVerification.pass&&
        required.every(key=>info.checks.includes(key));
      const reportPath=join(fixture.root,"e4-native-acceptance.json");
      const report={
        status:passed?"PASS":"NOT_PASS",nativeOs:true,
        browserPicker:"REAL_NATIVE_OS",diskSource:"NEW_DISPOSABLE_FIXTURE",
        platform:process.platform,recordedAt:new Date().toISOString(),
        chromeExecutable:chrome,chromeUserAgent:info.chrome??null,
        checks:info.checks,failure:info.failure??null,
        diskVerification,
        limitations:[
          "Native permission-denial and forced partial OS write error NOT_RUN",
          "Not a multi-file atomic transaction or kernel CAS",
          "E4-A1 original OS folder identity is not retained"
        ]
      };
      await writeFile(reportPath,JSON.stringify(report,null,2)+"\n",{flag:"wx"});
      res.writeHead(passed?200:409,{"Content-Type":"application/json;charset=utf-8"});
      res.end(JSON.stringify({accepted:passed,reportPath,diskVerification}));
      settle({passed,reportPath,diskVerification});
      return;
    }
    res.writeHead(404).end();
  }catch(error){
    if(!res.headersSent)res.writeHead(500);
    res.end("Acceptance server error");
    console.error("E4_NATIVE_SERVER_ERROR: "+String(error));
  }
});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
const address="http://127.0.0.1:"+server.address().port+"/";
console.log("E4_NATIVE_FIXTURE: "+fixture.folder);
console.log("E4_NATIVE_ACTION: In the opened Chrome page click '选择临时测试目录并开始验收', select ONLY the path above, and approve the test-directory write.");
console.log("E4_NATIVE_LIMIT: Browser native folder selection/permission cannot be silently automated.");
const child=spawn(chrome,[
  "--user-data-dir="+profile,
  "--no-first-run","--no-default-browser-check","--new-window",address
],{stdio:"ignore"});
// Node stays alive only for its local server; no need to close Chrome
// manually before recording the result. Never kill other Chrome processes.
child.unref();
child.on("error",error=>{
  console.error("E4_NATIVE_CHROME_START_FAILED: "+String(error));
  settle({passed:false,error:String(error)});
});
const timeout=new Promise(resolve=>{
  const timer=setTimeout(()=>resolve({passed:false,error:"TIMEOUT_AFTER_10_MINUTES"}),600000);
  timer.unref();
});
const outcome=await Promise.race([done,timeout]);
await new Promise(r=>server.close(r));
// The sandbox is retained for auditing. Never remove an arbitrary path, and
// do not terminate any other Chrome instance or process.
console.log(JSON.stringify({
  acceptance:outcome.passed?"E4_NATIVE_OS_PASS":"E4_NATIVE_OS_NOT_PASS",
  reportPath:outcome.reportPath??null,
  fixturePath:fixture.folder,
  error:outcome.error??null,
  diskVerification:outcome.diskVerification??null
},null,2));
process.exitCode=outcome.passed?0:1;
