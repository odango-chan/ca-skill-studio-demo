# Skill Studio LSP · L2-D2 live Problems diagnostics

**Scope:** prove that Language Core diagnostics reach the real Theia Problems collection when a Package Source changes, and are cleared after the Source is repaired. This is an editor diagnostic lifecycle acceptance slice, not a new validator.

## Host matrix

- **Theia Browser-Only / Pages:** use the browser Worker and require SKILL LSP: READY for a complete Package.
- **Backend-backed Theia:** retain the Node extension-host path. Do not require the browser Worker status gate.
- **IDE Host / desktop package:** existing package/build and host regression gates remain required; this slice does not introduce a desktop LSP transport.

## Real editor acceptance

The real Chromium smoke uses the loaded establish-pdu-session Package and the public VS Code diagnostics API, then inspects the native Theia Problems panel.

1. Apply a temporary malformed YAML edit to the open assurance/procedure.yaml through a native WorkspaceEdit.
2. Wait for a newer Package generation to reach SKILL LSP: PARTIAL.
3. Require exactly one LSP-owned PROCEDURE_PROJECTION diagnostic from Skill Studio · procedure-projection in vscode.languages.getDiagnostics(uri).
4. Require the native Problems panel to display the malformed YAML diagnostic.
5. Restore the original Procedure Source byte-for-byte through a native WorkspaceEdit.
6. Wait for a newer Package generation to reach SKILL LSP: READY; require the LSP diagnostic to disappear from the VS Code diagnostics collection and the Problems UI.
7. Require no duplicate PACKAGE_AUDIT_UNAVAILABLE / Skill Studio · package-audit publication from the Language Service.

The test-only command splits publication and repair so Chromium can inspect the Problems panel while the diagnostic is live. Its repair phase is called in a finally path by the browser smoke.

## Boundaries

- The Language Core and LSP remain read-only. The test harness owns the temporary edit through the existing native TextDocument / WorkspaceEdit APIs.
- The original Procedure text must be restored exactly, even when an assertion fails.
- Package generation and diagnostic source/version identity remain authoritative; fixed sleeps and stale diagnostics are not accepted as evidence.
- Package Audit remains separately owned by the existing workbench path; Language Service diagnostics must not duplicate it.
- No Python type checking, linting, formatting, script execution, Runtime validation, Source qualification, or 5GC operation is introduced.
- This slice does not claim complete unsaved cross-file lifecycle, rapid edit/close/reopen races, or Worker failure recovery; those remain subsequent L2-D acceptance work.

## Acceptance evidence

- Exact-head Browser-Only Chromium must log STUDIO_LSP_DIAGNOSTICS_CHROMIUM with publication, repair, and native Problems clear evidence.
- Existing Definition / Hover / References / Document Symbols / Completion, Procedure CustomEditor, Inspector, native Undo, Route authoring, and Classic/workbench regression gates must remain green.

## Native Problems view identity (Theia 1.76)

Theia markers supplies the built-in Problems widget with id `problems` via `ProblemContribution` and the command `problemsView:toggle`. Skill Studio separately contributes an activity-bar view named `skillStudio.problems` based on its own Package Audit/Procedure projection tree. The latter is **not** the LSP marker widget and does not display LanguageClient `publishDiagnostics`. Chromium acceptance opens the built-in widget when hidden, requires a nonzero visible widget rectangle, and checks that widget's own text for the malformed YAML diagnostic. A hidden, zero-sized tab or global body-text heuristic is not accepted as evidence. The exact command/id is grounded in Eclipse Theia 1.76 source (`packages/markers/src/browser/problem/problem-contribution.ts`).
