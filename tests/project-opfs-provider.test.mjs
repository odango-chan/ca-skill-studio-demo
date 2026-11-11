import test from "node:test";
import assert from "node:assert/strict";
import {protectOpfsProvider,projectAccess} from "../experiments/ide-host/project-filesystem/lib/browser-only/protected-opfs.mjs";

const uri=(path)=>({path,withPath(other){return uri(other);},toString(){return "file://"+path;}});
function fixture(){
  const nodes=new Map(),actions=[],descriptors=new Map();
  let fd=1;
  const norm=value=>typeof value==="string"?value:value?.path?.toString();
  for(const root of ["/project","/project/skills","/project/lib","/project/output",
    "/project/skills/one","/unrelated","/unrelated/lib"])
    nodes.set(root,{type:2,size:0});
  nodes.set("/project/skills/one/SKILL.md",{type:1,size:10});
  nodes.set("/project/lib/tool.yaml",{type:1,size:4});
  nodes.set("/project/output/manifest.json",{type:1,size:9});
  const base={
    async stat(target){const p=norm(target);if(!nodes.has(p))throw Object.assign(Error("missing "+p),{code:"FileNotFound"});return {...nodes.get(p)};},
    async writeFile(target){actions.push(["writeFile",norm(target)]);nodes.set(norm(target),{type:1,size:1});},
    async updateFile(target){actions.push(["updateFile",norm(target)]);},
    async mkdir(target){actions.push(["mkdir",norm(target)]);nodes.set(norm(target),{type:2,size:0});},
    async delete(target){actions.push(["delete",norm(target)]);nodes.delete(norm(target));},
    async rename(from,to){actions.push(["rename",norm(from),norm(to)]);nodes.set(norm(to),nodes.get(norm(from)));nodes.delete(norm(from));},
    async copy(from,to){actions.push(["copy",norm(from),norm(to)]);nodes.set(norm(to),nodes.get(norm(from)));},
    async open(target){const id=fd++;descriptors.set(id,norm(target));return id;},
    async write(id){actions.push(["write",id]);return 1;},
    async close(id){descriptors.delete(id);},
    async createIndex(entries){actions.push(["createIndex",...entries.keys()].map(norm));},
    async clear(){actions.push(["clear"]);nodes.clear();}
  };
  const provider=protectOpfsProvider(base);
  return {provider,actions,nodes};
}
const denied=async promise=>assert.rejects(promise,error=>error.name==="NoPermissions");

test("Theia OPFS provider guards read-only project roots on direct writes",async()=>{
  const {provider,actions,nodes}=fixture();
  for(const p of ["/project/lib/tool.yaml","/project/output/manifest.json",
    "/project/skills","/project/lib","/project/output"]){
    assert.equal((await provider.stat(uri(p))).permissions,1,p);
    await denied(provider.writeFile(uri(p),new Uint8Array([1]),{create:true,overwrite:true}));
    await denied(provider.updateFile(uri(p),[],{}));
    await denied(provider.delete(uri(p),{recursive:true}));
    await denied(provider.open(uri(p),{create:true}));
  }
  assert.equal((await provider.stat(uri("/project/skills/one/SKILL.md"))).permissions,undefined);
  await provider.writeFile(uri("/project/skills/one/other.py"),new Uint8Array([1]),{create:true,overwrite:true});
  assert.ok(nodes.has("/project/skills/one/other.py"));
  assert.deepEqual(actions,[["writeFile","/project/skills/one/other.py"]]);
});

test("non-canonical OPFS path aliases fail closed before storage normalization",async()=>{
  const {provider,actions}=fixture();
  for(const path of ["//project/lib/tool.yaml","/project//lib/tool.yaml",
    "///project/output/manifest.json"]){
    await denied(provider.writeFile(uri(path),new Uint8Array([1]),{create:true,overwrite:true}));
    await denied(provider.delete(uri(path),{recursive:true}));
  }
  assert.deepEqual(actions,[]);
});

test("native OPFS rename/copy/mkdir cannot change protected structures or destinations",async()=>{
  const {provider,actions}=fixture();
  await denied(provider.rename(uri("/project/lib/tool.yaml"),uri("/project/skills/one/tool.yaml"),{overwrite:true}));
  await denied(provider.rename(uri("/project/skills/one/SKILL.md"),uri("/project/output/SKILL.md"),{overwrite:true}));
  await denied(provider.rename(uri("/project/skills"),uri("/project/renamed-skills"),{overwrite:true}));
  await denied(provider.rename(uri("/project/skills/one"),uri("/project/lib/one"),{overwrite:true}));
  await denied(provider.copy(uri("/project/skills/one/SKILL.md"),uri("/project/lib/hello.md"),{overwrite:true}));
  await denied(provider.copy(uri("/project/lib"),uri("/project/skills/copied-lib"),{overwrite:true}));
  await denied(provider.mkdir(uri("/project/output/new-folder")));
  await denied(provider.mkdir(uri("/project/lib/subdir")));
  await provider.mkdir(uri("/project/skills"));
  await provider.mkdir(uri("/project/lib"));
  await provider.mkdir(uri("/project/output"));
  assert.deepEqual(actions,[],"repeat import root creation must be idempotent");
});

test("native OPFS open read descriptor cannot be upgraded into a write",async()=>{
  const {provider,actions}=fixture();
  const fd=await provider.open(uri("/project/lib/tool.yaml"),{create:false});
  await denied(provider.write(fd,0,new Uint8Array([1]),0,1));
  await provider.close(fd);
  assert.deepEqual(actions,[]);
});

test("unrelated lib/output dirs are never globally locked",async()=>{
  const {provider,actions,nodes}=fixture();
  await provider.writeFile(uri("/unrelated/lib/example.yaml"),new Uint8Array([1]),{create:true,overwrite:true});
  await provider.mkdir(uri("/unrelated/output"));
  assert.ok(nodes.has("/unrelated/lib/example.yaml"));
  assert.ok(nodes.has("/unrelated/output"));
  assert.deepEqual(actions,[["writeFile","/unrelated/lib/example.yaml"],["mkdir","/unrelated/output"]]);
});

test("project detection starts only after complete triad exists, protects subsequent writes",async()=>{
  const {provider,nodes}=fixture();
  nodes.delete("/project/output");
  await provider.writeFile(uri("/project/lib/seed.yaml"),new Uint8Array([1]),{create:true,overwrite:true});
  await provider.mkdir(uri("/project/output"));
  await denied(provider.writeFile(uri("/project/lib/after.yaml"),new Uint8Array([1]),{create:true,overwrite:true}));
});

test("bulk OPFS createIndex cannot bypass the protected project boundary",async()=>{
  const {provider,actions}=fixture();
  await denied(provider.createIndex(new Map([
    [uri("/project/lib/generated.py"),new Uint8Array([1])]
  ])));
  await denied(provider.createIndex(new Map([
    [uri("/project/output/manifest.json"),new Uint8Array([1])]
  ])));
  await provider.createIndex(new Map([
    [uri("/project/skills/one/generated.py"),new Uint8Array([1])]
  ]));
  assert.deepEqual(actions,[["createIndex","/project/skills/one/generated.py"]]);
});

test("provider forbids native OPFS clear and has strict segment based roles",async()=>{
  const {provider,actions}=fixture();
  await denied(provider.clear());
  assert.deepEqual(actions,[]);
  assert.deepEqual(projectAccess("/project/lib/x","/project"),{role:"lib",protected:false,readonly:true});
  assert.equal(projectAccess("/project/library/x","/project").readonly,false);
  assert.equal(projectAccess("/other/lib/x","/project").role,"outside");
});
