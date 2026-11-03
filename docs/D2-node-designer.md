# D2 Node Designer · source-backed authoring

**Status: Accepted (completed D2 milestone record) · Date: 2026-11-03**  
**Current state:** [WORK](WORK.md) · [TRACEABILITY](TRACEABILITY.md)

此文记录 D2-A1 至 A5 的实现及验收边界；后续 Route/Phase 的拟议能力见 [D3](design/route-designer.md)，不能将 D3 的 Proposed 写成 D2 PASS。

Status: D2-A1 through D2-A5 bounded editing and editor checks implemented. Full Runtime qualification remains out of scope.

## Architecture

- No CreatedSession-specific Node mutator. The same operation accepts any Procedure that currently projects READY.
- YAML Source remains authoritative; React Flow nodes are view objects, never a separate persisted graph.
- D2-A1 RenameNode rewrites exact plain-source spans for the Node mapping key, current Procedure start, inbound Route targets, and explicit from references.
- Each change is recomputed from the complete source revision, reprojected, structurally compared and shown as a Diff before confirmation. Existing Undo/Redo applies.
- Quoted, unsupported or ambiguous references fail closed. Direct Source editing is the escape hatch.
- D2-A5 adds conservative cross-file **editor hints** for Contract, PredicateSet, Procedure and script presence. They are warnings, not Runtime PASS.

## D2 milestones

| Slice | Scope | Status |
| --- | --- | --- |
| A1 | Rename existing Node ID with guarded source reference rewrites | Implemented |
| A2 | Insert typed terminal/call/verify Node onto one existing Route | Implemented · bounded |
| A3 | Delete/merge a same-status terminal or bypass a single-outcome Node, with inbound Route rewrites | Implemented · bounded |
| A4 | Edit existing Node Operator values and existing with.<name>.from scalars | Implemented · bounded |
| A5 | Conservative Package editor hints, 300-Node stress, guarded large-graph layout, recovery and Chromium regressions | Implemented · bounded |

## Acceptance

Run npm test, npm run typecheck and npm run build. In a browser, select a Node, change its ID, preview Diff, cancel or confirm, then Undo/Redo. Verify that Route targets, start and from references remain consistent. Rejected cases must preserve Source bytes.

D2-A1 does not add, delete, copy or reposition Nodes, create Route outcomes, write directly to local files or alter another repository.

## D2-A2 · Route-insert Node

A2 adds an **Insert Node on existing Route** operation for any READY Procedure,
not a CreatedSession-specific mutator. The user selects one real Route in the Inspector.
The editor proposes a fresh Node ID, operator, value and (for nonterminal Nodes)
a single explicit Outcome.

- Terminal: new Node has an existing terminal status and no outgoing Route; the
  chosen incoming Route now terminates there. The former target stays intact,
  although it may become unreachable on this path.
- Call: new Node calls a named operation and forwards its chosen Outcome to the
  original Route target. No invented with/from inputs are added.
- Verify: same as Call, but its Predicate must exist in the current Package's
  PredicateSet with matching skill metadata.
- Only source-backed plain Route targets and block Node maps are eligible.
  The insert is anchored before the first existing Node key, preserving every
  untouched byte. Reprojection checks the exact two intended semantic edits.
- Preview includes both the Node insertion and the old Route target redirection.
  Apply recomputes the preview against the entire Source revision. Undo/Redo
  use existing per-file history; selection moves to the new Node after Apply.

A2 **does not** create a disconnected Node, freely create Routes, bulk edit
Node bindings, guarantee reachability, or validate operation/result compatibility.
Generated Call/Verify specs are structurally well-formed editing scaffolds and
require subsequent author review and the actual Skill/Runtime validators before use.


## D2-A3 · Guarded Node delete (2026-11-03)

Two explicit deletion modes are permitted across any READY Procedure, without
CreatedSession-specific mutation logic:

1. **Merge terminal:** a non-start terminal may be removed only when another
   terminal in the same Procedure has the identical terminal status. Every
   inbound Route to the deleted Node is retargeted to the chosen terminal.
2. **Bypass single-outcome Node:** a non-start, non-Procedure Node without
   preconditions or postconditions, with exactly one operator Route that does
   not lead back to itself, may be removed. All inbound Routes point to its
   sole outgoing target. The removed Node's outgoing Route is deleted as well.

