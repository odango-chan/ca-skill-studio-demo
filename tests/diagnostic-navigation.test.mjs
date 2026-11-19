import test from "node:test";
import assert from "node:assert/strict";
import {diagnosticSourcePosition} from "../experiments/ide-host/vscode/src/diagnostic-navigation.mjs";

function textDocument(text){
  const lines=text.split(/\r\n|\n|\r/);
  return {
    getText:()=>text,
    lineCount:lines.length,
    lineAt:line=>({text:lines[line]}),
    positionAt(offset){
      const prefix=text.slice(0,offset);
      const segments=prefix.split(/\r\n|\n|\r/);
      return {line:segments.length-1,character:segments.at(-1).length};
    }
  };
}

test("Problems selection resolves the full source range against the owning TextDocument",()=>{
  const procedure=textDocument("start: old\n");
  const contract=textDocument("title: 😀\r\ncapability: ca::sample.read\n");
  const start=contract.getText().indexOf("ca::sample.read");
  assert.notEqual(start,-1);
  assert.deepEqual(diagnosticSourcePosition(contract,{
    line:2,column:1,range:{start,end:start+"ca::sample.read".length}
  }),{line:1,character:12,exact:true});
  assert.notDeepEqual(diagnosticSourcePosition(procedure,{line:1}),{
    line:1,character:12,exact:true
  });
});

test("unavailable source ranges never fall back to an invented editor marker",()=>{
  const doc=textDocument("a: b\n");
  for(const range of [
    {start:-1,end:2},{start:0,end:999},{start:4,end:2},
    {start:0.5,end:3},{start:0,end:NaN}
  ]){
    assert.equal(diagnosticSourcePosition(doc,{line:1,range}),null);
  }
  assert.equal(diagnosticSourcePosition(doc,{code:"PACKAGE_FILE_MISSING"}),null);
});

test("real line/column hints are retained when no exact range exists",()=>{
  const doc=textDocument("one\r\nhello\n");
  assert.deepEqual(diagnosticSourcePosition(doc,{line:2,column:4}),
    {line:1,character:3,exact:false});
  assert.deepEqual(diagnosticSourcePosition(doc,{line:2,column:99}),
    {line:1,character:5,exact:false});
  assert.deepEqual(diagnosticSourcePosition(doc,{line:3}),
    {line:2,character:0,exact:false});
  assert.equal(diagnosticSourcePosition(doc,{line:0,column:1}),null);
});
