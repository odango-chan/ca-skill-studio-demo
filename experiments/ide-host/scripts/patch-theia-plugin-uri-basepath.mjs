// Patch Theia 1.76's browser PluginContext to preserve a project Pages base path.
// Theia's manifest loader already resolves plugin assets from Endpoint.getRestUrl().parent,
// but PluginContext builds extensionUri from Endpoint.origin (domain root). Browser extensions
// such as vscode.markdown-language-features then start nested Workers at /hostedPlugin/...,
// which is outside a GitHub Pages project site such as /ca-skill-studio-demo/.
import {readFile,writeFile} from "node:fs/promises";
import {existsSync} from "node:fs";

const packageRoot="experiments/ide-host/theia-online/node_modules/@theia/plugin-ext";
const sourcePath=packageRoot+"/src/plugin/plugin-context.ts";
const compiledPath=packageRoot+"/lib/plugin/plugin-context.js";
let patched=0;

if(existsSync(sourcePath)){
  let source=await readFile(sourcePath,"utf8");
  const before="const { origin } = new Endpoint();\n            this.pluginUri = URI.parse(origin + '/' + PluginPackage.toPluginUrl(plugin.model, ''));";
  const after="const endpoint = new Endpoint();\n            this.pluginUri = endpoint.getRestUrl().parent.resolve(PluginPackage.toPluginUrl(plugin.model, ''));";
  const count=source.split(before).length-1;
  if(count!==1)throw Error("Unexpected Theia 1.76 PluginContext TypeScript source shape: "+count);
  source=source.replace(before,after);
  await writeFile(sourcePath,source);
  patched++;
}

if(existsSync(compiledPath)){
  let compiled=await readFile(compiledPath,"utf8");
  const pattern=/const\s*\{\s*origin\s*\}\s*=\s*new\s+([A-Za-z_$][\\w$.]*Endpoint)\(\);\s*this\.pluginUri\s*=\s*([A-Za-z_$][\\w$.]*)\.parse\(origin\s*\+\s*(['"])\/\3\s*\+\s*([A-Za-z_$][\\w$.]*PluginPackage)\.toPluginUrl\(plugin\.model,\s*(['"])\5\)\);/;
  const match=compiled.match(pattern);
  if(!match)throw Error("Unexpected Theia 1.76 PluginContext compiled JavaScript shape");
  const [,endpointCtor,,pluginPackage,emptyQuote]=match;
  compiled=compiled.replace(pattern,
    "const endpoint = new "+endpointCtor+"(); this.pluginUri = endpoint.getRestUrl().parent.resolve("+
    pluginPackage+".toPluginUrl(plugin.model, "+emptyQuote+emptyQuote+"));");
  await writeFile(compiledPath,compiled);
  patched++;
}

if(patched===0)throw Error("Theia PluginContext package source and compiled files were not found");
console.log("STUDIO_THEIA_PLUGIN_URI_BASEPATH_PATCH",JSON.stringify({
  patchedSource:existsSync(sourcePath),patchedCompiled:existsSync(compiledPath),
  resolution:"Endpoint.getRestUrl().parent + hostedPlugin asset path"
}));
