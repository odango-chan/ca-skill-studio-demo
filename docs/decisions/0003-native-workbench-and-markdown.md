# ADR-0003 · Native Workbench Layout, Inspector and Markdown Ownership

**Status: Accepted · Native Markdown is the default Theia implementation (PR #169); host acceptance-harness closeout remains tracked by #176 · Date: 2026-11-12**

**Supersedes:** the view-placement and duplicate-view assumptions in the earlier Theia migration notes. It does not supersede the Source-first authority or existing bounded-edit contracts in ADR-0001.

> **Partial supersession:** ADR-0004 now defines Package-first ordering and the unified Package Explorer projection in the primary sidebar. All other decisions in this ADR remain in force.

## Context

Theia is the default online host and the same VS Code extension is intended to remain usable in desktop VS Code. The current extension contributes a separate Skill Studio Activity Bar container with Packages, Inspection, Outline, Evidence and Problems views. This duplicates several capabilities already owned by the host:

- The host already owns Explorer, editor groups, Markdown preview, Outline, Problems, Output, menus and workbench layout.
- The extension contributes a custom Procedure Outline even though Theia has a native Outline view.
- The extension contributes a custom Problems tree while also publishing native diagnostics to the host Problems view.
- The current view named **Evidence** is not a Runtime Evidence browser. It displays source-derived Child / Phase / Step structure, Producer / Consumer dataflow, consumer ABI declarations and source lineage.
- Inspector is a property editor for the selected Source-backed object. Keeping it beside file navigation is less natural than placing it in the right-side property / secondary sidebar.
- At the time of this decision, Theia's Markdown path was a Studio-owned Webview renderer. The built-in VS Code Markdown extension, `vscode.markdown-language-features`, was selected as the replacement; it became the default Theia implementation in PR #169. The Classic shell still retains its old renderer until the later retirement operation.

The current Plugin-managed Project / Dependency / Tool / BuildRequest contract is being developed in PRs #150 and #152. The new layout must not assume the retired skills/lib/output project model as its permanent authority.

## Decisions

### 1. Host-native workbench; Studio contributes domain authoring

Theia / VS Code own the generic IDE shell and generic editor capabilities:

- Explorer, file navigation, editor tabs and editor groups;
- native Outline and Problems;
- Output and host diagnostics;
- Markdown source editing and preview;
- menus, command palette, view movement, resizing and theme application.

Skill Studio owns only domain-specific authoring and inspection:

- Procedure / Contract / Predicate / Schema visual editors;
- the shared Skill language and semantic-token integration;
- Package / Project and Dependency views backed by the Plugin-managed contract;
- the Source-backed Inspector and bounded authoring commands;
- Procedure canvas and its navigation / focus integration.

Do not build a second IDE shell or a second generic Markdown editor.

### 2. Target workbench layout

**Primary sidebar (left):**

- Native Explorer / Files.
- Project / Packages inventory.
- Dependencies, based on the Plugin-managed Project contract.
- Native Outline, driven by the active document's DocumentSymbol provider.

These are native host views. They must not require a dedicated Skill Studio Activity Bar. A compact Project view may group Packages and Dependencies if that produces a clearer hierarchy; do not add more Activity Bar containers to compensate for missing layout decisions.

**Secondary sidebar (right):**

- **Inspector** is the primary property editor.
- It displays the current selected Source-backed Node, Phase, Step, Route, Contract or Predicate properties and only exposes already-qualified bounded edits.
- It may contain a contextual **Data Flow** section for the selected Step / consumer. Data Flow is not a separate permanent Evidence panel.

The right-side placement is the product decision. Use the native secondarySidebar contribution. Theia 1.76's plugin contribution normalizer explicitly maps secondarySidebar to its right-side location (see [Theia v1.76.0 normalize-contributions.ts](https://github.com/eclipse-theia/theia/blob/v1.76.0/packages/plugin-utils/src/node/normalize-contributions.ts#L92-L96)); desktop VS Code exposes the same contribution point. The implementation still requires real Theia Chromium and desktop VS Code placement acceptance. If a host runtime does not attach the view as expected, use the host's native movable view/container mechanism; do not implement a custom right dock or a Theia-only property UI.

**Bottom Panel:**

- Native Problems for LSP and Package Audit diagnostics.
- Native Output for extension / Compiler logs.
- Build output/status only when a real Compiler adapter is installed and has produced an actual result. Do not keep a permanent Build view that reports only UNAVAILABLE.

**Central editor area:**

- Native text editors for Markdown, Python, YAML, JSON and other source files.
- Existing Source-backed CustomEditors for Procedure, Contract, Predicate and Schema.
- Markdown defaults to editable Source in the first editor group and read-only Preview in the second editor group.

All areas remain host-movable, collapsible and resizable.

### 3. Inspector is right-side property inspection, not navigation

Inspector is a property editor, not a file tree or a second Outline.

- Canvas selection, native Outline selection and source selection must converge on one shared selection identity.
- The identity includes the exact document URI, Procedure / object identity and document revision.
- The Inspector must reject stale selections after Source changes; it must never apply a patch against an outdated revision.
- Phase and Step remain properties / nested source structures of their owning Node. They must not be promoted into invented business Nodes.
- All mutations continue through the existing exact Source-span, revision, preview Diff, explicit confirmation, WorkspaceEdit and Undo contract.
- Inspector can be closed, resized and moved using native workbench controls.

### 4. Distinguish Skill-language Observation / Evidence from Studio Data Flow

The official language authority is ca-skills, not this repository. Its current Skill Language Specification v0.2 defines separate observations and evidence Context Schema namespaces:

- assurance/predicates.yaml declares the observations a Predicate needs, including an owner reference, exact scope and freshness.
- Observation payload schemas belong to the Observation source owner.
- Host / Runtime owns the Evidence and provenance projection supplied to Predicate evaluation.
- Predicate evaluators consume already materialized Evidence; they do not themselves fetch Observations.
- SKILL.md uses Evidence in its business-verification guidance. Evidence must be tied to the exact occurrence and, where required, the exact producer. Missing, stale, ambiguous or wrong-producer evidence remains UNKNOWN.

References:
- [ca-skills Skill Language Specification v0.2](https://github.com/odango-chan/ca-skills/blob/main/docs/skill-language-spec.zh-CN.md)
- [ca-skills Schema Ownership](https://github.com/odango-chan/ca-skills/blob/main/docs/schema-ownership.md)
- [Official PDU Session PredicateSet](https://github.com/odango-chan/ca-skills/blob/main/skills/establish-pdu-session/assurance/predicates.yaml)

The existing Studio view skillStudio.evidence is a different thing: it is a static, Source-derived analysis of Producer / Consumer dataflow, source lineage and declared consumer ABI. It explicitly does not represent Runtime Evidence, live Observation results, network state or execution success.

**Decision:** rename this Studio concept to **Data Flow** and integrate it as a contextual section of Inspector. Remove the standalone Evidence view after equivalent Inspector coverage is accepted. Do not introduce an Evidence DSL, Observation authoring format or Studio-owned Evidence schema. A future real Run / Trace Inspector may display Host / Runtime Evidence only when it is backed by actual execution records and provenance.

### 5. Use native Outline and native Problems

**Outline**

- Use the host's native Outline view and the shared LSP / DocumentSymbol contract.
- Add Procedure YAML symbols from the canonical Skill parser / AST: Procedure, Node and relevant nested Phase / Step structure with exact source ranges.
- Selecting a symbol reveals its Source location and synchronizes the Procedure canvas Node Focus where the symbol represents a business Node.
- Python symbols continue to come from the existing language service.
- Remove the duplicate custom skillStudio.outline TreeView only after native Theia Chromium acceptance proves the required navigation and canvas synchronization.

**Problems**

- Use one native Problems surface backed by DiagnosticCollection.
- LSP diagnostics and Package Audit diagnostics must have distinct source labels and stable identities.
- Package Audit must continue to inspect the current Package and open unsaved documents, invalidate stale generations, and fail closed when required files are unavailable.
- Do not duplicate the same diagnostic in a second custom Problems tree.
- Keep explicit Audit / Refresh commands and a clear unavailable state; a missing or incomplete audit must not be shown as a clean Package.
- Compiler diagnostics may later join native Problems, but LSP / Package Audit must never be presented as Compiler success or Runtime qualification.

### 6. Native Markdown is the active Theia implementation; Classic remains separate until retirement

The accepted Theia implementation is the pinned built-in VS Code Markdown extension `vscode.markdown-language-features@1.95.3`, merged as [PR #169](https://github.com/odango-chan/ca-skill-studio-demo/pull/169) at `main@82f0b0c5`. It owns Markdown rendering, read-only Preview, editor/preview synchronization and Preview lifecycle.

The Studio extension owns only the integration boundary:

- automatic pairing on Markdown open: editable Source in editor group one, read-only Preview in editor group two;
- the shared SKILL Studio Light Markdown theme via `contributes.markdown.previewStyles`;
- exact Package-root inventory and symlink checks through `markdown-link-policy.mjs`;
- fail-closed handling for missing/ambiguous Package roots and unsafe Package-relative links;
- raw HTML and image fetches remain disabled.

The old `site/markdown-preview.mjs` renderer and its stylesheet remain for the preserved Classic shell only. They are not an alternative Theia renderer. Do not delete or refactor them as part of this issue; Classic retirement is a separate later operation.

#### Native Markdown acceptance gates

The implementation is merged and is the default, but do not overstate the post-merge acceptance status. PR #169's core verification passed; the IDE Host fixture still asserted the retired custom renderer, and the two real-Chromium host workflows referenced a missing `waitNativeMarkdown` helper. These are acceptance-harness defects tracked by [Issue #176](https://github.com/odango-chan/ca-skill-studio-demo/issues/176), not a reason to restore the custom renderer. Full acceptance remains pending until all exact-head host gates pass.

The real-host acceptance must prove:

1. **Host integration:** both Theia browser-only and backend builds load the pinned Markdown extension and its worker.
2. **Default pairing:** opening a Markdown file from Explorer, Package Explorer and an internal Package link opens one authoritative Source editor plus one Preview in a separate editor group. Reopening / switching documents does not create duplicate previews.
3. **Editing:** unsaved Source edits update the existing Preview without recreating it; native Undo / Redo remains authoritative.
4. **Navigation:** source-to-preview and preview-to-source scrolling work in both directions; Package-local link navigation targets the exact Package.
5. **Theme:** heading accents, body typography, links, code blocks, tables, alignment, table overflow and responsive layout use the shared theme extension.
6. **Skill guide behavior:** Front Matter remains understandable; headings / TOC or equivalent navigation remain available; relative Reference links work only within the active Skill Package.
7. **Security:** raw HTML cannot execute; no remote images, scripts or arbitrary fetch are introduced; Package-local links pass exact Package-root containment, file inventory and symlink checks.
8. **Fallback:** unsupported syntax, unavailable extension, CSP / webview failure or an unsafe link must fail closed and leave Source accessible.

### 7. Classic retirement is a later release operation

After the new host passes feature-parity and security gates:

- stop publishing the old Classic workbench at /classic/;
- remove the Classic-only shell and release composition path;
- retain shared parsers, Source-span patch modules, semantic projections, icons, theme tokens and language contracts while they are still consumed by Theia / VS Code;
- move shared domain modules out of legacy shell directories incrementally before deleting any source;
- never treat a successful build, static Package Audit or Markdown preview as Runtime / Compiler / 5GC evidence.

Do not remove site/ wholesale. Its current modules still contain shared Procedure, Phase, Package Audit, Markdown and projection logic.

## Implementation order

1. **Native Markdown:** default implementation is merged in PR #169; finish the acceptance-harness closeout under #176. Do not maintain a second Theia Markdown renderer.
2. **Workbench layout:** move Project / Packages / Dependencies to the native primary sidebar and place Inspector in the native right-side secondary sidebar. Remove the separate Skill Studio Activity Bar only when the new views are reachable and accepted.
3. **Native Outline:** implement Procedure YAML DocumentSymbols and verify Source ↔ Outline ↔ Canvas synchronization.
4. **Problems and Data Flow:** consolidate diagnostics into native Problems; rename the old Evidence view and move its source-derived dataflow / ABI content into Inspector.
5. **Classic retirement:** only after the preceding host and feature-parity gates pass.

## Data Flow migration closeout (2026-11-12)

**Status: COMPLETE for the standalone Evidence view retirement.**
The implementation was accepted in [PR #170](https://github.com/odango-chan/ca-skill-studio-demo/pull/170)
and [PR #171](https://github.com/odango-chan/ca-skill-studio-demo/pull/171).
Both PR heads passed Verify, IDE Host Spike, Browser-Only real Chromium and
backend Theia real Chromium before merging to `main`.

- **Right-side Inspector:** the selected Source-backed Node displays contextual
  Data Flow, including Producer / Consumer lineage, output contract/schema and
  type, Consumer ABI declaration, and unresolved/type-only state.
- **Semantic boundary:** this remains static Source analysis. It explicitly
  labels Runtime `NOT_RUN`, missing producer/consumer proof and lack of write
  authority. It never fabricates Runtime Evidence or Observation results.
- **Old view removed:** `skillStudio.evidence` is no longer contributed to the
  Explorer, activated as a TreeView, or registered as a DataProvider. Source
  projection helpers can still be shared internally; this is not an additional
  visible Runtime Evidence surface.
- **Regression coverage migrated:** real Chromium checks Inspector placement,
  contextual Data Flow, expandability, Source lineage and Consumer ABI; native
  Source edit, Undo and Package Audit behavior remain in the same acceptance
  suite. The retired Explorer Evidence header is asserted absent.
- **Future scope:** actual Runtime Evidence belongs to an execution/Trace
  inspector only after the Host supplies occurrence-pinned provenance. No new
  Studio Evidence DSL or Observation schema is introduced.

**Important:** completing this migration does **not** close overall Classic
retirement. Native Markdown replacement and remaining host-native view
consolidations retain their own acceptance gates.

## Alternatives rejected

- Keeping a dedicated Skill Studio Activity Bar as the permanent home for generic IDE functions.
- Keeping duplicate custom Outline and Problems trees beside native host views.
- Calling static Producer / Consumer ABI analysis "Runtime Evidence".
- Placing Inspector beside file navigation as the permanent property-editor location.
- Replacing Markdown with the native extension based only on package installation or a successful build.
- Maintaining separate Markdown renderers, themes or security rules for online Theia and desktop VS Code.
- Deleting shared domain modules merely because the Classic shell is retired.
