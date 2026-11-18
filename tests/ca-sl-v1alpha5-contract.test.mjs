import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");
const blobSha=content=>createHash("sha1")
  .update("blob "+Buffer.byteLength(content)+"\0")
  .update(content).digest("hex");

test("Skill Studio pins the released CA-SL v1alpha5 language and current examples",()=>{
  const lock=JSON.parse(read("../language/contracts/ca-sl-v1alpha5.lock.json"));
  const spec=read("../language/contracts/source/skill-language-spec.v1alpha5.zh-CN.md");
  const entry=read("../language/contracts/source/skill-language-spec.md");
  const readme=read("../language/contracts/README.md");

  assert.equal(lock.authority.repository,"odango-chan/ca-skills");
  assert.equal(lock.authority.commit,"0abfd0e1ab99f481a4ae01f3f47efc54783dd5e5");
  assert.equal(lock.authority.status,"FROZEN_RELEASED");
  assert.equal(lock.language.target,"connectionagent.io/v1alpha5");
  assert.equal(lock.language.status,"FROZEN_RELEASED");
  assert.equal(lock.language.inheritedBaseline,"connectionagent.io/v1alpha4");
  assert.equal(blobSha(spec),lock.normativeSource.blobSha,
    "the local normative candidate must be byte-identical to the pinned ca-skills blob");
  assert.ok(spec.includes("connectionagent.io/v1alpha5"));
  assert.ok(spec.includes("wait.output"));
  assert.ok(spec.includes("wait.response.after"));
  assert.ok(entry.includes("skill-language-spec.v1alpha5.zh-CN.md"));
  assert.match(entry,/FROZEN \/ RELEASED/);

  assert.equal(lock.compiler.repository,"odango-chan/ca-skill-compiler");
  assert.equal(lock.compiler.commit,"ea27f18549725166f304b7d06fd9339bb0554329");
  assert.equal(lock.compiler.sourceRef,"refs/pull/38/head");
  assert.equal(lock.compiler.status,"DRAFT_NOT_RELEASED_NOT_INTEGRATED");
  assert.match(lock.compiler.check,/FULL_LANGUAGE_VALIDATION/);
  assert.equal(lock.compiler.build,"CANDIDATE_NOT_RELEASED_NOT_INTEGRATED");
  assert.equal(lock.compiler.dependencyInspection,"CANDIDATE_NOT_RELEASED_NOT_INTEGRATED");
  assert.equal(lock.qualification.compiler,"NOT_RELEASED_NOT_QUALIFIED");
  assert.equal(lock.qualification.studioLsp,"IN_PROGRESS_NOT_QUALIFIED");
  assert.equal(lock.qualification.host,"NOT_QUALIFIED");
  assert.equal(lock.qualification.integration,"NOT_QUALIFIED");
  assert.equal(lock.qualification.fiveGc,"NOT_QUALIFIED");
  assert.match(readme,/Active Skill Studio target: v1alpha5/);
  assert.match(readme,/fail closed for compiler actions/);
  assert.match(readme,/Example source/);
});

test("v1alpha4 remains a historical immutable baseline, not a parallel active target",()=>{
  const lock=JSON.parse(read("../language/contracts/ca-sl-v1alpha4.lock.json"));
  const entry=read("../language/contracts/source/skill-language-spec.md");
  assert.equal(lock.language.target,"connectionagent.io/v1alpha4");
  assert.equal(lock.language.status,"FROZEN");
  assert.match(entry,/Historical frozen language/);
  assert.doesNotMatch(entry,/Current normative source.*v1alpha4/);
});
