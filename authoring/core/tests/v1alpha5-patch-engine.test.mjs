import test from "node:test";
import assert from "node:assert/strict";
import {
  materializeAcceptedPatchGroups,
  PatchPlanningError,
  planV1Alpha5Patch,
} from "../v1alpha5-patch-engine.mjs";
import { CHANGE_SET_SCHEMA } from "../change-set.mjs";

const SOURCE = String.raw`# Keep this header comment.
start: create-session
nodes:
  create-session:
    operation:
      tool: ca::smf.session.create # keep tool comment
      arguments:
        supi: context.supi # keep argument comment
        dnn: "input.dnn"
      routes:
        FAILED: FAILED
        COMMITTED: FAILED
    postcondition:
      predicates:
        - predicate: session.created
          arguments:
            - create-session.operation.output
      routes:
        FAIL: FAILED
        UNKNOWN: UNRESOLVED
        PASS: SUCCEEDED
  verify-session:
    postcondition:
      predicates:
        - predicate: session.verified
          arguments:
            - context.supi
      routes:
        FAIL: FAILED
        UNKNOWN: UNRESOLVED
        PASS: SUCCEEDED
# Keep this footer comment.
`;


const SOURCE_WITH_WAIT = SOURCE.replace(
  "  create-session:\n",
  String.raw`  create-session:
    wait:
      event:
        source: AMF
        service: nsmf-pdusession
        operation: UpdateSMContext
      timeout: PT30S # preserve wait timeout comment
      routes:
        TIMEOUT: FAILED
`,
);

const SOURCE_WITH_EMPTY_RESPONSE = SOURCE_WITH_WAIT.replace(
  "      timeout: PT30S # preserve wait timeout comment",
  "      response: {}\n      timeout: PT30S # preserve wait timeout comment",
);

async function digest(text) {
  const value = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(value)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

async function makeChangeSet(operations, source = SOURCE, overrides = {}) {
  return {
    schema: CHANGE_SET_SCHEMA,
    taskId: "task-1",
    revision: 1,
    base: {
      documentUri: "file:///workspace/skill/assurance/procedure.yaml",
      documentVersion: 7,
      sourceDigest: "sha256:" + await digest(source),
      packageGeneration: 3,
      languageTarget: "connectionagent.io/v1alpha5",
    },
    scope: { writePaths: ["assurance/procedure.yaml"], readPaths: [] },
    operations: operations.map((operation, index) => ({
      id: "op-" + (index + 1),
      ...operation,
    })),
    groups: [],
    validation: { state: "NOT_RUN", diagnostics: [] },
    ...overrides,
  };
}

function op(type, target, payload) {
  return { type, target, payload, rationale: "Test semantic edit.", references: [] };
}

async function plan(operations, source = SOURCE, overrides = {}) {
  const { changeSet: changeSetOverrides, ...hostOverrides } = overrides;
  return planV1Alpha5Patch({
    source,
    changeSet: await makeChangeSet(operations, source, changeSetOverrides),
    currentDocumentUri: "file:///workspace/skill/assurance/procedure.yaml",
    currentDocumentVersion: 7,
    currentPackageGeneration: 3,
    ...hostOverrides,
  });
}

test("stage.route.set changes only the targeted scalar and preserves comments and unrelated bytes", async () => {
  const result = await plan([
    op("stage.route.set",
      { nodeId: "create-session", stage: "operation", outcome: "COMMITTED" },
      { targetNodeId: "verify-session" }),
  ]);
  assert.equal(result.state, "READY");
  assert.ok(result.candidateSource.includes("COMMITTED: verify-session"));
  assert.ok(result.candidateSource.includes("# Keep this header comment."));
  assert.ok(result.candidateSource.includes("# keep tool comment"));
  assert.ok(result.candidateSource.includes("# keep argument comment"));
  assert.ok(result.candidateSource.includes("# Keep this footer comment."));
  assert.equal(result.groups.length, 1);
});

test("procedure.start.set changes the live start scalar without reserializing the document", async () => {
  const result = await plan([
    op("procedure.start.set", { nodeId: "verify-session" }, {}),
  ]);
  assert.ok(result.candidateSource.startsWith("# Keep this header comment.\nstart: verify-session\n"));
  assert.ok(result.candidateSource.includes("tool: ca::smf.session.create # keep tool comment"));
});

test("stage.argument.set updates one existing argument value", async () => {
  const result = await plan([
    op("stage.argument.set",
      { nodeId: "create-session", stage: "operation", argumentName: "dnn" },
      { expression: "input.requestedDnn" }),
  ]);
  assert.ok(result.candidateSource.includes('dnn: "input.requestedDnn"'));
  assert.ok(result.candidateSource.includes("supi: context.supi # keep argument comment"));
});

test("stage.callable.set updates the existing callable field without switching its kind", async () => {
  const result = await plan([
    op("stage.callable.set",
      { nodeId: "create-session", stage: "operation" },
      { kind: "tool", id: "ca::smf.session.create.v2" }),
  ]);
  assert.ok(result.candidateSource.includes("tool: ca::smf.session.create.v2 # keep tool comment"));
});

test("predicate.call.arguments.set preserves positional arity and comments", async () => {
  const result = await plan([
    op("predicate.call.arguments.set",
      { nodeId: "create-session", stage: "postcondition", predicateId: "session.created", callIndex: 0 },
      { arguments: ["create-session.operation.result"] }),
  ]);
  assert.ok(result.candidateSource.includes("- create-session.operation.result"));
  assert.ok(result.candidateSource.includes("# Keep this footer comment."));
});

test("predicate.call.add appends a new call without reserializing existing calls", async () => {
  const result = await plan([
    op("predicate.call.add",
      { nodeId: "verify-session", stage: "postcondition" },
      { predicateId: "session.has-context", arguments: ["context.supi"] }),
  ]);
  assert.ok(result.candidateSource.includes("predicate: session.has-context"));
  assert.ok(result.candidateSource.includes("predicate: session.verified"));
});

test("node.add and its dependent route edit form one atomic group", async () => {
  const result = await plan([
    op("node.add", { nodeId: "notify-session" }, {
      definition: {
        operation: {
          tool: "ca::smf.session.notify",
          arguments: { supi: "context.supi" },
          routes: { FAILED: "FAILED", SUCCEEDED: "SUCCEEDED" },
        },
      },
    }),
    op("stage.route.set",
      { nodeId: "create-session", stage: "operation", outcome: "COMMITTED" },
      { targetNodeId: "notify-session" }),
  ]);
  assert.ok(result.candidateSource.includes("notify-session:"));
  assert.ok(result.candidateSource.includes("COMMITTED: notify-session"));
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].operationIds.length, 2);
});

