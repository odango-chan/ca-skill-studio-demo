import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");
const blobSha=content=>createHash("sha1")
  .update("blob "+Buffer.byteLength(content)+"\0")
  .update(content).digest("hex");

test("Skill Studio pins the complete frozen CA-SL v1alpha4 source",()=>{
  const lock=JSON.parse(read("../language/contracts/ca-sl-v1alpha4.lock.json"));
  const spec=read("../language/contracts/source/skill-language-spec.v1alpha4.zh-CN.md");
  const entry=read("../language/contracts/source/skill-language-spec.md");
  const readme=read("../language/contracts/README.md");
  assert.equal(lock.authority.repository,"odango-chan/ca-skills");
  assert.equal(lock.authority.commit,"7f84393ee8c395e4d8c39a74cb5000a1f896588d");
  assert.equal(lock.language.target,"connectionagent.io/v1alpha4");
  assert.equal(lock.language.status,"FROZEN");
  assert.equal(blobSha(spec),lock.normativeSource.blobSha,
    "the local normative copy must be byte-identical to the pinned ca-skills blob");
  assert.ok(spec.includes("CA-SL v1alpha4"));
  assert.ok(spec.includes("## 35. Skill Studio 与 LSP"));
  assert.ok(entry.includes("skill-language-spec.v1alpha5.zh-CN.md"));
  assert.match(entry,/PUBLIC REVIEW DRAFT; NOT RELEASED/);
  assert.ok(readme.includes(lock.authority.commit));
  assert.ok(readme.includes("Active Skill Studio target: v1alpha5 candidate"));
  assert.ok(readme.includes("Historical frozen v1alpha4 source"));
  assert.equal(lock.externalProfiles.toolCatalog,"connectionagent.io/toolcatalog/v1alpha4");
  assert.equal(lock.externalProfiles.capabilityContracts,"connectionagent.io/capability-contracts/v1alpha4");
  assert.equal(lock.externalProfiles.legacyFallback,false);
});

test("the v0.2 semantic-token registry is explicitly legacy-only",()=>{
  const lock=JSON.parse(read("../language/contracts/ca-sl-v1alpha4.lock.json"));
  const legacy=JSON.parse(read("../language/contracts/semantic-tokens.v1.json"));
  assert.equal(lock.semanticTokens.legacy.status,"legacy-only");
  assert.equal(legacy.version,"0.2.0");
  assert.match(legacy.authority.semantics,/Skill Language v0\.2/);
  assert.doesNotMatch(legacy.authority.semantics,/v1alpha4/);
  assert.match(read("../language/contracts/README.md"),/semantic-tokens\.v1\.json.*legacy ca-skills v0\.2/i);
});
