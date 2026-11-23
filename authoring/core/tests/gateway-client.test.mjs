import test from "node:test";
import assert from "node:assert/strict";
import { createGatewayModelClient, gatewayModelCatalogEndpoint, listGatewayModels, GatewayRequestError } from "../gateway-client.mjs";

const base = { gatewayBaseUrl: "http://127.0.0.1:8787/opencode-go/openai", modelId: "deepseek-v4.1-flash", sessionId: "editor-session-123" };
const messages = [{ role: "user", content: "Return a JSON proposal." }];
const ok = (payload = { choices: [{ message: { content: "{\"ok\":true}" } }] }) =>
  new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });

test("requires explicit context disclosure before any network request", async () => {
  let called = false;
  const client = createGatewayModelClient({ ...base, fetchImpl: async () => { called = true; return ok(); } });
  await assert.rejects(client.complete({ messages, contextDisclosureAccepted: false }), /Explicit context disclosure acceptance/);
  assert.equal(called, false);
});

test("calls the Go Gateway route prefix with an explicit Model ID and stable OpenCode session", async () => {
  let request;
  const client = createGatewayModelClient({ ...base, fetchImpl: async (url, init) => { request = { url, init }; return ok(); } });
  const result = await client.complete({ messages, contextDisclosureAccepted: true });
  assert.equal(request.url, "http://127.0.0.1:8787/opencode-go/openai/v1/chat/completions");
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.credentials, "omit");
  assert.equal(request.init.targetAddressSpace, "loopback");
  assert.equal(request.init.headers["content-type"], "application/json");
  assert.equal(request.init.headers["x-opencode-session"], "editor-session-123");
  assert.equal(request.init.headers.authorization, undefined);
  assert.equal(request.init.headers["x-gateway-token"], undefined);
  const body = JSON.parse(request.init.body);
  assert.equal(body.model, "deepseek-v4.1-flash");
  assert.deepEqual(body.messages, messages);
  assert.equal(body.stream, false);
  assert.equal(result.content, "{\"ok\":true}");
});

test("adds the optional shared Gateway token without exposing provider credentials", async () => {
  let request;
  const client = createGatewayModelClient({ ...base, gatewayToken: "shared-network-token", fetchImpl: async (url, init) => { request = { url, init }; return ok(); } });
  await client.complete({ messages, contextDisclosureAccepted: true });
  assert.equal(request.init.headers["x-gateway-token"], "shared-network-token");
  assert.equal(request.init.headers.authorization, undefined);
  assert.equal(request.init.credentials, "omit");
});

test("allows loopback HTTP and remote HTTPS but rejects remote HTTP", () => {
  assert.doesNotThrow(() => createGatewayModelClient({ ...base, gatewayBaseUrl: "http://localhost:8787/opencode-go/openai", fetchImpl: async () => ok() }));
  assert.doesNotThrow(() => createGatewayModelClient({ ...base, gatewayBaseUrl: "https://ai-gateway.internal.example/opencode-go/openai", fetchImpl: async () => ok() }));
  assert.throws(() => createGatewayModelClient({ ...base, gatewayBaseUrl: "http://10.0.0.5:8787/opencode-go/openai", fetchImpl: async () => ok() }), /HTTPS for non-loopback/);
});

test("requires a route label and rejects URL credentials, query and fragment", () => {
  assert.throws(() => createGatewayModelClient({ ...base, gatewayBaseUrl: "http://127.0.0.1:8787", fetchImpl: async () => ok() }), /upstream route label/);
  for (const gatewayBaseUrl of ["http://user:pass@127.0.0.1:8787/route","http://127.0.0.1:8787/route?token=secret","http://127.0.0.1:8787/route#fragment"]) {
    assert.throws(() => createGatewayModelClient({ ...base, gatewayBaseUrl, fetchImpl: async () => ok() }), /must not contain credentials/);
  }
});

test("requires a configured Model ID and validates shared Gateway token", () => {
  assert.throws(() => createGatewayModelClient({ ...base, modelId: "", fetchImpl: async () => ok() }), /Model ID is required/);
  assert.throws(() => createGatewayModelClient({ ...base, gatewayToken: "bad\ntoken", fetchImpl: async () => ok() }), /printable value/);
});

test("clamps output tokens to the configured upper bound", async () => {
  let body;
  const client = createGatewayModelClient({ ...base, maxOutputTokens: 1024, fetchImpl: async (url, init) => { body = JSON.parse(init.body); return ok(); } });
  await client.complete({ messages, maxTokens: 9000, contextDisclosureAccepted: true });
  assert.equal(body.max_tokens, 1024);
});

test("rejects a request that exceeds the byte limit before fetch", async () => {
  let called = false;
  const client = createGatewayModelClient({ ...base, maxRequestBytes: 1024, fetchImpl: async () => { called = true; return ok(); } });
  await assert.rejects(client.complete({ messages: [{ role: "user", content: "x".repeat(3000) }], contextDisclosureAccepted: true }), /byte limit/);
  assert.equal(called, false);
});

test("sanitizes transport and HTTP errors", async () => {
  const networkClient = createGatewayModelClient({ ...base, fetchImpl: async () => { throw new Error("secret provider key leaked"); } });
  await assert.rejects(networkClient.complete({ messages, contextDisclosureAccepted: true }), error => error instanceof GatewayRequestError && !error.message.includes("secret provider key"));
  const rejectedClient = createGatewayModelClient({ ...base, fetchImpl: async () => new Response("upstream secret", { status: 401 }) });
  await assert.rejects(rejectedClient.complete({ messages, contextDisclosureAccepted: true }), error => error instanceof GatewayRequestError && error.status === 401 && !error.message.includes("upstream secret"));
});

