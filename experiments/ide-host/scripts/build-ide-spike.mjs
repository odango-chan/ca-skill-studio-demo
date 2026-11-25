// Build the shared VS Code-compatible extension bundles used by Theia and optional local hosts.
// This step creates extension assets only; Theia app builds and Pages releases are separate.
import {build} from "esbuild";
import {mkdir,rm,cp,readFile,appendFile,writeFile,stat} from "node:fs/promises";
import {createHash} from "node:crypto";
import {dirname,join} from "node:path";
import {prepareExampleOwnerDependency} from "../vscode/src/example-owner-dependency.mjs";
import {prepareExampleHostContextDependency} from "../vscode/src/example-host-context-dependency.mjs";
const root="experiments/ide-host/vscode";
const buildId=JSON.stringify(process.env.GITHUB_SHA??"local");
await rm(join(root,"dist"),{recursive:true,force:true});
await rm(join(root,"media"),{recursive:true,force:true});
await mkdir(join(root,"dist"),{recursive:true});
await mkdir(join(root,"media"),{recursive:true});

// YAML/Python TextMate grammars are vendored as source metadata under
// extensions/skill-studio-languages, but are packaged inside the primary
// Skill Studio extension so no second plugin discovery/activation is needed.
const syntaxSource="extensions/skill-studio-languages";
const syntaxManifest=JSON.parse(await readFile(join(syntaxSource,"package.json"),"utf8"));
const grammarRoot=join(root,"dist","grammars");
await cp(join(syntaxSource,"upstream"),grammarRoot,{recursive:true});
await cp(join(syntaxSource,"LICENSE.txt"),join(grammarRoot,"LICENSE.txt"));
for(const grammar of syntaxManifest.contributes?.grammars??[]){
  const relative=grammar.path.replace(/^\.\/upstream\//,"");
  const asset=join(grammarRoot,relative);
  const info=await stat(asset);
  if(!info.isFile()||info.size<100)
    throw Error("Primary extension grammar asset missing or empty: "+asset);
}
for(const language of syntaxManifest.contributes?.languages??[]){
  const relative=language.configuration.replace(/^\.\/upstream\//,"");
  const asset=join(grammarRoot,relative);
  const info=await stat(asset);
  if(!info.isFile()||info.size<80)
    throw Error("Primary extension language configuration missing or empty: "+asset);
}
// Keep both host adapters for the same Go/WASM Compiler: classic Web Worker
// for browser hosts and worker_threads for Node extension hosts. The pinned
// wasm_exec.js and skillc.wasm are staged by the CI Go build step.
await cp(join(root,"src/compiler-worker.js"),join(root,"dist/compiler-worker.js"));
await cp(join(root,"src/compiler-node-worker.mjs"),join(root,"dist/compiler-node-worker.mjs"));
// The pinned Markdown extension owns native Source language services; the shared Studio Preview Host owns rendering.
await cp("extensions/skill-studio-theme/styles/markdown-preview.css",
  join(root,"media/studio-markdown-preview.css"));

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
  define:{STUDIO_BUILD_ID:buildId},
  loader:{".yaml":"text",".yml":"text"},
  external:["vscode"],logLevel:"info"
});
// The same source also builds as a VS Code Web extension: no Node APIs.
// "browser" in extension package.json selects this entry for vscode.dev and
// browser-only Theia; real host activation of the shared Preview View is verified separately.
await build({
  entryPoints:[join(root,"src/extension.mjs")],
  outfile:join(root,"dist/extension-web.cjs"),
  bundle:true,format:"cjs",platform:"browser",target:"es2022",
  define:{STUDIO_BUILD_ID:buildId},
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
  define:{
    STUDIO_THEIA_HOST:"true",
    STUDIO_BUILD_ID:buildId
  },
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
// The AI review graph is an embedded, read-only React Flow + ELK adapter.
// It consumes the SAME v1alpha5 Source projection and graph element/layout
// primitives as Procedure Preview; separate Webview assets keep the editor
// extension Host free of React and prevent any third native editor group.
await build({
  entryPoints:[join(root,"src/ai-flow-compare.tsx")],
  outfile:join(root,"media/ai-flow-compare.js"),
  bundle:true,format:"iife",platform:"browser",target:"es2022",
  minify:true,
  loader:{".tsx":"tsx",".css":"css"},
  logLevel:"info"
});
// Bundle the private, read-only Monaco DiffEditor inside the AI Editor Tab.
// Keep all code, CSS and fonts in the local extension media root; no CDN.
await build({
  entryPoints:[join(root,"src/ai-yaml-diff.mjs")],
  outfile:join(root,"media/ai-yaml-diff.js"),
  bundle:true,format:"iife",platform:"browser",target:"es2022",
  minify:true,
  loader:{".css":"css",".ttf":"file",".woff":"file",".woff2":"file"},
  assetNames:"assets/[name]-[hash]",logLevel:"info"
});
// Bundle only the pinned CA-SL v1alpha5 released Example. v1alpha4 remains
// an immutable historical language baseline and is not shipped as an active Example.
// Remove all previously staged active/legacy sample directories before copying the
// single selected candidate so an older build cannot leak a second authoring target.
await rm(join(root,"samples","skills"),{recursive:true,force:true});
await rm(join(root,"samples","v1alpha4"),{recursive:true,force:true});
const sampleSets=[
  {kind:"v1alpha5",source:"site/samples/v1alpha5",destination:join(root,"samples","v1alpha5"),
    status:"OWNER_LINKED_STATIC_BUILD_PASS_E2E_NOT_RERUN",ref:"refs/pull/86/head",
    version:"connectionagent.io/v1alpha5"}
];
for(const set of sampleSets){
  const manifest=JSON.parse(await readFile(join(set.source,"files.json"),"utf8"));
  if(manifest.schemaVersion!==1||manifest.sourceRepo!=="odango-chan/ca-skills"||
     manifest.sourceSha!=="83d9e0c7d523189a1ae03186f8913277f0829d72"||
     manifest.sourceStatus!==set.status||manifest.sourceRef!==set.ref||
     (set.version&&manifest.languageVersion!==set.version)||
     JSON.stringify([...manifest.skills].sort())!==
       JSON.stringify(["establish-pdu-session-mas",
         "modify-pdu-session-mas","release-pdu-session-mas"].sort())||
     !manifest.blobs||!Array.isArray(manifest.files)||manifest.files.length!==18||
     !Array.isArray(manifest.dependencies)||manifest.dependencies.length!==2||new Set(manifest.files).size!==manifest.files.length||
     !manifest.files.every(path=>
       typeof path==="string"&&!path.includes("\\")&&!path.startsWith("/")&&
       path.split("/").every(part=>part&&part!=="."&&part!=="..")&&
       manifest.skills.some(name=>path.startsWith(name+"/"))&&
       /^[a-f0-9]{40}$/.test(manifest.blobs[path]??""))||
     !manifest.skills.every(name=>
       manifest.files.includes(name+"/SKILL.md")&&
       manifest.files.includes(name+"/assurance/procedure.yaml")&&
       manifest.files.includes(name+"/assurance/contract.yaml")&&
       manifest.files.includes(name+"/assurance/predicates.yaml")))
    throw Error("Incomplete, divergent or incorrectly qualified "+set.kind+" manifest");
  await rm(set.destination,{recursive:true,force:true});
  await mkdir(set.destination,{recursive:true});
  await cp(join(set.source,"files.json"),join(set.destination,"files.json"));
  if(manifest.projectReadme!=="README.md")
    throw Error("Example project README is not pinned");
  await cp(join(set.source,manifest.projectReadme),join(set.destination,manifest.projectReadme));
  for(const path of manifest.files){
    const bytes=await readFile(join(set.source,path));
    const gitBlob=createHash("sha1").update("blob "+bytes.length+"\0").update(bytes).digest("hex");
    if(gitBlob!==manifest.blobs[path])
      throw Error(set.kind+" example differs from pinned owner blob: "+path);
    const target=join(set.destination,path);
    await mkdir(dirname(target),{recursive:true});
    await writeFile(target,bytes);
  }
  // The release ZIP is a separate Provider artifact, NOT a ca-skills
  // authored Skill file. Ship its exact, independently SHA-verified bytes as
  // text so Theia/Pages and offline hosts seed the same immutable snapshot.
  const artifact="ca-client-tools_interface_1.1.0.zip.b64";
  const sourceAsset=join(set.source,"interface-package",artifact);
  const base64=(await readFile(sourceAsset,"utf8")).trim();
  const archive=Buffer.from(base64,"base64");
  const digest="sha256:"+createHash("sha256").update(archive).digest("hex");
  if(archive.length!==4289||
     archive.toString("base64")!==base64||
     digest!=="sha256:cbd8fad939844cda5474f33f18d3cdc015c69dd8c1dc3908e84bd5273ce6e71b")
    throw Error("Bundled ca-client-tools v1.1.0 Interface Package differs from released ZIP");
  const targetAsset=join(set.destination,"interface-package",artifact);
  await mkdir(dirname(targetAsset),{recursive:true});
  await writeFile(targetAsset,base64+"\n");
  const readBundled=relative=>readFile(join(set.source,relative));
  const owner=await prepareExampleOwnerDependency(readBundled,
    manifest.dependencies.find(entry=>entry.id==="mas"));
  const context=await prepareExampleHostContextDependency(readBundled,
    manifest.dependencies.find(entry=>entry.id==="ca-context"));
  for(const [folder,snapshot] of [["owner-package",owner],["host-context",context]]){
    for(const file of snapshot.files){
      const target=join(set.destination,folder,file.path);
      await mkdir(dirname(target),{recursive:true});
      await writeFile(target,file.bytes);
    }
  }
  console.log("STUDIO_PREPARED_SAMPLE",JSON.stringify({
    kind:set.kind,root:set.destination,skills:manifest.skills,
    files:manifest.files.length,sourceSha:manifest.sourceSha,
    sourceStatus:manifest.sourceStatus,
    dependencies:manifest.dependencies.map(item=>({
      id:item.id,kind:item.kind,sourceRevision:item.resolvedRevision,files:item.files.length
    })),
    exampleInterfaceAsset:artifact,exampleInterfaceSha256:digest
  }));
}
console.log("SKILL Studio IDE host: built Node and browser extension entries, isolated LSP Worker and ReactFlow webview assets; Theia application build and Pages release are separate.");
// Owner Skill snapshots are pinned and validated; the demo does not auto-sync.
