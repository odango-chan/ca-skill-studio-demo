function isLoopbackHostname(hostname) {
  const value = String(hostname || "").toLowerCase();
  return value === "localhost" || value === "127.0.0.1" || value === "::1" || value === "[::1]";
}

function gatewayEndpoint(value) {
  let url;
  try { url = new URL(String(value ?? "").trim()); }
  catch { throw new TypeError("Gateway URL must be an absolute HTTP(S) URL."); }

  const loopback = isLoopbackHostname(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new TypeError("Gateway URL must use HTTPS for non-loopback hosts; HTTP is allowed only for loopback.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new TypeError("Gateway URL must not contain credentials, query parameters or fragments.");
  }
  const routePrefix = url.pathname.replace(/\/+$/, "");
  if (!routePrefix || routePrefix === "/") {
    throw new TypeError("Gateway URL must include an upstream route label and optional upstream path prefix.");
  }
  return `${url.origin}${routePrefix}/v1/chat/completions`;
}

function validateModelId(value) {
  if (typeof value !== "string") throw new TypeError("A configured Model ID is required.");
  const modelId = value.trim();
  if (!new RegExp("^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$").test(modelId)) {
    throw new TypeError("The configured Model ID is invalid.");
  }
  return modelId;
}

function validateGatewayToken(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new TypeError("Gateway token must be a printable string.");
  const token = value.trim();
  if (!token) return undefined;
  if (token.length > 8192 || !/^[\x21-\x7E]+$/.test(token)) {
    throw new TypeError("Gateway token must be a printable value no longer than 8192 characters.");
  }
  return token;
}

function validateSessionId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(value)) {
    throw new TypeError("A stable OpenCode Go session ID is required.");
  }
  return value;
}

function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 64) {
    throw new TypeError("Messages must be a non-empty array with at most 64 entries.");
  }
  return messages.map(message => {
    if (!message || !["system", "user", "assistant"].includes(message.role) || typeof message.content !== "string") {
      throw new TypeError("Each message must contain a supported role and string content.");
    }
    return { role: message.role, content: message.content };
  });
}

function validateResponseFormat(value) {
  if (value === undefined) return undefined;
  if (!value || value.type !== "json_object") throw new TypeError("Only the JSON object response format is supported.");
  return { type: "json_object" };
}

export class GatewayRequestError extends Error {
  constructor(message, { status = 0, requestId = undefined } = {}) {
    super(message);
    this.name = "GatewayRequestError";
    this.status = status;
    this.requestId = requestId;
  }
}

export function createGatewayModelClient({
  gatewayBaseUrl, modelId, gatewayToken, sessionId,
  fetchImpl = globalThis.fetch, maxRequestBytes = 245760, maxOutputTokens = 2048
}) {
  if (typeof fetchImpl !== "function") throw new TypeError("A Fetch-compatible implementation is required.");
  const endpoint = gatewayEndpoint(gatewayBaseUrl);
  const selectedModelId = validateModelId(modelId);
  const sharedGatewayToken = validateGatewayToken(gatewayToken);
  const stableSessionId = validateSessionId(sessionId);
  const outputTokenLimit = Number.isFinite(maxOutputTokens) ? Math.max(1, Math.min(Math.trunc(maxOutputTokens), 8192)) : 2048;
  const requestByteLimit = Number.isFinite(maxRequestBytes) ? Math.max(1024, Math.min(Math.trunc(maxRequestBytes), 1048576)) : 245760;

  return Object.freeze({
    async complete({ messages, signal, contextDisclosureAccepted = false, maxTokens = outputTokenLimit, responseFormat = { type: "json_object" } }) {
      if (contextDisclosureAccepted !== true) {
        throw new TypeError("Explicit context disclosure acceptance is required before sending a model request.");
      }
      const requestMessages = validateMessages(messages);
      const tokenCount = Number.isFinite(maxTokens) ? Math.max(1, Math.min(Math.trunc(maxTokens), outputTokenLimit)) : outputTokenLimit;
      const body = { model: selectedModelId, messages: requestMessages, max_tokens: tokenCount, stream: false };
      const format = validateResponseFormat(responseFormat);
      if (format) body.response_format = format;
      const serialized = JSON.stringify(body);
      if (new TextEncoder().encode(serialized).byteLength > requestByteLimit) {
        throw new TypeError("The model request exceeds the configured byte limit.");
      }
      const headers = { "content-type": "application/json", "x-opencode-session": stableSessionId };
      if (sharedGatewayToken) headers["x-gateway-token"] = sharedGatewayToken;

      let response;
      try {
        response = await fetchImpl(endpoint, { method: "POST", credentials: "omit", headers, body: serialized, signal });
      } catch {
        throw new GatewayRequestError("The AI Gateway request could not be completed.");
      }
      if (!response || typeof response.ok !== "boolean") throw new GatewayRequestError("The AI Gateway returned an invalid response.");
      if (!response.ok) {
        throw new GatewayRequestError("The AI Gateway rejected the model request.", {
          status: response.status,
          requestId: response.headers?.get?.("x-request-id") || undefined
        });
      }
      let payload;
      try { payload = await response.json(); }
      catch {
        throw new GatewayRequestError("The AI Gateway returned a non-JSON response.", {
          status: response.status,
          requestId: response.headers?.get?.("x-request-id") || undefined
        });
      }
      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) throw new GatewayRequestError("The model response did not contain a usable proposal.");
      return Object.freeze({
        content,
        model: typeof payload.model === "string" ? payload.model : selectedModelId,
        usage: payload.usage && typeof payload.usage === "object" ? payload.usage : undefined,
        requestId: response.headers?.get?.("x-request-id") || undefined
      });
    }
  });
}
