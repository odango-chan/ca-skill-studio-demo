# C3 — Schema Designer (stacked on PR #122)

Status: C3 implemented and accepted on code HEAD 95888d82 (2026-11-10); stacked PR #130 remains unmerged and not deployed.

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


## C3 acceptance evidence (2026-11-10)

Code HEAD `95888d82f0f5ba4ac34832a34fde870020094f27` was validated
with four successful Actions runs:

- PR verification `42793240472`: root tests, typecheck, build and Chromium smoke.
- IDE Host Spike `42793240413`: extension bundle/VSIX and native
  Source/Procedure regressions.
- Browser-only Theia `42793240421`: real Chromium showed
  `STUDIO_SCHEMA_DESIGNER_CHROMIUM` with 13 fields, 11 required
  markers, nested `sst` and `const: IPV4`.
- Backend-backed Theia `42793240436`: same Schema evidence plus
  Contract, Predicate and original Procedure workbench markers.

Two initial failures were corrected before the above code HEAD: canonical
root JSON Pointer formatting and an invalid duplicate-key negative fixture;
then an unattended multi-file Schema QuickPick timeout was resolved by allowing
the command to receive an exact known package-relative Schema path, without
changing the human file-selection behavior.

These results qualify the C3 trial within the scope above, **not** Schema
validation correctness, the latest Agent Host/MAS SKILL schemas, any direct
5GC execution, a merge to main or a public Pages deployment.
