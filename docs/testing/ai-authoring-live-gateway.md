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
- Use the Studio PR #208 checkout
  (`feat/ai-authoring-editor-tab-v1alpha5-20261117`). The smoke is not
  present on Studio `main` while #208 remains unmerged.

## Preferred: download the small Windows smoke package

On [Studio PR #208](https://github.com/odango-chan/ca-skill-studio-demo/pull/208),
open the latest successful **Verify Skill Studio pull requests** run. Under
**Artifacts**, download `studio-ai-authoring-live-smoke-windows`, then unzip it
into a directory under Windows Downloads. The archive contains:

- `ai-authoring-live-gateway-smoke.mjs` — one bundled executable containing
  the **real Studio Authoring Core / Procedure Agent / Patch Engine**, not a
  handwritten imitation or a generic Gateway ping;
- `run-live-gateway-smoke.cmd` — Windows CMD launcher with preconfigured local
  Gateway URL and `deepseek-v4.1-flash`, an explicit yes/no consent prompt,
  and no PowerShell execution-policy requirement;
- `README.md` — this document.

Open **Command Prompt** or PowerShell inside the extracted folder and run:

```cmd
.\\run-live-gateway-smoke.cmd
```

Node.js **24+** must be on `PATH` for this optional smoke. Git, a cloned
Studio repository, project `npm install`, Go, WSL and changing PowerShell
script policy are **not** required. The launcher does **not** read or embed
your OpenCode Go API Key; the already-running Gateway holds it. The resulting
status line can be shared, but never copy model response contents or secrets.
The test only attempts a single synthetic model request after you approve it.

## Alternative: run from the Studio PR checkout on Windows PowerShell

From the **Studio repository root**, not the Gateway executable directory:

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

This smoke does **not** run the pinned Compiler or modify a file. Existing
CI separately verifies the actual v2.0.2 Go/WASM Compiler's positive Check
and native WorkspaceEdit/Undo with a trusted synthetic fixture.
**Production Editor Tab model-generated Proposal → selected Patch →
Compiler PASS → Apply → Undo remains a separate gate** for #208.
The official 5GC Examples are not qualified and must remain Preview-Only
when Compiler Check returns errors; Wait requires trusted IngressCatalog.

## Other platforms

On Linux/macOS, or when using a personally managed WSL installation,
run the same script with environment exports:

```sh
export STUDIO_AI_GATEWAY_URL='http://127.0.0.1:8787/opencode-go/openai'
export STUDIO_AI_MODEL_ID='deepseek-v4.1-flash'
node experiments/ide-host/scripts/ai-authoring-live-gateway-smoke.mjs
```

These are alternatives, **not prerequisites** for the Windows release.
