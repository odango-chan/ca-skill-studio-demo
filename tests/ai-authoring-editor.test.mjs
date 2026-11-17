import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAuthoringResourceInventory,
  containsWaitMutation,
  createPackageRevisionTracker,
  renderAiAuthoringHtml,
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
