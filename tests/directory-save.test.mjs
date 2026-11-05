import test from "node:test";
import assert from "node:assert/strict";
import {importDirectoryFiles} from "../site/directory-import.mjs";
import {saveDirectoryChanges} from "../site/directory-save.mjs";
import {markFileEdited,hasUnsavedEdits} from "../site/sample-packages.mjs";

const enc=new TextEncoder();
const binary=Uint8Array.from([0,255,137,80,78,71,0]);
function file(path,value){
  const bytes=value instanceof Uint8Array?value:enc.encode(value);
  return {webkitRelativePath:"skill/"+path,name:path.split("/").at(-1),
    size:bytes.length,async arrayBuffer(){return bytes.slice().buffer;}};
}
async function workspace(){
  return (await importDirectoryFiles([
    file("SKILL.md","# Skill\n"),file("scripts/one.py","print(1)\n"),
    file("scripts/two.py","print(2)\n"),file("assets/image.png",binary)
  ])).workspace;
}
function mockDirectory(initial,{
  name="skill",permission="granted",failClose=null,failWrite=null,
  afterWrite=null
}={}){
  const disk=new Map([...initial].map(([path,b])=>[path,b.slice()]));
  const writes=[],opens=[];
  const state={failClose,failWrite,afterWrite,permission};
  function directory(prefix="",dirName=name){
    return {kind:"directory",name:dirName,
      async queryPermission(){return state.permission;},
      async *entries(){
        const seen=new Set();
        for(const path of disk.keys()){
          if(!path.startsWith(prefix))continue;
          const rest=path.slice(prefix.length);
          const [part,...others]=rest.split("/");
          if(seen.has(part))continue;
          seen.add(part);
          if(others.length)yield [part,directory(prefix+part+"/",part)];
          else yield [part,{
            kind:"file",name:part,
            async getFile(){
              const data=disk.get(path);
              if(!data)throw Error("file vanished: "+path);
              return {size:data.length,async arrayBuffer(){return data.slice().buffer;}};
            },
            async createWritable(opts){
              opens.push({path,opts});
              let staged=null;
              return {
                async write(data){
                  if(path===state.failWrite)throw Error("write rejected");
                  staged=Uint8Array.from(data);
                },
                async truncate(length){
                  if(!staged)throw Error("truncate before write");
                  staged=staged.slice(0,length);
                },
                async close(){
                  if(path===state.failClose)throw Error("close rejected");
                  if(!staged)throw Error("no data");
                  disk.set(path,staged);writes.push(path);
                  state.afterWrite?.(path,disk);
                },
                async abort(){/* test verifies that abort never rewrites disk */}
              };
            }
          }];
        }
      }
    };
  }
  return {handle:directory(),disk,writes,opens,state};
}
const snapshot=ws=>new Map([...ws.files].map(([p,x])=>[p,x.originalBytes.slice()]));
const allow=async()=>true;
function edit(ws,path,text){markFileEdited(ws,path,text);}
test("E4-A2 only changed Source writes; unchanged/opaque data and history remain untouched",async()=>{
  const ws=await workspace(),storage=mockDirectory(snapshot(ws));
  const history={marker:"history"};ws.files.get("scripts/one.py").history=history;
  edit(ws,"scripts/one.py","print(42)\n");
  let confirmed=null;
  const result=await saveDirectoryChanges({workspace:ws,handle:storage.handle,
    confirmWrite:async ctx=>{confirmed=ctx;return true;}});
  assert.equal(result.status,"SAVED");
  assert.deepEqual(result.saved,["scripts/one.py"]);
  assert.deepEqual(confirmed.paths,["scripts/one.py"]);
  assert.deepEqual(storage.writes,["scripts/one.py"]);
  assert.equal(storage.opens[0].opts.keepExistingData,false);
  assert.deepEqual(storage.disk.get("assets/image.png"),binary);
  assert.deepEqual(storage.disk.get("scripts/one.py"),enc.encode("print(42)\n"));
  assert.equal(ws.files.get("scripts/one.py").initialText,"print(42)\n");
  assert.equal(ws.files.get("scripts/one.py").history,history);
  assert.equal(hasUnsavedEdits(ws),false);
  assert.equal((await saveDirectoryChanges({workspace:ws})).status,"NO_CHANGES");
});
test("E4-A2 rejects wrong folder, absent confirmation, and ungranted readwrite permission",async()=>{
  for(const variant of [
    {name:"wrong"}, {permission:"denied"}, {permission:"prompt"}
  ]){
    const ws=await workspace(),storage=mockDirectory(snapshot(ws),variant);
    edit(ws,"SKILL.md","# changed\n");
    const res=await saveDirectoryChanges({workspace:ws,handle:storage.handle,
      confirmWrite:allow});
    assert.equal(res.status,"BLOCKED");
    assert.deepEqual(storage.writes,[]);
    assert.equal(hasUnsavedEdits(ws),true);
  }
  const ws=await workspace(),storage=mockDirectory(snapshot(ws));
  edit(ws,"SKILL.md","# changed\n");
  assert.equal((await saveDirectoryChanges({workspace:ws,handle:storage.handle}))
    .status,"BLOCKED");
  assert.equal(storage.opens.length,0);
});
test("E4-A2 detects edited and untouched external changes BEFORE any write",async()=>{
  for(const changed of ["scripts/one.py","SKILL.md","assets/image.png"]){
    const ws=await workspace(),storage=mockDirectory(snapshot(ws));
    edit(ws,"scripts/one.py","print(10)\n");
    storage.disk.set(changed,enc.encode("changed on disk\n"));
    const result=await saveDirectoryChanges({workspace:ws,
      handle:storage.handle,confirmWrite:allow});
    assert.equal(result.status,"CONFLICT",changed);
    assert.equal(result.saved.length,0);
    assert.equal(storage.opens.length,0);
    assert.equal(hasUnsavedEdits(ws),true);
  }
});
test("E4-A2 refuses disk added, deleted, or differently cased files",async()=>{
  const ws=await workspace();
  edit(ws,"SKILL.md","# local\n");
  for(const mutator of [
    d=>d.set("extra.md",enc.encode("oops")),
    d=>d.delete("scripts/two.py"),
    d=>{d.set("SKILL.md",d.get("SKILL.md").slice());d.set("skill.md",enc.encode("other"));}
  ]){
    const storage=mockDirectory(snapshot(ws));
    mutator(storage.disk);
    const result=await saveDirectoryChanges({workspace:ws,
      handle:storage.handle,confirmWrite:allow});
    assert.equal(result.status,"CONFLICT");
    assert.deepEqual(storage.writes,[]);
  }
});
test("E4-A2 cancel confirmation is zero-write and remains dirty",async()=>{
  const ws=await workspace(),storage=mockDirectory(snapshot(ws));
  edit(ws,"SKILL.md","# changed\n");
  const result=await saveDirectoryChanges({workspace:ws,
    handle:storage.handle,confirmWrite:async()=>false});
  assert.equal(result.status,"CANCELLED");
  assert.equal(storage.writes.length,0);
  assert.equal(hasUnsavedEdits(ws),true);
});
test("E4-A2 detects a workspace revision change while user is confirming",async()=>{
  const ws=await workspace(),storage=mockDirectory(snapshot(ws));
  edit(ws,"SKILL.md","# first\n");
  const result=await saveDirectoryChanges({workspace:ws,
    handle:storage.handle,confirmWrite:async()=>{edit(ws,"SKILL.md","# second\n");return true;}});
  assert.equal(result.status,"CONFLICT");
  assert.deepEqual(storage.writes,[]);
  assert.equal(ws.files.get("SKILL.md").text,"# second\n");
});
test("E4-A2 partial save reports committed and pending files, then supports retry",async()=>{
  const ws=await workspace(),storage=mockDirectory(snapshot(ws),{
    failClose:"scripts/two.py"
  });
  edit(ws,"scripts/one.py","print(11)\n");
  edit(ws,"scripts/two.py","print(22)\n");
  const first=await saveDirectoryChanges({workspace:ws,
    handle:storage.handle,confirmWrite:allow});
  assert.equal(first.status,"PARTIAL");
  assert.deepEqual(first.saved,["scripts/one.py"]);
  assert.deepEqual(first.pending,["scripts/two.py"]);
  assert.deepEqual(first.uncertain,["scripts/two.py"]);
  assert.deepEqual(storage.writes,["scripts/one.py"]);
  assert.equal(ws.files.get("scripts/one.py").initialText,"print(11)\n");
  assert.equal(ws.files.get("scripts/two.py").initialText,"print(2)\n");
  assert.equal(hasUnsavedEdits(ws),true);
  storage.state.failClose=null;
  const retry=await saveDirectoryChanges({workspace:ws,handle:storage.handle,
    confirmWrite:allow});
  assert.equal(retry.status,"SAVED");
  assert.deepEqual(retry.saved,["scripts/two.py"]);
  assert.deepEqual(storage.writes,["scripts/one.py","scripts/two.py"]);
  assert.equal(hasUnsavedEdits(ws),false);
});
test("E4-A2 checks other files between writes and refuses another write if disk drifted",async()=>{
  const ws=await workspace(),storage=mockDirectory(snapshot(ws),{
    afterWrite(path,disk){
      if(path==="scripts/one.py")
        disk.set("assets/image.png",Uint8Array.from([1,2,3]));
    }
  });
  edit(ws,"scripts/one.py","print(11)\n");
  edit(ws,"scripts/two.py","print(22)\n");
  const result=await saveDirectoryChanges({workspace:ws,
    handle:storage.handle,confirmWrite:allow});
  assert.equal(result.status,"PARTIAL");
  assert.deepEqual(result.saved,["scripts/one.py"]);
  assert.deepEqual(storage.writes,["scripts/one.py"]);
});
test("E4-A2 post-close read-back mismatch reports uncertain target, never cleans dirty file",async()=>{
  const ws=await workspace(),storage=mockDirectory(snapshot(ws),{
    afterWrite(path,disk){disk.set(path,enc.encode("unexpected writer\n"));}
  });
  edit(ws,"SKILL.md","# new\n");
  const outcome=await saveDirectoryChanges({workspace:ws,handle:storage.handle,
    confirmWrite:allow});
  assert.equal(outcome.status,"CONFLICT");
  assert.deepEqual(outcome.uncertain,["SKILL.md"]);
  assert.equal(ws.files.get("SKILL.md").initialText,"# Skill\n");
  assert.equal(hasUnsavedEdits(ws),true);
});
test("E4-A2 unsupported stream and permission errors do not fabricate success",async()=>{
  const ws=await workspace(),storage=mockDirectory(snapshot(ws));
  edit(ws,"SKILL.md","# updated\n");
  const missingStream={...storage.handle,
    async *entries(){
      for await (const [name,h] of storage.handle.entries()){
        if(name==="SKILL.md")yield [name,{...h,createWritable:undefined}];
        else yield [name,h];
      }
    }};
  const res=await saveDirectoryChanges({workspace:ws,handle:missingStream,
    confirmWrite:allow});
  assert.equal(res.status,"BLOCKED");
  assert.equal(res.saved.length,0);
});
test("E4-A2 rejects writing oversized edited UTF-8 and refuses malformed origins",async()=>{
  const ws=await workspace(),storage=mockDirectory(snapshot(ws));
  edit(ws,"SKILL.md","明".repeat(500000));
  const res=await saveDirectoryChanges({workspace:ws,handle:storage.handle,
    confirmWrite:allow});
  assert.equal(res.status,"BLOCKED");
  assert.deepEqual(storage.writes,[]);
  const fake={name:"skill",files:new Map([["SKILL.md",{
    path:"SKILL.md",text:"# fake",initialText:"# initial",editable:true,
    originalBytes:null
  }]])};
  assert.equal((await saveDirectoryChanges({workspace:fake,handle:storage.handle,
    confirmWrite:allow})).status,"BLOCKED");
});

