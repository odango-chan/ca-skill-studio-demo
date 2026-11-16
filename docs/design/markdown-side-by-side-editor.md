# Native Markdown Side-by-Side Editing

**Status:** Accepted · Native VS Code Markdown extension is the default Theia implementation.

## Default workbench layout

- Every `.md` and `.markdown` file opened from the native Explorer or Package Explorer is paired automatically with the built-in, read-only Markdown Preview.
- A Markdown editor restored as the active document when the extension starts receives the same pairing.
- The editable **Source is always on the left** (editor group one); the native **Preview is always on the right** (editor group two).
- If a Markdown Source is opened while another editor group is active, the integration normalizes it back to the Source-left / Preview-right layout.
- Opening another Markdown document uses the same two positions; it must not reverse Source and Preview or create a second Studio-owned Markdown renderer.
- Source remains the only document authority. Native Preview consumes the current Source document, including unsaved edits, and owns its normal preview lifecycle.

The Studio extension owns only the integration boundary:

- automatic pairing and stable editor-group placement;
- the shared SKILL Studio theme through `contributes.markdown.previewStyles`;
- exact Package-root inventory and symlink checks through `markdown-link-policy.mjs`;
- fail-closed handling for missing/ambiguous Package roots and unsafe Package-relative links.

The pinned built-in `vscode.markdown-language-features` extension owns Markdown parsing, rendering, the read-only Preview and its lifecycle. Do not reintroduce the retired Studio-owned renderer into the Theia/VS Code path.

## Security and boundaries

- Raw HTML remains disabled.
- Remote images and arbitrary resource fetches remain unavailable.
- Package-relative links are resolved only against the exact, pre-inventoried Package file set.
- Symlinked Package roots and descendants are rejected.
- `lib/` and `output/` protection, Skill semantics, Compiler/LSP behavior, Procedure Designer and Runtime behavior are unchanged.

## Scroll behavior

The native Markdown Preview owns scroll synchronization. The native preferences `markdown.preview.scrollEditorWithPreview` and `markdown.preview.scrollPreviewWithEditor` remain enabled. Automated acceptance verifies the preferences and current viewport state; it does not synthesize user scroll gestures or claim that bidirectional scrolling has been manually accepted.

## Verification

- Unit tests cover Package-local link containment, symlink rejection, and both registered Markdown extensions (`.md` and `.markdown`).
- Real Theia Chromium acceptance opens more than one Markdown document through the normal editor-open path and verifies that each editable Source tab is in a separate, left-side editor group from its right-side Preview tab.
- Existing native Preview theme, unsaved-edit refresh, security and Language Server acceptance remain in force.
