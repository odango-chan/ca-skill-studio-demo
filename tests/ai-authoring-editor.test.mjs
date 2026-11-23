import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { configureAiGatewayToken } from "../experiments/ide-host/vscode/src/ai-authoring-editor.mjs";
import {
  buildAuthoringResourceInventory,
  createAuthoringCompilerRequest,
  createAuthoringCompilerCheck,
  containsWaitMutation,
  createPackageRevisionTracker,
  renderAiAuthoringHtml,
  isCurrentAuthoringSession,
  isLiveDocumentRevision,
  preferredProcedureDocument,
  isAuthoringApplyAllowed,
  applyAuthoringCandidateToBuffer,
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
      { relativePath: "assurance/procedure.yaml", version: 1, text: "start: check\\nnodes: {}\\n" },
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
  assert.ok(html.includes("message.compilerCheck||'UNAVAILABLE'"), "applied state must display the actual final Compiler result");
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

test("Compiler request replaces only the exact candidate Procedure and includes locked dependency bytes", () => {
  const state = {
    snapshot: packageSnapshot(),
    dependencies: dependencyResolution(),
    generation: 4,
  };
  const request = createAuthoringCompilerRequest(state, "start: candidate\\nnodes: {}\\n");
  assert.equal(request.languageTarget, "connectionagent.io/v1alpha5");
  const procedure = request.files.find((item) =>
    item.path === "skills/example/assurance/procedure.yaml");
  assert.ok(procedure);
  assert.equal(Buffer.from(procedure.bytes, "base64").toString("utf8"),
    "start: candidate\\nnodes: {}\\n");
  assert.ok(request.files.some((item) =>
    item.path === "skills/example/assurance/contract.yaml"));
  assert.equal(request.resolvedDependencies[0].dependencyId, "provider-5gc");
  assert.equal(request.resolvedDependencies[0].digest, digest);
});

test("Compiler Check result is bound to exact document, Package generation and candidate digest", async () => {
  const state = {
    snapshot: packageSnapshot(),
    dependencies: dependencyResolution(),
    generation: 9,
  };
  const document = {
    uri: { toString: () => "file:///workspace/skills/example/assurance/procedure.yaml" },
    version: 7,
  };
  const changeSet = { base: {
    documentUri: document.uri.toString(),
    documentVersion: 7,
    packageGeneration: 9,
    sourceDigest: "sha256:" + "a".repeat(64),
  } };
  const candidateDigest = "sha256:" + "b".repeat(64);
  let request;
  const compilerIntegration = {
    compilerVersion: "v2.0.2",
    async checkRequest(value) { request = value; return []; },
  };
  const result = await createAuthoringCompilerCheck({
    compilerIntegration,state,document,changeSet,
    candidateSource: "start: candidate\\nnodes: {}\\n",candidateDigest,
  });
  assert.equal(request.languageTarget, "connectionagent.io/v1alpha5");
  assert.equal(result.compilerVersion, "v2.0.2");
  assert.equal(result.state, "PASS");
  assert.equal(result.complete, true);
  assert.equal(result.documentUri, changeSet.base.documentUri);
  assert.equal(result.documentVersion, 7);
  assert.equal(result.packageGeneration, 9);
  assert.equal(result.sourceDigest, changeSet.base.sourceDigest);
  assert.equal(result.candidateDigest, candidateDigest);
  assert.equal(result.trustedIngressBinding, false);
  const failed = await createAuthoringCompilerCheck({
    compilerIntegration: {
      compilerVersion: "v2.0.2",
      async checkRequest() { return [{code:"E_TEST",severity:"error",message:"invalid"}]; },
    },
    state,document,changeSet,
    candidateSource: "start: candidate\\nnodes: {}\\n",candidateDigest,
  });
  assert.equal(failed.state, "FAIL");
  assert.equal(failed.errorCount, 1);
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
    compilerVersion: "v2.0.2",
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
  const candidateDigest = patchPlan.candidateDigest;
  const base = { patchPlan, changeSet, candidateDigest, blockers: [], waitMutation: false };
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
    candidateDigest: "sha256:" + "c".repeat(64),
    compilerCheck,
  }), false, "Compiler result must identify the exact selected-group candidate digest");
  assert.equal(isAuthoringApplyAllowed({
    ...base,
    candidateDigest: "sha256:" + "c".repeat(64),
    compilerCheck: { ...compilerCheck, candidateDigest: "sha256:" + "c".repeat(64) },
  }), true, "a Compiler PASS for the selected-group candidate is accepted");
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

