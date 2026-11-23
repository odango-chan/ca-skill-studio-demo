// Compiler-qualified synthetic authoring fixture. Never use this as 5GC/Owner qualification.
// The trusted input is the immutable positive fixture from Compiler v2.0.2 source.
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {Worker} from "node:worker_threads";
import {buildContextPack} from "../../../authoring/core/context-pack.mjs";
import {validateModelProposal} from "../../../authoring/core/model-proposal.mjs";
import {createChangeSet} from "../../../authoring/core/change-set.mjs";
import {planV1Alpha5Patch,materializeAcceptedPatchGroups} from "../../../authoring/core/v1alpha5-patch-engine.mjs";

const compilerRoot=resolve(process.argv[2]??"compiler-source");
const fixturePath=resolve(compilerRoot,"web/parity-v1alpha5/trusted-build-request.json");
const workerPath=resolve("experiments/ide-host/vscode/dist/compiler-node-worker.mjs");
const wasmPath=resolve("experiments/ide-host/vscode/dist/skillc.wasm");
const trusted=JSON.parse(await readFile(fixturePath,"utf8"));
if(trusted.apiVersion!=="connectionagent.io/compiler-build-request/v1alpha5"||
   trusted.languageTarget!=="connectionagent.io/v1alpha5"||
   !Array.isArray(trusted.resolvedDependencies)||
   !trusted.trustedBuildContext){
  throw Error("Pinned Compiler acceptance fixture lacks the v1alpha5 trusted build identity.");
}
const procedureFile=trusted.files.find(file=>
  file.path==="skills/example/assurance/procedure.yaml");
if(!procedureFile)throw Error("Pinned trusted fixture is missing its exact Procedure.");
const source=Buffer.from(procedureFile.bytes,"base64").toString("utf8");
if(!source.includes("FAIL: SAFE_STOPPED"))throw Error("Fixture does not expose its expected final FAIL route.");
const digest=async value=>"sha256:"+Buffer.from(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value))).toString("hex");
const input=await buildContextPack({
  taskId:"synthetic-compiler-candidate",revision:1,
  languageTarget:"connectionagent.io/v1alpha5",
  procedure:{path:"assurance/procedure.yaml",documentVersion:1,text:source},
  resources:[],maxBytes:131072
});
const proposal=validateModelProposal({
  schema:"ca-studio.ai-model-proposal/v1",
  summary:"Change one synthetic final-state failure terminal.",
  plan:["Retain all operations and Wait bindings; modify the final Postcondition FAIL route."],
  operations:[{
    type:"stage.route.set",
    target:{nodeId:"final",stage:"postcondition",outcome:"FAIL"},
    payload:{targetNodeId:"FAILED"},
    rationale:"Test Host ownership and source-preserving route update.",
    references:["procedure-current"]
  }],
  assumptions:[],blockers:[]
},{allowedContextIds:["procedure-current"]});
const uri="file:///synthetic/skills/example/assurance/procedure.yaml";
const changeSet=createChangeSet({
  proposalResult:{
    taskId:input.pack.taskId,revision:1,languageTarget:input.pack.languageTarget,
    manifest:input.manifest,proposal
  },
  hostBase:{
    documentUri:uri,documentVersion:1,packageGeneration:1,
    sourceDigest:"sha256:"+input.manifest[0].digest
  },
  operationIdFactory:()=> "synthetic-op-1"
});
const patch=await planV1Alpha5Patch({
  source,changeSet,currentDocumentUri:uri,currentDocumentVersion:1,
  currentPackageGeneration:1
});
const candidate=await materializeAcceptedPatchGroups({
  source,plan:patch,acceptedGroupIds:patch.groups.map(group=>group.id)
});
if(candidate.source===source||!candidate.source.includes("FAIL: FAILED")||
   !candidate.digest||candidate.digest!==await digest(candidate.source)){
  throw Error("Source-preserving Patch Engine did not materialize the exact selected route change.");
}
const next={
  ...trusted,
  files:trusted.files.map(file=>file.path===procedureFile.path
    ?{...file,bytes:Buffer.from(candidate.source,"utf8").toString("base64")}:file)
};
const worker=new Worker(workerPath,{
  name:"studio-synthetic-v1alpha5-acceptance",workerData:{wasmPath}
});
let nextId=0;
const send=(command,request)=>new Promise((done,fail)=>{
  const id=++nextId;
  const timer=setTimeout(()=>{cleanup();fail(Error("Compiler Worker timeout for "+command));},45000);
  function onMessage(msg){
    if(msg?.id!==id)return;
    cleanup();
    if(msg.error)fail(Error("Compiler Worker "+command+": "+msg.error));
    else done(msg.result);
  }
  function onError(error){cleanup();fail(error);}
  function cleanup(){
    clearTimeout(timer);
    worker.off("message",onMessage);
    worker.off("error",onError);
  }
  worker.on("message",onMessage);
  worker.on("error",onError);
  worker.postMessage({id,command,request});
});
try{
  const sourceCheck=await send("check",trusted);
  if(!Array.isArray(sourceCheck))throw Error("Base Compiler Check did not return diagnostics.");
  const sourceErrors=sourceCheck.filter(item=>item?.severity==="error");
  if(sourceErrors.length)throw Error("Trusted baseline Compiler Check failed: "+
    JSON.stringify(sourceErrors.slice(0,8)));
  const candidateCheck=await send("check",next);
  if(!Array.isArray(candidateCheck))throw Error("Candidate Compiler Check did not return diagnostics.");
  const errors=candidateCheck.filter(item=>item?.severity==="error");
  if(errors.length)throw Error("Exact patched candidate Compiler Check failed: "+
    JSON.stringify(errors.slice(0,8)));
  console.log("STUDIO_AI_AUTHORING_SYNTHETIC_COMPILER_PASS",JSON.stringify({
    compilerVersion:"v2.0.2",languageTarget:"connectionagent.io/v1alpha5",
    sourceIsCompilerOfficialFixture:true,trust:"SYNTHETIC_TEST_ONLY",
    atomicGroupCount:patch.groups.length,candidateDigest:candidate.digest,
    compilerCheck:"PASS",baseErrors:sourceErrors.length,candidateErrors:errors.length,
    noFilesystemWrites:true,real5gcQualification:"NOT_CLAIMED"
  }));
}finally{
  await worker.terminate();
}
