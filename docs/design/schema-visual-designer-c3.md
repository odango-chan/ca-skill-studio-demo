# C3 — Schema Designer (stacked on PR #122)

Status: implementation awaiting exact-head tests and real Theia Chromium verification.

## Scope

Build a separate read-only Custom Text Editor for Skill Package files matching
`schemas/*.schema.yaml`. Procedure, Contract and Predicate each keep
their own editors; arbitrary YAML remains in native Source. This is part of
the Multi-file Designer track and must not modify the LSP browser Worker,
Procedure graph/patch authority or Runtime/5GC business semantics.

- Visualize explicitly declared JSON Schema Draft 2020-12 only.
- Project an expandable, searchable field tree using the current unsaved
  TextDocument, with source lines, types, required flags, enum/const,
  numerical/string/array constraints and object nesting.
- Represent `$defs`, `items` and `additionalProperties` without inventing nodes.
- Show literal `$ref` and follow **verified** document-local JSON Pointers or
  sibling files in the same Schema directory. Never fetch schemas over
  HTTP, registry protocols or other network URLs.
- Do not recursively expand refs, so cycles cannot generate an infinite graph.
- Exact pointer resolution uses RFC 6901 unescaping, current target Source,
  duplicate-key refusal and explicit source-line reveal.
- Unknown, unsupported or future keywords become a visible PARTIAL report,
  with YAML Source available intact. Malformed YAML, unsupported drafts,
  anchors, aliases, explicit tags and size/depth overflows yield SOURCE_ONLY.
- Only read: no validators, Source writes, auto-fix, workspace mutation or
  claims that a declared request Schema is accepted by an Agent Runtime.

## Files

- `site/schema-projection.mjs`: bounded source-backed projection and
  document-local pointer resolver.
- `experiments/ide-host/vscode/src/schema-editor.mjs`: independent Theia /
  VS Code Custom Editor and safe native Source navigation.
- `tests/schema-projection.test.mjs`: real Skill fixture, nesting,
  constraints, refs, cycles and fail-closed input tests.
- `tests/schema-editor.test.mjs`: registration, live revision refresh,
  stale message refusal, and sibling reference restrictions.
- VS Code/Theia manifests and Plugin staging: scoped file association and
  contribution, without changing existing visual editor selectors.
- `workbench-browser-acceptance.mjs`: real backend-hosted Theia Chromium
  probe of owner `establishment-request.schema.yaml`, required flags, nested
  `sst`, bounds and const.

## Tests and evidence requirements

1. Root `npm test`, typecheck, build, extension bundling, Chromium smoke.
2. IDE-host extension package and old Procedure/Contract/Predicate regression.
3. Browser-only Theia build and Chromium smoke (not a Pages deployment).
4. Backend-hosted Theia real Chromium: `STUDIO_SCHEMA_DESIGNER_CHROMIUM`
   plus existing C1/C2 markers.
5. Explicitly verify only the latest C3 branch HEAD, then review PR for
   conflicts as upstream PR #122 and LSP/UX branches move.

The branch is intentionally stacked on `feat/multifile-contract-designer-spike`.
When PR #122 lands, retarget/rebase C3 after reviewing the resulting main,
then run the same acceptance on the rebased head. Never call an isolated
preview artifact deployed to the public Pages site.
