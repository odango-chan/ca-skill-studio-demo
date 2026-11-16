# Historical UX Consolidation · superseded

**Status: Deprecated · Date: 2026-11-03**  
**Canonical current workbench:** [Authoring Workbench](../design/authoring-workbench.md)  
**Current implementation:** [WORK](../WORK.md), [TRACEABILITY](../TRACEABILITY.md)

**Historical note:** The following early single-file/read-only/View-menu/Chromium-NOT_RUN phase was superseded by real sample Package navigation, D2 limited Visual edits, direct toolbar controls and tested Chromium interactions. It is preserved as an early UX decision record. Do not implement against its old assumptions; update the canonical Workbench instead.

---

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

## 2026-11-03 · UX Trim / Information hierarchy

After the first UX Consolidation, the UI still duplicated metadata across a header, editor title, breadcrumb, status bar and Inspector. This pass deliberately **removes visible information rather than hiding safety-critical state**:

- One filename and one dirty flag, both in the top bar. Export remains explicitly a browser download, not an in-place save.
- One compact editor toolbar for current Procedure, Visual / Source / Split and View controls; no separate editor-title and breadcrumb rows.
- The left side keeps one real file plus nested procedures. Node outline and example choices are collapsed until requested. No unsupported virtual Package files.
- Inspector shows only phases and route lists that actually occur in the selected Node. No empty phases, stage serial numbers, duplicated Operator identifier or permanent read-only disclaimer; context header retains the edit-eligibility label.
- No always-visible Problems zero row. Parse errors and STALE projection still surface warnings; original Source is never overwritten by a visual projection.
- No decorative footer, ELK success counter or sample provenance headline in the editing area.

**Not changed:** YAML AST/CST source authority, route identity and outcome source, deterministic ELK graph, guarded two-route ensure Patch, diff preview, shared Undo/Redo, and CreatedSession Visual read-only boundary.

The change is covered by static UI integrity and existing parser/patch/layout tests. Real browser interaction and visual regression remain **NOT_RUN**.
