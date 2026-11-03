# D4 Phase Designer · Runtime-used Step Authoring

**Status: Proposed · Date: 2026-11-03**  
**Implementation: A1 candidate / PARTIAL · Acceptance: NOT_RUN until verified CI**  
**Tracking: [Issue #15](https://github.com/odango-chan/ca-skill-studio-demo/issues/15)**

## Model and visual hierarchy

Only authored Procedure business Nodes belong to the React Flow main graph. `preconditions` (准备) and `postconditions` (确认) are ordered Step details inside the owner Node Inspector, **not extra business Nodes**. Source YAML and its actual Step indexes, Operator fields, `with` bindings and `on` branches remain the authority. Do not invent another graph model or new Skill syntax.

## Slices

| Slice | Bounded behavior | Must not do |
|---|---|---|
| D4-A1 | Existing Step `with.<key>.from` rebind between **same-Procedure declared `input.*` of the exact same declared `type`** | No new Steps/Bindings, output refs, Step name/operator edit or Phase `on` mutation |
| D4-A2 | Extended authored source/producer bindings and Step metadata | Needs owner-qualified output identity, ordering, type, producer/consumer input compatibility |
| D4-A3 | Step create, delete and reorder | Requires reference/dependency impact analysis for named Steps and `preconditions.<step>.output`, without graph-node inflation |
| D4-A4 | Phase-specific `on` Route authoring | Must separate `preconditions.on` / `postconditions.on` from `operator.on` and use owner Outcome eligibility |

D4-A1 reads the Procedure's authored `inputs.<key>.type` (string, integer, number, boolean, object, array) to build a **conservative editor-only choice set**. This does not mean that a same-type input is semantically appropriate for a specific Tool/Script/Verify consumer. No Runtime qualification is inferred.

## D4-A1 source patch contract

1. Reparse the **current** YAML 1.2 document and resolve `procedureId / nodeId / phaseName / steps[stepIndex] / with.<key>.from`. AST/CST source coordinates are mandatory.
2. Existing `from` must be a plain scalar `input.<key>` declared by this Procedure, and the alternative must have an equal declared type. Output refs, missing/quoted/aliased/anchored scalars and unknown Phase structures are Source-only.
3. Modify **only the original scalar bytes**, preserving comments, Step order, names, Operators, Route identities, Child Procedures and all unrelated Source.
4. Reproject; compare all Procedure/Node/Step/Child/Route signatures and requalify the changed binding. Display an exact Source Diff to be explicitly confirmed before writing the working copy.
5. Recompute the patch on Apply, validate full Source revision and preview integrity, and record in the standard Undo/Redo history.
6. Only Source editing is available for unsupported/ambiguous references. Error reporting never marks a Runtime action as safe or successful.

## Required acceptance

- Positive: real CreatedSession `nudm-sdm-subscribe.preconditions.steps[0].with.dnn.from`, another declared `string` input, exact source isolation, Diff cancel / Apply / Undo / Redo.
- Negative: mismatched/unknown input, another Procedure's input, invented output paths, absent Phase/Step/binding, quoted or aliased scalar, duplicate YAML keys, stale or forged preview, CRLF and inline comments.
- Browser: expand owning Node's 准备 Step, select qualified input, Diff/cancel/Apply/Undo/Redo and verify main graph's Node count unchanged.
- Gates: unit/negative tests, TypeScript typecheck, build and real Chromium browser interactions. No Runtime/5GC operation or qualification will run.

A2/A3/A4 are intentionally NOT_STARTED; do not generalize A1's input-type equality into a full Skill Runtime binding validator.
