// Pinned public GitHub Release acquisition. Browser fetch is deliberately
// fail-closed when GitHub's asset redirect is blocked by CORS or authorization.
// No latest release resolution and no mutable branch or file fallback.
import {sha256} from './dependency-snapshot.mjs';
const MAX_ZIP=24*1024*1024;
const checksum=/^sha256:[a-f0-9]{64}$/;
const repoName=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const assetName=/^[A-Za-z0-9_.-]+\.zip$/;
const tagName=/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const fail=message=>{throw Error('Pinned Interface Release BLOCKED: '+message);};
export async function readPinnedInterfaceRelease({
  repository,tag,asset,expectedSha256,fetchImpl=globalThis.fetch
}={}){
  if(!repoName.test(repository??'')||!tagName.test(tag??'')||
     !assetName.test(asset??'')||!checksum.test(expectedSha256??''))
    fail('exact owner/repository, tag, ZIP asset and sha256 checksum are required');
  if(typeof fetchImpl!=='function')fail('browser network fetch unavailable');
  const base='https://api.github.com/repos/'+repository;
  const headers={Accept:'application/vnd.github+json',
    'X-GitHub-Api-Version':'2022-11-28'};
  let release;
  try{
    const response=await fetchImpl(base+'/releases/tags/'+encodeURIComponent(tag),
      {headers,mode:'cors',credentials:'omit'});
    if(!response.ok)fail('release lookup HTTP '+response.status);
    release=await response.json();
  }catch(error){fail('release metadata unavailable (network/CORS): '+String(error.message??error));}
  if(release.tag_name!==tag||release.draft||!Array.isArray(release.assets))
    fail('exact published release tag was not verified');
  const matches=release.assets.filter(item=>item.name===asset);
  if(matches.length!==1)fail('exact release asset missing or ambiguous');
  const selected=matches[0];
  if(!Number.isSafeInteger(selected.id)||!Number.isSafeInteger(selected.size)||
     selected.size<=0||selected.size>MAX_ZIP)
    fail('release asset size or identity invalid');
  // The REST asset endpoint is pinned by immutable numeric asset ID. GitHub
  // may redirect binary downloads; if the browser cannot follow, report BLOCKED.
  const expectedUrl=base+'/releases/assets/'+selected.id;
  if(selected.url!==expectedUrl)fail('release asset API origin mismatch');
  let bytes;
  try{
    const response=await fetchImpl(expectedUrl,{headers:{
      Accept:'application/octet-stream','X-GitHub-Api-Version':'2022-11-28'
    },credentials:'omit',mode:'cors',redirect:'follow'});
    if(!response.ok)fail('release asset download HTTP '+response.status);
    if((response.headers?.get('content-type')??'').toLowerCase().includes('json'))
      fail('GitHub returned asset metadata rather than ZIP bytes');
    bytes=new Uint8Array(await response.arrayBuffer());
  }catch(error){fail('exact release ZIP unavailable (network/CORS): '+String(error.message??error));}
  if(bytes.length!==selected.size||bytes.length>MAX_ZIP)
    fail('release asset length mismatch');
  if(await sha256(bytes)!==expectedSha256)
    fail('release asset SHA-256 differs from pinned checksum');
  return {bytes,source:{type:'interface-release',repository,tag,asset,
    expectedSha256,assetId:selected.id}};
}
