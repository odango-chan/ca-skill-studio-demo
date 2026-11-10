# Skill Studio LSP · L2-D3a · Unsaved cross-file editing in real Theia

**Scope:** Browser-Only Theia with actual Chromium. This is an editor acceptance slice, not a new analyzer or Runtime implementation.

## Exact native acceptance

1. Use the loaded `establish-pdu-session` Package. Open `assurance/contract.yaml`, `assurance/predicates.yaml`, and `scripts/select_establishment_configuration.py` in native Theia Source editors.
2. Require clean initial disk and editor buffers. Apply a temporary `WorkspaceEdit` to each without saving; change Python `# name:` metadata twice consecutively.
3. Wait for READY of the *current* Package generation (matching the latest generation in the status tooltip). No fixed delay is a readiness oracle.
4. Require the snapshot to include all three dirty TextDocuments with their current versions and actual unsaved text. Confirm the persisted bytes of every file still match the original.
5. Query public `vscode.executeHoverProvider` from the Procedure's script declaration. It must show only the **latest** unsaved Python metadata name, not the superseded name.
6. Restore all three buffers byte-for-byte by native `WorkspaceEdit`, require a new READY generation, confirm the on-disk Source remained unchanged, verify Hover reverted, and refocus the Procedure CustomEditor before Inspector/Undo.
7. Preserve all existing L2-D1 Definition / Hover / References / Symbols / Completion and L2-D2 Problems diagnostics/repair gates, as well as existing graph/Inspector/Undo/Route regressions.

Browser evidence marker: `STUDIO_LSP_UNSAVED_CHROMIUM`. The three non-browser CI workflows remain required. Source and document lifecycle must be tested through real Theia, never by calling a Worker test shortcut.

## Explicit exclusions

- This first slice does **not** cover creation of an unsaved new Package file; `untitled:` URI association, new Source identity and close/reopen need a separately justified L2-D3b acceptance.
- This slice does **not** claim Node/Desktop LSP parity, Worker crash recovery, switching Packages, or stale diagnostics after close. Those are L2-D4.
- Language Core and LSP remain read-only; the test harness exclusively owns temporary writes. No Python execution, Pyright/Ruff, rename/refactor functionality, Runtime/5GC operations, Pages deployment or main merge.
- Do not mark L2-D3a PASS until exact-head **all four** CI gates pass, including actual Chromium with its new `STUDIO_LSP_UNSAVED_CHROMIUM` evidence.
