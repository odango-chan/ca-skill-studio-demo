import test from "node:test";
import assert from "node:assert/strict";
import { createProcedureAgent } from "../procedure-agent.mjs";
import { CONTEXT_PACK_SCHEMA, buildContextPack } from "../context-pack.mjs";
import { MODEL_PROPOSAL_SCHEMA } from "../model-proposal.mjs";

async function context() {
  const built = await buildContextPack({
    taskId: "task-1",
    revision: 2,
    languageTarget: "connectionagent.io/v1alpha4",
    procedure: {
      path: "assurance/procedure.yaml",
      documentVersion: 7,
      text: "start: create-session\nnodes: {}\n",
    },
    resources: [{
      id: "contract-goal",
      kind: "contract",
      path: "assurance/contract.yaml",
      selected: true,
      content: "goal: session.established\n",
    }],
    maxBytes: 131072,
  });
  return { pack: built.pack, manifest: built.manifest };
}

function proposal(references = ["procedure-current", "contract-goal"]) {
  return JSON.stringify({
    schema: MODEL_PROPOSAL_SCHEMA,
    summary: "Add one route to the final-state verification Node.",
    plan: ["Inspect the current graph.", "Add the COMMITTED route."],
    operations: [{
      type: "stage.route.set",
      target: { nodeId: "create-session", stage: "operation", outcome: "COMMITTED" },
      payload: { targetNodeId: "verify-session" },
      rationale: "The successful operation should proceed to final-state verification.",
      references,
    }],
    assumptions: [],
    blockers: [],
  });
}

test("Procedure Agent requires explicit Context Pack disclosure before any model call", async () => {
  let called = false;
  const agent = createProcedureAgent({
    modelClient: { complete: async () => { called = true; return proposal(); } },
  });
  const { pack, manifest } = await context();
  await assert.rejects(
    agent.propose({ task: "Add a route", contextPack: pack, contextManifest: manifest }),
    /Context disclosure must be explicitly accepted/,
  );
  assert.equal(called, false);
});

test("Procedure Agent validates the Context Pack and returns a typed proposal", async () => {
  let request;
  const agent = createProcedureAgent({
    modelClient: { complete: async (value) => { request = value; return proposal(); } },
  });
  const { pack, manifest } = await context();
  const result = await agent.propose({
    task: "Add the COMMITTED route to verification.",
    contextPack: pack,
    contextManifest: manifest,
    contextDisclosureAccepted: true,
    maxTokens: 1000,
  });
  assert.equal(result.taskId, "task-1");
  assert.equal(result.revision, 2);
  assert.equal(result.proposal.operations[0].type, "stage.route.set");
  assert.equal(request.messages[0].role, "system");
  assert.match(request.messages[0].content, /3GPP action boundaries/);
  assert.match(request.messages[1].content, /assurance\/procedure.yaml/);
  assert.deepEqual(request.responseFormat, { type: "json_object" });
  assert.equal(request.contextDisclosureAccepted, true);
});

test("Procedure Agent rejects proposal references outside the Context Pack manifest", async () => {
  const agent = createProcedureAgent({
    modelClient: { complete: async () => proposal(["unseen-file"]) },
  });
  const { pack, manifest } = await context();
  await assert.rejects(
    agent.propose({
      task: "Add a route",
      contextPack: pack,
      contextManifest: manifest,
      contextDisclosureAccepted: true,
    }),
    (error) => error.code === "unknown_context_reference",
  );
});

test("Procedure Agent rejects a forged or incomplete disclosure manifest before calling the model", async () => {
  let called = false;
  const agent = createProcedureAgent({
    modelClient: { complete: async () => { called = true; return proposal(); } },
  });
  const { pack, manifest } = await context();
  await assert.rejects(
    agent.propose({
      task: "Add a route",
      contextPack: pack,
      contextManifest: [manifest[0]],
      contextDisclosureAccepted: true,
    }),
    /manifest does not match/,
  );
  assert.equal(called, false);
});

test("Procedure Agent rejects malformed model output and exposes no write capability", async () => {
  const agent = createProcedureAgent({ modelClient: { complete: async () => "not json" } });
  const { pack, manifest } = await context();
  await assert.rejects(
    agent.propose({
      task: "Add a route",
      contextPack: pack,
      contextManifest: manifest,
      contextDisclosureAccepted: true,
    }),
    (error) => error.code === "invalid_json",
  );
  assert.equal("apply" in agent, false);
  assert.equal("writeFile" in agent, false);
});


test("Procedure Agent rejects Context Pack content whose digest no longer matches", async () => {
  let called = false;
  const agent = createProcedureAgent({
    modelClient: { complete: async () => { called = true; return proposal(); } },
  });
  const { pack, manifest } = await context();
  pack.procedure.text = "tampered: true\n";
  await assert.rejects(
    agent.propose({
      task: "Add a route",
      contextPack: pack,
      contextManifest: manifest,
      contextDisclosureAccepted: true,
    }),
    /does not match its manifest digest or byte count/,
  );
  assert.equal(called, false);
});

test("Procedure Agent rejects untrusted extra Context Pack fields and sensitive labels", async () => {
  let called = false;
  const agent = createProcedureAgent({
    modelClient: { complete: async () => { called = true; return proposal(); } },
  });
  const { pack, manifest } = await context();
  pack.writePaths = ["assurance/procedure.yaml"];
  await assert.rejects(
    agent.propose({
      task: "Add a route",
      contextPack: pack,
      contextManifest: manifest,
      contextDisclosureAccepted: true,
    }),
    /Invalid or unsupported Context Pack/,
  );
  assert.equal(called, false);

  const next = await context();
  next.pack.resources[0].label = "references/api-secret.md";
  next.manifest[1].label = "references/api-secret.md";
  await assert.rejects(
    agent.propose({
      task: "Add a route",
      contextPack: next.pack,
      contextManifest: next.manifest,
      contextDisclosureAccepted: true,
    }),
    /manifest does not match/,
  );
  assert.equal(called, false);
});


test("Context Pack builder output can be consumed by the Procedure Agent without changing its manifest", async () => {
  const built = await buildContextPack({
    taskId: "integrated-task",
    revision: 1,
    languageTarget: "connectionagent.io/v1alpha4",
    procedure: {
      path: "assurance/procedure.yaml",
      documentVersion: 4,
      text: "start: create-session\nnodes: {}\n",
    },
    resources: [{
      id: "contract-goal",
      kind: "contract",
      path: "assurance/contract.yaml",
      selected: true,
      content: "goal: session.established\n",
    }],
    maxBytes: 131072,
  });
  const agent = createProcedureAgent({
    modelClient: { complete: async () => proposal() },
  });
  const result = await agent.propose({
    task: "Add the successful route to verification.",
    contextPack: built.pack,
    contextManifest: built.manifest,
    contextDisclosureAccepted: true,
  });
  assert.equal(result.taskId, "integrated-task");
  assert.deepEqual(result.manifest, built.manifest);
  assert.equal(result.proposal.operations[0].type, "stage.route.set");
});
