import test from "node:test";
import assert from "node:assert/strict";
import {
  CHANGE_SET_SCHEMA,
  ChangeSetConstructionError,
  createChangeSet,
} from "../change-set.mjs";
import { MODEL_PROPOSAL_SCHEMA } from "../model-proposal.mjs";

function proposalResult(overrides = {}) {
  return {
    taskId: "task-1",
    revision: 3,
    languageTarget: "connectionagent.io/v1alpha5",
    manifest: [
      {
        id: "procedure-current",
        kind: "procedure",
        label: "assurance/procedure.yaml",
        digest: "a".repeat(64),
        bytes: 100,
      },
      {
        id: "contract-goal",
        kind: "contract",
        label: "assurance/contract.yaml",
        digest: "b".repeat(64),
        bytes: 30,
      },
      {
        id: "ref-23502",
        kind: "reference",
        label: "references/ts-23.502.md",
        digest: "c".repeat(64),
        bytes: 80,
      },
      {
        id: "dep-owner",
        kind: "dependency",
        label: "dependency:provider.session-read@1.2.3",
        digest: "d".repeat(64),
        bytes: 20,
      },
    ],
    proposal: {
      schema: MODEL_PROPOSAL_SCHEMA,
      summary: "Add the COMMITTED route to verification.",
      plan: ["Inspect the current Node.", "Add the route."],
      operations: [{
        type: "stage.route.set",
        target: { nodeId: "create-session", stage: "operation", outcome: "COMMITTED" },
        payload: { targetNodeId: "verify-session" },
        rationale: "The committed operation proceeds to final verification.",
        references: ["procedure-current", "contract-goal", "ref-23502"],
      }],
      assumptions: [],
      blockers: [],
    },
    ...overrides,
  };
}

function hostBase(overrides = {}) {
  return {
    documentUri: "file:///workspace/skill/assurance/procedure.yaml",
    documentVersion: 12,
    packageGeneration: 5,
    sourceDigest: "sha256:" + "a".repeat(64),
    ...overrides,
  };
}

test("Change Set stamps base and scope from Host metadata, not model output", () => {
  const result = createChangeSet({
    proposalResult: proposalResult(),
    hostBase: hostBase(),
    operationIdFactory: () => "op-host-1",
  });
  assert.equal(result.schema, CHANGE_SET_SCHEMA);
  assert.equal(result.taskId, "task-1");
  assert.equal(result.revision, 3);
  assert.equal(result.base.documentUri, "file:///workspace/skill/assurance/procedure.yaml");
  assert.equal(result.base.documentVersion, 12);
  assert.equal(result.base.packageGeneration, 5);
  assert.equal(result.base.sourceDigest, "sha256:" + "a".repeat(64));
  assert.equal(result.base.languageTarget, "connectionagent.io/v1alpha5");
  assert.deepEqual(result.scope.writePaths, ["assurance/procedure.yaml"]);
  assert.deepEqual(result.scope.readPaths, [
    "assurance/contract.yaml",
    "references/ts-23.502.md",
  ]);
});

test("Change Set assigns operation IDs and initializes Host-owned grouping and validation", () => {
  const result = createChangeSet({
    proposalResult: proposalResult(),
    hostBase: hostBase(),
    operationIdFactory: (index) => "op-host-" + index,
  });
  assert.equal(result.operations[0].id, "op-host-0");
  assert.deepEqual(result.groups, []);
  assert.deepEqual(result.validation, { state: "NOT_RUN", diagnostics: [] });
  assert.equal("id" in proposalResult().proposal.operations[0], false);
});

test("Change Set rejects duplicate or malformed Host operation IDs", () => {
  assert.throws(
    () => createChangeSet({
      proposalResult: proposalResult({
        proposal: {
          ...proposalResult().proposal,
          operations: [proposalResult().proposal.operations[0], proposalResult().proposal.operations[0]],
        },
      }),
      hostBase: hostBase(),
      operationIdFactory: () => "same-id",
    }),
    (error) => error instanceof ChangeSetConstructionError && error.code === "invalid_operation_id",
  );
});

test("Change Set rejects a Host source digest that is stale against the disclosed Procedure", () => {
  assert.throws(
    () => createChangeSet({
      proposalResult: proposalResult(),
      hostBase: hostBase({ sourceDigest: "sha256:" + "f".repeat(64) }),
    }),
    (error) => error instanceof ChangeSetConstructionError && error.code === "stale_source_digest",
  );
});

test("Change Set requires current Host document and Package revisions", () => {
  for (const value of [
    hostBase({ documentVersion: 0 }),
    hostBase({ packageGeneration: 0 }),
    hostBase({ documentUri: "" }),
    hostBase({ workspaceEdit: {} }),
  ]) {
    assert.throws(
      () => createChangeSet({ proposalResult: proposalResult(), hostBase: value }),
      ChangeSetConstructionError,
    );
  }
});

test("Change Set rejects proposal references that are absent from the exact Context manifest", () => {
  const value = proposalResult();
  value.proposal.operations[0].references = ["not-in-manifest"];
  assert.throws(
    () => createChangeSet({ proposalResult: value, hostBase: hostBase() }),
    (error) => error.code === "unknown_context_reference",
  );
});

test("Change Set is immutable and cannot be applied as a file-write command", () => {
  const result = createChangeSet({
    proposalResult: proposalResult(),
    hostBase: hostBase(),
    operationIdFactory: () => "op-host-1",
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.base), true);
  assert.equal(Object.isFrozen(result.operations[0]), true);
  assert.equal("apply" in result, false);
  assert.equal("writeFile" in result, false);
});

test("Change Set rejects unsupported or missing Context manifest", () => {
  assert.throws(
    () => createChangeSet({
      proposalResult: proposalResult({ languageTarget: "legacy" }),
      hostBase: hostBase(),
    }),
    (error) => error instanceof ChangeSetConstructionError && error.code === "invalid_proposal_result",
  );
  assert.throws(
    () => createChangeSet({
      proposalResult: proposalResult({ manifest: [] }),
      hostBase: hostBase(),
    }),
    (error) => error instanceof ChangeSetConstructionError && error.code === "invalid_manifest",
  );
});
