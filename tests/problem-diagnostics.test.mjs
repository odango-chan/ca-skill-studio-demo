import test from "node:test";
import assert from "node:assert/strict";
import {reconcileProblemDiagnostics}
  from "../experiments/ide-host/vscode/src/problem-diagnostics.mjs";

const file="file:///workspace/skills/example/assurance/contract.yaml";
function audit(overrides={}){
  return {
    kind:"package-diagnostic",source:"package-audit",
    code:"YAML_PARSE_ERROR",message:"Malformed YAML near grant",
    severity:"error",status:"confirmed",
    uri:file,path:"assurance/contract.yaml",line:18,column:5,
    ...overrides
  };
}
function compiler(overrides={}){
  return {
    kind:"compiler-diagnostic",code:"YAML_PARSE_ERROR",
    message:"Compiler rejected the YAML node",
    severity:"error",status:"confirmed",
    uri:file,sourcePath:"assurance/contract.yaml",line:18,column:5,
    ...overrides
  };
}

test("same code, URI, column and confirmed status reconcile independent wording",()=>{
  const left=audit(),right=compiler();
  const rows=reconcileProblemDiagnostics([left,right]);
  assert.equal(rows.length,1);
  assert.equal(rows[0].diagnostic,right,
    "authoritative Compiler record wins over the provisional local text");
  assert.deepEqual(rows[0].sources,["Package Audit","Compiler"]);
  assert.equal(left.message,"Malformed YAML near grant");
  assert.equal(right.message,"Compiler rejected the YAML node");
  assert.equal(reconcileProblemDiagnostics([right,left])[0].diagnostic,right,
    "precedence must not depend on producer notification order");
});

test("different codes or columns on the same line are distinct findings",()=>{
  const rows=reconcileProblemDiagnostics([
    audit(),
    compiler({code:"SCHEMA_LINK_INVALID"}),
    compiler({column:7}),
    compiler({line:19}),
    compiler({uri:"file:///workspace/skills/other/assurance/contract.yaml"})
  ]);
  assert.equal(rows.length,5);
});

test("unknown trust status is not silently erased by a confirmed Compiler result",()=>{
  const rows=reconcileProblemDiagnostics([
    audit({status:"not_checked",severity:"warning"}),
    compiler({status:"confirmed"})
  ]);
  assert.equal(rows.length,2);
  assert.deepEqual(rows.map(x=>x.diagnostic.status),["not_checked","confirmed"]);
});

test("unlocated, file-only, and Package-root findings cannot be reconciled by guessed paths",()=>{
  const rows=reconcileProblemDiagnostics([
    audit({uri:null}),
    compiler({uri:null}),
    audit({uri:"file:///workspace/skills/example",line:undefined,column:undefined}),
    compiler({uri:"",line:18,column:5})
  ]);
  assert.equal(rows.length,4);
});

test("two findings from the same producer at one scalar remain distinct when wording differs",()=>{
  const rows=reconcileProblemDiagnostics([
    audit({message:"First independent requirement"}),
    audit({message:"Second independent requirement"}),
    compiler({message:"Compiler matches one constraint"})
  ]);
  assert.equal(rows.length,2);
  assert.deepEqual(rows.map(x=>x.diagnostic.message),
    ["Compiler matches one constraint","Second independent requirement"]);
});

test("URI objects and text addresses share identity without changing source data",()=>{
  const uriObj={toString:()=>file};
  const rows=reconcileProblemDiagnostics([
    audit({uri:uriObj}),
    compiler()
  ]);
  assert.equal(rows.length,1);
  assert.deepEqual(rows[0].sources,["Package Audit","Compiler"]);
});

test("duplicate notifications do not multiply Problems or source labels",()=>{
  const local=audit(),published=compiler();
  const rows=reconcileProblemDiagnostics([local,local,published,published]);
  assert.equal(rows.length,1);
  assert.deepEqual(rows[0].sources,["Package Audit","Compiler"]);
});
