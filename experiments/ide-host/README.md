# IDE host experiment · online Theia + VS Code desktop/web

**Spike, not a migration.** Repo owner: `ca-skill-studio-demo`; original
browser Demo / GitHub Pages is untouched. Tracks #85.

**Online is mandatory.** The target product is a browser-accessible SKILL
Studio plus optional local/VS Code entry points; this spike must never
replace the existing GitHub Pages site with a desktop-only tool.

## Decision being tested

We should not rebuild a second native IDE shell around Monaco. The current
Studio has a browser-only, hand-built Explorer, tabs/save/menu and code editor.
A VS Code or Theia host already supplies native:
file tree, New File/Folder, Rename/Delete, search, tabs, language editors,
workspace editing, undo/redo, and extension lifecycle.

Only SKILL-specific functionality belongs to Studio:
`site/workspace.mjs` Source projection, ELK layout, ReactFlow graph,
qualified AST/CST patch preview and exact revision guard (a spike-only, operator.on target edit; **not** runtime qualification). The extension
runs a **CustomTextEditorProvider** that takes an IDE `TextDocument` as its
sole source; it does not open another Monaco Source buffer or own file IO.

The current spike imports the real projection, ReactFlow and ELK sources from
`site/` and bundles those exact modules. It registers a **non-default**
custom visual editor on `**/assurance/procedure.yaml`. Ordinary YAML/Python
stay in the host's default editors. New/rename/delete files work through
the **host's Explorer**, not through separate Studio code.

## How to try it

From repository root with Node 24:

```sh
npm ci
node experiments/ide-host/scripts/build-ide-spike.mjs
node --test experiments/ide-host/tests/*.test.mjs
```

For VS Code, run the Extension Development Host per
[vscode/README.md](vscode/README.md), and open
`site/samples/packages/establish-pdu-session` as a folder. Use normal Explorer
operations to create, rename, delete a test file; open a `.py` in the native
editor. Then **SKILL Studio: Open Procedure Visual** opens the original
`assurance/procedure.yaml` graph. Check Root/Child selection, the 17 Node
and 63 Outcome model, native YAML source beside the graph, a qualified
Route Patch Diff, confirm, native undo and native save.

The optional [GitHub Actions VSIX artifact](../../actions) is a prebuilt
extension from the experimental PR workflow; download and install manually in
VS Code or Theia. No extension is installed automatically.

For Theia, start a separately installed Theia IDE with support for VS Code
extensions enabled (`@theia/plugin-ext-vscode`). In **Extensions** use
**Install from VSIX...** and select the same artifact. Open the exact same
folder. Do not assume every Theia version implements
`registerCustomEditorProvider` and Webview CSP/URI behavior: verify that
the command appears, the graph opens, native file operations work and
document changes round-trip before assigning Theia PASS.

Official sources: 
- https://code.visualstudio.com/api/extension-guides/custom-editors
- https://theia-ide.org/docs/authoring_vscode_extensions/
- https://theia-ide.org/docs/user_install_vscode_extensions/

**Verified CI:** [ide-host-spike #42191440251](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42191440251) — 6/6 spike tests, 409/409 existing tests, bundled extension and VSIX artifact PASS. The simulated host verifies real WorkspaceEdit message handling, but not the real VS Code or Theia GUI. Download `ca-skill-studio-ide-spike-vsix` from the workflow **Artifacts** section.

## Online host trial (still NOT_RUN)

**Target:** build an independent Theia `browser-only` app (>=1.76), bundle
the browser extension entry `dist/extension-web.cjs` at **build time**, and
host the resulting static frontend at a separate preview path. Existing
`https://odango-chan.github.io/ca-skill-studio-demo/` continues unchanged.

The online host must supply Explorer New File/Folder/Rename/Delete,
YAML/Python tabs and Source, real Procedure graph and Source-backed Patch
through `TextDocument/WorkspaceEdit`. Its filesystem uses browser OPFS;
this is **not** a native disk mount nor automatic synchronization to GitHub.
Explicit import/export and persistence acceptance are separate gates.

This spike builds the browser entry but does **not yet build/host the Theia
browser-only shell**. Chrome/webview and `CustomTextEditorProvider` actual
runtime support remain unverified. The Node VSIX is for desktop/server Theia;
in a browser-only host the web extension must be bundled during Theia build.

References:
- https://theia-ide.org/docs/composing_applications/
- https://code.visualstudio.com/api/extension-guides/web-extensions

## What is and is not proven

| Test | Acceptance | Status at verified build d528ba73 |
|---|---|---|
| Existing CreatedSession YAML projection | five procedures, Root 17 nodes, 63 Outcome routes | **PASS** (unit) |
| Native TextDocument + WorkspaceEdit boundary | IDE owns file IO, undo, save; Webview never does | **PASS** (bundled extension / simulated host); real native host **NOT_RUN** |
| Patch isolation / stale rejection | host reprojects, checks version and exact scalar span | **PASS** (unit + mock-host) |
| ReactFlow + ELK bundling | Webview bundle with local CSS and scripts | **PASS** (bundle/VSIX; actual render **NOT_RUN**) |
| VS Code Explorer/new file | native integration works | **NOT_RUN** |
| VS Code editor open/edit/undo | graph refresh and single-scalar patch | **NOT_RUN** |
| Theia same VSIX | custom editor and Webview API compatibility | **NOT_RUN** |
| Online Theia browser-only with Web extension | Build-time bundled extension, OPFS create/edit, Procedure CustomEditor | Web entry built; full host **NOT_RUN** |
| Local Runtime / 5GC | deliberately out of scope | **NOT_RUN** |

No Theia backend/framework dependency is introduced into the existing Pages
application. This is an architectural trial, not a release.

## Acceptance and possible outcomes

- If VS Code extension works but Theia CustomTextEditorProvider does not:
  keep a VS Code extension and evaluate a small Theia-specific wrapper around
  the same graph adapter. Do not fork YAML semantics.
- If online Theia browser-only and desktop work: prefer **one shared
  Studio extension and core** with Theia as branded browser shell and
  VS Code as an optional local host.
- If neither is reliable, isolate the existing browser Studio's workspace
  adapter rather than continuing to grow a hand-built IDE.

Do not merge or replace the established Pages UX until native evidence exists.
