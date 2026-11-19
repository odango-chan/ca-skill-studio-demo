import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {inspectionSnapshot} from "../vscode/src/inspection.mjs";
import {isAllowedPackageRelativeLink} from "../vscode/src/markdown-link-policy.mjs";

const sampleRoot=new URL("../../../site/samples/v1alpha5/",import.meta.url);
const manifest=JSON.parse(readFileSync(new URL("files.json",sampleRoot),"utf8"));
function currentPackage(name="establish-pdu-session"){
  const files=new Map();
  for(const path of manifest.files.filter(path=>path.startsWith(name+"/"))){
    const relative=path.slice(name.length+1);
    if(relative==="assurance/contract.yaml"||relative==="assurance/predicates.yaml")
      files.set(relative,{text:readFileSync(new URL(path,sampleRoot),"utf8")});
  }
  return files;
}
function procedure(name="establish-pdu-session"){
  const path=manifest.files.find(path=>path===name+"/assurance/procedure.yaml");
  assert.ok(path,"current Example manifest must include its Procedure");
  return readFileSync(new URL(path,sampleRoot),"utf8");
}

test("visual inspection uses the current CA-SL projection for the released Example",()=>{
  const name="establish-pdu-session";
  const result=inspectionSnapshot(procedure(name),{},null,currentPackage(name),name,
    "file:///workspace/"+name);
  assert.equal(result.model.state,"READY");
  assert.equal(result.model.procedures.size,1);
  assert.equal(result.outline.length,1);
  assert.ok(result.outline[0].children.length>0);
  assert.ok(result.outline[0].children.some(item=>item.nodeId==="get-sm-subscription-data"));
  assert.ok(result.inspection.some(item=>item.kind==="v1alpha5-contract"));
  assert.ok(result.problems.every(item=>item.source==="procedure-projection"));
});

test("historical syntax is not projected by a compatibility graph parser",()=>{
  const files=new Map([
    ["assurance/contract.yaml",{text:
      "apiVersion: connectionagent.io/v1alpha1\nkind: SkillContract\nmetadata: {}\nspec: {}\n"}],
    ["assurance/predicates.yaml",{text:
      "apiVersion: connectionagent.io/v1alpha1\nkind: PredicateSet\nmetadata: {}\npredicates: {}\n"}]
  ]);
  const result=inspectionSnapshot(
    "procedures:\n  legacy:\n    nodes:\n      step:\n        call: ca.sample.read\n",
    {},null,files,"legacy","file:///workspace/legacy");
  assert.equal(result.model.state,"UNAVAILABLE");
  assert.equal(result.outline.length,0);
  assert.ok(result.problems.some(item=>item.code==="UNKNOWN_FIELD"));
  assert.ok(result.problems.some(item=>item.code==="SOURCE_ROOT_INVALID"));
});

test("native Markdown links are constrained to the exact Package inventory",()=>{
  const allowed=new Set(["SKILL.md","references/3gpp-procedure.md","schemas/request.yaml"]);
  assert.equal(isAllowedPackageRelativeLink("../SKILL.md","references",allowed),true);
  assert.equal(isAllowedPackageRelativeLink("../../outside.md","references",allowed),false);
  assert.equal(isAllowedPackageRelativeLink("missing.md","references",allowed),false);
  assert.equal(isAllowedPackageRelativeLink("//example.invalid/escape.md","references",allowed),false);
  assert.equal(isAllowedPackageRelativeLink("javascript:alert(1)","references",allowed),false);
  assert.equal(isAllowedPackageRelativeLink("#section","references",allowed),true);
  assert.equal(isAllowedPackageRelativeLink("https://example.invalid/docs","references",allowed),true);
});
