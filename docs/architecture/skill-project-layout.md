# Skill Studio Plugin-managed Project v0.1 — implementation boundary

**Status: PARTIAL · 2026-11-11 · Draft [Studio PR #152](https://github.com/odango-chan/ca-skill-studio-demo/pull/152) · not merged.**

The semantic contract is **not defined in Studio**. The sole machine schema and digest authority is [Compiler PR #4](https://github.com/odango-chan/ca-skill-compiler/pull/4), including `project-settings`, `tool-contract`, `resolver-result`, `project-context`, `build-request` and the snapshot golden vectors. Studio's [configuration design PR #150](https://github.com/odango-chan/ca-skill-studio-demo/pull/150) is a draft specification. These PRs must not be treated as merged or as a released ABI.

## Editable workspace

```text
Skill Studio Example/          # fixed, independent extension-owned workspace
└── skills/                     # only authored Source, both official Skills
    ├── establish-pdu-session/
    └── establish-pdu-session-mas/
```

`skills/` is the only initial example directory. Both Skills have their pinned real owner files. `lib/` and `output/` are not project roles, are not created, and normal user files with those names remain editable. Older OPFS `workspaces/` is never overwritten or deleted; its exact legacy Explorer mount may be replaced with the new Example, **without removing the underlying files**. An unrelated user folder or multi-root entry must never be repurposed.

When a user explicitly adds dependencies, the project may acquire internal managed content:

```text
<selected-workspace-root>/
├── skills/
├── .vscode/settings.json          # native Workspace Configuration where host persists it
└── .skill-studio/
    ├── staging/                    # temporary, incomplete writes are not valid locks
    └── dependencies/
        └── <64 lowercase sha256 hex>/
            ├── manifest.json
            └── tool-contract.json  # JCS canonical bytes for tool-catalog
```

No `skill-project.yaml` or `skill.lock.yaml` is mandatory. The Settings API, not an invented Studio YAML file, owns declaration and lock persistence. Physical `.vscode/settings.json` representation depends on host. The Studio write preflight protects the managed snapshot area, **not every filesystem API**; host-native Explorer and external tools can bypass extension-side checks. Such UI policy is not a security guarantee.

## Native configuration

The `connectionAgent.skillStudio` namespace contributes:

| Setting | Scope | Default | Meaning |
|---|---|---|---|
| `skillsRoot` | Workspace resource | `skills` | Compiler v0.1 source root |
| `dependencies` | Workspace resource | `[]` | Compiler declaration values |
| `dependencyLock` | Workspace resource | `skillc.lock/v0.1` with empty entries | Pinned content and source identity |
| `defaultBuildTarget` | User/application | `all` | UI preference only |

A multi-root project is never implicitly chosen. Dependency management uses a specialized native Dependencies TreeView; project configuration is read/updated with the native API. Credentials belong in SecretStorage, editable Source remains under `skills/**`, temporary UI state stays outside project authority.

## Resolver, authority, and acquisition

`dependency-snapshot.mjs` implements the exact Compiler v0.1 `skillc/snapshot/v1` SHA-256 frame: domain separator, NUL, U32BE file count, sorted UTF-8 filename lengths/bytes, U64BE byte lengths and each raw-file SHA-256 digest. Compiler PR #4 positive vectors are committed as test fixtures; reordering yields the same digest, corruption/path traversal rejects.

The Service never silently upgrades a pinned dependency. `LoadLocked`/build use exact bytes; `Refresh` only inspects drift; `Update Lock` requires explicit user confirmation. Missing snapshot is `BLOCKED`, invalid or tampered bytes `ERROR`, settings write partially failed is `UNCERTAIN` (not a success). The staging directory is not a valid Lock target. Unreferenced immutable snapshots are retained after Remove for shared-source safety.

Source acquisition adapters are `Upload` (YAML/JSON), `MCP` (`tools/list` only, never `tools/call`), `Git` (HTTPS GitHub browser adapter with complete pinned SHA), and a versioned `Built-in` example. The resulting semantic file is always Compiler `skillc.tool/v0.1`. Unverified effect is `UNKNOWN / UNVERIFIED`; MCP annotations never grant READ/MUTATION. Browser CORS/auth restrictions fail visibly, and unsupported Git providers are BLOCKED rather than silently proxied.

`READY` for **dependency snapshot consistency** does not mean Tool Runtime READY. Runtime Provider binding, effect verification and executing Skills/Tools are not part of Studio.

## Build, LSP and output

The one v0.1 Host Adapter constructs Compiler `ProjectContext` and `BuildRequest` from authored `skills/**` plus verified immutable dependency files. `sourceFiles` do not contain `lib`, `output`, `.vscode` or managed storage. The future local Go and online WASM implementations **must** bind to the same Core ABI. There is no Parser/Linker/Schema Generator in Studio.

**Currently Compiler #4 is a draft machine specification without an installed production v0.1 ABI.** The Build TreeView and Check/Build commands display `UNAVAILABLE` and must not call old `lib/` pathways or fake PASS. When Compiler returns actual output, generated files stay in the in-memory result and user-initiated ZIP/directory export only. An exported file is outside Source and freely editable.

Current LSP editor diagnostics do not amount to Compiler diagnostics. Dependency changes invalidate active Package-language generations, but **dependency-qualified Definition/References and shared v0.1 semantic analysis are not fully implemented**. That remaining integration is BLOCKED/PARTIAL, not claimed PASS. Existing Procedure/Contract/Predicate/Schema editors, Markdown, Package/Inspection/Evidence remain in scope for regression.

## Verification and release gates

Focused tests live under `experiments/ide-host/tests/{project-configuration,sample-loader,dependency-snapshot,dependency-service,contract-acquisition,compiler-adapter,plugin-views}.test.mjs`, plus `tests/project-policy.test.mjs`. Browser checks use real Theia Chromium as deployed by the repo workflows. **A unit or static check is not proof of Browser-Only, persisted configuration or Pages deployment.** Exact-head workflow run links and statuses are in [WORK](../WORK.md) and [TRACEABILITY](../TRACEABILITY.md).

This v0.1 migration deliberately abandons the old `skills/lib/output` three-root model. The old doc was superseded **within this same canonical file** to prevent two conflicting project authorities. Studio PR #152 stays Draft and `main` remains unchanged until required gates pass and Compiler ABI blockers are resolved or explicitly accepted as unavailable.
