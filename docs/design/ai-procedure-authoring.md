# AI Procedure Authoring Workbench

**Status: Proposed · Product decisions approved; detailed design awaiting review**  
**Implementation: NOT_STARTED · Acceptance: NOT_RUN · Date: 2026-11-17**  
**Tracking: [Issue #200](https://github.com/odango-chan/ca-skill-studio-demo/issues/200)**

This document defines the first AI-assisted authoring capability for Skill Studio. It is a Studio editing feature, not a CA-SL language extension, Compiler feature, Host capability or Runtime feature.

## 1. Approved product decisions

| Decision | P1 baseline |
|---|---|
| Main surface | A standalone Editor Tab named **AI Authoring** |
| Editing model | A Studio-private semantic Change Set, reusing Theia AI's generic ChangeSet lifecycle and custom ChangeSetElement contract |
| Apply behavior | Apply accepted changes to the existing native TextDocument buffer; the user saves |
| First release | Modify an existing CA-SL v1alpha4 Procedure only |

The main surface is not a permanent chat sidebar. Natural language is the task input and refinement mechanism; the primary output is a reviewable change proposal.

## 2. Current implementation baseline

The current Theia workbench already provides useful host infrastructure:

- A VS Code Web Extension hosted by Theia browser-only and backend-backed hosts.
- A Procedure CustomEditor implemented as a Webview, paired with the native Source editor.
- Native TextDocument versions, native WorkspaceEdit, editor dirty state and Undo/Redo.
- A Package snapshot collector that prefers open TextDocuments over persisted bytes.
- A pinned CA-SL v1alpha4 language source and source-derived Procedure projection.
- A Compiler v1.0.0 Go/WASM integration and Check / Build / Inspect entry points.
- **No Theia AI integration is currently installed.** The current Theia 1.76.0 application manifests do not include `@theia/ai-core`, `@theia/ai-chat`, `@theia/ai-openai` or the related AI packages. Existing LSP completion, diagnostics and semantic tokens are language tooling, not LLM-based AI.

There is an important version boundary: the current v1alpha4 Procedure Designer is a read-only projection. Existing D1/D2 typed patch modules and legacy Procedure operations are not automatically valid for v1alpha4. P1 MUST add and test a v1alpha4-specific semantic patch layer. It MUST NOT translate v1alpha4 into legacy syntax or reuse legacy patch operations without an explicit compatibility proof.

The current Compiler v1.0.0 also predates the later Node-entry Event Wait work. AI Authoring MUST NOT invent, lower or simulate that Wait behavior. The existing Compiler remains the authority for the language subset it actually supports.


## 3. Theia AI reuse strategy

P1 MUST reuse the existing Theia AI framework where it fits instead of implementing a second generic AI harness.

### 3.1 Reusable framework capabilities

The current Theia baseline is 1.76.0. The initial package candidates are:

| Package | P1 use |
|---|---|
| `@theia/ai-core` | Agent framework, LanguageModel registry, PromptService, prompt fragments, model requirements, cancellation and AI variables |
| `@theia/ai-openai` | OpenAI-compatible model provider; custom endpoint, model ID, optional API key and custom headers |
| `@theia/ai-chat` | Generic Chat / ChangeSet model contracts, including `ChangeSet` and `ChangeSetElement` |
| `@theia/ai-core-ui` | Optional AI provider / model configuration UI, subject to the host integration decision |
| `@theia/ai-chat-ui` | Optional reusable response renderers or default chat UI components; not the P1 primary surface |

Theia AI already provides agents that can be called from editors and custom widgets, prompt templates, variables, tool functions, streaming response handling, cancellation and custom response parts. P1 should implement one focused `ProcedureAuthoringAgent` and only the domain-specific context / proposal logic.

Theia AI also provides generic Change Sets and custom `ChangeSetElement` implementations. P1 should implement a `ProcedureChangeSetElement` rather than recreate the generic pending / applied / stale lifecycle. The element's `apply()` MUST delegate to the host's v1alpha4 Patch Engine and native `WorkspaceEdit`; it MUST NOT use the default file-based change implementation or write the Procedure directly to disk.

Theia's default Change Set UI is integrated into its generic Chat UI. Since the approved product surface is a standalone Editor Tab, P1 keeps its own Plan / Flow Changes / YAML Diff / Validation workbench and reuses the framework contracts and lifecycle. It does not switch the product to a Chat sidebar.

### 3.2 Keep CA-SL and Theia Agent Skills separate

Theia AI's Agent Skills are reusable prompt instructions / domain knowledge for agents. They are not CA-SL Skill Packages, do not define Procedure semantics, and are not Compiler inputs. They may be used for internal authoring instructions only; the CA-SL v1alpha4 contract and Compiler remain authoritative.

### 3.3 Do not use generic file-editing agents

P1 MUST NOT delegate Procedure editing to the generic Theia Coder agent or enable broad workspace file tools. The authoring agent is restricted to the explicit Context Pack and the typed Procedure proposal schema. It cannot write files, execute shell commands, invoke Runtime / Tools or alter any Package file.

### 3.4 Current host integration gap

The current product is implemented as a VS Code Web Extension hosted by Theia. Theia AI is a Theia-native extension framework; it is not automatically available inside the existing VS Code extension.

In Theia 1.76.0, the VS Code plugin API's `vscode.lm.selectChatModels()` is stubbed and returns an empty list, and `registerLanguageModelChatProvider()` is also stubbed. P1 MUST NOT assume that the existing extension can access Theia AI through the VS Code Language Model API.

Slice A must prove a supported integration path, preferably a small Theia-native extension service / command bridge to the existing Editor Tab. If this bridge is not stable, evaluate implementing the Editor Tab as a Theia-native editor-area widget while preserving the approved standalone-tab UX. Do not silently create a second independent model client as a workaround.

### 3.5 Browser-only provider constraint

The production Pages host is Theia Browser-Only and has no Theia backend. Theia's `@theia/ai-openai` 1.76.0 frontend module obtains its `OpenAiLanguageModelsManager` through a remote connection proxy, while the OpenAI model implementation and manager are in the Node backend module. Therefore the dependency being present in a browser-only package is not sufficient evidence that model discovery and requests work in the production host.

The provider spike MUST prove the exact 1.76.0 path in both:
- Theia Browser-Only / GitHub Pages, the production target.
- Theia backend-backed browser host, the acceptance target.

If the backend-dependent provider cannot run in Browser-Only, choose explicitly between:
1. A user-controlled OpenAI-compatible gateway reachable from the browser, with the required CORS and user authentication; or
2. A narrowly scoped frontend-only Theia LanguageModel provider that uses the same OpenAI-compatible protocol.

Do not embed a shared API key in the static build. The Theia AI documentation states that API keys entered through Preferences are stored in clear text. Do not store provider credentials in workspace-scoped settings or committed files. If a user supplies a personal key in a browser-only deployment, disclose the browser-storage risk and keep it out of Package content, Webview messages, prompts and logs.

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

- If the active editor belongs to a supported v1alpha4 Procedure, use that document.
- If no Procedure is active, offer a picker limited to the current workspace's `assurance/procedure.yaml` files.
- If the selected file is not v1alpha4, show an explicit unsupported-version explanation. Do not attempt Legacy conversion.
- One live Authoring session is allowed per Procedure URI. Reopening the command focuses the existing tab rather than opening a duplicate session.

### 5.3 Tab implementation

Preferred host implementation: a standalone VS Code-compatible `WebviewPanel` opened as one Editor Tab in the active editor group.

- It MUST NOT open a third editor column.
- It MUST NOT disturb the existing native Source / Procedure Visual pair.
- It MUST NOT register a second custom editor for `procedure.yaml`.
- The webview is presentation only. It has no direct provider/network access and cannot write workspace files.
- The extension host owns context reads, provider requests, Change Set validation, patch generation, Compiler calls and WorkspaceEdit application.

Theia 1.76 browser-only and backend-backed hosts must both prove the `WebviewPanel` lifecycle and tab placement. If the public API behaves differently in either host, resolve that in a focused host spike before choosing an alternative.

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
| Flow Changes | Compare the current and candidate v1alpha4 Procedure projections |
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

The initial context-size limit should be enforced by bytes before transmission. Oversized context is rejected with a list of large items; content must not be silently truncated.

### 7.3 Consent

Before the first request in a task, the user sees the provider destination and exact context manifest, then explicitly confirms sending it. Changing the provider or adding context requires a new review. The extension must not transmit Package content merely because the AI Authoring tab was opened.

## 8. OpenAI-compatible model integration and security gate

**Provider family decision: OpenAI-compatible API.** The model endpoint and model ID are configured per deployment; P1 does not assume a specific vendor.

First evaluate Theia 1.76.0's `@theia/ai-openai` provider. It already supports custom model endpoint URL, model ID, optional API key, custom HTTP headers, streaming and the provider's structured-output / tool-calling capabilities. Do not implement a second generic OpenAI client unless Slice A proves the built-in provider cannot serve the Browser-Only production host.

The provider integration must preserve these rules:

- The Webview is presentation-only and never calls the model endpoint directly.
- The Procedure Authoring Agent receives an explicit, user-approved Context Pack.
- The model endpoint, model ID and any custom headers are shown in provider configuration.
- Provider credentials never appear in Webview HTML, JavaScript, DOM, postMessage payloads, Package files, prompts, diagnostics, telemetry, logs or Change Set data.
- No shared API key is embedded in the public GitHub Pages bundle.
- Workspace-scoped provider credentials are forbidden. Theia documents that keys entered in Preferences are stored in clear text; any user-level browser key configuration must carry an explicit risk warning.
- The browser-only endpoint must allow the deployed origin through CORS, or traffic must go through an authenticated user-controlled gateway.
- Custom static headers supported by the provider may be used for gateway routing / attribution, but must not be treated as a secure secret store.

The exact Browser-Only / backend-host transport and credential behavior is a blocking technical spike, not an open provider-family decision. If `@theia/ai-openai` cannot run in Browser-Only because its model manager depends on a Node backend, choose a user-controlled OpenAI-compatible gateway or a narrowly scoped frontend-only Theia LanguageModel provider. Keep the same OpenAI-compatible request semantics and Theia AI Agent / ChangeSet layers.

## 9. Change Set contract

### 9.1 Ownership

The semantic proposal is a Studio-private, versioned editing protocol. It is not CA-SL syntax, not a Runtime artifact and not a file in the Skill Package. Once validated by the host, it is materialized as a Theia AI generic `ChangeSet` containing a custom `ProcedureChangeSetElement`.

The model returns a constrained `ModelProposal`. The extension host validates it and stamps the authoritative Change Set metadata:

The model returns a constrained `ModelProposal`. The extension host validates it and stamps the authoritative Change Set metadata:

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
    "languageTarget": "connectionagent.io/v1alpha4"
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

`base`, `scope`, operation IDs, groups, source spans, candidate Source and validation state are host-owned. The model cannot author or override them. The host then exposes the validated proposal through a custom Theia AI `ProcedureChangeSetElement`; the ChangeSet model is a review / lifecycle container, not the model's output schema.

### 9.2 Model output restrictions

The model may return:

- A concise plan.
- Typed semantic operations from the allowlist.
- Rationale for each operation.
- References to items in the supplied context manifest.
- Explicit assumptions and blockers.

The model MUST NOT return trusted source offsets, arbitrary file paths, raw replacement Source, a complete candidate YAML file, a direct WorkspaceEdit or instructions to execute Tools / Runtime actions.

### 9.3 Initial semantic operation allowlist

The exact implementation schema is finalized during the patch-engine spike, but P1 is limited to these operation families:

| Operation | Allowed intent |
|---|---|
| `node.add` | Add a uniquely named Node with one or more valid v1alpha4 stages |
| `node.stage.add` | Add one missing stage to an existing Node; an existing stage cannot be replaced |
| `stage.callable.set` | Set the `tool` or `script` callable field of one explicitly identified Operation / Observation stage |
| `stage.argument.set` | Set or update one named argument within an Operation / Observation stage |
| `predicate.call.add` | Add one call to an already declared Predicate in a Precondition / Postcondition |
| `predicate.call.arguments.set` | Replace the positional arguments of one identified Predicate call |
| `stage.route.set` | Add or retarget one outcome route within one identified stage |
| `procedure.start.set` | Change the top-level start Node to an existing Node |

P1 does not allow deleting Nodes, Stages, Predicate calls, arguments or Routes; replacing an existing Stage wholesale; renaming Nodes; modifying Contract / PredicateSet definitions; or changing dependencies. A Stage can only be added when absent; existing stage fields are changed through their specific allowlisted operations. Those destructive operations require separate reference-closure and source-preservation design.

The allowlist uses v1alpha4's `start`, `nodes`, `precondition`, `operation`, `observation` and `postcondition` source shape. Legacy `procedures`, `call`, `with`, `verify`, `reconcile`, `target`, `on`, plural stage keys or inferred conversions are rejected.

### 9.4 Reference and trust rules

- A Predicate reference must resolve to the current Package's declared PredicateSet.
- A Tool / Observation callable must resolve to an actually available, versioned contract before it can be described as verified.
- A Capability grant must be read from the authoritative Contract / trusted dependency snapshot; it cannot be inferred from the Tool name.
- Missing or unverified Owner, Schema, callable or Capability information is a blocker or an explicitly unresolved status, never a fabricated contract.
- Evidence references must resolve to supplied context or a separately verified source. Model-authored citations are not accepted as proof without resolution.

## 10. Host-side v1alpha4 Semantic Patch Engine

The Patch Engine is the only component allowed to turn semantic operations into Source edits.

For every operation it must:

1. Verify the target document is the selected v1alpha4 Procedure.
2. Parse the current live Source with the pinned YAML 1.2 parser and v1alpha4 source projection.
3. Resolve Node / Stage / Predicate / Route targets from the parsed source; never trust model-provided offsets.
4. Check the operation allowlist, current structure, uniqueness, reserved IDs, references and graph invariants.
5. Resolve the smallest safe CST/source span and produce a candidate Source plus a real Diff.
6. Reparse the candidate and run the v1alpha4 source projection.
7. Reject the operation if it would rewrite unrelated source, erase comments or unknown fields, or relies on ambiguous anchors, aliases, quoted structures or spans.
8. Return an explicit unsupported / Source-only result when a safe patch cannot be proven.

The Patch Engine MUST preserve comments, quoting, key order, line endings, unknown fields and all unrelated bytes. It MUST NOT serialize the entire YAML document to create a candidate.

The model does not call this engine directly. The extension host validates and applies its result.

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

The candidate request must use the same pinned Compiler v1.0.0 integration and exact Package source mapping as normal Check. It must not manufacture `resolvedDependencies`, trusted Owner bindings, CapabilityContracts or Evidence guarantees.

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
| A. Theia AI / host bridge spike | Add the minimum Theia AI packages; prove Agent / LanguageModel / ChangeSet integration, OpenAI-compatible endpoint, Browser-Only transport, credential path and bridge from the current Editor Tab | Production Browser-Only and backend Theia host proof; do not assume `vscode.lm` works; no secret in Webview |
| B. Proposal / Change Set contract | ModelProposal schema, host-owned envelope, custom `ProcedureChangeSetElement`, operation allowlist and atomic group validation | Positive / negative schema and forged-operation tests |
| C. v1alpha4 Patch Engine | Source-preserving patch operations for the initial allowlist | Round-trip, comment / unknown-field preservation, stale revision and malformed YAML tests |
| D. Authoring Workbench | Context, Plan, Flow Changes, YAML Diff, Validation and Change Set UI | Real Chromium layout, keyboard/focus, no third editor group |
| E. Procedure Authoring Agent | Theia AI Agent, prompt fragments, explicit Context Pack and structured proposal parsing | Cancellation, timeout, invalid response, disclosure and credential tests |
| F. Compiler / Apply | In-memory candidate Check and custom ChangeSetElement native WorkspaceEdit apply | Compiler result identity, Source/Visual refresh, dirty state and native Undo/Redo |
| G. Regression acceptance | Full host and editor regression | IDE Host, Browser-Only Theia Chromium, backend Theia Chromium, `npm test`, `npm run test:plugin-managed`, `npm run typecheck`, `git diff --check` |

A fixture provider may be used for deterministic UI / Patch Engine tests. It must be clearly identified as a test fixture and cannot be reported as a working AI integration.

## 16. P1 acceptance checklist

- [ ] Opens one independent AI Authoring Editor Tab and preserves the existing Source / Visual pair.
- [ ] Uses the live unsaved v1alpha4 Procedure buffer and exact base revision.
- [ ] Shows and gates the exact context pack before external transmission.
- [ ] Does not expose provider credentials to the Webview or workspace.
- [ ] Uses Theia AI Agent / OpenAI-compatible provider infrastructure where supported; does not duplicate generic model transport, streaming or cancellation.
- [ ] Materializes validated proposals as a custom Theia AI `ProcedureChangeSetElement`; applies only through native WorkspaceEdit.
- [ ] Accepts only the versioned ModelProposal schema and known operation allowlist.
- [ ] Rejects raw YAML replacement, arbitrary paths, forged spans, unknown operations and stale proposals.
- [ ] Uses a dedicated v1alpha4 patch layer; legacy syntax and patch semantics are not reused implicitly.
- [ ] Preserves comments, formatting, quoting, unknown fields and unrelated Source bytes.
- [ ] Computes safe atomic groups and supports selective acceptance.
- [ ] Runs Compiler Check against an in-memory candidate Package snapshot.
- [ ] Applies through native WorkspaceEdit, updates existing Source / Visual / Problems views and supports native Undo/Redo.
- [ ] Does not auto-save, Build, execute Runtime or claim Owner / 5GC qualification.
- [ ] Passes positive and negative unit tests and real Theia Browser-Only / backend Chromium acceptance.

## 17. Open decisions before live provider implementation

1. **Endpoint configuration:** confirm the OpenAI-compatible base URL, model ID, whether `GET /v1/models` is supported, and any required custom headers.
2. **Browser-only transport / credentials:** prove the provider path and choose direct user-owned endpoint versus authenticated gateway; do not embed shared credentials.
3. **Host bridge:** prove the Theia-native AI service can be invoked from the standalone Editor Tab without relying on the stubbed VS Code `vscode.lm` API.
4. **Initial context budget:** finalize a byte budget during the provider spike; never silently truncate.
5. **Operation allowlist:** finalize exact v1alpha4 CST patch operations and source-preservation limits during Slice C.

The product decisions in Section 1 are approved. This detailed technical design remains Proposed until the provider gate and v1alpha4 patch-engine spike are reviewed.

---

## Implementation ownership summary

- **CA-SL / ca-skills:** owns normative v1alpha4 language semantics.
- **CA Skill Compiler:** owns authoritative Check / Build / linking diagnostics.
- **Skill Studio:** owns the Authoring UI, context disclosure, private semantic proposal schema, custom Procedure ChangeSetElement, v1alpha4 source patching and native buffer application.
- **Theia AI:** supplies the reusable Agent / Prompt / LanguageModel / generic ChangeSet infrastructure; it does not own CA-SL semantics or Procedure patch authority.
- **AI Provider / Gateway:** generates proposals only; it has no authority to write files or declare a Skill valid.
- **Host / Runtime / Tool Owners:** remain outside P1; no invocation or execution is performed.
