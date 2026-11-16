import test from "node:test";
import assert from "node:assert/strict";
import {pagesBuildInfo} from "../scripts/write-pages-build-info.mjs";
const sha="a".repeat(40),other="b".repeat(40);
test("Pages provenance records one exact source SHA and a single supported host",()=>{
  const info=pagesBuildInfo({sourceSha:sha,expectedSha:sha,ref:"refs/heads/main",runId:42});
  assert.equal(info.schemaVersion,2);
  assert.equal(info.sourceSha,sha);
  assert.equal(info.workflowRunId,"42");
  assert.equal(info.defaultHost,"theia-browser-only");
  assert.equal(info.classicPublished,false);
  assert.equal("classicSourceSha" in info,false);
  assert.equal("classicPath" in info,false);
});
test("Pages refuses source checkout drift",()=>{
  assert.throws(()=>pagesBuildInfo({sourceSha:other,expectedSha:sha,ref:"refs/heads/main"}),/checkout moved/);
});
test("Pages refuses absent or abbreviated source identity",()=>{
  assert.throws(()=>pagesBuildInfo({sourceSha:sha,expectedSha:"aaaaaaa"}),/exact Pages source/);
  assert.throws(()=>pagesBuildInfo({sourceSha:sha}),/exact Pages source/);
});
