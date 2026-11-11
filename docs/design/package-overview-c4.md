# C4 — Package Overview

## Integration and browser evidence

C4 is implemented on PR #133, targeting `main`. The earlier C1–C3
visual-editor PRs and the two-Skill samples in PR #129 have been integrated.

A fully passing **exact-head baseline** was recorded on
`04614d92b96b44686c14c8960b9ccc96d3e6b573` (2026-11-11):

- IDE Host Spike: PASS.
- Skill Studio pull-request verification (tests, typecheck, build, Chromium
  smoke): PASS.
- Theia Browser-Only real Chromium: PASS.
- Theia Browser Host real Chromium: PASS.
- Both real Theia hosts emitted
  `STUDIO_PACKAGE_OVERVIEW_TWO_SKILLS_CHROMIUM`: two Skills / 27 files,
  traditional 5GC 22 files and MAS 5 files, both with 3/3 Assurance core.
- The browser acceptance expanded both Packages and their Assurance groups,
  opened each Package's own Contract Designer with its **exact Source URI**,
  and checked native TreeView child-provider reads.
- Original Workbench, Evidence, Inspector, Procedure, Python/YAML Source and
  designer regressions ran before the C4-specific acceptance.

Later changes to mouse interaction, Explorer navigation, and regression
coverage must also pass all four workflows on **the same final PR head**
before merge. These checks are not replaced by successful tests on the
earlier baseline. Pages deployment follows integration into `main`.

The Package view remains an inventory and navigation aid only; neither
these browser tests nor the displayed core-file counts certify Compiler
qualification, Runtime readiness, authorization, or live 5GC execution.

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
   incomplete Packages in one workspace. The two-owner
   `site/samples/skills/` workspace from PR #129 is integrated; both Skills
   must also pass exact-URI Contract navigation in real Theia Chromium.
5. Changing an open file without changing the scan roots must not cause
   needless native Package-tree rebuilds or discard expansion state.