test("node.stage.add appends a new stage to an existing Node", async () => {
  const result = await plan([
    op("node.stage.add", { nodeId: "verify-session", stage: "observation" }, {
      definition: {
        tool: "ca::smf.session.read",
        arguments: { supi: "context.supi" },
      },
    }),
  ]);
  assert.ok(result.candidateSource.includes("observation:"));
  assert.ok(result.candidateSource.includes("tool: ca::smf.session.read"));
});

test("stale document version, Package generation and source digest fail closed", async () => {
  for (const overrides of [
    { currentDocumentVersion: 8 },
    { currentPackageGeneration: 4 },
    { source: SOURCE + "# changed\n" },
  ]) {
    await assert.rejects(
      plan([op("procedure.start.set", { nodeId: "verify-session" }, {})], SOURCE, overrides),
      PatchPlanningError,
    );
  }
});

test("unsupported callable kind changes and overlapping edits are rejected", async () => {
  await assert.rejects(
    plan([op("stage.callable.set",
      { nodeId: "create-session", stage: "operation" },
      { kind: "script", id: "scripts/create.py" })]),
    (error) => error instanceof PatchPlanningError && error.code === "callable_kind_change_unsupported",
  );
  await assert.rejects(
    plan([
      op("stage.argument.set",
        { nodeId: "create-session", stage: "operation", argumentName: "dnn" },
        { expression: "input.a" }),
      op("stage.argument.set",
        { nodeId: "create-session", stage: "operation", argumentName: "dnn" },
        { expression: "input.b" }),
    ]),
    (error) => error instanceof PatchPlanningError && error.code === "patch_overlap",
  );
});

test("accepted atomic groups materialize only their source edits", async () => {
  const result = await plan([
    op("procedure.start.set", { nodeId: "verify-session" }, {}),
    op("stage.argument.set",
      { nodeId: "create-session", stage: "operation", argumentName: "dnn" },
      { expression: "input.newDnn" }),
  ]);
  assert.equal(result.groups.length, 2);
  const selected = await materializeAcceptedPatchGroups({
    source: SOURCE,
    plan: result,
    acceptedGroupIds: [result.groups[1].id],
  });
  assert.ok(selected.source.includes('dnn: "input.newDnn"'));
  assert.ok(selected.source.startsWith("# Keep this header comment.\nstart: create-session\n"));
});

