import test from 'node:test';
import assert from 'node:assert/strict';
import {openSourceViewPair,sourceViewType,hasSourceViewPair,forgetSourceViewPair}
  from '../vscode/src/source-view-pair.mjs';

const uri=path=>({path,toString(){return 'file://'+path;}});
const vscodeApi=()=>{
  const calls=[],shown=[];
  class Position{constructor(line,character){this.line=line;this.character=character;}}
  class Range{constructor(start,end){this.start=start;this.end=end;}}
  class Selection extends Range{}
  const vscode={
    ViewColumn:{One:1,Two:2,Beside:-2},
    Position,Range,Selection,
    TextEditorRevealType:{InCenter:1},
    env:{uriScheme:'vscode'},
    commands:{executeCommand:async(...args)=>{calls.push(args);}},
    workspace:{openTextDocument:async uri=>({uri,lineCount:20})},
    window:{activeTextEditor:null,visibleTextEditors:[],showTextDocument:async(document,options)=>{shown.push({document,options});return null;}}
  };
  return {vscode,calls,shown};
};

test('all supported YAML visual editors have one explicit Source/Visual mapping',()=>{
  assert.equal(sourceViewType(uri('/p/assurance/procedure.yaml')),'skillStudio.procedurePreview');
  assert.equal(sourceViewType(uri('/p/assurance/contract.yaml')),'skillStudio.contractPreview');
  assert.equal(sourceViewType(uri('/p/assurance/predicates.yaml')),'skillStudio.predicatePreview');
  assert.equal(sourceViewType(uri('/p/schemas/request.schema.yaml')),'skillStudio.schemaPreview');
  assert.equal(sourceViewType(uri('/p/schemas/nested/request.schema.yaml')),null);
  assert.equal(sourceViewType(uri('/p/scripts/run.py')),null);
  assert.equal(sourceViewType(uri('/p/assurance/other.yaml')),null);
});

test('Source-first pairing opens Visual in column two and native Source in column one',async()=>{
  const {vscode,calls,shown}=vscodeApi();
  const target=uri('/p/assurance/contract.yaml');
  const result=await openSourceViewPair(vscode,target,{line:7});
  assert.equal(calls.length,2);
  assert.deepEqual(calls.map(call=>[call[0],call[2]]),[
    ['vscode.openWith','default'],
    ['vscode.openWith','skillStudio.contractPreview']
  ]);
  assert.equal(calls[0][3].viewColumn,1);
  assert.equal(calls[0][3].preserveFocus,false);
  assert.equal(calls[0][3].preview,false);
  assert.equal(calls[0][3].selection.start.line,6);
  assert.equal(calls[0][3].selection.end.line,6);
  assert.deepEqual(calls[1][3],{viewColumn:2,preserveFocus:true,preview:false});
  assert.equal(shown.length,0,'supported YAML must use the native Source opener, not TextDocument RPC');
  assert.equal(result.line,7);
  assert.equal(result.sourceColumn,1);
  assert.equal(result.visualColumn,2);
  assert.equal(hasSourceViewPair(target),true);
  forgetSourceViewPair(target);
  assert.equal(hasSourceViewPair(target),false);
});

test('opening a Source already in column two moves it before creating Visual',async()=>{
  const {vscode,calls,shown}=vscodeApi();
  const target=uri('/p/assurance/predicates.yaml');
  vscode.window.activeTextEditor={document:{uri:target},viewColumn:2};
  await openSourceViewPair(vscode,target);
  assert.deepEqual(calls.map(call=>call[0]),[
    'workbench.action.moveEditorToFirstGroup',
    'vscode.openWith',
    'vscode.openWith'
  ]);
  assert.equal(calls[1][2],'default');
  assert.equal(calls[1][3].viewColumn,1);
  assert.equal(calls[2][2],'skillStudio.predicatePreview');
  assert.equal(calls[2][3].viewColumn,2);
  assert.equal(shown.length,0);
  forgetSourceViewPair(target);
});

test('unsupported YAML remains a plain Source editor without an empty visual',async()=>{
  const {vscode,calls,shown}=vscodeApi();
  const target=uri('/p/assurance/custom.yaml');
  const result=await openSourceViewPair(vscode,target,{line:999});
  assert.equal(calls.length,0);
  assert.equal(shown.length,1);
  assert.equal(shown[0].options.viewColumn,1);
  assert.equal(result.viewType,null);
  assert.equal(result.visualColumn,null);
  assert.equal(result.line,1);
  assert.equal(hasSourceViewPair(target),false);
});
