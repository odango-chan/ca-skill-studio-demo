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
| A2 | Create Node with a minimal typed operator and bounded Route connections | Not implemented |
| A3 | Delete Node with explicit reference remediation and start protection | Not implemented |
| A4 | Edit generic Node operator/with/from with source qualification | Not implemented |
| A5 | Browser interactions, package semantic validation and large graph checks | Not implemented |

## Acceptance

Run npm test, npm run typecheck and npm run build. In a browser, select a Node, change its ID, preview Diff, cancel or confirm, then Undo/Redo. Verify that Route targets, start and from references remain consistent. Rejected cases must preserve Source bytes.

D2-A1 does not add, delete, copy or reposition Nodes, create Route outcomes, write directly to local files or alter another repository.
