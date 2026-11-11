import test from "node:test";
import assert from "node:assert/strict";
import {assembleProjectContext,buildRequestFromContext,createCompilerAdapter}
  from "../vscode/src/compiler-adapter.mjs";
const uri=path=>({path,scheme:"file",authority:"",toString(){return "file://"+path;}});
const docs={};
function host(){
  const root=uri("/p"),source=uri("/p/skills/one/SKILL.md");
  const bytes=new TextEncoder().encode("# test");
  const settings={skillsRoot:"skills",dependencies:[],
    dependencyLock:{version:"skillc.lock/v0.1",entries:[]}};
  return {root,vscode:{
    Uri:{joinPath:(base,...parts)=>uri(base.path+"/"+parts.join("/"))},
    RelativePattern:class {constructor(base,pattern){this.baseUri=base;this.pattern=pattern;}},
    workspace:{
      workspaceFolders:[{uri:root,name:"p"}],textDocuments:[],
      getConfiguration:()=>({get:(key,fallback)=>settings[key]??fallback}),
      findFiles:async()=>[source],
      fs:{readFile:async()=>bytes}
    }
  }};
}
test("exact v0.1 ProjectContext feeds matching BuildRequest with no lib/output files",async()=>{
  const {vscode,root}=host();
  const ctx=await assembleProjectContext(vscode,root,"3");
  assert.equal(ctx.apiVersion,"skillc.project-context/v0.1");
  assert.equal(ctx.configurationRevision,"3");
  assert.match(ctx.snapshotIdentity,/^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(ctx.sourceFiles.map(x=>x.path),["skills/one/SKILL.md"]);
  const req=buildRequestFromContext(ctx,["all"]);
  assert.equal(req.apiVersion,"skillc.build/v0.1");
  assert.deepEqual(req.sourceFiles,ctx.sourceFiles);
  assert.deepEqual(req.resolvedDependencies,ctx.resolvedDependencies);
  assert.deepEqual(req.targets,["all"]);
  assert.ok(!JSON.stringify(req).includes('"lib/'));
  assert.ok(!JSON.stringify(req).includes('"output/'));
});
test("missing compiler ABI is visibly UNAVAILABLE and never a fake PASS",async()=>{
  const {vscode,root}=host(),ctx=await assembleProjectContext(vscode,root,"1");
  const adapter=createCompilerAdapter();
  assert.equal(adapter.available,false);
  const checked=await adapter.check(ctx),built=await adapter.build(ctx);
  assert.equal(checked.status,"UNAVAILABLE");
  assert.equal(built.status,"UNAVAILABLE");
  assert.deepEqual(Object.keys(checked).sort(),["reason","status"]);
});
test("adapter forwards exact v0.1 request to an injected ABI only",async()=>{
  const {vscode,root}=host(),ctx=await assembleProjectContext(vscode,root,"2");
  const calls=[];
  const adapter=createCompilerAdapter({invoke:async (mode,request)=>{
    calls.push({mode,request});return {status:"PASS",outputFiles:[]};
  }});
  assert.equal(adapter.available,true);
  const result=await adapter.build(ctx);
  assert.equal(result.status,"PASS");
  assert.deepEqual(calls.map(c=>c.mode),["build"]);
  assert.equal(calls[0].request.apiVersion,"skillc.build/v0.1");
});
test("unsafe targets and non-v0.1 context are refused before ABI invocation",()=>{
  assert.throws(()=>buildRequestFromContext({},[]),/v0.1/);
  assert.throws(()=>buildRequestFromContext({apiVersion:"skillc.project-context/v0.1"},
    ["../bad"]),/Invalid Compiler targets/);
});
