import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  DIAGNOSTIC_TEST_CASES,
  DIAGNOSTIC_TEST_SUITE_VERSION,
  runDiagnosticRegressionCase,
  runDiagnosticRegressionSuite
} from "../site/package-diagnostic-tests.mjs";

const root=new URL("../site/samples/v1alpha5/",import.meta.url);
const manifest=JSON.parse(readFileSync(new URL("files.json",root),"utf8"));
function fixture(name="establish-pdu-session"){
  return new Map(manifest.files.filter(path=>path.startsWith(name+"/"))
    .map(path=>[path.slice(name.length+1),{
      text:readFileSync(new URL(path,root),"utf8")
    }]));
}

test("the pinned 5GC Example exercises all static diagnostics domains without modifying authored files",()=>{
  const files=fixture();
  const original=[...files].map(([path,file])=>[path,file.text]);
  const results=runDiagnosticRegressionSuite({files});
  assert.equal(results.apiVersion,DIAGNOSTIC_TEST_SUITE_VERSION);
  assert.equal(results.scope,"STUDIO_DIAGNOSTIC_REGRESSION_ONLY");
  assert.equal(results.qualification,"NOT_QUALIFIED");
  assert.deepEqual(results.summary,{PASS:DIAGNOSTIC_TEST_CASES.length,FAIL:0,NOT_RUN:0});
  assert.equal(results.results.length,DIAGNOSTIC_TEST_CASES.length);
  assert.deepEqual([...files].map(([path,file])=>[path,file.text]),original);
  for(const item of results.results){
    assert.equal(item.safety,"IN_MEMORY_STATIC_ONLY");
    assert.equal(item.diagnostic.code,item.expectedCode);
    assert.ok(item.diagnostic.path);
    assert.ok(item.diagnostic.line>0&&item.diagnostic.column>0);
  }
});

test("missing source anchors produce NOT_RUN instead of a fabricated PASS",()=>{
  const files=fixture("establish-pdu-session-mas");
  const results=runDiagnosticRegressionSuite({files,include:[
    "capability-owner-unavailable","evidence-owner-unavailable",
    "missing-predicate-script"
  ]});
  assert.equal(results.summary.PASS,2);
  assert.equal(results.summary.NOT_RUN,1);
  assert.equal(results.summary.FAIL,0);
  assert.equal(results.results[2].status,"NOT_RUN");
  assert.equal(results.results[2].diagnostic,null);
});

test("partial Package inventory regression rejects false confirmed missing-file results",()=>{
  const result=runDiagnosticRegressionCase("partial-inventory",{files:fixture()});
  assert.equal(result.status,"PASS");
  assert.equal(result.diagnostic.code,"REQUEST_SCHEMA_NOT_CHECKED");
  assert.equal(result.diagnostic.status,"not_checked");
});

test("malformed local Schema regression is exposed as a confirmed source diagnostic",()=>{
  const result=runDiagnosticRegressionCase("schema-invalid-yaml",{files:fixture()});
  assert.equal(result.status,"PASS");
  assert.equal(result.diagnostic.code,"SCHEMA_DOCUMENT_PARSE_ERROR");
  assert.equal(result.diagnostic.status,"confirmed");
  assert.equal(result.diagnostic.path,"schemas/establishment-request.schema.yaml");
});

test("source mutation tests distinguish confirmed defects from trust-boundary NOT_CHECKED",()=>{
  const files=fixture();
  for(const id of [
    "capability-grant-duplicate","unknown-tool-alias",
    "unknown-predicate","missing-predicate-script","missing-producer-node"
  ]){
    const result=runDiagnosticRegressionCase(id,{files});
    assert.equal(result.status,"PASS",id+": "+result.reason);
    assert.equal(result.diagnostic.status,"confirmed",id);
  }
  for(const id of ["capability-owner-unavailable","evidence-owner-unavailable"]){
    const result=runDiagnosticRegressionCase(id,{files});
    assert.equal(result.status,"PASS",id);
    assert.equal(result.diagnostic.status,"not_checked",id);
  }
});

test("invalid selection and unrecognizable Package are never quietly marked PASS",()=>{
  assert.throws(()=>runDiagnosticRegressionSuite({files:fixture(),include:["unknown"]}),
    /Invalid diagnostic regression/);
  assert.throws(()=>runDiagnosticRegressionSuite({files:fixture(),
    include:["syntax-invalid-yaml","syntax-invalid-yaml"]}),/Invalid diagnostic regression/);
  const result=runDiagnosticRegressionSuite({
    files:new Map([["SKILL.md",{text:"# sample"}]]),
    include:["syntax-invalid-yaml","unknown-tool-alias"]
  });
  assert.deepEqual(result.summary,{PASS:0,FAIL:0,NOT_RUN:2});
});
