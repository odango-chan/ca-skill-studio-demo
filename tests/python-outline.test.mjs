import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {pythonTopLevelOutline} from "../site/python-outline.mjs";

const root=new URL("../site/samples/packages/establish-pdu-session/scripts/",import.meta.url);
const read=name=>readFileSync(new URL(name,root),"utf8");

test("E3-A2 source-aware top-level classes/main in all three owner scripts",()=>{
  for(const file of ["select_establishment_configuration.py",
    "evaluate_udm_read.py","evaluate_transfer_start.py"]){
    const text=read(file),result=pythonTopLevelOutline(text);
    assert.equal(result.status,"READY");
    assert.deepEqual(result.warnings,[]);
    assert.ok(result.symbols.some(x=>x.name==="main"&&x.kind==="function"));
    for(const symbol of result.symbols){
      const line=text.split(/\r?\n/)[symbol.line-1];
      assert.match(line,new RegExp("^(class|def|async def) "+symbol.name+"\\b"));
    }
    assert.equal(pythonTopLevelOutline(text).symbols.length,result.symbols.length);
  }
});
test("E3-A2 skips pseudo symbols in triple strings, comments, nested blocks",()=>{
  const text=[
    "# def commented(): pass",
    'demo = """',
    "def decoy():",
    "class Fake:",
    '"""',
    "def main():",
    "    def nested(): pass",
    "    return 1",
    "class Model:",
    "    pass",
    "async def async_main():",
    "    pass"
  ].join("\n");
  const result=pythonTopLevelOutline(text);
  assert.equal(result.status,"READY");
  assert.deepEqual(result.symbols.map(x=>x.name),["main","Model","async_main"]);
  assert.equal(result.symbols[2].async,true);
  assert.equal(result.symbols[0].line,6);
});
test("E3-A2 duplicate top-level names are not navigable",()=>{
  const result=pythonTopLevelOutline("def main(): pass\nclass Main: pass\ndef main(): return 1");
  assert.equal(result.status,"READY");
  assert.deepEqual(result.symbols.map(x=>x.name),["Main"]);
  assert.ok(result.warnings[0].includes("main"));
});
test("E3-A2 malformed or unbounded source fails closed instead of guessing",()=>{
  for(const value of [null,5,"a".repeat(1024*1024+1),"def a(): pass\n\u0000",
    'x = """\ndef fake(): pass',
    "x = 'unterminated\ndef fake(): pass"]){
    const result=pythonTopLevelOutline(value);
    assert.equal(result.status,"UNAVAILABLE");
    assert.deepEqual(result.symbols,[]);
    assert.ok(result.warnings.length);
  }
});
test("E3-A2 lexical navigation never modifies Python source",()=>{
  const text=read("evaluate_udm_read.py");
  const copy=text;
  const result=pythonTopLevelOutline(text);
  assert.equal(text,copy);
  assert.ok(Object.isFrozen(result)&&Object.isFrozen(result.symbols));
  assert.ok(result.symbols.every(Object.isFrozen));
});
