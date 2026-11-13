# SKILL Studio host architecture

**Current online host:** Theia 1.76 browser-only, published at the GitHub Pages root. The previous full browser Studio remains at `/classic/`; `/ide-preview/` redirects to the new root. This is a host migration, not a claim that every historical Classic capability has parity.

## Host responsibilities

- Theia owns the generic IDE shell: Explorer, native Files, editor groups, text editors, save/undo, Outline, Problems and workbench layout.
- Skill Studio contributes Source-backed Procedure, Contract, Predicate and Schema editors; Package Explorer; the right-side Inspector; and bounded Source-aware commands.
- Package Explorer is one native TreeView inside the existing Explorer container. It composes authored Skills with Plugin-managed Dependencies. The host's native Files view remains available. There is no separate Dependencies TreeView or Skill Studio Activity Bar.
- Inspector lives in the native secondary sidebar. Its Data Flow section is a read-only Source projection of Producer / Consumer bindings and Consumer ABI declarations. It is not Runtime Evidence; Runtime Evidence remains `NOT_RUN`.
- Theia Markdown rendering and Preview lifecycle belong to the pinned `vscode.markdown-language-features@1.95.3` extension. Studio contributes the shared preview theme and exact Package-local link policy. `site/markdown-preview.mjs` is retained only by Classic.

## Browser-only host boundaries

The Pages host uses browser OPFS. Files are not written to the user's local disk and are not automatically synchronized to GitHub. The static Pages Webview adapter uses same-origin assets because GitHub Pages cannot provide per-Webview wildcard DNS/TLS; this weakens origin isolation. The deployed workbench displays a warning: do not open sensitive files or untrusted workspaces.

Native Markdown bidirectional scroll preferences are enabled, but actual user-driven editor/preview synchronization and link activation still require manual inspection. Automated acceptance does not synthesize scroll gestures. Desktop VS Code GUI acceptance and Runtime / 5GC execution remain `NOT_RUN`.

## Repository layout

- `vscode/` — shared VS Code-compatible extension source. The browser entry is bundled into Theia at application build time; the Node entry is available for optional local hosts.
- `theia-online/` — Theia 1.76 browser-only application used by GitHub Pages.
- `theia-browser/` — separate backend-backed Theia application used for real Chromium compatibility acceptance; it is not the Pages deployment target.
- `lsp-browser/` — existing browser Language Service client and Worker server.
- `scripts/` — extension build, Theia preparation, static-preview adaptation, Pages composition and real Chromium acceptance.

## Build and test

Use Node.js 24. The CI workflows are the canonical, pinned build recipes:

- `.github/workflows/ide-host-spike.yml` — extension build, focused host tests, root regression suite and optional VSIX packaging.
- `.github/workflows/theia-online-spike.yml` — browser-only Theia build and real headless Chromium acceptance.
- `.github/workflows/theia-browser-host-spike.yml` — backend-backed Theia build and real headless Chromium acceptance.
- `.github/workflows/pages.yml` — Pages composition, exact-SHA provenance and deployment.

Typical source checks from the repository root:

```sh
npm ci
npm test
npm run typecheck
node --test experiments/ide-host/tests/*.test.mjs
node experiments/ide-host/scripts/build-ide-spike.mjs
```

The Theia application builds use separate dependency graphs under `theia-online/` and `theia-browser/`. Follow the corresponding workflow for plugin downloads, application builds, static Webview preparation and Chromium launch; do not reuse generated output between the two hosts.

## Optional VS Code host

The same extension source has Node and browser build entries. Theia Pages uses the browser entry bundled at application build time. Desktop VS Code is an optional host, but desktop GUI acceptance is not claimed by the online Theia CI. See [`vscode/README.md`](vscode/README.md).

## Current cleanup status

Theia cleanup is tracked by [Issue #176](https://github.com/odango-chan/ca-skill-studio-demo/issues/176) and [PR #177](https://github.com/odango-chan/ca-skill-studio-demo/pull/177). The PR removes duplicate Markdown preview paths, the retired standalone Evidence projection and Dependencies TreeView registration path, and stale host documentation. Classic is intentionally untouched. Resulting-main Pages acceptance must be run against the exact merge SHA after merge.