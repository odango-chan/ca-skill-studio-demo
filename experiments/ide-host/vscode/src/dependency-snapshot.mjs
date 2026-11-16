// Exact SHA-256 framing from ca-skill-compiler v0.1 contract PR #4.
// No network I/O, Tool execution or Node-only imports.
const enc=new TextEncoder();
const PATH_SEGMENT=/^[A-Za-z0-9_.-]+$/;
const MAX_FILE=2097152,MAX_FILES=512,MAX_TOTAL=16777216;
const hex=bytes=>[...bytes].map(x=>x.toString(16).padStart(2,"0")).join("");
const digest=async bytes=>new Uint8Array(await crypto.subtle.digest("SHA-256",bytes));
export const sha256=async bytes=>"sha256:"+hex(await digest(bytes));
export function validateSnapshotPath(path){
  if(typeof path!=="string"||path.length>240||path!==path.normalize("NFC")||
    path.startsWith("/")||path.includes("\\")||path.includes(":")||
    !path.split("/").every(segment=>PATH_SEGMENT.test(segment)&&
      segment!=="."&&segment!==".."))
    throw Error("Invalid Compiler v0.1 snapshot path");
  return path;
}
export function base64Bytes(bytes){
  if(!(bytes instanceof Uint8Array))throw Error("Expected bytes");
  let value="";
  for(let i=0;i<bytes.length;i+=8192)
    value+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(value);
}
export function decodeBase64(value){
  if(typeof value!=="string"||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
    throw Error("Invalid snapshot file base64");
  return Uint8Array.from(atob(value),c=>c.charCodeAt(0));
}
function sortedFiles(files){
  if(!Array.isArray(files)||!files.length||files.length>MAX_FILES)
    throw Error("Invalid snapshot file count");
  const seen=new Set();
  let total=0;
  const entries=files.map(file=>{
    const path=validateSnapshotPath(file.path);
    if(!(file.bytes instanceof Uint8Array)||file.bytes.length>MAX_FILE)
      throw Error("Snapshot file too large or not byte content");
    total+=file.bytes.length;
    if(total>MAX_TOTAL)throw Error("Snapshot aggregate exceeds Compiler limit");
    if(seen.has(path))throw Error("Duplicate snapshot path");
    seen.add(path);
    return {path,bytes:file.bytes};
  });
  entries.sort((a,b)=>{
    const x=enc.encode(a.path),y=enc.encode(b.path);
    for(let i=0;i<Math.min(x.length,y.length);i++)
      if(x[i]!==y[i])return x[i]-y[i];
    return x.length-y.length;
  });
  return entries;
}
function u32(number){
  const b=new Uint8Array(4);
  new DataView(b.buffer).setUint32(0,number,false);
  return b;
}
function u64(number){
  const b=new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0,BigInt(number),false);
  return b;
}
function concat(parts){
  const size=parts.reduce((n,b)=>n+b.length,0),result=new Uint8Array(size);
  let index=0;
  for(const part of parts){result.set(part,index);index+=part.length;}
  return result;
}
export async function calculateSnapshot(files){
  const ordered=sortedFiles(files);
  const parts=[enc.encode("skillc/snapshot/v1"),new Uint8Array([0]),u32(ordered.length)];
  const lockFiles=[],wireFiles=[];
  for(const file of ordered){
    const name=enc.encode(file.path),hash=await digest(file.bytes);
    parts.push(u32(name.length),name,u64(file.bytes.length),hash);
    lockFiles.push({path:file.path,size:file.bytes.length,sha256:"sha256:"+hex(hash)});
    wireFiles.push({path:file.path,bytes:base64Bytes(file.bytes)});
  }
  return {snapshotDigest:await sha256(concat(parts)),files:lockFiles,
    wireFiles};
}
export async function verifyLockedFiles(lockEntry,wireFiles){
  if(!lockEntry||!Array.isArray(lockEntry.files))
    throw Error("Missing dependency lock metadata");
  const input=wireFiles.map(file=>({path:file.path,bytes:decodeBase64(file.bytes)}));
  const actual=await calculateSnapshot(input);
  if(actual.snapshotDigest!==lockEntry.snapshotDigest||
     JSON.stringify(actual.files)!==JSON.stringify(lockEntry.files))
    throw Error("Pinned dependency snapshot digest or file metadata mismatch");
  return {id:lockEntry.id,kind:lockEntry.kind,
    snapshotDigest:actual.snapshotDigest,files:actual.wireFiles};
}
// RFC 8785 compatible JCS for JSON data (reject unsupported JSON values).
export function canonicalJson(value){
  if(value===null||typeof value==="boolean"||typeof value==="string")
    return JSON.stringify(value);
  if(typeof value==="number"&&Number.isFinite(value))
    return JSON.stringify(value);
  if(Array.isArray(value))return "["+value.map(canonicalJson).join(",")+"]";
  if(value&&typeof value==="object"&&Object.getPrototypeOf(value)===Object.prototype)
    return "{"+Object.keys(value).sort().map(key=>
      JSON.stringify(key)+":"+canonicalJson(value[key])).join(",")+"}";
  throw Error("Non-JSON value cannot enter canonical Tool Contract");
}
