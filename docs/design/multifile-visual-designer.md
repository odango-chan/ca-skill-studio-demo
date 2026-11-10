# Multi-file Visual Designer · parallel workstream

**Status: Proposed / Contract projection spike; 2026-11-10.**  
Owner: Skill Studio editor (not Skill DSL, Runtime, Agent Host or 5GC).

## Problem and objective

The default Theia custom editor currently recognizes only
`assurance/procedure.yaml`. Other files are edited in the native
Source editor; current Inspection, Evidence and Package Audit do not constitute
dedicated visual designers.

Build a source-first, **file-kind-aware** family of views that can navigate
real references across Skill Package files, without inventing a second Skill
definition. Visual representation is optional and must degrade to native Source
whenever interpretation is unsafe.

This is deliberately independent from the ongoing Theia Classic feature parity
and LSP / browser Worker tracks. It must not block them.

## Ownership and parallel integration

| Track | Owns | Must not be rewritten here |
| --- | --- | --- |
| Theia parity | Procedure custom editor, native Inspector, Phase/Route editing, UI host | Existing custom editor registration and workbench implementation |
| LSP / language core | diagnostics, references, completion, worker message/version protocol | Worker, code-index authority, Monaco/Theia language provider |
| Multi-file views | new Contract/Predicate/Schema projection, view-specific rendering and tests | Common editor history, language service, Procedure AST authority |
| Shared (integration-only) | extension manifest, command registrations, cross-file navigation | Small reviewed integration PR after each view is isolated |

Initial SPIKE code is limited to `site/contract-projection.mjs`
and `tests/contract-projection.test.mjs`. It does **not** register a custom
editor or change the Pages build. No claim of a usable visual UI is made at
this stage. This division protects concurrently open LSP PRs.

## File view architecture

| Package source | Visual view | Stage |
| --- | --- | --- |
| `assurance/procedure.yaml` | Procedure / Node / Phase / Route graph | Existing |
| `assurance/contract.yaml` | Contract summary cards: identity, entry, inputs, allowed resources, postconditions, failure policy | C1 |
| `assurance/predicates.yaml` | Predicate list and Observation → scope/freshness → evaluator relation | C2 |
| `schemas/*.schema.yaml` | JSON Schema field tree, types, required / constraints and reference navigation | C3 |
| `SKILL.md` and `references/*.md` | Markdown preview with navigation, read-only relationship map | C3 |
| `scripts/*.py` | Function outline and verified caller links, native Source remains primary | C4 |

Do not force every file into a flowchart. There should be common navigation,
selection, source reveal, Problems and status semantics, not a single universal
graph model.

### Package Overview (later)

A read-only landing page may group Contract, Procedure, PredicateSet,
Schemas, Scripts, SKILL.md and references. Relationship edges must be
backed by exact references in current Package source. It may not suggest
execution order for SKILL.md, infer business authorization, or create a
separate global workflow.

## C0 read-only projection contract (this PR)

`projectSkillContract(source)` accepts the current **unsaved** document text.
It parses YAML 1.2 using the same yaml package as Studio, and returns:

- `READY`: recognized `SkillContract` document; known summary fields carry
  exact source path and line.
- `PARTIAL`: known fields can be shown, but unprojected top-level/spec
  extensions must be surfaced and the full source remains available.
- `SOURCE_ONLY`: parse failure, unrecognized version/kind, explicit tags,
  anchors/aliases, or input too large. Never show the last-known-good view
  as though it represented the current source.

Read-only projection is **not** validation. READY does not imply that the
entry Procedure exists, a Capability is installed, an Effect is authorized,
a Predicate can return PASS, or any Runtime/5GC work succeeded. Cross-file
reference checks should call existing editor-tier audit or the eventually
shared language core; do not reimplement those rules here.

### Fields projected in the experiment

- Metadata name, Skill type and goal
- Entry Procedure, request Schema
- Required facts, capabilities, local tools
- Postcondition predicate/expect references
- Max actions, dynamic procedure flag, reconcile requirement

This is a selective summary. Nested optional sections not projected here
are still represented by original Source and must not be treated as absent
or semantically valid. C1 should expand partial/unsupported section display
before introducing any writable fields.

## C1 Contract Designer host integration (follow-up PR)

- Register a **distinct** Theia/VS Code file-kind editor for Contract, never
  broaden the existing Procedure selector to all YAMLs.
- Honor user editor association preferences; enable direct source opening
  and native editor split. Default association is an explicit UX decision
  gated by real Theia Chromium tests.
