# Skill Studio Language Service · Shared Session Architecture

**Status:** one current CA-SL analysis pipeline, accepted in IDE Host, Theia Browser Host and Theia Browser-Only Chromium workflows.

## Product invariant

Skill Studio has one authoritative Language Service implementation:

- one current CA-SL source grammar in `language/core/source.ts`;
- one Package analyzer in `site/package-audit.mjs`;
- one generation-safe `LanguageDiagnosticSession` in `language/lsp/session.ts`;
- one `analyzePackageSnapshot` pipeline in `language/core/index.ts`.

There is no version-selected Server, legacy analyzer, old grammar fallback, automatic downgrade or migration-on-open. Every Package is analyzed with the current grammar. Old or malformed source produces ordinary source diagnostics from that grammar. API-version metadata may itself be diagnosed, but never selects an analyzer.

## Runtime adapters

The host runtime changes only how the shared session is invoked. It does not change parsing, linking, diagnostics or qualification semantics.

```text
VS Code / Theia extension host
  ├─ Source-owned workspace IO
  ├─ bounded Package snapshot collector
  │    ├─ unsaved TextDocuments override persisted bytes
  │    ├─ max 500 files, 1 MiB per text file, 4 MiB aggregate text
  │    └─ incomplete enumeration/read remains explicit
  │
  ├─ Browser runtime
  │    └─ vscode-languageclient/browser
  │         └─ dedicated Worker transport
  │              └─ LanguageDiagnosticSession
  │
  └─ Theia backend Node extension host
       └─ LanguageDiagnosticSession in-process
```

Both paths invoke the same TypeScript session and current Package analyzer. The in-process Theia adapter is not a second Server or parser; it is the same session used without a browser Worker when the Node extension host has no browser `Worker`/ `location` globals.

The extension host remains the only owner of workspace IO and Source edits. The Worker cannot access the workspace filesystem and never writes files. The browser LSP advertises `TextDocumentSyncKind.None`; the host sends bounded Package snapshots through `skillStudio/packageSnapshot`. `skillStudio/packageClose` disposes the Package session and clears published diagnostics.

## Package analysis and diagnostics

Each accepted Package generation runs the same pipeline:

1. parse Contract, PredicateSet and Procedure using the current CA-SL grammar;
2. produce the current source projection and exact source locations;
3. run current Package checks for Script, Schema, dependency, Capability, Tool and Evidence references;
4. preserve unqualified trust/runtime checks as explicit `NOT_CHECKED` or blocked findings;
5. publish one authoritative diagnostic set to Problems and editor markers.

The Browser Worker publishes LSP diagnostics. The Theia Node host publishes the same session diagnostics through its native DiagnosticCollection. Both feed the same Problems tree, including Package-relative file path and line. YAML scalar ranges cover the complete source span; line-only findings do not receive invented editor locations.

Source-analysis readiness and Package qualification are separate. A source-ready Procedure can report Language Service `READY` while Package qualification remains `UNAVAILABLE` because dependencies, trusted Owner/Capability declarations or Compiler evidence are absent. This is not a Worker failure and must not suppress source diagnostics.

## Generation and lifecycle

- `skillStudio/packageSnapshot`: one Package snapshot with exact root URI, Package name, monotonically increasing generation, completeness and bounded document text/version records.
- `skillStudio/packageClose`: closes one Package session and clears diagnostics.
- `skillStudio/analysisStatus`: reports source readiness, component states, generation and unlocated findings.
- `skillStudio/serverError`: reports transport/request failures only; source defects remain diagnostics.

The client refreshes snapshots after unsaved text changes, document open/close and workspace file create/delete/rename events. A debounce coalesces bursts; the session rejects out-of-order generations and stale open-document versions. The explicit Package Audit command waits for the requested generation to be accepted before returning.

## Implementation and acceptance

The semantic analysis and generation-safe session are TypeScript (`language/core`, `language/lsp`). The VS Code extension and thin transport adapters are ESM JavaScript. The Browser Worker and Node extension-host adapter contain no duplicate Skill semantics.

Acceptance covers:
- current source diagnostics, completion, hover, definition/references and document symbols in the browser Worker host;
- the same Package Audit findings, Problems items and exact editor markers in the Theia Node extension host;
- current-grammar diagnostics for historical/malformed source without `UNSUPPORTED_CA_SL_VERSION` or a compatibility analyzer;
- independent Package errors and `NOT_CHECKED` reasons across all Package files;
- generation ordering, close/reopen cleanup and stale-result rejection;
- no automatic migration or mutation of user source.

A successful editor analysis is not Compiler, Owner, Capability, Deployment or Runtime qualification.
