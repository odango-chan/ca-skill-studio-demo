import test from "node:test";
import assert from "node:assert/strict";
import { handleGatewayRequest } from "../src/handler.mjs";

const ORIGIN = "https://odango-chan.github.io";

function makeEnv(overrides = {}) {
  return {
    OPENAI_API_KEY: "provider-secret-do-not-leak",
    OPENAI_BASE_URL: "https://api.example.test/v1",
    OPENAI_MODEL: "test-model",
    ALLOWED_ORIGINS: ORIGIN,
    TURNSTILE_SECRET_KEY: "turnstile-secret-do-not-leak",
    TURNSTILE_SITE_KEY: "public-site-key",
    TURNSTILE_EXPECTED_HOSTNAMES: "odango-chan.github.io",
    TURNSTILE_EXPECTED_ACTION: "ai_authoring",
    MAX_INPUT_BYTES: "262144",
    MAX_OUTPUT_TOKENS: "1024",
    UPSTREAM_TIMEOUT_MS: "60000",
    ...overrides,
  };
}

function makeRequest(path, options = {}) {
  return new Request("https://gateway.example.test" + path, {
    ...options,
    headers: { origin: ORIGIN, ...(options.headers || {}) },
  });
}

function allowRateLimit() {
  return async () => ({ success: true });
}

function fetchWithTurnstileAndModel(modelHandler) {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const target = String(input);
    calls.push({ target, init });
    if (target === "https://challenges.cloudflare.com/turnstile/v0/siteverify") {
      const params = new URLSearchParams(init.body);
      assert.equal(params.get("secret"), "turnstile-secret-do-not-leak");
      assert.equal(params.get("response"), "valid-challenge");
      return Response.json({
        success: true,
        hostname: "odango-chan.github.io",
        action: "ai_authoring",
      });
    }
    return modelHandler ? modelHandler(input, init) : new Response('{"choices":[]}', {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetchImpl, calls };
}

test("health check exposes no provider configuration", async () => {
  const response = await handleGatewayRequest(
    new Request("https://gateway.example.test/healthz"),
    {},
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "ok",
    service: "ca-skill-studio-ai-gateway",
  });
});

test("public config returns only the public Turnstile site key to an allowed origin", async () => {
  const response = await handleGatewayRequest(makeRequest("/public-config"), makeEnv());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { turnstile_site_key: "public-site-key" });
  assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN);
});

test("unknown origins are rejected before any upstream call", async () => {
  const request = new Request("https://gateway.example.test/v1/chat/completions", {
    method: "POST",
    headers: { origin: "https://attacker.example", "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
  });
  let called = false;
  const response = await handleGatewayRequest(request, makeEnv(), {
    clientIp: "203.0.113.1",
    rateLimit: allowRateLimit(),
    fetchImpl: async () => { called = true; throw new Error("unexpected"); },
  });
  assert.equal(response.status, 403);
  assert.equal(called, false);
});

test("CORS preflight is answered without contacting the provider", async () => {
  let called = false;
  const response = await handleGatewayRequest(
    makeRequest("/v1/chat/completions", { method: "OPTIONS" }),
    makeEnv(),
    { fetchImpl: async () => { called = true; }, clientIp: "203.0.113.1", rateLimit: allowRateLimit() },
  );
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(called, false);
});

test("missing rate limiter fails closed", async () => {
  const response = await handleGatewayRequest(
    makeRequest("/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-turnstile-token": "valid-challenge" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
    }),
    makeEnv(),
    { clientIp: "203.0.113.1" },
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "gateway_not_configured");
});

test("rate limit is applied before challenge verification", async () => {
  let fetchCalled = false;
  const response = await handleGatewayRequest(
    makeRequest("/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-turnstile-token": "valid-challenge" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
    }),
    makeEnv(),
    {
      clientIp: "203.0.113.2",
      rateLimit: async () => ({ success: false }),
      fetchImpl: async () => { fetchCalled = true; throw new Error("unexpected"); },
    },
  );
  assert.equal(response.status, 429);
  assert.equal(fetchCalled, false);
});

test("Turnstile verification fails closed for invalid tokens", async () => {
  const response = await handleGatewayRequest(
    makeRequest("/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-turnstile-token": "bad-token" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
    }),
    makeEnv(),
    {
      clientIp: "203.0.113.3",
      rateLimit: allowRateLimit(),
      fetchImpl: async () => Response.json({ success: false, "error-codes": ["invalid-input-response"] }),
    },
  );
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "challenge_rejected");
});

test("model request forces deployment model, clamps tokens and keeps provider key server-side", async () => {
  let upstreamInit;
  const { fetchImpl, calls } = fetchWithTurnstileAndModel((input, init) => {
    assert.equal(String(input), "https://api.example.test/v1/chat/completions");
    upstreamInit = init;
    return new Response('{"choices":[{"message":{"content":"ok"}}]}', {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  const response = await handleGatewayRequest(
    makeRequest("/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-turnstile-token": "valid-challenge" },
      body: JSON.stringify({
        model: "attacker-selected-model",
        max_tokens: 99999,
        temperature: 0.2,
        messages: [{ role: "user", content: "Write a safe proposal." }],
      }),
    }),
    makeEnv(),
    { fetchImpl, clientIp: "203.0.113.4", rateLimit: allowRateLimit() },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const upstreamBody = JSON.parse(upstreamInit.body);
  assert.equal(upstreamBody.model, "test-model");
  assert.equal(upstreamBody.max_tokens, 1024);
  assert.equal(upstreamBody.temperature, 0.2);
  assert.equal(upstreamInit.headers.authorization, "Bearer provider-secret-do-not-leak");
  assert.equal(upstreamInit.headers.authorization.includes("valid-challenge"), false);
  assert.equal(calls.length, 2);
  const clientBody = await response.text();
  assert.match(clientBody, /"choices"/);
  assert.doesNotMatch(clientBody, /provider-secret-do-not-leak|turnstile-secret-do-not-leak/);
});

test("tool calling and arbitrary provider parameters are rejected", async () => {
  const { fetchImpl } = fetchWithTurnstileAndModel();
  const response = await handleGatewayRequest(
    makeRequest("/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-turnstile-token": "valid-challenge" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "hello" }],
        tools: [{ type: "function", function: { name: "write_file" } }],
      }),
    }),
    makeEnv(),
    { fetchImpl, clientIp: "203.0.113.5", rateLimit: allowRateLimit() },
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "unsupported_parameter");
});

