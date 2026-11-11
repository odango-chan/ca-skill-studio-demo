# Markdown Side-by-Side Editing Experience

**Status:** Implementation proposal landed with the Markdown editor integration PR; final CI and browser acceptance are authoritative.

## User experience

- Opening `SKILL.md` or a Package-local Markdown Reference opens the native editable Source document in editor column one and its read-only Markdown Preview in column two.
- Source remains the only document authority. Preview consumes the current `TextDocument.getText()`, including unsaved edits.
- The preview is created once. Source changes are debounced briefly and delivered as `updatePreview` Webview messages; the host does not replace `webview.html` for every keystroke.
- A compact Preview toolbar offers a single-pane toggle for narrow workspaces. It moves the Preview into the Source editor group; toggling again restores the split. The command palette/editor title also exposes the layout toggle.
- Classic light/dark heading accents use the shared theme color `skillStudio.markdownHeading` (light `#0c8e7b`, dark `#83d9c4`). Static Classic rendering falls back to the existing `--accent` token. H1/H2 use the accent; H3 gets a restrained accent rail; lower levels remain readable foreground text.

## Source mapping and synchronized scrolling

The Markdown renderer adds `data-source-line` to rendered block elements. The value is the original, zero-based source line, including the lines removed from the visible Front Matter projection. Headings retain their stable in-document IDs.

- Native Source visible-range changes send the first visible line to Preview.
- Preview scroll events find the first visible mapped block and ask the host to reveal the corresponding native Source line.
- Programmatic scrolls are suppressed briefly on both sides to avoid feedback loops.
- Live preview replacement preserves the first visible source-line anchor and its viewport offset instead of resetting to the top.

This is line/element mapping, not percentage-based scroll approximation. Blank lines resolve to the closest preceding rendered block; table rows and list items also carry their own source line.

## Security and boundaries

- Raw HTML remains escaped by the existing renderer.
- Remote images, remote script execution, arbitrary fetch, and inline source-provided styles remain unavailable.
- The only Webview script is nonce-protected and handles local Package navigation, preview updates, scrolling, and the layout toggle.
- The extension host continues to verify Package-local paths, file inventory, file type, and symlink boundaries before opening a target.
- `lib/` and `output/` protection, Skill semantics, Compiler/LSP behavior, Procedure Designer and Runtime behavior are unchanged.

## Verification

Unit coverage checks original line mappings, safe rendering, paired editor columns, live updates, bidirectional scroll messages, layout toggling, and oversized-source fallback. Real Theia Chromium acceptance checks the actual Webview, shared CSS, heading accent, source-line anchors, TOC and Reference navigation.
