import test from "node:test";
import assert from "node:assert/strict";
import {buildPackageZip,bytesToBase64} from "../site/package-zip-export.mjs";

const encoder=new TextEncoder(),decoder=new TextDecoder();
function localEntries(bytes){
  const entries=new Map();let offset=0;
  while(offset+4<=bytes.length&&new DataView(bytes.buffer,bytes.byteOffset+offset,4).getUint32(0,true)===0x04034b50){
    const view=new DataView(bytes.buffer,bytes.byteOffset+offset);
    const method=view.getUint16(8,true),compressed=view.getUint32(18,true);
    const nameLength=view.getUint16(26,true),extraLength=view.getUint16(28,true);
    assert.equal(method,0,"Package ZIP uses the dependency-free STORE method");
    const nameStart=offset+30,name=decoder.decode(bytes.subarray(nameStart,nameStart+nameLength));
    const dataStart=nameStart+nameLength+extraLength;
    entries.set(name,bytes.slice(dataStart,dataStart+compressed));
    offset=dataStart+compressed;
  }
  assert.ok(entries.size>0,"ZIP local records must be present");
  return entries;
}

test("Package ZIP preserves untouched bytes, opaque assets and unsaved TextDocument contents",async()=>{
  const originalSkill=Uint8Array.from([0xef,0xbb,0xbf,...encoder.encode("# Demo\n")]);
  const originalProcedure=encoder.encode("version: 1\n");
  const opaque=Uint8Array.from([0,255,17,34,128]);
  const result=await buildPackageZip({
    name:"demo",
    files:[
      {path:"SKILL.md",bytes:originalSkill},
      {path:"assurance/procedure.yaml",bytes:originalProcedure},
      {path:"assets/logo.bin",bytes:opaque}
    ],
    currentTextByPath:new Map([["assurance/procedure.yaml","version: 2\n"]])
  });
  assert.equal(result.filename,"demo.zip");
  assert.equal(result.fileCount,3);
  assert.equal(result.opaqueCount,1);
  const entries=localEntries(result.bytes);
  assert.deepEqual([...entries.keys()],[
    "SKILL.md","assurance/procedure.yaml","assets/logo.bin"
  ]);
  assert.deepEqual(entries.get("SKILL.md"),originalSkill,"untouched UTF-8 BOM bytes stay exact");
  assert.deepEqual(entries.get("assurance/procedure.yaml"),encoder.encode("version: 2\n"),
    "unsaved native Source wins over the on-disk snapshot");
  assert.deepEqual(entries.get("assets/logo.bin"),opaque,"opaque bytes stay exact");
});

test("Package ZIP rejects traversal, missing SKILL.md and edits to opaque files",async()=>{
  const bytes=encoder.encode("ok");
  await assert.rejects(()=>buildPackageZip({name:"demo",files:[
    {path:"../SKILL.md",bytes}
  ]}),/安全|有效|路径|SKILL/i);
  await assert.rejects(()=>buildPackageZip({name:"demo",files:[
    {path:"README.md",bytes}
  ]}),/缺少根 SKILL\.md/);
  await assert.rejects(()=>buildPackageZip({name:"demo",files:[
    {path:"SKILL.md",bytes},{path:"assets/logo.bin",bytes}
  ],currentTextByPath:new Map([["assets/logo.bin","not binary"]])}),/not an editable Package file/);
});

test("Package ZIP applies case-insensitive path collision and size bounds",async()=>{
  const bytes=encoder.encode("x");
  await assert.rejects(()=>buildPackageZip({name:"demo",files:[
    {path:"SKILL.md",bytes},{path:"skill.md",bytes}
  ]}),/重复|大小写冲突/);
  await assert.rejects(()=>buildPackageZip({name:"demo",files:[
    {path:"SKILL.md",bytes:new Uint8Array(1024*1024+1)}
  ]}),/单文件超出/);
});

test("extension message Base64 encoder round-trips bounded binary data",()=>{
  const bytes=Uint8Array.from({length:65539},(_,i)=>(i*31)&255);
  assert.deepEqual(Buffer.from(bytesToBase64(bytes),"base64"),Buffer.from(bytes));
  assert.equal(bytesToBase64(new Uint8Array()),"");
});
