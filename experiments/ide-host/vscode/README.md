# SKILL Studio VS Code-compatible extension

This folder contains the shared VS Code API extension used by the online Theia host and optional local VS Code-compatible hosts. The extension does not own a second IDE shell or a separate editable Source buffer: native host editors, TextDocuments, WorkspaceEdits, save and undo remain authoritative.

## Editors and views

- `assurance/procedure.yaml` opens the Procedure visual editor by default.
- `assurance/contract.yaml` opens the Contract visual editor by default.
- `assurance/predicates.yaml` opens the Predicate visual editor by default.
- `schemas/*.schema.yaml` opens the read-only Schema visual editor by default.
- Other YAML, Python, JSON and Markdown files use the host's native editors. The pinned VS Code Markdown language-features extension owns Theia's Markdown Preview.
- Package Explorer is contributed to the host's existing Explorer container. It is a single TreeView that composes Skills and Plugin-managed Dependencies; native Files remains available.
- Inspector is contributed to the right-side secondary sidebar. Its contextual Data Flow is a read-only Source-derived Producer / Consumer and Consumer ABI projection, not Runtime Evidence.

Package Explorer inventory is not semantic validation or Compiler qualification. Imported dependency snapshots remain Plugin-owned and read-only by default. Build Artifacts are not shown without a real Compiler BuildResult.

## Build

From the repository root with Node.js 24:

```sh
npm ci
node experiments/ide-host/scripts/build-ide-spike.mjs
node --test experiments/ide-host/tests/*.test.mjs
```

The build emits host-specific extension bundles and the Procedure webview assets. The `browser` entry is staged as a built-in plugin when building Theia; it is not installed dynamically into the browser-only app. The `main` entry is the optional Node host entry.

## Optional local VS Code

To open an Extension Development Host, use the repository's VS Code launch configuration or run:

```sh
code --extensionDevelopmentPath="$PWD/experiments/ide-host/vscode" \
     "$PWD/site/samples/packages/establish-pdu-session"
```

Desktop VS Code GUI behavior has not yet received the same real-browser acceptance as Theia; treat it as an optional host path, not as a separately qualified product deployment.

## Theia

The default online product is Theia 1.76 browser-only at GitHub Pages `/`. Its browser extension is bundled into the application at build time. Browser-only Theia uses OPFS rather than the user's local disk or automatic GitHub sync. The static Pages Webview adapter uses same-origin assets and weakens origin isolation; do not open sensitive files or untrusted workspaces in that deployment.

The separate backend-backed Theia app is a Chromium compatibility target. Its CI-only `THEIA_WEBVIEW_EXTERNAL_ENDPOINT={{hostname}}` setting is not a production security configuration.

See [`../README.md`](../README.md), [`../theia-online/README.md`](../theia-online/README.md) and [`../theia-browser/README.md`](../theia-browser/README.md) for host-specific details.

## Acceptance boundaries

Theia Browser-Only and backend Chromium acceptance cover the active extension integration. Native Markdown scroll preferences are enabled, but actual bidirectional scroll behavior and link activation still require manual inspection. Runtime / 5GC execution is outside this extension's authority and remains `NOT_RUN`.