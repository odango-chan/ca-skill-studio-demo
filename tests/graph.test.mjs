import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { projectProcedure, layoutProcedure } from "../site/graph.mjs";

const fixture = readFileSync(new URL("../site/samples/ensure-pdu-session.procedure.yaml", import.meta.url), "utf8");

test("fixed Demo ensure source projects exact 11 nodes, 24 route entries, 5 terminals", () => {
  const result = projectProcedure(fixture);
  assert.equal(result.state, "READY", JSON.stringify(result.diagnostics));
  const proc = result.procedure;
  assert.equal(proc.name, "ensure-session");
  assert.equal(proc.start, "observe-target-session");
  assert.equal(proc.nodes.length, 11);
  assert.equal(proc.routes.length, 24);
  assert.equal(proc.nodes.filter(n => n.operator === "terminal").length, 5);
  assert.equal(proc.nodes.find(n => n.id === "reconcile-create").operator, "call");
  assert.equal(proc.nodes.find(n => n.id === "reconcile-create").value, "pdu_session.reconcile");
  assert.equal(new Set(proc.routes.map(r => r.id)).size, 24);
});

test("fail-closed decision edges retain exact outcome and target", () => {
  const proc = projectProcedure(fixture).procedure;
  const route = (node, outcome) => proc.routes.find(r => r.source === node && r.outcome === outcome);
  assert.equal(route("observe-session-absence", "PASS").target, "create-session");
  assert.equal(route("observe-session-absence", "UNKNOWN").target, "unresolved");
  assert.equal(route("create-session", "OUTCOME_UNKNOWN").target, "reconcile-create");
  assert.equal(route("reconcile-create", "NOT_COMMITTED").target, "retry-create-session");
  assert.equal(route("retry-create-session", "OUTCOME_UNKNOWN").target, "unresolved");
});

test("CRLF/UTF-8 BOM input can be read without rewriting input source", () => {
  const text = "\uFEFF" + fixture.replace(/\n/g, "\r\n");
  assert.equal(projectProcedure(text).state, "READY");
  assert.ok(text.includes("\r\n"));
});

test("invalid target never becomes a plausible graph", () => {
  const broken = fixture.replace("PASS: done", "PASS: missing-target");
  const parsed = projectProcedure(broken);
  assert.equal(parsed.state, "UNAVAILABLE");
  assert.match(parsed.diagnostics[0].message, /悬空/);
});

test("duplicate outcome refuses projection", () => {
  const broken = fixture.replace("FAIL: observe-session-absence", "PASS: observe-session-absence");
  assert.equal(projectProcedure(broken).state, "UNAVAILABLE");
});

test("unknown node property refuses semantic projection", () => {
  const broken = fixture.replace("verify: pdu_session.absent", "mystery: pdu_session.absent");
  assert.equal(projectProcedure(broken).state, "UNAVAILABLE");
});

test("Demo transitional phases are source-only", () => {
  const broken = fixture.replace("verify: pdu_session.absent", "verify: pdu_session.absent\n        preconditions:");
  const parsed = projectProcedure(broken);
  assert.equal(parsed.state, "UNAVAILABLE");
  assert.match(parsed.diagnostics[0].message, /Transitional Phase/);
});

test("multiple procedures intentionally unsupported until child drill-in", () => {
  const broken = fixture + "\n  extra-procedure:\n    start: step\n";
  const parsed = projectProcedure(broken);
  assert.equal(parsed.state, "UNAVAILABLE");
  assert.match(parsed.diagnostics[0].message, /多 Procedure/);
});

test("layout positions all nodes and bundles only visual edges", () => {
  const proc = projectProcedure(fixture).procedure;
  const layout = layoutProcedure(proc);
  assert.equal(layout.positions.size, proc.nodes.length);
  assert.equal(layout.bundles.reduce((sum, edge) => sum + edge.routes.length, 0), 24);
  assert.ok(layout.width > 400 && layout.height > 200);
  assert.ok([...layout.positions.values()].every(pos => Number.isFinite(pos.x) && Number.isFinite(pos.y)));
});
