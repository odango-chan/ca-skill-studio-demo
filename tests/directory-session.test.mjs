import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {importDirectoryHandle} from "../site/directory-session.mjs";

const encode=new TextEncoder();
function directory(name,entries=[]){
  const items=new Map(entries);
  return {kind:"directory",name,
    async *entries(){yield* items.entries();}};
}
function file(name,value,{bad=false,bytes=null}={}){
  const contents=bytes??encode.encode(value);
  return {kind:"file",name,
    async getFile(){
      if(bad)throw new Error("Read denied");
      return {name,size:contents.length,arrayBuffer:async()=>contents.slice().buffer};
    }};
}
function sample(path){
  return new Uint8Array(readFileSync(new URL(
    "../site/samples/v1alpha5/establish-pdu-session/"+path,import.meta.url)));
}
test("E4 session handle: read-only open retains same handle and imports all 8 current Example files",async()=>{
  const paths=[
    "SKILL.md","assurance/contract.yaml","assurance/procedure.yaml",
    "assurance/predicates.yaml","schemas/establishment-request.schema.yaml",
    "scripts/validate-smf-session-context-entry.py",
    "scripts/validate-smf-session-context.py",
    "scripts/validate-subscription-request.py"
  ];
  const tree=new Map();
  for(const path of paths){
    const bits=path.split("/"),name=bits.pop();
    let node=tree;
    for(const bit of bits){
      if(!node.has(bit))node.set(bit,new Map());
      node=node.get(bit);
    }
    node.set(name,file(name,"",{bytes:sample(path)}));
  }
  function toHandle(name,map){
    return directory(name,[...map].map(([n,v])=>[
      n,v instanceof Map?toHandle(n,v):v]));
  }
  const handle=toHandle("establish-pdu-session",tree);
  const got=await importDirectoryHandle(handle);
  assert.equal(got.handle,handle);
  assert.equal(got.workspace.files.size,8);
  assert.equal(got.entry,"assurance/procedure.yaml");
  assert.equal(got.opaqueCount,0);
  for(const path of paths)
    assert.deepEqual(got.workspace.files.get(path).originalBytes,sample(path));
});
test("E4 session handle: does not require write permission to import",async()=>{
  let writes=0,permissions=0;
  const handle=directory("scratch",[
    ["SKILL.md",file("SKILL.md","# Scratch\n")]]);
  handle.requestPermission=async()=>{permissions++;return "denied"};
  handle.queryPermission=async()=>{permissions++;return "prompt"};
  handle.getFileHandle=async()=>{writes++;throw new Error("Write denied")};
  const got=await importDirectoryHandle(handle);
  assert.equal(got.workspace.files.size,1);
  assert.equal(writes,0);assert.equal(permissions,0);
});
test("E4 session handle: invalid root, nested path, source read errors fail closed",async()=>{
  await assert.rejects(importDirectoryHandle(null));
  await assert.rejects(importDirectoryHandle(directory("bad name",[])));
  await assert.rejects(importDirectoryHandle(directory("root",[
    ["file.md",file("file.md","text")]])),/SKILL.md/);
  await assert.rejects(importDirectoryHandle(directory("root",[
    ["SKILL.md",file("SKILL.md","# fine")],
    ["bad",file("wrong.md","text")]])),/名称不一致/);
  await assert.rejects(importDirectoryHandle(directory("root",[
    ["SKILL.md",file("SKILL.md","# fine",{bad:true})]])),/Read denied/);
  await assert.rejects(importDirectoryHandle(directory("root",[
    ["SKILL.md",file("SKILL.md","# fine")],
    ["escape/..",file("escape/..","evil")]])),/不安全/);
});
test("E4 session handle: source-import limits and ambiguous names remain bounded",async()=>{
  const many=Array.from({length:65},(_,i)=>[
    "ref"+i+".md",file("ref"+i+".md","a")]);
  await assert.rejects(importDirectoryHandle(directory("demo",[
    ["SKILL.md",file("SKILL.md","# test")],...many])),/64/);
  await assert.rejects(importDirectoryHandle(directory("demo",[
    ["SKILL.md",file("SKILL.md","# test")],
    ["Big.md",file("Big.md","",{bytes:new Uint8Array(1024*1024+1)})]
  ])),/1 MiB/);
  await assert.rejects(importDirectoryHandle(directory("demo",[
    ["SKILL.md",file("SKILL.md","# test")],
    ["NAME.md",file("NAME.md","A")],
    ["name.md",file("name.md","B")]
  ])),/重复|冲突/);
});
