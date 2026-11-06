# ADR-0002 · Host-native SKILL Studio extension spike

**Status: EXPERIMENT (not an architecture migration decision)**  
**Issue:** [#85](https://github.com/odango-chan/ca-skill-studio-demo/issues/85)  
**Owner:** ca-skill-studio-demo (editor-only; Runtime/5GC excluded)

## Problem

Current Pages demo implements a custom file tree, directory import/save,
menus, view switching and workspace lifecycle around Monaco. The most recent
feedback is that a SKILL Studio should first be a usable code editor with
normal file creation, deletion and native tabs, plus a differentiated
Procedure Designer. The Monaco editor component alone cannot supply that
full IDE shell or VS Code's extension host.

## Trial implementation (isolated)

Build a standard VS Code extension, but do not merge it into or replace the
Pages application. Register an optional `CustomTextEditorProvider` for
`**/assurance/procedure.yaml` with priority `option`, retaining the
host's built-in YAML/Python editors. Do not implement another Explorer or
workspace file manager.

The Webview imports the current `site/workspace.mjs` projection,
`site/layout.mjs` ELK layout, `site/react-flow-canvas.tsx` React Flow canvas,
and an isolated source-stable `operator.on` Route target preview in `experiments/ide-host/vscode/src/route-target.mjs` (not production DSL or Runtime semantics). The true Source is
the host's `TextDocument`, updated by `onDidChangeTextDocument`; the visual
viewer holds only a disposable projection snapshot. It cannot write files.

A route edit requires explicit Diff preview and confirmation. A message to
the host carries the document version, exact base Source, target identity and
candidate. Host recomputes the qualified Source-backed preview against the
current `TextDocument`, checks the scalar span and that **no unrelated text**
changes, then applies a single `WorkspaceEdit.replace` to native document.
Changes trigger the native undo/save/dirty state and a new projection. No
automatic execution, no alternate YAML serializer, no custom host disk API.

## Hard product requirement: browser IDE is first-class

The Studio must remain usable **online**, including Explorer file creation,
YAML/Python text editing, tabs and Procedure graph editing. A desktop-only
VS Code plugin does not meet the product goal. The existing Pages application
remains available and unchanged during the trial.

A promising common shell is **Eclipse Theia browser-only** (>=1.76): it
requires no Node backend for editing, uses the browser Origin Private File
System (OPFS), and can execute **build-time bundled Web extensions**. That
supports a static hosting candidate (including GitHub Pages) for an editor,
not for arbitrary Python/Skill execution. Runtime extension installation and
terminals are not available in browser-only mode.

The current extension was previously Node-only. The spike now builds *two*
entries from one extension source:
- `main: dist/extension.cjs` for Node desktop/server-hosted extension hosts;
- `browser: dist/extension-web.cjs` for browser workers (VS Code Web /
  Theia browser-only once actually integrated).

This is **build capability**, not an online working deployment. Browser-only
Theia must bundle the Web extension during its own build (installing the Node
VSIX from the Extensions UI at runtime is not sufficient). Webview resource
URIs, the CustomTextEditor API, extension activation, OPFS file create/save,
and deployment under a GitHub Pages subpath remain **NOT_RUN**.

For later **online execution** (not editing), a separate consented backend
service or local runner is needed. Never pretend browser-only OPFS can run
Python or 5GC.

Reference: https://theia-ide.org/docs/composing_applications/ (Browser-Only
Applications), https://code.visualstudio.com/api/extension-guides/web-extensions,
https://eclipsesource.com/blogs/2024/01/29/running-eclipse-theia-without-a-backend/

## Host candidates and boundary

| Host | What it supplies | What is actually tested |
|---|---|---|
| VS Code | Explorer, New File/Folder, search, tabs, native text editing, undo/save | Build/API/AST/Patch unit tests in CI; desktop host visual acceptance must be observed |
| Eclipse Theia desktop / browser+backend | Native IDE shell and VS Code extension host | Node VSIX compatibility unproven until real host |
| Theia browser-only (>=1.76) | **First-class online editor candidate**, OPFS, prebundled Web extensions | Web entry builds; Theia static app, CustomEditor activation, OPFS, deploy **NOT_RUN** |
| Existing Pages demo | Static and shareable standalone preview | Remains unchanged; it is a different host implementation, not yet a shared extension |

Theia may implement/stub distinct VS Code API features; it is wrong to
claim runtime compatibility based on compile-only extension support. A
Theia-specific adapter, if needed, must be **thin** and reuse the same
Source projection / patch contract rather than copying business logic.

Official API sources: [VS Code Custom Editor](https://code.visualstudio.com/api/extension-guides/custom-editors), [Theia extension mechanisms](https://theia-ide.org/docs/extensions/), [Theia VS Code compatibility](https://theia-ide.org/docs/user_install_vscode_extensions/).

## Decision gates

- **Source authority:** exact content/version; preview no write; host
  revalidation and diff; one scalar native workspace edit; stale/forged
  proposals rejected.
- **Model fidelity:** pinned `establish-pdu-session` five procedures,
  Root 17 Nodes and 63 Routes; all bundle origins retained.
- **UX integration:** native Explorer create/rename/delete, native YAML/Python
  source and tabs; open optional Procedure view and switch to native Source;
  graph and Source synchronize after native undo/redo and save.
- **Cross-host:** install the Node VSIX into desktop/server Theia and bundle the web extension into browser-only Theia; repeat the
  above; document any CustomEditor/Webview limitations explicitly.
- **Security:** local CSP, no remote downloads in Webview, no Script execution,
  no 5GC network operations, no file writes outside IDE `WorkspaceEdit`.

A green Node build does **not** satisfy the native UX or Theia gate. Keep the
spike draft/open until VS Code desktop, Theia browser-only online, and any
optional Theia desktop host have independently verified acceptance (or an
explicitly documented incompatibility). Do not ship a desktop-only migration.

## Follow-up, not yet authorized

If both hosts pass, move the reusable graph/Patch adapter into a host-neutral
library before considering retirement of the hand-built Explorer. If Theia
fails, do not patch around it in the DSL owner or introduce duplicate Runtime
contracts. Continue to ship Pages as before until a separate migration
decision explicitly approves replacement.

## First CI finding: old profile pin vs current sample

The current actual sample contains **5 Procedure definitions**, not the 6
required by the historical `site/extended-attributes.mjs`
`createdRouteTargets` profile. Therefore reusing that specialized qualification
returned zero editable Routes. The spike uses a narrowly scoped **generic**
plain-scalar `operator.on` target preview, with exact Source Span, full
reprojection and non-target Route equality. This must **not** silently relax
production Studio policy. If adopted, separately review the production
qualification contracts and re-establish their owner-approved rules.

## Verified code-level result (2026-11-06)

[Draft PR #86](https://github.com/odango-chan/ca-skill-studio-demo/pull/86),
[exact-head CI #42191440251](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42191440251): **PASS**.
The isolated build produces a VSIX; six focused tests pass, including a
mocked VS Code `CustomTextEditorProvider` message round-trip, one guarded
`WorkspaceEdit` scalar replacement, duplicate/stale rejection and actual
5-Procedure 17-Node/63-Outcome source projection. The pre-existing 409
repo tests also pass. These are build / mock-host / unit results only:
**VS Code GUI and Theia GUI remain NOT_RUN**. The draft is intentionally not
merged into `main`.
