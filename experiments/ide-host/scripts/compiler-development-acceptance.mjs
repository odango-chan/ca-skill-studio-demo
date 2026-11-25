// Exercise the released Compiler v2.1.0 Development Build and VerifyDevelopment
// through the exact Node/WASM Worker shipped by Skill Studio.
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {Worker} from "node:worker_threads";

const compilerRoot=resolve(process.argv[2]??"compiler-source");
const fixturePath=resolve(compilerRoot,"docs/design/fixtures/registration-development-request.json");
const workerPath=resolve("experiments/ide-host/vscode/dist/compiler-node-worker.mjs");
const wasmPath=resolve("experiments/ide-host/vscode/dist/skillc.wasm");
const request=JSON.parse(await readFile(fixturePath,"utf8"));
if(request.apiVersion!=="connectionagent.io/compiler-development-build-request/v1alpha1"||
   request.languageTarget!=="connectionagent.io/v1alpha5"||
   request.profile!=="DEVELOPMENT"||
   request.lock?.apiVersion!=="connectionagent.io/interface-dependency-lock/v1alpha1"||
   !Array.isArray(request.snapshots)||!request.snapshots.length){
  throw Error("Pinned Compiler v2.1.0 fixture lacks the exact Development Build request identity.");
}
const worker=new Worker(workerPath,{
  name:"studio-compiler-v2.1-development-acceptance",workerData:{wasmPath}
});
let nextId=0;
const send=(command,payload)=>new Promise((done,fail)=>{
  const id=++nextId;
  const timer=setTimeout(()=>{cleanup();fail(Error("Compiler v2.1.0 Worker timeout for "+command));},120000);
  function onMessage(message){
    if(message?.id!==id)return;
    cleanup();
    if(message.error)fail(Error("Compiler v2.1.0 Worker "+command+": "+message.error));
    else done(message.result);
  }
  function onError(error){cleanup();fail(error);}
  function cleanup(){
    clearTimeout(timer);
    worker.off("message",onMessage);
    worker.off("error",onError);
  }
  worker.on("message",onMessage);
  worker.on("error",onError);
  worker.postMessage({id,command,request:payload});
});
try{
  const result=await send("buildDevelopment",request);
  if(result?.apiVersion!=="connectionagent.io/compiler-development-build-result/v1alpha1"||
     result.success!==true||result.sourceStatus!=="VALIDATED"||
     result.interfaceLinkStatus!=="LINKED"||result.artifactStatus!=="BUILT"||
     result.executionStatus!=="NOT_ADMITTED"||
     !Array.isArray(result.diagnostics)||!Array.isArray(result.outputFiles)||
     typeof result.artifactDigest!=="string"||!result.artifactDigest){
    throw Error("Compiler v2.1.0 BuildDevelopment did not return VALIDATED/LINKED/BUILT/NOT_ADMITTED: "+
      JSON.stringify(result));
  }
  const verified=await send("verifyDevelopment",{request,result});
  if(verified!=="")
    throw Error("Compiler v2.1.0 VerifyDevelopment rejected its own BuildDevelopment result: "+
      String(verified));
  const tampered={...result,artifactDigest:"sha256:"+"0".repeat(64)};
  const tamperCheck=await send("verifyDevelopment",{request,result:tampered});
  if(typeof tamperCheck!=="string"||!tamperCheck.length)
    throw Error("Compiler v2.1.0 VerifyDevelopment accepted a tampered artifact digest");

  const corrupted={
    ...request,
    snapshots:request.snapshots.map((snapshot,index)=>index!==0?snapshot:{
      ...snapshot,
      files:snapshot.files.map((file,fileIndex)=>fileIndex!==0?file:{
        ...file,bytes:Buffer.from(file.bytes,"base64").map((byte,i)=>i===0?byte^1:byte).toString("base64")
      })
    })
  };
  const rejected=await send("buildDevelopment",corrupted);
  if(rejected?.success!==false||!Array.isArray(rejected.diagnostics)||
     !rejected.diagnostics.some(item=>item?.severity==="error")){
    throw Error("Compiler v2.1.0 accepted a dependency snapshot whose exact bytes no longer match its digest");
  }
  console.log("STUDIO_COMPILER_V2_1_DEVELOPMENT_WORKER_PASS",JSON.stringify({
    compilerVersion:"2.1.0",
    languageTarget:request.languageTarget,
    officialCompilerFixture:true,
    sourceStatus:result.sourceStatus,
    interfaceLinkStatus:result.interfaceLinkStatus,
    artifactStatus:result.artifactStatus,
    executionStatus:result.executionStatus,
    diagnosticCount:result.diagnostics.length,
    outputFileCount:result.outputFiles.length,
    artifactDigest:result.artifactDigest,
    verifyDevelopment:"PASS",
    tamperedArtifactRejected:true,
    corruptedSnapshotRejected:true,
    productionAdmission:"NOT_CLAIMED",
    real5gcQualification:"NOT_CLAIMED"
  }));
}finally{
  await worker.terminate();
}
