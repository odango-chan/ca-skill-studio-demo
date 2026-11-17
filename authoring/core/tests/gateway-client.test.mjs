import test from "node:test";
import assert from "node:assert/strict";
import { createGatewayModelClient, GatewayRequestError } from "../gateway-client.mjs";
import { handleRequest } from "../../../gateway/worker/src/index.mjs";

test("Gateway client requires explicit context disclosure before sending", async () => {
  let called = false;
  const client = createGatewayModelClient({
    gatewayBaseUrl: "https://ai-gateway.example",
    fetchImpl: async () => { called = true; return Response.json({ choices: [] }); },
  });
  await assert.rejects(
    client.complete({ messages: [{ role: "user", content: "hello" }] }),
    /Context disclosure must be explicitly accepted/,
  );
  assert.equal(called, false);
});

test("Gateway client sends a credentialed OpenAI-compatible request without client model or provider secrets", async () => {
  let request;
  const client = createGatewayModelClient({
    gatewayBaseUrl: "https://ai-gateway.example/",
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
  assert.equal(request.init.credentials, "include");
  assert.equal("authorization" in request.init.headers, false);
  assert.equal("x-turnstile-token" in request.init.headers, false);
  const body = JSON.parse(request.init.body);
  assert.equal(body.stream, false);
  assert.equal(body.max_tokens, 2048);
  assert.equal("model" in body, false);
  assert.equal("tools" in body, false);
  assert.deepEqual(body.response_format, { type: "json_object" });
});

test("Authoring Core and Access Gateway interoperate using the deployment model and JSON response mode", async () => {
  const accessAudience = "studio-gateway-audience";
  const gatewayEnv = {
    ACCESS_AUD: accessAudience,
    ALLOWED_ORIGINS: "https://studio.example",
    ALLOWED_MODELS: "fixture-model",
    PROVIDER_MODEL: "fixture-model",
    MAX_REQUEST_BYTES: "262144",
    MAX_OUTPUT_TOKENS: "2048",
    PROVIDER_API_KEY: "server-only-provider-secret",
    PROVIDER_CHAT_COMPLETIONS_URL: "https://provider.example/v1/chat/completions",
    USER_RATE_LIMITER: { async limit({ key }) { assert.equal(key, "author@example.com"); return { success: true }; } },
  };
  const accessContext = {
    access: { aud: accessAudience, async getIdentity() { return { email: "Author@Example.com" }; } },
  };
  const client = createGatewayModelClient({
    gatewayBaseUrl: "https://gateway.example",
    fetchImpl: async (url, init) => {
      assert.equal(init.credentials, "include");
      const request = new Request(url, {
        ...init,
        headers: { ...init.headers, Origin: "https://studio.example" },
      });
      return handleRequest(request, gatewayEnv, accessContext, async (_upstreamUrl, upstreamInit) => {
        assert.equal(upstreamInit.headers.Authorization, "Bearer server-only-provider-secret");
        const body = JSON.parse(upstreamInit.body);
        assert.equal(body.model, "fixture-model");
        assert.equal(body.stream, false);
        assert.deepEqual(body.response_format, { type: "json_object" });
        return Response.json({
          choices: [{ message: { content: "{\"schema\":\"ca-studio.ai-model-proposal/v1\"}" } }],
        });
      });
    },
  });
  const content = await client.complete({
    contextDisclosureAccepted: true,
    messages: [
      { role: "system", content: "Return a valid proposal JSON object." },
      { role: "user", content: "Propose one safe operation." },
    ],
    responseFormat: { type: "json_object" },
  });
  assert.equal(content, "{\"schema\":\"ca-studio.ai-model-proposal/v1\"}");
});

test("Gateway client clamps output tokens to the configured ceiling", async () => {
  let body;
  const client = createGatewayModelClient({
    gatewayBaseUrl: "https://ai-gateway.example",
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
  }), /must use HTTPS/);
});

test("Gateway client rejects malformed Chat Completions content", async () => {
  const client = createGatewayModelClient({
    gatewayBaseUrl: "https://ai-gateway.example",
    fetchImpl: async () => Response.json({ choices: [{ message: { content: null } }] }),
  });
  await assert.rejects(
    client.complete({ contextDisclosureAccepted: true, messages: [{ role: "user", content: "hello" }] }),
    (error) => error instanceof GatewayRequestError && error.code === "missing_model_content",
  );
});


test("Gateway client rejects an oversized serialized request before sending it", async () => {
  let fetchCalled = false;
  const client = createGatewayModelClient({
    gatewayBaseUrl: "https://ai-gateway.example",
    maxRequestBytes: 1024,
    fetchImpl: async () => { fetchCalled = true; return Response.json({ choices: [] }); },
  });
  await assert.rejects(
    client.complete({
      contextDisclosureAccepted: true,
      messages: [{ role: "user", content: "x".repeat(4096) }],
    }),
    /exceeds the configured UTF-8 byte limit/,
  );
  assert.equal(fetchCalled, false);
});
