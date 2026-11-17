import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");
const blobSha=content=>createHash("sha1")
  .update("blob "+Buffer.byteLength(content)+"\0")
  .update(content).digest("hex");

test("Skill Studio pins the CA-SL v1alpha5 public-review candidate and WP2 Compiler slice",()=>{
  const lock=JSON.parse(read("../language/contracts/ca-sl-v1alpha5.lock.json"));
  const spec=read("../language/contracts/source/skill-language-spec.v1alpha5.zh-CN.md");
  const entry=read("../language/contracts/source/skill-language-spec.md");
  const readme=read("../language/contracts/README.md");

  assert.equal(lock.authority.repository,"odango-chan/ca-skills");
  assert.equal(lock.authority.commit,"12a9512a9eae006ad4578daf37ebe0bdf3070642");
  assert.equal(lock.authority.status,"PUBLIC_REVIEW_DRAFT");
  assert.equal(lock.language.target,"connectionagent.io/v1alpha5");
  assert.match(lock.language.status,/NOT_RELEASED/);
  assert.equal(lock.language.inheritedBaseline,"connectionagent.io/v1alpha4");
  assert.equal(blobSha(spec),lock.normativeSource.blobSha,
    "the local normative candidate must be byte-identical to the pinned ca-skills blob");
  assert.ok(spec.includes("connectionagent.io/v1alpha5"));
  assert.ok(spec.includes("wait.output"));
  assert.ok(spec.includes("wait.response.after"));
  assert.ok(entry.includes("skill-language-spec.v1alpha5.zh-CN.md"));
  assert.match(entry,/PUBLIC REVIEW DRAFT; NOT RELEASED/);

  assert.equal(lock.compiler.repository,"odango-chan/ca-skill-compiler");
  assert.equal(lock.compiler.commit,"34993dc30b66f4cf7d573cbc81d884c356062a12");
  assert.equal(lock.compiler.status,"DRAFT_WP2_ONLY");
  assert.equal(lock.compiler.build,"FAIL_CLOSED_UNTIL_WP3_WP8");
  assert.equal(lock.qualification.compiler,"WP2_ONLY_NOT_QUALIFIED");
  assert.equal(lock.qualification.studioLsp,"IN_PROGRESS_NOT_QUALIFIED");
  assert.equal(lock.qualification.host,"NOT_QUALIFIED");
  assert.equal(lock.qualification.integration,"NOT_QUALIFIED");
  assert.equal(lock.qualification.fiveGc,"NOT_QUALIFIED");
  assert.match(readme,/v1alpha5 candidate/);
  assert.match(readme,/Build intentionally remains fail-closed/);
  assert.match(readme,/36 EW cases/);
});

test("v1alpha4 remains a historical immutable baseline, not a parallel active target",()=>{
  const lock=JSON.parse(read("../language/contracts/ca-sl-v1alpha4.lock.json"));
  const entry=read("../language/contracts/source/skill-language-spec.md");
  assert.equal(lock.language.target,"connectionagent.io/v1alpha4");
  assert.equal(lock.language.status,"FROZEN");
  assert.match(entry,/Historical frozen language/);
  assert.doesNotMatch(entry,/Current normative source.*v1alpha4/);
});
