// Safe, browser-native reader for an already published Interface Package ZIP.
// The frozen Compiler contract, not Studio, remains the authority for linking.
// This module validates ZIP integrity + manifest/file closure; it never converts
// source YAML, rewrites package.json, or infers Owner/Runtime authorization.
import {sha256,validateSnapshotPath} from './dependency-snapshot.mjs';

const MAX_ZIP=24*1024*1024,MAX_FILES=512,MAX_FILE=2*1024*1024;
const MAX_TOTAL=16*1024*1024;
const decoder=new TextDecoder('utf-8',{fatal:true});
const DIGEST=/^sha256:[a-f0-9]{64}$/;
const VERSION='connectionagent.io/interface-package/v1alpha1';
const LANGUAGE='connectionagent.io/v1alpha5';
const crcTable=Uint32Array.from({length:256},(_,i)=>{
  let n=i;
  for(let j=0;j<8;j++)n=n&1?0xedb88320^(n>>>1):n>>>1;
  return n>>>0;
});
function crc32(bytes){
  let c=0xffffffff;
  for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);
  return (c^0xffffffff)>>>0;
}
function fail(message){throw Error('Interface Package ZIP BLOCKED: '+message);}
function read16(view,p){if(p<0||p+2>view.byteLength)fail('truncated ZIP');return view.getUint16(p,true);}
function read32(view,p){if(p<0||p+4>view.byteLength)fail('truncated ZIP');return view.getUint32(p,true);}
function bytesAt(bytes,p,n){
  if(!Number.isSafeInteger(p)||!Number.isSafeInteger(n)||p<0||n<0||
     p+n>bytes.length)fail('ZIP entry extends beyond archive');
  return bytes.subarray(p,p+n);
}
function pathname(bytes){
  let path;
  try{path=decoder.decode(bytes);}catch{fail('invalid UTF-8 ZIP entry name');}
  try{validateSnapshotPath(path);}catch{fail('unsafe ZIP entry path');}
  if(path==='manifest.json')fail('reserved snapshot manifest name');
  return path;
}
async function inflate(raw,method,size){
  if(method===0){
    if(raw.length!==size)fail('stored ZIP size mismatch');
    return raw.slice();
  }
  if(method!==8)fail('unsupported ZIP compression');
  if(typeof DecompressionStream!=='function')fail('deflate-raw decoder unavailable');
  let reader;
  try{
    const stream=new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    reader=stream.getReader();
    const chunks=[];let total=0;
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      total+=value.byteLength;
      if(total>size||total>MAX_FILE){await reader.cancel();fail('decompressed ZIP size exceeds declared limit');}
      chunks.push(value);
    }
    if(total!==size)fail('decompressed ZIP size mismatch');
    const out=new Uint8Array(total);let off=0;
    for(const chunk of chunks){out.set(chunk,off);off+=chunk.byteLength;}
    return out;
  }catch(e){fail('ZIP deflate failed: '+String(e.message??e));}
  finally{try{reader?.releaseLock();}catch{}}
}
export async function decodeInterfacePackageZip(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length<22||bytes.length>MAX_ZIP)
    fail('invalid or oversized ZIP');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let eocd=-1;
  for(let pos=bytes.length-22;pos>=Math.max(0,bytes.length-22-65535);pos--){
    if(read32(view,pos)===0x06054b50&&pos+22+read16(view,pos+20)===bytes.length){
      eocd=pos;break;
    }
  }
  if(eocd<0)fail('missing ZIP end record');
  if(read16(view,eocd+4)!==0||read16(view,eocd+6)!==0||
     read16(view,eocd+8)!==read16(view,eocd+10))
    fail('multidisk ZIP unsupported');
  const count=read16(view,eocd+10),cdSize=read32(view,eocd+12);
  const cdStart=read32(view,eocd+16);
  if(!count||count>MAX_FILES||count===65535||cdSize===0xffffffff||
     cdStart===0xffffffff||cdStart+cdSize!==eocd)
    fail('invalid central directory or ZIP64');
  const entries=[],names=new Set(),ranges=[];
  let p=cdStart,total=0;
  for(let i=0;i<count;i++){
    if(read32(view,p)!==0x02014b50||p+46>eocd)fail('invalid central directory entry');
    const flags=read16(view,p+8),method=read16(view,p+10);
    const checksum=read32(view,p+16),compressed=read32(view,p+20),size=read32(view,p+24);
    const nameLen=read16(view,p+28),extra=read16(view,p+30),comment=read16(view,p+32);
    const external=read32(view,p+38),localOffset=read32(view,p+42);
    const next=p+46+nameLen+extra+comment;
    if(next>eocd||!(flags===0||flags===0x8||flags===0x800||flags===0x808)||
       ![0,8].includes(method)||size>MAX_FILE||compressed>MAX_ZIP)
      fail('unsafe ZIP flags, method or entry size');
    const unixMode=(external>>>16)&0xf000;
    if(unixMode!==0&&unixMode!==0x8000)fail('ZIP symlinks and special files unsupported');
    const path=pathname(bytesAt(bytes,p+46,nameLen));
    if(names.has(path.toLowerCase()))fail('duplicate or case-colliding ZIP path');
    names.add(path.toLowerCase());
    total+=size;
    if(total>MAX_TOTAL)fail('ZIP expanded data exceeds limit');
    if(localOffset+30>cdStart||read32(view,localOffset)!==0x04034b50)
      fail('missing ZIP local header');
    if(read16(view,localOffset+6)!==flags||read16(view,localOffset+8)!==method)
      fail('ZIP central/local header mismatch');
    const localNameLen=read16(view,localOffset+26),localExtra=read16(view,localOffset+28);
    const localName=pathname(bytesAt(bytes,localOffset+30,localNameLen));
    if(localName!==path)fail('ZIP local filename mismatch');
    const start=localOffset+30+localNameLen+localExtra;
    const end=start+compressed;
    if(end>cdStart||start<localOffset+30)fail('ZIP data overlaps directory');
    ranges.push([localOffset,end]);
    entries.push({path,compressed:bytesAt(bytes,start,compressed),
      method,size,checksum});
    p=next;
  }
  if(p!==eocd)fail('central directory trailing bytes');
  ranges.sort((a,b)=>a[0]-b[0]);
  for(let i=1;i<ranges.length;i++)
    if(ranges[i][0]<ranges[i-1][1])fail('overlapping ZIP local entries');
  const files=[];
  for(const entry of entries){
    const expanded=await inflate(entry.compressed,entry.method,entry.size);
    if(crc32(expanded)!==entry.checksum)fail('ZIP CRC mismatch: '+entry.path);
    files.push({path:entry.path,bytes:expanded});
  }
  return verifyInterfacePackageFiles(files);
}
export async function verifyInterfacePackageFiles(files){
  if(!Array.isArray(files)||files.length<2)fail('empty Interface Package');
  const map=new Map();
  for(const file of files){
    if(typeof file?.path!=='string'||!(file.bytes instanceof Uint8Array))
      fail('invalid package file');
    try{validateSnapshotPath(file.path);}catch{fail('unsafe package file path');}
    if(map.has(file.path.toLowerCase()))fail('duplicate package file');
    map.set(file.path.toLowerCase(),file);
  }
  const manifestFile=map.get('package.json');
  if(!manifestFile)fail('root package.json required');
  let manifest;
  try{manifest=JSON.parse(decoder.decode(manifestFile.bytes));}
  catch{fail('invalid package.json UTF-8/JSON');}
  if(!manifest||Array.isArray(manifest)||manifest.apiVersion!==VERSION||
     manifest.languageTarget!==LANGUAGE||
     typeof manifest.packageId!=='string'||!manifest.packageId||
     typeof manifest.version!=='string'||!manifest.version||
     typeof manifest.publisher!=='string'||!manifest.publisher||
     !Array.isArray(manifest.files)||!Array.isArray(manifest.exports)||
     !Array.isArray(manifest.dependencies))
    fail('unsupported or incomplete frozen Interface Package manifest');
  const manifestPaths=new Set();
  for(const item of manifest.files){
    if(typeof item?.path!=='string'||!DIGEST.test(item.sha256??'')||
       item.path==='package.json'||manifestPaths.has(item.path.toLowerCase()))
      fail('malformed or duplicated manifest file');
    manifestPaths.add(item.path.toLowerCase());
    const source=map.get(item.path.toLowerCase());
    if(!source||source.path!==item.path)fail('missing or case-mismatched manifest file: '+item.path);
    if(await sha256(source.bytes)!==item.sha256)fail('manifest digest mismatch: '+item.path);
  }
  if(manifestPaths.size!==files.length-1)fail('unlisted file in Interface Package');
  const identities=new Set();
  for(const item of manifest.exports){
    if(typeof item?.kind!=='string'||typeof item.id!=='string'||!item.id||
       typeof item.path!=='string'||!manifestPaths.has(item.path.toLowerCase()))
      fail('invalid manifest export');
    const key=item.kind+'\u0000'+item.id;
    if(identities.has(key))fail('duplicate manifest export identity');
    identities.add(key);
    if(item.kind==='Schema'){
      const file=map.get(item.path.toLowerCase());
      if(!/\.schema\.json$/i.test(item.path))fail('published Schema must be JSON');
      let parsed;
      try{parsed=JSON.parse(decoder.decode(file.bytes));}catch{fail('invalid published Schema JSON');}
      if(!parsed||Array.isArray(parsed)||typeof parsed!=='object'||
         parsed.$id!==item.id||
         parsed.$schema!=='https://json-schema.org/draft/2020-12/schema')
        fail('published Schema ID or dialect mismatch: '+item.id);
    }
  }
  return {manifest,files:files.map(x=>({path:x.path,bytes:x.bytes.slice()}))};
}
