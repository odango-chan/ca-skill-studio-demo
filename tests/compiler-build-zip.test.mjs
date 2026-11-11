import test from "node:test";
import assert from "node:assert/strict";
import {zipPackage} from "../site/zip.mjs";
test("Compiler v0.1 ZIP export supports all 512 bounded output files",()=>{
  const files=Array.from({length:512},(_,i)=>({
    path:"generated/"+String(i).padStart(3,"0")+".txt",
    bytes:new TextEncoder().encode("file "+i)
  }));
  assert.throws(()=>zipPackage(files),/file count out of bounds/,
    "Classic Package ZIP default cap is not implicitly widened");
  const bytes=zipPackage(files,{maxFiles:512,maxFileBytes:2097152,
    maxTotalBytes:16777216});
  assert.ok(bytes.length>512*60);
  const eocd=bytes.byteLength-22,reader=new DataView(bytes.buffer);
  assert.equal(reader.getUint32(eocd,true),0x06054b50);
  assert.equal(reader.getUint16(eocd+10,true),512);
  assert.equal(reader.getUint16(eocd+8,true),512);
});
test("Compiler export keeps max aggregate and per-file size rejection",()=>{
  assert.throws(()=>zipPackage([{path:"generated/a",
    bytes:new Uint8Array(2097153)}],{maxFiles:512,maxFileBytes:2097152,
    maxTotalBytes:16777216}),/too large/);
  assert.throws(()=>zipPackage([{path:"../outside",
    bytes:new Uint8Array()}],{maxFiles:512,maxFileBytes:2097152,
    maxTotalBytes:16777216}),/Invalid ZIP/);
});
