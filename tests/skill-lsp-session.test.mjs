import test from "node:test";
import assert from "node:assert/strict";
import {mkdir,mkdtemp,rm} from "node:fs/promises";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {build} from "esbuild";

const scratchRoot=resolve(process.cwd(),".agent-tmp");
await mkdir(scratchRoot,{recursive:true});
const temp=await mkdtemp(join(scratchRoot,"lsp-session-"));
let LanguageDiagnosticSession,diagnosticsFromAnalysis;
try {
  const outfile=join(temp,"session.mjs");
  await build({entryPoints:["language/lsp/session.ts","language/lsp/diagnostics.ts"],
    outdir:temp,bundle:true,format:"esm",platform:"node",target:"node24",
    packages:"external",logLevel:"silent"});
  ({LanguageDiagnosticSession}=await import(pathToFileURL(join(temp,"session.js")).href));
  ({diagnosticsFromAnalysis}=await import(pathToFileURL(join(temp,"diagnostics.js")).href));
} finally { await rm(temp,{recursive:true,force:true}); }

const uri="file:///workspace/skill/assurance/procedure.yaml";
function snapshot(generation=1,version=1,text="procedures: {}\n"){
  return {rootUri:"file:///workspace/skill",packageName:"skill",generation,
    completeness:"complete",documents:[
      {uri,relativePath:"assurance/procedure.yaml",text,version,languageId:"yaml"}
    ]};
}
function analysis(input,diagnostics=[],auditState="READY"){
  return {state:auditState==="READY"?"READY":"PARTIAL",
    rootUri:input.rootUri,packageName:input.packageName,generation:input.generation,
    procedure:{state:"READY",entry:null,procedures:[],diagnostics:[]},
    packageAudit:auditState==="READY"?{state:"READY",diagnostics:[]}:
      {state:"UNAVAILABLE",reason:"missing contract",diagnostics:[]},
    documents:input.documents.map(({uri,relativePath,version})=>
      ({uri,relativePath,version,languageId:"yaml",pythonOutlineState:"NOT_APPLICABLE",pythonSymbols:[]})),
    scriptReferences:[],schemaReferences:[],diagnostics};
}
const diagnostic=(text,overrides={})=>({uri,relativePath:"assurance/procedure.yaml",
  code:"TEST",message:text,severity:"warning",source:"package-audit",
  confidence:"exact",line:1,...overrides});

test("diagnostic conversion uses UTF-16 positions across CRLF, preserving line-only confidence",()=>{
  const source="a😀\r\nb\n";
  const input=snapshot(1,1,source);
  const output=diagnosticsFromAnalysis(input,analysis(input,[
    diagnostic("exact", {range:{start:5,end:6}}),
    diagnostic("line only",{line:2}),
    diagnostic("missing range",{line:0}),
    diagnostic("out of bounds",{range:{start:100,end:101}}),
    diagnostic("foreign URI",{uri:"file:///workspace/other.yaml"})
  ]));
  assert.equal(output.documents.length,1);
  assert.equal(output.documents[0].diagnostics.length,2);
  const [exact,line]=output.documents[0].diagnostics;
  assert.deepEqual(exact.range,{start:{line:1,character:0},end:{line:1,character:1}});
  assert.deepEqual(line.range,{start:{line:1,character:0},end:{line:1,character:0}});
  assert.equal(output.unlocated.length,3);
  assert.equal(exact.severity,2);
});

test("partial Package emits explicit audit unavailable rather than empty success",()=>{
  const input=snapshot();
  const result=diagnosticsFromAnalysis(input,analysis(input,[],"UNAVAILABLE"));
  assert.equal(result.state,"PARTIAL");
  const warning=result.documents[0].diagnostics.find(x=>x.code==="PACKAGE_AUDIT_UNAVAILABLE");
  assert.ok(warning);
  assert.equal(warning.severity,2);
  assert.match(warning.message,/missing contract/);
});

test("analysis identity mismatch cannot publish diagnostics into wrong Package",()=>{
  const input=snapshot();
  const wrong=analysis(input,[diagnostic("old")]);
  wrong.generation=2;
  const result=diagnosticsFromAnalysis(input,wrong);
  assert.equal(result.state,"UNAVAILABLE");
  assert.deepEqual(result.documents,[]);
});