test("E4-A2 replacing longer disk text with a shorter Source has no retained tail",async()=>{
  const ws=await workspace(),storage=mockDirectory(snapshot(ws));
  edit(ws,"SKILL.md","#\n");
  const response=await saveDirectoryChanges({workspace:ws,handle:storage.handle,
    confirmWrite:allow});
  assert.equal(response.status,"SAVED");
  assert.deepEqual(storage.disk.get("SKILL.md"),enc.encode("#\n"));
  assert.equal(storage.disk.get("SKILL.md").length,2);
});

test("E4-A2 final post-save scan detects external drift after the last write",async()=>{
  const ws=await workspace(),storage=mockDirectory(snapshot(ws),{
    afterWrite(path,disk){
      if(path==="SKILL.md")
        disk.set("assets/image.png",Uint8Array.from([7,8,9]));
    }
  });
  edit(ws,"SKILL.md","# replaced\\n");
  const outcome=await saveDirectoryChanges({workspace:ws,
    handle:storage.handle,confirmWrite:allow});
  assert.equal(outcome.status,"PARTIAL");
  assert.deepEqual(outcome.saved,["SKILL.md"]);
  assert.deepEqual(outcome.pending,[]);
  assert.equal(ws.files.get("SKILL.md").initialText,"# replaced\\n");
  assert.equal(outcome.error.includes("assets/image.png"),true);
  assert.deepEqual(storage.disk.get("assets/image.png"),Uint8Array.from([7,8,9]));
});
