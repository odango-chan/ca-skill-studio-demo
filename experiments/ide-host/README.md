# SKILL Studio online host · Theia + optional VS Code desktop/web

**Default online host direction (2026-11-09).** Repo owner:
`ca-skill-studio-demo`. GitHub Pages now targets Theia browser-only at `/`;
the previous full browser Studio is preserved at `/classic/`, and the former
`/ide-preview/` path redirects to the new root. This is a host-shell switch,
not a feature-parity claim. Tracks #85.

**Online is mandatory.** The target product is a browser-accessible SKILL
Studio plus optional local/VS Code entry points. The browser host remains
first-class; the old browser Studio stays available during feature migration.

## Host architecture and responsibility boundary

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

## Shared theme · offline VS Code and online Theia

The visual system is a separate, dependency-free VS Code theme extension at
[`extensions/skill-studio-theme`](../../extensions/skill-studio-theme).
It contributes **SKILL Studio Light** (workbench + editor token colors) and
**SKILL Studio File Icons** (SKILL/YAML/Markdown/Python/common source files).
Native Codicons remain the single-color IDE product-icon family; the color
theme sets their shared foreground instead of replacing every host glyph.

The same package is staged as a built-in Theia plugin and selected by the
browser-only app's default preferences. IDE Host CI publishes a separate
`skill-studio-theme-vsix` artifact. Copy that VSIX to an offline machine:

```sh
code --install-extension skill-studio-theme.vsix
```

Then choose **Preferences: Color Theme → SKILL Studio Light** and
**Preferences: File Icon Theme → SKILL Studio File Icons**. The VSIX contains
all theme JSON and SVG assets and has no runtime/network dependency.

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
Route Patch Diff, confirm, native undo and native save. Select a Node's
**查看** action to open the one-hop Node Focus graph (previous / PRE-OP-POST /
next); click a Phase Step's line badge to reveal that exact line in the same
native YAML editor, then return to the complete Procedure graph. Node Focus
is read-only and does not modify Source.

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

**Verified CI:** Theia browser-only [#42584800342](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42584800342), Theia backend Chromium [#42584800599](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42584800599), and IDE Host / VSIX [#42584800417](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42584800417) all PASS on the merged-base head. Real Chromium acceptance covers sample import, CustomEditor, Source-backed Patch, native Source/Undo, Node Focus PRE/OP/POST and Source line reveal. Resulting-main Pages [#42585232727](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42585232727) PASS. The VSIX is an optional desktop artifact; desktop VS Code GUI remains separately unverified.

## Online Theia host and deployment

Theia `browser-only` (1.76.0) is built with the Web extension bundled at
**build time**. The default GitHub Pages root is the Theia workbench; the
previous full-featured browser Studio is copied to `/classic/`. The former
`/ide-preview/` URL redirects to `/`. Both are generated in one Pages build;
`main` is the durable source after PR #86 is merged.

The online host must supply Explorer New File/Folder/Rename/Delete,
YAML/Python tabs and Source, real Procedure graph and Source-backed Patch
through `TextDocument/WorkspaceEdit`. Its filesystem uses browser OPFS;
this is **not** a native disk mount nor automatic synchronization to GitHub.
Explicit import/export and persistence acceptance are separate gates.

The online host has real Chromium evidence from the previous subpath preview:
Theia shell startup, sample SKILL import into OPFS, Procedure CustomEditor
rendering, guarded Source-backed Patch, native Source editor and Undo passed
in [workflow run #42575346100](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42575346100).
The default-root smoke and explicit Classic composition test passed in the
resulting-main Pages deployment [#42579544196](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42579544196). The Node VSIX remains an optional
VS Code/desktop Theia entry point; the online host uses the build-time Web
extension entry.

References:
- https://theia-ide.org/docs/composing_applications/
- https://code.visualstudio.com/api/extension-guides/web-extensions

## What is and is not proven

| Test | Acceptance | Status at main b9c1c38 |
|---|---|---|
| Existing CreatedSession YAML projection | five procedures, Root 17 nodes, 63 Outcome routes | **PASS** (unit) |
| Native TextDocument + WorkspaceEdit boundary | IDE owns file IO, undo, save; Webview never does | **PASS** in real Theia browser-only and backend Chromium CustomEditor acceptance; desktop VS Code GUI **NOT_RUN** |
| Patch isolation / stale rejection | host reprojects, checks version and exact scalar span | **PASS** (unit + mock-host) |
| ReactFlow + ELK bundling | Webview bundle with local CSS and scripts | **PASS** (real Theia Chromium render, including Node Focus) |
| VS Code Explorer/new file | native integration works | **NOT_RUN** |
| VS Code editor open/edit/undo | graph refresh and single-scalar patch | **NOT_RUN** |
| Theia same VSIX | custom editor and Webview API compatibility | **NOT_RUN** |
| Theia browser-only with Web extension | Build-time bundled extension, sample import, Procedure CustomEditor, Patch, native Source/Undo, Node Focus and Source line reveal | **PASS** in real Chromium at the default Pages root; Classic composition and Pages deployment also PASS |
| Local Runtime / 5GC | deliberately out of scope | **NOT_RUN** |

The Pages host is now Theia browser-only. The Node Focus view and Route creation/reconnect are migrated. The current Inspector Node-authoring increment adds Node rename and Operator-value editing by reusing the existing Classic source-patch modules; its exact-head acceptance is pending in [PR #96](https://github.com/odango-chan/ca-skill-studio-demo/pull/96). Node insertion/deletion and full Phase Step/Verify authoring remain Classic-only. The D4-A1 Phase Input Binding subset is being migrated in [PR #97](https://github.com/odango-chan/ca-skill-studio-demo/pull/97), limited to existing same-Procedure, same-type input sources. Package Audit and Markdown preview are already native Theia views. Its GitHub Pages adapter changes
Theia's default per-Webview subdomain pattern to same-origin because Pages
cannot provide wildcard Webview DNS/TLS. A persistent warning is shown:
**do not open sensitive files or untrusted workspaces**. OPFS data stays in
the browser profile; it is not a native disk mount or GitHub sync. This static
host does not execute Python, SKILL Runtime or 5GC.

## Acceptance and possible outcomes

- If VS Code extension works but Theia CustomTextEditorProvider does not:
  keep a VS Code extension and evaluate a small Theia-specific wrapper around
  the same graph adapter. Do not fork YAML semantics.
- If online Theia browser-only and desktop work: prefer **one shared
  Studio extension and core** with Theia as branded browser shell and
  VS Code as an optional local host.
- If neither is reliable, isolate the existing browser Studio's workspace
  adapter rather than continuing to grow a hand-built IDE.

Theia is the default online shell; keep `/classic/` until every required Studio capability has been migrated and accepted. Do not silently drop the old UI.
