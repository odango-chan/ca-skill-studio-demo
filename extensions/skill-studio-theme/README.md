# SKILL Studio Theme

A standalone, dependency-free VS Code theme extension shared by SKILL Studio
in VS Code and Eclipse Theia.

## Included

- **SKILL Studio Light** — workbench surfaces, editor chrome, terminal palette,
  YAML/Python/JSON/Markdown token colors and semantic highlighting.
- **SKILL Studio File Icons** — file and folder SVGs use the same 24px
  rounded-outline geometry and file-type mapping as Classic.
- **Classic Theia Shell Icons** — Theia browser hosts map activity-bar,
  Navigator, menu and toolbar Codicon identifiers onto SVG artwork generated
  from `site/icons.mjs`. Theia still owns commands, click targets, tooltips,
  keyboard shortcuts and accessible labels. Unmapped/editor-internal Codicons
  remain native; VS Code desktop retains its host-native shell icons.

The palette matches the established light Procedure Designer tokens in
`site/light.css`: canvas `#F5F7FB`, text `#20314A`, accent `#0C8E7B`,
blue `#317DC0`, and border `#E1E7EF`. The custom Procedure webview
continues to use the existing Studio CSS; this package themes the IDE host and
native source editor around it.

## Offline VS Code installation

Download the `skill-studio-theme-vsix` artifact from the IDE Host workflow,
copy the VSIX to the offline machine, then run:

```sh
code --install-extension skill-studio-theme.vsix
```

Or use **Extensions → … → Install from VSIX…** in VS Code.

Select **Preferences: Color Theme → SKILL Studio Light** and
**Preferences: File Icon Theme → SKILL Studio File Icons**. The VSIX contains
all theme JSON/SVG assets locally and has no activation code, runtime
dependencies, remote fonts, or network requests.

## Eclipse Theia

The browser-only Theia application preloads this exact package as a built-in
plugin at build time and selects both themes through default preferences.

## Scope

This version is light-only. The Classic icon overlay is injected into browser-only and backend-backed
Theia browser builds; it changes only shell icon artwork, not
Theia commands or behavior. It does not override semantic status colors used
by Procedure routes (PASS / FAIL / UNKNOWN), and does not change SKILL DSL,
Source projection, Patch qualification or Runtime logic.
