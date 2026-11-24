import test from 'node:test';
import assert from 'node:assert/strict';
import {zipPackage} from '../site/zip.mjs';
import {sha256,base64Bytes}
  from '../experiments/ide-host/vscode/src/dependency-snapshot.mjs';
import {decodeInterfacePackageZip}
  from '../experiments/ide-host/vscode/src/interface-package-zip.mjs';
import {projectLockedInterfaceCompletionHints}
  from '../experiments/ide-host/vscode/src/interface-schema-completion.mjs';
import {schemaArgumentCompletions}
  from '../language/schema-argument-completions.mjs';
import {schemaValuePathCompletions}
  from '../language/schema-value-path-completions.mjs';

const enc=new TextEncoder(),SCHEMA='urn:wtlab:input:v1',OUTPUT='urn:wtlab:output:v1';
const inputSchema={
  $schema:'https://json-schema.org/draft/2020-12/schema',
  $id:SCHEMA,type:'object',required:['supi','pduSessionId'],
  properties:{
    supi:{type:'string',description:'3GPP SUPI of the subject'},
    pduSessionId:{type:'integer',description:'PDU Session identity'},
    readMode:{type:'string',enum:['SUMMARY','DETAILED']},
    extra:{type:'boolean'}
  }
};
const outputSchema={
  $schema:'https://json-schema.org/draft/2020-12/schema',
  $id:OUTPUT,type:'object',properties:{status:{type:'string'}}
};
const catalog=[
  'apiVersion: connectionagent.io/toolcatalog/v1alpha4',
  'kind: ToolCatalog',
  'metadata:',
  '  owner: wtlab',
  'spec:',
  '  contracts:',
  '    - id: context.smf.session.read',
  '      kind: observation',
  '      effect: READ',
  '      queryContextSchema:',
  '        $ref: urn:wtlab:input:v1',
  '      outputSchema:',
  '        $ref: urn:wtlab:output:v1',
  '      ownerOutcomes: [SUCCEEDED, FAILED]',
  ''
].join('\n');
async function locked(overrides={}){
  const schema=JSON.stringify({...inputSchema,...overrides});
  const entries=[
    {path:'schemas/input.schema.json',text:schema},
    {path:'schemas/output.schema.json',text:JSON.stringify(outputSchema)},
    {path:'tool-catalog.yaml',text:catalog}
  ];
  const files=await Promise.all(entries.map(async item=>({
    path:item.path,sha256:await sha256(enc.encode(item.text))
  })));
  const manifest={
    apiVersion:'connectionagent.io/interface-package/v1alpha1',
    packageId:'urn:wtlab:interface',version:'1.0.0',
    publisher:'urn:wtlab:provider',
    languageTarget:'connectionagent.io/v1alpha5',
    dependencies:[],files,exports:[
      {kind:'Schema',id:SCHEMA,path:'schemas/input.schema.json'},
      {kind:'Schema',id:OUTPUT,path:'schemas/output.schema.json'},
      {kind:'CallableCatalog',id:'context.smf.session.read',path:'tool-catalog.yaml'}
    ]
  };
  const archive=zipPackage([{path:'package.json',text:JSON.stringify(manifest)},...entries]);
  const imported=await decodeInterfacePackageZip(archive);
  return {id:'ca-client',kind:'interface-package',
    files:imported.files.map(file=>({
      path:file.path,bytes:base64Bytes(file.bytes)
    }))};
}
function completion(source,hints,search='        '){
  const at=source.lastIndexOf(search,source.indexOf('      routes:'));
  assert.ok(at>=0,'fixture missing argument line');
  const offset=at+search.length;
  const line=source.slice(0,offset).split('\n').length-1;
  const lineStart=source.lastIndexOf('\n',offset-1)+1;
  const document={relativePath:'assurance/procedure.yaml',text:source};
  const snapshot={completeness:'complete',schemaCompletionHints:hints};
  return schemaArgumentCompletions(snapshot,document,source.slice(lineStart,offset),
    offset,lineStart,line);
}
const document=[
'start: read',
'nodes:',
'  read:',
'    observation:',
'      tool: ca-client::context.smf.session.read',
'      arguments:',
'        ',
'      routes:',
'        FAILED: FAILED',
''
].join('\n');
test('Schema imports reach current CA-SL argument completion (required first)',async()=>{
  const hints=projectLockedInterfaceCompletionHints(await locked());
  assert.equal(hints.length,1);
  assert.equal(hints[0].id,'ca-client::context.smf.session.read');
  assert.equal(hints[0].inputSchemaId,SCHEMA);
  const suggestions=completion(document,hints);
  assert.deepEqual(suggestions.map(item=>item.label),
    ['pduSessionId','supi','extra','readMode']);
  assert.equal(suggestions[0].kind,10);
  assert.match(suggestions[0].detail,/required .*integer/);
  assert.match(suggestions[1].documentation,/3GPP SUPI/);
  assert.match(suggestions[0].detail,/AUTH_NOT_CHECKED/);
  assert.equal(suggestions[0].textEdit.newText,'pduSessionId: ');
  assert.deepEqual(suggestions[0].textEdit.range.start,{line:6,character:8});
});
test('completed arguments suppress duplicates; enum values come from Schema',async()=>{
  const hints=projectLockedInterfaceCompletionHints(await locked());
  const withKey=document.replace('        \n','        supi: context.supi\n        \n');
  const keys=completion(withKey,hints);
  assert.ok(keys.some(s=>s.label==='pduSessionId'));
  assert.ok(!keys.some(s=>s.label==='supi'));
  const enumText=document.replace('        \n','        readMode: D\n');
  const values=completion(enumText,hints,'        readMode: D');
  assert.deepEqual(values.map(v=>v.label),['DETAILED']);
  assert.equal(values[0].textEdit.newText,'"DETAILED"');
});
test('wrong dialect or absent Tool does not invent input fields',async()=>{
  await assert.rejects(
    ()=>locked({$schema:'https://json-schema.org/draft/2019-09/schema'}),
    /published Schema ID or dialect mismatch/);
  const hints=projectLockedInterfaceCompletionHints(await locked());
  const unrelated=document.replace('ca-client::context.smf.session.read',
    'ca-client::other.read');
  assert.equal(completion(unrelated,hints),null);
  const changedStage=document.replace('observation:', 'operation:');
  assert.equal(completion(changedStage,hints),null);
  const absent=completion(document,[]);
  assert.equal(absent,null);
});


