import test from "node:test";
import assert from "node:assert/strict";
import { createProcedureAgent } from "../procedure-agent.mjs";
import { CONTEXT_PACK_SCHEMA } from "../context-pack.mjs";
import { MODEL_PROPOSAL_SCHEMA } from "../model-proposal.mjs";

function context() {
  const procedure = {
    id: "procedure-current",
    kind: "procedure",
    label: "assurance/procedure.yaml",
    digest: "a".repeat(64),
    text: "start: create-session\nnodes: {}\n",
  };
  const contract = {
    id: "contract-goal",
    kind: "contract",
    label: "assurance/contract.yaml",
    digest: "b".repeat(64),
    text: "goal: session.established\n",
  };
  return {
    pack: {
      schema: CONTEXT_PACK_SCHEMA,
      taskId: "task-1",
      revision: 2,
      languageTarget: "connectionagent.io/v1alpha4",
      procedure,
      resources: [contract],
    },
    manifest: [
      { id: procedure.id, kind: procedure.kind, label: procedure.label, digest: procedure.digest, bytes: 30 },
      { id: contract.id, kind: contract.kind, label: contract.label, digest: contract.digest, bytes: 27 },
    ],
  };
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
  const { pack, manifest } = context();
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
  const { pack, manifest } = context();
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
  const { pack, manifest } = context();
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
  const { pack, manifest } = context();
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
  const { pack, manifest } = context();
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
  const { pack, manifest } = context();
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
  const { pack, manifest } = context();
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

  const next = context();
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
