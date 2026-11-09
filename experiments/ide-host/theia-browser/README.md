# Theia browser (backend) host trial

This is the comparison host for the browser-only Theia experiment.

- Target: `browser` (normal Theia frontend + Node backend).
- The same prebuilt SKILL Studio VS Code Web extension is bundled at build time.
- The backend supplies Theia's `/webview` endpoint for VS Code CustomTextEditor.
- CI sets `THEIA_WEBVIEW_EXTERNAL_ENDPOINT={{hostname}}` only for local smoke testing. This removes per-webview subdomain isolation; it is **not** a production security setting.
- A real deployment should retain per-webview subdomains and configure wildcard DNS + TLS + reverse proxy.

Build/run (Node 24):
```sh
npm ci
node experiments/ide-host/scripts/build-ide-spike.mjs
node experiments/ide-host/scripts/prepare-theia-online.mjs
npm install --prefix experiments/ide-host/theia-browser --no-audit --no-fund
npm run build --prefix experiments/ide-host/theia-browser
THEIA_WEBVIEW_EXTERNAL_ENDPOINT='{{hostname}}' npm run start --prefix experiments/ide-host/theia-browser
```

This trial is isolated from GitHub Pages and from the existing browser-only app.
