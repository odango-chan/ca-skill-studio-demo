import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../src/index.mjs";
const origin = "https://odango-chan.github.io";
const aud = "studio-gateway-audience";
const env = (extra = {}) => ({
  ACCESS_AUD: aud, ALLOWED_ORIGINS: origin, ALLOWED_MODELS: "test-model,deepseek-chat",
  MAX_REQUEST_BYTES: "65536", MAX_OUTPUT_TOKENS: "2048", PROVIDER_API_KEY: "provider-secret-test-only",
  PROVIDER_CHAT_COMPLETIONS_URL: "https://provider.example/v1/chat/completions",
  USER_RATE_LIMITER: { async limit({ key }) { assert.equal(key, "author@example.com"); return { success: true }; } },
  ...extra,
});
const ctx = (extra = {}) => ({ access: { aud, async getIdentity() { return { email: "Author@Example.com" }; }, ...extra } });
const payload = (extra = {}) => ({ model: "test-model", messages: [{ role: "user", content: "Draft a Procedure." }], stream: true, ...extra });
const req = (body, extra = {}) => new Request("https://gateway.example/v1/chat/completions", {
  method: "POST", headers: { Origin: origin, "Content-Type": "application/json", ...extra }, body: JSON.stringify(body),
});
const code = async (response) => (await response.json()).error.code;

test("health is public and does not require provider configuration", async () => {
  const response = await handleRequest(new Request("https://gateway.example/healthz", { headers: { Origin: origin } }), env(), {});
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "ok");
});

test("CORS preflight allows only configured origins", async () => {
  const good = await handleRequest(new Request("https://gateway.example/v1/chat/completions", { method: "OPTIONS", headers: { Origin: origin } }), env(), {});
  assert.equal(good.status, 204);
  assert.equal(good.headers.get("access-control-allow-credentials"), "true");
  const bad = await handleRequest(new Request("https://gateway.example/v1/chat/completions", { method: "OPTIONS", headers: { Origin: "https://attacker.example" } }), env(), {});
  assert.equal(bad.status, 403);
  assert.equal(await code(bad), "origin_not_allowed");
});

test("route and method are fixed", async () => {
  const missing = await handleRequest(new Request("https://gateway.example/anything"), env(), ctx());
  assert.equal(missing.status, 404);
  const method = await handleRequest(new Request("https://gateway.example/v1/chat/completions", { headers: { Origin: origin } }), env(), ctx());
  assert.equal(method.status, 405);
});

test("Access context and audience are mandatory", async () => {
  const missing = await handleRequest(req(payload()), env(), {});
  assert.equal(missing.status, 401);
  assert.equal(await code(missing), "authentication_required");
  const wrong = await handleRequest(req(payload()), env(), { access: { aud: "wrong", async getIdentity() { return { email: "author@example.com" }; } } });
  assert.equal(wrong.status, 401);
});

test("rate limit is keyed by verified identity and fails closed", async () => {
  const denied = await handleRequest(req(payload()), env({ USER_RATE_LIMITER: { async limit({ key }) { assert.equal(key, "author@example.com"); return { success: false }; } } }), ctx());
  assert.equal(denied.status, 429);
  assert.equal(await code(denied), "rate_limit_exceeded");
  const failed = await handleRequest(req(payload()), env({ USER_RATE_LIMITER: { async limit() { throw new Error("offline"); } } }), ctx());
  assert.equal(failed.status, 503);
  assert.equal(await code(failed), "rate_limit_unavailable");
});

test("request body, model, schema and output limits are enforced", async () => {
  const cases = [
    [payload({ model: "unlisted" }), "model_not_allowed"],
    [payload({ stream: false }), "streaming_required"],
    [payload({ arbitrary_url: "https://attacker.example" }), "unsupported_request_field"],
    [payload({ max_tokens: 2049 }), "output_token_limit_exceeded"],
    [payload({ messages: [{ role: "tool", content: "run" }] }), "invalid_message_role"],
  ];
  for (const [body, expected] of cases) {
    const response = await handleRequest(req(body), env(), ctx(), async () => { throw new Error("upstream must not run"); });
    assert.equal(response.status, 400);
    assert.equal(await code(response), expected);
  }
  const large = payload({ messages: [{ role: "user", content: "x".repeat(70000) }] });
  const oversized = await handleRequest(req(large), env(), ctx());
  assert.equal(oversized.status, 413);
  assert.equal(await code(oversized), "request_too_large");
});

test("fixed HTTPS provider endpoint and configuration are required", async () => {
  for (const endpoint of ["http://localhost/v1/chat/completions", "https://provider.example/v1/responses", "https://provider.example/v1/chat/completions?key=leak"]) {
    const response = await handleRequest(req(payload()), env({ PROVIDER_CHAT_COMPLETIONS_URL: endpoint }), ctx());
    assert.equal(response.status, 503);
    assert.equal(await code(response), "gateway_not_configured");
  }
});

test("valid request uses only server credentials and streams the provider response", async () => {
  let target;
  let init;
  const sse = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n")); controller.close(); } });
  const response = await handleRequest(req(payload({ max_tokens: 512, temperature: 0.2 }), { Authorization: "Bearer browser-secret", "X-Provider-Key": "attacker" }), env(), ctx(), async (url, options) => {
    target = url; init = options;
    return new Response(sse, { status: 200, headers: { "Content-Type": "text/event-stream", "X-Upstream-Secret": "must-not-pass" } });
  });
  assert.equal(target, "https://provider.example/v1/chat/completions");
  assert.equal(init.headers.Authorization, "Bearer provider-secret-test-only");
  assert.equal(init.headers["X-Provider-Key"], undefined);
  assert.equal(JSON.parse(init.body).max_tokens, 512);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/event-stream/);
  assert.equal(response.headers.get("x-upstream-secret"), null);
  assert.equal(await response.text(), "data: [DONE]\n\n");
});

test("provider response-header wait is bounded by a timeout", async () => {
  const response = await handleRequest(req(payload()), env({ UPSTREAM_TIMEOUT_MS: "5" }), ctx(), async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
  }));
  assert.equal(response.status, 504);
  assert.equal(await code(response), "provider_timeout");
});

test("provider errors and non-SSE responses are normalized without leaking bodies", async () => {
  const failed = await handleRequest(req(payload()), env(), ctx(), async () => new Response("secret upstream detail", { status: 401 }));
  assert.equal(failed.status, 502);
  assert.equal(await code(failed), "provider_unavailable");
  const limited = await handleRequest(req(payload()), env(), ctx(), async () => new Response("quota details", { status: 429 }));
  assert.equal(limited.status, 429);
  assert.equal(await code(limited), "provider_rate_limited");
  const notStream = await handleRequest(req(payload()), env(), ctx(), async () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
  assert.equal(notStream.status, 502);
});
