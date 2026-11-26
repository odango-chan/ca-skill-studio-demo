# Skill Studio 当前工作状态

**Snapshot:** 2026-11-26 · **Current main:** `5b666c0ef754ed32fa37c97ce2429f328c70477f`  
**Deployment:** Pages Build + Deploy PASS, run [#45545634726](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/45545634726), exact SHA matches main. Dated WORK and traceability evidence is archived in [WORK-history.md](WORK-history.md); do not treat historical PASS as current evidence.

## Current product

- **Host / UX:** Theia 1.76 browser-only is the only online workbench. Fixed two-pane Source + Preview; native Outline / Problems; Package Explorer includes Skills and Plugin-managed Dependencies. Procedure / Contract / Predicate / Schema Preview is read-only; native Source is the direct editing surface. AI Authoring is a separate Editor Tab with Host-owned Change Sets. Classic and standalone D1–D4 Designer mutation UI are retired.
- **Language:** CA-SL `connectionagent.io/v1alpha5` is the only active editing target (FROZEN / RELEASED). No old-version editing compatibility or automatic migration.
- **Default Example:** OpenAMSM Scheme C Create / Modify / Release Skills. Dependencies are immutable snapshots: `mas` Owner ToolCatalog, `ca-context` Host Context Schema Bundle, and `ca-client` read-only SBI Interface Package for Schema IntelliSense only; `ca-client` is not the MAS Contract root. The conventional `establish-pdu-session` 5GC Skill is a separate NOT_QUALIFIED fixture, not the default Example.
- **Compiler:** main integrates CA Skill Compiler v2.0.2. v2.1.0 Development Build / Verify is not integrated. The `mas` and `ca-context` packages are not formal Interface Package Contract roots; do not synthesize manifests or substitute dependencies.
- **AI Authoring:** F1–F4 are merged and deployed. Model output remains an untrusted proposal; Apply is Host-owned and must bind current Source revision, Compiler result and v1alpha5 Patch Engine. Runtime / 5GC qualification is not claimed.
- **Diagnostics:** LSP, Package Audit and Compiler Diagnostics retain distinct authorities. Problems / Test Explorer result-boundary acceptance remains open.
- **Qualification:** unit / IDE Host / Theia Chromium / Pages prove only their named scopes. They do not prove Compiler v2.1.0 integration, Owner / Host Admission, Runtime execution, real 5GC E2E or Production Qualification.

## Active blockers

| Area | Tracking | Exit condition |
|---|---|---|
| Product acceptance | [#279](https://github.com/odango-chan/ca-skill-studio-demo/issues/279) | Close the current product, architecture, docs and exact-head acceptance audit |
| Persistent workspace | [#225](https://github.com/odango-chan/ca-skill-studio-demo/issues/225), [#239](https://github.com/odango-chan/ca-skill-studio-demo/issues/239) | Old artifact → candidate artifact with the same persistent browser profile; verify OPFS / IndexedDB / workspace restoration and EIO handling |
| Example replacement | [#280](https://github.com/odango-chan/ca-skill-studio-demo/issues/280) | Transactional replacement, failure rollback and fault-injection coverage |
| Action parity | [#237](https://github.com/odango-chan/ca-skill-studio-demo/issues/237) | Inventory all contributed commands / visible actions; remove retired labels and hidden patch affordances |
| Markdown worker | [#288](https://github.com/odango-chan/ca-skill-studio-demo/issues/288) | Capture the actual worker / TreeModel stack; do not conflate with Console Source restoration |
| Compiler v2.1.0 | [#269](https://github.com/odango-chan/ca-skill-studio-demo/issues/269) | Rebase and finish generic API integration; wait for formal MAS / Host Context Interface Package roots before claiming Example Build |
| Diagnostics | [#211](https://github.com/odango-chan/ca-skill-studio-demo/issues/211) | Close Problems / Test Explorer / Compiler / Package Audit source and result-boundary acceptance |
| Preview lifecycle | [#220](https://github.com/odango-chan/ca-skill-studio-demo/issues/220) | [#293](https://github.com/odango-chan/ca-skill-studio-demo/pull/293) fixes null-document invalidation and passes 5/5 exact-head gates on #291's base; after #291 merges, retarget to main and rerun |
| Documentation | [#285](https://github.com/odango-chan/ca-skill-studio-demo/issues/285) | WORK and TRACEABILITY are compacted; exact-head governance / link checks must pass before closing |

## Open PRs — exact current state

- [#282](https://github.com/odango-chan/ca-skill-studio-demo/pull/282) docs refresh: PR Verify PASS; Pages after the latest documentation commit is pending.
- [#284](https://github.com/odango-chan/ca-skill-studio-demo/pull/284) Settings metadata and [#287](https://github.com/odango-chan/ca-skill-studio-demo/pull/287) Welcome copy: each 5/5 exact-head gates PASS; not merged.
- [#289](https://github.com/odango-chan/ca-skill-studio-demo/pull/289) Preview labels: Browser-Only / Pages must be rerun after #291 lands.
- [#291](https://github.com/odango-chan/ca-skill-studio-demo/pull/291) Console Source / dirty-buffer restoration: 5/5 exact-head gates PASS; ready for review, not merged.
- [#292](https://github.com/odango-chan/ca-skill-studio-demo/pull/292) Markdown worker diagnostics: no worker stack captured; rerun after #291 lands.
- [#293](https://github.com/odango-chan/ca-skill-studio-demo/pull/293) Preview null-document lifecycle: 5/5 exact-head gates PASS on #291 base; Ready for Review, not merged; retarget to main and rerun after #291 merges.
- Older drafts are not promotable: #271 has no workflow runs and is not mergeable; #272 and #275 use old main `db8353b...`; #275 Pages failed; #276 is stacked on the old #272 head. Historical PASS is not current-main evidence.

## Current guardrails

- Every code / document change must link an Issue; every updated canonical document records changed sections, reason and author/model.
- Current Theia Preview remains read-only. Do not restore D1–D4 visual mutation or introduce a third pane.
- Demo scope does not require production admission, signatures, Trust Registry, Runtime qualification or real 5GC E2E. Do not claim them as PASS.
- Current canonical sources: [docs map](README.md), [traceability](TRACEABILITY.md), [documentation governance](DOCUMENTATION.md), [history](WORK-history.md).

## Revision record

- **2026-11-26 — WORK compacted to a current-state panel and dated narratives moved verbatim to WORK-history.md.** Sections: current product, blockers, exact-head PRs and guardrails. Reason: satisfy #285's 40–120-line requirement without losing historical evidence. Author: ChatGPT (GPT-6.2).

- **2026-11-26 — Preview lifecycle candidate exact-head acceptance updated.** Sections: Preview lifecycle blocker and open PRs. Reason: record PR #293's 5/5 PASS on the #291 base without claiming merge or main qualification. Author: ChatGPT (GPT-6.2).

- **2026-11-26 — Documentation PR build acceptance advanced.** Sections: open PRs. Reason: record PR Verify and Pages Build / real Chromium PASS on the latest tested #291-based head while distinguishing PR artifact validation from main deployment. Author: ChatGPT (GPT-6.2).
