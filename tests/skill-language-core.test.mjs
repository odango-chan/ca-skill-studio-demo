import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {mkdir,mkdtemp,rm} from "node:fs/promises";
import {join,resolve} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {build} from "esbuild";

const entry=fileURLToPath(new URL("../language/core/index.ts",import.meta.url));
const scratchRoot=resolve(process.cwd(),".agent-tmp");
await mkdir(scratchRoot,{recursive:true});
const scratch=await mkdtemp(join(scratchRoot,"skill-language-core-"));
const bundlePath=join(scratch,"index.mjs");
let analyzePackageSnapshot;
try{
  await build({
    entryPoints:[entry],
    outfile:bundlePath,
    bundle:true,
    format:"esm",
    platform:"node",
    target:"node24",
    packages:"external",
    logLevel:"silent"
  });
  ({analyzePackageSnapshot}=await import(pathToFileURL(bundlePath).href));
}finally{
  await rm(scratch,{recursive:true,force:true});
}

const skillFiles=[
  "SKILL.md",
  "assurance/contract.yaml",
  "assurance/predicates.yaml",
  "assurance/procedure.yaml",
  "schemas/establishment-request.schema.yaml",
  "scripts/validate-smf-session-context-entry.py",
  "scripts/validate-smf-session-context.py",
  "scripts/validate-subscription-request.py"
];
function sampleSnapshot(){
  return {
    rootUri:"file:///workspace/establish-pdu-session",
    packageName:"establish-pdu-session",
    generation:1,
    completeness:"complete",
    documents:skillFiles.map(relativePath=>({
      uri:"file:///workspace/establish-pdu-session/"+relativePath,
      relativePath,
      version:1,
      text:readFileSync(new URL("../site/samples/v1alpha5/establish-pdu-session/"+relativePath,import.meta.url),"utf8")
    }))
  };
}

test("shared core analyzes the current CA-SL v1alpha5 Example without claiming qualification",()=>{
  const snapshot=sampleSnapshot();
  const before=snapshot.documents.map(document=>document.text);
  const result=analyzePackageSnapshot(snapshot);
  assert.equal(result.state,"READY");
  assert.equal(result.procedure.state,"READY");
  assert.equal(result.procedure.procedures.length,1);
  assert.equal(result.procedure.entry,"get-sm-subscription-data");
  assert.equal(result.packageAudit.state,"UNAVAILABLE");
  assert.match(result.packageAudit.reason,/current Compiler/);
  assert.match(result.packageAudit.reason,/Owner.*linking/);
  assert.equal(result.documents.filter(document=>document.pythonOutlineState==="READY").length,3);
  assert.ok(result.scriptReferences.length>=3);
  assert.ok(result.scriptReferences.every(ref=>ref.packageContextComplete===true));
  const byUri=new Map(snapshot.documents.map(document=>[document.uri,document.text]));
  for(const ref of [...result.scriptReferences,...result.schemaReferences]){
    assert.ok(ref.sourceRange&&ref.targetRange);
    assert.ok(ref.sourceRange.start>=0&&ref.sourceRange.end>=ref.sourceRange.start);
    assert.ok(ref.targetRange.start>=0&&ref.targetRange.end>=ref.targetRange.start);
    assert.ok(byUri.get(ref.sourceUri).slice(ref.sourceRange.start,ref.sourceRange.end).length>0);
    assert.ok(byUri.get(ref.targetUri).slice(ref.targetRange.start,ref.targetRange.end).length>0);
  }
  for(const symbol of result.documents.flatMap(document=>document.pythonSymbols)){
    const source=byUri.get(symbol.uri);
    assert.ok(symbol.navigable&&symbol.range);
    assert.equal(source.slice(symbol.range.start,symbol.range.end),symbol.name);
  }
  assert.equal(JSON.parse(JSON.stringify(result)).procedure.procedures.length,1);
  assert.deepEqual(snapshot.documents.map(document=>document.text),before,
    "analysis must never mutate Package Source");
});

