import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { projectProcedure } from "../site/graph.mjs";
import {
  PatchConflict, routeEditTargets, previewRouteTargetPatch,
  applyRouteTargetPatch, createEditorHistory
} from "../site/patch.mjs";

const fixture = readFileSync(new URL("../site/samples/ensure-pdu-session.procedure.yaml", import.meta.url), "utf8");
const firstRoute = "verify-created-target:FAIL";
const nextTarget = "safe-stopped";

test("only pinned failure-terminal routes can use Visual SetRouteTarget", () => {
  const p = projectProcedure(fixture).procedure;
  assert.deepEqual(routeEditTargets(p, firstRoute), ["strategy-conflict", "failed", "unresolved", "safe-stopped"]);
  assert.deepEqual(routeEditTargets(p, "observe-session-absence:FAIL"), ["strategy-conflict", "failed", "unresolved", "safe-stopped"]);
  assert.deepEqual(routeEditTargets(p, "observe-session-absence:PASS"), []);
  assert.deepEqual(routeEditTargets(p, "create-session:OUTCOME_UNKNOWN"), []);
  assert.deepEqual(routeEditTargets(p, "verify-created-target:PASS"), []);
});

test("preview changes only one exact route scalar; preserve rest of source byte-for-byte", () => {
  const preview = previewRouteTargetPatch(fixture, firstRoute, nextTarget);
  assert.equal(preview.type, "SetRouteTarget");
  assert.equal(preview.line, projectProcedure(fixture).procedure.routes.find(r => r.id === firstRoute).line);
  assert.ok(preview.diff.includes("-          FAIL: failed"));
  assert.ok(preview.diff.includes("+          FAIL: safe-stopped"));
  const actual = applyRouteTargetPatch(fixture, preview);
  assert.equal(actual, fixture.replace("          FAIL: failed\n          UNKNOWN: unresolved", "          FAIL: safe-stopped\n          UNKNOWN: unresolved"));
  const graph = projectProcedure(actual);
  assert.equal(graph.state, "READY");
  assert.equal(graph.procedure.routes.length, 24);
  assert.equal(graph.procedure.routes.find(r => r.id === firstRoute).target, "safe-stopped");
});

test("terminal edit is reversible with a new preview, but original source is never auto-rewritten", () => {
  const forward = previewRouteTargetPatch(fixture, firstRoute, nextTarget);
  const changed = applyRouteTargetPatch(fixture, forward);
  const reverse = previewRouteTargetPatch(changed, firstRoute, "failed");
  assert.equal(applyRouteTargetPatch(changed, reverse), fixture);
});

test("preserve LF, CRLF, BOM, adjacent inline comments and trailing newline exactly", () => {
  let src = "\uFEFF" + fixture.replace(/\n/g, "\r\n");
  src = src.replace("          FAIL: failed\r\n          UNKNOWN: unresolved", "          FAIL: failed   # exact note\r\n          UNKNOWN: unresolved");
  const patch = previewRouteTargetPatch(src, firstRoute, nextTarget);
  const applied = applyRouteTargetPatch(src, patch);
  assert.equal(applied.replace("          FAIL: safe-stopped   # exact note", "          FAIL: failed   # exact note"), src);
  assert.ok(applied.startsWith("\uFEFF"));
  assert.equal((applied.match(/\r\n/g) || []).length, (src.match(/\r\n/g) || []).length);
  assert.equal(patch.diff.split("\n").filter(l => l.startsWith("+")).length, 1);
});

test("patch can update second fixed permitted route without conflating duplicate outcomes", () => {
  const preview = previewRouteTargetPatch(fixture, "observe-session-absence:FAIL", "safe-stopped");
  const changed = applyRouteTargetPatch(fixture, preview);
  const p = projectProcedure(changed).procedure;
  assert.equal(p.routes.find(r => r.id === "observe-session-absence:FAIL").target, "safe-stopped");
  assert.equal(p.routes.find(r => r.id === firstRoute).target, "failed");
});

test("do not open a patch for unsupported or source-only procedures", () => {
  assert.throws(() => previewRouteTargetPatch("procedures:\n", firstRoute, nextTarget), PatchConflict);
  assert.throws(() => previewRouteTargetPatch(fixture + "\n  another:\n    start: x\n", firstRoute, nextTarget), PatchConflict);
  assert.throws(() => previewRouteTargetPatch(fixture, "create-session:OUTCOME_UNKNOWN", "done"), PatchConflict);
  assert.throws(() => previewRouteTargetPatch(fixture, "verify-created-target:PASS", "safe-stopped"), PatchConflict);
});

test("reject a nonexistent target, unchanged target, and wrong payload type", () => {
  assert.throws(() => previewRouteTargetPatch(fixture, firstRoute, "random-node"), PatchConflict);
  assert.throws(() => previewRouteTargetPatch(fixture, firstRoute, "failed"), PatchConflict);
  assert.throws(() => previewRouteTargetPatch(fixture, firstRoute, null), PatchConflict);
});