test("stale document versions in otherwise READY analysis are not published",()=>{
  const input=snapshot(2,2);
  const stale=analysis(input,[diagnostic("old")]);
  stale.documents[0].version=1;
  const batch=diagnosticsFromAnalysis(input,stale);
  assert.equal(batch.state,"UNAVAILABLE");
  assert.deepEqual(batch.documents,[]);
  assert.match(batch.reason,/versions do not match/);
});

test("newer generation supersedes pending old analysis and rejects old edits",async()=>{
  let firstResolve;
  const first=new Promise(resolve=>{firstResolve=resolve;});
  const published=[],statuses=[];
  const session=new LanguageDiagnosticSession({
    publish:x=>published.push(x),status:x=>statuses.push(x)
  },input=>input.generation===1?first:analysis(input,[diagnostic("new",{line:2})]));
  const old=snapshot(1,1,"a\nb\n");
  const pending=session.submit(old);
  const latest=snapshot(2,2,"a\nb\n");
  assert.deepEqual(await session.submit(latest),{accepted:true});
  firstResolve(analysis(old,[diagnostic("obsolete")]));
  assert.deepEqual(await pending,{accepted:false,reason:"SUPERSEDED"});
  assert.equal(published.length,1);
  assert.equal(published[0].generation,2);
  assert.equal(statuses.length,1);
  assert.deepEqual(await session.submit(old),{accepted:false,reason:"STALE_GENERATION"});
  assert.deepEqual(await session.submit(snapshot(3,1,"a\nb\n")),
    {accepted:false,reason:"STALE_DOCUMENT"});
  assert.deepEqual(await session.submit(snapshot(3,2,"different")),
    {accepted:false,reason:"STALE_DOCUMENT"});
});

test("reset and close clear old document diagnostics, never leak across Packages",async()=>{
  const published=[];
  const session=new LanguageDiagnosticSession({
    publish:x=>published.push(x),status:()=>{}
  },input=>analysis(input,[diagnostic("current")]));
  assert.deepEqual(await session.submit(snapshot()),{accepted:true});
  const other=snapshot(2,2);
  other.rootUri="file:///workspace/other";
  other.packageName="other";
  other.documents[0].uri="file:///workspace/other/assurance/procedure.yaml";
  assert.deepEqual(await session.submit(other),{accepted:false,reason:"WRONG_PACKAGE"});
  session.reset();
  assert.ok(published.some(x=>x.uri===uri&&x.version===undefined&&x.diagnostics.length===0));
  assert.deepEqual(await session.submit(other),{accepted:true});
  session.dispose();
  assert.ok(published.some(x=>x.uri===other.documents[0].uri&&x.version===undefined));
  assert.deepEqual(await session.submit(other),{accepted:false,reason:"DISPOSED"});
});

test("closed TextDocument falls back to disk version zero and can reopen at version one",async()=>{
  const published=[];
  const session=new LanguageDiagnosticSession({
    publish:x=>published.push(x),status:()=>{}
  },input=>analysis(input,[diagnostic("current")]));
  assert.deepEqual(await session.submit(snapshot(1,5,"a\n")),{accepted:true});
  assert.deepEqual(await session.submit(snapshot(2,0,"a\n")),{accepted:true});
  assert.deepEqual(await session.submit(snapshot(3,1,"a\nb\n")),{accepted:true});
  assert.equal(published.at(-1).version,1);
  assert.equal(published.at(-1).generation,3);
});

test("invalid session snapshots fail closed before attempting analysis",async()=>{
  let called=false;
  const session=new LanguageDiagnosticSession({
    publish:()=>{},status:()=>{}
  },input=>{called=true;return analysis(input);});
  const invalid=snapshot();
  invalid.documents=null;
  assert.deepEqual(await session.submit(invalid),
    {accepted:false,reason:"INVALID_SNAPSHOT"});
  assert.equal(called,false);
});

test("failed analysis clears previous diagnostics and exposes explicit unavailable state",async()=>{
  const published=[],statuses=[];
  const session=new LanguageDiagnosticSession({
    publish:x=>published.push(x),status:x=>statuses.push(x)
  },input=>{
    if(input.generation===2)throw Error("worker parse failed");
    return analysis(input,[diagnostic("first")]);
  });
  await session.submit(snapshot());
  const next=await session.submit(snapshot(2,2));
  assert.deepEqual(next,{accepted:false,reason:"ANALYSIS_UNAVAILABLE"});
  assert.equal(published.at(-1).version,undefined);
  assert.equal(published.at(-1).diagnostics.length,0);
  assert.equal(statuses.at(-1).state,"UNAVAILABLE");
});
