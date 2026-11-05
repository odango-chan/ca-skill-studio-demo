import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {createFileWorkspace,markFileEdited,hasUnsavedEdits,fileDirtyState,
  SAMPLE_PACKAGES,packageFilesForSample} from "../site/sample-packages.mjs";
import {zipPackage} from "../site/zip.mjs";
import {createEditorHistory} from "../site/patch.mjs";
import {projectWorkspace} from "../site/workspace.mjs";

const read=(name,path)=>readFileSync(
  new URL("../site/samples/packages/"+name+"/"+path,import.meta.url),"utf8");
const sha=text=>{
  const bytes=Buffer.from(text);
  return createHash("sha1").update("blob "+bytes.length+"\0").update(bytes).digest("hex");
};

test("only the owner-named establish-pdu-session is a selectable real SKILL Package",()=>{
  assert.deepEqual(Object.keys(SAMPLE_PACKAGES),["establish"]);
  assert.equal(SAMPLE_PACKAGES.establish.name,"establish-pdu-session");
  assert.equal(SAMPLE_PACKAGES.establish.files.length,16);
  const spec=SAMPLE_PACKAGES.establish;
  assert.equal(spec.entry,"assurance/procedure.yaml");
  for(const path of ["SKILL.md","assurance/contract.yaml",
    "assurance/predicates.yaml","assurance/procedure.yaml"])
    assert.ok(spec.files.includes(path),path);
  assert.deepEqual(packageFilesForSample("establish").map(x=>x.path),spec.files);
  assert.throws(()=>packageFilesForSample("ensure"));
  for(const path of spec.files)
    assert.ok(read(spec.name,path).trim().length>0,path);
  assert.deepEqual(SAMPLE_PACKAGES.establish.files.filter(p=>p.startsWith("scripts/")).length,3);
  assert.deepEqual(SAMPLE_PACKAGES.establish.files.filter(p=>p.startsWith("schemas/")).length,6);
  assert.deepEqual(SAMPLE_PACKAGES.establish.files.filter(p=>p.startsWith("references/")),[
    "references/3gpp-procedure.md",
    "references/session-selection.md",
    "references/failure-handling.md"
  ]);
  assert.ok(SAMPLE_PACKAGES.establish.files.every(path=>
    !path.startsWith("cases/")&&!path.startsWith("design/")));
});
test("fixtures are byte-for-byte the pinned ca-agent-demo Git blob sources",()=>{
  assert.equal(sha(read("establish-pdu-session","SKILL.md")),"d56174cae48e43f0c041d65f84058d6b8d0cef3e");
  assert.equal(sha(read("establish-pdu-session","references/3gpp-procedure.md")),"d70148210dcd6ea7a7ddebbb1ffcba34e2bb33b3");
  assert.equal(sha(read("establish-pdu-session","references/session-selection.md")),"341a29272ee5b593760b5ee8632ac7c9e7508105");
  assert.equal(sha(read("establish-pdu-session","references/failure-handling.md")),"02f1d6caf84f1f8dc29684ec07d90a805b9f81e0");
  assert.equal(sha(read("establish-pdu-session","assurance/contract.yaml")),"fb911dc9f7cb43713a36c5904adefc283c925b6e");
  assert.equal(sha(read("establish-pdu-session","assurance/procedure.yaml")),"4b717e1f6815a24973a6a0484e72e35bdfedbe21");
  assert.equal(sha(read("establish-pdu-session","assurance/predicates.yaml")),"bc9226f64123abf76bae02ca8fd10922078249f9");
  assert.equal(sha(read("establish-pdu-session","schemas/establishment-request.schema.yaml")),"c8027b6f9625949302900fa170ad59fec3b4a8f7");
  assert.equal(sha(read("establish-pdu-session","schemas/predicate-evaluation-result.schema.yaml")),"c34c65ac00dcebb0a306a7cee2224566617fceca");
  assert.equal(sha(read("establish-pdu-session","schemas/selection-input.schema.yaml")),"b3ff6984c693daf7e71758106aacbf8f08cd7487");
  assert.equal(sha(read("establish-pdu-session","schemas/selection.schema.yaml")),"29a3f172be5dc815926ae1288ad4c29b1c052342");
  assert.equal(sha(read("establish-pdu-session","schemas/transfer-start-evaluation-input.schema.yaml")),"b5523699b627e7a68dfe8fed6daf623738b672c1");
  assert.equal(sha(read("establish-pdu-session","schemas/udm-read-evaluation-input.schema.yaml")),"f26a877d55b4e94c9a1a9487e0eceb702c0778ee");
  assert.equal(sha(read("establish-pdu-session","scripts/evaluate_transfer_start.py")),"f5319a6d9383f7bcb984544325aefc844e8c503d");
  assert.equal(sha(read("establish-pdu-session","scripts/evaluate_udm_read.py")),"c542b0699ff0357b9f7d2a0e10b1f13cd7d62657");
  assert.equal(sha(read("establish-pdu-session","scripts/select_establishment_configuration.py")),"4b76b87b09b0d617327c42b4002be3fac80878aa");
});
test("real Procedure files project to the expected Root and Child graph",()=>{
  const establish=projectWorkspace(read("establish-pdu-session","assurance/procedure.yaml"));
  assert.equal(establish.state,"READY");
  assert.equal(establish.procedure.nodes.length,17);
  assert.equal(establish.procedure.routes.length,63);
  assert.equal(establish.procedures.size,6);
});
test("file workspace retains per-file source and revision history independently",()=>{
  const ws=createFileWorkspace("establish-pdu-session",[
    {path:"SKILL.md",text:"# Demo"},
    {path:"assurance/procedure.yaml",text:"procedures: {}"}
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
  assert.equal(ws.files.get("assurance/procedure.yaml").text,"procedures: {}");
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


test("updated CreatedSession SKILL.md names all optional References in its package",()=>{
  const skill=read("establish-pdu-session","SKILL.md");
  assert.match(skill,/## Optional business references/);
  assert.match(skill,/read_reference/);
  for(const path of SAMPLE_PACKAGES.establish.files.filter(p=>p.startsWith("references/"))){
    assert.ok(skill.includes(String.fromCharCode(96)+path+String.fromCharCode(96)),path);
    const document=read("establish-pdu-session",path);
    assert.ok(document.startsWith("# "),path);
    assert.ok(document.length>1000,path);
    assert.ok(!document.includes("\u0000"),path);
  }
  assert.ok(skill.includes("Read "+String.fromCharCode(96)+"references/session-selection.md"));
});
test("updated CreatedSession ZIP exports Reference paths with exact authored bytes",()=>{
  const entries=SAMPLE_PACKAGES.establish.files.map(path=>({
    path,text:read("establish-pdu-session",path)
  }));
  const zip=zipPackage(entries),view=new DataView(zip.buffer,zip.byteOffset,zip.byteLength);
  const decoder=new TextDecoder();let p=0,seen=[];
  for(const entry of entries){
    assert.equal(view.getUint32(p,true),0x04034b50);
    const nameLen=view.getUint16(p+26,true);
    const size=view.getUint32(p+18,true);
    const path=decoder.decode(zip.slice(p+30,p+30+nameLen));
    const text=decoder.decode(zip.slice(p+30+nameLen,p+30+nameLen+size));
    assert.equal(path,entry.path);
    assert.equal(text,entry.text);
    seen.push(path);p+=30+nameLen+size;
  }
  assert.equal(view.getUint16(zip.length-12,true),16);
  assert.deepEqual(seen.filter(x=>x.startsWith("references/")),
    SAMPLE_PACKAGES.establish.files.filter(x=>x.startsWith("references/")));
  assert.equal(view.getUint32(p,true),0x02014b50);
});
