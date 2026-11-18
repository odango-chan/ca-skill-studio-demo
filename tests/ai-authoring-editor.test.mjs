import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAuthoringResourceInventory,
  containsWaitMutation,
  createPackageRevisionTracker,
  renderAiAuthoringHtml,
  isCurrentAuthoringSession,
  isLiveDocumentRevision,
  isAuthoringApplyAllowed,
} from "../experiments/ide-host/vscode/src/ai-authoring-editor.mjs";

const base64 = (value) => Buffer.from(value, "utf8").toString("base64");
const digest = "sha256:" + "a".repeat(64);

function packageSnapshot(overrides = {}) {
  return {
    rootUri: "file:///workspace/skills/example",
    packageName: "example",
    completeness: "complete",
    generation: 1,
    documents: [
      { relativePath: "assurance/contract.yaml", version: 1, text: "goal: session.established\n" },
      { relativePath: "assurance/predicates.yaml", version: 1, text: "predicates: {}\n" },
      { relativePath: "schemas/request.schema.yaml", version: 1, text: "type: object\n" },
      { relativePath: "references/3gpp-procedure.md", version: 1, text: "3GPP reference\n" },
      { relativePath: "scripts/runner.py", version: 1, text: "def main(): pass\n" },
      { relativePath: "scripts/provider-api-token.py", version: 1, text: "secret = 'no'\n" },
      { relativePath: "output/result.yaml", version: 0, text: "must not enter context\n" },
      { relativePath: "lib/provider.yaml", version: 0, text: "must not enter context\n" },
    ],
    ...overrides,
  };
}

function dependencyResolution(overrides = {}) {
  return {
    status: "READY",
    diagnostics: [],
    snapshots: [{
      id: "provider-5gc",
      kind: "tool-catalog",
      snapshotDigest: digest,
      files: [
        { path: "tool-contract.json", bytes: base64('{"apiVersion":"connectionagent.io/toolcatalog/v1alpha4","operations":[]}') },
        { path: "README.md", bytes: base64("# Verified Tool Catalog\n") },
        { path: "secrets/provider-token.json", bytes: base64('{"token":"do-not-send"}') },
        { path: "bin/provider", bytes: base64("binary-content") },
      ],
    }],
    ...overrides,
  };
}

test("AI context inventory selects contract, predicates, schemas and verified dependencies by default", async () => {
  const resources = await buildAuthoringResourceInventory(packageSnapshot(), dependencyResolution());
  const byLabel = new Map(resources.map((item) => [item.label, item]));
  assert.equal(byLabel.get("assurance/contract.yaml").kind, "contract");
  assert.equal(byLabel.get("assurance/contract.yaml").selected, true);
  assert.equal(byLabel.get("assurance/predicates.yaml").selected, true);
  assert.equal(byLabel.get("schemas/request.schema.yaml").selected, true);
  assert.equal(byLabel.get("references/3gpp-procedure.md").selected, false);
  assert.equal(byLabel.get("scripts/runner.py").selected, false);
  assert.equal(byLabel.get("dependency:provider-5gc@" + digest).verified, true);
  assert.equal(byLabel.get("dependency:provider-5gc@" + digest).version, digest);
  assert.ok(!resources.some((item) => item.label.includes("provider-api-token")));
  assert.ok(!resources.some((item) => item.label.includes("output/")));
  assert.ok(!resources.some((item) => item.label.includes("lib/")));
});

test("verified dependency context includes only bounded text files and excludes sensitive or binary files", async () => {
  const resources = await buildAuthoringResourceInventory(packageSnapshot(), dependencyResolution());
  const dependency = resources.find((item) => item.kind === "dependency");
  assert.ok(dependency);
  const content = JSON.parse(dependency.content);
  assert.deepEqual(content.files.map((item) => item.path), ["README.md", "tool-contract.json"]);
  assert.ok(!dependency.content.includes("do-not-send"));
  assert.ok(!dependency.content.includes("binary-content"));
});

test("AI context inventory fails closed for partial Package snapshots and unverified dependencies", async () => {
  await assert.rejects(
    buildAuthoringResourceInventory(packageSnapshot({ completeness: "partial", reason: "read failed" }), dependencyResolution()),
    /incomplete/,
  );
  await assert.rejects(
    buildAuthoringResourceInventory(packageSnapshot(), dependencyResolution({ status: "BLOCKED" })),
    /not READY/,
  );
});

test("Package revision is stable for identical content and advances for Procedure or dependency changes", async () => {
  const revisionFor = createPackageRevisionTracker();
  const snapshot = packageSnapshot();
  const deps = dependencyResolution();
  assert.equal(await revisionFor(snapshot, deps), 1);
  assert.equal(await revisionFor(packageSnapshot(), dependencyResolution()), 1);
  const changedProcedure = packageSnapshot();
  changedProcedure.documents[0] = {
    ...changedProcedure.documents[0],
    version: 2,
    text: "goal: session.recovered\n",
  };
  assert.equal(await revisionFor(changedProcedure, deps), 2);
  const changedDependency = dependencyResolution();
  changedDependency.snapshots[0] = { ...changedDependency.snapshots[0], snapshotDigest: "sha256:" + "b".repeat(64) };
  assert.equal(await revisionFor(changedProcedure, changedDependency), 3);
});

