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
- `skills/` holds actual editable authoring Source (including each Skill's `assurance/`, `schemas/`, `scripts/`, and `references/`). The two pinned owner Skills are imported here, with no implicit overwrite.
- `lib/` is reserved for user-imported Tool contract snapshots. The sample importer creates the empty directory and **does not write fake library contracts**. Read-only is an ownership policy, not a filesystem permission claim in the current browser host.
- `output/` is reserved for `skillc build` results. The importer creates the empty directory and **does not fake a build**, publish or execute anything.
- Package Overview scans only the Source subtree `skills/` when a project root contains it; it cannot claim that `lib/` or `output/` contains additional authored SKILL Packages. Standalone and legacy folder workspaces remain supported.
- The example project is isolated at extension-owned `workspaces/skill-studio-demo`. Earlier `workspaces/skills` files are **left untouched**; no silent rename, migration, deletion or overwrite occurs. Existing user workspaces are not chosen as import targets. Users can manually move or import historical edits after inspecting them.
- The bundled source fixture remains `site/samples/skills/` for packaging tests; it is **not** the runtime editable project root.

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
