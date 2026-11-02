# Phase 1 · Workspace polling and batch save POC

**Status: local implementation and regression PASS; non-atomic multi-file save, not production-ready.**

## Product boundary

Only files that participate in actual SKILL model context or Host / Runtime execution are first-class authoring assets. This module works on explicit source paths supplied by the editor; it does not introduce Case, Qualification, Runtime execution, or publishing features.

The previous single-file POSIX save POC remains separate. In particular, its same-directory temporary file may be temporarily visible to Host artifact enumeration; the new batch POC avoids this by requiring an external staging directory.

## New modules

- `packages/skill_studio_poc/workspace.py`
- `tests/test_workspace.py`

### WorkspaceWatcher: caller-driven polling

- Register a nonempty set of already-open `EditorSession` objects with exact disk baselines.
- `poll()` checks only registered paths. This is an explicit **poll**, not inotify, a background task, or a real-time notification service.
- Events: `UNCHANGED`, `CONTENT_CHANGED`, `REPLACED_SAME_CONTENT`, `UNAVAILABLE`.
- Content changes are passed through `EditorSession.observe_disk`: dirty working copy remains intact, conflicting files are blocked from editing/saving until explicit resolution.
- Deleted/unreadable files are marked unavailable, not treated as empty source. Polling after recovery can report the same-content replacement.
- `adopt_saved()` requires all watched files, re-reads each, and refuses dirty/conflicted sessions or mismatched saved bytes.
- A replacement with identical text is recorded but is **not** a content conflict; it may still change file metadata or file ownership.

**Limits:** no automatic event loop, native file watcher, recursive package-tree scanning, durable journal, or guaranteed observation of modifications that happen and revert between polls. Cross-file Host Artifact Digest changes outside registered paths are not automatically detected.

### save_batch: constrained, non-atomic batch

- Requires 2+ existing, absolute source paths sharing exactly one parent directory, matching the intended `assurance/contract.yaml`, `procedure.yaml`, `predicates.yaml` use.
- Requires explicit `package_root` and an **existing private staging directory outside the package**, mode 0700, owned by current user and on the same filesystem.
- Acquires one cooperative POSIX flock on the existing source parent directory. No lock file is created inside the Skill Package.
- Reads all sources, verifies all `EditorSession.prepare_save` preconditions, and stages all changed files before any destination replacement.
- Revalidates all source snapshots immediately before the first replace, then revalidates each source immediately before its respective replace.
- Moves staged files sequentially using `os.replace`, fsyncs destination directory, and acknowledges saved sessions only after the entire sequence succeeds.
- No change to source file layout or source YAML unrelated to the Working Buffers. Unchanged paths retain their inodes.
- Staging outside the Skill Package avoids introducing temporary files into the complete Host Skill Artifact Digest during staging.

**Failure semantics:**

| Point of failure | Guarantee / result |
|---|---|
| Preflight or staging fails | This writer has not replaced any target; stage files cleaned up, sessions unchanged |
| First source check fails before replace | No replacement by this writer; reject and re-observe |
| Failure after one or more replaces | `BatchSaveUncertain(replaced_paths, reason)`; exact paths already replaced are reported, but all paths must be re-read |
| Directory fsync after last replace fails | All renames may have happened; durability uncertain; do not treat as rollback |

This is **not an atomic multi-file transaction**. Readers and uncooperative writers may observe an intermediate partially updated Contract / Procedure / Predicate set. In-process exceptions can be reported, but process crash recovery is not implemented. A lock only serializes cooperating writers; it is not kernel compare-and-swap.

No automatic restoration of old files is attempted after a partial replace: silently overwriting externally modified files would be worse. The UI must block the edited package and require explicit recovery/reconciliation.

## Actual local verification

```text
PYTHONPATH=packages python -m pytest -q -ra
92 passed, 0 skipped, 0 failed
python -m compileall -q packages tests
PASS
```

**21 new tests** cover clean polling, external dirty conflict, same-content inode replacement, deleted/recovered file, watcher baseline verification, three-file saves, clean no-op, global preflight drift/invalid Source, staging failure cleanup, partial second rename, directory sync failure, external race, private/outside staging requirements, different-parent rejection, CreatedSession Source-only, watcher adopt, mixed real ensure Procedure, BOM/CRLF/modes, and only-changed-file replacement.

The tests run in an isolated POSIX temporary directory. They are **not** proof of complete upstream `ca-agent-demo make verify`, Windows-native filesystem behavior, WSL2 mount behavior, multi-directory atomic updates, or Live 5GC.

## Next acceptance gates

1. Real external editor / concurrent processes on WSL2 filesystems, including the case where the writer ignores `flock`.
2. A non-invasive package-wide artifact snapshot/index that detects changes to opaque files without treating them as editor assets.
3. An explicit crash recovery / durable transaction journal **outside the package**, or a different package-level snapshot/swap design that provides stronger multi-file coherence.
4. Integration of actual filesystem events or scheduled polling into UI lifecycle, without hidden background agents in this POC.
5. Direct full `ca-agent-demo` validation on its own pinned checkout.

Keep CreatedSession Transitional Phases Source-only; this work does not grant any new structured-edit eligibility.
