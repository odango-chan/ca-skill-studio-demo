# Skill Studio LSP · Skill Language v0.2 editor features

**Status:** Definition, References, Hover, Outline and v0.2 symbol navigation are merged. Context-limited v0.2 Completion and link Diagnostics are being implemented on the browser Worker.

## Authority and boundaries

- `odango-chan/ca-skills` is the sole authority for Skill Language v0.2, Script Contract v0, Schema Ownership and semantic-token projection.
- `language/contracts/source/` is a read-only pinned copy of those contracts. Refresh it only from an explicitly selected ca-skills commit.
- The semantic-token registry defines source-position selectors and token identities. It is **not** a grammar, schema validator, linker contract or proof that a reference resolves.
- Compiler Build remains authoritative for parsing, linking, bindings and generated Script Output Schemas. Studio LSP provides responsive editor guidance; it must not invent missing Owner Schemas, Tool Operations or deployment Capability identities.
- The LSP Worker is read-only and receives bounded Package snapshots from the Theia extension host. When the Package is under a recognized Skill Compiler project root, the snapshot also carries the project-level `lib/` directory as logical `lib/...` documents. This is a read-only inventory projection, not dependency acquisition or resolution.
- The Package and project-library inventories have separate completeness. An incomplete `lib/` inventory does not invalidate Package-local navigation, but it suppresses claims that an absent Owner Schema is missing. The Worker does not infer project roots or library paths when the workspace does not expose the exact `skills/`, `lib/`, `output/` layout.
- Cross-file results require the same complete Package generation. Incomplete, stale or mismatched snapshots produce no guessed navigation, completion or link diagnostics.

## Implemented navigation

- Contract `entryProcedure` → exact Procedure declaration.
- Procedure start / route references → node declarations in the same Procedure scope.
- Procedure Predicate references → PredicateSet declarations.
- Procedure `call` → unique imported ToolCatalog Operation.
- Contract Schema path → exact Package-owned Schema document.
- Python Script entrypoint → preferred exact YAML `script:` / `evaluator.ref:` caller location.
- Native Definition, References, Hover and DocumentSymbol providers are exercised through the real Theia editor API. Ctrl/Cmd-click, F12, Peek Definition and Shift+F12 use those native providers.

## v0.2 Completion

Completion is reference-context-only and derives both the cursor context and candidates from the canonical token projection plus the current Package snapshot:

| Source reference | Candidate source |
| --- | --- |
| Procedure identity | Procedure declarations in the same Package |
| Node / route identity | Node declarations in the same Procedure scope |
| Predicate identity | PredicateSet declarations in the same Package |
| Operation ID | Exact imported ToolCatalog Operation declarations |
| Direct Operation grant | Exact imported Operations only; deployment Capability IDs are not enumerable |
| Schema path | Existing Package-owned `schemas/**` and explicit `lib/**.schema.yaml` files |
| Script path | Existing Package-local `scripts/**/*.py` files |

The editor replaces only the exact scalar value range and preserves YAML quoting. Completion does not synthesize structural field names, import dependencies, add missing files, guess Capability IDs, generate Schema contents, or complete Python types. Empty-value / structural-key completion is deferred until ca-skills exposes a machine-readable grammar/schema source that can be consumed without reimplementing the language.

Project-level `lib/` inventory is tracked separately from Skill Package completeness. Imported Operation and `lib/**` Owner Schema Definition, References and Completion require `libraryInventory: complete`. If inventory is partial or unavailable, the editor suppresses imported Operation candidates and links, excludes `lib/` Owner Schema candidates, and does not claim a missing Operation or Owner Schema. Package-local `schemas/**` links remain available from a complete Skill Package. A complete `lib/` inventory makes an unresolved Procedure `call` diagnosable; an unmatched `allowedResources.capabilities[]` value remains non-diagnostic because it may be a deployment Capability ID.

The legacy `# inputSchema` / `# outputSchema` completion remains isolated to legacy metadata files. Canonical Script Contract v0 uses Python `TypedDict` declarations and does not have those comment keys.

## v0.2 link Diagnostics

For a syntactically valid complete Package and the exact current generation, the LSP projects source-token diagnostics for:

- unresolved Package-local Procedure, node, Predicate and Schema references;
- unresolved `lib/**` Owner Schema references only when the project library inventory is complete;
- ambiguous references with multiple exact declarations, including Operations when multiple imported ToolCatalog declarations collide;
- duplicate declarations for a shared symbol identity.

Missing `call:` Operation IDs are **not** diagnosed as unresolved: Operations may be supplied by Built-in or MCP integrations that are not represented by ToolCatalog files. Exact imported ToolCatalog declarations can still be navigated, completed and checked for ambiguity. Unknown `allowedResources.capabilities[]` values are also **not** diagnosed as missing when they do not match an imported Operation: they may be deployment-owned Capability IDs. A matching direct Operation is linked only by exact identity.

Diagnostics use exact UTF-16 AST token ranges and are published through the existing LanguageDiagnosticSession generation gate. They are suppressed for incomplete/stale Packages. Existing Package Audit remains host-owned and is not duplicated by the LSP. These editor findings are advisory; Compiler Build remains the final parse/link/validation authority.

Not included: full YAML Schema validation, structural grammar completion, Python type checking, generated Script Output Schema preview, rename/code actions, Runtime readiness, authorization or execution validation.

## Acceptance

- Unit tests cover exact symbol identity, partial-prefix completion, scoped node candidates, Schema / Script paths, duplicate and missing targets, and suppression for partial or stale snapshots.
- Browser Worker JSON-RPC tests exercise Completion and published Diagnostics alongside Definition, References, Hover, DocumentSymbol and semantic tokens.
- Theia Browser-Only Chromium must exercise public native provider commands on the exact PR head. Worker-only tests are not sufficient.
- Existing Python ↔ YAML Definition precedence, semantic-token rendering, TextMate highlighting, CustomEditor, Inspector, Undo/Redo, Package Audit and Route regressions remain required.
- No PR merge or Pages deployment is implied by this design document; those statuses must be checked independently.