test("partial Package snapshots preserve v1alpha5 source projection but gate cross-file context",()=>{
  const snapshot=sampleSnapshot();
  snapshot.completeness="partial";
  snapshot.reason="The host could not enumerate every Package file";
  const result=analyzePackageSnapshot(snapshot);
  assert.equal(result.state,"READY");
  assert.equal(result.procedure.state,"READY");
  assert.equal(result.packageAudit.state,"UNAVAILABLE");
  assert.match(result.packageAudit.reason,/could not enumerate/);
  assert.ok(result.scriptReferences.length>0);
  assert.ok(result.scriptReferences.every(ref=>ref.packageContextComplete===false));
  assert.ok(result.schemaReferences.every(ref=>ref.packageContextComplete===false));
  const packageStatus=result.diagnostics.find(item=>
    item.code==="PACKAGE_SNAPSHOT_INCOMPLETE");
  assert.ok(packageStatus);
  assert.equal(packageStatus.status,"not_checked");
  assert.equal(packageStatus.confidence,"unknown");
  assert.equal(packageStatus.range,undefined,
    "a partial inventory has no real AST scalar to underline");
  assert.equal(packageStatus.line,undefined,
    "Package status must not be disguised as Procedure line 1");
  const capability=result.diagnostics.find(item=>
    item.code==="CAPABILITY_GRANT_NOT_CHECKED");
  assert.equal(capability?.confidence,"exact");
  assert.ok(capability?.range,
    "an existing Capability grant still has an exact source range");
});

test("missing non-procedure v1alpha5 files do not fabricate Package qualification",()=>{
  const snapshot=sampleSnapshot();
  snapshot.documents=snapshot.documents.filter(document=>
    document.relativePath!=="assurance/contract.yaml");
  const result=analyzePackageSnapshot(snapshot);
  assert.equal(result.state,"READY");
  assert.equal(result.procedure.state,"READY");
  assert.equal(result.packageAudit.state,"UNAVAILABLE");
  assert.match(result.packageAudit.reason,/current Compiler/);
});

test("Language Service includes current Package Audit Script diagnostics with exact scalar ranges",()=>{
  const snapshot=sampleSnapshot();
  const predicates=snapshot.documents.find(document=>
    document.relativePath==="assurance/predicates.yaml");
  predicates.text=predicates.text.replace(
    "scripts/validate-subscription-request.py","scripts/missing-script.py");
  const result=analyzePackageSnapshot(snapshot);
  const diagnostic=result.diagnostics.find(item=>
    item.code==="PREDICATE_SCRIPT_NOT_FOUND");
  assert.ok(diagnostic,JSON.stringify(result.diagnostics));
  assert.equal(diagnostic.source,"package-audit");
  assert.equal(diagnostic.relativePath,"assurance/predicates.yaml");
  assert.ok(diagnostic.range);
  assert.equal(predicates.text.slice(diagnostic.range.start,diagnostic.range.end),
    "scripts/missing-script.py");
  assert.ok(result.packageAudit.diagnostics.includes(diagnostic));
});

test("missing Procedure does not stop independent Contract and Predicate checks",()=>{
  const snapshot=sampleSnapshot();
  snapshot.documents=snapshot.documents.filter(document=>
    document.relativePath!=="assurance/procedure.yaml");
  const contract=snapshot.documents.find(document=>
    document.relativePath==="assurance/contract.yaml");
  contract.text=contract.text.replace(
    "requestSchema: schemas/establishment-request.schema.yaml",
    "requestSchema: ../outside/request.schema.yaml");
  const result=analyzePackageSnapshot(snapshot);
  assert.equal(result.state,"PARTIAL");
  assert.equal(result.procedure.state,"UNAVAILABLE");
  const codes=new Set(result.diagnostics.map(item=>item.code));
  assert.ok(codes.has("PACKAGE_CORE_FILE_MISSING"));
  assert.ok(codes.has("REQUEST_SCHEMA_REFERENCE_INVALID"));
  assert.ok(!codes.has("UNSUPPORTED_CA_SL_VERSION"));
  assert.equal(result.documents.length,snapshot.documents.length,
    "all available Package documents still receive analysis");
});

test("malformed v1alpha5 Procedure remains visible and fails closed",()=>{
  const snapshot=sampleSnapshot();
  const procedure=snapshot.documents.find(document=>document.relativePath==="assurance/procedure.yaml");
  procedure.text="start: broken\nnodes:\n  broken:\n    operation: [\n";
  const result=analyzePackageSnapshot(snapshot);
  assert.equal(result.state,"PARTIAL");
  assert.equal(result.procedure.state,"UNAVAILABLE");
  assert.ok(result.diagnostics.length>0);
});

