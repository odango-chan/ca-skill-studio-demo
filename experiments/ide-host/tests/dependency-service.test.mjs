import test from "node:test";
import assert from "node:assert/strict";
import {acquireBuiltin,acquireUpload} from "../vscode/src/contract-acquisition.mjs";
import {applyDependency,refreshDependency,removeDependency,resolveLockedDependencies}
  from "../vscode/src/dependency-service.mjs";
const uri=path=>({path,toString(){return "file://"+path;}});
function host(){
  const root=uri("/workspace"),files=new Map(),dirs=new Set(["/workspace"]);
  const updates=[],values={
    skillsRoot:"skills",dependencies:[],
    dependencyLock:{version:"skillc.lock/v0.1",entries:[]},
    defaultBuildTarget:"all"
  };
  let failLockWrite=false;
  const joinPath=(root,...parts)=>uri([root.path,...parts].join("/"));
  const vscode={
    Uri:{joinPath},
    ConfigurationTarget:{WorkspaceFolder:6},
    workspace:{
      workspaceFolders:[{uri:root,name:"workspace"}],
      getConfiguration(_section,_resource){
        return {get(name,fallback){return values[name]??fallback;},
          async update(name,value,target){
            assert.equal(target,6);
            if(failLockWrite&&name==="dependencyLock")throw Error("disk full");
            values[name]=value;updates.push(name);
          }};
      },
      fs:{
        async stat(target){
          if(files.has(target.path)||dirs.has(target.path))return {type:1};
          throw Object.assign(Error("missing"),{code:"FileNotFound"});
        },
        async createDirectory(target){dirs.add(target.path);},
        async readFile(target){
          if(!files.has(target.path))
            throw Object.assign(Error("missing"),{code:"FileNotFound"});
          return new Uint8Array(files.get(target.path));
        },
        async writeFile(target,bytes){files.set(target.path,new Uint8Array(bytes));},
        async rename(from,to,{overwrite}={}){
          assert.equal(overwrite,false);
          if([...files.keys()].some(key=>key.startsWith(to.path+"/")))
            throw Error("destination exists");
          for(const [name,bytes] of [...files]){
            if(name.startsWith(from.path+"/")){
              files.delete(name);files.set(to.path+name.slice(from.path.length),bytes);
            }
          }
          for(const name of [...dirs]){
            if(name===from.path||name.startsWith(from.path+"/")){
              dirs.delete(name);dirs.add(to.path+name.slice(from.path.length));
            }
          }
        },
        async delete(target){for(const key of [...files.keys()])
          if(key.startsWith(target.path+"/"))files.delete(key);}
      }
    }
  };
  return {vscode,root,values,updates,files,
    setFailLockWrite(value){failLockWrite=value;}};
}
test("pinned built-in snapshot persists, reloads and is verified byte for byte",async()=>{
  const h=host(),acquired=await acquireBuiltin({
    bundleId:"studio-example-tools",version:"1.0.0"});
  assert.equal((await resolveLockedDependencies(h.vscode,h.root)).status,"READY");
  await assert.rejects(applyDependency(h.vscode,h.root,"example",acquired,
    {confirm:async()=>false}),/confirmation required/);
  const ready=await applyDependency(h.vscode,h.root,"example",acquired,
    {confirm:async()=>true});
  assert.equal(ready.status,"READY");
  assert.equal(ready.snapshots.length,1);
  assert.equal(h.values.dependencies.length,1);
  assert.equal(h.values.dependencyLock.entries.length,1);
  assert.equal((await resolveLockedDependencies(h.vscode,h.root)).status,"READY");
  const digest=h.values.dependencyLock.entries[0].snapshotDigest.slice(7);
  const file="/workspace/.skill-studio/dependencies/"+digest+"/tool-contract.json";
  assert.ok(h.files.has(file));
  h.files.set(file,new TextEncoder().encode("tampered"));
  const error=await resolveLockedDependencies(h.vscode,h.root);
  assert.equal(error.status,"ERROR");
  assert.equal(error.diagnostics[0].code,"LOCKED_SNAPSHOT_CORRUPT");
  h.files.delete(file);
  const missing=await resolveLockedDependencies(h.vscode,h.root);
  assert.equal(missing.status,"BLOCKED");
  assert.equal(missing.diagnostics[0].code,"LOCKED_SNAPSHOT_MISSING");
});
test("Refresh is observation-only; Update Lock requires confirmation",async()=>{
  const h=host(),initial=await acquireBuiltin({
    bundleId:"studio-example-tools",version:"1.0.0"});
  await applyDependency(h.vscode,h.root,"example",initial,{confirm:async()=>true});
  const old=JSON.stringify(h.values.dependencyLock);
  const before=h.updates.length;
  const probe=await refreshDependency(h.vscode,h.root,"example",async()=>initial);
  assert.equal(probe.status,"READY");assert.equal(probe.changed,false);
  assert.equal(h.updates.length,before);
  assert.equal(JSON.stringify(h.values.dependencyLock),old);
  assert.equal((await removeDependency(h.vscode,h.root,"example",
    {confirm:async()=>false}).catch(()=>({status:"refused"}))).status,"refused");
  assert.equal(h.values.dependencies.length,1);
  const cleaned=await removeDependency(h.vscode,h.root,"example",
    {confirm:async()=>true});
  assert.equal(cleaned.status,"READY");
  assert.equal(h.values.dependencies.length,0);
  assert.equal(h.values.dependencyLock.entries.length,0);
});
test("config pair failure is UNCERTAIN, never READY",async()=>{
  const h=host(),initial=await acquireBuiltin({
    bundleId:"studio-example-tools",version:"1.0.0"});
  h.setFailLockWrite(true);
  await assert.rejects(applyDependency(h.vscode,h.root,"example",initial,
    {confirm:async()=>true}),/UNCERTAIN/);
  assert.equal((await resolveLockedDependencies(h.vscode,h.root)).status,"BLOCKED");
});

test("Upload Refresh observes drift but never mutates existing Lock",async()=>{
  const h=host(),encoder=new TextEncoder();
  const input=a=>encoder.encode(JSON.stringify({apiVersion:"skillc.tool/v0.1",
    operations:[{id:a,inputSchema:{type:"object"},effect:{
      classification:"UNKNOWN",authority:"UNVERIFIED"}}]}));
  const initial=await acquireUpload({upload:"uploaded-tools",format:"json",
    rawBytes:input("alpha")});
  const changed=await acquireUpload({upload:"uploaded-tools",format:"json",
    rawBytes:input("beta")});
  await applyDependency(h.vscode,h.root,"uploaded",initial,{confirm:async()=>true});
  const previous=JSON.stringify(h.values.dependencyLock),count=h.updates.length;
  const inspected=await refreshDependency(h.vscode,h.root,"uploaded",async()=>changed);
  assert.equal(inspected.status,"READY");
  assert.equal(inspected.changed,true);
  assert.notEqual(inspected.candidateLock.snapshotDigest,
    h.values.dependencyLock.entries[0].snapshotDigest);
  assert.equal(JSON.stringify(h.values.dependencyLock),previous);
  assert.equal(h.updates.length,count);
  await applyDependency(h.vscode,h.root,"uploaded",changed,{confirm:async()=>true});
  assert.equal((await resolveLockedDependencies(h.vscode,h.root)).status,"READY");
  assert.notEqual(JSON.stringify(h.values.dependencyLock),previous);
});