test("rejects a successful non-JSON or empty proposal response", async () => {
  const nonJsonClient = createGatewayModelClient({ ...base, fetchImpl: async () => new Response("not json", { status: 200 }) });
  await assert.rejects(nonJsonClient.complete({ messages, contextDisclosureAccepted: true }), /non-JSON response/);
  const emptyClient = createGatewayModelClient({ ...base, fetchImpl: async () => ok({ choices: [{ message: { content: "" } }] }) });
  await assert.rejects(emptyClient.complete({ messages, contextDisclosureAccepted: true }), /usable proposal/);
});


test("declares loopback targetAddressSpace only for local Gateway hosts", async () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    let request;
    const client = createGatewayModelClient({
      ...base,
      gatewayBaseUrl: "http://" + host + ":8787/opencode-go/openai",
      fetchImpl: async (_, init) => { request = init; return ok(); },
    });
    await client.complete({ messages, contextDisclosureAccepted: true });
    assert.equal(request.targetAddressSpace, "loopback", host);
    assert.equal(request.credentials, "omit", host);
  }

  let remote;
  const client = createGatewayModelClient({
    ...base,
    gatewayBaseUrl: "https://gateway.internal.example/opencode-go/openai",
    fetchImpl: async (_, init) => { remote = init; return ok(); },
  });
  await client.complete({ messages, contextDisclosureAccepted: true });
  assert.equal(Object.hasOwn(remote, "targetAddressSpace"), false);
});

test("model catalog uses the OpenCode Go root route, not the completion's /openai subpath", () => {
  assert.equal(gatewayModelCatalogEndpoint(base.gatewayBaseUrl),
    "http://127.0.0.1:8787/opencode-go/v1/models");
  assert.equal(gatewayModelCatalogEndpoint("https://gateway.example/local-models"),
    "https://gateway.example/local-models/v1/models");
  assert.throws(() => gatewayModelCatalogEndpoint("http://gateway.example/opencode-go/openai"),
    /HTTPS for non-loopback/);
  assert.throws(() => gatewayModelCatalogEndpoint("http://127.0.0.1:8787/opencode-go/openai?key=secret"),
    /credentials, query parameters or fragments/);
});

test("Host-owned model GET returns bounded, sanitized Chat models without a provider key", async () => {
  let request;
  const catalog = { object: "list", data: [
    { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", type: "chat" },
    { id: "glm-5.3-flash", name: "GLM-5.3 Flash", type: "chat" },
    { id: "glm-5.3-flash", name: "Duplicate", type: "chat" },
    { id: "image-gen", name: "An image model", type: "image" },
    { id: "../bad?token", name: "Bad", type: "chat" }
  ] };
  const models = await listGatewayModels({
    gatewayBaseUrl: base.gatewayBaseUrl, gatewayToken: "shared-token",
    fetchImpl: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify(catalog), { status: 200 });
    }
  });
  assert.equal(request.url, "http://127.0.0.1:8787/opencode-go/v1/models");
  assert.equal(request.init.method, "GET");
  assert.equal(request.init.targetAddressSpace, "loopback");
  assert.equal(request.init.credentials, "omit");
  assert.equal(request.init.headers["x-gateway-token"], "shared-token");
  assert.equal(request.init.headers.authorization, undefined);
  assert.equal(request.init.body, undefined);
  assert.deepEqual(models, [
    { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash" },
    { id: "glm-5.3-flash", name: "GLM-5.3 Flash" },
  ]);
  assert.equal(Object.isFrozen(models), true);
});

test("model catalog over remote HTTPS never requests local-network permission", async () => {
  let request;
  const models = await listGatewayModels({
    gatewayBaseUrl: "https://gateway.example/other/openai",
    fetchImpl: async (url, init) => { request = { url, init }; return new Response(
      JSON.stringify({ data: [{ id: "custom-1" }] }), { status: 200 }
    ); }
  });
  assert.equal(request.url, "https://gateway.example/other/v1/models");
  assert.equal(Object.hasOwn(request.init, "targetAddressSpace"), false);
  assert.deepEqual(models, [{ id: "custom-1", name: "custom-1" }]);
});

test("catalog failure is sanitized and oversized content is rejected before parsing", async () => {
  const token = "super-secret-provider-token";
  await assert.rejects(listGatewayModels({
    gatewayBaseUrl: base.gatewayBaseUrl, gatewayToken: token,
    fetchImpl: async () => { throw Error("upstream " + token); }
  }), err => err instanceof GatewayRequestError && !err.message.includes(token));
  await assert.rejects(listGatewayModels({
    gatewayBaseUrl: base.gatewayBaseUrl,
    fetchImpl: async () => new Response("sensitive upstream error", { status: 503 })
  }), err => err instanceof GatewayRequestError &&
     err.status === 503 && !err.message.includes("sensitive"));
  await assert.rejects(listGatewayModels({
    gatewayBaseUrl: base.gatewayBaseUrl,
    fetchImpl: async () => new Response("x".repeat(1048577), { status: 200 })
  }), /invalid or oversized model catalog/);
  await assert.rejects(listGatewayModels({
    gatewayBaseUrl: base.gatewayBaseUrl,
    fetchImpl: async () => new Response(JSON.stringify({ models: [] }), { status: 200 })
  }), /OpenAI-compatible data list/);
});
