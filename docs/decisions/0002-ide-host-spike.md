# ADR-0002 · Host-native SKILL Studio extension spike

**Status: ACCEPTED as the default online demo host (2026-11-09); feature-parity migration IN PROGRESS**  
**Issue:** [#85](https://github.com/odango-chan/ca-skill-studio-demo/issues/85)  
**Owner:** ca-skill-studio-demo (editor-only; Runtime/5GC excluded)

## Decision update (2026-11-09)

This update supersedes the initial spike-only deployment language below.
**Theia browser-only is now the default online SKILL Studio host**:
GitHub Pages `/` serves Theia, the previous complete browser Studio is
preserved at `/classic/`, and the former `/ide-preview/` path redirects to
the new root. The same Pages workflow builds Theia from the current ref and
keeps the Classic artifact from the main-source build. PR #86 was merged by Squash Merge at `main@b2f4e991`; `main` is now the
durable source for both builds.

This is a **host-shell decision, not a claim of feature parity**. The initial
plugin migration still lacks the old Studio's Node detail view, Route create
and reconnect, Phase Designer, full Inspector, Package Audit and Markdown
preview. Use `/classic/` for those capabilities until each is migrated and
accepted. Do not delete or shrink Classic to make the new UI appear complete.

**Security and persistence boundary:** GitHub Pages uses the demo-only
same-origin Theia Webview adapter because it cannot provide per-Webview
wildcard origins. The visible banner warns users not to open sensitive files.
This static Pages build is for public/sample workspaces only, not sensitive
or untrusted workspaces. Browser OPFS is local to that browser profile; it is
not a native disk mount, GitHub synchronization, or a Runtime. Python, Skill
execution and 5GC operations remain out of scope.

The previous `main` baseline is protected at
`backup/main-before-theia-default-2026-11-09` (exact SHA
`dcb137d606e6a697fcf02f7d7c5a811f7921e0f5`).


## Problem

Current Pages demo implements a custom file tree, directory import/save,
menus, view switching and workspace lifecycle around Monaco. The most recent
feedback is that a SKILL Studio should first be a usable code editor with
normal file creation, deletion and native tabs, plus a differentiated
Procedure Designer. The Monaco editor component alone cannot supply that
full IDE shell or VS Code's extension host.

## Trial implementation (isolated)

Build a standard VS Code extension and bundle its Web entry into the Theia
browser-only host. The Pages root now uses Theia; the previous browser
application is preserved at `/classic/`. Register an optional `CustomTextEditorProvider` for
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
VS Code plugin does not meet the product goal. The previous complete Pages application is preserved at `/classic/`; the
new Theia browser-only host is the default at `/`.

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

The browser-only Theia shell now builds with the Web extension bundled at
build time. The exact-head online workflow previously passed real Chromium
shell startup, sample import, Procedure CustomEditor rendering, guarded Patch,
native Source editor and Undo at the `/ide-preview/` subpath (run
[42575346100](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42575346100)).
The new default-root path `/ca-skill-studio-demo/`, Classic preservation and
release composition passed in the resulting-main Pages run
[#42579544196](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42579544196)
at `main@b2f4e991`.

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
| Theia browser-only (>=1.76) | Default online demo shell, OPFS, prebundled Web extensions | Real Chromium shell, sample import, CustomEditor, Patch, Source/Undo, Node Focus PRE/OP/POST and Source line reveal PASS at the default Pages root; Pages deploy #42585232727 PASS |
| Classic Pages demo | Full previous browser Studio at `/classic/` | Preserved from the main-source build; link back to Theia root |

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

A green Node build alone does **not** satisfy the online host gate. The
Theia browser-only root-path and Classic-composition checks passed in
resulting-main Pages deployment #42585232727. VS Code desktop and Theia
desktop are optional hosts and remain independently unverified.

## Remaining migration work

Node Focus (read-only previous/current/next, PRE/OP/POST and native Source
line reveal) migrated in PR #89 and is available in the shared CustomEditor.
Next migrate Route creation/reconnect, then Phase Designer and the remaining
Inspector / Package Audit / Markdown preview capabilities without duplicating
Source or Runtime semantics. Keep `/classic/` until functional parity and
security review are complete. If Theia compatibility fails for a capability, add a
thin host adapter around the same Source projection/Patch contract; do not
patch around it in the DSL owner or introduce duplicate Runtime contracts.

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


## 2026-11-09 · Default Pages deployment

The Pages workflow now tests Theia at the repository root subpath
`/ca-skill-studio-demo/`, composes Theia at `dist/`, preserves the prior
main build at `dist/classic/`, writes `.nojekyll`, preserves a configured
`CNAME`, and leaves a redirect at `dist/ide-preview/`. The Classic app
contains a link back to the new host; Theia contains a link to Classic and a
persistent same-origin safety warning.

The exact-main run [#42579544196](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42579544196)
passed the root smoke, composition assertions and GitHub Pages deployment.
The earlier unit/mock build alone was not used as the release gate.


## 2026-11-09 · Shared Skill Studio Theme

The host UI uses one independently packaged visual system rather than
host-specific CSS forks. `extensions/skill-studio-theme` is a standalone,
dependency-free VS Code theme extension shared by online Theia and offline
VS Code. It contributes **SKILL Studio Light** for workbench/editor surfaces
and syntax, plus **SKILL Studio File Icons** with local SVG assets for SKILL,
YAML, Markdown, Python and common source files.

The palette reuses the established `site/light.css` tokens. Native Codicons
remain the host's monochrome product-icon family; the theme sets their common
foreground and selected/hover states rather than introducing a competing
glyph font. Procedure graph PASS/FAIL/UNKNOWN semantics remain owned by the
existing graph CSS and are not recolored by generic editor syntax rules.

The Theia browser-only application preloads this exact package at build time
and selects both themes in its default preferences. The IDE Host workflow
packages a separate `skill-studio-theme-vsix` artifact. A user can copy that
VSIX to an offline machine and install it with `code --install-extension`;
the package has no runtime dependencies, remote fonts or network requests.


## 2026-11-09 · Node Focus in the IDE-host CustomEditor

PR #89 reuses the existing one-hop Node Focus projection inside the IDE-host CustomEditor. The local graph retains original Route IDs and outcomes, while PRE → OP → POST stage-order links and the dashed current-Node boundary remain explicitly view-only. Clicking a Phase Step asks the host to validate its 1-based Source line and reveal it in the same native TextDocument; the view itself does not mutate YAML.

Exact merged-base acceptance: IDE Host [#42584800417 PASS](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42584800417), Theia browser-only [#42584800342 PASS](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42584800342), Theia backend Chromium [#42584800599 PASS](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42584800599). PR #89 merged at `main@b9c1c38`; resulting-main Pages [#42585232727 PASS](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42585232727).
