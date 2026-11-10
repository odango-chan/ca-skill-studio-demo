# Skill Studio LSP · L2-D1 editor integration acceptance

**Scope:** verify the browser Worker LSP through the real Theia browser workbench's public VS Code language-provider commands. This is an editor-integration acceptance slice, not a new analyzer or Source-editing capability.

## Host matrix

- **Theia browser-only / Pages host:** runs the Web extension in the browser and is the supported host for the browser Worker LSP. Its Chromium smoke must set `THEIA_REQUIRE_BROWSER_LSP=1`.
- **Backend-backed Theia host:** retains the current Node extension-host path. It does not require the browser Worker status gate. A separate Node LSP transport is a later, independent host decision; do not force the browser Worker into this host.
- **IDE Host / desktop package:** package/build and host regressions remain required, but a desktop LSP transport is not claimed by this increment.

## Real editor-provider acceptance

The browser-only Chromium smoke uses the real Theia command registry and the public VS Code language-provider commands. It must query the loaded `establish-pdu-session` Package and verify:

1. Definition from the Procedure's declared script path resolves to the exact `scripts/select_establishment_configuration.py` file.
2. Hover returns the declared Skill Script metadata, not a guessed symbol.
3. References from the script's declared tool name include the Procedure caller.
4. Python Document Symbols include the exact top-level `main` declaration.
5. Completion at the declared `# inputSchema` metadata returns the unique Package Schema title `EstablishmentSelectionInput`.

This is deliberately not a direct Worker-protocol test: it proves that the browser Worker, LanguageClient, Theia extension host, and public editor provider registration work together. Empty results, missing commands, ambiguous targets or wrong Package references fail the browser smoke.

## Boundaries

- The LSP remains read-only. All Source writes continue through the existing native editor and validated Source workflows.
- No second YAML/Python parser, Runtime validator, compiler, Tool ABI inference, Python execution, Pyright/Ruff, Rename or Code Actions are introduced.
- The browser-only host must reach `SKILL LSP: READY` before the provider probes run.
- Backend-backed Theia's Node-host behavior is not conflated with browser Worker acceptance.

## Remaining L2-D follow-up

This increment does not yet claim complete live Problems UX. Follow-up acceptance still needs to verify:

- LSP diagnostics appear in the native Problems view after a real Source edit and disappear after repair;
- edits to open, unsaved Contract / Predicate / Python files refresh the same Package generation, including newly created unsaved files;
- rapid edits, close/reopen and Package switching do not leave stale diagnostics or references;
- Worker failure is visible while native YAML/Python editing remains available;
- Language Service diagnostics do not duplicate Package Audit warnings.

No merge, Pages deployment, Runtime qualification or 5GC operation is included.


## Native language selector compatibility

The Theia browser-only host can expose a workspace-backed `.yaml` / `.py` Source document with `languageId: plaintext` when a standalone language plugin does not own that editor. The browser LanguageClient therefore registers providers using both:

- URI-scheme + path selectors for `file` workspace Package sources (`**/*.yaml`, `**/*.yml`, `**/*.py`);
- language selectors for hosts that provide canonical `yaml` / `python` language IDs.

The Package snapshot's bounded extension-to-language mapping remains the analysis input. URI selectors only determine which native documents can invoke the read-only provider; they do not infer DSL semantics or alter Source. The real Theia Chromium probe must still prove that native provider commands resolve exact Package targets.


## References acceptance synchronization

Opening the Python Source document emits a workspace `onDidOpenTextDocument` event and schedules a new Package generation. A fixed sleep is not evidence that the replacement snapshot has been analyzed. The Chromium provider probe therefore waits for the Language Service to return to `SKILL LSP: READY` (with a bounded timeout) before requesting References. It also queries the exact start of the declared `# name:` token. This keeps the acceptance test aligned with the existing generation invalidation contract rather than weakening stale-result rejection.


The readiness check is generation-specific: the probe captures the Package generation before opening the Python Source, requires `onDidOpenTextDocument` to advance it when the file was not already open, and then requires the READY status tooltip to identify that exact current generation. This prevents an old READY status from satisfying the wait before the open-document event is delivered.


## Theia CompletionList result shape

The real Theia 1.76 `vscode.executeCompletionItemProvider` command returns its completion list as `{ incomplete, suggestions }`, while the VS Code API commonly exposes `{ isIncomplete, items }`. The acceptance probe accepts both host result shapes and still requires the exact `EstablishmentSelectionInput` label. The browser run showed the Schema Hover provider already resolved the exact Schema; this was an acceptance adapter shape mismatch, not evidence of a missing Schema index.
