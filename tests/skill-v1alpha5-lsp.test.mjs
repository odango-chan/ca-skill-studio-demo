import test from "node:test";
import assert from "node:assert/strict";
import { mkdir,mkdtemp,rm } from "node:fs/promises";
import {readFileSync} from "node:fs";
import { join,resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const tempRoot=resolve(".agent-tmp");
await mkdir(tempRoot,{recursive:true});
const directory=await mkdtemp(join(tempRoot,"v1alpha5-lsp-"));
let analyzePackageSnapshot,inspectionSnapshot;
let buildSkillSymbolIndex,skillSymbolAt,uniqueSkillSymbolDeclaration,
  skillSymbolOccurrences,collectSkillSemanticTokenSpans;
try {
  const outfile=join(directory,"index.mjs");
  await build({entryPoints:["language/core/index.ts"],outfile,bundle:true,
    format:"esm",platform:"node",target:"node24",packages:"external",logLevel:"silent"});
  ({analyzePackageSnapshot}=await import(pathToFileURL(outfile).href));
  const inspectionFile=join(directory,"inspection.mjs");
  await build({entryPoints:["experiments/ide-host/vscode/src/inspection.mjs"],
    outfile:inspectionFile,bundle:true,format:"esm",platform:"node",
    target:"node24",packages:"external",logLevel:"silent"});
  ({inspectionSnapshot}=await import(pathToFileURL(inspectionFile).href));
  // Bundle language modules as the production Worker does: their canonical
  // semantic token contract is JSON and is not a direct untyped Node import.
  const symbolFile=join(directory,"symbols.mjs");
  await build({entryPoints:["language/symbol-index.mjs"],outfile:symbolFile,
    bundle:true,format:"esm",platform:"node",target:"node24",
    packages:"external",logLevel:"silent"});
  ({buildSkillSymbolIndex,skillSymbolAt,uniqueSkillSymbolDeclaration,
    skillSymbolOccurrences}=await import(pathToFileURL(symbolFile).href));
  const tokenFile=join(directory,"tokens.mjs");
  await build({entryPoints:["language/semantic-tokens.mjs"],outfile:tokenFile,
    bundle:true,format:"esm",platform:"node",target:"node24",
    packages:"external",logLevel:"silent"});
  ({collectSkillSemanticTokenSpans}=await import(pathToFileURL(tokenFile).href));
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
    "SKILL.md":"---\nname: sample\ndescription: v1alpha5\n---\n",
    "assurance/contract.yaml":contractSource,
    "assurance/procedure.yaml":source,
    "assurance/predicates.yaml":predicatesSource,
    "schemas/request.schema.yaml":"$schema: https://json-schema.org/draft/2020-12/schema\ntype: object\n",
    "scripts/runner.py":"def main():\n    return {}\n"
  };
  return {rootUri:"file:///workspace/sample",packageName:"sample",generation:1,
    completeness:"complete",documents:Object.entries(files).map(([relativePath,text])=>({
      uri:"file:///workspace/sample/"+relativePath,relativePath,text,version:1
    }))};
}