test("historical Package source receives ordinary current-grammar diagnostics across files",()=>{
  const snapshot=sampleSnapshot();
  const contract=snapshot.documents.find(document=>document.relativePath==="assurance/contract.yaml");
  const predicates=snapshot.documents.find(document=>document.relativePath==="assurance/predicates.yaml");
  const procedure=snapshot.documents.find(document=>document.relativePath==="assurance/procedure.yaml");
  contract.text="apiVersion: connectionagent.io/v1alpha1\nkind: SkillContract\nmetadata: {}\nspec: {}\n";
  predicates.text="apiVersion: connectionagent.io/v1alpha1\nkind: PredicateSet\nmetadata: {}\npredicates: {}\n";
  procedure.text="procedures:\n  legacy:\n    nodes:\n      step:\n        call: ca.sample.read\n";
  const result=analyzePackageSnapshot(snapshot);
  assert.equal(result.state,"PARTIAL");
  assert.equal(result.procedure.state,"UNAVAILABLE");
  const codes=new Set(result.diagnostics.map(item=>item.code));
  assert.ok(codes.has("UNKNOWN_FIELD"),JSON.stringify(result.diagnostics));
  assert.ok(codes.has("SOURCE_ROOT_INVALID"),JSON.stringify(result.diagnostics));
  assert.ok(!codes.has("UNSUPPORTED_CA_SL_VERSION"));
  const paths=new Set(result.diagnostics.map(item=>item.relativePath));
  assert.ok(paths.has("assurance/contract.yaml"));
  assert.ok(paths.has("assurance/predicates.yaml"));
  assert.ok(paths.has("assurance/procedure.yaml"));
  const procedureDiagnostic=result.diagnostics.find(item=>
    item.relativePath==="assurance/procedure.yaml"&&item.code==="UNKNOWN_FIELD"&&item.range);
  assert.ok(procedureDiagnostic);
  assert.equal(procedure.text.slice(procedureDiagnostic.range.start,procedureDiagnostic.range.end),
    "procedures","current grammar diagnostics underline the complete unsupported YAML key");
});

test("unsafe or duplicate Package paths are rejected before analysis",()=>{
  const snapshot=sampleSnapshot();
  snapshot.documents.push({
    uri:"file:///workspace/outside",
    relativePath:"../outside.yaml",
    version:1,
    text:"{}"
  });
  let result=analyzePackageSnapshot(snapshot);
  assert.equal(result.state,"UNAVAILABLE");
  assert.equal(result.diagnostics[0].code,"INVALID_PACKAGE_PATH");

  const duplicate=sampleSnapshot();
  duplicate.documents.push({
    uri:"file:///workspace/duplicate",
    relativePath:"scripts\\validate-smf-session-context.py",
    version:1,
    text:""
  });
  result=analyzePackageSnapshot(duplicate);
  assert.equal(result.state,"UNAVAILABLE");
  assert.equal(result.diagnostics[0].code,"DUPLICATE_PACKAGE_DOCUMENT");
});

test("Package analysis binds document URIs to exact Package-relative paths",()=>{
  const fixture=sampleSnapshot();
  const procedure=fixture.documents.find(document=>document.relativePath==="assurance/procedure.yaml");
  const originalUri=procedure.uri;
  for(const uri of [
    "file:///workspace/other/assurance/procedure.yaml",
    "file:///workspace/establish-pdu-session/other/procedure.yaml",
    "file:///workspace/establish-pdu-session/scripts/%2e%2e/assurance/procedure.yaml",
    "file:///workspace/establish-pdu-session/assurance%2Fprocedure.yaml",
    "file:///workspace/establish-pdu-session/assurance/procedure.yaml?version=1",
    "vscode-remote://wsl+Ubuntu/workspace/establish-pdu-session/assurance/procedure.yaml",
    "file:///workspace/establish-pdu-session/assurance/procedure.yaml/"
  ]){
    procedure.uri=uri;
    const result=analyzePackageSnapshot(fixture);
    assert.equal(result.state,"UNAVAILABLE",uri);
    assert.equal(result.diagnostics[0].code,"PACKAGE_DOCUMENT_URI_MISMATCH",uri);
  }
  procedure.uri=originalUri;
  assert.equal(analyzePackageSnapshot(fixture).state,"READY");

  const remote=sampleSnapshot();
  remote.rootUri="vscode-remote://wsl+Ubuntu/workspace/My%20Skill";
  remote.documents=remote.documents.map(document=>({
    ...document,
    uri:remote.rootUri+"/"+document.relativePath
  }));
  assert.equal(analyzePackageSnapshot(remote).state,"READY");
});