test("stale source is denied after a preview, even if the route line did not change", () => {
  const preview = previewRouteTargetPatch(fixture, firstRoute, nextTarget);
  const external = fixture.replace("    start: observe-target-session", "    start: observe-target-session # updated");
  assert.throws(() => applyRouteTargetPatch(external, preview), /Revision/);
});

test("forged candidateSource and metadata cannot bypass recomputation", () => {
  const preview = previewRouteTargetPatch(fixture, firstRoute, nextTarget);
  assert.throws(() => applyRouteTargetPatch(fixture, {...preview, candidateSource: "evil"}), /篡改/);
  assert.throws(() => applyRouteTargetPatch(fixture, {...preview, diff: "made-up"}), /篡改/);
  assert.throws(() => applyRouteTargetPatch(fixture, {...preview, oldTarget: "done"}), /篡改/);
});

test("a non-eligible revision cannot be patched even with a forged preview", () => {
  const preview = previewRouteTargetPatch(fixture, firstRoute, nextTarget);
  const damaged = fixture.replace("verify: pdu_session.absent", "other: pdu_session.absent");
  assert.throws(() => applyRouteTargetPatch(damaged, {...preview, baseSource: damaged}), PatchConflict);
});

test("source/visual changes share one bounded undo-redo history", () => {
  const history = createEditorHistory(fixture, 8);
  const first = fixture + "\n# author draft";
  assert.ok(history.record(first));
  assert.equal(history.record(first), false);
  const second = applyRouteTargetPatch(fixture, previewRouteTargetPatch(fixture, firstRoute, nextTarget));
  assert.ok(history.record(second));
  assert.equal(history.undo(), first);
  assert.equal(history.undo(), fixture);
  assert.equal(history.undo(), null);
  assert.equal(history.redo(), first);
  assert.equal(history.redo(), second);
  assert.equal(history.redo(), null);
});

test("new source edit invalidates redo and history stays bounded", () => {
  const history = createEditorHistory("A", 3);
  history.record("B");
  history.record("C");
  assert.equal(history.undo(), "B");
  history.record("D");
  assert.equal(history.redo(), null);
  history.record("E");
  assert.equal(history.undo(), "D");
  assert.equal(history.undo(), "B");
  assert.equal(history.undo(), null);
});

test("unsupported history data does not enter source buffer", () => {
  assert.throws(() => createEditorHistory(123), PatchConflict);
  assert.throws(() => createEditorHistory("", 1), PatchConflict);
  const history = createEditorHistory("");
  assert.throws(() => history.record(null), PatchConflict);
});


test("Visual edits reject a procedurally unsafe but otherwise valid topology", () => {
  const changed = fixture.replace("          PASS: create-session", "          PASS: done");
  const result = projectProcedure(changed);
  assert.equal(result.state, "READY"); // syntax valid but not authorized topology
  assert.deepEqual(routeEditTargets(result.procedure, firstRoute), []);
  assert.throws(() => previewRouteTargetPatch(changed, firstRoute, nextTarget), /拓扑/);
});

test("a valid but unqualified route outcome cannot be Visual edited", () => {
  const changed = fixture.replace("          NOT_COMMITTED: failed", "          RETRY: failed");
  assert.equal(projectProcedure(changed).state, "READY");
  assert.deepEqual(routeEditTargets(projectProcedure(changed).procedure, firstRoute), []);
});

test("quoted route target remains source-only even if its value equals a known terminal", () => {
  const quoted = fixture.replace(
    "          FAIL: failed\n          UNKNOWN: unresolved",
    "          FAIL: \"failed\"\n          UNKNOWN: unresolved"
  );
  assert.equal(projectProcedure(quoted).state, "READY");
  assert.deepEqual(routeEditTargets(projectProcedure(quoted).procedure, firstRoute), []);
  assert.throws(() => previewRouteTargetPatch(quoted, firstRoute, nextTarget), PatchConflict);
});

test("CST source offsets are precisely bound across comment and padding changes", () => {
  const source = fixture.replace(
    "          FAIL: failed\n          UNKNOWN: unresolved",
    "          FAIL  :   failed   # preserve-me\n          UNKNOWN: unresolved"
  );
  const p = projectProcedure(source);
  assert.equal(p.state, "READY", JSON.stringify(p.diagnostics));
  const candidate = applyRouteTargetPatch(source, previewRouteTargetPatch(source, firstRoute, nextTarget));
  assert.equal(candidate.replace("FAIL  :   safe-stopped", "FAIL  :   failed"), source);
});

test("source patch rejects stale revision even if only one comment changed elsewhere", () => {
  const preview = previewRouteTargetPatch(fixture, firstRoute, nextTarget);
  assert.throws(
    () => applyRouteTargetPatch(fixture.replace("          PASS: done", "          PASS: done # unrelated"), preview),
    /Revision/
  );
});

test("forged source span cannot redirect patch to another YAML scalar", () => {
  const preview = previewRouteTargetPatch(fixture, firstRoute, nextTarget);
  assert.throws(
    () => applyRouteTargetPatch(fixture, {
      ...preview, sourceSpan: {...preview.sourceSpan, start: 0, end: 1}
    }), /Source Span/
  );
});
