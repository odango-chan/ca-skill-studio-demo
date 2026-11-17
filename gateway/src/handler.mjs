const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MAX_INPUT_BYTES = 262144;
const DEFAULT_MAX_OUTPUT_TOKENS = 2048;
const DEFAULT_TIMEOUT_MS = 60000;

function csv(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

function errorResponse(status, code, message, id, headers = {}) {
  return jsonResponse(status, { error: { type: "gateway_error", code, message, request_id: id } }, headers);
}

function newRequestId() {
  return crypto.randomUUID();
}

function corsHeaders(origin) {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, GET, OPTIONS",
    "access-control-allow-headers": "content-type, x-turnstile-token",
    "access-control-max-age": "600",
    "vary": "Origin",
  };
}

function isAllowedOrigin(request, env) {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  return csv(env.ALLOWED_ORIGINS).includes(origin) ? origin : null;
}

async function readLimitedJson(request, maxBytes) {
  const contentType = request.headers.get("content-type") || "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) return { error: "unsupported_media_type" };

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return { error: "body_too_large" };
  if (!request.body) return { error: "empty_body" };

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { error: "body_too_large" };
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { error: "invalid_json" };
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 64) return false;
  return messages.every((message) => {
    if (!isPlainObject(message)) return false;
    if (Object.keys(message).some((key) => key !== "role" && key !== "content")) return false;
    if (!["system", "user", "assistant"].includes(message.role)) return false;
    if (typeof message.content === "string") return true;
    if (!Array.isArray(message.content) || message.content.length === 0) return false;
    return message.content.every((part) =>
      isPlainObject(part) &&
      part.type === "text" &&
      typeof part.text === "string" &&
      Object.keys(part).every((key) => key === "type" || key === "text")
    );
  });
}

function normalizeChatRequest(body, env) {
  if (!isPlainObject(body)) return { error: "invalid_request" };

  const allowedKeys = new Set([
    "model", "messages", "temperature", "top_p", "stream", "max_tokens",
    "max_completion_tokens", "response_format", "stop", "presence_penalty",
    "frequency_penalty", "seed",
  ]);
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) return { error: "unsupported_parameter" };
  if (!validateMessages(body.messages)) return { error: "invalid_messages" };
  if (body.max_tokens !== undefined && body.max_completion_tokens !== undefined) {
    return { error: "conflicting_token_limits" };
  }
  if (body.stream !== undefined && typeof body.stream !== "boolean") return { error: "invalid_stream" };

  const ranges = {
    temperature: [0, 2],
    top_p: [0, 1],
    presence_penalty: [-2, 2],
    frequency_penalty: [-2, 2],
  };
  for (const [key, range] of Object.entries(ranges)) {
    if (body[key] !== undefined &&
      (typeof body[key] !== "number" || !Number.isFinite(body[key]) ||
        body[key] < range[0] || body[key] > range[1])) return { error: "invalid_" + key };
  }
  if (body.seed !== undefined && (!Number.isSafeInteger(body.seed) || body.seed < 0)) {
    return { error: "invalid_seed" };
  }
  if (body.stop !== undefined &&
    !(typeof body.stop === "string" ||
      (Array.isArray(body.stop) && body.stop.length > 0 && body.stop.length <= 4 &&
        body.stop.every((item) => typeof item === "string")))) return { error: "invalid_stop" };

  if (body.response_format !== undefined &&
    (!isPlainObject(body.response_format) ||
      !["text", "json_object", "json_schema"].includes(body.response_format.type))) {
    return { error: "invalid_response_format" };
  }

  const maxOutputTokens = boundedInteger(env.MAX_OUTPUT_TOKENS, DEFAULT_MAX_OUTPUT_TOKENS, 1, 8192);
  const requestedTokens = body.max_completion_tokens ?? body.max_tokens ?? maxOutputTokens;
  if (!Number.isSafeInteger(requestedTokens) || requestedTokens < 1) return { error: "invalid_max_tokens" };

  const normalized = {
    model: env.OPENAI_MODEL,
    messages: body.messages,
    max_tokens: Math.min(requestedTokens, maxOutputTokens),
    stream: body.stream === true,
  };
  for (const key of [
    "temperature", "top_p", "response_format", "stop",
    "presence_penalty", "frequency_penalty", "seed",
  ]) {
    if (body[key] !== undefined) normalized[key] = body[key];
  }
  return { value: normalized };
}

function resolveUpstreamUrl(env) {
  const base = String(env.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, "");
  let url;
  try {
    url = new URL(base);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.protocol !== "https:" && env.ALLOW_INSECURE_UPSTREAM !== "true") return null;
  return base + "/chat/completions";
}

