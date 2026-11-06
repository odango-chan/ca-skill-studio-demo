// Run from repository root after npm ci. Experimental artifact only.
// No change to the existing Pages app or its dist/ output.
import {build} from "esbuild";
import {mkdir,rm} from "node:fs/promises";
import {join} from "node:path";
const root="experiments/ide-host/vscode";
await rm(join(root,"dist"),{recursive:true,force:true});
await rm(join(root,"media"),{recursive:true,force:true});
await mkdir(join(root,"dist"),{recursive:true});
await mkdir(join(root,"media"),{recursive:true});
await build({
  entryPoints:[join(root,"src/extension.mjs")],
  outfile:join(root,"dist/extension.cjs"),
  bundle:true,format:"cjs",platform:"node",target:"node20",
  external:["vscode"],logLevel:"info"
});
// The same source also builds as a VS Code Web extension: no Node APIs.
// "browser" in extension package.json selects this entry for vscode.dev and
// browser-only Theia; real host activation/CustomEditor remains unverified.
await build({
  entryPoints:[join(root,"src/extension.mjs")],
  outfile:join(root,"dist/extension-web.cjs"),
  bundle:true,format:"cjs",platform:"browser",target:"es2022",
  external:["vscode"],logLevel:"info"
});
await build({
  entryPoints:[join(root,"src/webview.mjs")],
  outfile:join(root,"media/procedure.js"),
  bundle:true,format:"iife",platform:"browser",target:"es2022",
  loader:{".tsx":"tsx",".ttf":"file",".woff":"file",".woff2":"file",".svg":"file"},
  assetNames:"assets/[name]-[hash]",logLevel:"info"
});
console.log("IDE spike: built Node + browser extension entries and local ReactFlow webview (not installed or run)");
