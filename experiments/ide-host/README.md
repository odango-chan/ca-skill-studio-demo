# Skill Studio IDE Host

**Current online host:** Theia 1.76 browser-only, published at the GitHub Pages root. Theia is the sole supported online workbench; there is no Classic browser application or fallback route.

## Architecture

- The same VS Code Web Extension is hosted by Theia online and is intended to remain usable in desktop VS Code.
- The extension owns Procedure / Contract / Predicate / Schema CustomEditors, Package Explorer, Inspector, Outline, Problems, LSP integration and Source/Visual pairing.
- Native Theia / VS Code editor APIs own file editing, TextDocument versions, WorkspaceEdit, Undo/Redo and native Markdown Preview.
- React Flow + ELK provide the Procedure Designer Webview; the Webview is a projection and never becomes a second business source of truth.
- The standalone theme extension owns color, file icon and Markdown preview styles. The declarative language extension supplies offline YAML / Python TextMate grammars.
- The browser LSP Worker consumes the versioned Skill Language contract and project contract snapshot; Compiler remains authoritative for final semantic validation.
- The only active authoring target is CA-SL v1alpha5 (FROZEN / RELEASED), pinned in `language/contracts/ca-sl-v1alpha5.lock.json`. v1alpha4 is only the immutable normative inheritance baseline and historical source, not a product compatibility mode.
- The bundled Compiler v1.0.0 is v1alpha4-only. The current v1alpha5 Compiler candidate [PR #38](https://github.com/odango-chan/ca-skill-compiler/pull/38) is Draft / unmerged and not integrated; Studio therefore blocks Check / Build / Inspect for v1alpha5 rather than attempting an incompatible request or silently lowering Node-entry Wait. See [the v1alpha5 Studio integration boundary](../../docs/design/ca-sl-v1alpha5-studio-preview.md).

## Browser-only limitations

GitHub Pages uses same-origin Webviews for project-site hosting. Treat this as a public demo host: do not open sensitive files. Browser storage is not local disk or GitHub synchronization. The browser-only host does not execute Python, Skill Runtime, Agent, Provider or 5GC operations.

## Build and acceptance

The exact pinned build and real Chromium acceptance commands are maintained in the repository workflows:

- .github/workflows/pages.yml builds the browser-only Pages artifact and deploys only from main.
- .github/workflows/theia-browser-host-spike.yml validates the backend-backed Theia host integration.
- .github/workflows/pr-verify.yml runs repository tests, plugin-managed project tests, TypeScript checks and extension build.

Do not run or restore the retired root-level Classic npm run build or scripts/edge-smoke.mjs entrypoints.
