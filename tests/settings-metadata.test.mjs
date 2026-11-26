import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const manifest=JSON.parse(readFileSync(new URL("../experiments/ide-host/vscode/package.json",import.meta.url),"utf8"));
const properties=manifest.contributes.configuration.properties;

test("Settings Editor describes current CA-SL and Compiler baseline",()=>{
  const text=properties["connectionAgent.skillStudio.skillsRoot"].markdownDescription;
  assert.match(text,/CA-SL v1alpha5/);
  assert.match(text,/Compiler v2\.0\.2/);
  assert.doesNotMatch(text,/Compiler v1\.0\.0/);
});

test("Studio dependency lock is not described as a legacy Compiler lock",()=>{
  const text=properties["connectionAgent.skillStudio.dependencyLock"].markdownDescription;
  assert.match(text,/Studio-owned skillc\.lock\/v0\.1/);
  assert.match(text,/not the Compiler v2\.1\.0 interface-dependency-lock\/v1alpha1/);
  assert.match(text,/formal Contract roots/);
  assert.match(text,/does not imply Owner \/ Runtime authorization/);
  assert.doesNotMatch(text,/Legacy skillc\.lock|Compiler v1alpha4/);
});

test("dependency Settings distinguish snapshot kinds from Compiler linking",()=>{
  const text=properties["connectionAgent.skillStudio.dependencies"].markdownDescription;
  for(const kind of ["tool-catalog","schema-bundle","interface-package"])
    assert.ok(text.includes(kind),kind);
  assert.match(text,/do not imply Compiler linking/);
});
