# CA-SL v1alpha5 Studio Integration Boundary

**Status:** v1alpha5-only authoring · Language FROZEN / RELEASED · Studio product qualification NOT_QUALIFIED  
**Language target:** `connectionagent.io/v1alpha5`  
**Normative release:** `odango-chan/ca-skills@0abfd0e1ab99f481a4ae01f3f47efc54783dd5e5` (PR #66)  
**Example source:** `odango-chan/ca-skills/main@de8d9f667dd1a445c3f6378e0ca793d7407d2036` (current manifest snapshot; PR #65 introduced the v1alpha5 examples)  
**Compiler:** released CA Skill Compiler v1.0.0 targets v1alpha4. The current v1alpha5 candidate is [PR #38](https://github.com/odango-chan/ca-skill-compiler/pull/38), head `ea27f18549725166f304b7d06fd9339bb0554329`; it remains Draft, unmerged and not integrated. PR #30 was superseded by #38. PR #38 reports local `FULL_LANGUAGE_VALIDATION` acceptance, not a released integration or product qualification.

## 1. Version authority

The Studio's only active authoring target is the released CA-SL v1alpha5 specification pinned above. It inherits the immutable v1alpha4 language baseline and includes Node-entry Event Wait as normative language semantics. CA-SL v1alpha5 is **FROZEN / RELEASED**. The v1alpha4 specification remains only a historical inheritance baseline; it is not a parallel active Example, authoring mode or compatibility target.

The Example files are copied from the exact ca-skills main snapshot commit. The build validates the manifest, source ref, language target, every declared file path and every Git blob hash. The online Extension packages only `site/samples/v1alpha5`; a previously staged v1alpha4 sample directory is removed from the generated extension assets.

## 2. Implemented editor capabilities

The following are editor-time projections and authoring conveniences, not language conformance claims:

- A dedicated v1alpha5 source analyzer recognizes the package-level `start` / `nodes` graph and the four existing business stages.
- A Node may display `wait` as a separate entry control. Wait is not a fifth business stage and does not create a Wait-only Node.
- The Procedure Designer and Inspector display the event selector, fixed timeout, `TIMEOUT` route, optional response boundary and explicit `NodeId.wait.output` bindings from source.
- The browser LSP offers source-local completion for Wait fields, the event selector, response-boundary Node references, timeout targets and the same-Node Wait output binding. Response-boundary completion follows business-stage route reachability and does not suggest a Node reachable only through the Wait timeout edge.
- Definition, Outline, source diagnostics and local semantic-token projection are editor assistance. The local `skillWait` semantic token is Studio-owned presentation metadata; it is not an upstream CA-SL token contract.
- Example import and replacement use the exact v1alpha5 sample manifest. Replacement is explicit and deletes only the dedicated Example workspace; ordinary workspaces are not passed to the Example importer.

The local source analyzer and LSP do not replace the authoritative Compiler. Completion results are hints, not trusted declarations or authorization grants. Passing Studio tests does not qualify Compiler, Owner, Host, Runtime or 5GC behavior.

## 3. Compiler fail-closed boundary

The integrated Compiler v1.0.0 BuildRequest and BuildResult contracts target CA-SL v1alpha4. They must not receive v1alpha5 source, even though the v1alpha5 language itself is now frozen and released.

Accordingly, Studio blocks **Check Skill**, **Build Skill** and **Inspect Dependencies** when the selected Procedure is v1alpha5. The UI must explain that the language is released but this Studio build has no released v1alpha5 Compiler integration. It must not silently lower Wait to Observation, polling, a legacy stage, or a v1alpha4 source shape.

The v1alpha5 Compiler candidate in ca-skill-compiler PR #38 is not a released integration target. Its PR description reports `FULL_LANGUAGE_VALIDATION` with local acceptance evidence, but the PR remains Draft / unmerged and is not integrated into Studio. This does not establish released Studio Check / Build / Dependency Inspection / Artifact support or Owner / Host / Runtime qualification. PR #30 is superseded and must not be treated as the active candidate.

## 4. Explicitly not qualified

This Studio editor integration does not claim:

- a qualified v1alpha5 product implementation;
- full Compiler v1alpha5 Check / Build / Dependency Inspection / Artifact support;
- trusted IngressCatalog or exact Ingress Operation export resolution;
- Owner ToolCatalog, CapabilityContracts, Schema or deployment trust publication;
- complete static validation of every `wait.output` type and accepted-event path against trusted normalized-request Schemas;
- Host / Runtime durable Wait registration, EVENT_ACCEPTED arbitration, same-Run continuation, occurrence isolation, tombstones, restart recovery or cancellation;
- paired response production, response-obligation persistence, response deadlines or transport-level response conformance;
- execution of the 36 normative EW cases;
- real 5GC E2E, MAS qualification or Runtime success.

The 36 EW cases in the v1alpha5 specification are normative acceptance obligations. Their existence in the manifest or in source tests is not evidence that Host, Runtime or Integration has passed them.

## 5. Acceptance gates

Before calling the Studio Preview implementation complete:

1. Exact pinned source and Example manifest tests pass.
2. Node unit tests, TypeScript checks and browser LSP tests pass, including Wait completion, Wait output navigation and response-boundary reachability.
3. Extension packaging and both Theia Browser-Only / Browser Host builds contain only the v1alpha5 Example assets.
4. Real Chromium acceptance verifies the v1alpha5 Example, Procedure graph, Inspector, Package Explorer, Contract / Predicate / Schema Designers, Markdown pairing and v1alpha5 Wait language-provider probes.
5. Compiler actions demonstrably fail closed for v1alpha5 while the v1alpha4 Compiler Worker smoke remains scoped to its own v1alpha4 fixture.
6. Pages deployment occurs only after exact-head CI and the resulting online build have passed; no deployment is implied by this Preview document.

## 6. Source locations

- Normative release lock: `language/contracts/ca-sl-v1alpha5.lock.json`
- Historical v1alpha4 lock: `language/contracts/ca-sl-v1alpha4.lock.json`
- Source projection: `language/core/v1alpha5.ts`
- Browser LSP completion and semantic tokens: `experiments/ide-host/lsp-browser/server/src/browserServerMain.mjs`, `language/semantic-tokens.mjs`
- Example manifest: `site/samples/v1alpha5/files.json`
- Compiler v1alpha4 integration boundary: [compiler-v1alpha4-studio-integration.md](compiler-v1alpha4-studio-integration.md)
