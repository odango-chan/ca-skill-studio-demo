import test from "node:test";
import assert from "node:assert/strict";
import { buildCompilerRepairTask, createProcedureAgent } from "../procedure-agent.mjs";

const changeSet = {
  summary: "Revise the failure route",
  operations: [{ type: "route.retarget", target: { nodeId: "check" }, payload: { to: "FAILED" } }],
};
const procedureError = {
  severity: "error", code: "ROUTE_TARGET_INVALID", path: "skills/demo/assurance/procedure.yaml",
  message: "Compiler source excerpt that was not disclosed",
};

test("a complete target error can drive one bounded refinement request", () => {
  const request = buildCompilerRepairTask("Repair the route", changeSet, {
    complete: true, state: "FAIL", diagnostics: [procedureError, procedureError, {
      severity: "error", code: "HIDDEN_FILE_ERROR", path: "assurance/contract.yaml",
    }],
  });
  assert.match(request, /REFINE THE PREVIOUS SEMANTIC PROPOSAL/);
  assert.match(request, /Repair the route/);
  assert.equal(request.match(/ROUTE_TARGET_INVALID/g)?.length, 1);
  assert.doesNotMatch(request, /HIDDEN_FILE_ERROR|not disclosed|skills\/demo/);
});

test("passes, incomplete checks, and over-budget proposals do not schedule repairs", () => {
  assert.equal(buildCompilerRepairTask("Repair", changeSet, { state: "PASS", complete: true }), null);
  assert.equal(buildCompilerRepairTask("Repair", changeSet, {
    state: "FAIL", complete: false, diagnostics: [procedureError],
  }), null);
  assert.equal(buildCompilerRepairTask("Repair", {
    ...changeSet, operations: [{ ...changeSet.operations[0], payload: { to: "x".repeat(3000) } }],
  }, { state: "FAIL", complete: true, diagnostics: [procedureError] }), null);
});


test("Agent catalog selection sends metadata first and only returns disclosed resources", async () => {
  const procedure = { id: "procedure-current", label: "assurance/procedure.yaml", text: "buffer" };
  const contract = { id: "contract", kind: "contract", label: "assurance/contract.yaml", text: "private file text" };
  const schema = { id: "schema", kind: "schema", label: "schemas/a.yaml", text: "schema bytes" };
  const pack = { procedure, resources: [contract, schema] };
  const manifest = [procedure, contract, schema];
  let ids = ["schema"];
  let requests = 0;
  const agent = createProcedureAgent({ modelClient: { async complete({ messages }) {
    requests += 1;
    assert.doesNotMatch(messages[1].content, /private file text|schema bytes|buffer/);
    return { content: JSON.stringify({ resourceIds: ids }) };
  } } });
  const input = { task: "Inspect schema", pack, manifest };
  await assert.rejects(agent.selectContext(input), /disclosure/);
  assert.equal(requests, 0);
  const selected = await agent.selectContext({ ...input, contextDisclosureAccepted: true });
  assert.deepEqual(selected.pack.resources, [schema]);
  assert.deepEqual(selected.manifest, [procedure, schema]);
  ids = ["unapproved"];
  await assert.rejects(agent.selectContext({ ...input, contextDisclosureAccepted: true }), /invalid Package/);
});