const requestSchema=[
  '$schema: https://json-schema.org/draft/2020-12/schema',
  'type: object',
  'properties:',
  '  dnn: {type: string, description: Data Network Name}',
  '  sNssai:',
  '    type: object',
  '    properties:',
  '      sst: {type: integer, description: Slice/Service Type}',
  '      sd: {type: string}',
  ''
].join('\n');
const contractSource='requestSchema: schemas/request.schema.yaml\n';
function pathCompletion(text,hints=[],cursorText){
  const index=text.indexOf(cursorText);
  assert.ok(index>=0,'Expected exact cursor fixture: '+cursorText);
  const offset=index+cursorText.length,line=text.slice(0,offset).split('\n').length-1;
  const lineStart=text.lastIndexOf('\n',offset-1)+1;
  return schemaValuePathCompletions({
    completeness:'complete',schemaCompletionHints:hints,documents:[
      {relativePath:'assurance/contract.yaml',text:contractSource,version:1},
      {relativePath:'schemas/request.schema.yaml',text:requestSchema,version:1}
    ]
  },{relativePath:'assurance/procedure.yaml',text},
  text.slice(lineStart,offset),offset,lineStart,line);
}
const pathProcedure=[
  'start: read',
  'nodes:',
  '  read:',
  '    observation:',
  '      tool: ca-client::context.smf.session.read',
  '      arguments:',
  '        supi: context.request.sNssai.',
  '      routes:',
  '        SUCCEEDED: update',
  '  update:',
  '    operation:',
  '      tool: ca-client::other.write',
  '      arguments:',
  '        payload: read.observation.output.',
  '      routes:',
  '        FAILED: FAILED',
  ''
].join('\n');
test('Request YAML Schema completes nested context.request fields and exact source replacement',()=>{
  const suggestions=pathCompletion(pathProcedure,[],
    '        supi: context.request.sNssai.');
  assert.deepEqual(suggestions.map(x=>x.label),['sd','sst']);
  assert.equal(suggestions[1].textEdit.newText,'sst');
  assert.equal(suggestions[1].textEdit.range.start.character,
    '        supi: context.request.sNssai.'.length);
  assert.match(suggestions[1].detail,/AUTH_NOT_CHECKED/);
  const nested=pathProcedure.replace('context.request.sNssai.','context.request.');
  assert.deepEqual(pathCompletion(nested,[],
    '        supi: context.request.').map(x=>x.label),['dnn','sNssai']);
});
test('imported published output Schema offers only dominating producer fields',async()=>{
  const hints=projectLockedInterfaceCompletionHints(await locked());
  const outputs=[{name:'context',type:'object',description:'Read result',
    children:[{name:'supi',type:'string',description:'SUPI',children:null}]}];
  const enriched=hints.map(h=>({...h,outputProperties:outputs}));
  const completions=pathCompletion(pathProcedure,enriched,
    '        payload: read.observation.output.');
  assert.deepEqual(completions.map(x=>x.label),['context']);
  const nested=pathProcedure.replace('payload: read.observation.output.',
    'payload: read.observation.output.context.');
  assert.deepEqual(pathCompletion(nested,enriched,
    '        payload: read.observation.output.context.').map(x=>x.label),['supi']);
  const bypass=pathProcedure
    .replace('start: read','start: alternative')
    .replace('  read:\n','  alternative:\n    observation:\n      tool: ca-client::context.smf.session.read\n      routes:\n        SUCCEEDED: update\n  read:\n');
  assert.deepEqual(pathCompletion(bypass,enriched,
    '        payload: read.observation.output.'),[]);
  const misplaced=pathProcedure.replace('read.observation.output.','update.operation.output.');
  assert.deepEqual(pathCompletion(misplaced,enriched,
    '        payload: update.operation.output.'),[]);
});
test('an unverified or absent Schema never guesses context/output fields',()=>{
  const unsupported=requestSchema.replace('draft/2020-12','draft/2019-09');
  const value=pathProcedure;
  const hint=[{id:'ca-client::context.smf.session.read',kind:'observation',
    trust:'DECLARATION_ONLY',outputProperties:[{name:'status',type:'string',children:null}]}];
  assert.deepEqual(pathCompletion(value,[], '        payload: read.observation.output.'),[]);
  assert.deepEqual(schemaValuePathCompletions({
    completeness:'complete',schemaCompletionHints:hint,
    documents:[
      {relativePath:'assurance/contract.yaml',text:contractSource},
      {relativePath:'schemas/request.schema.yaml',text:unsupported}
    ]
  },{relativePath:'assurance/procedure.yaml',text:value},
  '        supi: context.request.sNssai.',
  value.indexOf('        supi: context.request.sNssai.')+
    '        supi: context.request.sNssai.'.length,
  value.lastIndexOf('\n',value.indexOf('        supi: context.request.sNssai.'))+1,
  6),[]);
});
