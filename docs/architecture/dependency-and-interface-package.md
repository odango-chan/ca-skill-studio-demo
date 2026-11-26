# Dependency, Interface Package and Schema IntelliSense Architecture

**Status: Current implementation boundary · Updated: 2026-11-26 · Audited baseline: `main@5b666c0ef754ed32fa37c97ce2429f328c70477f`**

This document describes the current Studio-owned dependency acquisition, immutable snapshot, Package Explorer and Language Service boundary. It supersedes the 2026-11-11 v0.1 proposal where that proposal conflicts with the current implementation. It does not redefine Compiler, CA-SL, Owner, Host or Runtime contracts.

## 1. Ownership

| Concern | Authority | Studio responsibility |
|---|---|---|
| CA-SL syntax and authoring contract | `ca-skills` | Consume the frozen v1alpha5 contract and expose source-backed authoring. |
| Interface Package wire format and formal exports | CA Skill Compiler / package publisher | Validate the published `connectionagent.io/interface-package/v1alpha1` ZIP and preserve its bytes. Do not invent exports or package identities. |
| ToolCatalog / Schema Bundle source | Respective Owner / Host publisher | Pin the declared source and retain immutable snapshots. A snapshot is not Owner authorization or Runtime admission. |
| Project dependency declarations and Studio lock | Skill Studio | Own `skillc.project/v0.1`, `skillc.lock/v0.1`, acquisition UX, snapshot storage, lock updates and Package Explorer projection. |
| Compiler linking/build | CA Skill Compiler | Studio v2.0.2 adapter consumes its frozen API. The separate v2.1.0 Development Build API owns formal Interface Package linking and derived `interface-dependency-lock/v1alpha1`. |
| Host Admission / Runtime Execution | Independent Host / Runtime | Studio must not synthesize admission, execution or qualification evidence. |

The Studio lock is **not** a Compiler-owned lock. `skillc.lock/v0.1` records the Studio project's declared dependency source and immutable snapshot digest. It is not the Compiler v2.1.0 `interface-dependency-lock/v1alpha1`; the v2.1.0 request builder derives that separate lock from formal Contract roots and the exact transitive package closure.

## 2. Current project configuration and immutable snapshots

Project configuration is resource-scoped to the selected Workspace Folder:

- `skillsRoot` is fixed to `skills`.
- `dependencies[]` declares bounded aliases, one of `tool-catalog`, `schema-bundle` or `interface-package`, and its source identity.
- `dependencyLock` is `skillc.lock/v0.1`; each lock entry binds the declared kind/source to an immutable `sha256:<64 hex>` snapshot digest and file inventory.

The relevant implementation is:

- `experiments/ide-host/vscode/src/project-configuration.mjs`: selected-root scoping, structural validation and host-native workspace configuration writes.
- `dependency-snapshot.mjs`: canonical file inventory, safe relative paths and snapshot digest verification.
- `dependency-service.mjs`: immutable snapshot storage, exact-byte reload, lock resolution, explicit Add / Refresh / Update Lock / Remove.
- `dependency-integration.mjs`: Package Explorer contribution, source acquisition and user confirmation.

Snapshots are stored beneath the project root at `.skill-studio/dependencies/<digest>/`. Writes stage the complete snapshot first and require a host filesystem rename operation before publishing the immutable directory. If the host cannot provide that operation, the write is BLOCKED; a partially written snapshot is never advertised as locked. On read, the service re-verifies the stored manifest and file bytes. Missing or corrupt bytes remain BLOCKED / ERROR; they do not become an empty successful dependency.

Source acquisition and lock mutation are explicit user actions. Refresh detects upstream drift but does not change the lock. Update Lock requires a separate confirmation and invalidates dependency-derived analysis. Removing a declaration does not silently delete immutable snapshots that may still be referenced elsewhere.

## 3. Supported acquisition and presentation

The current UI is a native Package Explorer composition, not a second dependency sidebar or custom package manager.

Supported acquisition paths in the current extension include:

- Browser-local or native file selection of a formal Interface Package ZIP.
- A pinned GitHub Release Interface Package asset with exact tag, asset and SHA-256; browser CORS/network failure is BLOCKED, not a reason to follow a mutable `latest` URL.
- Explicit upload of ToolCatalog YAML / JSON.
- Pinned GitHub file acquisition for an Owner ToolCatalog.
- A bundled, explicitly unqualified ToolCatalog example.

MCP discovery is not an acquisition path in the current implementation. A name or `tools/list` result cannot be converted into an Owner-issued ToolCatalog, CapabilityContract or Runtime binding.

The Package Explorer exposes Skills, Dependencies and verified Build Artifacts. Imported Interface Package exports are read-only virtual source documents with their native JSON/YAML language identity, exact package provenance and Schema Preview. The UI labels snapshot verification separately from Compiler linking and Owner/Runtime authorization. Imported bytes are not edited in place.

## 4. Current default Example dependency closure

The default Example is the three OpenAMSM Scheme C Skills:

- `establish-pdu-session-mas`
- `modify-pdu-session-mas`
- `release-pdu-session-mas`

It pins three distinct dependency kinds:

| Alias | Kind | Purpose | Boundary |
|---|---|---|---|
| `mas` | `tool-catalog` | Published OpenAMSM MAS Owner ToolCatalog | Owner source snapshot; not a formal v2.1.0 Interface Package Contract root. |
| `ca-context` | `schema-bundle` | Host Context Schema Bundle | Host-owned context snapshot; not a formal v2.1.0 Interface Package Contract root. |
| `ca-client` | `interface-package` | Published `ca-client-tools_interface_1.1.0.zip` with 11 read-only SBI query Tools in two Capabilities | Used for query-tool Schema IntelliSense only; it is **not** a MAS Contract root and does not supply MAS mutation callables. |

The first two snapshots describe the current OpenAMSM Owner and Host dependency material. The third is a separate published read-only query Interface Package. Never substitute `ca-client` for `mas` or `ca-context`, and never fabricate a formal Interface Package manifest for either.

The three Skills remain DRAFT / NOT_QUALIFIED until their actual Owner/Capability/Evidence publication and the independent Host/Runtime qualification boundaries are satisfied. Static source alignment, pinned dependency bytes and useful editor completions do not imply executable qualification.

Implementation anchors: `site/samples/v1alpha5/files.json`, `example-owner-dependency.mjs`, `example-host-context-dependency.mjs`, `example-interface-dependency.mjs` and `sample-loader.mjs`.

## 5. Schema-driven Language Service

The current CA-SL Language Service consumes only the exact immutable snapshots accepted by the Dependency Service and the current Package generation.

For the imported `ca-client` Interface Package, the existing LSP can derive declaration-only hints from exported Tool input/output Schema references, including:

- alias-qualified Tool identities for `operation.tool` / `observation.tool`;
- required-first `arguments:` keys, duplicate suppression, type and description details;
- declared `enum` / `const` values;
- supported `context.request.*` hints from the local Contract request Schema;
- supported producer output hints only where the source DAG and Wait branches prove producer dominance.

Unknown/composed Schema applicators, ambiguous Tool identities, stale Package generations and missing locked bytes fail closed. No remote Schema fetch, guessed Tool ID, guessed runtime value or inferred Owner grant is permitted. Completion details explicitly preserve `AUTH_NOT_CHECKED`.

Implementation anchors: `interface-schema-completion.mjs`, `dependency-catalog-projection.mjs`, `experiments/ide-host/lsp-browser/server/src/browserServerMain.mjs` and the existing browser LSP client. This reuses the single Language Service; it does not add a second parser or LSP.

## 6. Compiler version boundary

- **Current Studio main:** CA Skill Compiler v2.0.2 remains the integrated WASM Worker / Check / Build / Inspect adapter. The current Studio lock is resolved by Studio before constructing its current request contract.
- **Published Compiler v2.1.0:** its Development Build / Verify API is a separate API family with formal Interface Package snapshots and `interface-dependency-lock/v1alpha1`. It is not integrated into Studio main yet; see [Issue #269](https://github.com/odango-chan/ca-skill-studio-demo/issues/269), [Draft PR #272](https://github.com/odango-chan/ca-skill-studio-demo/pull/272) and [Draft PR #276](https://github.com/odango-chan/ca-skill-studio-demo/pull/276).
- The current `mas` ToolCatalog and `ca-context` Schema Bundle are not formal Interface Package Contract roots. The current `ca-client` Interface Package is not a substitute. Formal Owner and Host Context roots must be published in the Compiler v2.1.0 Interface Package contract before the current MAS Example can be claimed `LINKED / BUILT` through that Development API.

Studio must not create a parallel linker, package manager, package manifest, Owner trust registry or Host Admission system. A Compiler `BUILT` result is not Host `ADMITTED`, Runtime `EXECUTED` or Production Qualified.

## 7. Acceptance and known limits

Relevant current implementation / acceptance records:

- [#261](https://github.com/odango-chan/ca-skill-studio-demo/issues/261): Interface Package import and Schema-driven IntelliSense.
- [PR #267](https://github.com/odango-chan/ca-skill-studio-demo/pull/267): editor-first Interface Package ZIP import and LSP completion, merged.
- [PR #270](https://github.com/odango-chan/ca-skill-studio-demo/pull/270): default Example `ca-client` preload, merged.
- [#269](https://github.com/odango-chan/ca-skill-studio-demo/issues/269): Compiler v2.1.0 Development Build / Verify cutover, open.
- [#211](https://github.com/odango-chan/ca-skill-studio-demo/issues/211): shared diagnostics and result ownership, open.

The current real Theia Chromium / Browser-Only / IDE Host tests verify native read-only Schema source, Package Explorer provenance and selected completion scenarios. Browser Release asset acquisition has a CORS limitation in CI; local device ZIP is the supported fallback. The exact deployed Pages-origin Release CORS behavior remains NOT_CHECKED.

Do not describe unit tests, synthetic ZIPs, static manifests or Package Explorer visibility as a successful Compiler link, Owner authorization, Runtime execution or real 5GC E2E.

## Revision record

- **2026-11-26:** Created as the current dependency and Interface Package architecture reference. Replaces the 2026-11-11 proposal as the implementation guide where they conflict. Records the current three dependency kinds, Studio lock ownership, default Example's three Skills / three dependencies, v2.0.2 versus v2.1.0 API boundary, and the formal Owner / Host Context Contract root prerequisite. Evidence: main `5b666c0ef754ed32fa37c97ce2429f328c70477f`, PRs #267 / #270, current dependency service / project configuration / Example preload source and Issue #269.