test("AI Authoring prefers the active Procedure or current workbench Procedure without failing on another active file", () => {
  const procedure = { uri: { path: "/workspace/skills/example/assurance/procedure.yaml" } };
  const python = { uri: { path: "/workspace/skills/example/scripts/run.py" } };
  assert.equal(preferredProcedureDocument(procedure, python), procedure);
  assert.equal(preferredProcedureDocument(python, procedure), procedure);
  assert.equal(preferredProcedureDocument(python, null), null);
});


test("shared Gateway token is stored in Extension SecretStorage and can be cleared", async () => {
  const calls = [];
  let input = " shared-network-token ";
  const vscode = {
    window: {
      async showInputBox(options) {
        assert.equal(options.password, true);
        assert.equal(options.ignoreFocusOut, true);
        return input;
      },
      async showInformationMessage(message) { calls.push(["message", message]); }
    }
  };
  const secrets = {
    async store(key, value) { calls.push(["store", key, value]); },
    async delete(key) { calls.push(["delete", key]); }
  };

  assert.equal(await configureAiGatewayToken(vscode, secrets), true);
  assert.deepEqual(calls[0], ["store", "connectionAgent.skillStudio.ai.gatewayToken", "shared-network-token"]);

  input = "";
  assert.equal(await configureAiGatewayToken(vscode, secrets), true);
  assert.deepEqual(calls[2], ["delete", "connectionAgent.skillStudio.ai.gatewayToken"]);
});

test("shared Gateway token setup is cancelled without changing SecretStorage", async () => {
  let changed = false;
  const vscode = { window: { async showInputBox() { return undefined; } } };
  const secrets = {
    async store() { changed = true; },
    async delete() { changed = true; }
  };
  assert.equal(await configureAiGatewayToken(vscode, secrets), false);
  assert.equal(changed, false);
});

test("shared Gateway token setup fails closed without Host SecretStorage", async () => {
  const vscode = { window: { async showInputBox() { return "token"; } } };
  await assert.rejects(configureAiGatewayToken(vscode, undefined), /SecretStorage/);
});

test("AI Authoring preserves the actual model failure instead of hiding it behind generic completion status",()=>{
  const source=readFileSync(new URL("../experiments/ide-host/vscode/src/ai-authoring-editor.mjs",import.meta.url),"utf8");
  assert.match(source,/post\(\{ type: "busy", busy: false \}\)/);
  assert.match(source,/message\.type==='busy'/);
  assert.doesNotMatch(source,/请求结束。Compiler Check:/);
});

