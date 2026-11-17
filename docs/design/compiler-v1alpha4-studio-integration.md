# Skill Studio ↔ CA Skill Compiler v1.0.0 integration

**Status:** implementation slice in progress; exact-head CI and real Chromium acceptance are the qualification gates.  
**Compiler release:** `odango-chan/ca-skill-compiler@v1.0.0`  
**Language target:** `connectionagent.io/v1alpha4`  
**Normative Skill authority:** `odango-chan/ca-skills@7f84393ee8c395e4d8c39a74cb5000a1f896588d`

> **Version boundary:** This document describes only the Compiler v1.0.0 / CA-SL v1alpha4 integration. The active Studio authoring target is now CA-SL v1alpha5 Preview. Studio explicitly blocks Check / Build / Inspect for v1alpha5; this document must not be read as v1alpha5 Compiler support. See [CA-SL v1alpha5 Studio Preview](ca-sl-v1alpha5-studio-preview.md).

## 1. Ownership

- ca-skills owns the normative Skill language and authored source.
- Skill Studio owns workspace selection, reading the current source snapshot, imported dependency acquisition, immutable snapshot persistence, lock lifecycle, Problems presentation and Artifact browsing/export.
- Compiler v1.0.0 owns the authoritative parser, AST, linker, static checker, Script type derivation and deterministic Artifact generation.
- Tool Owners own ToolCatalog / Observation exports and their schemas.
- Deployment configuration owns CapabilityContracts and publisher authorization.
- Host / Runtime own admission, invocation, authorization revalidation and execution.

The Studio LSP and Designer remain editor-time projections. They do not replace Compiler Check / Build and must not infer Owner Effect, Capability authorization or missing Schema metadata.

## 2. Browser Worker packaging

The extension bundles a dedicated classic Worker entry at `dist/compiler-worker.js`. The Compiler repository is private. The Pages and Theia workflows therefore require the Studio repository Actions secret `CA_SKILL_COMPILER_READ_TOKEN`, a fine-grained token with **Contents: read** access to `odango-chan/ca-skill-compiler`. The token is used only by `actions/checkout` for the pinned source checkout (`persist-credentials: false`); it is never passed to the browser, Worker or Compiler.

The Pages and Theia workflows:

1. check out the exact Compiler `v1.0.0` tag;
2. use Go 1.26.6;
3. build `cmd/skillc-wasm` with `CGO_ENABLED=0 GOOS=js GOARCH=wasm`;
4. stage `skillc.wasm` and the matching Go `wasm_exec.js` beside the Worker;
5. copy those assets into Theia's hosted plugin, including the GitHub Pages base-path preview.

The Worker has no workspace filesystem, dependency resolver, credential, network acquisition, Tool invocation or Runtime dispatch. The extension host assembles the BuildRequest from the current Package snapshot and communicates with the Worker using correlated request IDs. Go/WASM requests are serialized because the Core callbacks execute synchronously inside one Worker.

## 3. Commands and result ownership

- **Check Skill** calls Compiler `Check(BuildRequest)` and publishes the exact `Diagnostic[]` into the host diagnostic collection. Diagnostic Code, Phase, path and source position are not rewritten.
- **Build Skill** calls Compiler `Build(BuildRequest)`, validates the frozen BuildResult shape and invokes Compiler `VerifyBuildResult` before exposing any output.
- **Inspect Dependencies** calls Compiler `InspectDependencies(BuildRequest)` and displays only callable / Schema metadata that the Compiler can attribute to trusted Owners.
- **Package Explorer → Build Artifacts** shows the last BuildResult as a read-only, session-local virtual tree. Failed builds retain no partial output. Artifact files are not written into or mixed with authored `skills/` source.

The current Artifact view is an in-memory presentation slice. Persistent Artifact export remains a follow-up Studio workflow.

## 4. BuildRequest source boundary

The current adapter reads a complete Package snapshot through the existing workspace snapshot service. Open TextDocuments override disk bytes, so unsaved edits are included. It maps the Package to the exact v1alpha4 source namespace:

```text
skills/<skill-name>/<package-relative-path>
```

It supplies both independent version identifiers:

- `apiVersion: connectionagent.io/compiler-build-request/v1alpha4`
- `languageTarget: connectionagent.io/v1alpha4`

The Studio adapter currently applies stricter source bounds than the Compiler transport (1 MiB per text file and 4 MiB aggregate). It never writes the assembled request into the user's workspace.

## 5. Deliberate dependency / trust limitation

This first integration slice **does not convert the existing Studio `skillc.lock/v0.1` dependency store**. Its Tool Contract acquisition shape and snapshot digest domain are not the Compiler v1alpha4 contract. In particular, the v1alpha4 digest is defined by the `CA-SKILL-DEPENDENCY-SNAPSHOT\0v1\0` binary framing and the trusted build context requires exact DependencyBindings, Owner attribution, CapabilityContracts and deployment authorization.

Therefore the current adapter intentionally sends:

- `resolvedDependencies: []`;
- no `trustedBuildContext`.

It does not copy v0.1 contracts, invent a Stable Package ID, infer an Owner, upgrade UNKNOWN Effect to READ/MUTATION, or manufacture Capability grants. A Skill that declares external dependencies is expected to receive Compiler fail-closed diagnostics such as missing snapshot / unverified identity. DependencyInspection will not expose legacy imports as trusted v1alpha4 exports.

The next integration work package must implement the exact v1alpha4 immutable snapshot digest and trusted Owner / Capability input pipeline. Only then can the real 5GC Skill be expected to compile successfully against its published contracts.

## 6. Wait and language-version boundary

The Compiler release targets CA-SL v1alpha4. It does not accept the post-v1alpha4 Node-entry Event Wait revision. Studio must not author, translate or silently lower Wait into an older Observation / polling pattern. The frozen Wait semantics and the pending normative / Integration / Host contracts remain a separate language-upgrade workstream.

## 7. Acceptance boundary

The integration tests cover:

- exact BuildRequest API and language-target identifiers;
- safe source-path mapping and base64 byte transport;
- Worker request correlation, serialization and transport failure handling;
- Package Explorer composition of Skills, Dependencies and Build Artifacts;
- Pages asset presence and base-path routing;
- real Chromium invocation of the pinned Go/WASM Check / Build / Inspect callbacks and failure-atomic BuildResult behaviour.

The Chromium smoke uses a deliberately incomplete synthetic Skill to prove that the actual browser Worker responds and that failed Build emits no partial Artifact. It is **not** a successful real Owner build, 5GC qualification, Runtime execution or MAS qualification. CI / Chromium evidence must be read from the exact PR run; no PASS is claimed before those runs complete.
