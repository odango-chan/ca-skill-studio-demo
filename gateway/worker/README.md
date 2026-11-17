# CA Skill Studio AI Gateway

A small provider-neutral application Gateway for the first AI Procedure Authoring pilot.

    Studio browser / VS Code client
                |
                | POST /v1/chat/completions (SSE)
                v
    Cloudflare Access-protected Application Worker
                |
                | fixed HTTPS endpoint + server-side Provider Key
                v
    Configured OpenAI-compatible Chat Completions provider

Cloudflare AI Gateway is not called by the browser. It may be added behind this Worker later for routing or observability.

## Implemented boundary

- Only POST /v1/chat/completions is accepted for model requests.
- Cloudflare Access must authenticate the direct Worker invocation. The Worker checks ctx.access.aud and reads the verified identity using ctx.access.getIdentity().
- The verified email is normalized and used as the per-user rate-limit key. Caller-supplied user IDs and IP addresses are not trusted.
- A Cloudflare Rate Limiting binding is mandatory. Missing or failed rate limiting fails closed.
- Only configured models and the configured provider endpoint are used. Arbitrary client URLs, provider headers and unknown request fields are rejected.
- Provider credentials are read only from the Worker secret PROVIDER_API_KEY.
- Request body, output token ceilings and a provider response-header timeout are enforced. Optional structured output is restricted to JSON-object mode; the client must still parse and validate the ModelProposal / Change Set schema.
- Streaming is mandatory. The upstream SSE body is passed through without buffering. Redirects, non-SSE responses and provider error bodies are not forwarded.
- CORS uses an exact origin allowlist. CORS is not authentication; Access remains mandatory.
- Prompts, completions, identities and credentials are not logged.

## Local tests

Requires Node.js 24. No Cloudflare account or live provider key is required for unit tests.

    node --test gateway/worker/tests/index.test.mjs

The access.dev block in wrangler.jsonc simulates an authenticated local Access identity for Wrangler development. It is development-only and is not a production access policy.

    cd gateway/worker
    npx wrangler@4.157.0 dev

To test a real provider locally, put the key in a local .dev.vars file (never commit it):

    PROVIDER_API_KEY=replace-with-your-provider-key

## Restricted pilot deployment

Do not deploy until the target Cloudflare account has been configured:

1. Create an Access application protecting the Worker's production hostname and restrict the policy to explicitly allowed pilot users.
2. Enable Access directly on the Worker. Do not add Static Assets or a Vite-generated assets router in front of this Worker: Cloudflare documents that the assets router does not pass ctx.access to the user Worker.
3. Set ACCESS_AUD to the Access application's audience tag.
4. Set ALLOWED_ORIGINS to exact Studio origins, without wildcards.
5. Set ALLOWED_MODELS to exact approved provider model identifiers.
6. Set PROVIDER_CHAT_COMPLETIONS_URL to the approved HTTPS Chat Completions endpoint.
7. In the Access application's CORS settings, enable Bypass OPTIONS requests to origin; do not also configure Access-managed CORS headers. This bypass is for preflight only; POST remains protected. The Worker enforces the exact origin allowlist.
8. Replace the sample Rate Limiting namespace ID with a unique integer for this Cloudflare account.
9. Set the provider key as a Worker secret:

       cd gateway/worker
       npx wrangler@4.157.0 secret put PROVIDER_API_KEY

The sample rate limit is 10 requests per user per 60 seconds. For the browser client, use credentials: include and test after logging into the Access-protected Worker hostname. GitHub Pages and workers.dev are cross-site; browser third-party-cookie restrictions can prevent the CF_Authorization cookie from being sent. Do not treat a successful unit test as proof of this browser login path. Tune it before a real pilot. A missing Access context, wrong audience, missing binding or missing secret prevents upstream calls.

## Limits and non-goals

Cloudflare's Rate Limiting binding is approximate and regional, not a strict global quota. It is a burst-abuse control, not a hard provider spend cap. Configure provider-side spending controls where supported. A strict application-wide spend ledger would require a separately designed durable accounting component and is intentionally excluded from this first no-database spike.

Unit tests do not prove production deployment, Access login from GitHub Pages, real provider behavior, production CORS or account eligibility. Those remain separate acceptance gates. The first pilot is allowlisted; the final general-public identity model is not decided.
