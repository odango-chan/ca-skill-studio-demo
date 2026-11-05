import test from "node:test";
import assert from "node:assert/strict";
import {createFileWorkspace,markFileEdited} from "../site/sample-packages.mjs";
import {searchPackageText,PACKAGE_SEARCH_LIMITS}
  from "../site/package-search.mjs";

function workspace(){
  return createFileWorkspace("example",[
    {path:"SKILL.md",text:"# Skill\nProcedure PASS starts here\n"},
    {path:"references/readme.md",text:"第一行\r\n第二行有会话和 PASS。\r\n"},
    {path:"scripts/main.py",text:"def main():\n    return 'pass'\n"},
    {path:"assurance/procedure.yaml",text:"start: a.b\nnext: a-b\n"},
    {path:"assets/opaque.bin",bytes:new Uint8Array([80,65,83,83,0])}
  ]);
}
test("cross-file query is literal, case-insensitive, sorted by path and line",()=>{
  const w=workspace();
  const found=searchPackageText(w,"PASS");
  assert.equal(found.matches.length,3);
  assert.deepEqual(found.matches.map(x=>x.path),[
    "SKILL.md","references/readme.md","scripts/main.py"
  ]);
  assert.deepEqual(found.matches.map(x=>x.line),[2,2,2]);
  assert.equal(found.matches[1].column,9); // CRLF + CJK positions
  assert.match(found.matches[1].preview,/第二行有会话和 PASS/);
  assert.equal(found.scannedFiles,4);
  assert.equal(found.skippedLarge,0);
  assert.equal(found.truncated,false);
  const literal=searchPackageText(w,"a.b");
  assert.deepEqual(literal.matches.map(x=>x.path),["assurance/procedure.yaml"]);
});
test("Unicode/CRLF and active uncommitted editor text are searched without mutation",()=>{
  const w=workspace();
  const before=w.files.get("scripts/main.py").text;
  const current=searchPackageText(w,"待保存",{
    activePath:"scripts/main.py",activeText:"\n# 尚待保存：会话参数\n"
  });
  assert.equal(current.matches.length,1);
  assert.equal(current.matches[0].line,2);
  assert.equal(current.matches[0].column,3);
  assert.equal(w.files.get("scripts/main.py").text,before);
  markFileEdited(w,"scripts/main.py","def main():\n    return 'updated'\n");
  assert.equal(searchPackageText(w,"updated").matches[0].path,"scripts/main.py");
  assert.equal(searchPackageText(w,"pass").matches.some(x=>x.path==="scripts/main.py"),false);
});
test("opaque data, empty queries, oversized files and malformed input fail safely",()=>{
  const w=workspace();
  assert.equal(searchPackageText(w,"").matches.length,0);
  assert.equal(searchPackageText(w,"  ").matches.length,0);
  assert.equal(searchPackageText(null,"PASS").matches.length,0);
  assert.equal(searchPackageText(w,"PAS").matches.length,3);
  assert.equal(searchPackageText(w,"PASS").matches.some(x=>x.path.endsWith(".bin")),false);
  assert.throws(()=>searchPackageText(w,null),TypeError);
  assert.throws(()=>searchPackageText(w,"x".repeat(97)),RangeError);
  markFileEdited(w,"SKILL.md","x".repeat(PACKAGE_SEARCH_LIMITS.charactersPerFile+1));
  const partial=searchPackageText(w,"x");
  assert.equal(partial.skippedLarge,1);
  assert.equal(partial.matches.some(x=>x.path==="SKILL.md"),false);
});
test("result count and per-file limits prevent runaway output",()=>{
  const entries=Array.from({length:8},(_,i)=>({
    path:"refs/"+String(i)+".md",
    text:Array.from({length:30},(_,j)=>"test result "+j).join("\n")
  }));
  const w=createFileWorkspace("bounded",entries);
  const result=searchPackageText(w,"test");
  assert.equal(result.matches.length,80);
  assert.equal(result.truncated,true);
  assert.equal(result.matches.filter(x=>x.path==="refs/0.md").length,16);
  assert.ok(result.matches.every(x=>x.line>=1&&x.column>=1&&x.preview.length<=160));
});