test("unsafe Package root URIs fail closed before publishing analysis",()=>{
  for(const rootUri of [
    "file:///workspace/a/%2e%2e/pkg",
    "file:///workspace/pkg?other",
    "file:///workspace/pkg#fragment",
    "relative/package"
  ]){
    const snapshot=sampleSnapshot();
    snapshot.rootUri=rootUri;
    const result=analyzePackageSnapshot(snapshot);
    assert.equal(result.state,"UNAVAILABLE",rootUri);
    assert.equal(result.diagnostics[0].code,"INVALID_PACKAGE_ROOT_URI",rootUri);
  }
});

test("Package file-count and cumulative text-length limits fail closed",()=>{
  const tooMany={
    rootUri:"file:///workspace/large",
    packageName:"large",
    generation:1,
    completeness:"complete",
    documents:Array.from({length:501},(_,index)=>({
      uri:"file:///workspace/large/notes/"+index+".txt",
      relativePath:"notes/"+index+".txt",
      version:1,
      text:"x"
    }))
  };
  assert.equal(analyzePackageSnapshot(tooMany).diagnostics[0].code,"PACKAGE_FILE_LIMIT");

  const tooLarge={
    rootUri:"file:///workspace/large",
    packageName:"large",
    generation:1,
    completeness:"complete",
    documents:[{
      uri:"file:///workspace/large/notes/large.txt",
      relativePath:"notes/large.txt",
      version:1,
      text:"x".repeat(4*1024*1024+1)
    }]
  };
  assert.equal(analyzePackageSnapshot(tooLarge).diagnostics[0].code,"PACKAGE_TEXT_LIMIT");
});

test("unreadable Contract is NOT_CHECKED, never a confirmed empty-YAML source defect",()=>{
  const snapshot=sampleSnapshot();
  const contract=snapshot.documents.find(doc=>doc.relativePath==="assurance/contract.yaml");
  contract.text="";
  contract.readable=false;
  snapshot.completeness="partial";
  snapshot.reason="assurance/contract.yaml: EIO while reading persisted Source";
  const result=analyzePackageSnapshot(snapshot);
  assert.equal(result.packageAudit.state,"UNAVAILABLE");
  const status=result.diagnostics.find(item=>item.code==="PACKAGE_SNAPSHOT_INCOMPLETE");
  assert.equal(status?.status,"not_checked");
  assert.match(status.message,/EIO/);
  assert.ok(!result.diagnostics.some(item=>
    item.relativePath==="assurance/contract.yaml"&&
    ["SOURCE_ROOT_INVALID","PACKAGE_YAML_ROOT_INVALID","YAML_PARSE_ERROR","PACKAGE_YAML_PARSE_ERROR"]
      .includes(item.code)),"unreadable text must never be treated as user-authored empty YAML");
  assert.ok(result.documents.some(doc=>doc.relativePath==="assurance/contract.yaml"),
    "the unreadable document identity remains in the published Package generation");
});

test("genuinely empty readable YAML still has a confirmed source error",()=>{
  const snapshot=sampleSnapshot();
  const contract=snapshot.documents.find(doc=>doc.relativePath==="assurance/contract.yaml");
  contract.text="";
  const result=analyzePackageSnapshot(snapshot);
  assert.ok(result.diagnostics.some(item=>
    item.relativePath==="assurance/contract.yaml"&&
    item.code==="SOURCE_ROOT_INVALID"));
  assert.ok(result.diagnostics.some(item=>
    item.relativePath==="assurance/contract.yaml"&&
    item.code==="PACKAGE_YAML_ROOT_INVALID"));
});

test("contradictory unreadable files in COMPLETE snapshots fail closed",()=>{
  const snapshot=sampleSnapshot();
  const contract=snapshot.documents.find(doc=>doc.relativePath==="assurance/contract.yaml");
  contract.text="";
  contract.readable=false;
  const result=analyzePackageSnapshot(snapshot);
  assert.equal(result.state,"UNAVAILABLE");
  assert.equal(result.diagnostics[0].code,"INVALID_PACKAGE_READ_STATE");
});
