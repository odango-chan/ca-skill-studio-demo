# Live AI Gateway acceptance (Windows first)

This is an **opt-in** provider smoke test for Skill Studio AI Authoring.
It calls the configured Go `ai-gateway` through the **same Authoring Core
Gateway Model Client and Procedure Agent** as the Editor Tab. It sends **only
a synthetic CA-SL v1alpha5 Procedure**, never the 5GC Example, and cannot
edit files or qualify Owner, Tool, Runtime or Deployment.

## Preconditions

- Native Windows `ai-gateway` **v0.2.0** is running on
  `127.0.0.1:8787` using `config.studio-pages.example.yaml`, with the
  Provider API Key held **only by the Gateway process**.
- The user has already verified in the real
  [Studio Pages](https://odango-chan.github.io/ca-skill-studio-demo/)
  browser that `GET /healthz` returns `200 ok` after approving local
  network / loopback access, and that the real `deepseek-v4.1-flash`
  chat completion returns HTTP 200. Those manual checks prove the browser
  transport and upstream, **not** Authoring Core semantics.
- Node.js **24+** is available only for this local smoke script; it is
  **not** required to run the released Gateway or the published Pages site.
- Use the current Studio `main` checkout. PR #208 has been merged, and the
  smoke is now part of the released source at
  `experiments/ide-host/scripts/ai-authoring-live-gateway-smoke.mjs`.

## Preferred: run from the current Studio main checkout

From the Studio repository root, on the current `main` branch, open
Command Prompt or PowerShell and run:

```cmd
set STUDIO_AI_GATEWAY_URL=http://127.0.0.1:8787/opencode-go/openai
set STUDIO_AI_MODEL_ID=deepseek-v4.1-flash
node experiments/ide-host/scripts/ai-authoring-live-gateway-smoke.mjs
```

Node.js **24+** must be on `PATH`. The command sends one explicitly
authorized synthetic request through the same Authoring Core Gateway Model
Client and Procedure Agent used by the Editor Tab. It does not require Go,
WSL, PowerShell execution-policy changes, or any provider key in the Studio
repository. The already-running Gateway holds the OpenCode Go credential.

If you do not have a Studio checkout, the portable Windows smoke artifact
from the successful PR #208 verification run may still be downloaded from
that run's Actions artifacts; the source script on `main` is the canonical
version and should be preferred for future runs.

## Alternative: run from Windows PowerShell with explicit environment cleanup

From the **current Studio main repository root**, not the Gateway executable directory:

```powershell
$env:STUDIO_AI_GATEWAY_URL = 'http://127.0.0.1:8787/opencode-go/openai'
$env:STUDIO_AI_MODEL_ID = 'deepseek-v4.1-flash'
try {
    node experiments/ide-host/scripts/ai-authoring-live-gateway-smoke.mjs
}
finally {
    Remove-Item Env:STUDIO_AI_GATEWAY_URL, Env:STUDIO_AI_MODEL_ID -ErrorAction SilentlyContinue
}
```

This invokes `node` directly: no unsigned PowerShell script, policy bypass,
PowerShell administrator privileges, WSL or Go installation is needed.
For an explicitly authorized remote Gateway only, the optional
`STUDIO_AI_GATEWAY_TOKEN` may be supplied outside the repository in the
process environment. Never put that token or the Provider API Key in a file,
command history, CI artifact, webview state or issue comment. The local
loopback example does **not** require a shared Gateway token.

The client appends `/v1/chat/completions` to the configured base URL.
This script uses Node's HTTP client; **the browser's Local Network Access
permission is a separate test**. The actual Studio Gateway Client now
sets `targetAddressSpace: "loopback"` only for local Gateway origins;
HTTPS remote gateways remain unchanged.

## Interpreting results

`STUDIO_AI_AUTHORING_LIVE_GATEWAY_SMOKE` with
`providerRequest: PASS`, `responseEnvelope: PASS` and
`modelProposalSchema: PASS` proves one real model completion passed the
Authoring Core semantic proposal contract. If
`sourcePatchPreview: PASS`, the returned semantic operations also
produced a source-preserving candidate for the synthetic Procedure.
A response with blockers is **not** a successful Apply. A bad JSON
proposal or an HTTP error is a real failure of this smoke, not a signal
to weaken validation.

The script intentionally logs **no model response body, prompt, Provider
Key or Gateway token**. Its output contains only aggregate counts,
pass/fail classifications and sanitized error categories. Do not copy
secrets or full model responses into GitHub.

## How this evidence fits the shipped Editor Tab

The live-provider smoke proves one real OpenCode Go completion passed the
Authoring Core ModelProposal contract and produced a source-preserving
candidate for a synthetic Procedure. It deliberately does **not** run the
Compiler or modify an editor buffer.

Separately, the merged AI Editor Tab has passed real Theia Chromium
acceptance using a controlled mock-model proposal and a trusted synthetic
Package: selected Change Set group → exact pinned Compiler v2.0.2 Check
PASS → native WorkspaceEdit → Undo. This proves the Editor Tab's positive
Apply path without relying on nondeterministic model output.

These are complementary acceptance results, **not** a claim that one
single run used a live model and then applied that same model response.
That combined live-provider-to-Apply run remains optional further evidence,
not a blocker to the shipped P1 development integration. Neither test
qualifies real 5GC Owner, Tool, Runtime, Wait/Ingress or Deployment behavior.
The official 5GC Examples remain Preview-Only when Compiler Check returns
errors; Wait requires trusted IngressCatalog.

## Other platforms

On Linux/macOS, or when using a personally managed WSL installation,
run the same script with environment exports:

```sh
export STUDIO_AI_GATEWAY_URL='http://127.0.0.1:8787/opencode-go/openai'
export STUDIO_AI_MODEL_ID='deepseek-v4.1-flash'
node experiments/ide-host/scripts/ai-authoring-live-gateway-smoke.mjs
```

These are alternatives, **not prerequisites** for the Windows release.
