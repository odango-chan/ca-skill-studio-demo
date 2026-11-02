import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const dist = "dist";
rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, "samples"), { recursive: true });

const html = readFileSync("site/index.html", "utf8");
if (!html.includes('src="./app.mjs"')) throw new Error("Unable to locate source app entry in HTML");
writeFileSync(join(dist, "index.html"), html.replace('src="./app.mjs"', 'src="./app.js"'));
copyFileSync("site/studio.css", join(dist, "studio.css"));
copyFileSync("site/samples/ensure-pdu-session.procedure.yaml", join(dist, "samples/ensure-pdu-session.procedure.yaml"));

await build({
  entryPoints: ["site/app.mjs"],
  outfile: join(dist, "app.js"),
  bundle: true,
  platform: "browser",
  format: "esm",
  target: ["es2022"],
  minify: true,
  legalComments: "none",
  logLevel: "info",
  sourcemap: false
});
console.log("Pages build: dist/ (browser bundle + static assets)");
