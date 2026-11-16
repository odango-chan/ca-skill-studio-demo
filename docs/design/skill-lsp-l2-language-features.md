# Skill Studio LSP · L2-C language navigation

**Scope:** add exact, source-backed language features on top of L2-B's real
browser Worker. This is an incremental language-service upgrade, not a
compiler/DSL rewrite.

## Design decisions

1. **Keep the existing analyzers as the semantic source.** YAML Procedure
   projection, script navigation and bounded Python outline remain the same
   read-only analysis. LSP handlers project their results; they do not invent
   a second parser or duplicate Skill rules.
2. **Make ranges exact before enabling navigation.** Convert YAML CST node
   ranges and lexical Python declaration spans to JavaScript UTF-16 offsets.
   Only those exact ranges may become LSP Definition/References locations.
   Legacy line-only findings stay diagnostic-only.
3. **Bind all cross-file results to one complete Package generation.**
   `packageContextComplete` must be true for cross-file definition and
   references. Partial Packages may still provide same-document Python
   DocumentSymbols, but no guessed cross-file links.
4. **Keep Source ownership in the extension host.** The LSP server is
   read-only. Rename and source mutations are not in this slice; future edits
   must continue through validated native WorkspaceEdit proposals.
5. **No Python type checker in this phase.** Python support is exact top-level
   symbol outline and SKILL metadata navigation, not Pyright/Pylance semantics.

## LSP capabilities in this slice

- `textDocument/definition`: Procedure/Predictate script path → exact script
  metadata name; Python input/output Schema metadata → exact Schema title.
- `textDocument/references`: all exact caller/reference sites for the selected
  script or Schema target, respecting `includeDeclaration`.
- `textDocument/hover`: source-backed script path, declared tool name,
  Schema title/path, or exact top-level Python class/function.
- `textDocument/documentSymbol`: exact top-level Python classes/functions.
- `textDocument/completion`: Package-local `scripts/*.py` paths after a
  Procedure `script:` value and unique Schema titles after supported
  `inputSchema:` / `outputSchema:` metadata keys.

No rename, semantic tokens, full YAML Schema validation, Python type checking,
or Runtime validation is claimed.

## Negative guarantees

- No Definition/References when a token range is missing, ambiguous, stale or
  belongs to an incomplete Package.
- Duplicate script tool names or duplicate/missing Schema titles do not create
  navigation targets.
- Python duplicate top-level names remain non-navigable.
- A Package generation or document version mismatch invalidates all returned
  locations before they reach the client.
- LSP completion is context-limited and does not auto-insert guessed imports,
  scripts or schemas.

## Acceptance

- Unit tests prove exact offsets for CRLF, Unicode and multiline YAML.
- Browser Worker protocol tests exercise Definition, References, Hover,
  DocumentSymbols and Completion over real LSP messages.
- Theia browser-only Chromium smoke verifies the browser LanguageClient remains
  READY and that the new providers do not regress CustomEditor, Inspector,
  Source, Undo/Redo or Package Audit.
- Existing main-site/Skill Studio tests remain unchanged and pass.

No PR merge or Pages deployment is included.
