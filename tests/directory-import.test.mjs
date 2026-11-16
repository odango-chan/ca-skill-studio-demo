import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {importDirectoryFiles,packageZipEntries} from "../site/directory-import.mjs";
import {zipPackage} from "../site/zip.mjs";
import {markFileEdited,hasUnsavedEdits} from "../site/sample-packages.mjs";
import {projectWorkspace} from "../site/workspace.mjs";

const enc=new TextEncoder();
const b=x=>typeof x==="string"?enc.encode(x):x;
function selected(path,content,{size=null,readBytes=null}={}){
  const bytes=b(content);
  const parts=path.split("/");
  return {
    webkitRelativePath:path,name:parts.at(-1),size:size??bytes.length,
    async arrayBuffer(){return (readBytes??bytes).slice().buffer;}
  };
}
function unpack(zip){
  const view=new DataView(zip.buffer,zip.byteOffset,zip.byteLength);
  const decoder=new TextDecoder();
  const entries=new Map();let pos=0;
  while(view.getUint32(pos,true)===0x04034b50){
    const size=view.getUint32(pos+18,true),nameSize=view.getUint16(pos+26,true);
    const path=decoder.decode(zip.slice(pos+30,pos+30+nameSize));
    entries.set(path,zip.slice(pos+30+nameSize,pos+30+nameSize+size));
    pos+=30+nameSize+size;
  }
  assert.equal(view.getUint32(pos,true),0x02014b50);
  assert.equal(view.getUint16(zip.length-12,true),entries.size);
  return entries;
}
const sample=(file)=>readFileSync(new URL(
  "../site/samples/packages/establish-pdu-session/"+file,import.meta.url));

test("E4-A1 selects the real 16-file Skill and retains Procedure/Reference Source",async()=>{
  const paths=[
    "SKILL.md","assurance/contract.yaml","assurance/procedure.yaml",
    "assurance/predicates.yaml","references/3gpp-procedure.md",
    "references/session-selection.md","references/failure-handling.md",
    "schemas/establishment-request.schema.yaml",
    "schemas/predicate-evaluation-result.schema.yaml",
    "schemas/selection-input.schema.yaml","schemas/selection.schema.yaml",
    "schemas/transfer-start-evaluation-input.schema.yaml",
    "schemas/udm-read-evaluation-input.schema.yaml",
    "scripts/evaluate_transfer_start.py","scripts/evaluate_udm_read.py",
    "scripts/select_establishment_configuration.py"
  ];
  const selectedFiles=paths.map(p=>selected("establish-pdu-session/"+p,
    new Uint8Array(sample(p))));
  const {workspace,entry,opaqueCount}=await importDirectoryFiles(selectedFiles);
  assert.equal(workspace.name,"establish-pdu-session");
  assert.equal(workspace.files.size,16);
  assert.equal(entry,"assurance/procedure.yaml");
  assert.equal(opaqueCount,0);
  assert.equal(projectWorkspace(workspace.files.get(entry).text).state,"READY");
  const z=unpack(zipPackage(packageZipEntries(workspace)));
  for(const path of paths)assert.deepEqual(z.get(path),new Uint8Array(sample(path)),path);
  assert.equal(hasUnsavedEdits(workspace),false);
});

