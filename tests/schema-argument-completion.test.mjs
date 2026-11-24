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
  assert.match(suggestions[0].detail,/NOT_AUTHORIZED/);
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
  assert.deepEqual(completion(unrelated,hints),[]);
  const changedStage=document.replace('observation:', 'operation:');
  assert.deepEqual(completion(changedStage,hints),[]);
  const absent=completion(document,[]);
  assert.equal(absent.length,0);
});
