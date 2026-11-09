import test from 'node:test';
import assert from 'node:assert/strict';
import {pagesBuildInfo} from '../scripts/write-pages-build-info.mjs';
const sha='a'.repeat(40),other='b'.repeat(40);
test('Pages provenance records the exact same main SHA for both hosts',()=>{
  const info=pagesBuildInfo({classicSha:sha,theiaSha:sha,expectedSha:sha,ref:'refs/heads/main',runId:42});
  assert.equal(info.sourceSha,sha);assert.equal(info.classicSourceSha,sha);
  assert.equal(info.workflowRunId,'42');assert.equal(info.classicPath,'/classic/');
});
test('Pages refuses main checkout drift in either input',()=>{
  const base={classicSha:sha,theiaSha:sha,expectedSha:sha,ref:'refs/heads/main'};
  assert.throws(()=>pagesBuildInfo({...base,classicSha:other}),/checkout moved/);
  assert.throws(()=>pagesBuildInfo({...base,theiaSha:other}),/checkout moved/);
});
test('Pages refuses absent or abbreviated source identity',()=>{
  assert.throws(()=>pagesBuildInfo({classicSha:sha,theiaSha:sha,expectedSha:'aaaaaaa'}),/exact Pages source/);
  assert.throws(()=>pagesBuildInfo({classicSha:sha,theiaSha:sha}),/exact Pages source/);
});
