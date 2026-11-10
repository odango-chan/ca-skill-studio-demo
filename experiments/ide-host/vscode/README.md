# SKILL Studio · Experimental VS Code Extension

This is an isolated, **not production-ready** VS Code Custom Text Editor spike.
**Online Studio remains a required, first-class product.** The existing GitHub
Pages site is preserved; this extension is not a desktop-only replacement.
The same source now generates `dist/extension.cjs` (Node host) and
`dist/extension-web.cjs` (browser worker host). A successful browser build
does **not** mean Theia browser-only has been integrated or deployed.
It uses the native host's Explorer, file creation, search, tabs, YAML/Python
code editors, undo/redo and save. It is **not** a second source buffer.
`assurance/procedure.yaml` opens in the optional Procedure Visual custom view.

Build from repository root:

```sh
npm ci
node experiments/ide-host/scripts/build-ide-spike.mjs
```

To run in a VS Code Extension Development Host, open the repo as a workspace
and press F5 using an Extension Host launch configuration pointing to this
extension folder, or use:

```sh
code --extensionDevelopmentPath="$PWD/experiments/ide-host/vscode" \
     "$PWD/site/samples/packages/establish-pdu-session"
```

The extension loads `dist/extension.cjs` and `media/procedure.js` produced
by the isolated build. From Explorer, `assurance/procedure.yaml` opens the
Procedure Visual editor; `assurance/contract.yaml` opens the Contract Designer;
`assurance/predicates.yaml` opens the Predicate Designer; and
`schemas/*.schema.yaml` opens the read-only Schema Designer (Draft 2020-12).
The Contract view is read-only and source-backed: it shows identity, entry,
inputs, resources, predicates, planning, dependencies and failure semantics.
Contract references can open their actual Procedure, Schema or Predicate
Source. Predicate Designer shows each named Predicate as Observation →
Evaluator, including scope, freshness and CEL/Script declaration. It never
executes CEL or claims a live PASS/FAIL result. Use **打开 YAML Source** to edit
the original document. Ordinary
Python/YAML text editing remains native. Schema Designer shows a field tree,
required flags, type/const/range constraints, Source line navigation and
safe local JSON Pointer references. Remote references are never fetched;
complex keywords remain clearly PARTIAL or Source-only, not silently ignored.

In the graph, choose a qualified Route, new target and **生成 Diff**. The
confirm button sends a proposal; the extension independently validates the
current TextDocument version and AST/CST patch before applying an exact
scalar `WorkspaceEdit`. You can undo and save through the native host.

To try desktop/server-backed Theia, package a VSIX with
`npx --yes @vscode/vsce package --no-dependencies` from this folder after
building, then install the VSIX in an existing Theia IDE instance using
**Extensions: Install from VSIX...**. This path is an **unverified
compatibility test** until actually tested in Theia; see ../README.md.

For the **online** host, the candidate is Theia 1.76+ `browser-only`,
with the extension prebundled at **application build time**. Browser-only
Theia cannot install a VSIX dynamically through the Extensions UI. Its
filesystem is OPFS, not a local disk or automatic GitHub sync. A separate
online Theia shell build, CustomEditor activation, persistence and static
hosting are still **NOT_RUN**. See
[online-first host decision](https://github.com/odango-chan/ca-skill-studio-demo/blob/spike/ide-extension-theia-host/docs/decisions/0002-ide-host-spike.md).

No run/debug/Skill execution is performed and no existing GitHub Pages
assets are modified.
