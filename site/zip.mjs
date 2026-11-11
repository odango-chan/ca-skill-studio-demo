// Minimal dependency-free ZIP writer for exporting the current browser working copy.
// Store-only (no compression), UTF-8 paths, CRC-32, fixed DOS date 1980-01-01.
// Never add sidecars inside the SKILL Package.
const encoder=new TextEncoder();
const table=Uint32Array.from({length:256},(_,i)=>{
  let c=i;
  for(let j=0;j<8;j++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);
  return c>>>0;
});
function crc32(bytes){
  let crc=0xffffffff;
  for(const b of bytes)crc=table[(crc^b)&255]^(crc>>>8);
  return (crc^0xffffffff)>>>0;
}
const u16=(b,p,n)=>{b[p]=n&255;b[p+1]=(n>>>8)&255;};
const u32=(b,p,n)=>{u16(b,p,n&65535);u16(b,p+2,n>>>16);};
function pathOK(path) {
  return typeof path==="string"&&path.length>0&&path.length<=240&&
    !path.startsWith("/")&&path.split("/").every(part=>part&&
    part!=="."&&part!==".."&&!/[\\\u0000-\u001f:<>|?*]/.test(part));
}
export function zipPackage(entries,{maxFiles=64,maxFileBytes=1024*1024,
  maxTotalBytes=8*1024*1024}={}){
  if(!Array.isArray(entries)||!entries.length||entries.length>maxFiles)
    throw new Error("Package ZIP file count out of bounds");
  let bytesTotal=0;
  const names=new Set(),records=[];
  for(const item of entries){
    const isText=typeof item?.text==="string";
    const opaque=item?.bytes instanceof Uint8Array?item.bytes:null;
    const original=item?.originalBytes instanceof Uint8Array?item.originalBytes:null;
    if(!item||!pathOK(item.path)||names.has(item.path)||
       (opaque&&isText)||(!isText&&!opaque))
      throw new Error("Invalid ZIP file path or content");
    names.add(item.path);
    const name=encoder.encode(item.path);
    // An untouched imported text file must be byte-exact (BOM and any
    // original UTF-8 encoding are preserved); edited text uses the Source.
    const data=opaque?opaque.slice():
      original&&item.text===item.originalText?original.slice():
      encoder.encode(item.text);
    if(name.length>65535 || data.length>maxFileBytes)throw new Error("ZIP file too large");
    bytesTotal+=data.length;
    if(bytesTotal>maxTotalBytes)throw new Error("ZIP payload too large");
    records.push({name,data,crc:crc32(data)});
  }
  const localSize=records.reduce((n,r)=>n+30+r.name.length+r.data.length,0);
  const cdSize=records.reduce((n,r)=>n+46+r.name.length,0);
  const out=new Uint8Array(localSize+cdSize+22);
  let off=0;
  for(const r of records){
    r.offset=off;
    u32(out,off,0x04034b50);u16(out,off+4,20);u16(out,off+6,0x800);
    u16(out,off+8,0);u16(out,off+10,0);u16(out,off+12,0x21);
    u32(out,off+14,r.crc);u32(out,off+18,r.data.length);u32(out,off+22,r.data.length);
    u16(out,off+26,r.name.length);u16(out,off+28,0);
    off+=30;out.set(r.name,off);off+=r.name.length;
    out.set(r.data,off);off+=r.data.length;
  }
  if(off!==localSize)throw new Error("ZIP local offset mismatch");
  for(const r of records){
    u32(out,off,0x02014b50);u16(out,off+4,20);u16(out,off+6,20);
    u16(out,off+8,0x800);u16(out,off+10,0);
    u16(out,off+12,0);u16(out,off+14,0x21);
    u32(out,off+16,r.crc);u32(out,off+20,r.data.length);u32(out,off+24,r.data.length);
    u16(out,off+28,r.name.length);u16(out,off+30,0);u16(out,off+32,0);
    u16(out,off+34,0);u16(out,off+36,0);u32(out,off+38,0);u32(out,off+42,r.offset);
    off+=46;out.set(r.name,off);off+=r.name.length;
  }
  if(off!==localSize+cdSize)throw new Error("ZIP central directory mismatch");
  u32(out,off,0x06054b50);u16(out,off+4,0);u16(out,off+6,0);
  u16(out,off+8,records.length);u16(out,off+10,records.length);
  u32(out,off+12,cdSize);u32(out,off+16,localSize);u16(out,off+20,0);
  return out;
}
