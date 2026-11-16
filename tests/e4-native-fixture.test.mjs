import test from "node:test";
import assert from "node:assert/strict";
import {mkdir,readFile,writeFile,rm} from "node:fs/promises";
import {join,resolve} from "node:path";
import {createNativeFixture,fixtureFiles,expectedFinalFiles,verifyNativeFixture}
  from "../scripts/e4-native-fixture.mjs";

const base=resolve(".agent-tmp");
test("E4 native acceptance creates only a new nonce-bound disposable fixture",async()=>{
  await mkdir(base,{recursive:true});
  const fixture=await createNativeFixture(base);
  try{
    assert.match(fixture.token,/^[a-f0-9]{32}$/);
    assert.match(fixture.root,/e4-native-/);
    assert.equal(fixture.folder.startsWith(fixture.root),true);
    assert.equal(fixture.originals.size,5);
    const before=await verifyNativeFixture(fixture.folder,fixture.token,{final:false});
    assert.equal(before.pass,true);
    assert.equal(Object.keys(before.hashes).length,5);
    assert.deepEqual(new Uint8Array(await readFile(join(fixture.folder,".e4-test-token"))),
      new TextEncoder().encode(fixture.token));
  }finally{await rm(fixture.root,{recursive:true,force:true});}
});
test("E4 native independent verifier rejects extras and byte changes",async()=>{
  const fixture=await createNativeFixture(base);
  try{
    const expected=expectedFinalFiles(fixture.token);
    for(const p of ["SKILL.md","scripts/check.py"]){
      await writeFile(join(fixture.folder,...p.split("/")),expected.get(p));
    }
    const good=await verifyNativeFixture(fixture.folder,fixture.token);
    assert.equal(good.pass,true);
    assert.deepEqual(good.missingOrChanged,[]);
    await writeFile(join(fixture.folder,"extra.tmp"),"rogue");
    const extra=await verifyNativeFixture(fixture.folder,fixture.token);
    assert.equal(extra.pass,false);
    assert.deepEqual(extra.extraFiles,["extra.tmp"]);
    await rm(join(fixture.folder,"extra.tmp"));
    await writeFile(join(fixture.folder,"assets","opaque.bin"),Buffer.from([0,1,2]));
    const mutated=await verifyNativeFixture(fixture.folder,fixture.token);
    assert.equal(mutated.pass,false);
    assert.deepEqual(mutated.missingOrChanged,["assets/opaque.bin"]);
  }finally{await rm(fixture.root,{recursive:true,force:true});}
});
test("E4 native fixture rejects invalid provenance tokens",()=>{
  for(const t of ["", "../evil", "x".repeat(32), "a".repeat(31)])
    assert.throws(()=>fixtureFiles(t),/Invalid fixture marker/);
});
