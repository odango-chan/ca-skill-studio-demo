import test from "node:test";
import assert from "node:assert/strict";
import { toNativeCompletionItems } from "../experiments/ide-host/lsp-browser/client/src/native-completion-items.mjs";
import { toLspCompletionContext } from "../experiments/ide-host/lsp-browser/client/src/completion-context.mjs";

class Range {
  constructor(startLine,startCharacter,endLine,endCharacter) {
    this.start={line:startLine,character:startCharacter};
    this.end={line:endLine,character:endCharacter};
  }
}
class CompletionItem {
  constructor(label,kind) {
    this.label=label;
    this.kind=kind;
  }
}
class MarkdownString {
  constructor(value) { this.value=value; }
}

const vscode={Range,CompletionItem,MarkdownString};

test("native completion bridge converts LSP TextEdit into host Range and insertText",()=>{
  const result=toNativeCompletionItems({isIncomplete:false,items:[{
    label:"supi",kind:10,
    detail:"required · string · published Schema · AUTH_NOT_CHECKED",
    documentation:{kind:"markdown",value:"3GPP SUPI"},
    sortText:"0supi",
    textEdit:{
      range:{start:{line:31,character:8},end:{line:31,character:8}},
      newText:"supi: "
    }
  }]},vscode);
  assert.equal(result.length,1);
  assert.ok(result[0] instanceof CompletionItem);
  assert.equal(result[0].label,"supi");
  assert.equal(result[0].kind,10);
  assert.match(result[0].detail,/required/);
  assert.match(result[0].detail,/AUTH_NOT_CHECKED/);
  assert.equal(result[0].documentation.value,"3GPP SUPI");
  assert.equal(result[0].sortText,"0supi");
  assert.ok(result[0].range instanceof Range);
  assert.deepEqual(result[0].range.start,{line:31,character:8});
  assert.equal(result[0].insertText,"supi: ");
});

test("native completion bridge preserves InsertReplaceEdit ranges and snippets",()=>{
  class SnippetString {
    constructor(value) { this.value=value; }
  }
  const result=toNativeCompletionItems([
    {label:"field",kind:10,textEdit:{
      range:{
        insert:{start:{line:2,character:4},end:{line:2,character:4}},
        replace:{start:{line:2,character:0},end:{line:2,character:4}}
      },newText:"field: "
    }},
    {label:"value",kind:12,insertText:"${1:value}",insertTextFormat:2}
  ],{...vscode,SnippetString});
  assert.deepEqual(result[0].range.inserting.start,{line:2,character:4});
  assert.deepEqual(result[0].range.replacing.start,{line:2,character:0});
  assert.ok(result[1].insertText instanceof SnippetString);
  assert.equal(result[1].insertText.value,"${1:value}");
});

test("native completion bridge accepts an empty or absent CompletionList",()=>{
  assert.deepEqual(toNativeCompletionItems({items:[]},vscode),[]);
  assert.deepEqual(toNativeCompletionItems(null,vscode),[]);
});

test("native CompletionTriggerKind values are translated to the LSP enum",()=>{
  assert.deepEqual(toLspCompletionContext({triggerKind:0}),{triggerKind:1});
  assert.deepEqual(toLspCompletionContext({triggerKind:1}),{triggerKind:2});
  assert.deepEqual(toLspCompletionContext({triggerKind:2}),{triggerKind:3});
  assert.deepEqual(toLspCompletionContext({}),{triggerKind:1});
  assert.deepEqual(toLspCompletionContext({
    triggerKind:1,triggerCharacter:":"
  }),{triggerKind:2,triggerCharacter:":"});
});
