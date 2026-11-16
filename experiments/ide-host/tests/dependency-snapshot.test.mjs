import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {calculateSnapshot,verifyLockedFiles,decodeBase64,canonicalJson}
 from "../vscode/src/dependency-snapshot.mjs";
const vector=JSON.parse(readFileSync(
  "experiments/ide-host/tests/fixtures/compiler-v01-snapshot-vectors.json","utf8"));
test("Compiler v0.1 golden vectors reproduce exact raw-byte digest",async()=>{
  for(const fixture of vector.cases){
    const input=fixture.files.map(file=>({path:file.path,bytes:decodeBase64(file.bytes)}));
    const actual=await calculateSnapshot(input);
    assert.equal(actual.snapshotDigest,fixture.snapshotDigest,fixture.name);
    assert.deepEqual(actual.files,[...fixture.files].sort((a,b)=>a.path.localeCompare(b.path))
      .map(({path,size,sha256})=>({path,size,sha256})));
    assert.equal((await calculateSnapshot([...input].reverse())).snapshotDigest,fixture.snapshotDigest);
    assert.deepEqual(await verifyLockedFiles({
      id:"fixture",kind:"tool-catalog",snapshotDigest:fixture.snapshotDigest,
      files:actual.files
    },actual.wireFiles),{
      id:"fixture",kind:"tool-catalog",snapshotDigest:fixture.snapshotDigest,
      files:actual.wireFiles
    });
  }
});
test("one-byte tamper or missing content cannot satisfy lock",async()=>{
  const source=[{path:"tool-contract.json",bytes:new TextEncoder().encode("{}")}];
  const locked=await calculateSnapshot(source);
  const lock={id:"demo",kind:"tool-catalog",
    snapshotDigest:locked.snapshotDigest,files:locked.files};
  await assert.rejects(verifyLockedFiles(lock,[{path:"tool-contract.json",
    bytes:btoa('{"oops":1}')}]),/mismatch/);
  await assert.rejects(verifyLockedFiles(lock,[]),/count/);
});
test("unsafe and duplicated relative paths fail before digest",async()=>{
  for(const name of ["../x","/absolute","a//b","a\\b","C:/x","a/./b","a/%2e%2e/b"]){
    await assert.rejects(calculateSnapshot([{path:name,bytes:new Uint8Array()}]));
  }
  await assert.rejects(calculateSnapshot([
    {path:"a.json",bytes:new Uint8Array()},{path:"a.json",bytes:new Uint8Array()}
  ]),/Duplicate/);
});
test("canonical Tool Contract JSON ignores object insertion order",()=>{
  const a={apiVersion:"skillc.tool/v0.1",operations:[{id:"ping",inputSchema:{type:"object"},
    effect:{authority:"UNVERIFIED",classification:"UNKNOWN"}}]};
  const b={operations:[{effect:{classification:"UNKNOWN",authority:"UNVERIFIED"},
    inputSchema:{type:"object"},id:"ping"}],apiVersion:"skillc.tool/v0.1"};
  assert.equal(canonicalJson(a),canonicalJson(b));
});
