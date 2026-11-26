# Studio Ownership / Source Authority

**Status: Current product architecture baseline · Updated: 2026-11-26**  
**Baseline:** main `5b666c0ef754ed32fa37c97ce2429f328c70477f` · Theia 1.76 browser-only · CA-SL v1alpha5 · Compiler adapter v2.0.2 · OpenAMSM Scheme C Example.

This document defines which subsystem owns each piece of Studio state and which source is authoritative. It describes the Demo product boundary, not a production Agent / Runtime architecture.

## 1. Product boundary

Skill Studio is a browser-based authoring and package-inspection workbench. It owns editor buffers, local workspace presentation, language feedback, dependency inspection and Host-owned authoring interactions. It does **not** own authoritative Skill execution, Owner business state, Runtime receipts, MCP execution truth or production admission.

The canonical language target is CA-SL v1alpha5. The current default project is the OpenAMSM Scheme C Create / Modify / Release Example. Historical v1alpha4 / v1alpha1 projects and standalone Classic / Visual Designer workflows are not compatibility modes.

## 2. Fixed workbench surface

- Theia 1.76 browser-only is the sole online workbench.
- The product layout is exactly two columns: native Source Editor on the left and one Preview Host on the right. No third editor / inspector column.
- Outline and Problems are Theia-native views. Package Explorer owns Skills and Plugin-managed Dependencies.
- Classic and the former standalone D1–D4 Visual Designer mutation UI are retired.
- Preview is a projection of the active Source document. Procedure, Contract, Predicate and Schema previews are read-only; they are not independent editable models.

The current layout contract is [ADR-0005](../decisions/0005-fixed-source-preview-workbench.md). Native view ownership is described by [ADR-0003](../decisions/0003-native-workbench-and-markdown.md) and Package Explorer composition by [ADR-0004](../decisions/0004-package-first-workspace.md).

## 3. Source authority and editing

1. The native Theia Source Editor TextDocument is the sole direct editing authority. Source revision, dirty state, undo and save belong to the host editor.
2. Preview / Inspector projections may navigate to Source locations, but must not mutate CA-SL, create an alternate source of truth or silently write files.
3. AI Authoring is a separate Editor Tab. The model returns an untrusted proposal; the Host binds it to the current Source revision, validates the structured Change Set, presents the diff and requires explicit Apply. The model never writes the workspace directly.
4. Any future Visual mutation requires a new Issue and an approved Source Patch design with exact source spans, revision checks, parse / semantic validation, diff preview, explicit confirmation and undo. Do not infer permission from historical D1–D4 documents.

## 4. Package, dependency and Compiler authority

| Concern | Authority | Studio responsibility |
|---|---|---|
| MAS callable operations | Owner-published `mas` ToolCatalog | Read pinned metadata; do not invent Owner capabilities |
| Host Context schemas | Host-published `ca-context` Schema Bundle | Resolve / display pinned schemas; do not claim Owner authority |
| SBI message schemas | Read-only `ca-client` Interface Package | Schema IntelliSense only; it is **not** the MAS Contract root |
| Dependency closure | Project lock and immutable package snapshots | Inspect and preserve the lock; do not mutate imported package contents |
| Skill compilation | Standalone CA Skill Compiler | Invoke the current v2.0.2 adapter; do not embed a second Compiler in Studio |

Compiler v2.1.0 Development Build / Verify is not integrated into main. Formal MAS and Host Context Interface Package Contract roots are still missing; the Studio must not synthesize package identities or report the Example as LINKED / BUILT without them. See [Dependency / Interface Package Architecture](dependency-and-interface-package.md) and [#269](https://github.com/odango-chan/ca-skill-studio-demo/issues/269).

## 5. Example ownership and replacement

The default Example is the three OpenAMSM Scheme C Skills: Create, Modify and Release. The conventional `establish-pdu-session` 5GC Skill is a separate NOT_QUALIFIED fixture and is not part of the default Example.

Replacing the seeded Example requires explicit confirmation. A replacement must not touch ordinary user projects or unconfirmed Example sources. The current importer still needs a staged commit / rollback journal and fault-injection coverage; until [#280](https://github.com/odango-chan/ca-skill-studio-demo/issues/280) closes, replacement failure atomicity is **OPEN** and the UI must not claim a successful replacement after partial writes.

## 6. Workspace persistence and recovery

The browser workbench persists workspace data through the Theia browser storage provider (OPFS / IndexedDB) and the browser profile. A successful same-build reload is not evidence of old-artifact → new-artifact upgrade safety, nor does it establish production durability.

- [#225](https://github.com/odango-chan/ca-skill-studio-demo/issues/225): cross-artifact upgrade with the same persistent browser profile remains OPEN.
- [#239](https://github.com/odango-chan/ca-skill-studio-demo/issues/239): intermittent storage EIO / recovery remains OPEN.
- Workspace Identity and Package Inventory must not report READY while a restore / replacement transaction is incomplete or recoverably BLOCKED.

## 7. Diagnostics and qualification

LSP diagnostics, Package Audit, Compiler diagnostics and Runtime / Owner outcomes are separate authorities. Problems and Test Explorer must preserve the source and result type; a successful package audit is not a successful compile or Runtime execution. Result-boundary acceptance remains tracked by [#211](https://github.com/odango-chan/ca-skill-studio-demo/issues/211).

IDE Host, Browser Host, Browser-Only Chromium, Pages build and deployment prove only their named scope on the exact tested SHA. They do not prove formal package admission, Owner commit, Host continuation, Runtime execution, real 5GC E2E or Production Qualification.

## 8. Current open acceptance boundaries

| Area | Tracking | Current boundary |
|---|---|---|
| Console Source / dirty-buffer lifecycle | [#291](https://github.com/odango-chan/ca-skill-studio-demo/pull/291) | 5/5 exact-head PASS; Ready for Review, not merged |
| Preview null-document lifecycle | [#220](https://github.com/odango-chan/ca-skill-studio-demo/issues/220), [#293](https://github.com/odango-chan/ca-skill-studio-demo/pull/293) | 5/5 exact-head PASS on #291 base; retarget and rerun after #291 merges |
| Example replacement atomicity | [#280](https://github.com/odango-chan/ca-skill-studio-demo/issues/280) | Staging, rollback, restart recovery and fault injection not complete |
| Persistent profile / EIO | [#225](https://github.com/odango-chan/ca-skill-studio-demo/issues/225), [#239](https://github.com/odango-chan/ca-skill-studio-demo/issues/239) | Cross-artifact same-profile upgrade and recovery not complete |
| Visible action parity | [#237](https://github.com/odango-chan/ca-skill-studio-demo/issues/237) | Complete command → handler → UI → test inventory and retired affordance cleanup not complete |
| Markdown worker / TreeModel | [#288](https://github.com/odango-chan/ca-skill-studio-demo/issues/288) | Actual worker / TreeModel stack not captured |
| Compiler v2.1.0 / package roots | [#269](https://github.com/odango-chan/ca-skill-studio-demo/issues/269) | Formal MAS / Host Context package roots and v2.1.0 integration not complete |
| Product acceptance | [#279](https://github.com/odango-chan/ca-skill-studio-demo/issues/279) | Overall product audit remains OPEN |

## Revision record

- **2026-11-26 — Replaced the superseded v0 boundary note with the current ownership / authority baseline.** Sections: product boundary, workbench surface, Source authority, dependency / Compiler ownership, Example replacement, persistence, diagnostics and open acceptance. Reason: make the document referenced as canonical by docs/README.md accurate for the current Theia / v1alpha5 product and explicit about unresolved Demo blockers. Author: ChatGPT (GPT-6.2).
