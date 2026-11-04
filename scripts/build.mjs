import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, cpSync, rmSync } from "node:fs";
import { join } from "node:path";

const dist = "dist";
rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, "samples"), { recursive: true });

const html = readFileSync("site/index.html", "utf8");
if (!html.includes('src="./app.mjs"')) throw new Error("Unable to locate source app entry in HTML");
writeFileSync(join(dist, "index.html"), html.replace('src="./app.mjs"', 'src="./app.js"'));
copyFileSync("site/studio.css", join(dist, "studio.css"));
copyFileSync("site/light.css", join(dist, "light.css"));
copyFileSync("site/samples/establish-pdu-session.procedure.yaml", join(dist, "samples/establish-pdu-session.procedure.yaml"));
mkdirSync(join(dist, "samples", "packages"), { recursive: true });
cpSync("site/samples/packages/establish-pdu-session",
  join(dist,"samples/packages/establish-pdu-session"),{recursive:true});

await build({
  entryPoints: ["site/app.mjs"],
  outfile: join(dist, "app.js"),
  bundle: true,
  platform: "browser",
  format: "esm",
  target: ["es2022"],
  loader: {".tsx":"tsx",".yaml":"text",".yml":"text",".ttf":"file",".woff":"file",".woff2":"file",".svg":"file",".png":"file"},
  assetNames: "assets/[name]-[hash]",
  minify: true,
  legalComments: "eof",
  logLevel: "info",
  sourcemap: false
});
// Monaco's worker is a separate same-origin ES module. The app's
// MonacoEnvironment points to this static asset; no CDN or inline worker.
await build({
  entryPoints: ["node_modules/monaco-editor/esm/vs/editor/editor.worker.js"],
  outfile: join(dist, "editor.worker.js"),
  bundle: true,
  platform: "browser",
  format: "esm",
  target: ["es2022"],
  minify: true,
  legalComments: "eof",
  logLevel: "info"
});
copyFileSync("node_modules/monaco-editor/LICENSE",join(dist,"LICENSE.monaco.txt"));
copyFileSync("node_modules/monaco-editor/ThirdPartyNotices.txt",
  join(dist,"ThirdPartyNotices.monaco.txt"));
// Monaco YAML is a separate same-origin worker. Schema sources are embedded
// as local text in app.js; the worker has no remote schema-request capability.
await build({
  entryPoints: ["node_modules/monaco-yaml/yaml.worker.js"],
  outfile: join(dist, "yaml.worker.js"),
  bundle: true,
  platform: "browser",
  format: "esm",
  target: ["es2022"],
  minify: true,
  legalComments: "eof",
  logLevel: "info",
  plugins: [{
    name: "monaco-yaml-editor-worker-alias",
    setup(build) {
      // monaco-worker-manager imports this subpath without accounting for
      // Monaco's "./*.js" export map. Resolve it to the already bundled local
      // editor worker source instead of the doubled /esm/vs/esm/vs/ path.
      build.onResolve({
        filter: /^monaco-editor\\/esm\\/vs\\/editor\\/editor\\.worker\\.js$/
      }, () => ({
        path: join(process.cwd(),"node_modules/monaco-editor/esm/vs/editor/editor.worker.js")
      }));
    }
  }]
});
copyFileSync("node_modules/monaco-yaml/LICENSE",
  join(dist,"LICENSE.monaco-yaml.txt"));
console.log("Pages build: dist/ (Monaco + local editor.worker.js + local yaml.worker.js + static assets)");