async function verifyTurnstile({
  token, secret, expectedHostnames, expectedAction, remoteIp, id, fetchImpl,
}) {
  const body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", token);
  body.set("idempotency_key", id);
  if (remoteIp) body.set("remoteip", remoteIp);

  let response;
  try {
    response = await fetchImpl(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch {
    return { ok: false, unavailable: true };
  }
  if (!response.ok) return { ok: false, unavailable: true };

  let result;
  try {
    result = await response.json();
  } catch {
    return { ok: false, unavailable: true };
  }
  if (!result.success) return { ok: false };
  if (!expectedHostnames.includes(result.hostname)) return { ok: false };
  if (expectedAction && result.action !== expectedAction) return { ok: false };
  return { ok: true };
}

function validateConfiguration(env, rateLimit) {
  const required = [
    "OPENAI_API_KEY", "OPENAI_MODEL", "TURNSTILE_SECRET_KEY",
    "TURNSTILE_EXPECTED_HOSTNAMES", "ALLOWED_ORIGINS",
  ];
  if (required.some((key) => !String(env[key] || "").trim())) return false;
  if (typeof rateLimit !== "function") return false;
  return resolveUpstreamUrl(env) !== null;
}

export async function handleGatewayRequest(request, env, {
  fetchImpl = fetch,
  clientIp = null,
  rateLimit = null,
} = {}) {
  const id = newRequestId();
  const url = new URL(request.url);

  if (url.pathname === "/healthz" && request.method === "GET") {
    return jsonResponse(200, { status: "ok", service: "ca-skill-studio-ai-gateway" });
  }

  if (url.pathname === "/public-config" && request.method === "GET") {
    const origin = isAllowedOrigin(request, env);
    if (!origin) return errorResponse(403, "origin_not_allowed", "Origin is not allowed.", id);
    return jsonResponse(200, { turnstile_site_key: env.TURNSTILE_SITE_KEY || null }, corsHeaders(origin));
  }

  if (url.pathname !== "/v1/chat/completions") {
    return errorResponse(404, "not_found", "Endpoint not found.", id);
  }

  const origin = isAllowedOrigin(request, env);
  if (!origin) return errorResponse(403, "origin_not_allowed", "Origin is not allowed.", id);
  const cors = corsHeaders(origin);

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") {
    return errorResponse(405, "method_not_allowed", "Use POST for this endpoint.", id, cors);
  }

  if (!validateConfiguration(env, rateLimit)) {
    return errorResponse(503, "gateway_not_configured", "Gateway is not configured.", id, cors);
  }
  if (!clientIp) {
    return errorResponse(503, "client_identity_unavailable", "Request identity is unavailable.", id, cors);
  }

  let limited;
  try {
    limited = await rateLimit("ip:" + clientIp);
  } catch {
    return errorResponse(503, "rate_limit_unavailable", "Gateway protection is unavailable.", id, cors);
  }
  if (!limited || limited.success !== true) {
    return errorResponse(429, "rate_limit_exceeded", "Request rate limit exceeded.", id, cors);
  }

  const token = request.headers.get("x-turnstile-token") || "";
  if (!token || token.length > 2048) {
    return errorResponse(403, "challenge_required", "A valid anti-abuse challenge is required.", id, cors);
  }

  const challenge = await verifyTurnstile({
    token,
    secret: env.TURNSTILE_SECRET_KEY,
    expectedHostnames: csv(env.TURNSTILE_EXPECTED_HOSTNAMES),
    expectedAction: env.TURNSTILE_EXPECTED_ACTION || "ai_authoring",
    remoteIp: clientIp,
    id,
    fetchImpl,
  });
  if (!challenge.ok) {
    return errorResponse(
      challenge.unavailable ? 503 : 403,
      challenge.unavailable ? "challenge_service_unavailable" : "challenge_rejected",
      challenge.unavailable ? "Challenge verification is unavailable." : "Challenge verification failed.",
      id,
      cors,
    );
  }

  const maxInputBytes = boundedInteger(env.MAX_INPUT_BYTES, DEFAULT_MAX_INPUT_BYTES, 1024, 1048576);
  const parsed = await readLimitedJson(request, maxInputBytes);
  if (parsed.error) {
    const status = parsed.error === "body_too_large" ? 413 :
      parsed.error === "unsupported_media_type" ? 415 : 400;
    return errorResponse(status, parsed.error, "Request body is invalid.", id, cors);
  }

  const normalized = normalizeChatRequest(parsed.value, env);
  if (normalized.error) {
    return errorResponse(400, normalized.error, "Request parameters are invalid or unsupported.", id, cors);
  }

  const upstreamUrl = resolveUpstreamUrl(env);
  const timeoutMs = boundedInteger(env.UPSTREAM_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1000, 120000);
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = typeof AbortSignal.any === "function"
    ? AbortSignal.any([request.signal, timeoutSignal])
    : timeoutSignal;

  let upstream;
  try {
    upstream = await fetchImpl(upstreamUrl, {
      method: "POST",
      headers: {
        authorization: "Bearer " + env.OPENAI_API_KEY,
        "content-type": "application/json",
        accept: normalized.value.stream ? "text/event-stream" : "application/json",
        "x-request-id": id,
      },
      body: JSON.stringify(normalized.value),
      signal,
    });
  } catch (error) {
    const timedOut = error && error.name === "TimeoutError";
    return errorResponse(
      timedOut ? 504 : 502,
      timedOut ? "upstream_timeout" : "upstream_unavailable",
      timedOut ? "Model request timed out." : "Model service is unavailable.",
      id,
      cors,
    );
  }

  if (!upstream.ok) {
    const retryAfter = upstream.headers.get("retry-after");
    const headers = { ...cors };
    if (retryAfter && /^\d{1,5}$/.test(retryAfter)) headers["retry-after"] = retryAfter;
    return errorResponse(
      upstream.status === 429 ? 429 : 502,
      upstream.status === 429 ? "upstream_rate_limited" : "upstream_error",
      upstream.status === 429 ? "Model service rate limit reached." : "Model service request failed.",
      id,
      headers,
    );
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      ...cors,
      "cache-control": "no-store",
      "x-request-id": id,
      "content-type": upstream.headers.get("content-type") || "application/json",
    },
  });
}
