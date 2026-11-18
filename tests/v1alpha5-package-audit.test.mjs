import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {auditV1Alpha5Package} from "../site/v1alpha5-package-audit.mjs";

const sampleRoot=new URL("../site/samples/v1alpha5/",import.meta.url);
const manifest=JSON.parse(readFileSync(new URL("files.json",sampleRoot),"utf8"));
function fixture(skill){
  const files=new Map();
  for(const entry of manifest.files.filter(path=>path.startsWith(skill+"/"))){
    const relative=entry.slice(skill.length+1);
    files.set(relative,{text:readFileSync(new URL(entry,sampleRoot),"utf8")});
  }
  return files;
}
function clone(files){
  return new Map([...files].map(([path,file])=>[path,{...file}]));
}
function codes(items){return items.map(item=>item.code);}
function find(items,code,fragment=""){
  return items.find(item=>item.code===code&&item.message.includes(fragment));
}

test("both released v1alpha5 Examples surface local and NOT_CHECKED blockers without Compiler",()=>{
  for(const skill of manifest.skills){
    const files=fixture(skill);
    const diagnostics=auditV1Alpha5Package({
      files,
      dependencyContext:{available:false,reason:"No project dependency context in this test"}
    });
    assert.ok(diagnostics.length>0,skill+" must not silently return an empty audit");
    assert.ok(codes(diagnostics).includes("CAPABILITY_GRANT_NOT_CHECKED"),skill);
    assert.ok(codes(diagnostics).includes("TOOL_LINK_NOT_CHECKED"),skill);
    assert.ok(codes(diagnostics).includes("EVIDENCE_GUARANTEE_NOT_CHECKED"),skill);
    assert.ok(codes(diagnostics).includes("SCHEMA_LINK_NOT_CHECKED"),skill);
    assert.ok(diagnostics.every(item=>item.id&&item.path&&item.line>0&&item.column>0),skill);
    assert.ok(diagnostics.every(item=>
      item.status==="not_checked"||item.status==="confirmed"||item.status==="blocked"),skill);
    assert.ok(!diagnostics.some(item=>
      item.status==="confirmed"&&item.severity==="error"),
      skill+" source baseline should not be rejected by local-only linking checks");
  }
});

test("Capability Grant diagnostics point to the exact Contract source line",()=>{
  const files=fixture("establish-pdu-session");
  const source=files.get("assurance/contract.yaml").text;
  const capability="urn:example:connectionagent:capability:3gpp:namf-communication-n1n2-transfer:v1";
  const expectedLine=source.split("\n").findIndex(line=>line.includes(capability))+1;
  assert.ok(expectedLine>0);
  const item=find(auditV1Alpha5Package({files,
    dependencyContext:{available:false}}),"CAPABILITY_GRANT_NOT_CHECKED",capability);
  assert.ok(item);
  assert.equal(item.path,"assurance/contract.yaml");
  assert.equal(item.line,expectedLine);
  assert.equal(item.status,"not_checked");
  assert.equal(item.severity,"warning");
  assert.equal(item.domain,"capabilities");
});

test("malformed and duplicate Capability Grants are confirmed source defects",()=>{
  const files=fixture("establish-pdu-session");
  const contract=files.get("assurance/contract.yaml");
  const grant="  - urn:example:connectionagent:capability:3gpp:nudm-sdm-get:v1";
  contract.text=contract.text.replace(grant,grant+"\n"+grant);
  const diagnostics=auditV1Alpha5Package({files,dependencyContext:{available:false}});
  const duplicate=find(diagnostics,"CAPABILITY_GRANT_DUPLICATE","nudm-sdm-get");
  assert.ok(duplicate);
  assert.equal(duplicate.status,"confirmed");
  assert.equal(duplicate.severity,"error");
  assert.equal(duplicate.path,"assurance/contract.yaml");
});

test("local Schema, Script, Predicate, Tool and producer references are checked",()=>{
  const files=fixture("establish-pdu-session");
  const contract=files.get("assurance/contract.yaml");
  contract.text=contract.text.replace(
    "requestSchema: schemas/establishment-request.schema.yaml",
    "requestSchema: ../outside/request.schema.yaml");
  const procedure=files.get("assurance/procedure.yaml");
  procedure.text=procedure.text
    .replace("tool: ca::sbi.udm.sm_data.get","tool: ghost::sbi.udm.sm_data.get")
    .replace("predicate: establishment.request.supported","predicate: establishment.missing_predicate")
    .replace("get-sm-subscription-data.operation.output.result",
      "ghost-node.operation.output.result");
  const predicates=files.get("assurance/predicates.yaml");
  predicates.text=predicates.text.replace(
    "scripts/validate-subscription-request.py","scripts/missing-script.py");
  const diagnostics=auditV1Alpha5Package({files,
    dependencyContext:{available:false}});
  assert.ok(codes(diagnostics).includes("REQUEST_SCHEMA_REFERENCE_INVALID"));
  assert.ok(codes(diagnostics).includes("TOOL_DEPENDENCY_UNDECLARED"));
  assert.ok(codes(diagnostics).includes("PREDICATE_REFERENCE_NOT_FOUND"));
  assert.ok(codes(diagnostics).includes("PRODUCER_NODE_NOT_FOUND"));
  assert.ok(codes(diagnostics).includes("PREDICATE_SCRIPT_NOT_FOUND"));
});

