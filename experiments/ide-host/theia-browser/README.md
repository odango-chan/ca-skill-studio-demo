# Theia backend-backed Chromium acceptance host

This is a separate Theia 1.76 browser frontend plus Node backend used to verify the VS Code-compatible extension against a real Theia Webview endpoint. It is a compatibility and regression target for `.github/workflows/theia-browser-host-spike.yml`; it is not the GitHub Pages deployment target.

## Build and smoke test

Use Node.js 24 from the repository root. The workflow is the canonical pinned sequence:

```sh
npm ci
node experiments/ide-host/scripts/build-ide-spike.mjs
node experiments/ide-host/scripts/prepare-theia-online.mjs
npm install --prefix experiments/ide-host/theia-browser --no-audit --no-fund
npm run download:plugins --prefix experiments/ide-host/theia-browser
npm run build --prefix experiments/ide-host/theia-browser
```

The backend supplies Theia's `/webview` endpoint for the CustomEditors. CI sets `THEIA_WEBVIEW_EXTERNAL_ENDPOINT={{hostname}}` only for its local smoke test. This removes per-Webview subdomain isolation to avoid requiring wildcard DNS/TLS in the test runner; it is **not** a production security setting.

## Production boundary

A secured backend-backed deployment should retain per-Webview subdomains and configure wildcard DNS, TLS and a reverse proxy. The current Pages product instead uses the browser-only static adapter described in [`../theia-online/README.md`](../theia-online/README.md), with an explicit warning because that adapter weakens Webview origin isolation.

The Browser Host workflow runs the shared real Chromium acceptance against this backend-backed host. It does not establish desktop VS Code GUI acceptance or Runtime / 5GC execution.