test("Compiler-approved candidate applies through native WorkspaceEdit without saving",async()=>{
  const rootUri={path:"/workspace",scheme:"file",authority:"",toString(){return "file:///workspace";}};
  const uri={path:"/workspace/skills/test/assurance/procedure.yaml",scheme:"file",authority:"",
    toString(){return "file:///workspace/skills/test/assurance/procedure.yaml";}};
  let source="start: old\\nnodes: {}\\n",version=3,applyCount=0,saveCount=0;
  const original=source,candidate="start: new\\nnodes: {}\\n";
  const document={uri,get version(){return version;},getText(){return source;},
    positionAt(offset){return {offset};},async save(){saveCount++;return true;}};
  class WorkspaceEdit{
    edits=[];
    replace(target,range,text){this.edits.push({target,range,text});}
  }
  class Range{constructor(start,end){this.start=start;this.end=end;}}
  const vscode={
    WorkspaceEdit,Range,
    workspace:{
      workspaceFolders:[{uri:rootUri}],
      async applyEdit(edit){
        applyCount++;
        assert.equal(edit.edits.length,1);
        assert.equal(edit.edits[0].target,uri);
        assert.deepEqual([edit.edits[0].range.start.offset,edit.edits[0].range.end.offset],
          [0,original.length]);
        source=edit.edits[0].text;
        version++;
        return true;
      },
    }
  };
  const result=await applyAuthoringCandidateToBuffer(vscode,document,
    {source:original,documentVersion:3,candidateSource:candidate});
  assert.deepEqual(result,{applied:true,saved:false});
  assert.equal(source,candidate);
  assert.equal(applyCount,1);
  assert.equal(saveCount,0);
  await assert.rejects(applyAuthoringCandidateToBuffer(vscode,document,
    {source:original,documentVersion:3,candidateSource:"stale"}),/revision changed/);
  assert.equal(applyCount,1,"stale revision must not enter WorkspaceEdit");
  const outside={...document,uri:{...uri,path:"/workspace/skills/test/SKILL.md"}};
  await assert.rejects(applyAuthoringCandidateToBuffer(vscode,outside,
    {source:candidate,documentVersion:version,candidateSource:"invalid"}),/current Procedure revision/);
  assert.equal(applyCount,1);
});

test("Rejected WorkspaceEdit fails closed and never calls save",async()=>{
  let saveCount=0;
  const uri={path:"/workspace/skills/test/assurance/procedure.yaml",scheme:"file",authority:""};
  const document={uri,version:1,getText(){return "old";},
    positionAt(offset){return {offset};},save(){saveCount++;}};
  const vscode={
    WorkspaceEdit:class {replace(){}},
    Range:class {constructor(){}},
    workspace:{workspaceFolders:[{uri:{path:"/workspace",scheme:"file",authority:""}}],
      applyEdit:async()=>false}
  };
  await assert.rejects(applyAuthoringCandidateToBuffer(vscode,document,
    {source:"old",documentVersion:1,candidateSource:"new"}),/Host rejected/);
  assert.equal(saveCount,0);
});

test("synthetic positive native Editor acceptance is CI-only and keeps trusted fixture off production Pages",()=>{
  const extension=readFileSync(new URL("../experiments/ide-host/vscode/src/extension.mjs",import.meta.url),"utf8");
  const acceptance=readFileSync(new URL("../experiments/ide-host/vscode/src/ai-authoring-acceptance.mjs",import.meta.url),"utf8");
  const browser=readFileSync(new URL("../experiments/ide-host/scripts/theia-browser-smoke.mjs",import.meta.url),"utf8");
  const backend=readFileSync(new URL("../.github/workflows/theia-browser-host-spike.yml",import.meta.url),"utf8");
  const pages=readFileSync(new URL("../.github/workflows/pages.yml",import.meta.url),"utf8");
  assert.match(extension,/registerSyntheticAuthoringAcceptance/);
  assert.match(acceptance,/!process\.versions\?\.node/);
  assert.match(acceptance,/applyAuthoringCandidateToBuffer/);
  assert.ok(acceptance.includes("authoring-trusted-build-request.json"));
  assert.ok(backend.includes("authoring-trusted-build-request.json"));
  assert.ok(acceptance.includes("syntheticAuthoringVerifyUndo"));
  assert.match(browser,/commands\.executeCommand\(enabled\)/);
  assert.match(acceptance,/unsavedDiskUnchanged:true/);
  assert.match(browser,/STUDIO_AI_AUTHORING_SYNTHETIC_NATIVE_EDIT_UNDO_CHROMIUM_PASS/);
  assert.match(backend,/trusted-build-request\.json/);
  assert.match(backend,/THEIA_ACCEPTANCE_FIXTURES: "1"/);
  assert.doesNotMatch(pages,/authoring-trusted-build-request\.json/);
});
