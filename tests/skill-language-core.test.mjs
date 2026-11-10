import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {mkdir,mkdtemp,rm} from "node:fs/promises";
import {join,resolve} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {build} from "esbuild";
import {SAMPLE_PACKAGES} from "../site/sample-packages.mjs";

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

function sampleSnapshot(){
  const spec=SAMPLE_PACKAGES.establish;
  return {
    rootUri:"file:///workspace/"+spec.name,
    packageName:spec.name,
    generation:1,
    completeness:"complete",
    documents:spec.files.map(relativePath=>({
      uri:"file:///workspace/"+spec.name+"/"+relativePath,
      relativePath,
      version:1,
      text:readFileSync(new URL("../site/samples/packages/"+spec.name+"/"+relativePath,import.meta.url),"utf8")
    }))
  };
}

test("shared core adapts the current Package analyzers into one JSON-safe result",()=>{
  const snapshot=sampleSnapshot();
  const before=snapshot.documents.map(document=>document.text);
  const result=analyzePackageSnapshot(snapshot);
  assert.equal(result.state,"READY");
  assert.equal(result.procedure.state,"READY");
  assert.equal(result.procedure.procedures.length,6);
  assert.equal(result.packageAudit.state,"READY");
  assert.deepEqual(result.packageAudit.diagnostics,[]);
  assert.equal(result.documents.filter(document=>document.pythonOutlineState==="READY").length,3);
  assert.equal(result.scriptReferences.length,3);
  assert.equal(result.schemaReferences.length,6);
  assert.equal(result.diagnostics.length,0);
  assert.equal(JSON.parse(JSON.stringify(result)).procedure.procedures.length,6);
  assert.deepEqual(snapshot.documents.map(document=>document.text),before,
    "analysis must never mutate Package Source");
});

test("partial Package snapshots never report Package Audit as clean",()=>{
  const snapshot=sampleSnapshot();
  snapshot.completeness="partial";
  snapshot.reason="The host could not enumerate every Package file";
  const result=analyzePackageSnapshot(snapshot);
  assert.equal(result.state,"PARTIAL");
  assert.equal(result.procedure.state,"READY");
  assert.equal(result.packageAudit.state,"UNAVAILABLE");
  assert.match(result.packageAudit.reason,/could not enumerate/);
});

test("missing required Package files make only Package Audit unavailable",()=>{
  const snapshot=sampleSnapshot();
  snapshot.documents=snapshot.documents.filter(document=>
    document.relativePath!=="assurance/contract.yaml");
  const result=analyzePackageSnapshot(snapshot);
  assert.equal(result.state,"PARTIAL");
  assert.equal(result.procedure.state,"READY");
  assert.equal(result.packageAudit.state,"UNAVAILABLE");
  assert.match(result.packageAudit.reason,/assurance\/contract.yaml/);
});

test("Procedure projection failures remain visible and fail closed",()=>{
  const snapshot=sampleSnapshot();
  const procedure=snapshot.documents.find(document=>
    document.relativePath==="assurance/procedure.yaml");
  procedure.text="procedures: [";
  const result=analyzePackageSnapshot(snapshot);
  assert.equal(result.state,"PARTIAL");
  assert.equal(result.procedure.state,"UNAVAILABLE");
  assert.ok(result.diagnostics.some(diagnostic=>
    diagnostic.source==="procedure-projection"&&diagnostic.code==="PROCEDURE_PROJECTION"));
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
    relativePath:"scripts\\evaluate_udm_read.py",
    version:1,
    text:""
  });
  result=analyzePackageSnapshot(duplicate);
  assert.equal(result.state,"UNAVAILABLE");
  assert.equal(result.diagnostics[0].code,"DUPLICATE_PACKAGE_DOCUMENT");
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

test("existing heuristic Package warnings keep their heuristic classification",()=>{
  const snapshot=sampleSnapshot();
  const procedure=snapshot.documents.find(document=>
    document.relativePath==="assurance/procedure.yaml");
  procedure.text=procedure.text.replace(
    "dnn:\n                  from: input.dnn",
    "dnn:\n                  from: input.psi"
  );
  const result=analyzePackageSnapshot(snapshot);
  const warning=result.packageAudit.diagnostics.find(diagnostic=>
    diagnostic.code==="INPUT_BINDING_SUSPECT");
  assert.ok(warning,"the existing heuristic warning must be preserved");
  assert.equal(warning.confidence,"heuristic");
  assert.equal(warning.severity,"warning");
});