test("E4-A1 unknown/binary files survive ZIP unchanged, edited text changes alone",async()=>{
  const bom=Uint8Array.from([0xef,0xbb,0xbf,...enc.encode("# BOM\r\n")]);
  const opaque=Uint8Array.from([0,255,137,80,78,71,0]);
  const input=[
    selected("local-skill/SKILL.md",bom),
    selected("local-skill/scripts/task.py","def main():\r\n    return 1\r\n"),
    selected("local-skill/assets/image.png",opaque),
    selected("local-skill/notes/custom.xyz",enc.encode("raw unknown\n"))
  ];
  const {workspace,entry,opaqueCount}=await importDirectoryFiles(input);
  assert.equal(entry,"SKILL.md");
  assert.equal(opaqueCount,2);
  assert.equal(workspace.files.get("SKILL.md").text.charCodeAt(0),0xfeff);
  assert.equal(workspace.files.get("assets/image.png").editable,false);
  assert.throws(()=>markFileEdited(workspace,"assets/image.png","oops"));
  const first=unpack(zipPackage(packageZipEntries(workspace)));
  assert.deepEqual(first.get("SKILL.md"),bom);
  assert.deepEqual(first.get("assets/image.png"),opaque);
  assert.deepEqual(first.get("notes/custom.xyz"),enc.encode("raw unknown\n"));
  markFileEdited(workspace,"scripts/task.py","def main():\n    return 2\n");
  assert.equal(hasUnsavedEdits(workspace),true);
  const second=unpack(zipPackage(packageZipEntries(workspace)));
  assert.deepEqual(second.get("scripts/task.py"),enc.encode("def main():\n    return 2\n"));
  assert.deepEqual(second.get("SKILL.md"),bom);
  assert.deepEqual(second.get("assets/image.png"),opaque);
});

test("E4-A1 malformed UTF-8 recognized text remains opaque and exportable",async()=>{
  const invalid=Uint8Array.from([0xc3,0x28,0x00,0x09]);
  const {workspace,opaqueCount}=await importDirectoryFiles([
    selected("test/SKILL.md","# test\n"),
    selected("test/scripts/bad.py",invalid)
  ]);
  assert.equal(opaqueCount,1);
  assert.equal(workspace.files.get("scripts/bad.py").editable,false);
  assert.deepEqual(unpack(zipPackage(packageZipEntries(workspace)))
    .get("scripts/bad.py"),invalid);
});

test("E4-A1 rejects invalid manifests before any live workspace replacement",async()=>{
  const valid=selected("demo/SKILL.md","# Demo");
  const bad=[
    [],
    [selected("demo/sub/file.md","# hi")],
    [valid,selected("other/README.md","# other")],
    [valid,selected("demo/../escape.md","x")],
    [valid,selected("demo/scripts//name.py","x")],
    [valid,selected("demo/DOC.md","A"),selected("demo/doc.md","B")],
    [valid,selected("demo/résumé.md","A"),selected("demo/re\u0301sume\u0301.md","B")],
    [valid,selected("demo/nope.txt","x",{size:1024*1024+1})],
    [valid,selected("demo/notes.txt","x",{size:10})],
    Array.from({length:65},(_,i)=>selected("demo/file"+i+".md","x")),
    [{...valid,webkitRelativePath:""}],
    [{...valid,name:"wrong.md"}],
    [selected("bad root/SKILL.md","# Demo")]
  ];
  for(const files of bad)await assert.rejects(importDirectoryFiles(files));
  await assert.rejects(importDirectoryFiles([
    valid,selected("demo/fail.txt","hello",{size:5,readBytes:enc.encode("hi")})
  ]));
});
test("E4-A1 rejects oversize aggregate without attempting file reads",async()=>{
  let readCount=0;
  const files=Array.from({length:9},(_,i)=>({
    ...selected("demo/file"+i+".bin",new Uint8Array(1024*1024)),
    async arrayBuffer(){readCount++;return new ArrayBuffer(1024*1024);}
  }));
  files.push(selected("demo/SKILL.md","# Demo"));
  await assert.rejects(importDirectoryFiles(files),/8 MiB/);
  assert.equal(readCount,0);
});
test("E4-A1 import never asks for disk permissions or mutates the given file bytes",async()=>{
  const raw=enc.encode("# Untouched\n"),file=selected("demo/SKILL.md",raw);
  const {workspace}=await importDirectoryFiles([file]);
  workspace.files.get("SKILL.md").originalBytes[0]=42;
  assert.deepEqual(raw,enc.encode("# Untouched\n"));
  assert.deepEqual(await new Uint8Array(await file.arrayBuffer()),raw);
});
