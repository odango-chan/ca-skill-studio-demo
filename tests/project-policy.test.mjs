import test from "node:test";
import assert from "node:assert/strict";
import {classifyProjectResource,checkStudioMutation,assertStudioMutation,
  projectRoots} from "../experiments/ide-host/vscode/src/project-policy.mjs";
const uri=(path,scheme="file",authority="")=>({path,scheme,authority});
const project=[{uri:uri("/w/demo")}];
const can=(path,operation="edit",folders=project)=>
  checkStudioMutation(uri(path),folders,operation).allowed;

test("project roots cannot be renamed, moved or deleted via Studio-owned operations",()=>{
  for(const folder of ["/w/demo","/w/demo/skills","/w/demo/lib","/w/demo/output"]){
    const role=classifyProjectResource(uri(folder),project);
    assert.equal(role.protected,true,folder);
    for(const op of ["edit","create","rename","delete","import-library","compiler-output"])
      assert.equal(can(folder,op),false,folder+" "+op);
  }
});

test("skills Source is editable, lib is imported readonly, output is compiler-owned",()=>{
  assert.equal(can("/w/demo/skills/one/SKILL.md"),true);
  assert.equal(can("/w/demo/skills/one/assurance/procedure.yaml"),true);
  assert.equal(can("/w/demo/skills/one/scripts/run.py"),true);
  for(const target of ["/w/demo/lib/tool/contract.yaml","/w/demo/output/compiled/artifact.json"]){
    for(const op of ["edit","create","delete","rename"])
      assert.equal(can(target,op),false,target+" "+op);
  }
  assert.equal(can("/w/demo/lib/tool/contract.yaml","import-library"),true);
  assert.equal(can("/w/demo/lib/tool/contract.yaml","compiler-output"),false);
  assert.equal(can("/w/demo/output/compiled/artifact.json","compiler-output"),true);
  assert.equal(can("/w/demo/output/compiled/artifact.json","import-library"),false);
});

test("name-only and prefix matches never impose project protection",()=>{
  assert.equal(can("/w/demo/skills-extra/file.py"),true);
  assert.equal(can("/w/demolib/contract.yaml"),true);
  assert.equal(can("/other/lib/file.yaml"),true);
  assert.equal(can("/w/demo/liberty/file.py"),true);
  assert.equal(classifyProjectResource(uri("/w/demo/lib/x","remote"),project).role,"outside");
  assert.equal(classifyProjectResource(uri("/w/demo/lib/../skills/x"),project).role,"invalid");
  assert.equal(classifyProjectResource(uri("/w/demo/lib/%2e%2e/skills/x"),project).role,"invalid");
});

test("legacy workspace directly opened at skills/ uses its parent project root",()=>{
  const legacy=[{uri:uri("/browser/workspaces/skills")}];
  assert.equal(projectRoots(legacy)[0].path,"/browser/workspaces");
  assert.equal(can("/browser/workspaces/skills/one/SKILL.md","edit",legacy),true);
  assert.equal(can("/browser/workspaces/lib/contract.yaml","edit",legacy),false);
  assert.equal(can("/browser/workspaces/skills","rename",legacy),false);
});

test("Studio-owned mutation preflight rejects without altering sources",()=>{
  assert.throws(()=>assertStudioMutation(uri("/w/demo/lib/tool/SKILL.md"),project),/read-only/);
  assert.throws(()=>assertStudioMutation(uri("/w/demo/output/artifact.json"),project),/generated/);
  assert.throws(()=>assertStudioMutation(uri("/w/demo/skills"),project,"rename"),/structure/);
  assert.equal(assertStudioMutation(uri("/w/demo/skills/x/SKILL.md"),project).allowed,true);
});