test("Patch Engine rejects a non-v1alpha5 write scope and malformed candidate routes", async () => {
  await assert.rejects(
    plan([op("procedure.start.set", { nodeId: "verify-session" }, {})], SOURCE, {
      changeSet: {
        scope: { writePaths: ["assurance/contract.yaml"], readPaths: [] },
      },
    }),
    (error) => error instanceof PatchPlanningError && error.code === "change_set_scope_invalid",
  );
  await assert.rejects(
    plan([op("stage.route.set",
      { nodeId: "create-session", stage: "operation", outcome: "COMMITTED" },
      { targetNodeId: "missing-node" })]),
    (error) => error instanceof PatchPlanningError && error.code === "route_target_invalid",
  );
});


test("stage.argument.set appends a missing named argument to the existing mapping", async () => {
  const result = await plan([
    op("stage.argument.set",
      { nodeId: "create-session", stage: "operation", argumentName: "sst" },
      { expression: "input.sst" }),
  ]);
  assert.ok(result.candidateSource.includes("sst: input.sst"));
  assert.ok(result.candidateSource.includes('dnn: "input.dnn"'));
});

test("stage.route.set can add a missing outcome to an existing routes mapping", async () => {
  const result = await plan([
    op("stage.route.set",
      { nodeId: "create-session", stage: "operation", outcome: "UNKNOWN" },
      { targetNodeId: "UNRESOLVED" }),
  ]);
  assert.ok(result.candidateSource.includes("UNKNOWN: UNRESOLVED"));
  assert.ok(result.candidateSource.includes("COMMITTED: FAILED"));
});


test("Patch Engine rejects no-op scalar updates and duplicate nested route additions", async () => {
  await assert.rejects(
    plan([
      op("stage.route.set",
        { nodeId: "create-session", stage: "operation", outcome: "COMMITTED" },
        { targetNodeId: "FAILED" }),
    ]),
    (error) => error instanceof PatchPlanningError && error.code === "no_op_edit",
  );
  await assert.rejects(
    plan([
      op("stage.route.set",
        { nodeId: "create-session", stage: "operation", outcome: "UNKNOWN" },
        { targetNodeId: "UNRESOLVED" }),
      op("stage.route.set",
        { nodeId: "create-session", stage: "operation", outcome: "UNKNOWN" },
        { targetNodeId: "FAILED" }),
    ]),
    (error) => error instanceof PatchPlanningError && error.code === "duplicate_append_key",
  );
});


test("node.wait.set adds a valid Node-entry Wait without creating a fifth business stage", async () => {
  const result = await plan([
    op("node.wait.set", { nodeId: "verify-session" }, {
      definition: {
        event: { source: "AMF", service: "nsmf-pdusession", operation: "UpdateSMContext" },
        timeout: "PT30S",
        routes: { TIMEOUT: "UNRESOLVED" },
      },
    }),
  ]);
  assert.ok(result.candidateSource.includes("wait:"));
  assert.ok(result.candidateSource.includes("operation: UpdateSMContext"));
  assert.ok(result.candidateSource.includes("TIMEOUT: UNRESOLVED"));
  assert.ok(result.candidateSource.includes("postcondition:"));
});

test("node.wait.timeout.set and node.wait.event.set patch only their scalar fields and preserve adjacent comments", async () => {
  const timeoutResult = await plan([
    op("node.wait.timeout.set", { nodeId: "create-session" }, { timeout: "PT1M" }),
  ], SOURCE_WITH_WAIT);
  assert.ok(timeoutResult.candidateSource.includes("timeout: PT1M # preserve wait timeout comment"));
  assert.ok(timeoutResult.candidateSource.includes("operation: UpdateSMContext"));

  const eventResult = await plan([
    op("node.wait.event.set", { nodeId: "create-session" }, {
      event: { source: "AMF", service: "nsmf-pdusession", operation: "CreateSMContext" },
    }),
  ], SOURCE_WITH_WAIT);
  assert.ok(eventResult.candidateSource.includes("source: SMF"));
  assert.ok(eventResult.candidateSource.includes("service: nsmf-pdusession"));
  assert.ok(eventResult.candidateSource.includes("operation: CreateSMContext"));
  assert.ok(eventResult.candidateSource.includes("timeout: PT30S # preserve wait timeout comment"));
});

test("node.wait.timeout-route.set changes only the TIMEOUT control edge", async () => {
  const result = await plan([
    op("node.wait.timeout-route.set", { nodeId: "create-session" }, { targetNodeId: "verify-session" }),
  ], SOURCE_WITH_WAIT);
  assert.ok(result.candidateSource.includes("TIMEOUT: verify-session"));
  assert.ok(result.candidateSource.includes("timeout: PT30S"));
});

test("node.wait.response.set adds the optional response boundary as a separate Wait field", async () => {
  const result = await plan([
    op("node.wait.response.set", { nodeId: "create-session" }, { after: "verify-session" }),
  ], SOURCE_WITH_WAIT);
  assert.ok(result.candidateSource.includes("response:"));
  assert.ok(result.candidateSource.includes("after: verify-session"));
  assert.ok(result.candidateSource.includes("TIMEOUT: FAILED"));
});

