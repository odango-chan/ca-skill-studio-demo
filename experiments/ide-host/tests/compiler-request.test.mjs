import test from "node:test";
import assert from "node:assert/strict";
import {
  COMPILER_API_VERSION,
  COMPILER_LANGUAGE_TARGET,
  COMPILER_BUILD_RESULT_VERSION,
  COMPILER_INSPECTION_VERSION,
  assertCompilerLanguageTarget,
  createCompilerBuildRequest,
  compilerArtifactRelativePath,
  isCompilerBuildResult,
  isCompilerInspection
} from "../vscode/src/compiler-request.mjs";

function decode(value){
  return new TextDecoder().decode(Uint8Array.from(atob(value),character=>character.charCodeAt(0)));
}

test("Compiler BuildRequest uses exact independent API and CA-SL v1alpha5 targets",()=>{
  const request=createCompilerBuildRequest({
    packageName:"example-skill",
    documents:[
      {relativePath:"assurance/procedure.yaml",text:"start: run\nnodes: {}\n"},
      {relativePath:"SKILL.md",text:"# Example\n"},
      {relativePath:"references/readme.txt",text:"Reference\n"},
      {relativePath:"assets/logo.svg",text:"<svg/>"}
    ]
  });
  assert.equal(request.apiVersion,COMPILER_API_VERSION);
  assert.equal(request.languageTarget,COMPILER_LANGUAGE_TARGET);
  assert.deepEqual(request.targets,["example-skill"]);
  assert.deepEqual(request.resolvedDependencies,[]);
  assert.deepEqual(request.files.map(file=>file.path),[
    "skills/example-skill/SKILL.md",
    "skills/example-skill/assurance/procedure.yaml",
    "skills/example-skill/references/readme.txt"
  ]);
  assert.equal(decode(request.files[0].bytes),"# Example\n");
  assert.equal(decode(request.files[1].bytes),"start: run\nnodes: {}\n");
});

test("released Compiler v2 accepts v1alpha5 and rejects v1alpha4",()=>{
  assert.equal(assertCompilerLanguageTarget(COMPILER_LANGUAGE_TARGET),COMPILER_LANGUAGE_TARGET);
  assert.throws(()=>assertCompilerLanguageTarget("connectionagent.io/v1alpha4"),
    /supports only connectionagent.io\/v1alpha5; refusing language target connectionagent.io\/v1alpha4/);
  assert.throws(()=>assertCompilerLanguageTarget("connectionagent.io/v1alpha6"),
    /supports only connectionagent.io\/v1alpha5/);
});

test("Compiler request refuses path traversal, duplicate files and invalid package targets",()=>{
  assert.throws(()=>createCompilerBuildRequest({
    packageName:"example",
    documents:[{relativePath:"../outside.yaml",text:"x"}]
  }),/unsafe Skill-relative source path/);
  assert.throws(()=>createCompilerBuildRequest({
    packageName:"example",
    documents:[
      {relativePath:"assurance/contract.yaml",text:"a"},
      {relativePath:"assurance/contract.yaml",text:"b"}
    ]
  }),/Duplicate or overlong Compiler source path/);
  assert.throws(()=>createCompilerBuildRequest({
    packageName:"../example",
    documents:[{relativePath:"SKILL.md",text:"x"}]
  }),/Package name/);
  assert.throws(()=>createCompilerBuildRequest({
    packageName:"example",
    documents:[{relativePath:"目录/".repeat(60)+"x.yaml",text:"x"}]
  }),/unsafe Skill-relative source path/);
});

test("Compiler result guards require the frozen v1alpha5 output identities",()=>{
  assert.equal(isCompilerBuildResult({
    apiVersion:COMPILER_BUILD_RESULT_VERSION,success:true,
    diagnostics:[],dependencyClosure:[],outputFiles:[]
  }),true);
  assert.equal(isCompilerBuildResult({
    apiVersion:"connectionagent.io/compiler-build-result/v0.1",
    success:true,diagnostics:[],dependencyClosure:[],outputFiles:[]
  }),false);
  assert.equal(isCompilerInspection({
    apiVersion:COMPILER_INSPECTION_VERSION,diagnostics:[],callables:[],schemas:[]
  }),true);
  assert.equal(isCompilerInspection({
    apiVersion:"skillc.inspect/v0.1",diagnostics:[],callables:[],schemas:[]
  }),false);
});

test("v1alpha5 BuildRequest excludes Studio-only route test files from Compiler source",()=>{
  const request=createCompilerBuildRequest({
    packageName:"establish-pdu-session",
    documents:[
      {relativePath:"assurance/contract.yaml",text:"goal: example\n"},
      {relativePath:"assurance/procedure.yaml",text:"start: run\nnodes: {}\n"},
      {relativePath:"tests/entry.route-scenario.json",text:'{"apiVersion":"skill-studio-route-scenario/v1"}'},
      {relativePath:"references/readme.md",text:"# user-authored reference"}
    ]
  });
  assert.equal(request.apiVersion,"connectionagent.io/compiler-build-request/v1alpha5");
  assert.equal(request.languageTarget,"connectionagent.io/v1alpha5");
  assert.deepEqual(request.files.map(file=>file.path),[
    "skills/establish-pdu-session/assurance/contract.yaml",
    "skills/establish-pdu-session/assurance/procedure.yaml",
    "skills/establish-pdu-session/references/readme.md"
  ]);
  assert.deepEqual(request.resolvedDependencies,[]);
  assert.equal(request.trustedBuildContext,undefined,
    "absence of independent Owner proof must not be turned into claimed authority");
});
test("Studio may pass only explicitly supplied v1alpha5 trusted build context",()=>{
  const trustedBuildContext={dependencyBindings:[]};
  const request=createCompilerBuildRequest({
    packageName:"test",
    documents:[{relativePath:"SKILL.md",text:"# Test"}],
    trustedBuildContext
  });
  assert.deepEqual(request.trustedBuildContext,trustedBuildContext);
});

test("Compiler v2 Artifact projection admits root manifest and selected compiled source only",()=>{
  assert.equal(compilerArtifactRelativePath("establish-pdu-session","manifest.json"),
    "manifest.json");
  assert.equal(compilerArtifactRelativePath("establish-pdu-session",
    "skills/establish-pdu-session/compiled/procedure.json"),"compiled/procedure.json");
  assert.equal(compilerArtifactRelativePath("establish-pdu-session",
    "skills/establish-pdu-session/compiled/ingress-links.json"),"compiled/ingress-links.json");
  for(const path of [
    "skills/other/compiled/procedure.json",
    "skills/establish-pdu-session/assurance/procedure.yaml",
    "skills/establish-pdu-session/compiled/../outside.json",
    "skills/establish-pdu-session/compiled/",
    "other-manifest.json",
    "skills/establish-pdu-session/compiled/x\\y.json"
  ])assert.throws(()=>compilerArtifactRelativePath("establish-pdu-session",path));
});
