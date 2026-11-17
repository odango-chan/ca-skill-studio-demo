import test from "node:test";
import assert from "node:assert/strict";
import {
  COMPILER_API_VERSION,
  COMPILER_LANGUAGE_TARGET,
  COMPILER_BUILD_RESULT_VERSION,
  COMPILER_INSPECTION_VERSION,
  createCompilerBuildRequest,
  isCompilerBuildResult,
  isCompilerInspection
} from "../vscode/src/compiler-request.mjs";

function decode(value){
  return new TextDecoder().decode(Uint8Array.from(atob(value),character=>character.charCodeAt(0)));
}

test("Compiler BuildRequest uses exact independent API and CA-SL v1alpha4 targets",()=>{
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

test("Compiler result guards require the frozen v1alpha4 output identities",()=>{
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
