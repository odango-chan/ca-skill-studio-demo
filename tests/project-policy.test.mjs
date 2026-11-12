import test from "node:test";
import assert from "node:assert/strict";
import {classifyProjectResource,checkStudioMutation,assertStudioMutation,
  projectRoots} from "../experiments/ide-host/vscode/src/project-policy.mjs";
const uri=(path,scheme="file",authority="")=>({path,scheme,authority});
const project=[{uri:uri("/w/demo")}];
const can=(path,operation="edit",folders=project)=>
  checkStudioMutation(uri(path),folders,operation).allowed;

test("project and Skills roots are protected, authored Source remains editable",()=>{
  for(const path of ["/w/demo","/w/demo/skills"])
    assert.equal(classifyProjectResource(uri(path),project).protected,true,path);
  for(const path of ["/w/demo/skills/one/SKILL.md",
    "/w/demo/skills/one/assurance/procedure.yaml",
    "/w/demo/skills/one/scripts/run.py"])
    assert.equal(can(path),true,path);
  assert.equal(can("/w/demo/skills","rename"),false);
  assert.equal(can("/w/demo","delete"),false);
});

test("lib/ and output/ names do not imply ownership or permissions",()=>{
  for(const path of ["/w/demo/lib/tool/contract.yaml",
    "/w/demo/output/build.json","/w/demo/references/local.md"])
    for(const operation of ["edit","create","rename","delete"])
      assert.equal(can(path,operation),true,path+" "+operation);
});

test("Plugin-owned dependency store is protected and snapshots are read-only",()=>{
  const snapshot="/w/demo/.skill-studio/dependencies/abcdef/tool-contract.json";
  assert.equal(classifyProjectResource(uri("/w/demo/.skill-studio"),project).role,"managed-root");
  assert.equal(classifyProjectResource(uri("/w/demo/.skill-studio/staging/tmp"),project).protected,true);
  assert.equal(classifyProjectResource(uri("/w/demo/.skill-studio/dependencies"),project).protected,true);
  assert.equal(classifyProjectResource(uri(snapshot),project).role,"dependency-snapshot");
  for(const operation of ["edit","create","rename","delete"])
    assert.equal(can(snapshot,operation),false,operation);
  assert.equal(can(snapshot,"dependency-store-write"),true);
  assert.throws(()=>assertStudioMutation(uri(snapshot),project),/immutable/);
});

test("URI scheme, authority and normalized path prevent accidental cross-root matches",()=>{
  assert.deepEqual(projectRoots(project).map(root=>root.path),["/w/demo"]);
  assert.equal(can("/other/lib/file.yaml"),true);
  assert.equal(classifyProjectResource(uri("/w/demo/skills/x","remote"),project).role,"outside");
  assert.equal(classifyProjectResource(uri("/w/demo/skills/x","file","other"),project).role,"outside");
  assert.equal(classifyProjectResource(uri("/w/demo/x/../skills"),project).role,"invalid");
  assert.equal(classifyProjectResource(uri("/w/demo/%2e%2e/skills"),project).role,"invalid");
});
