import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {createFileWorkspace,markFileEdited,hasUnsavedEdits,fileDirtyState,
  SAMPLE_PACKAGES,packageFilesForSample} from "../site/sample-packages.mjs";
import {zipPackage} from "../site/zip.mjs";
import {createEditorHistory} from "../site/patch.mjs";
import {projectWorkspace} from "../site/workspace.mjs";

const readSample=(name,path)=>readFileSync(
  new URL("../site/samples/v1alpha5/"+name+"/"+path,import.meta.url),"utf8");
const sha=text=>{
  const bytes=Buffer.from(text);
  return createHash("sha1").update("blob "+bytes.length+"\0").update(bytes).digest("hex");
};

test("only the current v1alpha5 Examples are selectable",()=>{
  assert.deepEqual(Object.keys(SAMPLE_PACKAGES),["mas","modify","release"]);
  assert.equal(SAMPLE_PACKAGES.mas.sourceDir,"v1alpha5");
  assert.equal(SAMPLE_PACKAGES.mas.files.length,6);
  for(const key of Object.keys(SAMPLE_PACKAGES)){
    for(const item of packageFilesForSample(key)){
      assert.match(item.url,/^\.\/samples\/v1alpha5\//);
      assert.ok(readFileSync(new URL("../site/"+item.url.slice(2),import.meta.url),"utf8").trim().length>0);
    }
  }
});

test("built-in Example assets match the pinned ca-skills blob manifest",()=>{
  const manifest=JSON.parse(readFileSync(new URL("../site/samples/v1alpha5/files.json",import.meta.url),"utf8"));
  assert.equal(manifest.sourceRepo,"odango-chan/ca-skills");
  assert.equal(manifest.sourceRef,"refs/pull/86/head");
  assert.equal(manifest.sourceSha,"83d9e0c7d523189a1ae03186f8913277f0829d72");
  assert.equal(manifest.sourceStatus,"OWNER_LINKED_STATIC_BUILD_PASS_E2E_NOT_RERUN");
  for(const path of manifest.files){
    const content=readSample(path.split("/")[0],path.split("/").slice(1).join("/"));
    assert.equal(sha(content),manifest.blobs[path],path);
  }
});

test("real v1alpha5 Procedure files project to the current Root and Child graph",()=>{
  const establish=projectWorkspace(readSample("establish-pdu-session-mas","assurance/procedure.yaml"));
  assert.equal(establish.state,"READY");
  assert.equal(establish.procedure.nodes.length,14);
  assert.equal(establish.procedures.size,1);
});

test("file workspace retains per-file source and revision history independently",()=>{
  const ws=createFileWorkspace("establish-pdu-session",[
    {path:"SKILL.md",text:"# Demo"},
    {path:"assurance/procedure.yaml",text:"start: demo\nnodes: {}"}
  ]);
  assert.equal(hasUnsavedEdits(ws),false);
  const first=createEditorHistory("# Demo");
  first.record("# Updated");
  markFileEdited(ws,"SKILL.md","# Updated",first);
  assert.equal(hasUnsavedEdits(ws),true);
  assert.equal(fileDirtyState(ws,"SKILL.md"),true);
  assert.equal(fileDirtyState(ws,"assurance/procedure.yaml"),false);
  assert.equal(ws.files.get("SKILL.md").history.undo(),"# Demo");
  assert.equal(ws.files.get("SKILL.md").history.redo(),"# Updated");
  assert.equal(ws.files.get("assurance/procedure.yaml").text,"start: demo\nnodes: {}");
});

test("workspace rejects duplicate, traversal, binary and empty manifests",()=>{
  assert.throws(()=>createFileWorkspace("x",[]));
  assert.throws(()=>createFileWorkspace("x",[{path:"../escape",text:"hi"}]));
  assert.throws(()=>createFileWorkspace("x",[{path:"a",text:"x"},{path:"a",text:"y"}]));
  assert.throws(()=>createFileWorkspace("x",[{path:"unsafe.txt",text:"x\u0000y"}]));
  assert.ok(createFileWorkspace("local",[{path:"相闻.txt",text:"中文"}]).files.has("相闻.txt"));
});

test("ZIP export keeps all file names and working-copy bytes in store entries",()=>{
  const entries=[{path:"SKILL.md",text:"# Hello\n"},
    {path:"assurance/contract.yaml",text:"maxActions: 7\n"},
    {path:"docs/中文.txt",text:"原文🙂\n"}];
  const zip=zipPackage(entries);
  const view=new DataView(zip.buffer,zip.byteOffset,zip.byteLength);
  const decoder=new TextDecoder();
  let pos=0;
  for(const item of entries){
    assert.equal(view.getUint32(pos,true),0x04034b50);
    assert.equal(view.getUint16(pos+8,true),0);
    const size=view.getUint32(pos+18,true);
    const nameLength=view.getUint16(pos+26,true);
    const name=decoder.decode(zip.slice(pos+30,pos+30+nameLength));
    const value=decoder.decode(zip.slice(pos+30+nameLength,pos+30+nameLength+size));
    assert.equal(name,item.path);
    assert.equal(value,item.text);
    pos+=30+nameLength+size;
  }
  assert.equal(view.getUint32(pos,true),0x02014b50);
  assert.equal(view.getUint32(zip.length-22,true),0x06054b50);
  assert.equal(view.getUint16(zip.length-12,true),entries.length);
});

test("ZIP export rejects path traversal and duplicate file identity",()=>{
  assert.throws(()=>zipPackage([{path:"../x",text:"data"}]));
  assert.throws(()=>zipPackage([{path:"x",text:"a"},{path:"x",text:"b"}]));
  assert.throws(()=>zipPackage([{path:"",text:"x"}]));
  assert.throws(()=>zipPackage([{path:"x",text:"a".repeat(1024*1024+1)}]));
});
