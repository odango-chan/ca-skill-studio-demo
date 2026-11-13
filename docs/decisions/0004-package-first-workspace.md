# ADR-0004 · Package-first Workspace and Unified Package Explorer

**Status: Accepted · initial Package Explorer implementation merged in PR #175; follow-up lifecycle UI remains deferred · Date: 2026-11-12**

**Supersedes:** ADR-0003 §2 only for the primary-sidebar ordering and the user-facing placement of Package / Dependency / Build navigation. It also supersedes the presentation assumptions in the C4 Package Overview note that Packages are only a secondary inventory inside a dedicated Skill Studio Activity Bar.

**Does not supersede:** ADR-0001 Source-first authority and bounded Source Patch rules; ADR-0003's native workbench ownership, right-side Inspector, native Outline / Problems, Data Flow semantics, Markdown behavior, or Classic retirement gates; the frozen Plugin-managed Configuration & Tool Integration v0.1 ownership and persistence contract.

## Context

The current Package Overview is a useful, tested inventory of authored Skill roots. It groups each Skill's files by role and opens the existing CustomEditors or native source editors. However, it is still presented as a secondary inventory while the generic physical File Explorer is treated as the default project navigation surface.

That is the wrong default for a domain IDE. Skill authors primarily work with Skills and their managed project inputs and outputs, not with arbitrary filesystem paths. The physical file tree remains useful, but it should be a secondary, general-purpose view.

The Plugin-managed Configuration v0.1 contract already distinguishes:
- user-authored Skill Source;
- Plugin-owned dependency declarations, immutable snapshots and lock state;
- Compiler-owned Build input and BuildResult;
- user-owned exported copies.

Those are logical project resources and do not require fixed `lib/` or `output/` directories. The UI must reflect these existing ownership boundaries rather than reintroducing the old three-directory model or creating a second package manager.

## Decision 1 · Package Explorer is the default project surface

Use the host's existing **Explorer** view container (the native VS Code / Theia Explorer container). Do not contribute a separate Skill Studio Activity Bar or a second workbench shell.

Logical navigation priority is:

1. **Package Explorer** — the first Studio-contributed project view and visible by default.
2. **Files** — the host's native physical workspace file tree, always retained and never duplicated or hidden by Studio.
3. **Outline** — the host's native document-symbol view, following the active editor.

**Host API ordering constraint:** VS Code's `contributes.views` supports first-workspace visibility (`visibility: visible`) but does not expose a supported ordering property that can force an extension-contributed view above the built-in Files view. Therefore Package Explorer is first among Studio-contributed views and is visible/expanded on first workspace open; its exact relative position to the built-in Files view is host-owned. Theia and desktop VS Code acceptance must record the actual default. Users may drag Package Explorer above Files, and Studio must respect the host's persisted layout. Do not patch internal workbench models, hide the native Files view, or claim an ordering guarantee the extension API does not provide.

Package Explorer must not steal keyboard focus from the active editor or repeatedly reopen itself after a user closes, moves or collapses it. The manifest's `visibility: visible` is a first-workspace default only; subsequent user layout choices take precedence.

Keep the existing stable `skillStudio.packages` view identity. The user-facing title becomes **Package Explorer** and its first-workspace manifest visibility is `visible`. The view is contributed to the built-in `explorer` container; no custom `viewsContainers.activitybar` entry is allowed.

## Decision 2 · One coherent Package Explorer projection

Package Explorer is one native TreeView with three logical top-level sections:

### Skills

- Show authored Skill Packages under the selected Project's configured `skillsRoot` (v0.1 currently fixes the default root to `skills`).
- Preserve the existing C4 Package inventory behavior: multiple and incomplete Skills remain visible; files are grouped by their existing semantic roles (Skill Definition, Assurance, Schemas, Scripts, References and Other); bounded scans must report truncation rather than imply a complete inventory.
- Package rows and file rows navigate to the existing Procedure / Contract / Predicate / Schema CustomEditors or native Source editors. Do not create a second parser, Package Audit or Source model.
- The inventory is a navigation projection, not semantic validation, Compiler qualification, Runtime readiness or execution evidence.

### Dependencies

- Render the declarations and pinned lock entries owned by the Plugin-managed Dependency Service. Show source kind, origin, pinned revision / digest, selected Tool operations and integrity / availability state when known.
- Schema Bundles and Tool Contracts are dependency resources; do not create a new generic Tools registry or infer Runtime authorization from their presence.
- Dependency content is inspectable but **read-only by default**. Do not expose direct Edit, Rename or Delete Content operations for imported snapshots.
- Supported lifecycle commands remain Add, Refresh, Update Lock and Remove, delegated to the Dependency Service:
  - Add performs the existing source acquisition and explicit confirmation flow.
  - Refresh detects upstream drift without changing the current Lock.
  - Update Lock is explicit, validated and confirmed; it creates/selects a new immutable snapshot.
  - Remove removes the dependency declaration and lock reference. Physical snapshot cleanup is managed and may occur only when no remaining project reference needs that snapshot.
