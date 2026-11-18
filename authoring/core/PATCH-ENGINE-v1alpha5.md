# CA-SL v1alpha5 Semantic Patch Engine

This Host-owned source patcher is restricted to the pinned CA-SL v1alpha5 Procedure target.

## Scope

- Writes only `assurance/procedure.yaml`.
- Reads the live unsaved TextDocument and verifies document URI/version, Package generation and SHA-256 source digest.
- Generates minimal YAML source edits; it never serializes the entire Procedure document.
- Computes atomic Change Set groups and materializes only explicitly accepted groups.
- Re-parses the candidate before returning it.
- Never writes files, auto-saves, invokes Compiler / Runtime / Tools, or applies a WorkspaceEdit.

## v1alpha5 Node-entry Wait

Wait is control before the first declared business stage, not a fifth stage. A Wait-bearing Node must still contain at least one of the four business stages.

The local patcher validates:

- `wait.event` has exactly the non-empty `source`, `service`, and `operation` selector fields.
- `wait.timeout` is a positive fixed-duration ISO-8601 string in the v1alpha5 lexical subset (days and/or ordered hours/minutes/seconds; no zero, leading zeros, fraction, week, calendar month or year).
- Optional `wait.response` contains only optional `after`, which must name a declared Node.
- `wait.routes` contains exactly `TIMEOUT`, targeting another declared Node or `FAILED`, `UNRESOLVED`, or `SAFE_STOPPED`. `SUCCEEDED` and `EVENT_RECEIVED` are forbidden.

Supported Wait operations:

- `node.wait.set`
- `node.wait.event.set`
- `node.wait.timeout.set`
- `node.wait.timeout-route.set`
- `node.wait.response.set`

All Wait field edits for one Node are one atomic group. A complete Wait replacement may replace comments inside the Wait mapping; leaf-level edits preserve adjacent comments and unrelated source bytes.

## Explicit validation boundary

The patcher does not resolve the selector against trusted Ingress Operation exports, prove correlation registration before a triggering Operation, construct `armInputSchema`, prove the Wait control-flow graph, perform path-sensitive `wait.output` availability / type checks, validate response-boundary post-dominance, or qualify a protocol response mapping. These are authoritative v1alpha5 Compiler / trusted Integration responsibilities.

The published Compiler v1.0.0 is v1alpha4-only and must never be used for a v1alpha5 candidate. Compiler PR #38 is the sole v1alpha5 integration candidate. It consolidates WP1–WP8 but remains CANDIDATE_PARTIAL; until the inherited static pipeline is complete, the candidate Check state remains BLOCKED / NOT_RUN rather than PASS.
