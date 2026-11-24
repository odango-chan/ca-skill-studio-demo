import test from 'node:test';
import assert from 'node:assert/strict';
import {sha256} from '../experiments/ide-host/vscode/src/dependency-snapshot.mjs';
import {readPinnedInterfaceRelease}
  from '../experiments/ide-host/vscode/src/interface-release-acquisition.mjs';

const repository='odango-chan/ca-client-tools',tag='v1.1.0';
const asset='ca-client-tools_interface_1.1.0.zip';
const bytes=Uint8Array.from([80,75,3,4,0,1,2,3]);
const base='https://api.github.com/repos/'+repository;
const metadata={
  tag_name:tag,draft:false,assets:[
    {name:asset,id:12,size:bytes.length,url:base+'/releases/assets/12'}
  ]
};
const options=async(fetchImpl)=>({
  repository,tag,asset,expectedSha256:await sha256(bytes),fetchImpl
});
const mock=({release=metadata,payload=bytes,type='application/zip'}={})=>
  async url=>url.includes('/releases/tags/')
    ?new Response(JSON.stringify(release),{status:200,
      headers:{'content-type':'application/json'}})
    :new Response(payload,{status:200,headers:{'content-type':type}});

test('pinned GitHub release fetches the exact numeric asset and verifies archive bytes',async()=>{
  const called=[];
  const wrapped=async(url,init)=>{called.push({url,init});return mock()(url);};
  const result=await readPinnedInterfaceRelease(await options(wrapped));
  assert.deepEqual(result.bytes,bytes);
  assert.equal(result.source.tag,tag);
  assert.equal(result.source.assetId,12);
  assert.equal(called.length,2);
  assert.equal(called[1].url,base+'/releases/assets/12');
  assert.equal(called[1].init.headers.Accept,'application/octet-stream');
});
test('a wrong SHA-256 and JSON asset response cannot become a verified import',async()=>{
  await assert.rejects(()=>readPinnedInterfaceRelease({
    repository,tag,asset,expectedSha256:'sha256:'+'0'.repeat(64),
    fetchImpl:mock()
  }),/SHA-256 differs/);
  const jsonResponse=await options(mock({type:'application/json'}));
  await assert.rejects(()=>readPinnedInterfaceRelease(jsonResponse),/metadata rather than ZIP/);
});
test('reject latest, ambiguous published assets and oversized release claims',async()=>{
  const missing=await options(mock({release:{...metadata,assets:[]}}));
  await assert.rejects(()=>readPinnedInterfaceRelease(missing),/asset missing/);
  const ambiguous=await options(mock({release:{...metadata,
    assets:[...metadata.assets,...metadata.assets]}}));
  await assert.rejects(()=>readPinnedInterfaceRelease(ambiguous),/ambiguous/);
  const unsafe={...(await options(mock())),tag:'../latest'};
  await assert.rejects(()=>readPinnedInterfaceRelease(unsafe),/exact owner/);
  const oversized=await options(mock({release:{...metadata,
    assets:[{...metadata.assets[0],size:30000000}]}}));
  await assert.rejects(()=>readPinnedInterfaceRelease(oversized),
    /size or identity invalid/);
});
