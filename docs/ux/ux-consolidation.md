# UX Consolidation — Authoring-first Single-file Demo

**Status:** Implemented layout simplification on `main`, against the proposed original UX baseline in [draft PR #1](https://github.com/odango-chan/ca-skill-studio-demo/pull/1). **This note does not merge or supersede that PR.**

## Why

The UX V2/V3 iterations accumulated duplicated access paths: node selection → floating Quick Card → Inspector, separate Procedure + Node lists competing with the graph, and always-visible low-frequency graph controls. The editor looked richer while the authoring loop became harder to understand. This iteration removes duplicate paths, rather than adding more views.

## Intended default interaction

1. Open a real Procedure YAML fixture or a local file. Only the currently loaded file is surfaced under **Assets**; the two fixtures came from an `assurance/procedure.yaml` upstream asset.
2. Procedure Outline is nested in the current file context. Node Outline is an **optional collapsed keyboard-accessible list**, not a second permanent navigation rail.
3. Click a Node or Route exactly once → open **one** context Inspector. Close Inspector to return canvas width. Double-click an unambiguous Child Node to enter that Procedure; browser does not pretend Child Procedure creates a new file.
4. Inspector reads in source semantic order: **Preconditions → Main Operator → Postconditions → Routes**, with specific source locations. Low-frequency phases initially collapsed; Source can be opened from each step or Route.
5. Primary toolbar contains Visual / Source / Split and Fit. Layout direction, labels, one-hop focus, and zoom belong to one **View** menu.
6. Problems remains a small diagnostic surface. Not a Runtime validation, execution or publication center.

## Source and edit boundary

- The authoritative working text, YAML AST/CST, ELK layout, existing selective `SetRouteTarget` patch preview/apply, revision guard and shared Undo/Redo **do not change**.
- Procedure/Node/Route data is derived exclusively from the current Source projection; visual grouping does not merge route origins.
- Complex `establish-pdu-session` with five Child Procedures remains **read-only in Visual**. The only authorized Visual modifications remain two fixed ensure failure Route target edits; this is a prototype, not completed Visual authoring.
- Standalone browser file import **does not load a Skill Package**. SKILL.md, Contract, Predicates, Script, Schema and references must not be shown as if opened. Their original multi-file Runtime Asset Explorer and dedicated editors stay a documented future product milestone.
- Export is a browser download, not an in-place file save; no fake SAVED or Validator PASS indication.

## Alignment with original proposed UX

| Item | Original proposed UX | Consolidated single-file demo |
|---|---|---|
| Asset-first Explorer | Runtime-grounded Package tree | **Partial:** only the actually opened asset |
| Procedure navigation | Root/Child independent graphs | Supported |
| Node selection | Direct Inspector | Restored; Quick Card deleted |
| Inspector | Operator, Phases, Routes and source | Read-only source-backed ordered journey, collapsible |
| Graph controls | Secondary to editing | Moved into View menu |
| Visual/Source | Same working copy | Supported (limited Visual Patch) |
| Package assets/editors | SKILL.md, Contract, Predicate, Script, etc. | Not yet implemented; not falsely shown |
| Add/Remove Node, Add Route, Binding editor | Authoring P0/P1 | Not yet implemented |
| Diff, guarded patch, Undo/Redo | Source-preserving | Existing ensure slice retained |
| Local save / conflict handling | Package-aware, in-place Save | Browser download only; not equivalent |

## Guardrails for subsequent UX work

- Do not add another per-node popup or second property panel.
- Do not put low-frequency graph controls back on the main toolbar.
- Don't label passive graph viewing as completed Procedure editing.
- Close the *functional gap* to the original authoring IDE (Package asset handling and qualified editing) before visual ornamentation.
- No separate Validation, Case, Publishing, Registry or Runtime workbench in this phase.

## Verification and remaining gaps

Node/route projections, HTML control wiring, and the unchanged safety checks are covered by automated regression. Visual browser E2E, responsive screenshots, accessibility navigation and real package-level workflows remain **NOT_RUN**, not implied by a successful static site deployment.
