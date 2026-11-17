export class GatewayRequestError extends Error {
  constructor(status, code, requestId = null) {
    super("AI Gateway request failed (" + status + ", " + code + ").");
    this.name = "GatewayRequestError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

function gatewayEndpoint(value) {
  let url;
  try { url = new URL(String(value)); }
  catch { throw new TypeError("Gateway URL must be an absolute HTTPS URL."); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new TypeError("Gateway URL must use HTTPS and cannot contain credentials, query or fragment.");
  }
  return url.toString().replace(/\/+$/, "") + "/v1/chat/completions";
}

function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 64) {
    throw new TypeError("At least one and at most 64 model messages are required.");
  }
  for (const message of messages) {
    if (!message || typeof message !== "object" || Array.isArray(message) ||
      Object.keys(message).some((key) => key !== "role" && key !== "content")) {
      throw new TypeError("Every model message must contain only role and content.");
    }
    if (!["system", "user", "assistant"].includes(message.role)) {
      throw new TypeError("Unsupported model message role.");
    }
    if (typeof message.content !== "string" &&
      !(Array.isArray(message.content) && message.content.length > 0 &&
        message.content.every((part) => part && part.type === "text" &&
          typeof part.text === "string" &&
          Object.keys(part).every((key) => key === "type" || key === "text")))) {
      throw new TypeError("Model message content must be text.");
    }
  }
}

function validateResponseFormat(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    value.type !== "json_object") {
    throw new TypeError("Unsupported response format.");
  }
  return value;
}

function tokenLimit(value, ceiling) {
  if (value === undefined) return ceiling;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError("maxTokens must be a positive integer.");
  }
  return Math.min(value, ceiling);
}

function gatewayError(payload, status) {
  const rawCode = payload && payload.error && payload.error.code;
  const code = typeof rawCode === "string" && /^[a-z0-9_]{1,80}$/.test(rawCode)
    ? rawCode : "gateway_request_failed";
  const requestId = payload && payload.error && typeof payload.error.request_id === "string"
    ? payload.error.request_id : null;
  return new GatewayRequestError(status, code, requestId);
}

export function createGatewayModelClient({
  gatewayBaseUrl,
  fetchImpl = globalThis.fetch,
  maxOutputTokens = 2048,
  maxRequestBytes = 245760,
} = {}) {
  const endpoint = gatewayEndpoint(gatewayBaseUrl);
  if (typeof fetchImpl !== "function") throw new TypeError("A Fetch-compatible implementation is required.");
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 8192) {
    throw new TypeError("maxOutputTokens must be between 1 and 8192.");
  }
  if (!Number.isSafeInteger(maxRequestBytes) || maxRequestBytes < 1024 || maxRequestBytes > 262144) {
    throw new TypeError("maxRequestBytes must be between 1024 and 262144.");
  }

  return Object.freeze({
    async complete({
      messages,
      contextDisclosureAccepted = false,
      responseFormat,
      maxTokens,
      signal,
    } = {}) {
      if (contextDisclosureAccepted !== true) {
        throw new Error("Context disclosure must be explicitly accepted before sending a model request.");
      }
      validateMessages(messages);
      const body = {
        messages,
        stream: false,
        max_tokens: tokenLimit(maxTokens, maxOutputTokens),
      };
      const format = validateResponseFormat(responseFormat);
      if (format !== undefined) body.response_format = format;
      const serializedBody = JSON.stringify(body);
      const requestBytes = new TextEncoder().encode(serializedBody).byteLength;
      if (requestBytes > maxRequestBytes) {
        throw new RangeError("Model request exceeds the configured UTF-8 byte limit.");
      }

      let response;
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: serializedBody,
          signal,
        });
      } catch (error) {
        if (error && error.name === "AbortError") throw error;
        throw new GatewayRequestError(0, "gateway_unavailable");
      }

      if (!response.ok) {
        let payload = null;
        try { payload = await response.json(); } catch { payload = null; }
        throw gatewayError(payload, response.status);
      }

      let payload;
      try { payload = await response.json(); }
      catch { throw new GatewayRequestError(502, "invalid_gateway_response"); }
      const content = payload && payload.choices && payload.choices[0] &&
        payload.choices[0].message && payload.choices[0].message.content;
      if (typeof content !== "string") throw new GatewayRequestError(502, "missing_model_content");
      return content;
    },
  });
}
