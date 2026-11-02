# ADR-0006 · Package Consistency and Explicit Crash Recovery

- Status: Proposed (POC only)
- Date: 2026-11-02
- Scope: Skill Studio local source editing

## Decision

Treat the complete Skill Package file tree as the observed consistency boundary, even though Studio edits only model-context and execution-related assets.

For sequential saves of multiple existing files, record intended old/new hashes in a private, durable **outside-package** journal before replacements begin. On failure or restart, inspect the actual files and present NOT_APPLIED, PARTIAL, ALL_NEW_UNCONFIRMED or DIVERGED. Never silently restore or overwrite files.

## Reasoning

The Host artifact digest includes opaque files. POSIX os.replace offers single-path atomic replacement, not atomic multi-file visibility. An automatic rollback could destroy external changes, while placing journal or lock files inside the Skill root changes artifact identity.

## Limits and consequences

This design does not provide a kernel compare-and-swap, an atomic whole-package snapshot, crash-proof multi-file commit, or cross-process reader coordination. The Studio fingerprint does not impersonate the Host canonical digest.

Only the isolated POC is currently tested; real backend integration, native Windows/WSL2 checks, stage cleanup and an honest recovery UI remain acceptance gates.
