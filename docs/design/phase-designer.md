# D4 Phase Designer · Runtime-used Step Authoring

**Status: A1 and bounded A2.1 Accepted (Studio editor only); A2.2/A3/A4 Proposed · Date: 2026-11-04**  
**Implementation: A1 merged; A2.1 implemented in PR #17; A2.2/A3/A4 NOT_STARTED**  
**Acceptance: A1 230 tests + Chromium PASS; A2.1 238 tests + real Chromium PASS; Runtime/5GC NOT_RUN**  
**Tracking: [Issue #15](https://github.com/odango-chan/ca-skill-studio-demo/issues/15)**

## Model and visual hierarchy

Only authored Procedure business Nodes belong to the React Flow main graph. `preconditions` (准备) and `postconditions` (确认) are ordered Step details inside the owner Node Inspector, **not extra business Nodes**. Source YAML and its actual Step indexes, Operator fields, `with` bindings and `on` branches remain the authority. Do not invent another graph model or new Skill syntax.

## Slices

| Slice | Bounded behavior | Must not do |
|---|---|---|
| D4-A1 | Existing Step `with.<key>.from` rebind between **same-Procedure declared `input.*` of the exact same declared `type`** | No new Steps/Bindings, output refs, Step name/operator edit or Phase `on` mutation |
| D4-A2.1 | Switch between two already-observed spellings of the identical earlier named Step output under the same Node | Exact producer, output suffix and ordering fixed; no new refs, cross-Node relinking or field type inference |
| D4-A2.2 | Other producers/fields, cross-Node outputs and Step metadata | Needs actual owner output shapes, dependency ordering, consumer ABI/type contracts |
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

A2.2/A3/A4 remain NOT_STARTED; neither A1 same-type inputs nor A2.1 observed spellings imply full Runtime binding qualification.

## A1 actual acceptance

[PR #16](https://github.com/odango-chan/ca-skill-studio-demo/pull/16) contains the bounded Source patch and Inspector editor; [CI #41631114017](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41631114017) verified 229/229 tests, TypeScript, build, and Chromium, including the selected CreatedSession preparation Step, exact Diff, cancel, Apply, Undo/Redo, and Source restoration. Later [CI #41631247083](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41631247083) passed unit/type/build but its Chromium could not start the DevTools debugging port (runner environment); that failure must not be represented as a browser-test assertion PASS. Final A1 [CI #41631580489](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41631580489) passed 230 tests, typecheck, build and real Chromium; [PR #16](https://github.com/odango-chan/ca-skill-studio-demo/pull/16) merged as `a07e441`; [Pages #41631903456](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41631903456) succeeded.

## D4-A2.1: observed same-producer reference spelling (PR #17)

Only an existing Phase Step `with.<key>.from` referencing a uniquely named **earlier Step of the same Node** is eligible. Both `preconditions.<step>.output[.field]` and `<own-node>.preconditions.<step>.output[.field]` (or a correspondingly earlier postcondition) must already appear as plain `from` values in the **same Procedure's YAML Source**. The selected producer Step, Phase, Node, output field suffix and consumer binding key cannot change. Forward references, self-references, cross-Node/Procedure values, renamed/duplicate producers and unobserved aliases fail closed.

UI keeps the Step in its owning Inspector section, never a main graph node. Exact Source span patch → reparse and graph identity check → original YAML Diff → confirmation → Undo/Redo. The real CreatedSession `nudm-sdm-subscribe.preconditions.steps[1].with.selection.from` is the positive specimen; both local and own-node-qualified forms already occur in that root Procedure. These are **observed syntax alternatives, not proved Runtime aliases**. No field type, consumer ABI or 5GC result is inferred. [PR #17](https://github.com/odango-chan/ca-skill-studio-demo/pull/17) [CI #41755713730](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41755713730) verified 238/238 tests, TypeScript, build and real Chromium (selection, exact Diff, cancel, Apply, Undo/Redo, Source restoration). Merge requires this final document-only commit to pass too. All broader D4-A2.2 cross-producer and A3/A4 authoring remains deferred.
