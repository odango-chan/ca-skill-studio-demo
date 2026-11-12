# Theia browser-only · GitHub Pages host

This is the Theia 1.76 browser-only application used by the default online SKILL Studio deployment. GitHub Pages serves it at `/`; the previous full browser Studio remains at `/classic/`. The former `/ide-preview/` path redirects to `/`.

## Build

Use Node.js 24 and run from the repository root. The pinned sequence is maintained in `.github/workflows/theia-online-spike.yml` and `.github/workflows/pages.yml`:

```sh
npm ci
npm ci --prefix experiments/ide-host/lsp-browser/client --omit=dev --no-audit --no-fund
npm ci --prefix experiments/ide-host/lsp-browser/server --no-audit --no-fund
node experiments/ide-host/scripts/build-ide-spike.mjs
node experiments/ide-host/scripts/prepare-theia-online.mjs
npm install --prefix experiments/ide-host/theia-online --no-audit --no-fund --ignore-scripts
npm run download:plugins --prefix experiments/ide-host/theia-online
npm run build --prefix experiments/ide-host/theia-online
```

The Pages workflow then prepares the same-origin Webview assets, brand and host shell, checks the generated frontend, composes Theia at the root while preserving Classic, and verifies build provenance against the exact source SHA. Follow the workflow for the complete release sequence.

## Bundled extensions and ownership

The web extension, Skill Studio theme, YAML/Python TextMate grammars and pinned `vscode.markdown-language-features@1.95.3` extension are bundled at application build time. Browser-only Theia does not install the VSIX dynamically through its Extensions UI.

Package Explorer is one native Explorer TreeView that composes Skills and Plugin-managed Dependencies. Native Files remains available. The right-side Inspector contains Source-derived read-only Data Flow; the retired standalone Evidence view is not part of this host. The native Markdown extension owns Preview rendering and lifecycle; Studio supplies the shared theme and Package-local link/security policy.

## Browser storage and Webview security

The browser-only host uses OPFS. Workspace files are stored in the browser profile; they are not written to the user's local disk and are not automatically synchronized to GitHub.

GitHub Pages cannot provide the wildcard DNS/TLS needed for Theia's per-Webview subdomains. The static Pages adapter therefore copies Theia's Webview bootstrap assets and uses a same-origin Webview pattern. This deliberately weakens origin isolation. The deployed page displays a warning: **do not open sensitive files or untrusted workspaces**. This adapter is specific to the static demo deployment; do not reuse it as a general production security configuration.

## Acceptance

`theia-browser-smoke.mjs` exercises the generated Theia shell in real headless Chromium. The Browser-Only workflow verifies the actual browser-only build, native editor integration, Package Explorer, Inspector Data Flow and browser Language Service. A successful artifact build alone is not acceptance.

Native Markdown bidirectional scroll preferences are enabled, but real user-driven Source/Preview synchronization and link activation remain manual inspection items. Desktop VS Code GUI and Runtime / 5GC execution are not established by this workflow.

The backend-backed Theia Chromium comparison host is separate: [`../theia-browser/README.md`](../theia-browser/README.md).