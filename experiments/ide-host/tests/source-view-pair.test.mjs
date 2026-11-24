import test from 'node:test';
import assert from 'node:assert/strict';
import {openSourceViewPair,sourceViewType,hasSourceViewPair,forgetSourceViewPair}
  from '../vscode/src/source-view-pair.mjs';

const uri=path=>({path,toString(){return 'file://'+path;}});
const vscodeApi=()=>{
  const calls=[];
  class Position{constructor(line,character){this.line=line;this.character=character;}}
  class Range{constructor(start,end){this.start=start;this.end=end;}}
  const vscode={
    ViewColumn:{One:1,Two:2,Beside:-2},
    Position,Range,
    env:{uriScheme:'vscode'},
    commands:{executeCommand:async(...args)=>{calls.push(args);}},
    workspace:{openTextDocument:async uri=>({uri,lineCount:20})},
    window:{showErrorMessage:async()=>{}}
  };
  return {vscode,calls};
};

test('supported visual source files map to one Preview projection identity',()=>{
  assert.equal(sourceViewType(uri('/p/assurance/procedure.yaml')),'skillStudio.procedurePreview');
  assert.equal(sourceViewType(uri('/p/assurance/contract.yaml')),'skillStudio.contractPreview');
  assert.equal(sourceViewType(uri('/p/assurance/predicates.yaml')),'skillStudio.predicatePreview');
  assert.equal(sourceViewType(uri('/p/schemas/request.schema.yaml')),'skillStudio.schemaPreview');
  assert.equal(sourceViewType(uri('/p/schemas/nested/request.schema.yaml')),'skillStudio.schemaPreview');
  assert.equal(sourceViewType(uri('/p/locked/schemas/request.schema.json')),'skillStudio.schemaPreview');
  assert.equal(sourceViewType(uri('/p/scripts/run.py')),null);
  assert.equal(sourceViewType(uri('/p/assurance/other.yaml')),null);
});

test('opening a visualized Source file never creates a second editor group',async()=>{
  const {vscode,calls}=vscodeApi();
  const target=uri('/p/assurance/contract.yaml');
  const result=await openSourceViewPair(vscode,target,{line:7});
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],'vscode.openWith');
  assert.equal(calls[0][2],'default');
  assert.equal(calls[0][3].viewColumn,1);
  assert.equal(calls[0][3].preserveFocus,false);
  assert.equal(calls[0][3].preview,false);
  assert.equal(calls[0][3].selection.start.line,6);
  assert.equal(calls[0][3].selection.end.line,6);
  assert.equal(result.line,7);
  assert.equal(result.sourceColumn,1);
  assert.equal(result.visualColumn,null);
  assert.equal(result.viewType,'skillStudio.contractPreview');
  assert.equal(hasSourceViewPair(target),false);
  forgetSourceViewPair(target);
  assert.equal(hasSourceViewPair(target),false);
});

test('opening Source from another group targets the single Source group without split or move repair',async()=>{
  const {vscode,calls}=vscodeApi();
  const target=uri('/p/assurance/predicates.yaml');
  const result=await openSourceViewPair(vscode,target);
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],'vscode.openWith');
  assert.equal(calls[0][2],'default');
  assert.equal(calls[0][3].viewColumn,1);
  assert.equal(result.visualColumn,null);
});

test('unsupported files also remain in the one native Source group',async()=>{
  const {vscode,calls}=vscodeApi();
  const target=uri('/p/assurance/custom.yaml');
  const result=await openSourceViewPair(vscode,target,{line:999});
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],'vscode.openWith');
  assert.equal(calls[0][2],'default');
  assert.equal(calls[0][3].viewColumn,1);
  assert.equal(result.viewType,null);
  assert.equal(result.visualColumn,null);
  assert.equal(result.line,1);
  assert.equal(hasSourceViewPair(target),false);
});
