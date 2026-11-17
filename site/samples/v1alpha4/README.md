# CA-SL v1alpha4 candidate examples

**Status: DRAFT / NOT_QUALIFIED.** This directory is a pinned review snapshot of
[ca-skills PR #58](https://github.com/odango-chan/ca-skills/pull/58) at
`33664aec7ebc9bb1764618f839d01b7493425429` (2026-11-17). PR #58 is still open and draft; this is not
the official `ca-skills/main` release.

## Source boundaries

- `skills/` in the Example project remains the official 5GC reference snapshot
  from `ca-skills/main@dfba05071cb33424c475e00a325712f5273a19de`. It is Legacy v0.2 / v1alpha1.
- `examples/v1alpha4-candidate/` contains the two separate migration examples
  from PR #58. They are not promoted into `skills/`, not qualified packages,
  and not evidence that Compiler v1.0.0 can build every dependency.
- The candidate uses SUPI-based identity and does not depend on Host-created
  `ueRef`. The MAS example is retained as a reference, not an E2E qualification claim.

## Wait status

The Node-level Event Wait semantic baseline was merged in
[ca-skills PR #60](https://github.com/odango-chan/ca-skills/pull/60).
Follow-up normative clauses remain draft in
[ca-skills PR #61](https://github.com/odango-chan/ca-skills/pull/61).
This snapshot is pinned to PR #58 and does **not** claim to include or execute
the final Wait revision. Compiler v1.0.0 also predates that later Wait work.
Do not translate the candidate into newer Wait syntax until the normative
contract and Compiler support are released together.

## Qualification boundary

The candidate does not include the complete trusted Owner ToolCatalog,
CapabilityContracts, output Schema, Evidence Descriptor and product
qualification chain required for an executable release. The Compiler must
fail closed when those publications are missing. A successful YAML parse is
not a qualification result.

Refresh this snapshot only from a reviewed immutable upstream commit.