- Render cards and lists from the live TextDocument; projection is keyed
  by URI and document version; a stale result must not survive an edit.
- Selecting an entry/referenced resource reveals its true current source
  range and offers a link to an existing Procedure, Schema or Predicate
  only if the reference resolves uniquely.
- No visual writes in C1. C1 authoring may be proposed later with exact
  CST source spans, reviewed Diff, host recomputation, explicit confirmation,
  native WorkspaceEdit/Undo, and version conflict refusal.
- Use the **shared** source/semantic API once LSP is stable; in the interim,
  only read current document text and avoid competing diagnostics.

## C2 Predicate Designer

A Predicate contains an Observation source plus scope/freshness and a CEL
or Script evaluator. Show these elements as a local read-only relation
diagram; distinguish a declaration from current observed evidence.
Never label a static Predicate preview as actual PASS/FAIL/UNKNOWN.
Exact reference navigation must work with unsaved Procedure/Contract files.
Alias/unknown fields fall back to Source, preserving author intent.

## C3/C4 and reconciliation with owner Skill

- Add Schema field tree with actual JSON Schema draft support, recursive
  references and cycle/size guards. Never infer that arbitrary YAML is JSON Schema.
- Keep SKILL.md an LLM-facing business guide, not another deterministic graph.
  `assurance/procedure.yaml` is the deterministic execution definition.
- Use the latest compatible owner Skill files for fixtures with an explicit
  pinned source SHA. Do not auto-update or mutate Agent Host from Studio.
- Replace stale demo snapshots only in a separately reviewed fixture PR,
  since the existing sample pins an earlier Agent Host commit.

## Acceptance gates

1. Test recognized Contract, multiline comments, source line navigation,
   postconditions and capability lists without mutating bytes.
2. Reject duplicate keys, parse errors, aliases/anchors/tags, wrong kind or
   version, oversized source and stale document version.
3. On unknown extensions show PARTIAL + path + Source action; do not claim
   complete visual coverage or silently erase fields.
4. C1 real Chromium: opening Contract in Theia, source split, unsaved edit
   refresh, ambiguous/missing reference handling and back navigation.
5. LSP coexistence: diagnostics/definitions/completions and Worker failures
   continue as before. No competing AST cache or diagnostics owner.
6. Existing Procedure/Node/Phase/Route and ZIP/export remain unchanged.
7. Only after exact-head tests, real browser integration and resulting-main
   Pages success can the corresponding view be marked deployed.

**Current evidence:** the C0 files have been committed for review. Their
test suite, Typecheck, build, Chromium and Pages gates are NOT_RUN here.
No integration to Theia is claimed.


## 2026-11-10 · C0/C1 implementation status (PR #122)

C0 and the first C1 Contract view are implemented on
`feat/multifile-contract-designer-spike`:

- `site/contract-projection.mjs` projects the full pinned v1alpha1 Contract shape:
  Preconditions, Requirements, Postconditions, Dependencies, budget partition,
  fallback Procedure, resources and failure policy.
- Unknown nested fields and malformed known list sections are explicitly
  `PARTIAL`; unsupported YAML / kinds fall back to `SOURCE_ONLY`.
- `experiments/ide-host/vscode/src/contract-editor.mjs` registers a separate, read-only
  Contract Custom Editor. It updates from the live TextDocument version,
  uses nonce-only inline CSS/JS, and refuses stale reference actions.
- Entry Procedure, Schema and Predicate links resolve against current package
  Source and open the native Source editor at the referenced line. The Contract
  page never writes Source.
- The extension manifest registers `skillStudio.contractPreview` and the
  `skillStudio.openContract` command; Theia browser preferences associate
  `contract.yaml` with this view. Procedure remains a separate editor.
- Unit tests cover projection, full Contract sections, unknown fields,
  editor registration, live document refresh and stale message rejection.
- `workbench-browser-acceptance.mjs` now has a real Theia Chromium assertion
  for the rendered Contract cards and actual `establish-pdu-session` package
  values. It is only evidence when run against the real Theia host with
  `THEIA_REQUIRE_WEBVIEW=1` or `THEIA_URL`.

The PR workflow now includes IDE-host changes and bundles the Node, VS Code
Web and Theia browser extension artifacts. Its resulting run is the C1 build
gate. The actual Contract page browser assertion remains **NOT_RUN** until the
real Theia browser acceptance is executed; the existing generic Chromium smoke
does not substitute for it.

C2 Predicate Designer and C3 Schema Designer remain follow-up stages. No
visual authoring mutations, Runtime qualification, LLM planning or 5GC
execution semantics are introduced by C1.
