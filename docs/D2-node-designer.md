# D2 Node Designer · source-backed authoring

Status: A1 first vertical slice; not a complete Node Designer.

## Architecture

- No CreatedSession-specific Node mutator. The same operation accepts any Procedure that currently projects READY.
- YAML Source remains authoritative; React Flow nodes are view objects, never a separate persisted graph.
- D2-A1 RenameNode rewrites exact plain-source spans for the Node mapping key, current Procedure start, inbound Route targets, and explicit from references.
- Each change is recomputed from the complete source revision, reprojected, structurally compared and shown as a Diff before confirmation. Existing Undo/Redo applies.
- Quoted, unsupported or ambiguous references fail closed. Direct Source editing is the escape hatch.
- Cross-file semantic checks (predicates, capabilities, scripts) are not implemented. Structural PASS is not Runtime PASS.

## D2 milestones

| Slice | Scope | Status |
| --- | --- | --- |
| A1 | Rename existing Node ID with guarded source reference rewrites | Implemented |
| A2 | Insert typed terminal/call/verify Node onto one existing Route | Implemented · bounded |
| A3 | Delete Node with explicit reference remediation and start protection | Not implemented |
| A4 | Edit generic Node operator/with/from with source qualification | Not implemented |
| A5 | Browser interactions, package semantic validation and large graph checks | Not implemented |

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
