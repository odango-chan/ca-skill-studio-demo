import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Contract-only test: verifies the proposed native extension contribution
// shapes. Actual package.json registration and Browser-Only persistence are
// separate implementation/acceptance gates.
const contribution=JSON.parse(readFileSync(
 new URL('../contracts/v0.1/studio-settings-contributions.json',import.meta.url),'utf8'));
const props=contribution.properties;

test('v0.1 Studio plugin settings names and scope are stable',()=>{
  assert.equal(contribution.id,'connectionAgent.skillStudio');
  assert.deepEqual(Object.keys(props).sort(),[
    'connectionAgent.skillStudio.defaultBuildTarget',
    'connectionAgent.skillStudio.dependencies',
    'connectionAgent.skillStudio.dependencyLock',
    'connectionAgent.skillStudio.skillsRoot'
  ].sort());
  for(const key of ['skillsRoot','dependencies','dependencyLock']){
    assert.equal(props['connectionAgent.skillStudio.'+key].scope,'resource');
  }
  assert.equal(props['connectionAgent.skillStudio.defaultBuildTarget'].scope,'window');
});

test('v0.1 treats dependencies as managed workspace inputs, not required lib/output directories',()=>{
  assert.equal(props['connectionAgent.skillStudio.skillsRoot'].default,'skills');
  assert.deepEqual(props['connectionAgent.skillStudio.dependencies'].default,[]);
  assert.deepEqual(props['connectionAgent.skillStudio.dependencyLock'].default,{
    version:'skillc.lock/v0.1',entries:[]
  });
  assert.ok(!Object.keys(props).some(key=>key.endsWith('.libRoot')||key.endsWith('.outputRoot')));
});
