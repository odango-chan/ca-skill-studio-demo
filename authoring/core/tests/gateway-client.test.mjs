import test from "node:test";
import assert from "node:assert/strict";
import { createGatewayModelClient, GatewayRequestError } from "../gateway-client.mjs";

test("Gateway client requires explicit context disclosure before sending", async () => {
  let called = false;
  const client = createGatewayModelClient({
    gatewayBaseUrl: "https://ai-gateway.example",
    getTurnstileToken: async () => "challenge-token",
    fetchImpl: async () => { called = true; return Response.json({ choices: [] }); },
  });
  await assert.rejects(
    client.complete({ messages: [{ role: "user", content: "hello" }] }),
    /Context disclosure must be explicitly accepted/,
  );
  assert.equal(called, false);
});

test("Gateway client sends only supported fields and a Turnstile token", async () => {
  let request;
  const client = createGatewayModelClient({
    gatewayBaseUrl: "https://ai-gateway.example/",
    getTurnstileToken: async () => "challenge-token",
    fetchImpl: async (url, init) => {
      request = { url, init };
      return Response.json({ choices: [{ message: { content: "{\"schema\":\"ca-studio.ai-model-proposal/v1\"}" } }] });
    },
  });
  const content = await client.complete({
    contextDisclosureAccepted: true,
    messages: [{ role: "user", content: "Change the route." }],
    maxTokens: 9000,
    responseFormat: { type: "json_object" },
  });
  assert.equal(content, "{\"schema\":\"ca-studio.ai-model-proposal/v1\"}");
  assert.equal(request.url, "https://ai-gateway.example/v1/chat/completions");
  assert.equal(request.init.headers["x-turnstile-token"], "challenge-token");
  assert.equal("authorization" in request.init.headers, false);
  const body = JSON.parse(request.init.body);
  assert.equal(body.stream, false);
  assert.equal(body.max_tokens, 2048);
  assert.equal("model" in body, false);
  assert.equal("tools" in body, false);
  assert.deepEqual(body.response_format, { type: "json_object" });
});

test("Gateway client clamps output tokens to the configured ceiling", async () => {
  let body;
  const client = createGatewayModelClient({
    gatewayBaseUrl: "https://ai-gateway.example",
    getTurnstileToken: async () => "challenge-token",
    maxOutputTokens: 512,
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return Response.json({ choices: [{ message: { content: "ok" } }] });
    },
  });
  await client.complete({
    contextDisclosureAccepted: true,
    messages: [{ role: "user", content: "hello" }],
    maxTokens: 1024,
  });
  assert.equal(body.max_tokens, 512);
});

test("Gateway client sanitizes structured Gateway errors", async () => {
  const client = createGatewayModelClient({
    gatewayBaseUrl: "https://ai-gateway.example",
    getTurnstileToken: async () => "challenge-token",
    fetchImpl: async () => Response.json({
      error: { code: "rate_limit_exceeded", message: "do not trust raw message", request_id: "req-123" },
    }, { status: 429 }),
  });
  await assert.rejects(
    client.complete({ contextDisclosureAccepted: true, messages: [{ role: "user", content: "hello" }] }),
    (error) => error instanceof GatewayRequestError && error.status === 429 &&
      error.code === "rate_limit_exceeded" && error.requestId === "req-123" &&
      !error.message.includes("do not trust raw message"),
  );
});

test("Gateway client rejects non-HTTPS endpoints", () => {
  assert.throws(() => createGatewayModelClient({
    gatewayBaseUrl: "http://ai-gateway.example",
    getTurnstileToken: async () => "challenge-token",
  }), /must use HTTPS/);
});

test("Gateway client rejects malformed Chat Completions content", async () => {
  const client = createGatewayModelClient({
    gatewayBaseUrl: "https://ai-gateway.example",
    getTurnstileToken: async () => "challenge-token",
    fetchImpl: async () => Response.json({ choices: [{ message: { content: null } }] }),
  });
  await assert.rejects(
    client.complete({ contextDisclosureAccepted: true, messages: [{ role: "user", content: "hello" }] }),
    (error) => error instanceof GatewayRequestError && error.code === "missing_model_content",
  );
});


test("Gateway client rejects an oversized serialized request before consuming a Turnstile token", async () => {
  let challengeCalled = false;
  let fetchCalled = false;
  const client = createGatewayModelClient({
    gatewayBaseUrl: "https://ai-gateway.example",
    maxRequestBytes: 1024,
    getTurnstileToken: async () => { challengeCalled = true; return "challenge-token"; },
    fetchImpl: async () => { fetchCalled = true; return Response.json({ choices: [] }); },
  });
  await assert.rejects(
    client.complete({
      contextDisclosureAccepted: true,
      messages: [{ role: "user", content: "x".repeat(4096) }],
    }),
    /exceeds the configured UTF-8 byte limit/,
  );
  assert.equal(challengeCalled, false);
  assert.equal(fetchCalled, false);
});
