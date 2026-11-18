import test from "node:test";
import assert from "node:assert/strict";
import {normalizeCompilerDiagnostics}
  from "../vscode/src/compiler-diagnostics.mjs";

const options={packageName:"establish-pdu-session",requirePhase:true};
const sourcePath="skills/establish-pdu-session/assurance/contract.yaml";
function diagnostic(overrides={}){
  return {
    severity:"error",phase:"C_STATIC",code:"CAPABILITY_MAPPING_MISSING",
    path:sourcePath,line:19,column:5,
    message:"Exact Capability grant has no trusted matching declaration",
    ...overrides
  };
}

test("Compiler v2 source-backed diagnostics retain exact source coordinates",()=>{
  const records=normalizeCompilerDiagnostics([diagnostic()],options);
  assert.equal(records.length,1);
  const item=records[0];
  assert.equal(item.kind,"compiler-diagnostic");
  assert.equal(item.sourcePath,"assurance/contract.yaml");
  assert.equal(item.locationKind,"source");
  assert.equal(item.line,19);
  assert.equal(item.column,5);
  assert.equal(item.code,"CAPABILITY_MAPPING_MISSING");
  assert.equal(item.domain,"compiler");
  assert.equal(item.status,"confirmed");
  assert.ok(Object.isFrozen(item)&&Object.isFrozen(records));
});

test("Compiler v2 missing path and source position never invent editor markers",()=>{
  const items=normalizeCompilerDiagnostics([
    diagnostic({path:"",line:undefined,column:undefined,
      code:"BUILD_REQUEST_INVALID"}),
    diagnostic({line:undefined,column:undefined,
      code:"CAPABILITY_MAPPING_MISSING"}),
    diagnostic({path:"skills/other/assurance/contract.yaml",
      code:"SOURCE_ROOT_INVALID"}),
    diagnostic({path:"skills/establish-pdu-session/../../outside.yaml",
      code:"SOURCE_PATH_INVALID"})
  ],options);
  assert.deepEqual(items.map(x=>x.locationKind),
    ["request","file","request","request"]);
  assert.ok(items.every(x=>x.line===null&&x.column===null));
  assert.equal(items[1].sourcePath,"assurance/contract.yaml");
  assert.equal(items[2].sourcePath,null);
  assert.equal(items[3].sourcePath,null);
});

test("warning Compiler diagnostic keeps phase and warning severity",()=>{
  const [item]=normalizeCompilerDiagnostics([
    diagnostic({phase:"C_WARNING",severity:"warning",code:"UNUSED_DEPENDENCY"})
  ],options);
  assert.equal(item.severity,"warning");
  assert.equal(item.phase,"C_WARNING");
  assert.equal(item.locationKind,"source");
});

test("Compiler v2 diagnostic phase is required and phase/severity cannot conflict",()=>{
  assert.throws(()=>normalizeCompilerDiagnostics([
    diagnostic({phase:undefined})
  ],options),/phase is required/);
  assert.throws(()=>normalizeCompilerDiagnostics([
    diagnostic({phase:"C_WARNING",severity:"error"})
  ],options),/phase\/severity mismatch/);
  assert.throws(()=>normalizeCompilerDiagnostics([
    diagnostic({phase:"C_RUNTIME"})
  ],options),/phase\/severity mismatch/);
});

test("historical v1alpha4 diagnostic envelope remains accepted without phase",()=>{
  const [item]=normalizeCompilerDiagnostics([
    diagnostic({phase:undefined,code:"YAML_PARSE_ERROR"})
  ],{packageName:"establish-pdu-session"});
  assert.equal(item.phase,null);
  assert.equal(item.line,19);
});

test("malformed Compiler responses fail closed instead of publishing partial results",()=>{
  for(const invalid of [
    null,{},[null],[diagnostic({severity:"hint"})],
    [diagnostic({message:""})],
    [diagnostic({path:2})],
    [diagnostic({line:0})],
    [diagnostic({column:1.5})]
  ]){
    assert.throws(()=>normalizeCompilerDiagnostics(invalid,options));
  }
  assert.throws(()=>normalizeCompilerDiagnostics([diagnostic()],
    {packageName:"../outside",requirePhase:true}),/selected Skill package/);
});

test("duplicate Compiler diagnostics have stable deterministic projection",()=>{
  const a=diagnostic(),b=diagnostic({code:"SCHEMA_LINK_INVALID",column:12});
  const items=normalizeCompilerDiagnostics([a,a,b],options);
  assert.equal(items.length,2);
  assert.equal(items[0].code,"CAPABILITY_MAPPING_MISSING");
  assert.equal(items[1].column,12);
  assert.equal(normalizeCompilerDiagnostics([a,a,b],options).length,2);
});

test("Unicode, unsafe and overlong source paths cannot escape current package",()=>{
  for(const path of [
    "skills/establish-pdu-session/../outside.yaml",
    "skills/establish-pdu-session/assurance\\contract.yaml",
    "skills/establish-pdu-session//contract.yaml",
    "skills/establish-pdu-session/assurance/./contract.yaml",
    "skills/establish-pdu-session/a\u0000b.yaml",
    "skills/establish-pdu-session/"+"x".repeat(260)+".yaml"
  ]){
    const [item]=normalizeCompilerDiagnostics([
      diagnostic({path,code:"SOURCE_PATH_INVALID"})
    ],options);
    assert.equal(item.locationKind,"request",path);
  }
});
