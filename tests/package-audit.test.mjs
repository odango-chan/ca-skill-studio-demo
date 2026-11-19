import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {auditPackageWorkspace} from "../site/package-audit.mjs";
import {createFileWorkspace} from "../site/sample-packages.mjs";
import {previewNodeOperatorValue,applyNodeOperatorValue,
  previewNodeBindingFrom,applyNodeBindingFrom} from "../site/node-attributes.mjs";

function fixture(skill){
  const paths=skill==="ensure-pdu-session"?
    ["SKILL.md","assurance/contract.yaml","assurance/procedure.yaml",
     "assurance/predicates.yaml"]:
    ["SKILL.md","assurance/contract.yaml","assurance/procedure.yaml",
     "assurance/predicates.yaml",
     "schemas/establishment-request.schema.yaml",
     "scripts/select_establishment_configuration.py",
     "scripts/evaluate_udm_read.py",
     "scripts/evaluate_transfer_start.py"];
  return createFileWorkspace(skill,paths.map(path=>({path,text:readFileSync(
    new URL("./fixtures/legacy-site-samples/packages/"+skill+"/"+path,import.meta.url),"utf8")})));
}
const audit=workspace=>auditPackageWorkspace(workspace);
const codes=issues=>issues.map(x=>x.code);

test("Legacy baseline runs source checks and reports checks outside the browser audit boundary",()=>{
  for(const skill of ["ensure-pdu-session","establish-pdu-session"]){
    const issues=audit(fixture(skill));
    assert.ok(!issues.some(item=>item.severity==="error"),JSON.stringify(issues));
    assert.ok(codes(issues).includes("CAPABILITY_AUTHORIZATION_NOT_CHECKED"));
    if(skill==="establish-pdu-session")
      assert.ok(codes(issues).includes("PYTHON_SYNTAX_NOT_CHECKED"));
    assert.ok(issues.every(item=>item.path&&item.line>0&&item.status));
  }
});
test("A5 checks Contract entry, PredicateSet skill and missing schema",()=>{
  const w=fixture("ensure-pdu-session");
  w.files.get("assurance/contract.yaml").text=w.files.get("assurance/contract.yaml").text
    .replace("entryProcedure: ensure-session","entryProcedure: deleted-entry")
    .replace("name: ensure-pdu-session","name: wrong-skill")
    .replace("skillType: executable","skillType: executable\n  inputs:\n    requestSchema: schemas/not-present.yaml");
  w.files.get("assurance/predicates.yaml").text=
    w.files.get("assurance/predicates.yaml").text.replace(
      "skill: ensure-pdu-session","skill: wrong-skill");
  const issues=audit(w);
  assert.ok(codes(issues).includes("ENTRY_PROCEDURE"));
  assert.ok(codes(issues).includes("CONTRACT_NAME"));
  assert.ok(codes(issues).includes("PREDICATE_SKILL"));
  assert.ok(codes(issues).includes("REQUEST_SCHEMA"));
  assert.ok(issues.every(x=>x.path&&x.line>0&&["confirmed","not_checked"].includes(x.status)));
});
test("A5 detects unsupported Call and a missing Predicate without refusing authored Source",()=>{
  const w=fixture("ensure-pdu-session");
  const baseline=audit(w);
  const before=w.files.get("assurance/procedure.yaml").text;
  const changed=applyNodeOperatorValue(before,
    previewNodeOperatorValue(before,"ensure-session","create-session","unlisted.operation"));
  const issues=auditPackageWorkspace(w,changed);
  assert.ok(codes(issues).includes("CAPABILITY_UNDECLARED"));
  assert.deepEqual(audit(w),baseline,"Preview must not mutate Package");
  w.files.get("assurance/procedure.yaml").text=changed.replace(
    "verify: pdu_session.target.satisfied","verify: bogus.predicate");
  assert.ok(codes(audit(w)).includes("NODE_PREDICATE"));
});
test("A5 flags obvious mismatched input binding as heuristic, not Runtime truth",()=>{
  const w=fixture("ensure-pdu-session");
  const baseline=audit(w);
  const before=w.files.get("assurance/procedure.yaml").text;
  const changed=applyNodeBindingFrom(before,
    previewNodeBindingFrom(before,"ensure-session","create-session","supi","input.dnn"));
  const issues=auditPackageWorkspace(w,changed);
  assert.ok(codes(issues).includes("INPUT_BINDING_SUSPECT"));
  assert.match(issues.find(x=>x.code==="INPUT_BINDING_SUSPECT").message,/人工确认/);
  assert.deepEqual(audit(w),baseline);
});
test("A5 reports unknown input source, absent producer and missing script",()=>{
  const w=fixture("establish-pdu-session");
  const procedure=w.files.get("assurance/procedure.yaml");
  procedure.text=procedure.text
    .replace("from: input.ue-ref","from: input.invalid-ue")
    .replace("from: nudm-sdm-get.output","from: vanished-node.output")
    .replace("scripts/select_establishment_configuration.py","scripts/missing_thing.py");
  const issues=audit(w);
  assert.ok(codes(issues).includes("INPUT_MISSING"));
  assert.ok(codes(issues).includes("PRODUCER_MISSING"));
  assert.ok(codes(issues).includes("SCRIPT_MISSING"));
});
test("partial inventory and malformed YAML never become an empty successful audit",()=>{
  const partial=createFileWorkspace("single",[{path:"assurance/procedure.yaml",text:"bad: ["}]);
  const partialIssues=auditPackageWorkspace({...partial,completeness:"partial"});
  assert.ok(codes(partialIssues).includes("PACKAGE_SNAPSHOT_INCOMPLETE"));
  assert.ok(codes(partialIssues).includes("CORE_FILE_NOT_OBSERVED"));
  assert.ok(codes(partialIssues).includes("YAML_PARSE"));
  assert.ok(codes(partialIssues).includes("PROCEDURE_CHECKS_NOT_CHECKED"));

  const w=fixture("ensure-pdu-session");
  w.files.get("assurance/contract.yaml").text=w.files.get("assurance/contract.yaml").text
    .replace("entryProcedure: ensure-session","entryProcedure: missing-entry");
  w.files.get("assurance/predicates.yaml").text="bad: [";
  w.files.get("assurance/procedure.yaml").text="bad: [";
  const issues=audit(w);
  assert.ok(codes(issues).filter(code=>code==="YAML_PARSE").length>=2);
  assert.ok(codes(issues).includes("ENTRY_PROCEDURE"));
  assert.ok(codes(issues).includes("PREDICATE_CHECKS_NOT_CHECKED"));
  assert.ok(codes(issues).includes("PROCEDURE_CHECKS_NOT_CHECKED"));
});

test("invalid legacy graph projection does not suppress independent Contract and Predicate checks",()=>{
  const w=fixture("ensure-pdu-session");
  w.files.get("assurance/contract.yaml").text=w.files.get("assurance/contract.yaml").text
    .replace("entryProcedure: ensure-session","entryProcedure: missing-entry")
    .replace("name: ensure-pdu-session","name: wrong-name");
  w.files.get("assurance/predicates.yaml").text=w.files.get("assurance/predicates.yaml").text
    .replace("skill: ensure-pdu-session","skill: wrong-name");
  w.files.get("assurance/procedure.yaml").text=w.files.get("assurance/procedure.yaml").text
    .replace("verify: pdu_session.target.satisfied","unknownOperator: pdu_session.target.satisfied");
  const issues=audit(w);
  assert.ok(codes(issues).includes("PROCEDURE_GRAPH_PROJECTION_NOT_CHECKED"));
  assert.ok(codes(issues).includes("CONTRACT_NAME"));
  assert.ok(codes(issues).includes("PREDICATE_SKILL"));
  assert.ok(codes(issues).includes("ENTRY_PROCEDURE"));
  assert.ok(codes(issues).includes("NODE_OPERATOR_COUNT"));
});
