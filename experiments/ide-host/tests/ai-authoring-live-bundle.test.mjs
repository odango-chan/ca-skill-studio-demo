import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { once } from "node:events";

const bundle = resolve("dist/ai-authoring-live-smoke-windows/ai-authoring-live-gateway-smoke.mjs");
const proposal = {
  schema: "ca-studio.ai-model-proposal/v1",
  summary: "Change the synthetic final-node failure route.",
  plan: ["Update only the final postcondition FAIL route."],
  operations: [{
    type: "stage.route.set",
    target: { nodeId: "final", stage: "postcondition", outcome: "FAIL" },
    payload: { targetNodeId: "FAILED" },
    rationale: "Maintain the synthetic Procedure while checking a deterministic patch.",
    references: ["procedure-current"]
  }],
  assumptions: [],
  blockers: []
};

test("portable Windows smoke bundle calls Gateway through real Procedure Agent and patches synthetic source", { timeout: 20000 }, async () => {
  assert.equal(existsSync(bundle), true, "CI must build portable bundle before this test");
  const received = [];
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" ||
        request.url !== "/opencode-go/openai/v1/chat/completions") {
      response.writeHead(404).end();
      return;
    }
    let raw = "";
    for await (const chunk of request) raw += chunk.toString();
    const payload = JSON.parse(raw);
    received.push({ payload, headers: request.headers });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      id: "portable-authoring-bundle-smoke",
      object: "chat.completion",
      model: payload.model,
      choices: [{ index: 0, finish_reason: "stop", message: {
        role: "assistant", content: JSON.stringify(proposal)
      } }]
    }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const port = server.address().port;
    const child = spawn(process.execPath, [bundle], {
      env: {
        ...process.env,
        STUDIO_AI_GATEWAY_URL: "http://127.0.0.1:" + port + "/opencode-go/openai",
        STUDIO_AI_MODEL_ID: "synthetic-test-model",
        STUDIO_AI_GATEWAY_TOKEN: ""
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk.toString(); });
    child.stderr.on("data", chunk => { stderr += chunk.toString(); });
    const [code, signal] = await once(child, "exit");
    assert.equal(signal, null, "The portable smoke must exit normally");
    assert.equal(code, 0, "Portable smoke failed: " + stderr.slice(0, 500));
    assert.equal(received.length, 1, "Expected exactly one model request");
    assert.equal(received[0].payload.model, "synthetic-test-model");
    assert.equal(received[0].payload.response_format?.type, "json_object");
    assert.equal(received[0].payload.stream, false);
    assert.match(received[0].headers["x-opencode-session"] ?? "", /^studio-live-[a-f0-9-]{36}$/);
    assert.equal(received[0].payload.messages[1].content.includes("CONTEXT ITEM procedure-current"), true);
    const line = stdout.split("\n").find(item => item.startsWith("STUDIO_AI_AUTHORING_LIVE_GATEWAY_SMOKE "));
    assert.ok(line, "Missing live-smoke structured outcome: " + stdout.slice(0, 500));
    const result = JSON.parse(line.replace(/^STUDIO_AI_AUTHORING_LIVE_GATEWAY_SMOKE /, ""));
    assert.equal(result.providerRequest, "PASS");
    assert.equal(result.responseEnvelope, "PASS");
    assert.equal(result.modelProposalSchema, "PASS");
    assert.equal(result.sourcePatchPreview, "PASS");
    assert.equal(result.selectedGroupCount, 1);
    assert.equal(result.syntheticOnly, true);
    assert.equal(result.compilerCheck, "NOT_RUN");
    assert.equal(result.nativeWorkspaceEdit, "NOT_RUN");
  } finally {
    await new Promise(resolveClose => server.close(resolveClose));
  }
});
