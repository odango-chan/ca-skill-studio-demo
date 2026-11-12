// Run from repository root after npm ci. Experimental artifact only.
// No change to the existing Pages app or its dist/ output.
import {build} from "esbuild";
import {mkdir,rm,cp,readdir,readFile,appendFile} from "node:fs/promises";
import {dirname,join} from "node:path";
const root="experiments/ide-host/vscode";
await rm(join(root,"dist"),{recursive:true,force:true});
await rm(join(root,"media"),{recursive:true,force:true});
await mkdir(join(root,"dist"),{recursive:true});
await mkdir(join(root,"media"),{recursive:true});
// Native Markdown Preview consumes one shared stylesheet owned by the Studio theme extension.
await cp("extensions/skill-studio-theme/styles/markdown-preview.css",
  join(root,"media/markdown-preview.css"));

// The browser LSP server is a separate classic Worker bundle. It imports the
// same transport-neutral LanguageDiagnosticSession as the host tests; no Node
// runtime or filesystem access is available inside this Worker.
await build({
  entryPoints:["experiments/ide-host/lsp-browser/server/src/browserServerMain.mjs"],
  outfile:join(root,"dist","skill-language-server.js"),
  bundle:true,format:"iife",platform:"browser",target:"es2022",
  loader:{".yaml":"text",".yml":"text"},
  logLevel:"info"
});
await build({
  entryPoints:[join(root,"src/extension.mjs")],
  outfile:join(root,"dist/extension.cjs"),
  bundle:true,format:"cjs",platform:"node",target:"node20",
  loader:{".yaml":"text",".yml":"text"},
  external:["vscode"],logLevel:"info"
});
// The same source also builds as a VS Code Web extension: no Node APIs.
// "browser" in extension package.json selects this entry for vscode.dev and
// browser-only Theia; real host activation/CustomEditor remains unverified.
await build({
  entryPoints:[join(root,"src/extension.mjs")],
  outfile:join(root,"dist/extension-web.cjs"),
  bundle:true,format:"cjs",platform:"browser",target:"es2022",
  loader:{".yaml":"text",".yml":"text"},
  external:["vscode"],logLevel:"info"
});
// Theia 1.76's browser-only PluginWorker calls importScripts(), then reads
// self[self.frontendModuleName]. A plain CJS browser bundle is insufficient:
 // it expects a module/require that the worker has not provided.
 // Build a thin Theia worker adapter from the SAME extension source. The
 // original Node CJS and VS Code Web CJS remain unchanged.
const theiaWorkerEntry=join(root,"dist/extension-theia.js");
await build({
  entryPoints:[join(root,"src/extension.mjs")],
  outfile:theiaWorkerEntry,
  define:{STUDIO_THEIA_HOST:"true"},
  bundle:true,format:"iife",globalName:"__skillStudioTheiaModule",
  platform:"browser",target:"es2022",logLevel:"info",
  loader:{".yaml":"text",".yml":"text"},
  plugins:[{
    name:"theia-worker-vscode-api",
    setup(build){
      build.onResolve({filter:/^vscode$/},()=>({
        path:"vscode",namespace:"theia-worker-vscode"
      }));
      build.onLoad({filter:/^vscode$/,namespace:"theia-worker-vscode"},()=>({
        contents:"module.exports = globalThis.theia[globalThis.frontendModuleName];",
        loader:"js"
      }));
    }
  }]
});
// Theia explicitly sets frontendModuleName just before importScripts; the
// resulting activation exports are discovered by this exact lookup.
await appendFile(theiaWorkerEntry,
  String.fromCharCode(10)+";if(typeof self !== 'undefined' && self.frontendModuleName) "+
  "self[self.frontendModuleName] = __skillStudioTheiaModule;"+String.fromCharCode(10));
await build({
  entryPoints:[join(root,"src/webview.mjs")],
  outfile:join(root,"media/procedure.js"),
  minify:true,
  bundle:true,format:"iife",platform:"browser",target:"es2022",
  loader:{".tsx":"tsx",".ttf":"file",".woff":"file",".woff2":"file",".svg":"file"},
  assetNames:"assets/[name]-[hash]",logLevel:"info"
});
// Bundle the two source-pinned ca-skills authoring examples. Legacy fixture
// files may remain in site/samples/skills for old regression tests, but they
// must not leak into the published, newly imported example project.
const sampleSource="site/samples/skills";
const sampleDest=join(root,"samples","skills");
const sampleManifest=JSON.parse(await readFile(join(sampleSource,"files.json"),"utf8"));
async function relativeFiles(dir,prefix=""){
  let result=[];
  for(const entry of await readdir(dir,{withFileTypes:true})){
    const rel=[prefix,entry.name].filter(Boolean).join("/");
    if(entry.isDirectory())result.push(...await relativeFiles(join(dir,entry.name),rel));
    else if(entry.isFile())result.push(rel);
  }
  return result.sort();
}
const sourceFiles=(await relativeFiles(sampleSource))
  .filter(p=>p!=="files.json"&&p!=="README.md");
if(sampleManifest.schemaVersion!==1||
   sampleManifest.sourceRepo!=="odango-chan/ca-skills"||
   !/^[0-9a-f]{40}$/.test(sampleManifest.sourceSha)||
   JSON.stringify([...sampleManifest.skills].sort())!==
     JSON.stringify(["establish-pdu-session","establish-pdu-session-mas"].sort())||
   sampleManifest.files.length<6||
   new Set(sampleManifest.files).size!==sampleManifest.files.length||
   !sampleManifest.files.every(p=>
     typeof p==="string"&&!p.includes("\\")&&!p.startsWith("/")&&
     p.split("/").every(part=>part&&part!=="."&&part!=="..")&&
     sampleManifest.skills.some(name=>p.startsWith(name+"/"))&&
     sourceFiles.includes(p))||
   !sampleManifest.skills.every(name=>
     sampleManifest.files.includes(name+"/SKILL.md")&&
     sampleManifest.files.includes(name+"/assurance/procedure.yaml")))
  throw Error("Incomplete or divergent pinned two-SKILL sample manifest");
await rm(sampleDest,{recursive:true,force:true});
await mkdir(sampleDest,{recursive:true});
for(const name of ["README.md","files.json"])
  await cp(join(sampleSource,name),join(sampleDest,name));
for(const path of sampleManifest.files){
  const target=join(sampleDest,path);
  await mkdir(dirname(target),{recursive:true});
  await cp(join(sampleSource,path),target);
}
console.log("STUDIO_PREPARED_SAMPLE",JSON.stringify({
  root:sampleDest,skills:sampleManifest.skills,files:sampleManifest.files.length,
  sourceSha:sampleManifest.sourceSha
}));
console.log("IDE spike: built Node + browser extension entries, isolated LSP Worker and local ReactFlow webview (not installed or run)");
// Owner Skill snapshots are pinned and validated; the demo does not auto-sync.
