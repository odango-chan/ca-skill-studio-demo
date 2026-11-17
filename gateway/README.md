# CA Skill Studio AI Gateway spike

**Status: local implementation and deterministic tests only. Cloudflare deployment and live provider calls are NOT_RUN.**

This is the first deployable shape of the shared OpenAI-compatible Gateway. The request handler uses the Web Fetch API and has no VS Code, Theia, DOM, Node-only or Cloudflare imports. The Cloudflare Worker entry point is a thin adapter that supplies the trusted client IP and rate-limit binding.

## What this spike proves

- A deployment-scoped provider key is injected only by the Gateway.
- The browser sends a Turnstile token, never the provider key.
- Turnstile tokens are verified server-side and bound to an expected hostname and action.
- CORS uses an exact origin allowlist; no wildcard origin or credentialed CORS.
- A Cloudflare Rate Limiting binding is required and fails closed when missing.
- The model and upstream endpoint are deployment configuration, not client parameters.
- Only a narrow Chat Completions request subset is forwarded; tool calling and unknown fields are rejected.
- Output tokens and input bytes are capped.
- The upstream response body is streamed without caching; provider errors are sanitized.
- The handler is reusable through a Fetch-compatible adapter for a later self-hosted Node / intranet deployment.

This is not a complete identity system. Turnstile plus per-IP rate limiting is an anti-abuse baseline, not proof that a caller is an authorized employee or invited user. Before broad public release, choose an identity / invitation policy or deploy the Gateway behind an internal access boundary. Do not treat CORS, a hidden URL or a client-shipped static token as authentication.

## Local verification

From the repository root:

~~~bash
npm test
npm run test:gateway
~~~

The tests use mocked Siteverify and model endpoints. They prove request shaping, fail-closed behavior, origin checks, rate-limit integration, token limits, sanitization and streaming pass-through. They do not prove a live Cloudflare deployment or a real model response.

## Cloudflare Worker Free deployment

Cloudflare Workers Free currently documents 100,000 requests per day, 10 ms CPU time per invocation and 50 external subrequests per invocation. The Gateway makes at most two external subrequests per model request: Turnstile Siteverify and the configured model endpoint. The CPU budget is for Worker execution, not the time spent waiting for the upstream model response. Verify current limits before deployment.

1. Create a Turnstile widget with hostname odango-chan.github.io and action ai_authoring. Use the public site key in the Studio client; keep the secret key in Worker secret storage.
2. Configure OPENAI_MODEL in gateway/wrangler.jsonc for the selected OpenAI-compatible provider.
3. Set the deployment secrets:

~~~bash
npx wrangler@4.34.0 secret put OPENAI_API_KEY --config gateway/wrangler.jsonc
npx wrangler@4.34.0 secret put TURNSTILE_SECRET_KEY --config gateway/wrangler.jsonc
~~~

4. Replace TURNSTILE_SITE_KEY in the Worker vars with the public widget site key.
5. Deploy:

~~~bash
npx wrangler@4.34.0 deploy --config gateway/wrangler.jsonc
~~~

6. Check GET /healthz and GET /public-config from the allowed origin. Then run the browser integration against /v1/chat/completions.

Do not deploy until the provider secret, Turnstile secret, site key, model ID and rate-limit binding are configured. The Worker intentionally returns gateway_not_configured if required bindings or secrets are absent.

## Security and budget notes

- OPENAI_API_KEY and TURNSTILE_SECRET_KEY are Worker secrets; never put them in vars, browser assets, VSIX, Webview HTML, local settings or logs.
- TURNSTILE_SITE_KEY is public and may be returned by /public-config.
- The rate-limit binding is approximate and local to Cloudflare locations; it is not a strict global spend limit.
- Set provider-side account / project spending controls. MAX_OUTPUT_TOKENS caps each completion but does not create a global daily token budget.
- Cloudflare Workers spending limits, if configured, limit Cloudflare charges; they do not cap the upstream model provider bill.
- A public beta needs a clear access policy. Turnstile is an anti-bot signal, not user authentication.
- The OPENAI_BASE_URL is deployment-owned and must use HTTPS by default. Never accept an upstream URL from the browser.
- The first Worker profile allows only the GitHub Pages origin. VS Code Desktop, Web, Remote and intranet deployments need their own explicit origin / identity adapter configuration.

## API

- GET /healthz — liveness only; does not expose configuration.
- GET /public-config — returns only the public Turnstile site key to an allowed origin.
- POST /v1/chat/completions — narrow OpenAI-compatible Chat Completions proxy.
- OPTIONS /v1/chat/completions — CORS preflight.

The /v1/models endpoint, tool calls, arbitrary upstream paths, file access and workspace writes are intentionally not implemented.
