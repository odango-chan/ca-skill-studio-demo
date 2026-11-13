# Source + Visual Editor Pairing

## Decision

Skill Studio uses one consistent two-column workbench convention for every supported file that has a meaningful preview or Designer:

- **Left editor group: Source** — the native editable document and the only persistence/undo authority.
- **Right editor group: Visual** — a read-only projection, preview, or source-backed Designer.
- Files without a supported visual projection remain ordinary Source-only editors.

This is a workbench layout contract, not a new document model and not a second editing authority.

## Supported pairs

| Source | Visual owner |
| --- | --- |
| `.md`, `.markdown` | Pinned built-in VS Code Markdown Preview |
| `assurance/procedure.yaml` | Procedure Designer |
| `assurance/contract.yaml` | Contract Designer |
| `assurance/predicates.yaml` | Predicate Designer |
| `schemas/*.schema.yaml` | Schema Designer |

The Markdown renderer remains the built-in Markdown extension. YAML projections remain owned by their existing Skill Studio Designer providers.

## Interaction contract

1. Opening a supported Source from Explorer, Package Explorer, or an internal reference opens its Visual in editor group two and its native Source in editor group one.
2. Source and Visual refer to the same URI and the same live TextDocument. No copied YAML/Markdown buffer is introduced.
3. Source edits remain native editor edits and retain native Save, Undo, diagnostics, language services, and document versioning.
4. Visuals refresh from the current Source revision. A stale visual action must continue to fail closed using the existing revision guards.
5. Cross-file navigation follows the same pairing rule for the destination file. Source line navigation always targets the left editor group.
6. Unsupported files do not receive empty or placeholder visual tabs.
7. If the host cannot provide a second editor group, it may degrade to the existing single-editor behavior; it must not invent a separate Source copy or change the write owner.

## Implementation boundary

YAML CustomEditors are registered with `priority: option`, and Theia must not force them through `workbench.editorAssociations`. Native text editing therefore opens first; the extension's active-editor hook then opens the matching Visual in the right group. Explicit Designer commands and cross-file navigation use the same orchestration.

`source-view-pair.mjs` owns the common YAML Source/Designer placement and destination mapping. Each Designer continues to own its projection, webview lifecycle, source-change subscription, and domain-specific interactions. Markdown continues to use the built-in Markdown Preview integration, because its renderer and scroll synchronization are native extension responsibilities.

The shared pairing helper must not absorb YAML parsing, projection, editor rendering, mutation policy, Markdown rendering, or package semantics.

## Acceptance

For every supported YAML pair, real Theia/Chromium acceptance must verify:

- exactly one editable Source tab for the target URI in the left editor group;
- exactly one matching Designer tab in the right editor group;
- Source edits update the corresponding visual without reopening a second document;
- navigating to a referenced supported file places its Source/Designer pair in the same fixed columns;
- unsupported YAML remains Source-only.

Markdown acceptance separately verifies one native Source-left / Preview-right pair, built-in rendering, live updates, and native scroll synchronization.
