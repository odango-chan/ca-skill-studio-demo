import test from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED_SEMANTIC_OPERATIONS,
  MODEL_PROPOSAL_SCHEMA,
  ModelProposalValidationError,
  parseModelProposal,
  validateModelProposal,
} from "../model-proposal.mjs";

function validProposal(overrides = {}) {
  return {
    schema: MODEL_PROPOSAL_SCHEMA,
    summary: "Add the missing route to the existing target node.",
    plan: ["Inspect the current Node and route.", "Add one outcome route."],
    operations: [{
      type: "stage.route.set",
      target: { nodeId: "create-session", stage: "operation", outcome: "COMMITTED" },
      payload: { targetNodeId: "verify-session" },
      rationale: "A successful mutation must lead to final-state verification.",
      references: ["procedure-current", "contract-goal"],
    }],
    assumptions: [],
    blockers: [],
    ...overrides,
  };
}

test("ModelProposal validates the private v1 schema and freezes a clone", () => {
  const input = validProposal();
  const result = validateModelProposal(input, {
    allowedContextIds: ["procedure-current", "contract-goal"],
  });
  assert.equal(result.schema, MODEL_PROPOSAL_SCHEMA);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.operations[0]), true);
  assert.equal(Object.isFrozen(input), false);
  assert.equal(ALLOWED_SEMANTIC_OPERATIONS.includes("stage.route.set"), true);
});

test("ModelProposal rejects unknown operations", () => {
  const input = validProposal({
    operations: [{ type: "file.write", target: { nodeId: "x" }, payload: {}, rationale: "bad", references: [] }],
  });
  assert.throws(
    () => validateModelProposal(input),
    (error) => error instanceof ModelProposalValidationError && error.code === "unsupported_operation",
  );
});

test("ModelProposal rejects host-owned source offsets and raw source fields", () => {
  const input = validProposal({
    operations: [{
      type: "stage.route.set",
      target: { nodeId: "create-session" },
      payload: { targetNodeId: "verify-session", sourceSpan: { start: 12, end: 20 } },
      rationale: "attempt to forge a source span",
      references: [],
    }],
  });
  assert.throws(
    () => validateModelProposal(input),
    (error) => error instanceof ModelProposalValidationError && error.code === "forbidden_authority_field",
  );
});

test("ModelProposal rejects arbitrary file paths and direct source patches", () => {
  const input = validProposal({
    operations: [{
      type: "node.add",
      target: { nodeId: "new-node" },
      payload: { path: "assurance/procedure.yaml", source: "nodes: {}" },
      rationale: "bad",
      references: [],
    }],
  });
  assert.throws(() => validateModelProposal(input), ModelProposalValidationError);
});

test("ModelProposal resolves every evidence reference against the supplied Context Pack", () => {
  assert.throws(
    () => validateModelProposal(validProposal(), { allowedContextIds: ["procedure-current"] }),
    (error) => error instanceof ModelProposalValidationError && error.code === "unknown_context_reference",
  );
});

test("ModelProposal rejects model-authored Change Set authority fields", () => {
  assert.throws(
    () => validateModelProposal(validProposal({ groups: [["op-1"]] })),
    (error) => error instanceof ModelProposalValidationError && error.code === "unknown_field",
  );
});

test("ModelProposal parser rejects invalid JSON and enforces proposal size", () => {
  assert.throws(() => parseModelProposal("{not-json"), ModelProposalValidationError);
  assert.throws(
    () => validateModelProposal(validProposal(), {
      allowedContextIds: ["procedure-current", "contract-goal"],
      maxSerializedBytes: 16,
    }),
    (error) => error instanceof ModelProposalValidationError && error.code === "proposal_too_large",
  );
});

test("ModelProposal accepts v1alpha5 Wait event.source only in the typed Wait event selector", () => {
  const waitProposal = validProposal({
    operations: [{
      type: "node.wait.set",
      target: { nodeId: "wait-for-update" },
      payload: { definition: {
        event: { source: "AMF", service: "nsmf-pdusession", operation: "UpdateSMContext" },
        timeout: "PT30S",
        routes: { TIMEOUT: "UNRESOLVED" },
      }},
      rationale: "Wait for the exact inbound event before entering the Node stages.",
      references: ["procedure-current", "contract-goal"],
    }],
  });
  const result = validateModelProposal(waitProposal, { allowedContextIds: ["procedure-current", "contract-goal"] });
  assert.equal(result.operations[0].type, "node.wait.set");
  assert.equal(result.operations[0].payload.definition.event.source, "AMF");
});

test("ModelProposal still rejects source authority fields outside a Wait event selector", () => {
  const invalid = validProposal({
    operations: [{
      type: "node.add",
      target: { nodeId: "new-node" },
      payload: { definition: { source: "arbitrary-source" } },
      rationale: "bad source field",
      references: [],
    }],
  });
  assert.throws(() => validateModelProposal(invalid),
    (error) => error instanceof ModelProposalValidationError && error.code === "forbidden_authority_field");
});


test("ModelProposal requires a semantic target and rejects prototype mutation keys", () => {
  const noTarget = validProposal({
    operations: [{
      type: "procedure.start.set",
      target: {},
      payload: { nodeId: "start-node" },
      rationale: "set the start node",
      references: [],
    }],
  });
  assert.throws(
    () => validateModelProposal(noTarget),
    (error) => error instanceof ModelProposalValidationError && error.code === "missing_target",
  );

  const prototypePayload = validProposal({
    operations: [{
      type: "node.add",
      target: { nodeId: "new-node" },
      payload: JSON.parse('{"__proto__":{"polluted":true}}'),
      rationale: "reject prototype-shaped payload",
      references: [],
    }],
  });
  assert.throws(
    () => validateModelProposal(prototypePayload),
    (error) => error instanceof ModelProposalValidationError && error.code === "forbidden_authority_field",
  );
});
