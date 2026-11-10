# C5 — Skill Guide & Reference Navigation

**Status:** Implementation branch; exact-head validation pending  
**Base:** `main@fb869df8e773e5beb2e8a2f166ced95eeb1d8f6e`  
**Owner:** SKILL Studio authoring UI

## Goal

Give the two current Skill samples a useful, source-faithful visual reading experience for
`SKILL.md` and `references/*.md`, without turning natural-language guidance into a
second machine workflow.

C5 extends the existing safe Markdown preview. It is not a new editor model and does not
change the authoritative Markdown document.

## Included

- Build a compact section outline from Markdown headings and add in-document anchors.
  Fenced code blocks are excluded from the outline.
- Recognize explicit package-file references in Markdown links and inline-code path
  literals, such as `references/session-selection.md` and `../SKILL.md`.
- Make those references host-mediated links. The extension host resolves the path against
  the active Skill root, rejects absolute paths, traversal outside the root, unsupported
  extensions, missing files and directories, then opens the target through the normal
  editor association.
- Markdown targets open the existing Markdown preview. YAML, Python and JSON targets use
  the normal `vscode.open` route, allowing an installed visual editor association to own
  the file when available.
- Refresh the preview from the current unsaved TextDocument.
- Keep raw HTML escaped, images non-fetching, external links restricted to HTTP(S) and
  mailto, and the Webview behind a nonce-based Content Security Policy.

## Explicit boundaries

- The preview is read-only. Native Source remains the only edit/save authority.
- A heading is document structure, not a business step or execution dependency.
- A path link means only that the current Markdown source explicitly names a file. It
  does not imply that the target is loaded, required, preloaded, trusted or executable.
- A repository-level link such as `../../docs/...` is not a Package-local link.
- No automatic reference loading, no `read_reference` invocation, no model decision,
  no Procedure reconstruction, no semantic validation and no Runtime/5GC execution.
- Scripts deliberately do not receive a second custom visual editor in C5. The existing
  Browser LSP already owns Python Document Symbols, Definition and References; Script
  files remain native Source with LSP navigation.

## Current sample coverage

| Package | SKILL guide | References | C5 expectation |
| --- | --- | --- | --- |
| `establish-pdu-session` | Present | 3 Markdown files | Guide links to each explicit reference; a reference can link back to `SKILL.md` |
| `establish-pdu-session-mas` | Present | None | Guide renders without inventing a reference group |

## Acceptance

1. Root unit tests cover heading outline/anchors, fenced-code exclusion, duplicate heading
   labels, local path literals, relative Markdown links and unsafe/escaping paths.
2. Both owner-pinned Skill guides render safely from the current `site/samples/skills/`
   tree.
3. Real Theia Chromium opens the conventional Skill guide, follows a local reference,
   returns to `SKILL.md`, and verifies the MAS guide does not fabricate references.
4. Existing Procedure, Contract, Predicate, Schema, Source and LSP acceptance remains
   unchanged.
5. The host must reject a forged Webview message that attempts to leave the active
   Package, even if it bypasses renderer-side path filtering.

C5 is independent of the still-stacked C1/C2/C3/C4 visual-editor integration. It is based
on current `main` so the Markdown and LSP improvements can be reviewed without retargeting
those earlier branches.
