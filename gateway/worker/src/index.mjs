const CHAT_PATH = "/v1/chat/completions";
const HEALTH_PATH = "/healthz";
const OPENCODE_GO_CHAT_COMPLETIONS_URL = "https://opencode.ai/inference/go/openai/v1/chat/completions";
const STUDIO_USER_AGENT = "ca-skill-studio-ai-authoring/1.0";
const REQUEST_FIELDS = new Set(["model", "messages", "stream", "max_tokens", "temperature", "top_p", "response_format"]);
const csv = (value) => String(value ?? "").split(",").map((v) => v.trim()).filter(Boolean);
const int = (value, fallback) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
const error = (status, code, headers) => {
  const h = new Headers(headers);
  h.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify({ error: { message: code, type: "gateway_error", code } }), { status, headers: h });
};
function corsHeaders(origin, origins) {
  const h = new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", Vary: "Origin" });
  if (origin && origins.includes(origin)) {
    h.set("Access-Control-Allow-Origin", origin);
    h.set("Access-Control-Allow-Credentials", "true");
  }
  return h;
}
function configurationError(env) {
  if (!env.ACCESS_AUD || !env.PROVIDER_API_KEY || !env.PROVIDER_CHAT_COMPLETIONS_URL || !env.PROVIDER_MODEL || !csv(env.ALLOWED_MODELS).includes(env.PROVIDER_MODEL) || !csv(env.ALLOWED_ORIGINS).length || typeof env.USER_RATE_LIMITER?.limit !== "function") return true;
  try {
    const endpoint = new URL(env.PROVIDER_CHAT_COMPLETIONS_URL);
    if (endpoint.protocol !== "https:" || endpoint.origin !== "https://opencode.ai" ||
      endpoint.href !== OPENCODE_GO_CHAT_COMPLETIONS_URL ||
      endpoint.username || endpoint.password || endpoint.search || endpoint.hash) return true;
    for (const origin of csv(env.ALLOWED_ORIGINS)) {
      const parsed = new URL(origin);
      const localHttp = parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname);
      if (parsed.origin !== origin || (parsed.protocol !== "https:" && !localHttp)) return true;
    }
  } catch { return true; }
  return false;
}
async function authenticatedEmail(ctx, env) {
  if (!ctx?.access || ctx.access.aud !== env.ACCESS_AUD || typeof ctx.access.getIdentity !== "function") return null;
  try {
    const identity = await ctx.access.getIdentity();
    return typeof identity?.email === "string" && identity.email.trim() ? identity.email.trim().toLowerCase() : null;
  } catch { return null; }
}
async function readJson(request, maxBytes) {
  const length = request.headers.get("content-length");
  if (length !== null && (!Number.isSafeInteger(Number(length)) || Number(length) < 0 || Number(length) > maxBytes)) {
    throw { status: Number(length) > maxBytes ? 413 : 400, code: Number(length) > maxBytes ? "request_too_large" : "invalid_content_length" };
  }
  if (!request.body) throw { status: 400, code: "missing_request_body" };
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw { status: 413, code: "request_too_large" };
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw { status: 400, code: "invalid_json" }; }
}
function validatePayload(input, env) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw { status: 400, code: "invalid_request" };
  if (Object.keys(input).some((key) => !REQUEST_FIELDS.has(key))) throw { status: 400, code: "unsupported_request_field" };
  const model = input.model === undefined ? env.PROVIDER_MODEL : input.model;
  if (typeof model !== "string" || !csv(env.ALLOWED_MODELS).includes(model)) throw { status: 400, code: "model_not_allowed" };
  if (input.stream !== undefined && typeof input.stream !== "boolean") throw { status: 400, code: "invalid_stream" };
  if (!Array.isArray(input.messages) || !input.messages.length || input.messages.length > 32) throw { status: 400, code: "invalid_messages" };
  const messages = input.messages.map((message) => {
    if (!message || typeof message !== "object" || Array.isArray(message) || Object.keys(message).some((k) => !["role", "content"].includes(k))) throw { status: 400, code: "invalid_message" };
    if (!["system", "user", "assistant"].includes(message.role)) throw { status: 400, code: "invalid_message_role" };
    const content = message.content;
    const validText = typeof content === "string" && content.length <= int(env.MAX_REQUEST_BYTES, 262144);
    const validTextParts = Array.isArray(content) && content.length > 0 && content.length <= 32 && content.every((part) =>
      part && typeof part === "object" && !Array.isArray(part) &&
      part.type === "text" && typeof part.text === "string" && part.text.length <= int(env.MAX_REQUEST_BYTES, 262144) &&
      Object.keys(part).every((key) => key === "type" || key === "text")
    );
    if (!validText && !validTextParts) throw { status: 400, code: "invalid_message_content" };
    return { role: message.role, content };
  });
  const max = int(env.MAX_OUTPUT_TOKENS, 2048);
  const tokens = input.max_tokens === undefined ? max : input.max_tokens;
  if (!Number.isSafeInteger(tokens) || tokens < 1 || tokens > max) throw { status: 400, code: "output_token_limit_exceeded" };
  const output = { model, messages, stream: input.stream === true, max_tokens: tokens };
  if (input.temperature !== undefined) {
    if (typeof input.temperature !== "number" || !Number.isFinite(input.temperature) || input.temperature < 0 || input.temperature > 2) throw { status: 400, code: "invalid_temperature" };
    output.temperature = input.temperature;
  }
  if (input.top_p !== undefined) {
    if (typeof input.top_p !== "number" || !Number.isFinite(input.top_p) || input.top_p < 0 || input.top_p > 1) throw { status: 400, code: "invalid_top_p" };
    output.top_p = input.top_p;
  }
  if (input.response_format !== undefined) {
    const format = input.response_format;
    if (!format || typeof format !== "object" || Array.isArray(format) || Object.keys(format).length !== 1 || format.type !== "json_object") {
      throw { status: 400, code: "unsupported_response_format" };
    }
    output.response_format = { type: "json_object" };
  }
  return output;
}
export async function handleRequest(request, env, ctx, fetchImpl = globalThis.fetch) {
  const url = new URL(request.url);
  const origins = csv(env.ALLOWED_ORIGINS);
  const origin = request.headers.get("origin");
  const headers = corsHeaders(origin && origins.includes(origin) ? origin : null, origins);
  if (origin && !origins.includes(origin)) return error(403, "origin_not_allowed", headers);
  if (url.pathname === HEALTH_PATH && request.method === "GET") return new Response("ok", { status: 200, headers });
  if (url.pathname !== CHAT_PATH) return error(404, "not_found", headers);
  if (request.method === "OPTIONS") {
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type, X-OpenCode-Session");
    headers.set("Access-Control-Max-Age", "600");
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "POST") {
    headers.set("Allow", "POST, OPTIONS");
    return error(405, "method_not_allowed", headers);
  }
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return error(415, "content_type_must_be_json", headers);
  if (configurationError(env)) return error(503, "gateway_not_configured", headers);
  const email = await authenticatedEmail(ctx, env);
  if (!email) return error(401, "authentication_required", headers);
  try {
    const limited = await env.USER_RATE_LIMITER.limit({ key: email });
    if (limited?.success !== true) return error(429, "rate_limit_exceeded", headers);
  } catch { return error(503, "rate_limit_unavailable", headers); }
  const sessionId = request.headers.get("x-opencode-session");
  if (typeof sessionId !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(sessionId)) {
    return error(400, "invalid_session_id", headers);
  }
  let payload;
  try { payload = validatePayload(await readJson(request, int(env.MAX_REQUEST_BYTES, 262144)), env); }
  catch (failure) { return error(failure?.status ?? 400, failure?.code ?? "invalid_request", headers); }
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(new DOMException("Provider response header timeout", "TimeoutError")), int(env.UPSTREAM_TIMEOUT_MS, 120000));
  try {
    const upstream = await fetchImpl(env.PROVIDER_CHAT_COMPLETIONS_URL, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.any([request.signal, timeoutController.signal]),
      headers: {
        Authorization: "Bearer " + env.PROVIDER_API_KEY,
        "Content-Type": "application/json",
        Accept: payload.stream ? "text/event-stream" : "application/json",
        "User-Agent": STUDIO_USER_AGENT,
        "x-opencode-session": sessionId,
      },
      body: JSON.stringify(payload),
    });
    clearTimeout(timeoutId);
    if (upstream.status === 429) {
      await upstream.body?.cancel();
      return error(429, "provider_rate_limited", headers);
    }
    const expectedType = payload.stream ? "text/event-stream" : "application/json";
    if (!upstream.ok || !upstream.body || !upstream.headers.get("content-type")?.toLowerCase().includes(expectedType)) {
      await upstream.body?.cancel();
      return error(502, "provider_unavailable", headers);
    }
    headers.set("Content-Type", payload.stream ? "text/event-stream; charset=utf-8" : "application/json; charset=utf-8");
    headers.set("Cache-Control", payload.stream ? "no-cache, no-transform" : "no-store");
    if (payload.stream) headers.set("X-Accel-Buffering", "no");
    return new Response(upstream.body, { status: 200, headers });
  } catch (failure) {
    clearTimeout(timeoutId);
    if (request.signal.aborted) return error(499, "client_disconnected", headers);
    if (timeoutController.signal.aborted) return error(504, "provider_timeout", headers);
    return error(502, "provider_unavailable", headers);
  }
}
export default { fetch(request, env, ctx) { return handleRequest(request, env, ctx); } };