test("AI Authoring Webview has a nonce-only script/style policy and no direct network path", () => {
  const html = renderAiAuthoringHtml("a".repeat(48));
  assert.match(html, /default-src 'none'/);
  assert.match(html, /script-src 'nonce-[a-f0-9]+'/);
  assert.match(html, /style-src 'nonce-[a-f0-9]+'/);
  assert.match(html, /connect-src 'none'/);
  assert.doesNotMatch(html, /unsafe-inline|unsafe-eval|fetch\s*\(/);
  assert.ok(html.includes("CA-SL v1alpha5 · FROZEN / RELEASED"));
  assert.ok(html.includes("Host 生成的 YAML 候选预览"));
  assert.ok(html.includes('id="currentSource"'));
  assert.ok(html.includes('id="candidateSource"'));
  assert.match(html, /Compiler Check: NOT_RUN/);
  assert.match(html, /不自动保存/);
  assert.throws(() => renderAiAuthoringHtml("not-a-secure-nonce"), /nonce/);
});

test("Wait proposals are preview-only until trusted IngressCatalog and full v1alpha5 Compiler gates exist", () => {
  assert.equal(containsWaitMutation([
    { type: "node.wait.set", payload: { definition: { event: {} } } },
  ]), true);
  assert.equal(containsWaitMutation([
    { type: "node.add", payload: { definition: { wait: { event: {} }, operation: {} } } },
  ]), true);
  assert.equal(containsWaitMutation([
    { type: "node.stage.add", payload: { definition: { operation: {} } } },
  ]), false);
});

test("stale Editor Tab sessions cannot publish asynchronous results into a replacement session", () => {
  const first = { disposed: false };
  const second = { disposed: false };
  assert.equal(isCurrentAuthoringSession(first, first), true);
  assert.equal(isCurrentAuthoringSession(second, first), false);
  first.disposed = true;
  assert.equal(isCurrentAuthoringSession(first, first), false);
  assert.equal(isCurrentAuthoringSession(null, first), false);
});

test("AI proposals require a complete pinned v1alpha5 Compiler PASS for the exact candidate identity", () => {
  const changeSet = { base: {
    documentUri: "file:///workspace/skills/example/assurance/procedure.yaml",
    documentVersion: 7,
    packageGeneration: 3,
    sourceDigest: "sha256:" + "a".repeat(64),
    languageTarget: "connectionagent.io/v1alpha5",
  } };
  const patchPlan = { candidateDigest: "sha256:" + "b".repeat(64) };
  const compilerCheck = {
    languageTarget: "connectionagent.io/v1alpha5",
    state: "PASS",
    complete: true,
    documentUri: changeSet.base.documentUri,
    documentVersion: changeSet.base.documentVersion,
    packageGeneration: changeSet.base.packageGeneration,
    sourceDigest: changeSet.base.sourceDigest,
    candidateDigest: patchPlan.candidateDigest,
    trustedIngressBinding: true,
  };
  const base = { patchPlan, changeSet, blockers: [], waitMutation: false };
  assert.equal(isAuthoringApplyAllowed(base), false, "no Compiler result means preview-only");
  assert.equal(isAuthoringApplyAllowed({
    ...base,
    compilerCheck: { ...compilerCheck, state: "CANDIDATE_PARTIAL", complete: false },
  }), false, "partial Compiler candidate cannot authorize Apply");
  assert.equal(isAuthoringApplyAllowed({
    ...base,
    compilerCheck: { ...compilerCheck, languageTarget: "connectionagent.io/v1alpha4" },
  }), false, "v1alpha4 Compiler result cannot authorize v1alpha5 edits");
  assert.equal(isAuthoringApplyAllowed({
    ...base,
    compilerCheck: { ...compilerCheck, candidateDigest: "sha256:" + "c".repeat(64) },
  }), false, "Compiler result must identify the exact candidate digest");
  assert.equal(isAuthoringApplyAllowed({
    ...base,
    compilerCheck: { ...compilerCheck, documentVersion: 8 },
  }), false, "Compiler result must identify the exact live document revision");
  assert.equal(isAuthoringApplyAllowed({
    ...base,
    blockers: ["missing trusted Tool"],
    compilerCheck,
  }), false, "proposal blockers prevent Apply");
  assert.equal(isAuthoringApplyAllowed({
    ...base,
    waitMutation: true,
    compilerCheck: { ...compilerCheck, trustedIngressBinding: false },
  }), false, "Wait additionally requires a trusted Ingress binding");
  assert.equal(isAuthoringApplyAllowed({
    ...base,
    compilerCheck,
  }), true, "only an exact full v1alpha5 PASS unlocks a non-Wait proposal");
  assert.equal(isAuthoringApplyAllowed({
    ...base,
    waitMutation: true,
    compilerCheck,
  }), true, "Wait can be enabled only after the full Compiler and trusted binding gates pass");
});

test("native preview and Apply require the exact live TextDocument revision and bytes", () => {
  const source = "start: node-a\\nnodes: {}\\n";
  const revision = { documentVersion: 4, source };
  const document = { version: 4, getText: () => source };
  assert.equal(isLiveDocumentRevision(document, revision), true);
  assert.equal(isLiveDocumentRevision({ ...document, version: 5 }, revision), false);
  assert.equal(isLiveDocumentRevision({ version: 4, getText: () => source + "# changed\\n" }, revision), false);
  assert.equal(isLiveDocumentRevision(document, { documentVersion: 4, source: 7 }), false);
  assert.equal(isLiveDocumentRevision(null, revision), false);
});
