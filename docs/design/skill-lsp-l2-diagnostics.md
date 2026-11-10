# Skill Language Service · L2-A versioned diagnostics bridge

**Status: Implementation candidate; validation evidence belongs to the PR.**  
**Scope:** shared language analysis → LSP-shaped diagnostics and a disposable
snapshot session. This is **not yet** a running LSP server or Theia Worker.

## Intent and boundary

This slice follows [Skill Language Service](skill-language-service.md) and
reuses `language/core/index.ts` from PR #103. It deliberately does **not**
modify `site/workspace.mjs`, `site/package-audit.mjs`, Theia `workbench.mjs`,
VS Code extension files, existing Visual Patch logic, or the formal Skill DSL.

### Versioned diagnostic contract

- The host supplies one complete Package snapshot per candidate analysis:
  current unsaved open text overrides persisted file text.
- Within a Package session, `generation` must increase. Each open
  TextDocument must advance its version when its contents change. Disk-only
  files can use version zero and may change between generations.
- An older asynchronous result is discarded when a newer generation arrives.
  `reset()` invalidates outstanding work and publishes empty diagnostic sets
  for the old Package. `dispose()` also prevents reuse.
- Files in another Package cannot be analyzed in the current session without
  an explicit reset. The shared core still validates Package URIs.
- A diagnostic maps only to a document with a matching relative path and
  version in the validated analysis. Unknown URI and malformed ranges are
  reported as unlocated findings, never placed on guessed text.
- Exact source offsets are JavaScript UTF-16 units; line-only warnings use
  a zero-width location at the start of their actual line. CRLF and Unicode
  offsets must be tested.
- Package Audit UNAVAILABLE is shown as an explicit warning anchored at the
  Procedure file start **if that source document exists**, never as zero
  problems. This anchor is a file-level status, not a claimed source-token span.
- Clearing diagnostics omits `version` rather than supplying a stale version.

### Next integration

L2-B will implement the **official** `vscode-languageserver/browser` Worker
and matching browser client, using this layer only for diagnostic facts/session
gating. Theia 1.76 static Pages compatibility needs real Chromium evidence,
including Worker load, rapid edits, close/reopen, Package switch, cancellation,
same-origin resource loading and explicit failure fallback.

Do not describe the current module as an LSP server: it is a pure TypeScript
transport-neutral precursor. No completion/hover, Runtime validation, Python
type analysis, Tool execution or 5GC operation is provided.

## Tests

`tests/skill-lsp-session.test.mjs` exercises diagnostic spans, CRLF/UTF-16,
unlocated failures, partial audits, concurrent stale generations, document
versions, cross-Package reset/disposal and failure-state cleanup. Existing
shared core and Theia regressions must continue to pass. CI/PAGES PASS is
only recorded after those checks actually complete.
