# ADR-0005 · Fixed Source + Preview Workbench

**Status: Accepted · Theia 1.76 fixed Source + Preview host integration is implemented on main and deployed; tracking Issue #220 remains open for closeout · Updated: 2026-11-26 (original decision 2026-11-19)**

**Issue:** [#220](https://github.com/odango-chan/ca-skill-studio-demo/issues/220)

**Supersedes:** ADR-0003 §2's central-editor placement of Visual CustomEditors and its paired two-EditorGroup Markdown Preview behavior. It does not supersede ADR-0001 Source-first authority, ADR-0003's native Explorer / Outline / Problems / Output ownership or right-side Inspector, or ADR-0004 Package Explorer decisions.

## Current implementation update · 2026-11-26

The fixed workbench is present in current main: native Source documents remain in the single Main Editor group; one persistent `skillStudio.preview` WebviewView follows the active Source in the right Secondary Sidebar; Inspector, native Outline and Problems retain their host-owned locations. The Theia browser-only shell applies the fixed Main Editor DockPanel policy. Current code anchors include `experiments/ide-host/vscode/src/preview-host.mjs`, `workbench.mjs`, `extension.mjs`, the pinned Theia frontend integration and `experiments/ide-host/scripts/theia-fixed-layout-smoke.mjs`.

The current main Pages deployment `5b666c0ef754ed32fa37c97ce2429f328c70477f` is deployed successfully by [workflow #45545634726](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/45545634726). The issue #220 remains open; deployment identity and implementation presence are not used to silently close that tracking issue. The fixed one-group guarantee applies to the online Theia shell; desktop VS Code users retain host-native split controls.

## Context

The current Theia workbench uses the Main Editor DockPanel in `multiple-document` mode. Skill Studio opens Procedure, Contract, Predicate and Schema CustomEditors in `ViewColumn.Two`, and opens the native Markdown Preview CustomEditor in the same second editor group. A Source-only editor normalizer attempts to move ordinary files back to the first group.

This is a best-effort placement policy, not a layout invariant. The active group at the time of an open command, native Preview commands, restored tabs, CustomEditor resolution timing and user actions can still create additional editor groups. The implementation consequently contains several event listeners, tab moves and duplicate-tab cleanup paths whose purpose is to repair placement after the host has already made a layout decision.

The product needs a simpler authoring model: one stable Source editing area and one stable visual Preview area. Visualizers are contextual projections of the active Source, not independent editor documents.

Theia 1.76 provides a relevant host primitive: `ApplicationShell.createMainPanel()` constructs the Main Editor DockPanel with `mode: 'multiple-document'`, while its left and right side panels use `mode: 'single-document'`. The Theia DockPanel uses the single-document mode to prevent document-area splitting while retaining the tabbed editor surface. The VS Code-compatible extension API also provides `WebviewViewProvider`, which can host one persistent webview in a contributed Secondary Sidebar view.

## Decision 1 · Fixed online workbench layout

The online Theia host owns and enforces this layout:

- **Left / primary sidebar:** existing native Explorer and Package Explorer.
- **Center:** exactly one Main Editor group containing ordinary native Source tabs.
- **Right / Secondary Sidebar:** one Skill Studio Preview view, followed by the existing Inspector view.
- **Bottom:** native Problems, Output and other existing host panels.

The Main Editor DockPanel must use Theia's `single-document` mode. Multiple Source documents remain tabs in the same editor group; splitting the Main Editor into additional groups is not supported in the online Skill Studio workbench.

Implement this as a thin, version-pinned Theia 1.76 frontend integration by rebinding `TheiaDockPanel.Factory`. The core factory receives the Main Editor renderer after `MAIN_AREA_CLASS` has been added to its tab-bar classes; use that stable host identity to distinguish the Main Editor from the bottom panel. For that panel only, construct `TheiaDockPanel` with `mode: 'single-document'` and `disableDragAndDrop: true`. This prevents editor detachment / split creation while retaining normal tab selection and tab reordering. Delegate every non-main panel to the original Theia defaults by constructing it with its original options. Do not subclass `ApplicationShell`, access its private fields, modify generated files or patch installed `node_modules`. The spike must prove that the frontend module rebinds the factory before shell construction and before editor-layout restoration.

The left, right and bottom panel modes remain host defaults. Do not change the Explorer, Inspector, Problems or Output layout to achieve the editor constraint.

## Decision 2 · One persistent Preview Host

Contribute a single `skillStudio.preview` WebviewView to the existing `skillStudioInspector` container in the Secondary Sidebar.

- Use one stable view identity and one `WebviewViewProvider`; do not create a WebviewPanel, CustomEditor or editor tab for a preview.
- Show Preview by default on the first successful browser-profile launch. Persist that one-time reveal; on later launches, let Theia restore the user's saved visibility, movement, sizing and layout preferences. A user can reopen Preview from the native View menu.
- Keep Inspector and its existing Source-derived Data Flow behavior as a separate view in the same Secondary Sidebar.
- The Preview Host follows the active Source editor. Switching Source tabs updates the same view in place.
- A Source file without a supported visual projection shows a neutral empty state; it does not open a new group or create a new preview.
- Hiding, restoring or reopening the view must not create duplicate providers, subscriptions, message handlers or stale render sessions.

The host message contract must be explicitly versioned and bind each snapshot / action to the exact document URI, document version and Preview generation. A stale message, stale selection or stale mutation proposal must be rejected. URI and document version are both required; version numbers alone are not globally unique across files.

## Decision 3 · Source remains the only editing authority

The native Source editor remains responsible for:

- TextDocument identity and content;
- syntax highlighting, language services, LSP, diagnostics and completion;
- selection, cursor, native Undo / Redo, dirty state and Save;
- all file operations and workspace persistence.

The Preview Host receives a read-only projection of the active Source and renders it. It must not become a second document model or write files directly.

Procedure, Contract, Predicate and Schema visuals reuse the existing parsers, projections, React Flow components, source navigation and bounded Source Patch contracts. Any supported mutation continues through host-side validation of the exact URI, revision and source span, explicit Diff / confirmation where required, and native WorkspaceEdit. Do not weaken or duplicate those contracts as part of the view migration.

## Decision 4 · Markdown uses native Source and Studio Preview

Markdown Source remains a native editable Markdown document. The pinned native Markdown language support remains available for language identification, syntax, language features and LSP where supported.

The native Markdown Preview CustomEditor and `markdown.showPreviewToSide` are no longer used by the online Theia workbench. Markdown rendering is moved into `skillStudio.preview`, using a pinned browser-compatible renderer.

The new renderer must preserve the accepted Markdown security boundary:

- raw HTML is disabled;
- images and remote/local image fetches are disabled;
- external links are handled explicitly and safely;
- Package-relative links are allowed only when they resolve to an inventoried file under the exact Package root;
- encoded separators, path traversal, unsafe schemes, symlinks, ambiguous roots and out-of-Package targets fail closed;
- the shared Skill Studio Markdown theme is reused.

Source-to-Preview and Preview-to-Source scroll synchronization must be implemented using stable source line / heading anchors. Acceptance must use real user-like scroll gestures in Chromium in both directions; synthetic programmatic reveal alone is insufficient. Link activation navigates the target Source in the single editor group and updates the existing Preview Host.

The Markdown renderer is a rendering component only. Do not reintroduce a second Markdown editor, a second language service, or a separate authoritative Markdown document.

## Decision 5 · Host compatibility boundary

The fixed one-group guarantee applies to the default online Theia application, whose shell is owned by this repository.

The same VS Code extension remains usable in desktop VS Code. It must stop opening Designer / Markdown previews in additional EditorGroups and should use the right-side Preview view where the host supports it. However, an extension cannot guarantee that desktop VS Code users will never create additional editor groups through native split commands. Do not claim that desktop extension APIs provide control over the host's complete editor layout.

All Skill-language parsing, projection, diagnostics, Source Patch rules, Package policy and Markdown security logic remain shared. The Theia-specific layer is limited to shell composition and lifecycle integration.

## Migration sequence

1. **Host shell spike:** prove a Theia 1.76 frontend module can replace the ApplicationShell binding and create the Main Editor DockPanel in single-document mode. Verify multi-tab editing, close/reopen, keyboard navigation, drag/drop, editor restoration and side panels.
2. **Persisted layout recovery:** migrate existing workspaces that contain split editor groups to one group without losing open documents, dirty buffers or Source content. Make the migration idempotent and versioned.
3. **Preview Host foundation:** contribute the right-side WebviewView; add the versioned active-document / snapshot / action message contract and lifecycle tests.
4. **Procedure migration:** move the existing Procedure canvas first and prove Source navigation, live updates, selection, bounded mutations, Undo / Redo and stale-message rejection.
5. **Contract / Predicate / Schema migration:** reuse existing projections and mutation contracts in the same Preview Host.
6. **Markdown migration:** add the pinned renderer, security adapter, Package-local navigation and real bidirectional scroll acceptance.
7. **Retire placement workarounds:** remove second-column `openWith` calls, native Markdown Preview pairing, duplicate-tab cleanup and Source-only active-editor normalization after all visualizers pass parity.
8. **Release:** merge only after exact-head Theia build, real Chromium acceptance and existing regression suites pass. Pages changes take effect only after merge to main and the main deployment workflow succeeds.

## Acceptance gates

### Theia shell

- Exactly one Main Editor group exists; split commands and drag/drop cannot create another.
- Multiple Source files remain ordinary tabs in that group.
- Opening / switching among Procedure, Contract, Predicate, Schema, Python, ordinary YAML, JSON and Markdown never creates an EditorGroup.
- Existing persisted split layouts recover non-destructively.
- Explorer, Package Explorer, Outline, Problems, Output, Inspector, menus, themes, keyboard navigation and native file operations remain functional.

### Preview lifecycle

- Exactly one Preview view identity and one active provider exist.
- Preview is auto-revealed once for a new browser profile; hiding it and reloading the same profile keeps it hidden, while manually reopening it remains a native Theia view action.
- Switching tabs and editing Source updates the same Preview view without creating tabs or losing the Source's native editing state.
- Unsupported files show a neutral empty state.
- Source navigation always opens in the single Source group.
- Stale messages and mutations are rejected by URI + version + generation.

### Visual parity and Markdown

- Procedure / Contract / Predicate / Schema visuals preserve current behavior and source-navigation accuracy.
- Markdown Source remains native; Preview is rendered in the same right-side view as all other visualizers.
- Security tests cover raw HTML, images, same-Package links, traversal, encoded separators, symlinks, unsafe schemes, external links, ambiguous roots and out-of-Package files.
- Real Chromium user-like scroll gestures verify both Source-to-Preview and Preview-to-Source synchronization.
- Markdown links update the current Source tab and the same Preview view.

### Regression and release

- Unit tests cover shell binding, layout migration, message versioning, active-document switching, provider lifecycle, stale-selection rejection and renderer security.
- Exact-head Browser-only Theia build and real Chromium acceptance pass.
- Existing Compiler, LSP, Package Audit, semantic-token, Package Explorer and Source Patch suites remain green.
- No Pages deployment is performed from the feature branch.

## Explicit non-goals

- Replacing Theia, Monaco or the native Source editor.
- Rewriting the Skill language, Compiler, Runtime, Package ownership or Source Patch model.
- Forcing desktop VS Code to prohibit user-created editor groups.
- Introducing a second filesystem, generic IDE shell or preview-owned document persistence.
- Treating a successful visual projection as Compiler qualification or Runtime execution success.