test("a complete inventory confirms a missing local Schema, partial inventory does not",()=>{
  const complete=fixture("establish-pdu-session");
  complete.delete("schemas/establishment-request.schema.yaml");
  const confirmed=auditV1Alpha5Package({files:complete,
    dependencyContext:{available:false},completeness:"complete"});
  assert.ok(codes(confirmed).includes("REQUEST_SCHEMA_NOT_FOUND"));
  const partial=auditV1Alpha5Package({files:complete,
    dependencyContext:{available:false},completeness:"partial",
    snapshotReason:"one file could not be read"});
  assert.ok(codes(partial).includes("REQUEST_SCHEMA_NOT_CHECKED"));
  assert.ok(!codes(partial).includes("REQUEST_SCHEMA_NOT_FOUND"));
  assert.ok(codes(partial).includes("PACKAGE_SNAPSHOT_INCOMPLETE"));
});

test("project dependency state distinguishes unconfigured dependencies from unavailable locks",()=>{
  const files=fixture("establish-pdu-session");
  const unconfigured=auditV1Alpha5Package({files,
    dependencyContext:{available:true,declarations:[],snapshots:[],diagnostics:[]}});
  assert.ok(codes(unconfigured).includes("DEPENDENCY_NOT_CONFIGURED"));
  assert.ok(codes(unconfigured).includes("TOOL_DEPENDENCY_UNDECLARED")===false,
    "Tool alias exists in Contract; absence from project configuration is a dependency error");

  const blocked=auditV1Alpha5Package({files,
    dependencyContext:{
      available:true,
      declarations:[{id:"ca",kind:"tool-catalog",source:{type:"builtin"}}],
      snapshots:[],
      diagnostics:[{dependencyId:"ca",code:"DEPENDENCY_UNLOCKED",message:"No pinned lock"}]
    }});
  assert.ok(codes(blocked).includes("DEPENDENCY_SNAPSHOT_UNAVAILABLE"));
  assert.ok(codes(blocked).includes("TOOL_DEPENDENCY_UNAVAILABLE"));
  assert.ok(blocked.some(item=>item.status==="blocked"));
});

test("a verified Tool Catalog resolves exact callable identity and reports absent callables",()=>{
  const files=fixture("establish-pdu-session");
  const context={
    available:true,
    declarations:[{id:"ca",kind:"tool-catalog",source:{type:"builtin"}}],
    snapshots:[{id:"ca",kind:"tool-catalog",snapshotDigest:"sha256:test"}],
    diagnostics:[],
    toolCatalogs:[{dependencyId:"ca",available:true}],
    operations:[{dependencyId:"ca",id:"sbi.udm.sm_data.get"}]
  };
  const resolved=auditV1Alpha5Package({files,dependencyContext:context});
  assert.ok(!resolved.some(item=>item.code==="TOOL_DECLARATION_NOT_FOUND"&&
    item.message.includes("ca::sbi.udm.sm_data.get")));
  const missing=auditV1Alpha5Package({files,dependencyContext:{
    ...context,operations:[]
  }});
  assert.ok(missing.some(item=>item.code==="TOOL_DECLARATION_NOT_FOUND"&&
    item.message.includes("ca::sbi.udm.sm_data.get")));
});

test("trusted CapabilityContracts input can resolve a unique declaration without Compiler",()=>{
  const files=fixture("establish-pdu-session");
  const contract=files.get("assurance/contract.yaml").text;
  const capability=contract.match(/- (urn:example:connectionagent:capability:3gpp:nudm-sdm-get:v1)/)?.[1];
  assert.ok(capability);
  const diagnostics=auditV1Alpha5Package({files,dependencyContext:{
    available:false,
    capabilityDeclarations:[{id:capability,trusted:true}]
  }});
  assert.ok(!diagnostics.some(item=>item.code==="CAPABILITY_GRANT_NOT_CHECKED"&&
    item.message.includes(capability)));
  assert.ok(diagnostics.some(item=>item.code==="CAPABILITY_DECLARATION_NOT_FOUND"),
    "other grants still fail closed when the supplied trusted declaration set is incomplete");
});
