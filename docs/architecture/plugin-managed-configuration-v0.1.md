# Skill Studio Plugin-managed Configuration & Tool Integration v0.1

**Design status: FROZEN FOR IMPLEMENTATION; not yet deployed.** Date: 2026-11-11. This is the Studio-side contract for [Skill Compiler v0.1 Draft #4](https://github.com/odango-chan/ca-skill-compiler/pull/4). The existing Studio importer, Explorer, LSP and project-policy code are still implementing the earlier `skills/lib/output` model; this document does **not** claim those features have been migrated or verified.

## Decision / ownership

Skill Studio is a **VS Code-compatible IDE extension**, not a project/Tool Runtime registry. Author-facing settings come from the host's native Extension Configuration with native Settings Editor; complex dependency operations use a native TreeView + Command/QuickPick instead of a new mandatory `skill-project.yaml` or a custom configuration Webview. Dependencies, locks and source bytes are distinct from User preferences, transient Workspace UI state, cached content and Build output.

**Contract owner:** Compiler defines only the canonical input wire schemas, language references and deterministic snapshot-digest contract consumed by Check/Build; it does not implement dependency acquisition, resolution, lock management, refresh, package storage or a package-manager lifecycle. Studio owns extension setting keys, host adapters, source acquisition, normalization, immutable snapshot persistence, lock management, refresh/Update Lock and export UX. Agent Host owns Provider Binding / runtime connection / authorization / admission / Tool execution. Studio does not infer READY from MCP discovery or Tool descriptions.

## Extension configuration keys (target, not yet activated)

See machine-readable [studio-settings-contributions.json](../../contracts/v0.1/studio-settings-contributions.json), intended as the `contributes.configuration` source to be integrated into the actual extension `package.json` after Compiler input migration.

| Key | Scope | Default | Writer |
| --- | --- | --- | --- |
| `connectionAgent.skillStudio.skillsRoot` | resource/workspace-folder | `skills` | User via Settings (v0.1 fixed value) |
| `connectionAgent.skillStudio.dependencies` | resource/workspace-folder | `[]` | Dependencies view + validated edit |
| `connectionAgent.skillStudio.dependencyLock` | resource/workspace-folder | `{version:"skillc.lock/v0.1",entries:[]}` | Studio Dependency Service explicit Add / Update Lock |
| `connectionAgent.skillStudio.defaultBuildTarget` | user/application | `all` | User via Settings |

Only resource-scoped selected workspace-folder configuration is authoritative. In multi-root workspaces, ask which root owns a Skill Project, then load/update settings for that root. If the host cannot provide a durable workspace configuration write, fail visibly; **never** silently substitute User Settings, `globalState` or `workspaceState` for shareable dependencies. Theia Browser-only OPFS support must be proved by real browser tests. `contributes.configuration` cannot make JSON manually uneditable; invalid or unrecognized settings must be rejected by Service validation rather than treated as trusted.

Input schema semantics (declaration shape, locked source equality, paths and digest encoding): Compiler's [v0.1 project settings machine contract](https://github.com/odango-chan/ca-skill-compiler/blob/docs/plugin-managed-contract-v01-20261111/contracts/v0.1/project-settings.schema.json). Avoid maintaining a conflicting parser/schema in this repository. The host converts separate setting values into the compiler-owned normalized input projection. The Compiler consumes pinned snapshots; it does not fetch, resolve, acquire or update them.

## Workspace project and persistence

```text
Skill Studio Example/                   # display name, not a mandatory disk folder name
  skills/
    establish-pdu-session/
    establish-pdu-session-mas/
  .vscode/settings.json                 # typical VS Code workspace configuration, host-specific
  .skill-studio/dependencies/<64-hex-digest>/   # created on first lock; managed immutable snapshots
```

No mandatory `lib/`, `output/`, `skill-project.yaml`, `skill.lock.yaml`. `.vscode/` is an IDE storage convention, not a source file requiring hand editing. The managed `.skill-studio/` store is not a source root, nor a publicly exposed language import path. It is created only when importing a dependency and is included when producing a portable project export; the exact location is a Storage Adapter detail, but its content bytes must be recoverable without credentials. User Settings contain layout/default target only; `workspaceState` retains selection/expansion and other disposable UI state; Extension Storage is a *rebuildable* cache; SecretStorage holds credentials.

The default example imports exactly two pinned current owner Skills to an isolated extension-owned **new** project root. It never deletes or overwrites old OPFS workspaces or user edits. Do not scan an unrelated `ensure-pdu-session` fixture or stale legacy Skill as part of the new example. Changing active mounted workspace entries must never repurpose a user-selected folder.

`lib` and `output` icon/readonly guards from the current implementation are **legacy behavior to remove in the migration**, not evidence of a new managed dependency store. Do not introduce custom nonalphabetical Explorer sorting for non-existent lib/output folders. Existing historical projects remain intact until an explicit migration or user removal.

## Acquisition workflow

**Upload:** FilePicker -> bounded YAML/JSON validation -> canonical ToolContract or SchemaBundle -> immutable staged snapshot -> explicit Add confirmation. Uploaded executable code is not Tool authorization. Filename is not an operation identity; raw upload digest binds source bytes.

**MCP:** discovery-only connection (credentials in SecretStorage) -> `tools/list` -> selection of exact tool names -> validate `inputSchema`, preserve optional `outputSchema` -> canonicalize -> immutable snapshot -> explicit Add confirmation. Do **not** call `tools/call`. Annotations/description do not define trusted READ/MUTATION Effect; the canonical contract must record UNKNOWN/UNVERIFIED unless an explicit separately verified Owner contract exists. Multiple servers may expose the same tool name: identity inside Skill is dependency alias + operation ID, not a guessed server-wide ID. The Studio discovery `connectionId` is **not** an Agent Host Provider Binding.

**Git:** HTTPS repository + exact file + requested ref -> Git commit pin and raw content fetch -> canonical snapshot. Git repo location is optional outside Git-type dependencies; no hardcoded `ca-agent-demo` required by source or compiler.

**Built-in:** versioned bundled contract -> snapshot and digest. A Built-in source is not automatically Runtime READY.

Direct URL, Registry and arbitrary Local-path provider executables are out of v0.1 acquisition scope. Private MCP/Git discovery is capability-gated by host origin/CORS, network access and credentials. Failure is BLOCKED, not a fake successful import.

Studio owns the Dependency Service lifecycle: source acquisition, normalization, immutable snapshot creation, lock persistence, refresh and explicit Update Lock. Compiler owns only the deterministic digest definition and canonical input validation contract (including cross-language golden vectors); Studio implements that digest contract. Source adapters may differ (Browser Fetch vs local Git/file), but the resulting immutable ProjectContext must have the same digest across hosts. The Compiler must not grow a Resolver or package-manager lifecycle. Never fetch live network dependencies during LSP analyze, Check or Build.

## Views, commands and user-facing status

Use native contributions:

**Presentation update:** [ADR-0004 · Package-first Workspace](../decisions/0004-package-first-workspace.md) composes the Dependencies and Build projections as sections of one native Package Explorer TreeView inside the built-in Explorer container. This supersedes separate sidebar-panel placement only; the Dependency Service, Compiler adapter, command semantics, persistence, immutable snapshot and ownership contracts below remain unchanged.

- **Settings Editor:** simple options; do not duplicate native Settings as a bespoke Project Settings page.
- **Dependencies TreeView:** acquisition source badge, dependency ID, pinned digest/revision, selected Tool Operations, origin, contract preview, Add, Refresh, Update Lock, Remove. Show `UNKNOWN` Effect without guessing. Refresh discovers drift **without** changing the current lock; Update Lock requires explicit confirmation and should invalidate LSP caches.
- **Build TreeView:** Check, Build, immutable output tree, diagnostic/source navigation, Export ZIP, Export Directory where supported. Build `NOT_RUN/UNAVAILABLE` until the new Compiler is actually integrated. No automatic writes to a project `output/` folder.
- **Package/Problems/Outline:** existing projections remain; Package Overview scans only authored Skills; LSP and Compiler operate on the same pinned `ProjectContext` after host source snapshots are prepared.

All write actions through the Studio extension require explicit validated source revisions and permission checks. Uploaded/MCP snapshots are immutable and cannot be edited as if they were authoritative upstream files. User exported files are ordinary user-owned output and may be modified freely; they do not mutate the BuildResult or source.

## Integration boundaries / precise gates

1. **Compiler first:** merge v0.1 Go API, native CLI, WASM worker, exact logical Tool/Schema refs and cross-language hash golden vectors; no `lib/` fallback. Existing Compiler Draft #2/#3 still pre-v0.1, so do not pretend Studio can call the new API yet.
2. **Settings:** contribute native Settings to actual `experiments/ide-host/vscode/package.json` and test scope/round trip in both VS Code and real Theia Browser-Only. This document's machine-readable contribution object is NOT installed by itself.
3. **Studio Dependency Service/store:** upload and MCP discovery must preserve lock and snapshots across reload, clone/export and cache deletion. Test duplicate aliases, selected tool IDs, tampering, no credentials on disk, and stalled/partial update state. This lifecycle remains in Studio, not the Compiler.
4. **Views:** TreeView/commands interact with the same Services; no alternate config state kept in UI. An MCP source can only be refreshed with a fresh discovery connection, but locked snapshots remain compilable when offline.
5. **Build/LSP:** both read the exact same revision and content digest of dependency snapshots; the Compiler remains Go Core authority for syntax and linking; LSP is editor feedback, not a compiler pass.
6. **Example:** show `Skill Studio Example` with only current two Skills; old browser workspaces kept untouched, not mounted; no fake `lib/output` folders.
7. **Runtime separation:** no Provider Binding Registry or READY proof in Studio. Display external Runtime status only if supplied by the authoritative Host, explicitly labeled informational and untrusted for build decisions.

## Migration status

The code in `sample-loader.mjs` still seeds `lib/output` and mounts `workspaces/`, and `project-policy.mjs` still protects those roots; existing OPFS protection Draft #144 targets that older model. These facts are intentional documentation of pending work. Do not merge #144 as if it implemented this new design. Version the migration so users never lose existing Skills or silently reinterpret their workspaces. The compiler v0 still requires physical `lib/**` and has a separate `InspectLibraries`; do not claim v0.1 runtime readiness until the Go/WASM bridge changes.

**Freeze boundary:** setting keys, scope, source/lock/write ownership, four acquisition paths, immutable store, shared ProjectContext, and separated Host Runtime authority are frozen. Any future source type or wire/identity change requires v0.2 or a separately reviewed breaking amendment. 