test("optional Studio examples mirror the pinned PDU/MAS v1alpha5 source shape",()=>{
  for(const [name,expectedNodes] of [["establish-pdu-session",11],["establish-pdu-session-mas",14]]) {
    const files=["SKILL.md","assurance/contract.yaml","assurance/procedure.yaml",
      "assurance/predicates.yaml","schemas/establishment-request.schema.yaml"];
    const docs=files.map(relativePath=>({
      relativePath,uri:"file:///workspace/"+name+"/"+relativePath,version:1,
      text:readFileSync(new URL("../site/samples/v1alpha5/"+name+"/"+relativePath,import.meta.url),"utf8")
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

test("v1alpha5 5GC sample projects Node-entry Wait, wait.output and the Step 17 response boundary",()=>{
  const procedureText=readFileSync(new URL(
    "../site/samples/v1alpha5/establish-pdu-session/assurance/procedure.yaml",import.meta.url
  ),"utf8");
  const contractText=readFileSync(new URL(
    "../site/samples/v1alpha5/establish-pdu-session/assurance/contract.yaml",import.meta.url
  ),"utf8");
  const predicateText=readFileSync(new URL(
    "../site/samples/v1alpha5/establish-pdu-session/assurance/predicates.yaml",import.meta.url
  ),"utf8");
  const a=analyzePackageSnapshot(snapshot(procedureText,contractText,predicateText));
  assert.equal(a.procedure.state,"READY");
  assert.ok(!a.diagnostics.some(item=>item.severity==="error"),
    JSON.stringify(a.diagnostics));
  const procedureView=a.procedure.procedures[0];
  const waitNode=procedureView.nodes.find(item=>item.id==="update-sm-context");
  assert.deepEqual(waitNode.wait.event,{
    source:"AMF",service:"Nsmf_PDUSession",operation:"UpdateSMContext"
  });
  assert.equal(waitNode.wait.timeout,"PT30S");
  assert.equal(waitNode.wait.timeoutTarget,"handle-update-timeout");
  assert.equal(waitNode.wait.responseAfter,"prepare-step17-response");
  assert.ok(waitNode.stages.some(stage=>stage.name==="operation"));
  assert.ok(!waitNode.stages.some(stage=>stage.name==="wait"),
    "Wait is Node-entry control, not a fifth business stage");
  assert.ok(procedureView.routes.some(route=>route.source==="update-sm-context"&&
    route.routeSource==="wait"&&route.outcome==="TIMEOUT"&&
    route.target==="handle-update-timeout"));

  const files=new Map([
    ["assurance/contract.yaml",{text:contractText}],
    ["assurance/predicates.yaml",{text:predicateText}]
  ]);
  const view=inspectionSnapshot(procedureText,{nodeId:"update-sm-context"},
    null,files,"establish-pdu-session","file:///workspace/establish-pdu-session");
  assert.equal(view.model.state,"READY");
  const waitRow=view.inspection.find(item=>item.kind==="v1alpha5-node"&&
    item.nodeId==="update-sm-context");
  assert.ok(waitRow.children.some(item=>item.kind==="v1alpha5-wait"&&
    item.label.includes("AMF/Nsmf_PDUSession/UpdateSMContext")));
  assert.ok(waitRow.children.some(item=>item.label.includes(
    "Response boundary · prepare-step17-response")));
  assert.ok(view.dataflow.bindings.some(item=>
    item.value==="update-sm-context.wait.output"&&item.kind==="Wait Output"));
});

test("v1alpha5 Wait rejects invalid duration, timeout routes, response boundaries and Wait-only Nodes",()=>{
  const procedureText=readFileSync(new URL(
    "../site/samples/v1alpha5/establish-pdu-session/assurance/procedure.yaml",import.meta.url
  ),"utf8");
  const contractText=readFileSync(new URL(
    "../site/samples/v1alpha5/establish-pdu-session/assurance/contract.yaml",import.meta.url
  ),"utf8");
  const predicateText=readFileSync(new URL(
    "../site/samples/v1alpha5/establish-pdu-session/assurance/predicates.yaml",import.meta.url
  ),"utf8");
  const invalidDuration=analyzePackageSnapshot(snapshot(
    procedureText.replace("timeout: PT30S","timeout: PT0S"),contractText,predicateText));
  assert.ok(invalidDuration.diagnostics.some(item=>item.code==="WAIT_TIMEOUT_INVALID"));

  const invalidTimeoutRoute=analyzePackageSnapshot(snapshot(
    procedureText.replace("TIMEOUT: handle-update-timeout","SUCCEEDED: handle-update-timeout"),
    contractText,predicateText));
  assert.ok(invalidTimeoutRoute.diagnostics.some(item=>
    item.code==="WAIT_TIMEOUT_ROUTE_INVALID"));

  const invalidBoundary=analyzePackageSnapshot(snapshot(
    procedureText.replace("after: prepare-step17-response","after: missing-response-node"),
    contractText,predicateText));
  assert.ok(invalidBoundary.diagnostics.some(item=>
    item.code==="WAIT_RESPONSE_BOUNDARY_INVALID"));

  const waitOnly=[
    "start: wait-only",
    "nodes:",
    "  wait-only:",
    "    wait:",
    "      event: {source: AMF, service: Nsmf_PDUSession, operation: UpdateSMContext}",
    "      timeout: PT30S",
    "      routes: {TIMEOUT: SAFE_STOPPED}",
    ""
  ].join("\n");
  const only=analyzePackageSnapshot(snapshot(waitOnly,"goal: demo.ready\n","predicates: {}\n"));
  assert.equal(only.procedure.state,"UNAVAILABLE");
  assert.ok(only.diagnostics.some(item=>item.code==="WAIT_NODE_STAGE_REQUIRED"));
});

test("v1alpha5 AST graph projects nodes and routes but never claims Owner qualification",()=>{
  const a=analyzePackageSnapshot(snapshot());
  assert.equal(a.state,"PARTIAL");
  assert.equal(a.packageAudit.state,"UNAVAILABLE");
  assert.match(a.packageAudit.reason,/Owner.*linking/);
  assert.equal(a.procedure.state,"READY");
  assert.equal(a.procedure.entry,"check");
  assert.equal(a.procedure.goal,"pdu_session.initial_request_fulfilled");
  assert.equal(a.procedure.precondition,"check.precondition");
  assert.deepEqual(a.procedure.finalPostconditionNodes,["final"]);
  assert.deepEqual(a.procedure.procedures[0].nodes.map(x=>x.id),["check","read","final"]);
  assert.deepEqual(a.procedure.procedures[0].nodes[0].stages.map(x=>x.name),["precondition"]);
  assert.equal(a.procedure.procedures[0].nodes[0].globalPrecondition,true);
  assert.equal(a.procedure.procedures[0].nodes[2].finalGoal,true);
  const readStage=a.procedure.procedures[0].nodes[1].stages[0];
  assert.deepEqual(readStage.arguments.map(x=>[x.name,x.value]),
    [["ueRef","context.ueRef"]]);
  const finalCall=a.procedure.procedures[0].nodes[2].stages[0].calls[0];
  assert.equal(finalCall.predicate,"demo.done");
  assert.deepEqual(finalCall.parameters,["data"]);
  assert.deepEqual(finalCall.arguments,["read.observation.output"]);
  assert.ok(a.procedure.procedures[0].routes.some(x=>x.target==="SUCCEEDED"&&x.routeSource==="postcondition"));
  assert.deepEqual(a.diagnostics,[]);
});

test("v1alpha5 carries PredicateSet Evidence requirements into the shared stage projection",()=>{
  const withEvidence=predicates.replace(
    "  demo.done:\n    parameters: [{data: ca::urn:example:result:v1}]",
    "  demo.done:\n    parameters: [{data: ca::urn:example:result:v1}]\n    evidence:\n      requires:\n        data: [ca::demo.verified]"
  );
  const a=analyzePackageSnapshot(snapshot(procedure,contract,withEvidence));
  const call=a.procedure.procedures[0].nodes.find(x=>x.id==="final")
    .stages[0].calls[0];
  assert.deepEqual(call.evidenceRequirements,[
    {parameter:"data",evidence:["ca::demo.verified"]}
  ]);
});

test("v1alpha5 Inspector shows Contract Goal and source-only Producer / Evidence flow",()=>{
  const withEvidence=predicates.replace(
    "  demo.done:\n    parameters: [{data: ca::urn:example:result:v1}]",
    "  demo.done:\n    parameters: [{data: ca::urn:example:result:v1}]\n    evidence:\n      requires:\n        data: [ca::demo.verified]"
  );
  const files=new Map([
    ["assurance/contract.yaml",{text:contract}],
    ["assurance/predicates.yaml",{text:withEvidence}]
  ]);
  const view=inspectionSnapshot(procedure,{procedureId:"sample",nodeId:"final"},
    null,files,"sample","file:///workspace/sample");
  assert.equal(view.model.state,"READY");
  assert.ok(view.outline[0].children.some(item=>
    item.kind==="v1alpha5-node"&&item.nodeId==="final"));
  assert.ok(view.inspection.some(item=>item.label.includes(
    "Contract Goal · pdu_session.initial_request_fulfilled")));
  const goalRow=view.inspection.find(item=>item.kind==="v1alpha5-contract"&&
    item.label.startsWith("Contract Goal"));
  const gateRow=view.inspection.find(item=>item.kind==="v1alpha5-contract"&&
    item.label.startsWith("Global Precondition"));
  assert.equal(goalRow.line,1);
  assert.equal(gateRow.line,2);
  assert.equal(goalRow.sourcePath,"assurance/contract.yaml");
  assert.equal(gateRow.sourcePath,"assurance/contract.yaml");
  assert.ok(view.inspection.some(item=>item.label.startsWith("Data Flow ·")));
  const binding=view.dataflow.bindings.find(item=>
    item.value==="read.observation.output");
  assert.equal(binding.kind,"Producer");
  assert.equal(binding.producerNode,"read");
  assert.deepEqual(binding.evidenceRequirements,[
    {parameter:"data",evidence:["ca::demo.verified"]}
  ]);
  assert.equal(binding.line,24,"Predicate argument navigation uses the argument's exact line");
  const rows=[];
  const collect=items=>{for(const item of items??[]){rows.push(item);collect(item.children);}};
  collect(view.inspection);
  const evidenceRow=rows.find(item=>item.kind==="v1alpha5-evidence");
  assert.equal(evidenceRow.line,11,"Evidence navigation uses the PredicateSet declaration line");
  assert.equal(evidenceRow.sourcePath,"assurance/predicates.yaml");
  const node=view.inspection.find(item=>item.kind==="v1alpha5-node");
  assert.ok(node.children.some(item=>item.kind==="v1alpha5-stage"));
});

test("v1alpha5 rejects author reconcile/legacy wrappers without automatic conversion",()=>{
  const altered=procedure.replace("    observation:\n", "    reconcile: read\n    observation:\n");
  const a=analyzePackageSnapshot(snapshot(altered));
  assert.equal(a.procedure.state,"UNAVAILABLE");
  assert.ok(a.diagnostics.some(x=>x.code==="UNKNOWN_FIELD"&&x.message.includes("reconcile")));
});

test("v1alpha5 enforces stage-normal routing and Script-only outcomes",()=>{
  const withLaterStage=procedure.replace(
    "        PASS: read\n        FAIL: FAILED\n        UNKNOWN: UNRESOLVED\n  read:",
    "        PASS: read\n        FAIL: FAILED\n        UNKNOWN: UNRESOLVED\n    operation:\n      script: scripts/runner.py\n      arguments: {}\n      routes:\n        SUCCEEDED: read\n        FAILED: FAILED\n  read:"
  );
  const nonFinalNormal=analyzePackageSnapshot(snapshot(withLaterStage));
  assert.ok(nonFinalNormal.diagnostics.some(x=>
    x.code==="ROUTE_NORMAL_OUTCOME_NOT_ALLOWED"));

  const scriptWithMutationOutcome=procedure.replace(
    "  read:\n    observation:\n      tool: ca::session.read\n      arguments:\n        ueRef: context.ueRef\n      routes:\n        SUCCEEDED: final\n        FAILED: FAILED",
    "  read:\n    operation:\n      script: scripts/runner.py\n      arguments: {}\n      routes:\n        SUCCEEDED: final\n        FAILED: FAILED\n        OUTCOME_UNKNOWN: SAFE_STOPPED"
  );
  const invalidScript=analyzePackageSnapshot(snapshot(scriptWithMutationOutcome));
  assert.ok(invalidScript.diagnostics.some(x=>x.code==="ROUTE_OUTCOME_UNKNOWN"&&
    x.message.includes("OUTCOME_UNKNOWN")));
});

test("v1alpha5 recognizes missing direct final Postcondition",()=>{
  const altered=procedure.replace("PASS: SUCCEEDED","PASS: FAILED")
    .replace("SUCCEEDED: final","SUCCEEDED: unsafe")+
    "  unsafe:\n    operation:\n      tool: ca::session.mutate\n      arguments: {}\n      routes:\n        SUCCEEDED: SUCCEEDED\n        OUTCOME_UNKNOWN: SAFE_STOPPED\n";
  const a=analyzePackageSnapshot(snapshot(altered));
  assert.ok(a.diagnostics.some(x=>x.code==="FINAL_POSTCONDITION_MISSING"));
});

test("v1alpha5 reports reachable cycle without invoking legacy procedure projector",()=>{
  const altered=procedure.replace("SUCCEEDED: final","SUCCEEDED: check");
  const a=analyzePackageSnapshot(snapshot(altered));
  assert.ok(a.diagnostics.some(x=>x.code==="CONTROL_FLOW_CYCLE"));
});

test("v1alpha5 rejects duplicate YAML keys and invalid predicate groups",()=>{
  const duplicate=procedure.replace("start: check","start: check\nstart: read");
  let a=analyzePackageSnapshot(snapshot(duplicate));
  assert.ok(a.diagnostics.some(x=>x.code==="YAML_PARSE_ERROR"));
  const empty=procedure.replace("predicates:\n        - predicate: demo.ready\n          arguments: [context.ueRef]","predicates: []");
  a=analyzePackageSnapshot(snapshot(empty));
  assert.ok(a.diagnostics.some(x=>x.code==="PREDICATE_GROUP_INVALID"));
});

test("v1alpha5 checks positional Predicate arity and permits explicit zero-parameter signatures",()=>{
  const wrongArity=analyzePackageSnapshot(snapshot(
    procedure.replace("arguments: [context.ueRef]","arguments: []")));
  assert.ok(wrongArity.diagnostics.some(x=>x.code==="PREDICATE_ARITY_MISMATCH"));

  const zeroParameters=analyzePackageSnapshot(snapshot(
    procedure.replace("arguments: [context.ueRef]","arguments: []"),
    contract,
    predicates.replace("parameters: [{ue: string}]","parameters: []")
  ));
  assert.ok(!zeroParameters.diagnostics.some(x=>
    x.code==="PREDICATE_GROUP_INVALID"||x.code==="PREDICATE_ARITY_MISMATCH"));
  assert.equal(zeroParameters.procedure.state,"READY");
});

test("v1alpha5 rejects primitive literal Predicate argument type mismatches",()=>{
  const wrongType=analyzePackageSnapshot(snapshot(
    procedure.replace("arguments: [context.ueRef]","arguments: [true]")));
  assert.ok(wrongType.diagnostics.some(x=>x.code==="PREDICATE_TYPE_MISMATCH"));
});

test("v1alpha5 marks no Owner identity as a missing qualification, not a synthetic PASS",()=>{
  const a=analyzePackageSnapshot(snapshot());
  assert.notEqual(a.state,"READY");
  assert.ok(a.packageAudit.reason.includes("requires v1alpha5 Compiler"));
});

test("v1alpha5 partial root edits do not switch back to the legacy procedure parser",()=>{
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
  assert.ok(stopped.diagnostics.some(x=>
    x.code==="UNREACHABLE_NODE"&&x.severity==="warning"));
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

test("success reachability is stage-sensitive within a multi-stage Node",()=>{
  const localFinal=[
    "    postcondition:",
    "      predicates:",
    "        - predicate: demo.done",
    "          arguments: [read.observation.output]",
    "      routes:",
    "        PASS: SUCCEEDED",
    "        FAIL: FAILED",
    "        UNKNOWN: UNRESOLVED",
    "  final:",
    ""
  ].join("\n");
  const base=procedure.replace("  final:\n",localFinal);
  // An explicit normal route bypasses the later postcondition in the
  // same Node. The also-unreachable original final cannot supply proof.
  const bypass=analyzePackageSnapshot(snapshot(
    base.replace("SUCCEEDED: final","SUCCEEDED: SUCCEEDED")));
  assert.ok(bypass.diagnostics.some(x=>x.code==="FINAL_POSTCONDITION_MISSING"));

  // Without the explicit normal route, the Observation SUCCEEDED outcome
  // implicitly advances to the local Postcondition.
  const advanced=analyzePackageSnapshot(snapshot(
    base.replace("        SUCCEEDED: final\n","")));
  assert.ok(!advanced.diagnostics.some(x=>
    x.code==="FINAL_POSTCONDITION_MISSING"||x.code==="SUCCESS_BYPASSES_FINAL_POSTCONDITION"));
});

test("invalid Contract or PredicateSet does not hide a valid Procedure diagram",()=>{
  const invalidContract=analyzePackageSnapshot(snapshot(
    procedure,contract.replace("goal:","oldGoal:")));
  assert.equal(invalidContract.procedure.state,"READY");
  assert.ok(invalidContract.diagnostics.some(x=>
    x.relativePath==="assurance/contract.yaml"&&x.severity==="error"));

  const invalidPredicates=analyzePackageSnapshot(snapshot(
    procedure,contract,predicates.replace("parameters: [{ue: string}]","parameters: [{ue: string, invalid: string}]")));
  assert.equal(invalidPredicates.procedure.state,"READY");
  assert.ok(invalidPredicates.diagnostics.some(x=>
    x.relativePath==="assurance/predicates.yaml"&&x.severity==="error"));
});

test("v1alpha5 Contract global gate Definition and References use exact source ranges",()=>{
  const source=snapshot();
  const index=buildSkillSymbolIndex(source);
  const c=source.documents.find(item=>item.relativePath==="assurance/contract.yaml");
  const p=source.documents.find(item=>item.relativePath==="assurance/procedure.yaml");
  const at=c.text.indexOf("check.precondition")+2;
  assert.ok(at>0);
  const hit=skillSymbolAt(index,c.uri,at);
  assert.equal(hit?.token.name,"check.precondition");
  const target=uniqueSkillSymbolDeclaration(hit);
  assert.equal(target?.relativePath,"assurance/procedure.yaml");
  assert.equal(p.text.slice(target.range.start,target.range.end),"check");
  const refs=skillSymbolOccurrences(hit,true);
  assert.ok(refs.some(item=>item.uri===c.uri&&item.name==="check.precondition"));
  assert.ok(refs.some(item=>item.uri===p.uri&&item.name==="check"));
});

test("v1alpha5 Predicate references resolve only declared Package-local names",()=>{
  const source=snapshot();
  const index=buildSkillSymbolIndex(source);
  const p=source.documents.find(item=>item.relativePath==="assurance/procedure.yaml");
  const at=p.text.indexOf("demo.ready")+3;
  const hit=skillSymbolAt(index,p.uri,at);
  assert.equal(hit?.token.type,"skillPredicate");
  const target=uniqueSkillSymbolDeclaration(hit);
  assert.equal(target?.relativePath,"assurance/predicates.yaml");
  assert.equal(target?.name,"demo.ready");
});

test("v1alpha5 Observation tool reference is indexed without inventing an Owner",()=>{
  const source=snapshot();
  const index=buildSkillSymbolIndex(source);
  const p=source.documents.find(item=>item.relativePath==="assurance/procedure.yaml");
  const at=p.text.indexOf("ca::session.read")+5;
  const hit=skillSymbolAt(index,p.uri,at);
  assert.equal(hit?.token.type,"skillObservation");
  assert.equal(hit?.token.name,"ca::session.read");
  assert.equal(uniqueSkillSymbolDeclaration(hit),null);
});

test("v1alpha5 Script references resolve only to exact Package-owned script files",()=>{
  const sourceText=procedure
    .replace("SUCCEEDED: final","SUCCEEDED: run-script")
    .replace("  final:",[
      "  run-script:",
      "    operation:",
      "      script: scripts/runner.py",
      "      arguments: {}",
      "      routes:",
      "        SUCCEEDED: final",
      "        OUTCOME_UNKNOWN: SAFE_STOPPED",
      "  final:"
    ].join("\n"));
  const source=snapshot(sourceText);
  const index=buildSkillSymbolIndex(source);
  const p=source.documents.find(item=>item.relativePath==="assurance/procedure.yaml");
  const at=p.text.indexOf("scripts/runner.py")+5;
  const hit=skillSymbolAt(index,p.uri,at);
  assert.equal(hit?.token.type,"skillReference");
  const target=uniqueSkillSymbolDeclaration(hit);
  assert.equal(target?.relativePath,"scripts/runner.py");
  assert.equal(target?.uri,"file:///workspace/sample/scripts/runner.py");
});

test("partial v1alpha5 root edits retain AST semantic symbols",()=>{
  const broken=procedure.replace("start: check\\n","");
  const spans=collectSkillSemanticTokenSpans(broken,"assurance/procedure.yaml");
  assert.ok(spans.some(item=>item.type==="skillStep"&&
    item.modifiers?.includes("declaration")));
});
