import test from 'node:test';
import assert from 'node:assert/strict';
import {zipPackage} from '../site/zip.mjs';
import {sha256} from '../experiments/ide-host/vscode/src/dependency-snapshot.mjs';
import {
  decodeInterfacePackageZip,verifyInterfacePackageFiles
} from '../experiments/ide-host/vscode/src/interface-package-zip.mjs';
import {isSkillSchema,localSchemaReference}
  from '../experiments/ide-host/vscode/src/schema-editor.mjs';
import {sourceViewType}
  from '../experiments/ide-host/vscode/src/source-view-pair.mjs';

const enc=new TextEncoder();
const SCHEMA_ID='urn:wtlab:test:input:v1';
const schema=JSON.stringify({
  $schema:'https://json-schema.org/draft/2020-12/schema',
  $id:SCHEMA_ID,type:'object',properties:{supi:{type:'string'}}
})+'\n';
const catalog='apiVersion: connectionagent.io/toolcatalog/v1alpha4\nkind: ToolCatalog\n';
async function fixture({wrongHash=false,wrongSchema=false,extra=false}={}){
  const entries=[
    {path:'schemas/input.schema.json',text:wrongSchema?schema.replace(SCHEMA_ID,'urn:wrong'):schema},
    {path:'tool-catalog.yaml',text:catalog}
  ];
  const files=[];
  for(const f of entries)files.push({path:f.path,sha256:wrongHash?
    'sha256:'+'0'.repeat(64):await sha256(enc.encode(f.text))});
  const manifest={
    apiVersion:'connectionagent.io/interface-package/v1alpha1',
    packageId:'wtlab.test',version:'1.0.0',
    languageTarget:'connectionagent.io/v1alpha5',publisher:'wtlab',
    dependencies:[],files,
    exports:[
      {kind:'Schema',id:SCHEMA_ID,path:'schemas/input.schema.json'},
      {kind:'CallableCatalog',id:'test.read',path:'tool-catalog.yaml'}
    ]
  };
  const all=[{path:'package.json',text:JSON.stringify(manifest)},...entries];
  if(extra)all.push({path:'unlisted.txt',text:'unexpected'});
  return {all,manifest,bytes:zipPackage(all)};
}
test('locked published JSON Schema is verified without rewriting bytes',async()=>{
  const input=await fixture(),decoded=await decodeInterfacePackageZip(input.bytes);
  assert.equal(decoded.manifest.packageId,'wtlab.test');
  assert.deepEqual(decoded.files.map(f=>f.path).sort(),
    input.all.map(f=>f.path).sort());
  assert.equal(new TextDecoder().decode(decoded.files.find(f=>
    f.path==='schemas/input.schema.json').bytes),schema);
});
test('ZIP validation rejects wrong checksum, malformed schema identity and extra files',async()=>{
  for(const options of [{wrongHash:true},{wrongSchema:true},{extra:true}]){
    const {bytes}=await fixture(options);
    await assert.rejects(()=>decodeInterfacePackageZip(bytes),
      /Interface Package ZIP BLOCKED/);
  }
});
test('ZIP CRC detects modified file contents',async()=>{
  const {bytes}=await fixture();
  const tampered=bytes.slice();
  const marker=enc.encode('wtlab.test');
  let where=-1;
  outer:for(let i=0;i<=tampered.length-marker.length;i++){
    for(let j=0;j<marker.length;j++)if(tampered[i+j]!==marker[j])continue outer;
    where=i;break;
  }
  assert.ok(where>=0);
  tampered[where]^=1;
  await assert.rejects(()=>decodeInterfacePackageZip(tampered),/CRC mismatch/);
});
test('manifest closure blocks duplicate exports and unsafe paths',async()=>{
  const {all,manifest}=await fixture();
  manifest.exports.push({...manifest.exports[0]});
  await assert.rejects(()=>verifyInterfacePackageFiles(all.map(f=>({
    path:f.path,bytes:enc.encode(f.path==='package.json'?JSON.stringify(manifest):f.text)
  }))),/duplicate manifest export/);
  const unsafe=all.map(f=>({path:f.path,bytes:enc.encode(f.text)}));
  unsafe[2].path='../catalog.yaml';
  await assert.rejects(()=>verifyInterfacePackageFiles(unsafe),/unsafe package file path/);
});
test('YAML authoring and published JSON Schema share Preview but preserve suffixes',()=>{
  const yaml='/p/skills/a/schemas/request.schema.yaml';
  const json='/p/locked/schemas/request.schema.json';
  assert.equal(isSkillSchema(yaml),true);
  assert.equal(isSkillSchema(json),true);
  assert.equal(sourceViewType({path:yaml}),'skillStudio.schemaPreview');
  assert.equal(sourceViewType({path:json}),'skillStudio.schemaPreview');
  const uri={path:json,with({path}){return {path};}};
  assert.equal(localSchemaReference(uri,'peer.schema.json#/$defs/input').uri.path,
    '/p/locked/schemas/peer.schema.json');
  assert.equal(localSchemaReference(uri,'https://example.org/schema.json'),null);
});
