import test from "node:test";
import assert from "node:assert/strict";
import { mkdir,mkdtemp,rm } from "node:fs/promises";
import {readFileSync} from "node:fs";
import { join,resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const tempRoot=resolve(".agent-tmp");
await mkdir(tempRoot,{recursive:true});
const directory=await mkdtemp(join(tempRoot,"v1alpha4-lsp-"));
let analyzePackageSnapshot;
try {
  const outfile=join(directory,"index.mjs");
  await build({entryPoints:["language/core/index.ts"],outfile,bundle:true,
    format:"esm",platform:"node",target:"node24",packages:"external",logLevel:"silent"});
  ({analyzePackageSnapshot}=await import(pathToFileURL(outfile).href));
} finally {
  await rm(directory,{recursive:true,force:true});
}

const contract=[
  "goal: pdu_session.initial_request_fulfilled",
  "precondition: check.precondition",
  "requestSchema: schemas/request.schema.yaml",
  "contextSchema: ca-context::urn:example:host:v1",
  "dependencies:",
  "  ca-context: urn:example:host",
  "  ca: urn:example:tools",
  "capabilities: [session-read]",
  ""
].join("\n");
const procedure=[
  "start: check",
  "nodes:",
  "  check:",
  "    precondition:",
  "      predicates:",
  "        - predicate: demo.ready",
  "          arguments: [context.ueRef]",
  "      routes:",
  "        PASS: read",
  "        FAIL: FAILED",
  "        UNKNOWN: UNRESOLVED",
  "  read:",
  "    observation:",
  "      tool: ca::session.read",
  "      arguments:",
  "        ueRef: context.ueRef",
  "      routes:",
  "        SUCCEEDED: final",
  "        FAILED: FAILED",
  "  final:",
  "    postcondition:",
  "      predicates:",
  "        - predicate: demo.done",
  "          arguments: [read.observation.output]",
  "      routes:",
  "        PASS: SUCCEEDED",
  "        FAIL: FAILED",
  "        UNKNOWN: UNRESOLVED",
  ""
].join("\n");
const predicates=[
  "predicates:",
  "  demo.ready:",
  "    parameters: [{ue: string}]",
  "    evaluator:",
  "      type: cel",
  "      expression: ue != \"\"",
  "  demo.done:",
  "    parameters: [{data: ca::urn:example:result:v1}]",
  "    evaluator:",
  "      type: cel",
  "      expression: data.ready == true",
  ""
].join("\n");

function snapshot(source=procedure,contractSource=contract,predicatesSource=predicates) {
  const files={
    "SKILL.md":"---\nname: sample\ndescription: v1alpha4\n---\n",
    "assurance/contract.yaml":contractSource,
    "assurance/procedure.yaml":source,
    "assurance/predicates.yaml":predicatesSource,
    "schemas/request.schema.yaml":"$schema: https://json-schema.org/draft/2020-12/schema\ntype: object\n"
  };
  return {rootUri:"file:///workspace/sample",packageName:"sample",generation:1,
    completeness:"complete",documents:Object.entries(files).map(([relativePath,text])=>({
      uri:"file:///workspace/sample/"+relativePath,relativePath,text,version:1
    }))};
}

test("optional Studio examples mirror the pinned PDU/MAS v1alpha4 source shape",()=>{
  for(const [name,expectedNodes] of [["establish-pdu-session",15],["establish-pdu-session-mas",18]]) {
    const files=["SKILL.md","assurance/contract.yaml","assurance/procedure.yaml",
      "assurance/predicates.yaml","schemas/establishment-request.schema.yaml"];
    const docs=files.map(relativePath=>({
      relativePath,uri:"file:///workspace/"+name+"/"+relativePath,version:1,
      text:readFileSync(new URL("../site/samples/v1alpha4/"+name+"/"+relativePath,import.meta.url),"utf8")
    }));
    const result=analyzePackageSnapshot({rootUri:"file:///workspace/"+name,
      packageName:name,generation:1,completeness:"complete",documents:docs});
    assert.equal(result.state,"PARTIAL");
    assert.equal(result.procedure.state,"READY",
      name+" source structure should be projected without a trusted Owner");
    assert.ok(result.procedure.procedures[0].nodes.length>=expectedNodes);
    assert.ok(!result.diagnostics.some(x=>x.severity==="error"),
      name+" editor should not fabricate source errors: "+JSON.stringify(result.diagnostics));
  }
});

test("v1alpha4 AST graph projects nodes and routes but never claims Owner qualification",()=>{
  const a=analyzePackageSnapshot(snapshot());
  assert.equal(a.state,"PARTIAL");
  assert.equal(a.packageAudit.state,"UNAVAILABLE");
  assert.match(a.packageAudit.reason,/Owner.*linking/);
  assert.equal(a.procedure.state,"READY");
  assert.equal(a.procedure.entry,"check");
  assert.deepEqual(a.procedure.procedures[0].nodes.map(x=>x.id),["check","read","final"]);
  assert.ok(a.procedure.procedures[0].routes.some(x=>x.target==="SUCCEEDED"&&x.routeSource==="postcondition"));
  assert.deepEqual(a.diagnostics,[]);
});

test("v1alpha4 rejects author reconcile/legacy wrappers without automatic conversion",()=>{
  const altered=procedure.replace("    observation:\n", "    reconcile: read\n    observation:\n");
  const a=analyzePackageSnapshot(snapshot(altered));
  assert.equal(a.procedure.state,"UNAVAILABLE");
  assert.ok(a.diagnostics.some(x=>x.code==="UNKNOWN_FIELD"&&x.message.includes("reconcile")));
});

test("v1alpha4 recognizes missing direct final Postcondition",()=>{
  const altered=procedure.replace("PASS: SUCCEEDED","PASS: FAILED")+
    "  unsafe:\n    operation:\n      tool: ca::session.mutate\n      arguments: {}\n      routes:\n        SUCCEEDED: SUCCEEDED\n        OUTCOME_UNKNOWN: SAFE_STOPPED\n";
  const a=analyzePackageSnapshot(snapshot(altered));
  assert.ok(a.diagnostics.some(x=>x.code==="FINAL_POSTCONDITION_MISSING"));
});

test("v1alpha4 reports reachable cycle without invoking legacy procedure projector",()=>{
  const altered=procedure.replace("SUCCEEDED: final","SUCCEEDED: check");
  const a=analyzePackageSnapshot(snapshot(altered));
  assert.ok(a.diagnostics.some(x=>x.code==="CONTROL_FLOW_CYCLE"));
});

test("v1alpha4 rejects duplicate YAML keys and invalid predicate groups",()=>{
  const duplicate=procedure.replace("start: check","start: check\nstart: read");
  let a=analyzePackageSnapshot(snapshot(duplicate));
  assert.ok(a.diagnostics.some(x=>x.code==="YAML_PARSE_ERROR"));
  const empty=procedure.replace("predicates:\n        - predicate: demo.ready\n          arguments: [context.ueRef]","predicates: []");
  a=analyzePackageSnapshot(snapshot(empty));
  assert.ok(a.diagnostics.some(x=>x.code==="PREDICATE_GROUP_INVALID"));
});

test("v1alpha4 marks no Owner identity as a missing qualification, not a synthetic PASS",()=>{
  const a=analyzePackageSnapshot(snapshot());
  assert.notEqual(a.state,"READY");
  assert.ok(a.packageAudit.reason.includes("requires v1alpha4 Compiler"));
});

test("v1alpha4 partial root edits do not switch back to the legacy procedure parser",()=>{
  const withoutStart=analyzePackageSnapshot(snapshot(procedure.replace("start: check\n","")));
  assert.equal(withoutStart.state,"PARTIAL");
  assert.ok(withoutStart.diagnostics.some(x=>x.code==="PROCEDURE_START_MISSING"));
  assert.ok(!withoutStart.diagnostics.some(x=>x.code==="PROCEDURE_PROJECTION"));

  const withoutNodes=analyzePackageSnapshot(snapshot(procedure.replace("nodes:\n","nodesMissing:\n")));
  assert.equal(withoutNodes.state,"PARTIAL");
  assert.ok(withoutNodes.diagnostics.some(x=>x.code==="SOURCE_ROOT_INVALID"));
  assert.ok(!withoutNodes.diagnostics.some(x=>x.code==="PROCEDURE_PROJECTION"));
});

test("unreachable Postcondition success cannot hide reachable success bypass",()=>{
  const orphan=[
    "  orphan:",
    "    postcondition:",
    "      predicates:",
    "        - predicate: demo.done",
    "          arguments: [read.observation.output]",
    "      routes:",
    "        PASS: SUCCEEDED",
    "        FAIL: FAILED",
    "        UNKNOWN: UNRESOLVED",
    ""
  ].join("\n");
  const illegal=procedure.replace("SUCCEEDED: final","SUCCEEDED: SUCCEEDED")
    .replace("PASS: SUCCEEDED","PASS: FAILED")+orphan;
  const bypass=analyzePackageSnapshot(snapshot(illegal));
  assert.ok(bypass.diagnostics.some(x=>x.code==="FINAL_POSTCONDITION_MISSING"));

  const stopOnly=procedure.replace("PASS: SUCCEEDED","PASS: FAILED")+orphan;
  const stopped=analyzePackageSnapshot(snapshot(stopOnly));
  assert.ok(!stopped.diagnostics.some(x=>
    x.code==="FINAL_POSTCONDITION_MISSING"||x.code==="SUCCESS_BYPASSES_FINAL_POSTCONDITION"));
});

test("global gate accepts ASCII Identifier variants and rejects missing or unreachable stage",()=>{
  const renamed=analyzePackageSnapshot(snapshot(
    procedure.replaceAll("check","Check_UE"),
    contract.replace("check.precondition","Check_UE.precondition")
  ));
  assert.ok(!renamed.diagnostics.some(x=>x.code==="ENTRY_PRECONDITION_REF_INVALID"));

  for(const missing of ["absent.precondition","read.precondition"]) {
    const a=analyzePackageSnapshot(snapshot(procedure,
      contract.replace("check.precondition",missing)));
    assert.ok(a.diagnostics.some(x=>
      x.code==="ENTRY_PRECONDITION_REF_INVALID"&&
      x.relativePath==="assurance/contract.yaml"),missing);
  }

  const unreachable=analyzePackageSnapshot(snapshot(
    procedure.replace("start: check","start: read"),contract));
  assert.ok(unreachable.diagnostics.some(x=>
    x.code==="ENTRY_PRECONDITION_REF_INVALID"&&
    x.relativePath==="assurance/contract.yaml"));
});
