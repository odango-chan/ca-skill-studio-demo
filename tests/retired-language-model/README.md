# Retired authoring-model tests

The `*.retired.mjs` files in this directory's parent are historical tests for the removed Procedure authoring model (`procedures`, `call`, `verify`, `with`, `preconditions`, `postconditions`).

They are deliberately excluded from `node --test tests/*.test.mjs`. They are not a compatibility suite and must not be re-enabled by restoring an old parser or Server.

The current editor contract is the single current CA-SL grammar: top-level `start` / `nodes`, current Node stages, current PredicateSet and current Contract. Older source must be analyzed by that grammar and reported as ordinary source diagnostics. No migration or automatic rewrite is performed.

Current equivalents for these editor operations (Stage editing, current graph layout/focus, and source-backed Node/Route mutations) must be implemented and tested against current CA-SL before they are reintroduced. Until then, unsupported mutations must fail closed and must not alter source.

The retired files remain as historical design/test references only.
