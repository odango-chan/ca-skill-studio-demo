# Skill Studio Ownership, Source Authority and Product Boundaries

**Status: Current implementation boundary · Updated 2026-11-26 · Audited baseline: `main@5b666c0ef754ed32fa37c97ce2429f328c70477f`**

This document defines what Skill Studio owns and what it must consume from authoritative repositories. Current dependency and Interface Package details are in [Dependency, Interface Package and Schema IntelliSense Architecture](dependency-and-interface-package.md). Current implementation / acceptance status is in [WORK](../WORK.md); source-to-test evidence is in [TRACEABILITY](../TRACEABILITY.md).

## 1. Studio ownership

`ca-skill-studio-demo` owns the VS Code-compatible authoring extension and its Theia online host integration:

- native Source Editor, fixed right-side Preview Host, Outline / Problems / Package Explorer composition;
- Source projection, bounded Source Patch, Diff / confirmation / native Undo / Redo and stale-revision protection;
- CA-SL v1alpha5 Language Service integration, semantic tokens, completion and source navigation;
- Package inventory, project configuration, dependency acquisition, immutable snapshots, Studio lock and read-only Interface Package browsing;
- Compiler adapter UI / worker integration, AI Authoring review UI and this repository's tests / acceptance workflows.

The online Pages product is Theia 1.76 browser-only. Classic standalone browser app, Classic fallback and `/classic/` artifact are retired. The fixed workbench is one native Source Editor group plus one contextual right-side Preview Host; the online Theia shell enforces the one-group constraint. Desktop VS Code users retain host-native ability to create additional editor groups; Studio must not claim it can control the entire desktop host layout.

Studio is not an Agent Runtime, 5GC controller, Owner registry, Capability authority, Host Admission service, deployment registry or production qualification system.

## 2. Cross-repository authority

| Authority owner | Owns | Studio must do |
|---|---|---|
| [ca-skills](https://github.com/odango-chan/ca-skills) | CA-SL normative syntax, v1alpha5 authoring contract and published Skill source | Consume the frozen v1alpha5 contract; do not create another grammar or compatibility parser. |
| [ca-skill-compiler](https://github.com/odango-chan/ca-skill-compiler) | Compiler wire contracts, parsing / linking / deterministic artifacts, formal Interface Package and Development Build APIs | Use the published versioned API; do not implement a second Compiler or linker. Current Studio main integrates v2.0.2; v2.1.0 Development Build / Verify cutover remains open in #269. |
| OpenAMSM Owner / [ca-client-tools](https://github.com/odango-chan/ca-client-tools) | Published Owner ToolCatalog / callable contracts and separate read-only SBI Interface Package | Pin source snapshots and show provenance. A ToolCatalog snapshot or Interface Package is not Owner authorization. |
| Host Context publisher / Host | Context schema source, Host admission and request identity | Consume exact context snapshots; do not invent Host admission or execution identity. |
| [ca-agent-demo](https://github.com/odango-chan/ca-agent-demo) | Demo Host / integration behavior and demo execution evidence | Reference only when a specific current integration or evidence boundary requires it; never infer Runtime or 5GC qualification from editor state. |
| [ca-runtime](https://github.com/odango-chan/ca-runtime) | Runtime execution, Run / Outcome / Receipt / Reconcile and runtime qualification | Display authoritative results only when explicitly supplied; never synthesize them. |
| [connectionagent](https://github.com/odango-chan/connectionagent) | Ecosystem ownership and central documentation governance | Follow shared governance while preserving each repository's authority boundary. |

## 3. Source authority and workbench data flow

~~~text
Native Skill Source + exact locked dependency snapshots
   ↓
CA-SL v1alpha5 Language Service / bounded source projections
   ↓
Preview / Outline / Problems / Package Explorer (derived views)
   ↓
Host-validated source patch → Diff / explicit confirmation
   ↓
Native WorkspaceEdit → Source revision / Undo / Redo
~~~

YAML Source and immutable dependency snapshots are the authoritative inputs consumed by Studio. Graph nodes, edges, layout, selected elements, Inspector state, completion items and Problems are derived projections; they are not separate business truth. A visual edit must be tied to the exact document URI, source revision and source span, then reparsed and revalidated before it is applied. Ambiguous or stale edits fail closed.

Local syntax / source diagnostics, Package Audit, Compiler diagnostics, Host Admission and Runtime Execution are separate result domains. A local hint or a successful source projection is not a Compiler PASS. A Compiler Build is not Host Admission or Runtime Execution.

## 4. Current Example and dependency boundary

The default Example contains the three OpenAMSM Scheme C Skills:

- `establish-pdu-session-mas`
- `modify-pdu-session-mas`
- `release-pdu-session-mas`

It pins three dependency kinds: `mas` Owner ToolCatalog, `ca-context` Host Context Schema Bundle and `ca-client` read-only SBI Interface Package. `ca-client` is for query Schema IntelliSense only; it is not a MAS Contract root. The current `mas` and `ca-context` sources are not formal Compiler v2.1.0 Interface Package Contract roots. See the [dependency architecture](dependency-and-interface-package.md).

The Example is DRAFT / NOT_QUALIFIED. A pinned ToolCatalog, Schema Bundle or Interface Package proves snapshot provenance, not Owner authorization, Host Admission, Runtime execution or real 5GC qualification. Do not re-add the separate illustrative conventional 5GC Skill to the default Example.

## 5. Workspace and project layout

The current Example importer writes to the extension-owned `skill-studio-demo/` project root. Its authored source is under `skills/`; workspace settings are host-native `.vscode/settings.json`; immutable dependency snapshots are under `.skill-studio/dependencies/<digest>/`. It does not create mandatory `lib/` or `output/` folders.

A user's existing Example is never silently replaced. Replacement requires explicit confirmation. The current importer validates bundled sources before mutation and verifies the resulting inventory, but its active-root writes do not yet provide a full failure-atomic rollback boundary; see [#280](https://github.com/odango-chan/ca-skill-studio-demo/issues/280). Persistent-profile restore / upgrade remains separately gated by [#225](https://github.com/odango-chan/ca-skill-studio-demo/issues/225).

## 6. Qualification and non-goals

- Browser / Theia / IDE Host / Pages tests prove only the named editor and host scope.
- The bundled Example and Schema completions are authoring material; they do not authorize Tool invocation.
- Studio does not execute user Python, Skill Runtime, Provider calls or 5GC procedures in the online Pages environment.
- Do not add production signing, package admission, Runtime trust registries or 5GC orchestration to Studio merely to make the demo appear qualified.
- Do not restore Classic, CA-SL legacy compatibility, an extra Source/Preview editor group, a second parser, a second LSP or a Studio-owned linker.

## Revision record

- **2026-11-26:** Replaced stale 2026-11-03 ownership / source-protection statements with the current Theia-only workbench, v1alpha5 authority, current OpenAMSM Example, three dependency kinds, Compiler v2.0.2 / v2.1.0 boundary and explicit non-qualification scope. Evidence: current main SHA, extension source, dependency service and Example manifest.
