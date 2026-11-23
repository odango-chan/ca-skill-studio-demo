# Live AI Gateway acceptance (WSL / Linux)

This is an **opt-in** provider smoke test for Skill Studio AI Authoring. It calls the configured Go `ai-gateway` using the same Authoring Core Model Client and Procedure Agent as the Editor Tab. It sends **only a synthetic Procedure**; it does not transmit the 5GC Example, read a workspace, run Compiler or modify a file. It does not certify Owner, Release, Runtime, or the positive Editor Tab Apply flow.

Requires Node.js 24+, an already running Go AI Gateway, a configured OpenAI-compatible upstream, and a model ID that the upstream accepts. On WSL, a loopback Gateway can usually be addressed using the listener configured in `ai-gateway`; if running on another machine, use its explicitly configured HTTPS route with the shared access token.

Run from the Studio repository root:

```bash
export STUDIO_AI_GATEWAY_URL='http://127.0.0.1:8787/opencode-go/openai'
export STUDIO_AI_MODEL_ID='YOUR_ACTUAL_MODEL_ID'
# Only when your remote Gateway requires a shared access token:
# read -r -s STUDIO_AI_GATEWAY_TOKEN; export STUDIO_AI_GATEWAY_TOKEN
node experiments/ide-host/scripts/ai-authoring-live-gateway-smoke.mjs
```

The base URL includes the upstream name and path prefix; the client appends `/v1/chat/completions`. Do not place credentials in the URL. Provider API keys such as `OPENCODE_GO_API_KEY` remain on the Gateway host; `STUDIO_AI_GATEWAY_TOKEN` is only the optional shared Gateway access token. Keep both out of source, CI logs and issue comments.

Passing output includes `STUDIO_AI_AUTHORING_LIVE_GATEWAY_SMOKE`, `providerRequest: PASS`, `responseEnvelope: PASS`, and `modelProposalSchema: PASS`. `sourcePatchPreview: PASS` additionally proves that the real model's semantic proposal can produce a source-preserving synthetic YAML candidate. A model may return blockers instead; that is distinct from a protocol error and must not be mislabeled as Apply success.

This smoke deliberately does not use the Compiler trusted request or execute native WorkspaceEdit. Those are covered separately by the pinned real Go/WASM Compiler and backend Chromium native Apply/Undo acceptance. A production-shaped live-provider **Editor Tab** Apply still requires a qualified Package context and remains a separate merge gate.

Never publish real provider credentials or full model responses in an issue or workflow artifact.
