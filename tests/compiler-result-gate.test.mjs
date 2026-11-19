import test from "node:test";
import assert from "node:assert/strict";
import {createCompilerResultGate}
  from "../experiments/ide-host/vscode/src/compiler-result-gate.mjs";

const a="file:///workspace/skills/a",b="file:///workspace/skills/b";

test("source edit invalidates stale Check result without touching unrelated Package",()=>{
  const gate=createCompilerResultGate();
  const checkA=gate.advance(a);
  const checkB=gate.advance(b);
  assert.equal(gate.isCurrent(a,checkA),true);
  assert.equal(gate.isCurrent(b,checkB),true);
  const afterSourceEdit=gate.advance(a);
  assert.equal(gate.isCurrent(a,checkA),false);
  assert.equal(gate.isCurrent(a,afterSourceEdit),true);
  assert.equal(gate.isCurrent(b,checkB),true);
});

test("newer Check/Build for a Package supersedes an earlier in-flight response",()=>{
  const gate=createCompilerResultGate();
  const olderCheck=gate.advance(a);
  const newerBuild=gate.advance(a);
  assert.equal(gate.isCurrent(a,olderCheck),false);
  assert.equal(gate.isCurrent(a,newerBuild),true);
});

test("configuration/lock changes invalidate all tracked Compiler results",()=>{
  const gate=createCompilerResultGate();
  const first=gate.advance(a),second=gate.advance(b);
  assert.deepEqual(gate.knownRoots(),[a,b]);
  gate.invalidateAll();
  assert.equal(gate.isCurrent(a,first),false);
  assert.equal(gate.isCurrent(b,second),false);
  assert.equal(gate.isCurrent(a,gate.current(a)),true);
});

test("revision gate rejects malformed Package keys and unknown revisions",()=>{
  const gate=createCompilerResultGate();
  assert.throws(()=>gate.advance(""),/Package identity/);
  assert.throws(()=>gate.current(null),/Package identity/);
  assert.equal(gate.isCurrent(a,undefined),false);
  assert.equal(gate.isCurrent(a,0),true);
});
