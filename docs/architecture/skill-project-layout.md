> **Current v0 implementation, superseded as a target design.** The frozen [Plugin-managed Studio v0.1 contract](plugin-managed-configuration-v0.1.md) removes required `lib/output` directories. Existing code and tests still use the earlier layout; this file describes the *current* implementation, not v0.1. Do not treat this note as a deployed change.

# SKILL Project layout and future Compiler integration

**Status:** Studio workspace layout implemented in the example importer; Compiler integration remains **NOT_IMPLEMENTED** (2026-11-11).

## Canonical editable project

```text
<project-root>/
├── skills/
│   ├── establish-pdu-session/
│   │   ├── SKILL.md
│   │   ├── assurance/
│   │   ├── schemas/
│   │   ├── scripts/
│   │   └── references/
│   └── establish-pdu-session-mas/
│       ├── SKILL.md
│       ├── assurance/
│       └── schemas/
├── lib/       # imported Tool contracts; user-selected, treated as read-only inputs
└── output/    # compiler-generated output tree; never an editable Source input
```

This layout intentionally matches the [`ca-skill-compiler` README](https://github.com/odango-chan/ca-skill-compiler): stateless project-root operations `skillc check <project>` and `skillc build <project> --out <directory>`.

### Ownership and lifecycle

- `<project-root>` is the Workspace root. **Do not** open just `skills/` as the default Workspace.
- `skills/` holds actual editable authoring Source (including each Skill's `assurance/`, `schemas/`, `scripts/`, and `references/`). The **top-level `skills/` directory itself is structural and protected** (no rename/move/delete via Studio-owned actions); its SKILL files and child directories remain editable. The two pinned owner Skills are imported here, with no implicit overwrite.
- `lib/` is a **read-only, protected root** of imported Tool contract snapshots. Users can inspect but not hand-edit, rename, move, delete or create files inside it through Studio-owned commands. Only a future **explicit managed Tool import/sync** may replace its contents. The sample importer creates the empty directory and **does not write fake library contracts**.
- `output/` is a **read-only, protected root** for generated `skillc build` results. Users can inspect, but not hand-edit, rename, move, delete or create files inside it through Studio-owned commands. Only the future Compiler adapter may write or clean output with its bounded capability. The sample importer creates the empty directory and **does not fake a build**, publish or execute anything.
- Package Overview scans only the Source subtree `skills/` when a project root contains it; it cannot claim that `lib/` or `output/` contains additional authored SKILL Packages. Standalone and legacy folder workspaces remain supported.
- The example project uses extension-owned `workspaces/` as its root, shown in Explorer as **skill-studio-demo**. The existing `workspaces/skills/` directory is reused in place as the project's `skills/` (no copying, deleting, renaming or overwriting user-edited Source); empty sibling `lib/` and `output/` directories are created. When the old extension-owned `skills/` root is already mounted as a Workspace, only that Workspace entry is replaced by its parent project root. Unrelated user workspaces are not repurposed or removed.
- The bundled source fixture remains `site/samples/skills/` for packaging tests; it is **not** the runtime editable project root.

## Protected project folders: implementation boundaries

| Project path | User-owned Source edits | Studio structural operations | Managed owner |
| --- | --- | --- | --- |
| `skills/` itself | N/A | Rename / move / delete **denied** | Project layout |
| `skills/<name>/**` | **allowed** | Normal authoring within Source | Studio editor |
| `lib/` and descendants | **read-only** | Rename / move / delete / manual create **denied** | Imported Tool contracts |
| `output/` and descendants | **read-only** | Rename / move / delete / manual create **denied** | Skill Compiler adapter |

The icon theme distinguishes Source (`folder-skills`), read-only library
(`folder-library` with lock), and generated output (`folder-output`).
Icons are visual cues, not access controls.

`project-policy.mjs` performs an exact project-root/URI check (including
scheme/authority and lexical containment). Studio-owned Workbench and
Procedure Source patches refuse writes to `lib/`, `output/` and the protected
structural roots. Managed import/build operations have *distinct* authorized
operation identities and cannot mutate the structural root itself.

**Known enforcement gap:** the standard native Theia/VS Code Explorer and
`workspace.fs` belong to the host. An extension-side guard cannot intercept
every Explorer action, outside tool, direct FS call, or another plugin. The
`files.readonlyInclude` preference is supported by VS Code but is not
evidence of reliable enforcement by Theia 1.76. Until host-side filesystem
permissions or a project-aware FS provider are implemented and verified,
`lib/` and `output/` are **policy read-only, not a security boundary**.
Do not claim hard write protection based solely on these icons and preflights.

For the final enforcement gate, test native Explorer rename/move/delete/create,
direct TextDocument edit/save, `workspace.applyEdit`, `workspace.fs`
write/rename/delete, external imports and compiler-owned writes in the real
Browser-Only host and desktop VS Code. A host-level denial must be observed
before reporting "filesystem protected." Do not block managed Compiler output.

## Compiler ownership boundary

`ca-skill-compiler` is the **sole owner** of multi-Skill compilation and linking semantics. Studio stays an IDE/authoring client. Existing Monaco/LSP services and Package Audit are editor hints, not substitutes for `skillc check`, and should not be renamed or presented as Compiler PASS.

When the compiler implementation stabilizes, integrate one adapter with:

1. **Project discovery:** use the active Workspace root, require a `skills/` directory, resolve `lib/` only as imported contracts and `output/` only as output. Never traverse or compile arbitrary `node_modules` or files outside the chosen project.
2. **Compiler input:** snapshot the current Source-owned project files (including unsaved buffers explicitly, where supported); preserve exact URI, revision and source digests. Do not invent a second semantic compiler in JavaScript.
3. **Commands:** expose user-initiated Check and Build backed by the upstream `skillc` core; no automatic build when merely editing or opening a file. Display `NOT_RUN` or `UNAVAILABLE` until a real compiler result exists.
4. **Compiler output:** write only under an explicitly selected output directory (normally `output/`), with path containment, bounded inputs, no accidental overwrite of `skills/` or `lib/`, and stale-revision rejection. Build output is not imported back into source.
5. **Diagnostics:** map versioned Compiler diagnostics into native Problems without taking ownership of Source files or conflating results with LSP/Package Audit. Exact schema, source span and status model remain pending upstream contract stabilization.
6. **Two hosts:** desktop/Node may use a local Compiler CLI once defined; static GitHub Pages must use the upstream WASM-compatible core and cannot assume a server, local binary or filesystem permission. Same compiler semantics, platform-specific IO adapters.
7. **Non-goals:** Skill execution, Runtime readiness, Qualification, release/publishing, 5GC operation and Tool invocation remain outside Studio and the stateless Compiler.

No compiler binary, WASM bundle, CLI subprocess or invented result JSON is shipped by this change. This is a **project layout and integration boundary**, not a completed Compiler integration.

## UX acceptance

The import action is explicit. It creates/opens the isolated project root, opens the conventional 5GC visual Procedure, switches to the native Skill Studio Packages view when supported, then attempts to expand both Skill roots through the native TreeView API. The Packages title bar also offers the import action for sessions where the Explorer welcome page is not shown.

Browser and unit acceptance should verify both SKILLs are discoverable under `skills/`, `lib/` and `output/` are empty, duplicate imports preserve user edits, and Packaged Contract links still open each exact Source URI. Neither Source files nor the folder structure may imply a successful Compiler build.
