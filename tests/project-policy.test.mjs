import test from "node:test";
import assert from "node:assert/strict";
import {classifyProjectResource,checkStudioMutation,assertStudioMutation,
  projectRoots} from "../experiments/ide-host/vscode/src/project-policy.mjs";
const uri=(path,scheme="file",authority="")=>({path,scheme,authority});
const project=[{uri:uri("/w/demo")}];
const allowed=(path,operation="edit",folders=project)=>
  checkStudioMutation(uri(path),folders,operation).allowed;
test("source is editable without three-directory special permissions",()=>{
  for(const path of ["/w/demo/skills/one/SKILL.md",
    "/w/demo/skills/one/assurance/procedure.yaml",
    "/w/demo/lib/tool/contract.yaml","/w/demo/output/exported.txt"])
    assert.equal(allowed(path),true,path);
  assert.equal(allowed("/w/demo/skills","rename"),false);
  assert.equal(allowed("/w/demo","delete"),false);
});
test("managed dependency snapshots are read-only through normal Source editing",()=>{
  const path="/w/demo/.skill-studio/dependencies/abcdef/tool.json";
  const role=classifyProjectResource(uri(path),project);
  assert.equal(role.role,"dependency-snapshot");
  for(const operation of ["edit","delete","rename","create"])
    assert.equal(allowed(path,operation),false);
  assert.equal(allowed(path,"dependency-store-write"),true);
  assert.equal(allowed("/w/demo/.skill-studio/dependencies","delete"),false);
  assert.throws(()=>assertStudioMutation(uri(path),project),/immutable/);
});
test("exact URI roots isolate workspace projects and invalid paths fail closed",()=>{
  assert.deepEqual(projectRoots(project).map(root=>root.path),["/w/demo"]);
  assert.equal(allowed("/other/lib/file.yaml"),true);
  assert.equal(classifyProjectResource(uri("/w/demo/.skill-studio/dependencies/x","remote"),project).role,"outside");
  assert.equal(classifyProjectResource(uri("/w/demo/x/../skills"),project).role,"invalid");
  assert.equal(classifyProjectResource(uri("/w/demo/%2e%2e/skills"),project).role,"invalid");
  assert.equal(assertStudioMutation(uri("/w/demo/skills/x/SKILL.md"),project).allowed,true);
});
test("legacy workspace folder is no longer reinterpreted as parent project",()=>{
  const legacy=[{uri:uri("/browser/workspaces/skills")}];
  assert.equal(projectRoots(legacy)[0].path,"/browser/workspaces/skills");
  assert.equal(allowed("/browser/workspaces/skills/SKILL.md","edit",legacy),true);
  assert.equal(allowed("/browser/workspaces/lib/contract.yaml","edit",legacy),true);
});
