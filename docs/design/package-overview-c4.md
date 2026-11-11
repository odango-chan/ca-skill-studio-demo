# C4 — Package Overview

Status: implementation complete; final exact-head CI and real Chromium
acceptance are in progress. PR #133 now targets `main` and includes the
latest Contract / Predicate / Schema Designer integration.

Current verification head: `6546927847ef0e13671f477568841aa3ca3d5924`.

- Package inventory unit tests cover multiple roots, nested roots, incomplete
  packages, dirty counts, bounded scans, and exact file-kind routing.
- The real Theia acceptance now opens the two shipped sample Skills in one
  Workspace: traditional 5GC (22 files) and MAS (5 files).
- Chromium acceptance checks both Package rows, each Package's Assurance
  group, exact Contract URI routing for both Skills, and TreeView child reads.
- The previous Browser Host run exposed a separate Evidence-tree test issue:
  the Phase group could remain collapsed after its root appeared. The test now
  explicitly expands that parent before asserting the nested dataflow row.
  The corrected exact-head run is pending; no merge is authorized yet.

The pull request remains draft until all four exact-head workflows pass.

## Purpose

Add a package-oriented inventory view to the existing Skill Studio activity bar.
This is not another file Explorer and not another Package Audit.

- Native Explorer remains the ordinary workspace file tree and file creation surface.
- Existing Package Audit remains the source of its bounded editor diagnostics.
- Package Overview discovers multiple Skill roots in the active Workspace and
  groups their existing files by role.
- File rows open the already-owned visual editor for Procedure, Contract,
  PredicateSet and Schema; Python, Markdown and other files remain native Source.
- Dirty count comes from currently open TextDocuments. It is a convenience
  indicator, not a saved-state or filesystem consistency guarantee.

## Discovery and grouping

A candidate Package root is a parent directory containing either `SKILL.md`
or one of the assurance core files:

- `assurance/contract.yaml`
- `assurance/procedure.yaml`
- `assurance/predicates.yaml`

This intentionally keeps incomplete Packages visible. Nested Package roots
are assigned to the nearest (longest matching) root, so a nested `SKILL.md`
does not inflate its parent Package's counts.

Groups are `Skill Definition`, `Assurance`, `Schemas`,
`Scripts`, `References` and `Other`. Assurance displays existence of
the three core files. Missing core files are explicit placeholder rows.

## Boundaries

- Inventory only; no YAML parsing, semantic validation, Compiler qualification,
  Runtime readiness, capability authorization or 5GC execution claims.
- Bounded workspace scan: first 1,000 files. If the result exceeds the bound,
  the view explicitly says the inventory may be incomplete.
- No Source writes. Clicking a row opens the matching Designer or native Source.
- Existing Package Audit and diagnostics remain the only owner of current
  editor audit findings.
- Package Overview is provider-backed and intentionally has no `viewsWelcome`
  contribution. Theia can materialize a welcome widget before the extension
  provider activates; that stale child can prevent the real TreeView provider
  from replacing it. The provider owns its loading/empty state.
- No duplicate Package Session, no new language-service parser, and no
  changes to Procedure graph, LSP or Source Patch authority.

## Acceptance

1. Pure inventory tests: multiple packages, nested roots, missing core files,
   dirty counts, file-kind routing, bounded scan and TreeView parent chains.
2. Extension contribution test: Package view and refresh action are present
   in the same Theia extension bundle.
3. Real Theia Chromium: current owner sample appears, groups show exact
   Assurance / Schema / Script / Reference counts, and the existing Procedure,
   Contract, Predicate, Schema and native Source flows remain intact.
4. Unit fixtures verify multiple independent Skills, nested Package roots and
   incomplete Packages in one workspace. Real-browser multi-package acceptance
   remains pending: PR #129 (the two-owner `site/samples/skills/` workspace)
   is still open and has not been integrated.
