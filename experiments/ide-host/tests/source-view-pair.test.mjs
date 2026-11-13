import test from 'node:test';
import assert from 'node:assert/strict';
import {pairCustomEditor,openSourceViewPair,sourceViewType} from '../vscode/src/source-view-pair.mjs';

const uri=path=>({path,toString(){return 'file://'+path;}});
const vscodeApi=()=>{
  const calls=[];
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
    window:{visibleTextEditors:[]}
  };
  return {vscode,calls};
};

test('all supported YAML visual editors have one explicit Source/Visual pairing',()=>{
  assert.equal(sourceViewType(uri('/p/assurance/procedure.yaml')),'skillStudio.procedurePreview');
  assert.equal(sourceViewType(uri('/p/assurance/contract.yaml')),'skillStudio.contractPreview');
  assert.equal(sourceViewType(uri('/p/assurance/predicates.yaml')),'skillStudio.predicatePreview');
  assert.equal(sourceViewType(uri('/p/schemas/request.schema.yaml')),'skillStudio.schemaPreview');
  assert.equal(sourceViewType(uri('/p/schemas/nested/request.schema.yaml')),null);
  assert.equal(sourceViewType(uri('/p/scripts/run.py')),null);
  assert.equal(sourceViewType(uri('/p/assurance/other.yaml')),null);
});

test('CustomEditor is placed right and its editable native Source is opened left',async()=>{
  const {vscode,calls}=vscodeApi(),events=[];
  const panel={reveal:(column,preserveFocus)=>events.push(['visual',column,preserveFocus])};
  const document={uri:uri('/p/assurance/contract.yaml')};
  await pairCustomEditor(vscode,panel,document);
  assert.deepEqual(events,[['visual',2,true]]);
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],'vscode.openWith');
  assert.equal(calls[0][1],document.uri);
  assert.equal(calls[0][2],'default');
  assert.deepEqual(calls[0][3],{viewColumn:1,preserveFocus:false,preview:false});
});

test('cross-file navigation opens the matching visual on the right and Source on the left',async()=>{
  const {vscode,calls}=vscodeApi();
  const target=uri('/p/schemas/request.schema.yaml');
  const result=await openSourceViewPair(vscode,target,{line:7});
  assert.equal(calls.length,2);
  assert.deepEqual(calls.map(call=>[call[0],call[2]]),[
    ['vscode.openWith','skillStudio.schemaPreview'],
    ['vscode.openWith','default']
  ]);
  assert.deepEqual(calls[0][3],{viewColumn:2,preserveFocus:false,preview:false});
  assert.equal(calls[1][3].viewColumn,1);
  assert.equal(calls[1][3].preserveFocus,false);
  assert.equal(calls[1][3].selection.start.line,6);
  assert.equal(calls[1][3].selection.end.line,6);
  assert.equal(result.line,7);
  assert.equal(result.sourceColumn,1);
  assert.equal(result.visualColumn,2);
});

test('unsupported YAML remains a plain Source editor without an empty visual',async()=>{
  const {vscode,calls}=vscodeApi();
  const target=uri('/p/assurance/custom.yaml');
  const result=await openSourceViewPair(vscode,target,{line:999});
  assert.equal(calls.length,1);
  assert.equal(calls[0][2],'default');
  assert.equal(calls[0][3].viewColumn,1);
  assert.equal(result.viewType,null);
  assert.equal(result.visualColumn,null);
  assert.equal(result.line,1);
});