test("node.wait.set can add a Wait to a new Node together with its required business stage", async () => {
  const result = await plan([
    op("node.add", { nodeId: "wait-for-update" }, {
      definition: {
        wait: {
          event: { source: "AMF", service: "nsmf-pdusession", operation: "UpdateSMContext" },
          timeout: "P1DT2H30M",
          routes: { TIMEOUT: "UNRESOLVED" },
        },
        operation: {
          tool: "ca::smf.session.update",
          arguments: { supi: "wait-for-update.wait.output.supi" },
          routes: { FAILED: "FAILED", SUCCEEDED: "SUCCEEDED" },
        },
      },
    }),
  ]);
  assert.ok(result.candidateSource.includes("wait-for-update:"));
  assert.ok(result.candidateSource.includes("wait:"));
  assert.ok(result.candidateSource.includes("wait.output.supi"));
});

test("Wait declarations reject invalid fixed durations and forbidden timeout outcomes", async () => {
  for (const timeout of ["PT0S", "PT01M", "P1M", "P1Y", "P1W", "PT0.5S", "P1DT", "P"]) {
    await assert.rejects(
      plan([op("node.wait.set", { nodeId: "verify-session" }, {
        definition: {
          event: { source: "AMF", service: "nsmf-pdusession", operation: "UpdateSMContext" },
          timeout,
          routes: { TIMEOUT: "UNRESOLVED" },
        },
      })]),
      PatchPlanningError,
      timeout,
    );
  }
  for (const targetNodeId of ["SUCCEEDED", "EVENT_RECEIVED"]) {
    await assert.rejects(
      plan([op("node.wait.set", { nodeId: "verify-session" }, {
        definition: {
          event: { source: "AMF", service: "nsmf-pdusession", operation: "UpdateSMContext" },
          timeout: "PT30S",
          routes: { TIMEOUT: targetNodeId },
        },
      })]),
      PatchPlanningError,
      targetNodeId,
    );
  }
});

test("Wait-bearing Nodes require a business stage and exact Wait route shape", async () => {
  await assert.rejects(
    plan([op("node.add", { nodeId: "wait-only" }, {
      definition: {
        wait: {
          event: { source: "AMF", service: "nsmf-pdusession", operation: "UpdateSMContext" },
          timeout: "PT30S",
          routes: { TIMEOUT: "FAILED" },
        },
      },
    })]),
    (error) => error instanceof PatchPlanningError && error.code === "node_definition_invalid",
  );
  await assert.rejects(
    plan([op("node.wait.set", { nodeId: "verify-session" }, {
      definition: {
        event: { source: "AMF", service: "nsmf-pdusession", operation: "UpdateSMContext" },
        timeout: "PT30S",
        routes: { TIMEOUT: "FAILED", EVENT_RECEIVED: "SUCCEEDED" },
      },
    })]),
    PatchPlanningError,
  );
});

test("Wait response boundary and timeout targets must resolve to declared Nodes or permitted stopping terminals", async () => {
  await assert.rejects(
    plan([op("node.wait.set", { nodeId: "verify-session" }, {
      definition: {
        event: { source: "AMF", service: "nsmf-pdusession", operation: "UpdateSMContext" },
        timeout: "PT30S",
        response: { after: "missing-node" },
        routes: { TIMEOUT: "FAILED" },
      },
    })]),
    (error) => error instanceof PatchPlanningError && error.code === "wait_response_invalid",
  );
  await assert.rejects(
    plan([op("node.wait.set", { nodeId: "verify-session" }, {
      definition: {
        event: { source: "AMF", service: "nsmf-pdusession", operation: "UpdateSMContext" },
        timeout: "PT30S",
        routes: { TIMEOUT: "missing-node" },
      },
    })]),
    (error) => error instanceof PatchPlanningError && error.code === "wait_timeout_route_invalid",
  );
});

test("all Wait field edits on one Node form a single atomic Change Set group", async () => {
  const result = await plan([
    op("node.wait.timeout.set", { nodeId: "create-session" }, { timeout: "PT1M" }),
    op("node.wait.timeout-route.set", { nodeId: "create-session" }, { targetNodeId: "verify-session" }),
  ], SOURCE_WITH_WAIT);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].operationIds.length, 2);
});


test("node.wait.response.set fills an existing empty response mapping", async () => {
  const result = await plan([
    op("node.wait.response.set", { nodeId: "create-session" }, { after: "verify-session" }),
  ], SOURCE_WITH_EMPTY_RESPONSE);
  assert.match(result.candidateSource, /response:\n\s+after: verify-session/);
});