Protection: do not delete the start Node; reject ambiguous/multiple outgoing
outcomes, child Procedure invocations, phase-bearing nodes, references from
any other Node/Procedure including from: node.output, quoted inbound targets,
unsupported indentation, overlaps, incomplete patch preview or changed source
revision. Terminal replacements must have equal status. All untouched Source
text must be preserved; the operation reprojects the whole Procedure file and
checks its complete expected semantic delta. Source Diff preview is mandatory.

Not supported: arbitrary Route rewrites, force-delete, replacements of missing
node outputs, cross-file reference repair, Runtime behavior proof and workflow
publication. In particular bypassing even a single-outcome call **removes that
operation** and requires explicit business review before executing the Skill.


## D2-A4 · Typed Node attributes

The Node Inspector offers two source-bound edits independent of the sample Skill:

- **Operator value**: retains the existing operator *kind*. Call / tool / reconcile
  values accept plain identifier-like names but do not assert that a Runtime
  operation exists. Verify / predicate values must occur in the matching
  Package PredicateSet. Terminal values are chosen from statuses already used
  in this Procedure. Procedure values must name a Procedure in the current YAML,
  with recursion rejected. Script paths are not editable until package-aware
  path checks exist.
- **Existing with.<parameter>.from references**: source entries must already
  be plain scalar values; editing uses a controlled dropdown of existing
  authored references within the same Procedure and declared input.* names.
  No unknown output paths or new with keys are fabricated.

Each edit patches exactly one scalar span and reprojects the full YAML file.
Operator-value edits assert the exact graph semantic delta; Binding edits keep
the graph projection untouched and verify the target Binding's new plain value.
The complete patch is recomputed on Apply, with a Diff and Undo/Redo.
Quoted scalars, stale revisions, forged previews, unrelated structural changes
and unknown Predicate/Procedure targets are refused.

**Not supported:** changing operator kinds, adding/removing/renaming with keys,
editing Phase-step bindings, deep from trees, output shape checking, type-aware
binding compatibility, or Runtime authority/capability checks. These need
source/schema-backed qualification rather than speculative graph changes.


## D2-A5 · Editing safety and large-graph resilience (2026-11-03)

This phase intentionally does **not** introduce the heavyweight Toolchain,
Runtime validation workbench, Case management or publication pipeline.

### Editor-stage package diagnostics

`site/package-audit.mjs` reads the current in-memory files in one workspace:
`assurance/contract.yaml`, `assurance/predicates.yaml` and
`assurance/procedure.yaml`. The source remains authoritative.

The Problems panel shows source-linked warnings for:

- Contract name, PredicateSet skill and entryProcedure identity mismatches;
  missing declared request Schema file.
- Unresolved Contract / Node / Phase-step Predicate names, unmatched Call /
  Tool names relative to declared capabilities and missing referenced script
  paths in the opened Package.
- Explicit missing `input.*` names and unresolved `node.output.*` producer
  identities (not producer output-schema contents).
- A **heuristic** warning when an existing `with.<key>.from` is redirected
  from its matching Procedure input to a different input (e.g.
  `with.ueRef.from: input.psi`). This does **not** prove a type error.

Preview Diff reports the number of newly introduced warnings, without
blocking the authoring action. Warnings are never presented as a successful
Runtime check or as a complete set of semantic defects. Editing an incomplete
single-file workspace does not fabricate companion files. A malformed
Procedure still fails closed through the existing Source parser.

### Large graphs and recovery

- The canonical Procedure parser remains bounded to 300 Nodes and 1600 Route
  entries per Procedure. Stress tests cover 300 Nodes / 1495 distinct Route
  entries, preserving node/Route identity and Basic layout visibility.
- Full-graph ELK is bypassed above **90 visible Nodes** or **250 visible
  Route entries**. The graph switches to the basic layout with an explicit
  notice; switching to a small neighbor scope may use ELK again.
- Inspector editing qualification is cached per source revision, Procedure,
  selected Node and PredicateSet revision to avoid repeated whole-source
  parsing within one Inspector render.
- On invalid Source, the stale canvas is cleared and editing is disabled,
  but current Procedure and Node identity are retained for recovery via Source
  correction or Undo. Browser tests cover actual recovery and graph restoration.

These are deterministic guardrails rather than latency SLAs. Performance
depends on topology, browser and hardware. A5 does not validate output
schemas, typed binding compatibility, 3GPP causality, external capability
availability or Runtime execution outcomes.

## A5 acceptance

Run `npm test`, `npm run typecheck`, `npm run build`,
`node scripts/edge-smoke.mjs`. Validate both pinned package baselines,
advisory warnings after editing, Diff/Apply/Undo/Redo, Source failure
recovery into a Child Procedure and a 95-Node real-browser fallback.
