# AI Authoring Core

The Core is platform-neutral. It contains no VS Code, Theia, DOM, Webview, browser UI, Gateway-server implementation or provider SDK dependency.

## Current modules

- `context-pack.mjs` builds a bounded, allowlisted context projection from Host-provided snapshots. It does not scan the workspace or open files itself.
- `procedure-agent.mjs` builds the domain-specific Procedure Authoring prompt and invokes the injected Model Client only after explicit disclosure acceptance.
- `model-proposal.mjs` validates model output as an untrusted, typed proposal. It does not treat model output as a Patch or executable instruction.
- `gateway-client.mjs` implements the OpenAI-compatible Chat Completions client for the independent Go Gateway.

## Go Gateway client contract

- `gatewayBaseUrl` is the Gateway route prefix, including the configured upstream label and any upstream path prefix. The client appends `/v1/chat/completions`.
- `modelId` comes from trusted application configuration and is sent in the request body. It is never selected by model output.
- `sessionId` is a stable Host-generated `X-Opencode-Session` value for the Editor Tab session.
- `gatewayToken` is optional and represents the one deployment-wide `X-Gateway-Token` for a non-loopback Gateway. The Host may read it from Extension SecretStorage; it is not a provider credential or user identity.
- Requests use `credentials: omit`. No browser cookies or provider Authorization header are sent by Studio.
- HTTP is accepted only for loopback Gateway URLs; non-loopback Gateway URLs must use HTTPS.
- The provider API Key is configured only on the Go Gateway host, normally through its environment-backed upstream configuration. It never enters this package, the Webview, VSIX, workspace, Context Pack or diagnostics.

The Go Gateway is a transparent reverse proxy. It routes by upstream label, injects server-side provider headers and forwards the request / response. It does not parse prompts, choose Model IDs, transform OpenAI-compatible payloads or implement user accounts. Browser CORS is disabled by default; exact-origin support for browser-hosted Studio is tracked in [ai-gateway Issue #4](https://github.com/odango-chan/ai-gateway/issues/4).

## Tests

Run the repository's `npm test`. Gateway client tests use a Fetch-compatible stub and verify the public Go Gateway route / header contract without embedding or invoking a Worker implementation.
