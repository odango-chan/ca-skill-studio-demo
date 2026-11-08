# Theia browser-only · online Studio host spike

This is an **isolated actual Theia 1.76.0 browser-only application build**.
It is not the existing Pages product, a desktop-only VSIX or a Node-backed IDE.

Run from repository root (Node 24, separate dependency graph):

```sh
npm ci
node experiments/ide-host/scripts/build-ide-spike.mjs
node experiments/ide-host/scripts/prepare-theia-online.mjs
npm install --prefix experiments/ide-host/theia-online --no-audit --no-fund
npm run build --prefix experiments/ide-host/theia-online
```

Theia's `browser-only` target uses browser OPFS, so Explorer file operations
are not writes to the user's local disk or their GitHub repository. The
`plugins/` folder contains the prepared Web entry (same extension source as
VS Code desktop); Theia must include it as a built-in plugin at build time.

Acceptance requires **real browser interaction**: Theia shell opens under
a static subpath; Explorer New File/Folder and reopen persist in OPFS; native
YAML/Python editors open; `assurance/procedure.yaml` invokes the source-backed
CustomTextEditor Webview; changes and native Undo/Save propagate without
clobbering unrelated YAML. An artifact that merely contains bundled files is
not online acceptance. Missing plugin metadata or a CSP/URI failure is BLOCKED.

Existing production Pages at
https://odango-chan.github.io/ca-skill-studio-demo/ is **never overwritten**
by this build. See [ADR-0002](../../../docs/decisions/0002-ide-host-spike.md).
