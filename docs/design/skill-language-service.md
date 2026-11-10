# Skill Language Service · Shared Core and LSP

**Status: Accepted for L0 architecture / inventory only · 2026-11-10**  
**Implementation: NOT_STARTED · LSP host compatibility: NOT_RUN**  
**Tracking:** [Issue #100](https://github.com/odango-chan/ca-skill-studio-demo/issues/100)

This document is the canonical design for consolidating Skill Studio's editor-time language analysis and exposing it through Language Server Protocol (LSP). It does not define the Skill DSL, Runtime semantics, Tool eligibility, or qualification rules.

## 1. Decision

Build a **TypeScript Skill Language Core** and expose it through a standards-based LSP.

- Reuse the existing `yaml@2.9.1` YAML 1.2 AST/CST parser and source ranges. Do not write a YAML parser.
- Gradually migrate/encapsulate existing JavaScript analysis functions; do not rewrite them wholesale and do not change their accepted syntax in the extraction step.
- Keep the core independent of VS Code, Theia, Monaco, browser DOM, Node filesystem, and process APIs.
- Use the official `vscode-languageserver` / `vscode-languageclient` browser and Node entry points for protocol transport, subject to a real Theia 1.76 browser-only compatibility gate.
- The existing Theia/VS Code extension is the host adapter. Do not build another IDE shell or another editor.
- Keep Classic Monaco as a compatibility consumer during migration. Its direct integration with LSP is a later adapter decision, not a prerequisite for the Theia/VS Code vertical slice.

This is a **language-service refactor, not a compiler rewrite**. The first deliverable is a shared read-only analysis model. Execution, compilation, Runtime validation, Skill qualification, and 5GC operations remain outside Studio.

## 2. Why this is needed

Current language-related behavior is spread across independent modules. The modules have useful, tested behavior, but there is no shared document/symbol/diagnostic contract for the native Theia/VS Code editor.

| Current module | Verified responsibility on `main@14afad2` | L0 treatment |
|---|---|---|
| `site/workspace.mjs` | YAML 1.2 AST/CST; multi-Procedure read-only projection; PRE/POST Steps and distinct Route origins; source spans; used by Classic app and Theia Inspector | Primary Procedure parser/projection adapter to characterize and wrap first |
| `site/package-audit.mjs` | Conservative Package-level editor warnings; parses Contract, PredicateSet and Procedure; checks selected exact references plus one explicitly heuristic binding warning | Extract diagnostics as stable, provenance-bearing records; retain existing positive/negative behavior |
| `site/script-navigation.mjs` | Parses current Package YAML to find exact Procedure script callers, Predicate evaluator callers and unique declared Schema references | Move exact references into the shared symbol/reference index; preserve ambiguity rejection |
| `site/python-outline.mjs` | Bounded lexical index of unique top-level Python `class` / `def` / `async def` declarations | Keep explicitly labelled lexical-only until a real Python parser/language server is selected |
| `site/semantic.mjs` | Narrower, earlier Procedure projection with different supported shape and limits | Legacy path: audit actual consumers and tests before deprecating; do not silently merge its syntax into the current profile |
| `site/graph.mjs` | Re-exports `projectProcedure` from `semantic.mjs` and provides a basic layout function | Trace consumers; keep compatibility until proven unused or migrated |
| `site/monaco-language.mjs` | Maps file paths to syntax grammar IDs only | Not a semantic service; may remain a small editor helper |
| `site/yaml-schema-policy.mjs` + `site/yaml-owner-schemas.mjs` | Applies pinned Owner Contract / PredicateSet schemas; Procedure is deliberately syntax-only | Reuse policy and pin; never widen Schema applicability without Owner compatibility evidence |
| `experiments/ide-host/vscode/src/inspection.mjs` | Maps `projectWorkspace` results into read-only Inspection / Outline / Evidence rows | Later become a thin host/UI projection over shared analysis |
| `experiments/ide-host/vscode/src/workbench.mjs` | Host-side document lifecycle, Package file enumeration, audit scheduling and DiagnosticCollection | Later become a thin LSP client + host filesystem adapter; do not modify while PRs #96–#99 are open |
| Monaco E2 integration | Local `monaco-yaml` Worker and pinned Contract/Predicate schema completion/hover in Classic | Preserve as compatibility evidence; avoid two competing YAML diagnostic owners when LSP is integrated |

The old `semantic.mjs` path and current `workspace.mjs` path are not interchangeable parsers. L0 must determine which callers still require the legacy projection and whether it can be retired. Do not make the new core depend on both as equal semantic authorities.

## 3. Layer boundaries

```text
Theia browser / VS Code desktop / (later) Classic Monaco
                    |
            Host-specific LSP Client
       (document sync, Package file access,
        URI mapping, Worker/process lifecycle)
                    |
          LSP transport + protocol handlers
       browser Worker                 Node
                    |
          Shared Skill Language Core
     document snapshots / YAML AST-CST adapters
     Package model / symbols / references
     diagnostics / completion / hover data
                    |
     Existing owner-pinned schemas and Skill Source
```

### 3.1 Skill Language Core

The core is pure TypeScript and deterministic for a given input snapshot.

It may depend on:
- The existing pinned YAML parser (`yaml@2.9.1`).
- Small runtime-neutral data structures and URI/path utilities.
- Owner-pinned Schema artifacts already present in the repository, only where the current path policy allows them.

It must not depend on:
- `vscode`, `@theia/*`, Monaco, React, React Flow or browser UI.
- `fs`, `process`, child processes, network access, timers or host globals.
- Runtime, Tool registry, Capability discovery, Host Loader or 5GC adapters.

Initial logical modules:

| Module | Responsibility |
|---|---|
| `documents` | URI, normalized Package-relative path, language ID, text and host document version |
| `yaml` | YAML 1.2 parsing, CST/AST access, exact UTF-16 source ranges and parser diagnostics |
| `package-model` | Bounded snapshot of files belonging to one Package; explicit completeness state |
| `procedure` | Adapter over the currently supported multi-Procedure read-only projection |
| `symbols` | Stable symbol identity and exact declaration ranges |
| `references` | Exact, unique references; unresolved and ambiguous references remain explicit |
| `diagnostics` | Existing editor warnings with code, severity, URI/range, source and provenance |
| `completion` / `hover` | Suggestions and information derived only from supported syntax and trusted local declarations |

The initial API should look conceptually like:

```ts
interface SourceDocumentSnapshot {
  uri: string;
  packageRootUri: string;
  relativePath: string;
  languageId: string;
  version: number;
  text: string;
}

interface PackageSnapshot {
  rootUri: string;
  generation: number;
  documents: readonly SourceDocumentSnapshot[];
  completeness: "complete" | "partial" | "unavailable";
  reason?: string;
}

interface AnalysisResult {
  packageGeneration: number;
  documents: readonly DocumentAnalysis[];
  symbols: readonly SkillSymbol[];
  references: readonly SkillReference[];
  diagnostics: readonly SkillDiagnostic[];
}
```

This is a contract sketch, not an instruction to freeze or persist source. A snapshot is an ephemeral, internally consistent input to one analysis pass. The host's current open `TextDocument` and workspace files remain the only writable Source authority.

### 3.2 LSP Server

The protocol layer maps LSP requests/notifications to the shared core. It must not contain a second YAML/Skill parser.

First protocol capabilities:
- `textDocument/didOpen`, `didChange`, `didClose`.
- `textDocument/publishDiagnostics`.
- `textDocument/completion`.
- `textDocument/hover`.

Later, after exact symbol/reference ranges are available:
- `textDocument/documentSymbol`.
- `textDocument/definition`.
- `textDocument/references`.
- `textDocument/prepareRename` / `rename`, only after a safe edit-preview policy is agreed.
- `textDocument/codeAction`, only for source-preserving and unambiguous actions.

Server state is a disposable mirror of documents delivered by the host. It is not an editable workspace, persistence layer or source owner.

### 3.3 Host adapters

The host adapter owns:
- Document lifecycle and document versions.
- Mapping VS Code/Theia URIs to Package-relative paths.
- Reading bounded sibling files through `vscode.workspace.findFiles` and `vscode.workspace.fs` (never Node `fs` in the browser host).
- Sending Package snapshots to the language service.
- Starting, stopping and disposing the correct Worker or Node transport.
- Rejecting stale responses and translating LSP ranges to native editor UI.

The adapter must prefer unsaved open document text over the last saved file snapshot. Package discovery must never cross the current Skill Package root.

## 4. Browser and Node transport strategy

Use one shared LSP service implementation with separate transport entry points:

| Runtime | Server transport | Client transport | Status |
|---|---|---|---|
| Theia 1.76 browser-only on GitHub Pages | Web Worker using `vscode-languageserver/browser` | Browser language client / Web Worker | Required proof gate; NOT_RUN |
| VS Code Web | Web Worker | `vscode-languageclient/browser` | Supported by upstream API; not yet tested in this repository |
| VS Code desktop | Node transport using `vscode-languageserver/node`, or a browser extension host where the host actually selects it | Matching Node or browser client | Separate host proof gate; NOT_RUN |
| Classic Monaco | Direct shared-core adapter initially; optional LSP bridge later | Monaco Language Client only if needed | Deferred |

The VS Code Web Extension documentation describes browser LSP clients/servers and Worker `postMessage` transport: [Web Extensions](https://code.visualstudio.com/api/extension-guides/web-extensions). Theia 1.76 supports build-time bundled Web Worker extensions in browser-only applications, but its release notes explicitly warn that some Web extensions still have bundling compatibility issues: [Theia 1.76 notes](https://eclipsesource.com/blogs/2026/10/08/eclipse-theia-1-76-release-news-and-noteworthy/).

Therefore VS Code Web support is not sufficient evidence for Theia support. The exact current Theia Pages build must prove:
1. Worker asset is emitted and loaded from the same Pages origin/path prefix.
2. No Node builtin, child process, dynamic remote schema request or external network fetch is required.
3. The Worker starts, receives document lifecycle messages and returns diagnostics/completion/hover.
4. Open, edit, rapid successive edit, file switch, close and reopen do not show stale results or leak sessions.
5. Failure to start the Worker degrades to native Source editing with an explicit unavailable state; it does not break the editor or Procedure visual view.

Do not add a backend server merely to make LSP work. A future backend may be considered only if a capability cannot reasonably run in the browser and has an explicit product/security requirement.

## 5. Package snapshot and document consistency

The browser Worker cannot independently read Theia's virtual workspace. The host must supply the current Package files.

- Scope one analysis to one Package root and the current workspace folder.
- Reuse the existing conservative limits initially: at most 500 files and 4 MiB of text for Package Audit. If a Package is partial, over limit, missing required files or unreadable, mark the relevant analysis `unavailable`; never turn missing data into “no problems”.
- Open unsaved documents override saved file contents.
- Package snapshot generations and document versions are monotonically tracked by the host/session. If a response refers to an older document version or Package generation, discard it.
- Cancellation and disposal must prevent late diagnostics from an old file, old workspace or closed editor from reappearing.
- No global index across different Skill Packages.

LSP positions use UTF-16 line/character coordinates. Core source offsets must be translated through the same document text used for parsing; never derive a range from a display label or line-only guess. If an existing diagnostic has only a reliable line, keep it line-scoped or file-scoped; do not invent a token range.

## 6. Diagnostic and semantic authority policy

Every diagnostic must carry:
- Stable code and severity.
- Source URI and exact range when available.
- Rule/source provenance (YAML parser, pinned Owner Schema, local Package reference check, bounded lexical index).
- A confidence/qualification class distinguishing exact checks from heuristics.
- An explicit unavailable result when the required Package context is missing or incomplete.

Rules:
1. YAML syntax diagnostics use YAML 1.2 and the current parser.
2. Owner Schema diagnostics use only the pinned Schema and exact file applicability in `yaml-schema-policy.mjs`.
3. Contract and PredicateSet may use the currently pinned Owner Schemas. `assurance/procedure.yaml` remains syntax-only while the pinned Toolchain Procedure Schema does not model the current PRE/POST Phase structure.
4. Exact local references may be indexed when their source syntax and target identity are both unambiguous.
5. Heuristic findings (for example `INPUT_BINDING_SUSPECT`) remain visibly heuristic warnings; they cannot create Definition, Rename or automatic Code Action behavior.
6. Suggestions from a Package's declared capabilities/tools are editor navigation/completion hints only. They do not qualify or authorize a Tool.
7. The Language Service is not a Runtime Validator, compiler qualification, Skill admission mechanism, LLM Skill router, execution engine or 5GC authority.

## 7. Editing and Source authority

LSP analysis is read-only in L0/L1.

- No language service may write a Package file or serialize an AST back to YAML.
- Completion may insert only a precisely scoped text edit requested by the editor.
- Rename and Code Actions are deferred until they can preserve comments, quoting, `'on'` as a YAML 1.2 string key, PRE/POST Route origin and all unrelated bytes.
- LSP-originated WorkspaceEdits must not bypass the existing Source Patch revision/span checks and Diff/Confirm for visual-originated mutations.
- Existing host-native typing, save, dirty state and Undo/Redo remain owned by Theia/VS Code.
- The graph, Inspector and Problems are projections over the same source and shared analysis; they are not another editable model.

## 8. Migration sequence

| Stage | Deliverable | Explicit non-goals |
|---|---|---|
| **L0 — this design** | Current-code inventory, ownership, shared contracts, host/runtime decision and acceptance gates | No parser rewrite, package restructure, LSP dependency or UI change |
| **L1 — shared core extraction** | Strict TypeScript contracts and adapters around current YAML/Package/Python indexes; characterization tests preserve current results | No new DSL rules; no changes to supported Visual mutations |
| **L2 — browser LSP vertical slice** | Worker transport, document sync, YAML syntax + current Package diagnostics in native Theia Problems | No completion claims until real editor UI proves them |
| **L3 — completion / hover** | Pinned Contract/Predicate schema and exact local declaration suggestions, with source/provenance | No unsupported Procedure Schema; no inferred Tool ABI |
| **L4 — symbols / navigation** | Document symbols, Definition and References from exact unique symbol identities | No heuristic jumps |
| **L5 — safe editing** | Prepare Rename / Rename and selected Code Actions with explicit source-preserving edit policy | No silent broad rewrite or qualification |

The current Theia feature migration PRs #96–#99 continue independently. The LSP branch must not modify their in-flight shared files or claim their UI migration is complete. Integrate only after those PRs have merged or after a narrowly reviewed rebase that preserves both sets of changes.

## 9. L0 acceptance checklist

- [x] Main baseline and active Theia PR overlap inspected.
- [x] Existing parser, audit, script-navigation, Python-outline, Schema and host adapter inventory recorded.
- [x] TypeScript + existing YAML parser + official LSP transport direction selected.
- [x] Source authority, Package scope, version/stale-result and fail-closed contracts documented.
- [x] Theia browser Worker compatibility explicitly marked as a proof gate.
- [ ] Owner review of this design.
- [ ] Characterization test inventory linked from implementation PR.
- [ ] L1 extraction started in a separate implementation change.

No LSP implementation, TypeScript migration, browser Worker, CI, Pages, desktop GUI or Runtime acceptance is claimed by this design document.