test("max_completion_tokens is normalized to the compatible max_tokens field", async () => {
  let upstreamBody;
  const { fetchImpl } = fetchWithTurnstileAndModel((input, init) => {
    upstreamBody = JSON.parse(init.body);
    return Response.json({ choices: [] });
  });
  const response = await handleGatewayRequest(
    makeRequest("/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-turnstile-token": "valid-challenge" },
      body: JSON.stringify({
        max_completion_tokens: 128,
        messages: [{ role: "user", content: "hello" }],
      }),
    }),
    makeEnv(),
    { fetchImpl, clientIp: "203.0.113.6", rateLimit: allowRateLimit() },
  );
  assert.equal(response.status, 200);
  assert.equal(upstreamBody.max_tokens, 128);
  assert.equal("max_completion_tokens" in upstreamBody, false);
});

test("oversized requests are rejected before model forwarding", async () => {
  const { fetchImpl, calls } = fetchWithTurnstileAndModel();
  const response = await handleGatewayRequest(
    makeRequest("/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-turnstile-token": "valid-challenge",
        "content-length": "2048",
      },
      body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
    }),
    makeEnv({ MAX_INPUT_BYTES: "1024" }),
    { fetchImpl, clientIp: "203.0.113.7", rateLimit: allowRateLimit() },
  );
  assert.equal(response.status, 413);
  assert.equal(calls.length, 1);
});

test("upstream failures are sanitized and do not expose provider response bodies", async () => {
  const { fetchImpl } = fetchWithTurnstileAndModel(() => new Response(
    "provider-secret-do-not-leak: invalid account",
    { status: 401, headers: { "content-type": "text/plain" } },
  ));
  const response = await handleGatewayRequest(
    makeRequest("/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-turnstile-token": "valid-challenge" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
    }),
    makeEnv(),
    { fetchImpl, clientIp: "203.0.113.8", rateLimit: allowRateLimit() },
  );
  assert.equal(response.status, 502);
  const body = await response.text();
  assert.doesNotMatch(body, /provider-secret-do-not-leak|invalid account/);
});

test("streaming responses remain streamed and are not cached", async () => {
  const { fetchImpl } = fetchWithTurnstileAndModel(() => new Response(
    "data: {\"choices\":[]}\n\n",
    { status: 200, headers: { "content-type": "text/event-stream" } },
  ));
  const response = await handleGatewayRequest(
    makeRequest("/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-turnstile-token": "valid-challenge" },
      body: JSON.stringify({
        stream: true,
        messages: [{ role: "user", content: "hello" }],
      }),
    }),
    makeEnv(),
    { fetchImpl, clientIp: "203.0.113.9", rateLimit: allowRateLimit() },
  );
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(await response.text(), /^data:/);
});

test("upstream base URL rejects insecure or credential-bearing URLs", async () => {
  const { fetchImpl } = fetchWithTurnstileAndModel();
  const response = await handleGatewayRequest(
    makeRequest("/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-turnstile-token": "valid-challenge" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
    }),
    makeEnv({ OPENAI_BASE_URL: "http://127.0.0.1:8080/v1" }),
    { fetchImpl, clientIp: "203.0.113.10", rateLimit: allowRateLimit() },
  );
  assert.equal(response.status, 503);
});

test("placeholder deployment configuration fails closed", async () => {
  const response = await handleGatewayRequest(
    makeRequest("/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-turnstile-token": "valid-challenge" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
    }),
    makeEnv({ OPENAI_MODEL: "replace-with-provider-model-id" }),
    { clientIp: "203.0.113.11", rateLimit: allowRateLimit() },
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "gateway_not_configured");
});

test("Turnstile success is rejected when hostname does not match the configured host", async () => {
  const response = await handleGatewayRequest(
    makeRequest("/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-turnstile-token": "valid-challenge" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
    }),
    makeEnv(),
    {
      clientIp: "203.0.113.12",
      rateLimit: allowRateLimit(),
      fetchImpl: async () => Response.json({
        success: true,
        hostname: "attacker.example",
        action: "ai_authoring",
      }),
    },
  );
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "challenge_rejected");
});

test("Turnstile success is rejected when the action does not match", async () => {
  const response = await handleGatewayRequest(
    makeRequest("/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-turnstile-token": "valid-challenge" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
    }),
    makeEnv(),
    {
      clientIp: "203.0.113.13",
      rateLimit: allowRateLimit(),
      fetchImpl: async () => Response.json({
        success: true,
        hostname: "odango-chan.github.io",
        action: "unrelated_action",
      }),
    },
  );
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "challenge_rejected");
});

