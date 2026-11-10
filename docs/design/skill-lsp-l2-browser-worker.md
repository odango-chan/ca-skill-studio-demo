# Skill Studio Browser LSP · L2-B

**Status:** browser client/server implementation candidate. A successful build and
Node Worker protocol test do not by themselves qualify the real Theia 1.76 Pages
host; live host acceptance remains a separate gate.

## Architecture

```text
Theia / VS Code browser extension host
  ├─ Native TextDocument + workspace.fs (single Source authority)
  ├─ bounded Package snapshot collector
  │    ├─ open unsaved documents override persisted bytes
  │    ├─ max 500 files, 1 MiB per text file, 4 MiB aggregate text
  │    └─ incomplete enumeration/read => PARTIAL / UNAVAILABLE
  └─ vscode-languageclient/browser 9.0.1
       │ JSON-RPC over Worker postMessage
       ▼
    Dedicated browser Worker
      ├─ vscode-languageserver/browser 9.0.1
      ├─ LanguageDiagnosticSession (shared L2-A generation gate)
      └─ Skill Language Core (read-only analysis)
           └─ textDocument/publishDiagnostics
```

The extension host remains the only owner of workspace IO and Source edits.
The Worker cannot access the workspace filesystem and never writes files.
The language server advertises `TextDocumentSyncKind.None`: the host sends
bounded Package snapshots through `skillStudio/packageSnapshot`, avoiding a
second competing TextDocument store. `skillStudio/packageClose` disposes the
Package session and clears its published diagnostics.

## Protocol

- `skillStudio/packageSnapshot`: one Package snapshot with exact root URI,
  Package name, monotonically increasing generation, completeness and bounded
  document text/version records.
- `skillStudio/packageClose`: closes one Package session and clears its
  diagnostics.
- `skillStudio/analysisStatus`: returns READY / PARTIAL / UNAVAILABLE,
  generation and unlocated findings.
- `skillStudio/serverError`: reports transport or request rejection.

The client starts lazily when the visual Procedure editor attaches. It resends
snapshots after unsaved text changes, document open/close and workspace file
create/delete/rename events. A debounce coalesces bursts; the session rejects
out-of-order generations and stale open-document versions.

## Diagnostic ownership

For this integration increment, the LSP server publishes Procedure projection,
script-navigation and Python-outline diagnostics. The existing host-owned
Package Audit DiagnosticCollection remains responsible for Package Audit
warnings. This intentional split prevents duplicate Problems entries while
the old audit UI remains in place. Unlocated or heuristic findings are not
upgraded into exact source ranges.

## Build and dependencies

The client and server use the official browser entry points from the
VS Code LSP SDK, pinned to `vscode-languageclient@9.0.1` and
`vscode-languageserver@9.0.1`. Their isolated package locks are installed
before the IDE spike build. The server is bundled as a classic browser Worker
asset inside the extension distribution. The Theia Pages adapter preserves the
existing repository base path when resolving `hostedPlugin` Worker assets.

## Current limits and acceptance gates

This is the first real LSP transport slice, not a complete language feature
suite. Completion, hover, definition/references, semantic tokens, YAML schema
binding and Python type analysis are not implemented. Exact token ranges must
be added before navigation can be advertised; L1 deliberately marks legacy
line-only references as non-navigable.

The automated Worker test runs the actual browser server bundle in a Worker
GlobalScope-compatible harness and exercises initialize, diagnostics publish
and Package close/clear. This validates the LSP message transport and server
session, but **does not prove nested Worker creation in Theia 1.76's hosted
plugin worker**. Before enabling this on the online editor, verify in the real
Theia Pages host:

1. extension host starts the dedicated Worker from the staged plugin URI;
2. the worker loads under the Pages base path and same-origin policy;
3. Procedure YAML errors appear in native Problems and disappear after repair;
4. edits in open unsaved contract/predicate/Python files refresh the Package;
5. rapid edits discard older generations; close/reopen and Package switch clear
   prior diagnostics;
6. worker failure degrades visibly without blocking native YAML/Python editing;
7. no duplicate Package Audit warnings and no change to Source/Visual Patch
   ownership.

No production Pages deployment, PR merge, Runtime authority or 5GC operation is
part of this slice.
