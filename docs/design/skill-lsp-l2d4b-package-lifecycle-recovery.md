# Skill Studio · L2-D4b Package lifecycle and explicit Language Worker recovery

**Status:** Design / acceptance contract only. Stacked on L2-D4a (#120); no implementation is claimed by this document.

## 1. Why D4b follows D4a

L2-D4a now proves that a real browser Language Worker can terminate, the host independently detects the dead transport, the status becomes `SKILL LSP: UNAVAILABLE`, and native Source editing remains available without writing transient edits to disk.

D4a intentionally does not recover the Worker, clear all stale LSP diagnostics after abrupt termination, or prove Package switching and close/reopen races. These are separate lifecycle responsibilities and must not be inferred from D4a's PASS.

## 2. Scope

D4b contains two tightly related capabilities:

1. **Package lifecycle isolation:** prove that active Package sessions, diagnostics, generations and references remain isolated through Package switching, multiple open Procedure editors, close/reopen, and stale in-flight analysis.
2. **Explicit Worker recovery:** provide a user-triggered restart after terminal failure. Do not add an uncontrolled automatic retry loop. Recreate one Worker, clear only diagnostics owned by the failed LSP client, and rehydrate every still-active Package from its current open TextDocuments and disk snapshot.

No Runtime, Python execution, Package mutation, deployment or 5GC behavior is in scope.

## 3. Package lifecycle contract

### 3.1 Identity and ownership

- Package identity is its canonical root URI; two different roots must never share an analysis result or diagnostic owner.
- The host's `languagePackages` entry is reference-counted by attached Procedure editors. Closing one of multiple editors must not close the Package session while another reference remains.
- The final release invalidates pending host refresh tickets, disposes Package event subscriptions, sends one close notification, and removes the host state.
- A subsequent reopen creates a fresh host Package state and fresh server session. Old in-flight work from the closed session must not republish diagnostics or analysis into the reopened Package.

### 3.2 Generation and result rules

- Package generations are monotonic within one live host Package state. Every open/change/close/create/delete/rename event that affects its contents supersedes earlier snapshots.
- Server-side session reset/dispose must invalidate in-flight analysis before clearing its published diagnostics.
- A result is publishable only if it still belongs to the current session instance, Package root and requested generation. An old result may not win merely because a reopened Package restarts a local generation counter.
- Closing Package A must clear only A's LSP diagnostics and must not clear Package B's diagnostics.
- Opening or switching to B must not cause Definition, References, Hover or Document Symbols for A to be answered from B's snapshot, or vice versa.

## 4. Explicit recovery contract

### 4.1 User control

- Recovery is user-triggered after `SKILL LSP: UNAVAILABLE`, via a discoverable command (and a status-item action if consistent with existing UI conventions).
- No timer, document edit, Package open or heartbeat failure may silently create repeated Workers.
- Recovery is single-flight: concurrent user requests share one restart operation; at most one replacement Worker may exist.
- If restart fails, preserve `UNAVAILABLE` with a concrete reason and leave native YAML/Python editing available. Do not retry automatically.

### 4.2 Replacement sequence

1. Snapshot the set of still-active Package roots and their host reference counts.
2. Stop/dispose the terminal LanguageClient and its Worker. Clear only diagnostics demonstrably owned by that client; do not clear Package Audit, YAML/Python parser, or unrelated extension diagnostics.
3. Create one fresh LanguageClient/Worker and complete LSP initialization plus the read-only health handshake.
4. For each still-active Package, collect a fresh snapshot using current open TextDocuments as the authority for dirty buffers and persisted bytes for closed files. Assign a generation newer than every generation previously issued for that Package in the current host lifetime.
5. Send snapshots to the new Worker and await the matching root/generation result. `READY` is accepted only when the complete Package and its component analyses are actually READY; genuine missing files remain `PARTIAL` / `UNAVAILABLE`.
6. Publish current diagnostics and navigation only after matching-generation acceptance. Old Worker results and diagnostics must not reappear.
7. If any Package fails, report the exact Package and reason; do not silently downgrade all other active Packages.

### 4.3 Unsaved Source safety

- Recovery must never save or rewrite user Source.
- Open dirty TextDocuments must be captured byte-for-byte from their current editor buffers and passed to the new Worker.
- Disk bytes must remain unchanged throughout recovery.
- A failure during recovery must not discard, reload or replace the user's dirty editor buffers.

## 5. Diagnostic ownership audit (exact pinned SDK)

The Browser LSP client package pins `vscode-languageclient@9.0.1` in its own lockfile. The matching upstream `release/client/9.0.1` source has been inspected:

- `LanguageClient.diagnostics` is a **public getter** over the client's own diagnostic collection ([client.ts](https://github.com/microsoft/vscode-languageserver-node/blob/release/client/9.0.1/client/src/common/client.ts#L673-L675)).
- The collection is created by `start()` if absent ([client.ts](https://github.com/microsoft/vscode-languageserver-node/blob/release/client/9.0.1/client/src/common/client.ts#L1060-L1085)).
- `cleanUp('stop')` disposes that collection and sets its reference to `undefined` ([client.ts](https://github.com/microsoft/vscode-languageserver-node/blob/release/client/9.0.1/client/src/common/client.ts#L1420-L1448)).
- The `CloseAction.DoNotRestart` path calls `cleanUp('stop')`; `ErrorAction.Shutdown` calls `stop()`, which also performs that cleanup ([client.ts](https://github.com/microsoft/vscode-languageserver-node/blob/release/client/9.0.1/client/src/common/client.ts#L1590-L1630)).

**Implication:** when the SDK's connection error/close path runs, it already disposes only the LSP client's own diagnostic collection. Do not add a broad URI-based clear and do not touch the Workbench's separate `diagnostics` collection (which may contain host-owned diagnostics).

**Remaining D4b question:** D4a's independent heartbeat timeout calls the host's fatal callback, but does not itself guarantee the SDK enters `stop()`. D4b must make the silent-termination path converge on SDK-owned stop/cleanup safely, without double-stop races, and add a real Chromium assertion that stale LSP diagnostics disappear while Package Audit / unrelated host diagnostics remain intact. The SDK source audit is complete; lifecycle behavior still requires tests.

## 6. Acceptance matrix

| Scenario | Required evidence |
|---|---|
| Open Package A, then B | Both roots have distinct accepted generations and correct diagnostics |
| Switch B → A | A's current analysis is restored; no B result is visible under A |
| Two Procedure editors for A | Closing one reference does not close A's session |
| Close final A editor | A's diagnostics and analysis are cleared; B remains untouched |
| Reopen A while an old analysis is delayed | Old A result cannot publish into the new A session |
| Abrupt Worker termination | D4a terminal failure remains visible; no automatic restart |
| Explicit restart with dirty A and B buffers | Exactly one new Worker; both current snapshots rehydrated from dirty buffers; disk unchanged |
| Restart failure | Remains UNAVAILABLE; no retry loop; Source remains editable |
| Successful recovery | New health handshake; current generations accepted; only current diagnostics republished |

All race tests must use controlled delayed analysis / deterministic barriers where possible, not timing-only sleeps. At least one full real Chromium test must cover Package switch, close/reopen, actual Worker termination, explicit restart, and dirty-buffer preservation. Unit tests alone do not qualify the browser lifecycle.

## 7. Out of scope / later

- Node/Desktop LSP transport parity (separate workstream).
- Automatic background restart or exponential retry.
- Full editor lifecycle and Package switching in the classic non-LSP workbench.
- Runtime admission, execution or any real 5GC operation.
- Pages deployment or merge to `main`.

## 8. Delivery sequence

1. Audit the exact language-client diagnostic ownership and lifecycle APIs.
2. Add deterministic session-level race tests for root/generation/close/reopen.
3. Add host-level Package reference-count and switch tests.
4. Implement explicit single-flight restart and diagnostic clearing only after ownership is proven.
5. Add real Chromium recovery acceptance with dirty buffers and two Packages.
6. Keep the PR stacked on #120 and Draft until exact-head four-workflow CI plus the real browser matrix pass.


## 9. Implementation progress · L2-D4b

The first implementation slice is now on the stacked code branch (acceptance still pending):

- **SDK cleanup:** Worker `error` / `messageerror` and silent health-timeout failures now converge on the pinned LanguageClient's `stop()`. The SDK disposes its own public diagnostic collection; the Workbench Package Audit collection is never cleared by this path.
- **Generation continuity:** the host retains the last issued generation per canonical Package URI across final close/reopen, preventing a newly opened Package from reusing a generation that an old notification could carry.
- **Status isolation:** server status notifications are accepted only for the currently active host Package instance and its exact current generation.
- **Explicit recovery:** a single-flight `SKILL Studio: Restart Language Service` command (also attached to the UNAVAILABLE status item) stops the failed client, creates one new Worker, snapshots every still-active Package, and waits for each matching generation. No automatic restart loop is added.
- **Dirty-buffer recovery probe:** real Theia acceptance prepares an unsaved Python metadata change, restarts the Worker, verifies that the replacement Worker's native Hover reflects the unsaved value, verifies persisted bytes remain unchanged, then restores the original Source.
- **Diagnostic ownership probe:** real LSP Procedure diagnostics are published before Worker termination. A separate host-owned Package Audit diagnostic marker must survive SDK cleanup while the LSP collection is disposed and its diagnostic disappears.
- **Server Package isolation test:** the browser LSP Worker test now opens two Package roots, closes A, proves B's diagnostics remain, reopens A with a higher generation, and then closes B independently.

**Still required before D4b can be called complete:** run exact-head CI and real Chromium acceptance; add/verify host-level editor reference-count close/reopen behavior and multi-Package recovery in Chromium; add deterministic stale-in-flight session coverage where a controllable analyzer can be injected. The current implementation slice does not claim those remaining gates.
