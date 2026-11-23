import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {auditPackage,indexV1Alpha4ToolCatalogCallables}
  from "../site/package-audit.mjs";

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
    const diagnostics=auditPackage({
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

test("the default Example reports confirmed missing project dependencies without Compiler",()=>{
  const files=fixture("establish-pdu-session");
  const diagnostics=auditPackage({files,dependencyContext:{
    available:true,declarations:[],snapshots:[],diagnostics:[]
  }});
  const errors=diagnostics.filter(item=>item.severity==="error");
  assert.ok(errors.length>=10,"the incomplete default project should expose multiple real link blockers");
  assert.ok(errors.some(item=>item.code==="DEPENDENCY_NOT_CONFIGURED"));
  assert.ok(diagnostics.some(item=>item.code==="CAPABILITY_GRANT_NOT_CHECKED"&&
    item.status==="not_checked"),
    "Capability authority remains NOT_CHECKED rather than inventing a missing declaration");
  assert.ok(!diagnostics.some(item=>item.code==="CAPABILITY_DECLARATION_NOT_FOUND"),
    "no trusted CapabilityContracts input means no confirmed missing-declaration claim");
});

test("Capability Grant diagnostics point to the exact Contract source line",()=>{
  const files=fixture("establish-pdu-session");
  const source=files.get("assurance/contract.yaml").text;
  const capability="urn:example:connectionagent:capability:3gpp:namf-communication-n1n2-transfer:v1";
  const expectedLine=source.split("\n").findIndex(line=>line.includes(capability))+1;
  assert.ok(expectedLine>0);
  const item=find(auditPackage({files,
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
  const diagnostics=auditPackage({files,dependencyContext:{available:false}});
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
  const diagnostics=auditPackage({files,
    dependencyContext:{available:false}});
  assert.ok(codes(diagnostics).includes("REQUEST_SCHEMA_REFERENCE_INVALID"));
  assert.ok(codes(diagnostics).includes("TOOL_DEPENDENCY_UNDECLARED"));
  assert.ok(codes(diagnostics).includes("PREDICATE_REFERENCE_NOT_FOUND"));
  assert.ok(codes(diagnostics).includes("PRODUCER_NODE_NOT_FOUND"));
  assert.ok(codes(diagnostics).includes("PREDICATE_SCRIPT_NOT_FOUND"));
  const scriptDiagnostic=find(diagnostics,"PREDICATE_SCRIPT_NOT_FOUND","missing-script.py");
  assert.ok(scriptDiagnostic?.sourceRange);
  assert.equal(predicates.text.slice(scriptDiagnostic.sourceRange.start,
    scriptDiagnostic.sourceRange.end),"scripts/missing-script.py",
    "Package Audit must preserve the complete YAML scalar span");
});

test("current Predicate Script references use Package paths, not obsolete localTools declarations",()=>{
  const files=fixture("establish-pdu-session");
  const predicates=files.get("assurance/predicates.yaml");
  predicates.text += [
    "",
    "  createdsession.udm.subscription_usable:",
    "    parameters: []",
    "    evaluator:",
    "      type: script",
    "      script: scripts/evaluate_udm_read.py",
    ""
  ].join("\n");
  files.set("scripts/evaluate_udm_read.py",{text:"def main():\n    return {}\n"});
  const diagnostics=auditPackage({files,completeness:"complete",
    dependencyContext:{available:false}});
  assert.ok(!codes(diagnostics).includes("PREDICATE_SCRIPT_REF_UNDECLARED"),
    "current language analysis must not require the removed Contract.localTools list");
  assert.ok(!find(diagnostics,"PREDICATE_SCRIPT_NOT_FOUND","evaluate_udm_read.py"),
    "a declared current Package-relative Script path is resolved from Package inventory");
});

test("a complete inventory confirms a missing local Schema, partial inventory does not",()=>{
  const complete=fixture("establish-pdu-session");
  complete.delete("schemas/establishment-request.schema.yaml");
  const confirmed=auditPackage({files:complete,
    dependencyContext:{available:false},completeness:"complete"});
  assert.ok(codes(confirmed).includes("REQUEST_SCHEMA_NOT_FOUND"));
  const partial=auditPackage({files:complete,
    dependencyContext:{available:false},completeness:"partial",
    snapshotReason:"one file could not be read"});
  assert.ok(codes(partial).includes("REQUEST_SCHEMA_NOT_CHECKED"));
  assert.ok(!codes(partial).includes("REQUEST_SCHEMA_NOT_FOUND"));
  assert.ok(codes(partial).includes("PACKAGE_SNAPSHOT_INCOMPLETE"));
});

test("local Schema documents report YAML syntax and unsupported dialect defects",()=>{
  const valid=fixture("establish-pdu-session");
  const validDiagnostics=auditPackage({files:valid,dependencyContext:{available:false}});
  assert.ok(!validDiagnostics.some(item=>
    ["SCHEMA_DOCUMENT_PARSE_ERROR","SCHEMA_DOCUMENT_ROOT_INVALID",
      "SCHEMA_DIALECT_UNSUPPORTED","SCHEMA_DIALECT_INVALID"].includes(item.code)));

  const booleanSchema=clone(valid);
  booleanSchema.set("schemas/always-true.schema.yaml",{text:"true\n"});
  const booleanDiagnostics=auditPackage({files:booleanSchema,
    dependencyContext:{available:false}});
  assert.ok(!booleanDiagnostics.some(item=>
    item.path==="schemas/always-true.schema.yaml"&&
    ["SCHEMA_DOCUMENT_ROOT_INVALID","SCHEMA_DIALECT_NOT_CHECKED"].includes(item.code)),
    "JSON Schema boolean roots are valid standalone schemas");

  const missingDialect=clone(valid);
  missingDialect.get("schemas/establishment-request.schema.yaml").text=
    missingDialect.get("schemas/establishment-request.schema.yaml").text.replace(
      "$schema: https://json-schema.org/draft/2020-12/schema\n","");
  const dialectDiagnostic=find(auditPackage({files:missingDialect,
    dependencyContext:{available:false}}),"SCHEMA_DIALECT_NOT_CHECKED");
  assert.equal(dialectDiagnostic?.status,"not_checked");
  assert.equal(dialectDiagnostic?.severity,"warning");

  const unsupported=clone(valid);
  const schema=unsupported.get("schemas/establishment-request.schema.yaml");
  schema.text=schema.text.replace(
    "https://json-schema.org/draft/2020-12/schema",
    "https://json-schema.org/draft/2019-09/schema");
  const unsupportedDiagnostic=find(auditPackage({files:unsupported,
    dependencyContext:{available:false}}),"SCHEMA_DIALECT_UNSUPPORTED","2019-09");
  assert.ok(unsupportedDiagnostic);
  assert.equal(unsupportedDiagnostic.path,"schemas/establishment-request.schema.yaml");
  assert.equal(unsupportedDiagnostic.status,"confirmed");
  assert.equal(unsupportedDiagnostic.severity,"error");
  assert.ok(unsupportedDiagnostic.sourceRange);
  assert.equal(schema.text.slice(unsupportedDiagnostic.sourceRange.start,
    unsupportedDiagnostic.sourceRange.end),
    "https://json-schema.org/draft/2019-09/schema");

  const malformed=clone(valid);
  malformed.get("schemas/establishment-request.schema.yaml").text=
    "$schema: [unterminated\n";
  const parseDiagnostic=find(auditPackage({files:malformed,
    dependencyContext:{available:false}}),"SCHEMA_DOCUMENT_PARSE_ERROR");
  assert.ok(parseDiagnostic);
  assert.equal(parseDiagnostic.path,"schemas/establishment-request.schema.yaml");
  assert.equal(parseDiagnostic.status,"confirmed");
  assert.equal(parseDiagnostic.severity,"error");

  const invalidJson=clone(valid);
  invalidJson.set("schemas/invalid.schema.json",{text:"{type: object}\n"});
  const jsonDiagnostic=find(auditPackage({files:invalidJson,
    dependencyContext:{available:false}}),"SCHEMA_DOCUMENT_PARSE_ERROR","invalid.schema.json");
  assert.ok(jsonDiagnostic,
    "YAML-compatible flow mappings must not be accepted as JSON Schema .json files");
  assert.equal(jsonDiagnostic.path,"schemas/invalid.schema.json");
  assert.equal(jsonDiagnostic.status,"confirmed");
  assert.equal(jsonDiagnostic.severity,"error");
});

test("local Schema $id collisions are reported at the duplicate declaration",()=>{
  const files=fixture("establish-pdu-session");
  const source=files.get("schemas/establishment-request.schema.yaml").text;
  const id=/^\$id:\s*(\S+)/m.exec(source)?.[1];
  assert.ok(id);
  files.set("schemas/z-duplicate.schema.yaml",{text:source});
  const diagnostic=find(auditPackage({files,dependencyContext:{available:false}}),
    "SCHEMA_ID_DUPLICATE","establishment-request");
  assert.ok(diagnostic);
  assert.equal(diagnostic.path,"schemas/z-duplicate.schema.yaml");
  assert.equal(diagnostic.status,"confirmed");
  assert.equal(diagnostic.severity,"error");
  assert.ok(diagnostic.sourceRange);
  assert.equal(files.get(diagnostic.path).text.slice(
    diagnostic.sourceRange.start,diagnostic.sourceRange.end),id);
});

test("project dependency state distinguishes unconfigured dependencies from unavailable locks",()=>{
  const files=fixture("establish-pdu-session");
  const unconfigured=auditPackage({files,
    dependencyContext:{available:true,declarations:[],snapshots:[],diagnostics:[]}});
  assert.ok(codes(unconfigured).includes("DEPENDENCY_NOT_CONFIGURED"));
  assert.ok(codes(unconfigured).includes("TOOL_DEPENDENCY_UNDECLARED")===false,
    "Tool alias exists in Contract; absence from project configuration is a dependency error");

  const blocked=auditPackage({files,
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

test("audit continues Predicate Script checks when Procedure is missing",()=>{
  const files=fixture("establish-pdu-session");
  files.delete("assurance/procedure.yaml");
  const predicates=files.get("assurance/predicates.yaml");
  predicates.text=predicates.text.replace(
    "scripts/validate-subscription-request.py","scripts/missing-script.py");
  const diagnostics=auditPackage({files,completeness:"complete",
    dependencyContext:{available:false}});
  assert.ok(codes(diagnostics).includes("PACKAGE_CORE_FILE_MISSING"));
  const script=find(diagnostics,"PREDICATE_SCRIPT_NOT_FOUND","scripts/missing-script.py");
  assert.ok(script,"available PredicateSet checks must continue after Procedure is missing");
  assert.equal(script.path,"assurance/predicates.yaml");
});

test("audit reports Predicate references as NOT_CHECKED when PredicateSet is unavailable",()=>{
  const files=fixture("establish-pdu-session");
  files.delete("assurance/predicates.yaml");
  const diagnostics=auditPackage({files,completeness:"complete",
    dependencyContext:{available:false}});
  assert.ok(codes(diagnostics).includes("PACKAGE_CORE_FILE_MISSING"));
  assert.ok(codes(diagnostics).includes("PREDICATE_REFERENCE_NOT_CHECKED"));
  assert.ok(!codes(diagnostics).includes("PREDICATE_REFERENCE_NOT_FOUND"),
    "missing PredicateSet cannot prove a reference is undeclared");
});

test("audit does not invent dependency errors when Contract is unavailable",()=>{
  const files=fixture("establish-pdu-session");
  files.delete("assurance/contract.yaml");
  const diagnostics=auditPackage({files,completeness:"complete",
    dependencyContext:{available:false}});
  assert.ok(codes(diagnostics).includes("PACKAGE_CORE_FILE_MISSING"));
  assert.ok(codes(diagnostics).includes("TOOL_DEPENDENCY_NOT_CHECKED"));
  assert.ok(codes(diagnostics).includes("EVIDENCE_DEPENDENCY_NOT_CHECKED"));
  assert.ok(!codes(diagnostics).includes("TOOL_DEPENDENCY_UNDECLARED"));
  assert.ok(!codes(diagnostics).includes("EVIDENCE_DEPENDENCY_UNDECLARED"));
});

test("ToolCatalog v1alpha4 indexes exact Operation and Observation callables",()=>{
  const text=[
    "apiVersion: connectionagent.io/toolcatalog/v1alpha4",
    "kind: ToolCatalog",
    "metadata:",
    "  owner: smf-owner",
    "spec:",
    "  contracts:",
    "    - kind: operation",
    "      id: sbi.udm.sm_data.get",
    "      effect: READ",
    "      ownerOutcomes: [SUCCEEDED, FAILED]",
    "      inputSchema: {$ref: 'urn:ca:input:v1'}",
    "      outputSchema: {$ref: 'urn:ca:output:v1'}",
    "    - kind: observation",
    "      id: context.smf.session.read",
    "      effect: READ",
    "      ownerOutcomes: [SUCCEEDED, FAILED]",
    "      queryContextSchema: {$ref: 'urn:ca:query:v1'}",
    "      outputSchema: {$ref: 'urn:ca:read-result:v1'}"
  ].join("\n");
  const index=indexV1Alpha4ToolCatalogCallables("ca",[
    {path:"schemas/input.schema.yaml",text:"$id: urn:ca:input:v1\ntype: object\n"},
    {path:"contracts/smf.yaml",text}
  ]);
  assert.equal(index.available,true);
  assert.deepEqual(index.operations.map(item=>[item.id,item.kind,item.owner,item.effect]),[
    ["sbi.udm.sm_data.get","operation","smf-owner","READ"],
    ["context.smf.session.read","observation","smf-owner","READ"]
  ]);
  const files=fixture("establish-pdu-session");
  const diagnostics=auditPackage({files,dependencyContext:{
    available:true,
    declarations:[{id:"ca",kind:"tool-catalog",source:{type:"builtin"}}],
    snapshots:[{id:"ca",kind:"tool-catalog",snapshotDigest:"sha256:test"}],
    operations:index.operations,
    toolCatalogs:[{dependencyId:"ca",available:true}],
    schemas:[],diagnostics:[]
  }});
  assert.ok(!find(diagnostics,"TOOL_DECLARATION_NOT_FOUND","ca::sbi.udm.sm_data.get"),
    "exact v1alpha4 callable is locally declared without asserting Owner qualification");
});

test("legacy and malformed ToolCatalog sources never qualify as callable declarations",()=>{
  const legacy=indexV1Alpha4ToolCatalogCallables("ca",[
    {path:"tool-contract.json",text:JSON.stringify({
      apiVersion:"skillc.tool/v0.1",operations:[{id:"sbi.udm.sm_data.get"}]
    })}
  ]);
  assert.equal(legacy.available,false);
  assert.deepEqual(legacy.operations,[]);

  const oldVersion=indexV1Alpha4ToolCatalogCallables("ca",[
    {path:"tool-catalog.yaml",text:[
      "apiVersion: connectionagent.io/toolcatalog/v1alpha3",
      "kind: ToolCatalog",
      "metadata: {owner: owner}",
      "spec: {contracts: []}"
    ].join("\n")}
  ]);
  assert.equal(oldVersion.available,false);
  assert.match(oldVersion.reason,/v1alpha4/);

  const missingInput=indexV1Alpha4ToolCatalogCallables("ca",[
    {path:"other.yaml",text:[
      "apiVersion: connectionagent.io/toolcatalog/v1alpha4",
      "kind: ToolCatalog",
      "metadata: {owner: owner}",
      "spec:",
      "  contracts:",
      "    - kind: observation",
      "      id: read",
      "      effect: READ",
      "      ownerOutcomes: [SUCCEEDED, FAILED]",
      "      inputSchema: {$ref: urn:wrong:input}",
      "      outputSchema: {$ref: urn:result}"
    ].join("\n")}
  ]);
  assert.equal(missingInput.available,false);
  assert.match(missingInput.reason,/invalid callable/);
});

test("duplicate ToolCatalog export IDs remain visible for ambiguous-link diagnostics",()=>{
  const catalog=(kind)=>[
    "apiVersion: connectionagent.io/toolcatalog/v1alpha4",
    "kind: ToolCatalog",
    "metadata: {owner: owner}",
    "spec:",
    "  contracts:",
    "    - kind: "+kind,
    "      id: sbi.udm.sm_data.get",
    "      effect: READ",
    "      ownerOutcomes: [SUCCEEDED, FAILED]",
    kind==="operation"?"      inputSchema: {$ref: urn:ca:input}":
      "      queryContextSchema: {$ref: urn:ca:input}",
    "      outputSchema: {$ref: urn:ca:output}"
  ].join("\n");
  const index=indexV1Alpha4ToolCatalogCallables("ca",[
    {path:"catalog/one.yaml",text:catalog("operation")},
    {path:"catalog/two.yaml",text:catalog("observation")}
  ]);
  assert.equal(index.available,true);
  assert.equal(index.operations.length,2);
  const diagnostics=auditPackage({
    files:fixture("establish-pdu-session"),
    dependencyContext:{
      available:true,declarations:[{id:"ca",kind:"tool-catalog"}],
      snapshots:[{id:"ca",kind:"tool-catalog"}],
      toolCatalogs:[{dependencyId:"ca",available:true}],operations:index.operations
    }
  });
  assert.ok(find(diagnostics,"TOOL_DECLARATION_AMBIGUOUS","ca::sbi.udm.sm_data.get"));
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
  const resolved=auditPackage({files,dependencyContext:context});
  assert.ok(!resolved.some(item=>item.code==="TOOL_DECLARATION_NOT_FOUND"&&
    item.message.includes("ca::sbi.udm.sm_data.get")));
  const missing=auditPackage({files,dependencyContext:{
    ...context,operations:[]
  }});
  assert.ok(missing.some(item=>item.code==="TOOL_DECLARATION_NOT_FOUND"&&
    item.message.includes("ca::sbi.udm.sm_data.get")));
});

test("partial trusted export sets never turn absence or one candidate into a false missing/unique result",()=>{
  const files=fixture("establish-pdu-session");
  const capability=files.get("assurance/contract.yaml").text.match(
    /- (urn:example:connectionagent:capability:3gpp:nudm-sdm-get:v1)/)?.[1];
  assert.ok(capability);
  const diagnostics=auditPackage({files,dependencyContext:{
    available:false,
    capabilityDeclarations:[{id:capability,trusted:true}]
  }});
  assert.ok(diagnostics.some(item=>
    item.code==="CAPABILITY_DECLARATION_SET_INCOMPLETE"&&item.message.includes(capability)));
  assert.ok(diagnostics.some(item=>
    item.code==="CAPABILITY_DECLARATION_NOT_CHECKED"&&
    item.message.includes("namf-communication-n1n2-transfer")));
  assert.ok(!diagnostics.some(item=>item.code==="CAPABILITY_DECLARATION_NOT_FOUND"));
});

test("partial Owner Evidence snapshots never prove absence or uniqueness",()=>{
  const files=fixture("establish-pdu-session");
  const partial=auditPackage({files,dependencyContext:{
    available:false,
    evidenceDeclarations:[{id:"udm.subscription-owned",trusted:true}]
  }});
  assert.ok(partial.some(item=>
    item.code==="EVIDENCE_DECLARATION_SET_INCOMPLETE"&&
    item.message.includes("ca::udm.subscription-owned")));
  assert.ok(partial.some(item=>
    item.code==="EVIDENCE_DECLARATION_NOT_CHECKED"&&
    item.message.includes("ca::pcf.association-owned")));
  assert.ok(!partial.some(item=>item.code==="EVIDENCE_DECLARATION_NOT_FOUND"));

  const complete=auditPackage({files,dependencyContext:{
    available:false,
    evidenceDeclarations:[{id:"udm.subscription-owned",trusted:true}],
    evidenceDeclarationsComplete:true
  }});
  assert.ok(complete.some(item=>
    item.code==="EVIDENCE_DECLARATION_NOT_FOUND"&&
    item.message.includes("ca::pcf.association-owned")),
    "only a complete trusted Evidence set can prove a declaration is absent");
});

test("Schema IDs can resolve from the exact pinned Owner snapshot independent of dependency kind",()=>{
  const files=fixture("establish-pdu-session");
  const schemaId="urn:example:5gc:udm-subscription-result:v1";
  const diagnostics=auditPackage({files,dependencyContext:{
    available:true,
    declarations:[{id:"ca",kind:"tool-catalog",source:{type:"builtin"}}],
    snapshots:[{id:"ca",kind:"tool-catalog",snapshotDigest:"sha256:test"}],
    diagnostics:[],
    schemas:[{dependencyId:"ca",path:"schemas/udm.schema.yaml",
      text:"$id: "+schemaId+"\ntype: object\n"}],
    operations:[],toolCatalogs:[{dependencyId:"ca",available:true}]
  }});
  assert.ok(!diagnostics.some(item=>
    item.code==="SCHEMA_DEPENDENCY_KIND_MISMATCH"||
    (item.code==="SCHEMA_DECLARATION_NOT_FOUND"&&item.message.includes(schemaId))),
    "Schema identity is resolved from the exact dependency snapshot, not inferred from dependency kind");
});

test("trusted CapabilityContracts input can resolve a unique declaration without Compiler",()=>{
  const files=fixture("establish-pdu-session");
  const contract=files.get("assurance/contract.yaml").text;
  const capability=contract.match(/- (urn:example:connectionagent:capability:3gpp:nudm-sdm-get:v1)/)?.[1];
  assert.ok(capability);
  const diagnostics=auditPackage({files,dependencyContext:{
    available:false,
    capabilityDeclarations:[{id:capability,trusted:true}],
    capabilityDeclarationsComplete:true
  }});
  assert.ok(!diagnostics.some(item=>item.code==="CAPABILITY_GRANT_NOT_CHECKED"&&
    item.message.includes(capability)));
  assert.ok(diagnostics.some(item=>item.code==="CAPABILITY_DECLARATION_NOT_FOUND"),
    "a complete trusted declaration set can prove that another grant is absent");
});

test("unverified Capability export candidates cannot manufacture a confirmed Owner ambiguity",()=>{
  const files=fixture("establish-pdu-session");
  const capability="urn:example:connectionagent:capability:3gpp:nudm-sdm-get:v1";
  for(const complete of [false,true]){
    const diagnostics=auditPackage({files,dependencyContext:{
      available:false,
      capabilityDeclarationsComplete:complete,
      capabilityDeclarations:[
        {id:capability,trusted:true},{id:capability,trusted:false}
      ]
    }});
    const pending=find(diagnostics,"CAPABILITY_OWNER_NOT_VERIFIED",capability);
    assert.equal(pending?.status,"not_checked");
    assert.equal(pending?.severity,"warning");
    assert.ok(!find(diagnostics,"CAPABILITY_DECLARATION_AMBIGUOUS",capability),
      "an unverified candidate is not proof of a duplicate Owner export");
  }
  const verified=auditPackage({files,dependencyContext:{
    capabilityDeclarations:[
      {id:capability,trusted:true},{id:capability,trusted:true}
    ]
  }});
  const ambiguous=find(verified,"CAPABILITY_DECLARATION_AMBIGUOUS",capability);
  assert.equal(ambiguous?.status,"confirmed",
    "two verified declarations already prove ambiguity even in a partial export set");
});

test("unverified Evidence export candidates cannot manufacture a confirmed Owner ambiguity",()=>{
  const files=fixture("establish-pdu-session");
  const reference="ca::udm.subscription-owned";
  for(const complete of [false,true]){
    const diagnostics=auditPackage({files,dependencyContext:{
      available:false,
      evidenceDeclarationsComplete:complete,
      evidenceDeclarations:[
        {id:"udm.subscription-owned",trusted:true},
        {id:"udm.subscription-owned",trusted:false}
      ]
    }});
    const pending=find(diagnostics,"EVIDENCE_OWNER_NOT_VERIFIED",reference);
    assert.equal(pending?.status,"not_checked");
    assert.equal(pending?.severity,"warning");
    assert.ok(!find(diagnostics,"EVIDENCE_DECLARATION_AMBIGUOUS",reference));
  }
  const verified=auditPackage({files,dependencyContext:{
    evidenceDeclarations:[
      {id:"udm.subscription-owned",trusted:true},
      {id:"udm.subscription-owned",trusted:true}
    ]
  }});
  assert.equal(find(verified,"EVIDENCE_DECLARATION_AMBIGUOUS",reference)?.status,
    "confirmed");
});
