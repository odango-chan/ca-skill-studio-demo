import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {calculateSnapshot,calculateCompilerDependencySnapshotDigest,
 verifyLockedFiles,decodeBase64,canonicalJson}
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
test("Compiler v2.1.0 Development snapshot digest matches frozen raw-byte framing",async()=>{
  const enc=new TextEncoder();
  const files=[
    {path:"schemas/a.schema.json",bytes:enc.encode("{\"type\":\"object\"}\n")},
    {path:"package.json",bytes:enc.encode("{\"apiVersion\":\"connectionagent.io/interface-package/v1alpha1\"}\n")}
  ];
  const expected="sha256:a399ffd6f6f2d54b4c73f276415172faeccb0bc653b9dc98bf42eb6523529423";
  assert.equal(await calculateCompilerDependencySnapshotDigest(files),expected);
  assert.equal(await calculateCompilerDependencySnapshotDigest([...files].reverse()),expected);
  const single=await calculateCompilerDependencySnapshotDigest([
    {path:"package.json",bytes:enc.encode("{}")}
  ]);
  assert.equal(single,"sha256:6a69101004ac585ded11fcc3370e8dc6723f9360966109e87dea293c6e223b7f");
  const tampered=files.map(file=>({path:file.path,bytes:file.bytes.slice()}));
  tampered[0].bytes[2]^=1;
  assert.notEqual(await calculateCompilerDependencySnapshotDigest(tampered),expected);
  // The old Studio cache digest remains a separate format and must not be
  // mistaken for the Compiler v2.1.0 Interface Package snapshot identity.
  assert.notEqual((await calculateSnapshot(files)).snapshotDigest,expected);
});
const compilerDevelopmentFixture=JSON.parse(readFileSync(
  "experiments/ide-host/tests/fixtures/compiler-v2.1-development-request.json","utf8"));
test("Compiler v2.1.0 published Development Build fixture confirms snapshot digests",async()=>{
  assert.equal(compilerDevelopmentFixture.apiVersion,
    "connectionagent.io/compiler-development-build-request/v1alpha1");
  assert.equal(compilerDevelopmentFixture.lock.apiVersion,
    "connectionagent.io/interface-dependency-lock/v1alpha1");
  assert.equal(compilerDevelopmentFixture.snapshots.length,3);
  for(const snapshot of compilerDevelopmentFixture.snapshots){
    const files=snapshot.files.map(file=>({
      path:file.path,bytes:decodeBase64(file.bytes)
    }));
    assert.equal(await calculateCompilerDependencySnapshotDigest(files),
      snapshot.key.snapshotDigest,snapshot.key.packageId);
  }
});
test("canonical Tool Contract JSON ignores object insertion order",()=>{
  const a={apiVersion:"skillc.tool/v0.1",operations:[{id:"ping",inputSchema:{type:"object"},
    effect:{authority:"UNVERIFIED",classification:"UNKNOWN"}}]};
  const b={operations:[{effect:{classification:"UNKNOWN",authority:"UNVERIFIED"},
    inputSchema:{type:"object"},id:"ping"}],apiVersion:"skillc.tool/v0.1"};
  assert.equal(canonicalJson(a),canonicalJson(b));
});
