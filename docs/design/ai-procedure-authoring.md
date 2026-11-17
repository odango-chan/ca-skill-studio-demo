# AI Procedure Authoring Workbench

**Status: Proposed · Product decisions approved; CA-SL v1alpha5 Preview target · detailed design awaiting review**  
**Implementation: Gateway PARTIAL · Authoring Core PARTIAL · v1alpha5 Semantic Patch Engine PARTIAL (PR #207) · Editor / Host integration NOT_STARTED · Acceptance: NOT_RUN · Date: 2026-11-17**  
**Tracking: [Issue #200](https://github.com/odango-chan/ca-skill-studio-demo/issues/200)**

This document defines the first AI-assisted authoring capability for Skill Studio. It is a Studio editing feature, not a CA-SL language extension, Compiler feature, Host capability or Runtime feature.

## 1. Approved product decisions

| Decision | P1 baseline |
|---|---|
| Main surface | A standalone Editor Tab named **AI Authoring** |
| Editing model | A Studio-owned, versioned semantic Change Set; host-native ChangeSet APIs are optional adapters, not the source of truth |
| Apply behavior | Apply accepted changes to the existing native TextDocument buffer; the user saves |
| First release | Modify an existing CA-SL v1alpha5 Preview Procedure only; no v1alpha4 fallback |
| Architecture target | One cross-host Authoring core for Theia Browser, VS Code Desktop/Web/Remote and self-hosted intranet deployments |
| First implementation target | The existing Theia Browser-Only / GitHub Pages product, using an external OpenAI-compatible AI Gateway |
| Model credentials | One deployment-scoped shared provider credential, held by the Gateway; no per-user model API keys |
| Deployment portability | Cloudflare Worker is a candidate online Gateway deployment, not a dependency of the Authoring core |

The main surface is not a permanent chat sidebar. Natural language is the task input and refinement mechanism; the primary output is a reviewable Change Set.

The first implementation is online-first, but the product architecture is not online-only. Later host and Gateway deployments must consume the same Authoring contracts and must not require a second Procedure Agent, proposal format or patch engine.

A shared provider credential does not remove the need to protect the Gateway itself. Gateway access authorization, abuse controls and usage limits are separate from provider-key management; they must not be implemented by exposing the provider key to clients.

## 2. Current implementation baseline

The current Theia workbench already provides useful host infrastructure:

- A VS Code Web Extension hosted by Theia browser-only and backend-backed hosts.
- A Procedure CustomEditor implemented as a Webview, paired with the native Source editor.
- Native TextDocument versions, native WorkspaceEdit, editor dirty state and Undo/Redo.
- A Package snapshot collector that prefers open TextDocuments over persisted bytes.
- A pinned CA-SL v1alpha5 Preview candidate and exact IngressCatalog companion contract; v1alpha5 status remains NOT RELEASED / NOT QUALIFIED.
- The published Compiler v1.0.0 integration is v1alpha4-only. Compiler PR #30 adds a v1alpha5 candidate API / WP2 parser-AST, but full v1alpha5 Check is not yet available.
- **No model / Agent integration is currently installed in the Studio workbench.** The current Theia 1.76.0 application manifests do not include the Theia AI packages. Existing LSP completion, diagnostics and semantic tokens are language tooling, not LLM-based AI.
- A first portable Gateway implementation now exists under `gateway/`: a Fetch-API request handler, a thin Cloudflare Worker adapter, Wrangler configuration and deterministic Node tests. It is not yet deployed and has not made a live provider request.
- The first host-neutral Authoring Core slices now exist under `authoring/core/`: an allowlisted Context Pack builder with a serialized byte budget, an OpenAI-compatible Gateway client that requires explicit context-disclosure acceptance and sends browser Access credentials, a Procedure proposal orchestrator, and a strict Studio ModelProposal validator. It has no VS Code, Theia, DOM, Node-only or Cloudflare imports.
- The Worker pilot requires direct Cloudflare Access protection, an exact CORS origin allowlist and a per-identity Cloudflare Rate Limiting binding. The provider credential remains a Worker secret. The general-public identity policy remains undecided; the restricted pilot must not be treated as a public endpoint.
- The production GitHub Pages application is static hosting. It has no trusted server process in which to keep a shared provider key. The Pages bundle, browser storage, Webview and VSIX are all client-controlled and must never contain the shared provider credential. A separate Gateway service is required.
- The current Studio extension is a VS Code Web Extension hosted by Theia. VS Code documents that Web Extensions can also run on Desktop and Web, but their runtime does not provide Node.js APIs. This makes the current browser-compatible extension a useful portability baseline, not proof that every Desktop / Remote host mode is already supported ([VS Code Web Extensions](https://code.visualstudio.com/api/extension-guides/web-extensions)).

There is an important version boundary. The current Studio LSP / Procedure Designer baseline is still the published, frozen CA-SL v1alpha4 projection; it is read-only and MUST NOT be used to interpret or patch a v1alpha5 Procedure. PR #207 now provides a separate v1alpha5 patch engine, but no v1alpha5 LSP / Designer or Theia Host Adapter has been integrated yet. CA-SL v1alpha5 Preview inherits the immutable v1alpha4 normative baseline and adds Node-entry Event Wait through Appendix L. P1 MUST implement a v1alpha5-specific semantic patch layer and MUST NOT fall back to the v1alpha4 parser, patch engine or Compiler API.

The exact development pins are:
- CA-SL v1alpha5 Preview single-file candidate: `odango-chan/ca-skills@d3f89dfafbf218e5e95c97a974004362b7b967b6` (PR #61).
- Integration Ingress Operation / IngressCatalog companion contract: `odango-chan/ca-skills@561d14c639e11cc43d0f247111e4971dfb98761e` (PR #62).
These are Preview review refs, not published production dependencies. v1alpha5 remains PUBLIC REVIEW DRAFT / NOT RELEASED / NOT QUALIFIED; Studio must display that status and pin the exact commits used for development.

The published Compiler v1.0.0 targets v1alpha4 and MUST NOT be used to validate v1alpha5 candidates. Compiler PR #30 introduces the independent v1alpha5 API and WP2 Procedure / Wait parser-AST, but its WP3-WP8 linking, graph, SourcePath, response-boundary and conformance work is not complete. Until the v1alpha5 Compiler returns a complete authoritative result, candidate validation remains BLOCKED / NOT_RUN; AI Authoring must never translate Wait away, simulate it, or report a partial parser result as a full Check PASS.

## 3. Cross-host architecture and reuse strategy

The final architecture is host-neutral. Theia and VS Code supply editor integration; neither owns the Procedure Authoring domain logic or the shared model credential.

### 3.1 Shared Authoring Core

Create a platform-neutral TypeScript core with no imports from VS Code, Theia, DOM or Node-only APIs. It owns:

- Authoring task and session state.
- Context Pack schema, allowlist and disclosure manifest.
- Prompt construction and Procedure-specific orchestration.
- Versioned ModelProposal validation.
- Studio-owned semantic Change Set model and atomic-group rules.
- v1alpha5 semantic patch planning and candidate-source generation, including Node-entry Wait edits.
- Provider-neutral request / response / streaming / cancellation interfaces.

The core never reads or writes workspace files by itself. It receives snapshots and revision metadata through a Host Adapter and returns typed results. It does not own the model provider credential or Gateway deployment.

### 3.2 Host Adapter contract

A small AuthoringHost interface isolates editor and deployment differences. It must provide only the capabilities needed by the core:

| Capability | Responsibility |
|---|---|
| readDocument | Read the live Procedure TextDocument and its version / URI |
| readContext | Read explicitly allowlisted Package files and identify unsaved buffers |
| applyWorkspaceEdit | Apply host-generated edits to the current buffer through native editor APIs |
| getCompiler | Run the pinned Compiler against an in-memory Package overlay |
| getSecureSessionStore | Store short-lived Gateway access/session material where the host supports secure storage |
| openAuthoringTab | Open/focus the standalone AI Authoring Editor Tab |

Implement host adapters in stages:

1. **Theia Browser-Only** — first production adapter for GitHub Pages.
2. **VS Code Desktop / Web** — reuse the same browser-compatible core and Web Extension entry where possible; add a Node Extension Host adapter only for capabilities that genuinely require Node / local process access.
3. **VS Code Remote / WSL / Container** — explicitly choose whether the UI-side or workspace-side Extension Host owns the operation; the configured Gateway must be reachable from that host.
4. **Self-hosted intranet** — same host contract, pointing at an internal Gateway.

The VS Code Web Extension runtime is supported by VS Code on Desktop and Web, but it does not expose Node.js APIs. Do not confuse "extension runs locally in Desktop" with "it has unrestricted Node access" or with "the model provider key can be embedded in the extension package".

### 3.3 Model Client and Gateway boundary

The shared core depends on an IModelClient, not on Theia AI or a particular provider SDK. The production implementation is an OpenAI-compatible HTTP adapter targeting an AI Gateway.

The Gateway owns deployment-specific concerns:

- Provider endpoint, model routing and the shared provider API credential.
- Gateway-side authentication / session verification.
- Rate limits, request-size limits, timeout / cancellation propagation and usage controls.
- Safe forwarding of the supported OpenAI-compatible request / response stream.

The Studio client owns the task prompt, Context Pack, proposal schema and strict response validation. The Gateway is a transport / credential boundary; it does not parse CA-SL, decide whether a Procedure is valid, generate trusted source offsets or apply edits.

The baseline protocol should target the broadly supported OpenAI Chat Completions request / response shape. Streaming may be used for progress and response delivery, but a proposal is not reviewable until the complete payload has passed host-side schema validation. Do not assume every compatible provider supports /v1/models, strict JSON Schema mode, tool calling or identical cancellation semantics.

### 3.4 Optional native AI integrations

Native host AI APIs are optional adapters, not the canonical Agent runtime:

- **VS Code Language Model API (vscode.lm)** may be used as an optional model source in native VS Code when a model is available and the user has granted consent. Model selection may return no models, and availability / quotas depend on the user's VS Code / Copilot environment. It cannot be the required P1 path because the current Theia 1.76 VS Code plugin API stubs selectChatModels() and returns an empty list. See [VS Code Language Model API](https://code.visualstudio.com/api/extension-guides/ai/language-model).
- **Theia AI** may be reused behind a Theia-specific adapter if a supported host path is proven. It is not installed in the current application, and its backend-dependent provider path is not the Browser-Only production architecture.
- A future integration may expose the Gateway as a native VS Code model provider, but the standalone AI Authoring Editor Tab must work without opening Copilot Chat or depending on a Chat Participant.

This avoids building two generic chat products. Skill Studio implements only the domain-specific Authoring orchestration and typed Change Set workflow; it uses the common OpenAI-compatible Gateway for the first production path.

### 3.5 Keep CA-SL and host Agent Skills separate

VS Code / Theia Agent Skills, prompt instructions and chat tools are host-specific AI integration mechanisms. They are not CA-SL Skill Packages, do not define Procedure semantics and are not Compiler inputs. They may provide optional prompt knowledge only; the pinned CA-SL v1alpha5 Preview candidate and its matching Compiler implementation remain authoritative for this authoring path.

### 3.6 No generic file-editing agents

P1 MUST NOT delegate Procedure editing to a generic Coder agent or enable broad workspace file tools. The Authoring core is restricted to the explicit Context Pack and typed proposal schema. It cannot write files, execute shell commands, invoke Runtime / Tools or alter any Package file.

## 4. P1 scope

### 4.1 Included

- Open AI Authoring for one existing `assurance/procedure.yaml`.
- Capture the live unsaved Procedure TextDocument as the base revision.
- Build and display a bounded, explicit context pack.
- Accept a natural-language change request.
- Produce a plan and a structured candidate Change Set.
- Render Flow Changes and a YAML Diff generated by the host patch engine.
- Run Compiler Check against an in-memory candidate Package snapshot.
- Allow whole-set or safe atomic-group acceptance/rejection.
- Apply accepted operations to the native TextDocument buffer.
- Preserve native Save, dirty state, Source/Visual refresh and Undo/Redo.
- Keep a session-local revision history for proposal refinement.

### 4.2 Excluded

- Creating a new Skill from a reference.
- Editing Contract, PredicateSet, Schema, Script, Dependency Lock or Capability grants.
- Adding or changing Tool Owner contracts.
- Runtime invocation, Tool execution, qualification, release or real 5GC E2E.
- AI writing files directly, auto-saving or committing changes.
- A permanent chat sidebar or a second YAML editor.
- Automatic rebase of a stale proposal.
- Destructive Node / Stage / Route deletion in the first operation allowlist.

A request that requires an excluded change is reported as a blocker or a separately scoped follow-up. The model must not silently expand the write scope.

## 5. Entry and Editor Tab behavior

### 5.1 Entry points

P1 provides one primary command: **AI Authoring: Modify Current Procedure**.

- Open from the current Procedure Designer.
- Open from the native Command Palette.
- A contextual Node entry may be added after the primary workflow is stable; it is not required for the first acceptance slice.

The current menu reorganization is being handled separately by PR #199. The AI command should join its native **Authoring** group after that work is integrated; do not create a parallel top-level menu.

### 5.2 Target resolution

- If the active editor belongs to a supported v1alpha5 Preview Procedure, use that document.
- If no Procedure is active, offer a picker limited to the current workspace's `assurance/procedure.yaml` files.
- If the selected file is not v1alpha5 Preview, show an explicit unsupported-version explanation. Do not fall back to v1alpha4 or attempt Legacy conversion.
- One live Authoring session is allowed per Procedure URI. Reopening the command focuses the existing tab rather than opening a duplicate session.


### 5.3 Tab implementation

Preferred host implementation: a standalone VS Code-compatible WebviewPanel opened as one Editor Tab in the active editor group.

- It MUST NOT open a third editor column.
- It MUST NOT disturb the existing native Source / Procedure Visual pair.
- It MUST NOT register a second custom editor for procedure.yaml.
- The Webview is presentation only. It has no direct provider-network access, no provider credentials and no workspace write authority.
- The Extension Host / Host Adapter owns context reads, Gateway requests, proposal validation, Change Set state, patch generation, Compiler calls and native WorkspaceEdit application.
- In Browser-Only hosts, the Extension Host is itself browser-constrained; it calls the separately deployed Gateway over HTTPS and never receives the shared provider API key.
- In Desktop hosts, the same extension workflow uses the local Extension Host for editor operations but still calls the configured Gateway. A Node Extension Host is optional and must not become a second implementation of the Authoring core.

Theia Browser-Only and backend-backed hosts must prove the WebviewPanel lifecycle and tab placement. VS Code Desktop / Web compatibility is a later host acceptance gate; API parity must be verified rather than inferred from the shared extension API surface.

## 6. Workbench layout

The Editor Tab contains three internal regions. They are not three VS Code editor groups.

### 6.1 Context panel

Shows the exact information supplied to the model:

- Target Skill and Procedure path.
- CA-SL language target and pinned language-contract revision.
- Procedure base document version and source digest.
- Context file list, each marked **write target** or **read-only reference**.
- Whether a file came from an unsaved TextDocument or persisted workspace content.
- Size and inclusion state for each context item.
- Provider destination and the fact that content will leave the local workbench.

The context panel is collapsible. Narrow layouts move it into an internal drawer; they do not create another editor column.

### 6.2 Main Workbench

Four internal views:

| View | Responsibility |
|---|---|
| Plan | Restate the requested outcome, proposed steps, blockers and assumptions |
| Flow Changes | Compare the current and candidate v1alpha5 Procedure projections |
| YAML Diff | Show the exact source diff generated by the host patch engine |
| Validation | Show actual Compiler Check diagnostics and the validation snapshot identity |

Flow Changes is a read-only comparison of two source projections. It does not create a second graph model or become an editable business source.

### 6.3 Change Set panel

Shows:

- Summary and current proposal revision.
- Change operations and their atomic groups.
- Rationale and evidence references.
- Blockers, assumptions and unresolved references.
- Accept / reject controls.
- A single natural-language **Refine proposal** input.

Refinement creates a new proposal revision. The UI may show a compact revision timeline, but the primary interaction remains the plan, graph diff and source diff—not chat bubbles.

## 7. Context pack and disclosure

The existing Package snapshot collector can be reused as a source of live Package bytes, but its full output MUST NOT be sent to a model by default. The AI context pack is a separate allowlisted projection.

### 7.1 Default context candidates

| Source | Access | Default behavior |
|---|---|---|
| `assurance/procedure.yaml` | Write target | Required; use the live open TextDocument |
| `assurance/contract.yaml` | Read-only | Include relevant Goal, entry precondition, Context, dependencies and grants |
| `assurance/predicates.yaml` | Read-only | Include only referenced Predicate definitions and signatures |
| Referenced Skill-owned Schema files | Read-only | Include only schemas required to explain the affected references |
| Verified dependency / callable metadata | Read-only | Include only when a trusted, versioned snapshot is actually available |
| `references/` documents | Read-only | Opt-in per task; never silently include all references |
| Script source | Read-only | Opt-in only when a directly referenced script is material to the requested change |

### 7.2 Never include by default

- `.env`, credentials, tokens, secrets, browser storage or host environment.
- `lib/`, `output/`, build artifacts, logs, arbitrary workspace files or unrelated Skills.
- Whole dependency repositories or unverified external Owner content.
- Files outside the selected Package root.
- Any data not shown in the context preview.

The initial implementation enforces a **128 KiB serialized Context Pack limit** in UTF-8 bytes, leaving room below the Gateway's 256 KiB request-body limit for the system prompt and Chat Completions envelope. The limit is configurable per task but cannot exceed the 128 KiB implementation ceiling. Oversized context is rejected with a list of included items and their byte sizes; content must not be silently truncated. The ceiling remains subject to a real provider / prompt-size spike before it is treated as a product-wide frozen budget.

### 7.3 Consent

Before the first request in a task, the user sees the provider destination and exact context manifest, then explicitly confirms sending it. Changing the provider or adding context requires a new review. The extension must not transmit Package content merely because the AI Authoring tab was opened.


## 8. AI Gateway and deployment profiles

### 8.1 Canonical model protocol

**Provider family: OpenAI-compatible API.** The model endpoint and model ID are deployment configuration, not CA-SL or Authoring-core configuration.

The first client adapter targets the OpenAI Chat Completions-compatible request / response shape. The adapter must support cancellation and may support streaming. Structured output / JSON Schema response modes are capability-negotiated; the Host MUST validate every completed response against the Studio-owned ModelProposal schema even when the provider claims schema-constrained output.

The Gateway is intentionally thin. It authenticates the caller, applies per-user rate limits and request / output-token ceilings, injects the deployment's shared provider credential, and forwards OpenAI-compatible JSON or SSE responses. It does not own the Agent or editing semantics. It MUST NOT become a second Procedure Agent, parse CA-SL semantics, edit source or claim Compiler validity.

### 8.2 Deployment profiles

| Profile | Editor / Host | Gateway | Credential location | Status |
|---|---|---|---|---|
| **Online first** | GitHub Pages + Theia Browser-Only | Separate HTTPS Gateway; Cloudflare Worker Free is the first candidate | One deployment-scoped provider secret stored by the Gateway | Portable Worker spike implemented; Cloudflare deploy NOT_RUN |
| **VS Code Desktop** | Same VS Code extension and shared Authoring core; editor operations run in the local Extension Host | Reuse the online Gateway by default, or configure an internal Gateway | Provider secret remains server-side; optional short-lived Gateway session material uses host secure storage | Follow-up host adapter |
| **VS Code Web** | Browser Extension Host | Same online or intranet Gateway | Provider secret remains server-side | Follow-up host adapter |
| **VS Code Remote / WSL / Container** | Explicitly selected UI-side or workspace-side Extension Host | Gateway must be reachable from the selected host | Provider secret remains server-side | Follow-up host acceptance |
| **Intranet / self-hosted** | Theia Browser or VS Code Desktop/Web | Self-hosted Gateway on an internal server or managed workstation | Shared provider secret stored in the internal Gateway's environment / secret store | Final deployment target |

The Gateway protocol is identical across profiles. Moving from Cloudflare to an intranet Gateway changes deployment configuration and operational controls, not the Procedure Agent, Change Set schema, patch engine or Editor Tab.

**Online deployment note:** GitHub Pages remains a static frontend and cannot hold the shared provider key. Cloudflare Workers is a candidate because its Secrets feature stores sensitive values server-side and exposes them to Worker code without placing them in the browser bundle ([Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)). The current Workers Free documentation lists 100,000 requests/day, 10 ms CPU time and 50 external subrequests per invocation. This Gateway uses one upstream provider subrequest per model request; Access authentication is enforced at the edge. Network wait time is distinct from Worker CPU time. The limits and real provider latency still require a live deployment check ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)). No database is required merely to store one deployment-scoped provider secret.

**Local / intranet note:** A VS Code Desktop extension can run its editor integration in the local Extension Host, but that does not mean a shared provider secret should be packaged with the extension. If a Gateway runs on the same workstation, it is a separately installed local service reached through a configured loopback endpoint; browser access additionally requires a secure-origin, CORS and local-request/CSRF review. A loopback Gateway is suitable for a local model, a single-workstation deployment or a managed workstation with an explicitly accepted trust boundary. For an organization-wide shared provider credential, prefer one managed internal Gateway service rather than copying the same key to every employee workstation. A local service is not a way to hide a shared secret from the owner of that workstation.

### 8.3 Shared provider credential and Gateway access security

The product decision is **one shared provider API credential per deployment**, not one model API key per end user. Users do not need to configure their own provider keys in the normal product flow.

Keep two credential types distinct:

1. **Provider credential:** the shared key used by the Gateway to call the model service. It exists only in Gateway-side secret storage / environment configuration. It MUST NOT appear in GitHub Pages assets, Webview HTML/JavaScript/DOM, postMessage, VSIX packages, settings.json, workspace files, browser storage, prompts, diagnostics, telemetry or logs.
2. **Gateway access authorization:** the mechanism that decides who may consume the shared Gateway and under what limits. This is not a provider API key and does not require asking every user to supply a model-provider key. The restricted online pilot uses Cloudflare Access directly on the Worker; the general-public login / invitation / short-lived session model remains an implementation decision.

Before a public Gateway is enabled, it MUST have an access-control strategy, rate limiting, abuse protection and a usage ceiling. CORS is a browser-origin policy, not authentication; an origin allowlist alone does not protect a publicly reachable API from non-browser clients. A hidden URL or static token shipped in the client is not a security boundary.

The restricted Worker pilot uses native Cloudflare Access identity. It requires `ctx.access`, compares `ctx.access.aud` with the configured Access audience, then calls `ctx.access.getIdentity()` and uses the verified email as the per-user rate-limit key. Manual JWT/JWKS parsing is unnecessary for a direct Access-authenticated Worker invocation ([Workers Access integration](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)). `ctx.access` is not propagated through Service Bindings / RPC and is not passed through a Static Assets router, so the Gateway is a script-only Worker without Static Assets. Cloudflare's Rate Limiting API is approximate and per-location, not a strict global budget ([Rate Limiting API](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)).

**Cloudflare Access / CORS:** Access blocks cross-origin `OPTIONS` preflight by default because browsers do not send cookies on preflight. Configure the Access application to **Bypass OPTIONS requests to origin**; the Worker answers preflight using its exact `ALLOWED_ORIGINS` allowlist, while actual POST remains Access-protected. Do not also configure Access-managed CORS response headers. The browser must use `credentials: include`. GitHub Pages (`github.io`) to `workers.dev` is cross-site, so third-party-cookie restrictions may block the `CF_Authorization` cookie; this remains a real-browser acceptance gate. If unreliable, use a same-site custom domain or design a separate application session flow before general release. See [Access CORS guidance](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/cors/).

The Worker caps request bytes and output tokens, but it does not maintain a strict global daily token budget. Provider-side account / project spending controls remain required; a Cloudflare spending limit controls Cloudflare charges, not the model provider's bill. The no-database pilot explicitly defers a durable global application spend ledger.

Host secure storage may hold short-lived Gateway session material where a host provides an appropriate implementation; security behavior must be verified separately for Desktop and browser hosts. It is not a place to distribute a deployment-wide shared provider key to every installed copy of the extension. Do not add a per-user provider-key setup flow to P1.

### 8.4 Optional VS Code / Theia model APIs

The VS Code Language Model API can be evaluated as an optional native model source, but P1 must not depend on it: model access requires user consent, availability is dynamic, selectChatModels() may return an empty array and quota failures must be handled. The current Theia 1.76 plugin implementation also stubs this API. See [VS Code Language Model API](https://code.visualstudio.com/api/extension-guides/ai/language-model).

Theia AI's OpenAI provider may be used by a Theia-specific adapter only if its backend dependency is compatible with the chosen host. The current @theia/ai-openai 1.76 frontend manager obtains its manager over a remote connection to a Node backend, while the production Pages host is Browser-Only. Merely adding the package to the browser build is not proof of a working provider path.

No host-specific AI API may change the canonical IModelClient, ModelProposal, Change Set or patch semantics.

## 9. Change Set contract

### 9.1 Ownership

The semantic proposal is a Studio-owned, versioned editing protocol. It is not CA-SL syntax, not a Runtime artifact and not a file in the Skill Package. It is the canonical Change Set model across Theia, VS Code Desktop/Web and self-hosted deployments.

The model returns a constrained ModelProposal. The Host Adapter validates it and stamps the authoritative Change Set metadata:

~~~json
{
  "schema": "ca-studio.ai-change-set/v1",
  "taskId": "session-local-id",
  "revision": 2,
  "base": {
    "documentUri": "workspace-relative-procedure-uri",
    "documentVersion": 17,
    "sourceDigest": "sha256:...",
    "packageGeneration": 8,
    "languageTarget": "connectionagent.io/v1alpha5"
  },
  "scope": {
    "writePaths": ["assurance/procedure.yaml"],
    "readPaths": [
      "assurance/contract.yaml",
      "assurance/predicates.yaml"
    ]
  },
  "operations": [],
  "groups": [],
  "assumptions": [],
  "blockers": [],
  "validation": {
    "state": "NOT_RUN",
    "diagnostics": []
  }
}
~~~

base, scope, operation IDs, groups, source spans, candidate Source and validation state are Host-owned. The model cannot author or override them. The Host materializes the validated proposal into the Studio Change Set model. A host may optionally adapt that model to a native Theia / VS Code ChangeSet UI contract, but such an adapter is presentation / lifecycle integration only; it does not own the semantic proposal or patch authority.

The Change Set is review data, not a write instruction. Its apply path always delegates to the Host's v1alpha5 Semantic Patch Engine and native WorkspaceEdit; it never writes the Procedure directly to disk.

### 9.2 Model output restrictions

The model may return:

- A concise plan.
- Typed semantic operations from the allowlist.
- Rationale for each operation.
- References to items in the supplied context manifest.
- Explicit assumptions and blockers.

The initial Studio-private envelope is `ca-studio.ai-model-proposal/v1`:

~~~json
{
  "schema": "ca-studio.ai-model-proposal/v1",
  "summary": "...",
  "plan": ["..."],
  "operations": [
    {
      "type": "stage.route.set",
      "target": { "nodeId": "create-session", "stage": "operation", "outcome": "COMMITTED" },
      "payload": { "targetNodeId": "verify-session" },
      "rationale": "...",
      "references": ["procedure-current", "contract-goal"]
    }
  ],
  "assumptions": [],
  "blockers": []
}
~~~

The model does not author operation IDs, atomic groups, base revision, write scope, source spans, candidate Source or validation state. `target` contains semantic identifiers only; `references` must resolve to IDs in the exact Context Pack manifest supplied to the model. `payload` is bounded JSON and the generic validator rejects source text, paths, offsets, WorkspaceEdit and host-owned fields. Each operation's payload still requires operation-specific validation by the v1alpha5 Patch Engine before it can enter an applicable Change Set. This private envelope is an initial implementation contract, not a CA-SL normative syntax or a frozen public API.

The model MUST NOT return trusted source offsets, arbitrary file paths, raw replacement Source, a complete candidate YAML file, a direct WorkspaceEdit or instructions to execute Tools / Runtime actions.

### 9.3 Initial semantic operation allowlist

The exact implementation schema is finalized during the patch-engine spike, but P1 is limited to these operation families:

| Operation | Allowed intent |
|---|---|
| `node.add` | Add a uniquely named Node with at least one business stage; an optional Node-entry `wait` may be included in its definition |
| `node.stage.add` | Add one missing business stage to an existing Node |
| `node.wait.set` | Add or replace one complete Node-entry Wait declaration |
| `node.wait.event.set` | Change the exact `wait.event` selector triple |
| `node.wait.timeout.set` | Set the fixed-duration `wait.timeout` string |
| `node.wait.timeout-route.set` | Set the sole `wait.routes.TIMEOUT` target |
| `node.wait.response.set` | Set the optional `wait.response.after` Node boundary |
| `stage.callable.set` | Set the `tool` or `script` callable field of one Operation / Observation stage |
| `stage.argument.set` | Set or update one named argument within an Operation / Observation stage |
| `predicate.call.add` | Add one call to an already declared Predicate in a Precondition / Postcondition |
| `predicate.call.arguments.set` | Replace the positional arguments of one identified Predicate call |
| `stage.route.set` | Add or retarget one outcome route within one business stage |
| `procedure.start.set` | Change the top-level start Node to an existing Node |

P1 does not allow deleting Nodes, Stages, Predicate calls, arguments or Routes; replacing an existing Stage wholesale; renaming Nodes; modifying Contract / PredicateSet definitions; or changing dependencies. A Stage can only be added when absent; existing stage fields are changed through their specific allowlisted operations. Those destructive operations require separate reference-closure and source-preservation design.

The allowlist uses v1alpha5's `start`, `nodes`, optional Node-level `wait`, and the four existing business stages `precondition`, `operation`, `observation` and `postcondition`. Wait is Node-entry control, not a fifth stage; a Wait-bearing Node still requires at least one business stage. `wait.event` must match exactly one trusted Ingress Operation in the pinned dependency snapshot; AI cannot invent or edit IngressCatalog / Owner / correlation contracts. `wait.routes` contains exactly `TIMEOUT` (never `EVENT_RECEIVED` or `SUCCEEDED`), and `wait.output` is typed normalized input available only on event-accepted paths, never timeout/bypass paths. Legacy `procedures`, `call`, `with`, `verify`, `reconcile`, `target`, `on`, plural stage keys or inferred conversions are rejected.

### 9.4 Reference and trust rules

- A Predicate reference must resolve to the current Package's declared PredicateSet.
- A Tool / Observation callable must resolve to an actually available, versioned contract before it can be described as verified.
- A Capability grant must be read from the authoritative Contract / trusted dependency snapshot; it cannot be inferred from the Tool name.
- Missing or unverified Owner, Schema, callable or Capability information is a blocker or an explicitly unresolved status, never a fabricated contract.
- Evidence references must resolve to supplied context or a separately verified source. Model-authored citations are not accepted as proof without resolution.

## 10. Host-side v1alpha5 Semantic Patch Engine

The Patch Engine is the only component allowed to turn semantic operations into Source edits.

For v1alpha5 Wait operations it MUST enforce Appendix L.1 / L.1.1 exactly: exact event triple, fixed-duration timeout, optional response.after and exactly one TIMEOUT route. `SUCCEEDED` and `EVENT_RECEIVED` are forbidden; a Wait-bearing Node still requires one of the four business stages. The Patch Engine does not resolve trusted Ingress exports or prove correlation, Wait CFG, path-sensitive wait.output availability or response mapping; these remain Compiler / trusted Integration checks.

For every operation it must:

1. Verify the target document is the selected v1alpha5 Preview Procedure.
2. Parse the current live Source with the pinned YAML 1.2 parser and v1alpha5 source projection, including Appendix L Wait structure.
3. Resolve Node / Stage / Predicate / Route targets from the parsed source; never trust model-provided offsets.
4. Check the operation allowlist, current structure, uniqueness, reserved IDs, references and graph invariants.
5. Resolve the smallest safe CST/source span and produce a candidate Source plus a real Diff.
6. Reparse the candidate and run the v1alpha5 source projection.
7. Reject the operation if it would rewrite unrelated source, erase comments or unknown fields, or relies on ambiguous anchors, aliases, quoted structures or spans.
8. Return an explicit unsupported / Source-only result when a safe patch cannot be proven.

The Patch Engine MUST preserve comments, quoting, key order, line endings, unknown fields and all unrelated bytes. It MUST NOT serialize the entire YAML document to create a candidate.

The model does not call this engine directly. The Host Adapter invokes it, validates its result and applies the accepted edits through the native editor API.

## 11. Atomic groups and partial acceptance

Operations are grouped by semantic dependency, not merely by the model's preferred grouping.

Examples:

- Adding a Node and adding the Route that makes it reachable form one atomic group.
- Changing a Route target and adding the required target Node form one atomic group.
- Independent argument edits on unrelated Nodes may be separate groups.
- A group is not partially applicable if one operation depends on another operation in that group.

The host computes or verifies these dependencies. The model may suggest grouping but cannot force unsafe partial acceptance.

The user may accept all safe groups, accept selected independent groups or reject the proposal. Applying a selected set uses one native WorkspaceEdit transaction per accepted atomic group. If a group cannot be safely separated, the UI exposes it as one indivisible unit.

## 12. Revision, conflict and lifecycle

### 12.1 Base revision

The host captures at least:

- Procedure URI.
- Native TextDocument version.
- Exact source digest.
- Package generation / snapshot identity.
- CA-SL language target and pinned source-contract revision.

The live unsaved buffer is authoritative. Persisted bytes must not replace it.

### 12.2 Stale proposal

If the Procedure buffer or a read-only context item changes while a request is running or awaiting review:

- Mark the affected proposal stale.
- Disable Apply.
- Explain which source changed.
- Require a new context snapshot and proposal revision.

P1 does not attempt automatic rebase or patch relocation.

### 12.3 Session lifecycle

`Draft → Analyzing → Plan Ready → Changes Ready → Validating → Review Required → Applied → Saved`

Additional states: `Blocked`, `Stale`, `Rejected`, `Cancelled`, `Provider Error`, `Validation Failed`.

- `Applied` means accepted edits reached the native TextDocument buffer.
- `Saved` follows the native editor's actual save state.
- `Validation Passed` means the actual Compiler Check returned that result for the identified candidate snapshot; it does not mean Runtime or Owner qualification.
- Revision history is session-local in P1. Closing a tab with unapplied proposals warns that the proposal session will be discarded. No source or prompt history is silently persisted.

## 13. Compiler validation

Compiler Check runs against an in-memory Package overlay where `assurance/procedure.yaml` is replaced by the host-generated candidate Source. The original workspace and open TextDocument remain unchanged until the user accepts the Change Set.

The candidate request must use the exact v1alpha5 Compiler API / candidate revision, once its complete static pipeline is available. The v1alpha4-only Compiler v1.0.0 is forbidden for this target. It must not manufacture `resolvedDependencies`, trusted Owner bindings, IngressCatalog exports, CapabilityContracts or Evidence guarantees.

Compiler diagnostics are displayed without rewriting their codes or severities. A failed or incomplete Check remains visible; the UI must not display a green qualification badge based only on AI review or LSP projection.

After Apply, the native document change triggers the existing Source / Visual / Problems lifecycle. A follow-up Check may run against the now-current buffer, but no auto-save or Build is triggered.

## 14. Failure handling

| Condition | Required behavior |
|---|---|
| No active Procedure | Offer a Procedure picker |
| Legacy / unsupported language target | Explain unsupported target; do not convert |
| Provider not configured | Show setup requirement; no transmission |
| User declines context disclosure | Keep task local and do not send |
| Provider timeout / cancellation | Preserve current buffer; mark task error/cancelled |
| Invalid model JSON / unknown operation | Reject proposal; preserve diagnostics for the task, not as Skill source |
| Missing Predicate / Tool / Capability | Block affected operation or mark unresolved; never invent |
| Unsafe / ambiguous Source span | Refuse patch and direct user to native Source editing |
| Source changes during generation/review | Mark stale; require regeneration |
| Compiler Check fails | Show exact diagnostics; user may retain a draft, but no qualification claim |
| WorkspaceEdit rejected | Keep source unchanged and report failure |
| Tab closes before Apply | Discard session proposal after warning; source remains unchanged |


## 15. P1 implementation sequence

| Slice | Deliverable | Gate |
|---|---|---|
| A. Cross-host contracts | Platform-neutral Authoring Core types, AuthoringHost, IModelClient, Gateway protocol and versioned ModelProposal / Change Set envelope | Core contract tests; no mandatory VS Code, Theia, DOM or Node imports |
| B. Online Gateway spike | Deploy a minimal OpenAI-compatible Gateway; Cloudflare Worker Free is the first candidate; prove server-side secret injection, streaming / cancellation, CORS, access authorization, rate limits and usage ceiling | Real GitHub Pages → Gateway → model request; no provider secret in browser assets; confirm Free-tier limits and provider latency |
| C. Theia Browser adapter | Bridge the current standalone Editor Tab / Extension Host to the shared core and Gateway | Real Browser-Only and backend-backed Theia Chromium; no Theia AI or vscode.lm dependency |
| D. Proposal / Change Set contract | Strict ModelProposal schema, Host-owned envelope, Studio Change Set lifecycle, operation allowlist and atomic-group validation | Positive / negative schema, malformed / forged / out-of-scope operation tests |
| E. v1alpha5 Patch Engine | Source-preserving patch operations for the initial allowlist | Round-trip, comment / unknown-field preservation, stale revision and malformed YAML tests |
| F. Authoring Workbench | Context, Plan, Flow Changes, YAML Diff, Validation and Change Set UI | Real Chromium layout, keyboard/focus, no third editor group |
| G. Compiler / Apply | In-memory candidate Check and native WorkspaceEdit apply | Compiler result identity, Source/Visual refresh, dirty state and native Undo/Redo |
| H. VS Code Desktop / Web adapter | Package the shared core for VS Code; use the local Extension Host for editor APIs and the same configured Gateway for model access | Desktop and Web Extension acceptance; verify actual host placement and no bundled provider secret |
| I. Intranet Gateway profile | Deploy the same Gateway contract to a self-hosted internal service / managed workstation | Browser and Desktop clients can use the internal endpoint; secret remains server-side; Cloudflare is not required |
| J. Regression acceptance | Full host and editor regression | npm test, npm run test:plugin-managed, npm run typecheck, git diff --check; Theia Browser-Only / backend Chromium for P1, Desktop / Web and intranet gates in their respective phases |

A fixture provider may be used for deterministic UI / Patch Engine tests. It must be clearly identified as a test fixture and cannot be reported as a working AI integration.

**Current Slice A status:** the host-neutral Context Pack builder, Access-credentialed Gateway client, Procedure proposal orchestrator and ModelProposal validator are implemented in [PR #203](https://github.com/odango-chan/ca-skill-studio-demo/pull/203), now aligned to v1alpha5 Preview. The Host-owned Change Set envelope is implemented in [PR #204](https://github.com/odango-chan/ca-skill-studio-demo/pull/204), also aligned to v1alpha5. Their exact-head CI must be rerun after the v1alpha5 changes; older v1alpha4-targeted run results are not acceptance evidence for the current heads. The first v1alpha5 source patcher and atomic Wait groups are implemented in [PR #207](https://github.com/odango-chan/ca-skill-studio-demo/pull/207); exact-head CI is in progress after fixing two first-run test failures. Live TextDocument collection, Editor Tab, Theia Host Adapter, native WorkspaceEdit and full v1alpha5 Compiler Check remain NOT_STARTED.

**Current Slice B status:** the restricted Cloudflare Access Worker, per-identity Rate Limiting binding, deployment-selected model, request / output limits, JSON + SSE response modes, cancellation and deterministic tests are implemented in [PR #206](https://github.com/odango-chan/ca-skill-studio-demo/pull/206). The Worker implementation commit passed CI and Wrangler dry-run [run #44077321845](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/44077321845); the current stacked branch includes documentation alignment and requires exact-head recheck. Live Cloudflare deployment, Pages-origin Access login and provider request remain NOT_RUN.

The online path is implemented first, but every P1 boundary is designed so the later Desktop and intranet profiles reuse the same Authoring Core, Gateway protocol, proposal schema and patch engine.


## 16. P1 acceptance checklist

- [ ] Opens one independent AI Authoring Editor Tab and preserves the existing Source / Visual pair.
- [ ] Uses the live unsaved v1alpha5 Preview Procedure buffer and exact base revision.
- [ ] Shows and gates the exact Context Pack before external transmission.
- [ ] Does not expose provider credentials to the Webview, browser bundle, workspace or extension package.
- [ ] Uses the Studio-owned Authoring Core and Host Adapter boundary; domain logic has no mandatory Theia / VS Code imports.
- [ ] Uses the OpenAI-compatible Gateway for the first online path; shared provider credential is stored server-side.
- [ ] Gateway access authorization, rate limits and usage ceiling are enforced independently of CORS.
- [ ] The restricted pilot authenticates through Cloudflare Access; browser credentials and CORS are configured correctly; general-public identity / invitation policy is selected separately.
- [ ] Materializes only validated proposals into the Studio Change Set model; host-native ChangeSet APIs remain optional adapters.
- [ ] Accepts only the versioned ModelProposal schema and known operation allowlist.
- [ ] Rejects raw YAML replacement, arbitrary paths, forged spans, unknown operations and stale proposals.
- [ ] Uses a dedicated v1alpha5 patch layer; v1alpha4-only tooling is not used as a fallback.
- [ ] Preserves comments, formatting, quoting, unknown fields and unrelated Source bytes.
- [ ] Computes safe atomic groups and supports selective acceptance.
- [ ] Runs Compiler Check against an in-memory candidate Package snapshot.
- [ ] Applies through native WorkspaceEdit, updates existing Source / Visual / Problems views and supports native Undo/Redo.
- [ ] Does not auto-save, Build, execute Runtime or claim Owner / 5GC qualification.
- [ ] Passes positive and negative unit tests and real Theia Browser-Only / backend Chromium acceptance.

Desktop / Web Extension and intranet Gateway compatibility are explicit follow-up acceptance phases, not implied by the online P1 PASS.


## 17. Open decisions before live provider implementation

1. **Gateway access authorization:** the restricted pilot now uses native Worker `ctx.access` audience and verified-identity APIs. Validate the Pages-origin cookie flow and choose the general-public identity / invitation model separately before public launch; it must not require per-user model-provider keys or embed a shared static token in the client.
2. **Online Gateway deployment:** configure Access, the Rate Limiting namespace, production CORS origins and the server-side provider secret. Verify Workers Free limits, Access login / third-party-cookie behavior, JSON and SSE responses, timeout / cancellation, secret configuration and provider-side spending controls against actual model calls; retain a provider-neutral self-hosted implementation path.
3. **OpenAI-compatible subset:** confirm Chat Completions compatibility, streaming, cancellation and structured-output support for the selected model endpoint. Do not assume /v1/models or tool calling.
4. **VS Code host placement:** decide whether the Desktop package can use the Web Extension Host alone or needs a separate Node Extension Host adapter; explicitly test Desktop, Web, Remote and WSL/Container behavior.
5. **Native model APIs:** determine whether vscode.lm or Theia AI adapters provide meaningful optional value; neither is a required model path.
6. **Initial Context Pack byte budget:** the core starts at a 128 KiB serialized cap, leaving headroom under the Gateway's 256 KiB body limit. Validate actual prompt overhead and provider context limits during the live model spike; never silently truncate.
7. **Operation allowlist:** finalize exact v1alpha5 CST patch operations, including Node-entry Wait, and source-preservation limits during Slice E.

The product decisions in Section 1 and the cross-host architecture direction are approved. The detailed technical design remains Proposed until the v1alpha5 Compiler pipeline is complete, the Gateway is deployed and exercised, the shared-core / proposal contracts and v1alpha5 patch engine are reviewed, and the full Editor Tab → Patch → Compiler Check → native buffer apply workflow passes browser acceptance.

## Implementation ownership summary

- **CA-SL / ca-skills:** owns the v1alpha5 Preview language candidate and its publication decision; v1alpha4 remains frozen.
- **CA Skill Compiler:** owns authoritative Check / Build / linking diagnostics.
- **Skill Studio:** owns the Authoring UI, context disclosure, Studio semantic proposal / Change Set schema, v1alpha5 source patching and host-neutral candidate generation.
- **Host Adapters:** bridge the shared Authoring Core to Theia / VS Code editor APIs; they own live document access and native buffer application.
- **AI Gateway:** stores the deployment-scoped provider credential, authorizes and limits requests, and forwards OpenAI-compatible model calls; it does not own CA-SL semantics or Procedure patch authority.
- **Optional Theia AI / VS Code Language Model adapters:** may provide alternate model sources, but are not required for the canonical workflow.
- **Host / Runtime / Tool Owners:** remain outside P1; no invocation or execution is performed.
