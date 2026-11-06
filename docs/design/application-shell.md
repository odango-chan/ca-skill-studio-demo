# Application Menu & Local Host Boundary

**Status:** Accepted for the shared command surface; future local execution is **NOT_IMPLEMENTED**.  
**Date:** 2026-11-06 · Track [#78](https://github.com/odango-chan/ca-skill-studio-demo/issues/78)

## Decision: one Studio UI, capability-driven hosts

The same Editor / Explorer / Inspector / Procedure Designer / Monaco / menus are used in all environments. Serving the existing `dist/` from `localhost` is only running **the editor locally**; it does **not** give the browser a Skill execution engine, operating-system process permissions, or connection to ca-runtime.

| Host | Current capability | Future capabilities |
|---|---|---|
| GitHub Pages / browser | Explicit file/directory selection, in-memory Source editing, guarded Patch, user-authorized directory save when browser supports it, downloads | None implied |
| Local HTTP static server | Same browser capabilities as above; HTTPS/secure-context rules can affect directory picker APIs | No automatic execution just because URL is localhost |
| Local Studio host (not yet selected) | **Not implemented** | Explicitly authorized native workspace handles, controlled tool/process execution, selected Runtime connection, local traces |

**Do not couple the menu to Electron, Tauri, WSL, Python or any particular host yet.** The future host must provide a narrow capability adapter; the UI asks which commands are available and delegates to that adapter. No second authoring or YAML business model.

## Menu v1 (implemented in browser)

One compact `菜单` disclosure in the app header, grouped by:

- **文件:** Open file, open Skill directory, load the `establish-pdu-session` sample, save to selected directory (unavailable if not eligible), export current file, export Package ZIP.
- **编辑:** Undo, Redo, reset current file (with existing confirmations).
- **视图:** Visual, Source, Split, Inspector toggle, graph Fit.
- **帮助:** Open actual Workbench user notes.

The existing high-frequency actions stay where users already know them (toolbar and Explorer). Subsequent Explorer consolidation leaves `打开 SKILL 目录` visible and shows `保存到所选目录` only when eligible; file-only open, sample reload and Package ZIP export live in the File menu. Conflict recovery and the real directory/save status messages stay in Explorer. Header export and Undo/Redo remain available as high-frequency controls. No duplicate save, history, source change or permissions handler is created. The menu uses native keyboard focus/disclosure, Escape, click-outside close and disabled state derived from existing controls.

`site/application-menu.mjs` is the current command map and sole menu wiring. Menu item `data-studio-command` values are stable IDs, and each invokes one existing button's handler **synchronously** within the user's gesture; this matters for browser file/directory permission prompts. The menu cannot bypass `disabled`, `hidden`, Source guards or confirmation dialogs. It never reports a write or execution completed merely because a menu item was clicked.

Node operations are **not** global menu actions. A Node card's **查看** is the sole navigation into its one-hop PRE/OP/POST detail; **进入子流程** navigates a real Child Procedure. A single click selects for the Inspector. No double-click activation path remains, including in the local focus graph.

## Evolution without a menu rewrite

Use a small `commandId -> capability/availability -> handler/result` contract when the local host actually exists. Preserve the stable IDs above and add only supported operations:

- `workspace.openDirectory` / `workspace.saveDirectory` may later delegate to a native workspace provider, retaining path/revision/conflict checks.
- `run.start`, `run.stop`, `run.openTrace` belong to a **separately authorized execution provider**, never to the YAML editor. The Run menu is **absent until a real provider exists**; not a disabled pretend button.
- Store any Run result outside the Source editor work buffer and report the true origin, attempt, status and trace identity. Never substitute editor schema warnings for Runtime qualification or a synthetic PASS.
- Explicit user confirmation and local authorization are necessary before executing scripts, tools or network/5GC actions from an imported Skill. No auto-run upon file open or tab selection.
- Capability absent/offline: command not offered (or clearly disabled where discovery matters), never silently falls back to a different host.

Native shell/framework decision is deferred until local execution requirements and security boundaries are concrete. This v1 makes that decision **additive**, not a second UI implementation.

## Next UI refinements (not claimed implemented)

1. **Explorer low-frequency command consolidation:** implemented by [Issue #80](https://github.com/odango-chan/ca-skill-studio-demo/issues/80) / pending PR gate. UI duplicates are CSS-concealed, not moved into a hidden DOM subtree; the exact existing click handlers remain mounted and their `hidden`/`disabled` state still determines menu eligibility. This is a browser-only action bridge, not a new filesystem abstraction.
2. Compact the top-level header spacing and show the current workspace state consistently, including read-only/dirty/saved distinctions; do not advertise browser download as Save.
3. Define local execution's actual owner interface, authorization model and real trace inputs **before** exposing Run/Debug. Do not introduce a fake Runtime in Studio.
4. Test real Windows/macOS native filesystem authorization separately; Chromium CI cannot replace physical folder-picker acceptance.

See [Workbench](authoring-workbench.md), [Ownership](../architecture/studio-boundaries.md) and [WORK](../WORK.md).
