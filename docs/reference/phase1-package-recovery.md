# Phase 1 · Package Inventory and Crash Recovery POC

**Status: 23 focused offline tests PASS. Full repository integration: NOT_RUN.**

## Goal

Host Skill artifact identity covers every file under the Skill root, including opaque assets that Studio does not edit. Sequential updates to Contract, Procedure and Predicate are not a single atomic filesystem commit.

## New components

**package_guard.py** captures a read-only inventory of all package files, including binary and opaque files. It records relative paths, SHA-256 content hashes, and observed POSIX metadata. Symlinks, hardlinks, nonregular files and unsafe paths are rejected. Its fingerprint is Studio-specific, **not the Host canonical_digest**. A directory scan is an observation, not an atomic OS snapshot.

**recovery_batch.py** provides an opt-in wrapper for the existing workspace.save_batch. The caller supplies the package snapshot taken when the workspace opened. The wrapper checks for changes to managed files and to all opaque files, then writes a durable recovery intent **outside the Skill Package**. The private directory must be owned by the current user, mode 0700 and on the same filesystem. The intent contains path and old/new content hashes only, not source payloads. Normal completion verifies the target hashes and removes the intent. Failed or interrupted writes retain the intent when the disk state is uncertain.

An unresolved recovery intent blocks a further save using this wrapper.

## Recovery states

| Status | Meaning |
|---|---|
| NOT_APPLIED | All managed targets still match the old version |
| PARTIAL | Some targets match old, others new |
| ALL_NEW_UNCONFIRMED | All targets match new hashes; durability and save acknowledgment are still unproven |
| DIVERGED | A target is missing/other, or an unrelated package file changed |

Inspection **never** automatically rolls back, replays, deletes, or merges file contents. The user must review and resolve the state explicitly.

## Tests actually run

In a local isolated Python test directory:

- 15 package inventory, symlink/hardlink rejection, and intent classification tests.
- 8 recovery wrapper tests using a stub batch writer, including success, preflight rejection, opaque drift, partial commit, uncertain all-new state, and KeyboardInterrupt.
- Total **23 passed, 0 skipped**; Python compile check PASS.

The existing repository's **92 previous tests were not rerun together with these new tests**. Do **not** claim 115 PASS. The integration of the wrapper with the actual repository workspace.save_batch remains NOT_RUN.

## Limitations

- The recovery wrapper is opt-in; existing save entry points are not automatically redirected.
- Package preflight is separate from the underlying batch lock, and does not prevent external edits between checks.
- Sequential multi-file replacements remain visible to outside readers.
- Old single-file storage adapter still creates an in-package temporary file; it must be changed or disabled before a production UI.
- No durable rollback, native Windows support, full metadata preservation, automatic file watcher, or crash-safe multi-file atomic commit.
- The complete pinned ca-agent-demo make verify and Runtime acceptance were not run.

**Next gate:** run tests against the real save_batch in a complete checkout with fault injection, then unify single-file staging and strengthen the package transaction boundary.
