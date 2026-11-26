# AI Procedure Authoring Workbench

**Current status: F1–F4 IMPLEMENTED / MERGED / DEPLOYED · Issue #200 CLOSED · Updated 2026-11-26 · Current main: `5b666c0ef754ed32fa37c97ce2429f328c70477f`**

This is a Studio editing feature, not a CA-SL language extension, Compiler feature, Host capability or Runtime feature. The current product state below supersedes the dated implementation-plan and candidate-status statements retained later in this document.

## Current implementation snapshot

- **F1 · Editor Tab:** merged PR #254. One AI Authoring Editor Tab with Context, Plan / Flow Changes / YAML Diff / Validation and Change Set review; no third editor group.
- **F2 · Source-backed graph comparison:** merged PR #258, main commit `7f2dff71e921b2f8528aa1195e750975715f5e36`. Current and candidate Procedure graphs are both projected through the same CA-SL v1alpha5 `analyzeCurrentSource` path and ELK / React Flow layout. Graphs are read-only; selection focuses a Change Set group and source locations, never accepts or applies it.
- **F3 · YAML Diff:** merged PR #259. Read-only Monaco DiffEditor in the existing AI Editor Tab; no new editor group.
- **F4 · Proposal history:** merged PR #260. Host-owned session-local proposal timeline and refinement; prior Apply permission is revoked when source / candidate identity changes.
- **Core / Apply boundary:** merged PR #207 provides the v1alpha5 semantic Patch Engine; merged PR #208 integrates the Editor Tab and Host orchestration. Model output remains an untrusted proposal. The Host creates the Change Set and exact source patch plan.
- **Compiler gate:** the integrated Studio Compiler remains **v2.0.2**. Apply requires an authoritative PASS for the exact candidate identity, including document URI/version, Package generation, source digest and candidate digest; Wait edits additionally require trusted Ingress binding. The synthetic native Editor Tab acceptance verifies Compiler Check → WorkspaceEdit → Undo on a controlled fixture. This does not qualify a real OpenAMSM Owner or 5GC Runtime.
- **Live model evidence:** the live-provider Authoring Core smoke and the deterministic synthetic Editor Tab Apply/Undo acceptance are separate gates. A live Gateway/model request or valid proposal envelope alone does not prove Compiler Check, native WorkspaceEdit or Runtime execution.
- **Gateway:** default route `http://127.0.0.1:8787/opencode-go/openai`, default model `deepseek-v4.1-flash`. Provider credentials stay on the Gateway host; an optional shared Gateway token is stored in host SecretStorage and is never sent to the Webview or embedded in the browser bundle.
- **Compiler v2.1.0:** Development Build / Verify is a separate API family and is not integrated into current Studio main; see [#269](https://github.com/odango-chan/ca-skill-studio-demo/issues/269). Do not claim v2.1.0 integration from a Draft PR or candidate branch.
- **Qualification:** AI Authoring UI / model / synthetic Apply acceptance does not establish Owner authorization, Host Admission, real 5GC E2E or Production Qualification. Those remain NOT_QUALIFIED.

Current acceptance and closure evidence: [Issue #200](https://github.com/odango-chan/ca-skill-studio-demo/issues/200) (closed), [PR #254](https://github.com/odango-chan/ca-skill-studio-demo/pull/254), [PR #258](https://github.com/odango-chan/ca-skill-studio-demo/pull/258), [PR #259](https://github.com/odango-chan/ca-skill-studio-demo/pull/259), [PR #260](https://github.com/odango-chan/ca-skill-studio-demo/pull/260), and the exact current source / test paths in `experiments/ide-host/vscode/src/ai-authoring-editor.mjs` and `ai-authoring-acceptance.mjs`.

## Historical design and implementation planning record

> The sections below preserve the original P1 design rationale, host adapter plans and acceptance history. Their dated status claims, old CustomEditor / v1alpha4 descriptions, Compiler v1.0.0 / PR #38 status and “Apply disabled” statements are historical and superseded by the current snapshot above. Do not use them as current implementation instructions without checking the exact current source and Issue #200 / #269.
 
## Skill Package Agent · 双宿主交付方案

线上 Theia Browser-Only 和桌面 VS Code 安装版使用同一 Studio 扩展、Agent 会话界面与 Host 工具。Agent 以当前 Package 为工作范围，能够围绕同一个任务读取获准的 Package 上下文、生成候选、根据检查结果修订，并在同一界面审阅变更。Console 继续使用现有原生编辑器。开发顺序如下。

1. 在共享 Webview 中加入任务入口与可取消的执行记录。第一阶段沿用显式披露确认和现有 Gateway JSON 协议，先从获准目录中选择相关文件，再按选中的文件内容生成候选，对完整 Compiler FAIL 中目标 Procedure 的错误代码最多自动修订一次。实际 Apply 继续走现有 Host 验证和 WorkspaceEdit。保留单次提案入口供独立测试和手动审阅。
2. 验证 Theia 1.76 的 Agent 框架在 Browser-Only 中的依赖与运行边界，并评估对已获授权 Package 上下文进行多轮内容搜索和动态读取。会话支持跟进与引导，输出继续进入同一个审阅和 Apply 链路。
3. 两个宿主分别在真实编辑器里验收相同任务。桌面版另用本机模型和 loopback Gateway 在禁用外网的环境中验收，模型和 Gateway 需要独立安装。联网时可另接 VS Code 的原生 Agent 工具入口。

双宿主验收需要覆盖同一份未保存的 Procedure、搜索和读取、首次候选失败后修订、准确的 Compiler 结果、显式 Apply、原生 Undo 与 Console 切换。宿主构建、模拟模型与实际断网模型分别记录。浏览器端使用公开演示环境和已配置的 Gateway，Agent 会话目前以宿主会话为单位。

### Theia 原生 AI Chat 入口

Theia 宿主通过原生右侧 AI Chat 注册 `@SkillStudio`。该入口将当前任务交给同一个 Studio Host，使用当前 Procedure 及默认允许的 Package 上下文。模型调用仍使用已配置的 Gateway，发送前由 Studio 显示披露确认。聊天中返回提案摘要和 Compiler 结果，可从 AI Workbench 打开同一个候选继续审阅。写入与 Undo 仍由原生编辑器处理。桌面扩展继续保有独立入口。

## 1. Approved product decisions

| Decision | P1 baseline |
|---|---|
| Main surface | A standalone Editor Tab named **AI Authoring** |
| Editing model | A Studio-owned, versioned semantic Change Set; host-native ChangeSet APIs are optional adapters, not the source of truth |
| Apply behavior | Apply accepted changes to the existing native TextDocument buffer; the user saves |
| First release | Modify an existing CA-SL v1alpha5 Procedure only; no v1alpha4 fallback |
| Architecture target | One cross-host Authoring core for Theia Browser, VS Code Desktop/Web/Remote and self-hosted intranet deployments |
| First implementation target | Theia Browser-Only / GitHub Pages calling the independent Go Gateway on the local workstation or a trusted internal server |
| Model credentials | One deployment-scoped shared provider credential, held by the Gateway; no per-user model API keys |
| Deployment portability | One cross-platform Go Gateway binary for loopback or trusted intranet deployment |

The main surface is not a permanent chat sidebar. Natural language is the task input and refinement mechanism; the primary output is a reviewable Change Set.

The Studio frontend may be hosted online, but the model Gateway runs locally or on a trusted internal server. Later host deployments consume the same Authoring contracts and do not require a second Procedure Agent, proposal format or patch engine.

The Go Gateway is deployed on loopback or inside a trusted network. A non-loopback listener uses one deployment-wide `X-Gateway-Token`; this is a shared network boundary, not user authentication. Provider credentials remain on the Gateway host. No user accounts, OAuth, per-user credentials or database are required.

## 2. Current implementation and Compiler boundary

The active implementation is the current Theia browser-only extension and its AI Authoring Editor Tab, not the earlier Procedure CustomEditor / standalone Visual Designer.

- CA-SL v1alpha5 is FROZEN / RELEASED at `odango-chan/ca-skills@0abfd0e1ab99f481a4ae01f3f47efc54783dd5e5`; IngressCatalog v1alpha1 is released at `odango-chan/ca-skills@9412be9894ef36acf846c757a5870dc0c48b33ac`.
- The active AI patch path is `authoring/core/v1alpha5-patch-engine.mjs`; model proposals are validated and materialized as Host-owned Change Sets. Source revisions, URI, document version, Package generation and source / candidate digests are bound to each candidate.
- The current AI editor uses the integrated **CA Skill Compiler v2.0.2** through `compiler-request.mjs`, `compiler-integration.mjs` and the worker client. The v1.0.0 / v1alpha4-only Compiler and PR #38 candidate status are historical and no longer describe the current product.
- The current editor is one Editor Tab with Context, Plan, Flow Changes, YAML Diff, Validation and Change Set review. The graph and Monaco Diff are read-only review surfaces. Applying accepted groups uses the native editor buffer / WorkspaceEdit and Undo; the user remains responsible for saving.
- The live model/Gateway request path, exact Compiler candidate Check, and native Apply/Undo are distinct gates. A successful model request or valid proposal does not imply Compiler PASS or a native edit. The accepted synthetic native Editor Tab gate verifies the exact Compiler v2.0.2 candidate before applying and undoing it.
- Wait edits remain fail-closed unless the exact trusted Ingress binding is present. No model-generated identity, Capability grant, Owner authorization or Runtime status is accepted as proof.
- The Gateway is the independent Go project `odango-chan/ai-gateway`; provider credentials are held by the Gateway host. The browser/Webview does not receive provider credentials. Loopback defaults and shared non-loopback Gateway token behavior are described above and in the current extension settings.
- CA-SL v1alpha5 authoring / Studio acceptance remains separate from Owner, Host, Runtime, Integration, real 5GC E2E and Production Qualification. None of the AI UI / model / synthetic Apply tests qualify those external domains.


> The following cross-host architecture and implementation plan preserves the original design rationale. Treat proposed host expansions and dated implementation milestones as historical planning, not as a statement that each host mode is currently qualified.

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

The core never reads or writes workspace files by itself. It receives snapshots and revision metadata through a Host Adapter and returns typed results. It does not own the provider credential or Gateway deployment.

### 3.2 Host Adapter contract

A small AuthoringHost interface isolates editor and deployment differences. It must provide only the capabilities needed by the core:

| Capability | Responsibility |
|---|---|
| readDocument | Read the live Procedure TextDocument and its version / URI |
| readContext | Read explicitly allowlisted Package files and identify unsaved buffers |
| applyWorkspaceEdit | Apply host-generated edits to the current buffer through native editor APIs |
| getCompiler | Run the pinned Compiler against an in-memory Package overlay |
| getSecureSessionStore | Read the optional deployment-wide Gateway network token from host secret storage where supported |
| openAuthoringTab | Open/focus the standalone AI Authoring Editor Tab |

Implement host adapters in stages:

1. **Theia Browser-Only** — first production adapter for GitHub Pages.
2. **VS Code Desktop / Web** — reuse the same browser-compatible core and Web Extension entry where possible; add a Node Extension Host adapter only for capabilities that genuinely require Node / local process access.
3. **VS Code Remote / WSL / Container** — explicitly choose whether the UI-side or workspace-side Extension Host owns the operation; the configured Gateway must be reachable from that host.
4. **Self-hosted intranet** — same host contract, pointing at an internal Gateway.

The VS Code Web Extension runtime is supported by VS Code on Desktop and Web, but it does not expose Node.js APIs. Do not confuse "extension runs locally in Desktop" with "it has unrestricted Node access" or with "the model provider key can be embedded in the extension package".

### 3.3 Model Client and Gateway boundary

The shared core depends on an `IModelClient`, not on Theia AI, VS Code AI APIs or a provider SDK. The first client uses OpenAI-compatible Chat Completions through the independent Go project [odango-chan/ai-gateway](https://github.com/odango-chan/ai-gateway).

The Gateway is a transparent Go HTTP reverse proxy. It owns only deployment transport concerns:

- Static upstream configuration and route labels.
- Server-side upstream headers / provider credentials, normally expanded from Gateway-host environment variables.
- Request-size and concurrency limits, dial / response-header timeouts, cancellation propagation and graceful shutdown.
- Transparent forwarding of request method, path, query, body, response status, headers and streaming response body (including SSE).

The Gateway does **not** implement a model API, select or rewrite model IDs, parse prompts, normalize model catalogs, translate protocols, parse CA-SL, validate Procedures or apply edits.

The Studio client owns the task prompt, Context Pack, Model ID, proposal schema and strict response validation. The client sends the configured Model ID in the OpenAI-compatible request body. The initial OpenCode Go profile uses `deepseek-v4.1-flash` by default; the Model ID remains an application setting and must be accepted by the configured upstream.

The Studio Gateway URL setting is a route prefix, not just the Gateway origin. It includes the upstream label and any provider-specific path prefix; the client appends `/v1/chat/completions`:

- OpenCode Go: `http://127.0.0.1:8787/opencode-go/openai`.
- Standard OpenAI-compatible local upstream: `http://127.0.0.1:8787/local-qwen`.

The Host generates one stable `X-Opencode-Session` value for the Editor Tab session. OpenCode Go requires this header; other upstreams may ignore it. The client does not send browser cookies. For a non-loopback Gateway, it may send the one deployment-wide `X-Gateway-Token` obtained from host secret storage; this token is not a user identity.

P1 uses non-streaming JSON Chat Completions for a complete proposal. The Gateway supports transparent SSE for future progress / streaming use, but an incomplete or interrupted response must never become a reviewable Change Set. Structured JSON response mode is requested only when supported by the selected upstream; the Host always validates the final content against the Studio-owned ModelProposal schema.

### 3.4 Optional native AI integrations

Native host AI APIs are optional adapters, not the canonical Agent runtime:

- **VS Code Language Model API (vscode.lm)** may be used as an optional model source in native VS Code when a model is available and the user has granted consent. Model selection may return no models, and availability / quotas depend on the user's VS Code / Copilot environment. It cannot be the required P1 path because the current Theia 1.76 VS Code plugin API stubs selectChatModels() and returns an empty list. See [VS Code Language Model API](https://code.visualstudio.com/api/extension-guides/ai/language-model).
- **Theia AI** may be reused behind a Theia-specific adapter if a supported host path is proven. It is not installed in the current application, and its backend-dependent provider path is not the Browser-Only production architecture.
- A future integration may expose the Gateway as a native VS Code model provider, but the standalone AI Authoring Editor Tab must work without opening Copilot Chat or depending on a Chat Participant.

This avoids building two generic chat products. Skill Studio implements only the domain-specific Authoring orchestration and typed Change Set workflow; its first model path is OpenAI-compatible Chat Completions through the independent Go Gateway.

### 3.5 Keep CA-SL and host Agent Skills separate

VS Code / Theia Agent Skills, prompt instructions and chat tools are host-specific AI integration mechanisms. They are not CA-SL Skill Packages, do not define Procedure semantics and are not Compiler inputs. They may provide optional prompt knowledge only; the pinned CA-SL v1alpha5 candidate and its matching Compiler implementation remain authoritative for this authoring path.

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

- If the active editor belongs to the current v1alpha5 authoring target, use that document.
- If no Procedure is active, offer a picker limited to the current workspace's `assurance/procedure.yaml` files.
- If the current build target is not explicitly v1alpha5, show an unsupported-target explanation. Do not fall back to v1alpha4 or attempt Legacy conversion.
- One live Authoring session is allowed per Procedure URI. Reopening the command focuses the existing tab rather than opening a duplicate session.


### 5.3 Tab implementation

Preferred host implementation: a standalone VS Code-compatible WebviewPanel opened as one Editor Tab in the active editor group.

- It MUST NOT open a third editor column.
- It MUST NOT disturb the existing native Source / Procedure Visual pair.
- It MUST NOT register a second custom editor for procedure.yaml.
- The Webview is presentation only. It has no direct provider-network access, no provider credentials and no workspace write authority.
- The Extension Host / Host Adapter owns context reads, Gateway requests, proposal validation, Change Set state, patch generation, Compiler calls and native WorkspaceEdit application.
- In Browser-Only hosts, the Extension Host is itself browser-constrained; it calls the local or internal Go Gateway and never receives the shared provider API key. Cross-origin use requires exact-origin CORS; browser cookies are not used.
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

**Model protocol: OpenAI-compatible Chat Completions.** The Authoring Core owns prompt construction, Model ID selection from trusted application configuration, Context Pack disclosure and ModelProposal validation. The Gateway does not choose a model or rewrite request payloads.

The reference Gateway is the independent Go project [odango-chan/ai-gateway](https://github.com/odango-chan/ai-gateway). It is a configuration-driven transparent reverse proxy. A client calls `/{upstream-label}/{upstream-path}`; the Gateway resolves the label from static configuration, joins the remaining path to the configured upstream base URL, injects configured server-side headers, and forwards the request and response unchanged.

The Studio application settings are:

- `connectionAgent.skillStudio.ai.gatewayUrl`: Gateway route prefix including the upstream label and any upstream path prefix. Example: `http://127.0.0.1:8787/opencode-go/openai`. The client appends `/v1/chat/completions`.
- `connectionAgent.skillStudio.ai.model`: Model ID included in the request body. The initial OpenCode Go default is `deepseek-v4.1-flash`; change it when the selected upstream uses a different model identifier.

The Host generates a stable `X-Opencode-Session` value per Editor Tab session. OpenCode Go requires this header. The Go Gateway forwards it unchanged and does not create or manage conversation sessions.

### 8.2 Deployment profiles

| Profile | Editor / Host | Gateway | Gateway access | Status |
|---|---|---|---|---|
| **Local workstation** | Theia Browser-Only or VS Code Desktop/Web | Go Gateway on the same workstation, loopback listener (default `127.0.0.1:8787`) | No Gateway token required | First supported deployment mode |
| **Trusted intranet** | Theia Browser or VS Code Desktop/Web | One Go Gateway process on an internal server | `server.allow_remote: true` plus one shared `X-Gateway-Token`; TLS at a trusted reverse proxy when required | Target shared deployment |
| **GitHub Pages browser host** | Theia Browser-Only | Local or internal Go Gateway | Exact-origin CORS is required; browser cookies are not used | Blocked on [ai-gateway Issue #4](https://github.com/odango-chan/ai-gateway/issues/4) and real-browser acceptance |
| **VS Code Desktop** | Same VS Code extension and shared Authoring Core; editor operations run in the local Extension Host | Local loopback or configured internal Gateway | Optional shared Gateway token from Host secret storage | Follow-up host acceptance |
| **VS Code Web / Remote / WSL / Container** | Browser or explicitly selected workspace-side Extension Host | Gateway must be reachable from the selected host | Same loopback / trusted-intranet rule | Follow-up host acceptance |

For non-loopback access, the Go Gateway requires both `server.allow_remote: true` and a non-empty `server.access_token_env`. Clients send the configured value in `X-Gateway-Token`; the Gateway removes it before forwarding. This is one shared network access secret, not a user identity or account system.

The Gateway does not enable CORS by default. Browser-hosted Studio must use an exact origin allowlist; wildcard origins and cookie credentials are not required. CORS is a browser-origin policy, not authentication. The implementation is tracked in [odango-chan/ai-gateway#4](https://github.com/odango-chan/ai-gateway/issues/4). Do not expose the Gateway directly to the public internet.

### 8.3 Shared provider credential and security boundary

The product decision is **one shared provider API credential per deployment**, not one model API key per end user.

- Provider credentials are configured only on the Gateway host, normally through environment variables referenced by the upstream YAML configuration. They MUST NOT appear in GitHub Pages assets, Webview HTML / JavaScript / DOM, postMessage, VSIX packages, Studio settings, workspace files, browser storage, prompts, diagnostics, telemetry or logs.
- Local loopback access does not require a Gateway access token.
- A non-loopback Gateway uses one deployment-wide `X-Gateway-Token`. This is a shared network boundary, not user authentication, user identity, per-user authorization or per-user usage attribution. Where the Host supports secret storage, Studio may keep this shared token there; it is never a provider API key.
- No user accounts, OAuth, roles, multi-tenancy, per-user model keys or database are part of this design.
- The Studio client uses `credentials: omit`; it does not depend on browser cookies or identity-provider sessions.
- CORS must be restricted to exact trusted Studio origins and must not be treated as authentication. Network exposure remains limited to loopback or a trusted internal network protected by firewall / reverse-proxy controls.

### 8.4 Optional VS Code / Theia model APIs

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

1. Verify the active build / authoring target is v1alpha5 and the target document is `assurance/procedure.yaml`.
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
| B. Go Gateway integration | Consume the independent Go Gateway; configure a loopback or trusted-intranet route, Model ID and server-side provider credential | Real Studio → Go Gateway → OpenAI-compatible model request; no provider secret in browser assets; verify CORS for browser-hosted Studio |
| C. Theia Browser adapter | Bridge the current standalone Editor Tab / Extension Host to the shared core and Gateway | Real Browser-Only and backend-backed Theia Chromium; no Theia AI or vscode.lm dependency |
| D. Proposal / Change Set contract | Strict ModelProposal schema, Host-owned envelope, Studio Change Set lifecycle, operation allowlist and atomic-group validation | Positive / negative schema, malformed / forged / out-of-scope operation tests |
| E. v1alpha5 Patch Engine | Source-preserving patch operations for the initial allowlist | Round-trip, comment / unknown-field preservation, stale revision and malformed YAML tests |
| F. Authoring Workbench | Context, Plan, Flow Changes, YAML Diff, Validation and Change Set UI | Real Chromium layout, keyboard/focus, no third editor group |
| G. Compiler / Apply | In-memory candidate Check and native WorkspaceEdit apply | Compiler result identity, Source/Visual refresh, dirty state and native Undo/Redo |
| H. VS Code Desktop / Web adapter | Package the shared core for VS Code; use the local Extension Host for editor APIs and the same configured Gateway for model access | Desktop and Web Extension acceptance; verify actual host placement and no bundled provider secret |
| I. Intranet Gateway profile | Deploy the independent Go Gateway on a trusted internal server or managed workstation | Browser and Desktop clients can use the internal endpoint; provider secret remains server-side |
| J. Regression acceptance | Full host and editor regression | npm test, npm run test:plugin-managed, npm run typecheck, git diff --check; Theia Browser-Only / backend Chromium for P1, Desktop / Web and intranet gates in their respective phases |

A fixture provider may be used for deterministic UI / Patch Engine tests. It must be clearly identified as a test fixture and cannot be reported as a working AI integration.

**Current Slice A status:** the host-neutral Context Pack builder, Go Gateway client, Procedure proposal orchestrator and ModelProposal validator are implemented in [PR #203](https://github.com/odango-chan/ca-skill-studio-demo/pull/203); the Host-owned Change Set envelope is implemented in [PR #204](https://github.com/odango-chan/ca-skill-studio-demo/pull/204); and the v1alpha5 source patcher / atomic Wait groups are implemented in [PR #207](https://github.com/odango-chan/ca-skill-studio-demo/pull/207). [PR #208](https://github.com/odango-chan/ca-skill-studio-demo/pull/208) adds the standalone Editor Tab, complete Package Context collection, host-owned proposal / Change Set / Patch orchestration, candidate preview and native WorkspaceEdit path. A backend-backed Theia Chromium smoke opens the actual Editor Tab and checks Package context, v1alpha5 labeling, preview-only Apply state, opt-in defaults and CSP. Apply remains disabled because Compiler PR #38 is still `CANDIDATE_PARTIAL`; a complete authoritative PASS for the exact candidate identity is required before any native edit is allowed. The current exact-head workflow status must be checked from the latest PR heads. Gateway CORS support and real-browser cross-origin acceptance, live Studio model request and full v1alpha5 Compiler Check remain NOT_RUN.

**Gateway dependency status:** the independent Go Gateway is implemented in [odango-chan/ai-gateway](https://github.com/odango-chan/ai-gateway). The former Studio-owned Worker prototype [PR #206](https://github.com/odango-chan/ca-skill-studio-demo/pull/206) is obsolete and must not merge. Browser CORS is tracked separately in [ai-gateway Issue #4](https://github.com/odango-chan/ai-gateway/issues/4); Studio-to-Gateway real-browser and real-model acceptance remain NOT_RUN.

The Studio frontend may remain online while the model Gateway runs locally or on a trusted internal server. Later Desktop and intranet profiles reuse the same Authoring Core, Gateway protocol, proposal schema and patch engine.


## 16. P1 acceptance checklist

- [ ] Opens one independent AI Authoring Editor Tab and preserves the existing Source / Visual pair.
- [ ] Uses the live unsaved v1alpha5 Procedure buffer and exact base revision.
- [ ] Shows and gates the exact Context Pack before external transmission.
- [ ] Does not expose provider credentials to the Webview, browser bundle, workspace or extension package.
- [ ] Uses the Studio-owned Authoring Core and Host Adapter boundary; domain logic has no mandatory Theia / VS Code imports.
- [ ] Uses OpenAI-compatible Chat Completions through the independent Go Gateway; Studio supplies the configured Model ID and the provider credential remains server-side.
- [ ] Loopback Gateway mode works without user authentication; non-loopback mode requires the one deployment-wide `X-Gateway-Token`; CORS remains an exact-origin browser policy, not authentication.
- [ ] Browser requests use no cookies; exact-origin CORS is configured for the trusted Studio origin; no user account or per-user model key is required.
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

1. **Gateway access:** local loopback mode requires no token. Non-loopback deployment uses one shared `X-Gateway-Token` stored in host secret storage where available; this is not user authentication. Confirm Theia Browser-Only secret-storage support and remote Gateway behavior.
2. **Browser transport:** complete exact-origin CORS and private-network preflight support in [ai-gateway Issue #4](https://github.com/odango-chan/ai-gateway/issues/4); then verify GitHub Pages / Theia Browser-Only to local or internal Gateway in real Chromium. No identity-provider or cookie flow is required.
3. **Model compatibility:** confirm the configured Model ID is accepted by the selected OpenAI-compatible upstream and verify JSON response format, timeout and cancellation behavior. Do not assume `/v1/models`, tool calling or identical provider capabilities.
4. **VS Code host placement:** decide whether the Desktop package can use the Web Extension Host alone or needs a separate Node Extension Host adapter; explicitly test Desktop, Web, Remote and WSL/Container behavior.
5. **Native model APIs:** determine whether vscode.lm or Theia AI adapters provide meaningful optional value; neither is a required model path.
6. **Initial Context Pack byte budget:** the core starts at a 128 KiB serialized cap, leaving headroom under the Gateway's 256 KiB body limit. Validate actual prompt overhead and provider context limits during the live model spike; never silently truncate.
7. **Operation allowlist:** finalize exact v1alpha5 CST patch operations, including Node-entry Wait, and source-preservation limits during Slice E.

The product decisions in Section 1 and the cross-host architecture direction are approved. The detailed technical design remains Proposed until the v1alpha5 Compiler pipeline is complete, the Gateway is deployed and exercised, the shared-core / proposal contracts and v1alpha5 patch engine are reviewed, and the full Editor Tab → Patch → Compiler Check → native buffer apply workflow passes browser acceptance.

## Implementation ownership summary

- **CA-SL / ca-skills:** owns the frozen and released v1alpha5 normative contract; v1alpha4 remains frozen.
- **CA Skill Compiler:** owns authoritative Check / Build / linking diagnostics.
- **Skill Studio:** owns the Authoring UI, context disclosure, Studio semantic proposal / Change Set schema, v1alpha5 source patching and host-neutral candidate generation.
- **Host Adapters:** bridge the shared Authoring Core to Theia / VS Code editor APIs; they own live document access and native buffer application.
- **AI Gateway:** the independent Go service stores deployment-scoped provider credentials, applies transport limits and optional shared network-token checks, and transparently forwards OpenAI-compatible HTTP requests / responses; it does not select models or own CA-SL semantics / Procedure patch authority.
- **Optional Theia AI / VS Code Language Model adapters:** may provide alternate model sources, but are not required for the canonical workflow.
- **Host / Runtime / Tool Owners:** remain outside P1; no invocation or execution is performed.