- A digest mismatch or tampered snapshot is reported as invalid and rejected by consumers. Do not silently rewrite it from the network or treat a hidden tree node as an integrity guarantee.
- The physical `.skill-studio/dependencies/` store is an implementation-owned persistence detail, not a user-authored Skill root or a public import path. Package Explorer shows logical Dependency nodes, not editable copies of the store files.

### Build Artifacts

- Show this section only when an actual Compiler-owned BuildResult is available.
- A BuildResult and its generated file tree are immutable and remain owned by the Compiler / Build adapter.
- If the real Compiler adapter / ABI is unavailable, do not create an empty `output/` folder, a fake artifact node, or a permanent Build panel whose only state is UNAVAILABLE. Do not claim a Build has run.
- Build diagnostics belong in native Problems; build logs belong in native Output. Build / Check / Export commands are offered only when the corresponding real adapter capability exists.
- Export ZIP / directory writes an independent copy to the user-selected destination. The exported files are ordinary user-owned files and may be edited, moved or deleted without mutating the BuildResult or original Source.

The three sections are a **presentation composition**, not a new owner or storage layer. Package Explorer may compose projections supplied by the existing Package inventory, Dependency Service and Compiler adapter. Those services retain their own contracts and can remain independently tested. Do not duplicate their state or lifecycle inside the TreeView.

## Decision 3 · Package-aware Source file operations use the host filesystem

Package Explorer is not a read-only catalog. For user-owned Skill Source it provides domain-aware operations such as:

- New Skill (where the selected project and approved starter template support it);
- New Procedure, Script or Reference;
- Import Source File;
- New Folder;
- Rename / Move / Delete user-owned Source files or folders;
- Open in the appropriate existing editor.

These commands validate the selected Project root, exact Source URI and resource ownership, then delegate physical operations to the host's VS Code-compatible Workspace FileSystem API / WorkspaceEdit. The Studio view does not implement a filesystem, duplicate file persistence, or keep a second authoritative file tree.

Structured YAML content changes continue to use the existing Source-first revision, eligibility, Diff, confirmation, Undo / Redo and WorkspaceEdit rules. File operations must respect dirty open documents and must not silently discard unsaved buffers. Destructive Package / folder removal requires explicit confirmation and must remain within the selected user-owned Source root.

The native Files view remains available for general physical filesystem operations. Changes made there, through Git, or by external tools must be reflected by the Package projection through host file events and explicit refresh. If a host cannot report a change reliably, the view must show an unavailable / stale state rather than silently claim that its inventory is current.

**Important limitation:** an extension-owned command guard is not a security boundary around every native Explorer, external editor or operating-system filesystem operation. Dependency integrity therefore relies on immutable-snapshot ownership within Studio plus digest verification at read / Check / Build boundaries. UI hiding, icons and context-menu omission are not substitutes for validation.

## Decision 4 · Ownership is semantic, not path-based

| Resource | Authority / owner | Package Explorer behavior |
|---|---|---|
| Skill Source | User | Editable through existing Source / Designer and Package-aware filesystem commands |
| Dependency declaration and lock | Studio Plugin / Dependency Service | Manage through validated lifecycle commands |
| Dependency snapshot bytes | Studio-managed immutable store | Inspect read-only; verify digest; never hand-edit |
| BuildResult | Compiler / Build adapter | Inspect immutable result and diagnostics |
| Exported files | User | Independent editable copy |

Do not infer permissions from a path named `lib`, `output`, `schemas` or any other directory name. Resource ownership, provenance, revision and the responsible service determine allowed operations.

There is no mandatory `lib/`, `output/`, `skill-project.yaml` or `skill.lock.yaml`. Do not restore the retired three-directory model. Do not introduce a generic Resource Type registry, Resolver framework or package-manager lifecycle as part of this UI change.

If a user needs to customize an imported Schema, that requires creating a separate user-owned Source asset and updating its explicit references under the applicable Skill contract. It does not authorize editing or overriding the original dependency snapshot. Automatic fork / override / patch semantics are out of v0.1 scope.

## Decision 5 · Preserve the rest of the accepted native workbench

- **Inspector** remains in the native right-side Secondary Sidebar and is a property editor, not another navigation tree.
- **Data Flow** remains contextual within Inspector and is static Source analysis, not Runtime Evidence.
- **Outline** remains the host-native DocumentSymbol view; do not restore a custom Procedure Outline.
- **Problems** remains the single native diagnostics surface for LSP and Package Audit.
- **Output** remains the host-native log surface.
- Markdown defaults to the paired editable Source + read-only native Preview experience in Theia through the pinned VS Code Markdown extension (PR #169); the shared theme and exact Package-local link/security policy remain Studio-owned. Full host acceptance-harness closeout is tracked by #176.
- Procedure / Contract / Predicate / Schema CustomEditors and all existing Source Patch invariants remain unchanged.

Package Explorer does not absorb Inspector, Outline, Problems, Package Audit or the Procedure Designer. It is the project navigation and resource-operation surface.

## Decision 6 · Multi-root, first-run and migration behavior

- In a multi-root workspace, the user explicitly selects which workspace folder owns the Skill Project. Never infer or silently switch the authoritative root.
- Package Explorer reflects the selected ProjectContext. Switching roots changes the displayed projection, not the contents of another root.
- The default two-Skill Example remains an isolated example project. Loading it must not overwrite, delete, migrate or repurpose existing OPFS workspaces or user-selected folders.
- Existing Package Overview scanning and stable file navigation are reused. Dependency snapshots and BuildResults are supplied by their owners; they are not discovered by scanning the Skill Source tree.
- Existing workspace layout and user files remain intact. Any migration of view placement or internal persistence must be versioned and non-destructive.

## Implementation sequence

1. Reconcile the Plugin-managed v0.1 implementation with current `main`; preserve the existing Settings, acquisition, snapshot, lock and Compiler-adapter ownership.
2. Move the existing Package view into the native Explorer container and make it the first/default-expanded view. Keep native Files below it. Remove any separate Skill Studio Activity Bar contribution.
3. Compose Skills, Dependencies and actual Build Artifacts into the single Package Explorer TreeView by consuming the existing owner services; do not copy their state or lifecycle.
4. Add Package-aware Source file operations through the host filesystem API, with root / ownership / dirty-buffer guards and native file-event refresh.
5. Add dependency integrity and read-only interaction acceptance, then expose Build Artifacts only after a real Compiler adapter produces a BuildResult.
6. Run exact-head unit, typecheck, build, Theia Browser-Only Chromium, backend Theia Chromium and Pages gates. Separately verify desktop VS Code view placement and file operations. Do not infer one host's result from another.

## Acceptance gates

1. A fresh Theia Browser-Only and backend Theia workspace opens with Package Explorer visible and expanded in the native Explorer container; it is first among Studio-contributed views, native Files remains available, and no separate Skill Studio Activity Bar exists. Record its actual relative position to built-in Files in each host; do not claim a cross-host ordering guarantee. Verify that user drag/reorder persists.
2. Package Explorer contains one coherent Skills / Dependencies / Build Artifacts hierarchy. Dependency and Build sections consume their authoritative services; no duplicate state or second package manager exists.
3. Existing two-Skill discovery, incomplete-Package visibility, file-role grouping, exact-URI editor navigation, refresh and expansion-state regressions pass.
4. Package-aware Source create / import / rename / move / delete operations use the host filesystem API, enforce selected-root and ownership checks, preserve dirty buffers, and refresh after both Studio and native / external file changes.
5. Imported Dependency snapshots have no direct content mutation commands; Refresh leaves Lock unchanged; Update Lock is explicit; Remove changes declaration / lock ownership safely; tampering is detected by digest verification and fails closed.
6. No Build Artifacts are shown without a real BuildResult. A real BuildResult is immutable; export creates independent user-owned files and cannot mutate Source or the result.
7. Native Outline, right-side Inspector / Data Flow, Problems, Markdown Source + Preview, CustomEditors, LSP and existing visual-edit regressions remain intact.
8. Multi-root selection is explicit; old OPFS and user workspace data remain untouched.
9. No Runtime / Provider Binding / Tool execution / 5GC readiness or qualification claim is added.

## Non-goals

- Reintroducing `skills/lib/output` as a mandatory project layout.
- Building a second filesystem or generic file manager.
- Building a new package manager, Resolver, Registry or Resource Type plugin framework.
- Treating a dependency snapshot as a Runtime Tool authorization.
- Creating placeholder Build outputs or pretending an unavailable Compiler has run.
- Replacing the host's native Explorer, Outline, Problems, Output, menus or editor groups.
- Adding a dedicated Skill Studio Activity Bar.
- Changing Skill language, Compiler machine contracts, Agent Host Runtime authority or 5GC behavior.

## References

- [Plugin-managed Configuration & Tool Integration v0.1](../architecture/plugin-managed-configuration-v0.1.md)
- [ADR-0001 · Source-first Visual Editing](0001-source-first-visual.md)
- [ADR-0003 · Native Workbench, Inspector and Markdown](0003-native-workbench-and-markdown.md)
- [C4 · Package Overview baseline](../design/package-overview-c4.md)
- [Issue #173 · Package-first workspace implementation](https://github.com/odango-chan/ca-skill-studio-demo/issues/173)
