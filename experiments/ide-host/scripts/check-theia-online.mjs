import {createRequire} from "node:module";
import {existsSync,readFileSync,readdirSync,statSync} from "node:fs";
import {join} from "node:path";
const root="experiments/ide-host/theia-online/lib/frontend";
if(!existsSync(root))throw Error("Theia did not create lib/frontend");
function scan(dir,depth=0){
  if(depth>7)return [];
  const files=[];
  for(const ent of readdirSync(dir,{withFileTypes:true})){
    const p=join(dir,ent.name);
    if(ent.isDirectory())files.push(...scan(p,depth+1));
    else if(ent.isFile())files.push(p);
  }
  return files;
}
const files=scan(root);
const index=files.find(p=>p===join(root,"index.html"));
if(!index)throw Error("Browser-only frontend index.html was not emitted");
if(statSync(index).size<200)throw Error("Empty HTML");
const pluginLists=files.filter(p=>p.endsWith(join("hostedPlugin","list.json")));
const pluginListEvidence=pluginLists.map(p=>({path:p,text:readFileSync(p,"utf8").slice(0,3000)}));
const hasProcedurePlugin=files.some(p=>p.includes("odango_chan_ca_skill_studio_ide_spike"))||
  pluginListEvidence.some(p=>p.text.includes("ca-skill-studio-ide-spike"));
const hasThemePlugin=files.some(p=>p.includes("odango_chan_skill_studio_theme"))||
  pluginListEvidence.some(p=>p.text.includes("skill-studio-theme"));
const themeAssets=[
  "hostedPlugin/odango_chan_skill_studio_theme/package.json",
  "hostedPlugin/odango_chan_skill_studio_theme/themes/skill-studio-light-color-theme.json",
  "hostedPlugin/odango_chan_skill_studio_theme/icons/skill-studio-file-icon-theme.json",
  "hostedPlugin/odango_chan_skill_studio_theme/styles/markdown-preview.css",
  "hostedPlugin/odango_chan_skill_studio_theme/icons/skill.svg",
  "hostedPlugin/odango_chan_skill_studio_theme/icons/yaml.svg"
].map(p=>join(root,p));
const missingThemeAssets=themeAssets.filter(p=>!existsSync(p));
console.log("STUDIO_THEIA_FRONTEND_ARTIFACT",JSON.stringify({
  index,files:files.length,pluginLists,
  procedurePlugin:hasProcedurePlugin,themePlugin:hasThemePlugin,
  themeAssets:themeAssets.filter(existsSync),missingThemeAssets
}));
if(!hasProcedurePlugin)throw Error("Theia browser-only build lacks prepared SKILL Studio Web extension");
if(!hasThemePlugin)throw Error("Theia browser-only build lacks the built-in Skill Studio theme extension");
if(missingThemeAssets.length)throw Error("Theia static preview is missing theme assets: "+missingThemeAssets.join(", "));
const markdownPluginRoot=join(root,"hostedPlugin/vscode_markdown_language_features");
const markdownManifestPath=join(markdownPluginRoot,"package.json");
if(!existsSync(markdownManifestPath))
  throw Error("Theia static preview lacks the pinned native Markdown extension");
const markdownManifest=JSON.parse(readFileSync(markdownManifestPath,"utf8"));
if(markdownManifest.publisher!=="vscode"||
   markdownManifest.name!=="markdown-language-features"||
   markdownManifest.version!=="1.95.3")
  throw Error("Theia static preview has an unexpected native Markdown extension identity");
const markdownBrowser=join(markdownPluginRoot,
  (markdownManifest.browser??"").replace(/^\\.\\//,""));
const markdownWorker=join(markdownPluginRoot,"dist/browser/serverWorkerMain.js");
for(const asset of [markdownBrowser,markdownWorker])
  if(!existsSync(asset)||statSync(asset).size<100)
    throw Error("Theia static preview lacks native Markdown browser asset: "+asset);
console.log("STUDIO_THEIA_STATIC_MARKDOWN_EXTENSION",JSON.stringify({
  markdownPluginRoot,version:markdownManifest.version,
  browser:markdownManifest.browser,workerBytes:statSync(markdownWorker).size
}));
const syntaxPluginRoot=join(root,"hostedPlugin/odango_chan_skill_studio_languages");
const syntaxManifestPath=join(syntaxPluginRoot,"package.json");
if(!existsSync(syntaxManifestPath))
  throw Error("Theia static preview lacks the built-in YAML/Python syntax extension manifest");
const syntaxManifest=JSON.parse(readFileSync(syntaxManifestPath,"utf8"));
const syntaxAssets=(syntaxManifest.contributes?.grammars??[]).map(item=>
  join(syntaxPluginRoot,item.path));
const missingSyntaxAssets=syntaxAssets.filter(path=>
  !existsSync(path)||statSync(path).size<100);
if(missingSyntaxAssets.length)
  throw Error("Theia static preview lacks pinned TextMate grammar assets: "+
    missingSyntaxAssets.join(", "));
for(const language of ["yaml","python"]){
  if(!syntaxManifest.contributes?.languages?.some(item=>item.id===language)||
     !syntaxManifest.contributes?.grammars?.some(item=>item.language===language))
    throw Error("Theia static preview syntax extension is missing "+language);
}
console.log("STUDIO_THEIA_STATIC_SYNTAX_EXTENSION",JSON.stringify({
  syntaxPluginRoot,languages:syntaxManifest.contributes.languages.map(item=>item.id),
  grammarCount:syntaxAssets.length
}));
const languageServerWorker=join(root,"hostedPlugin/odango_chan_ca_skill_studio_ide_spike/dist/skill-language-server.js");
if(!existsSync(languageServerWorker)||statSync(languageServerWorker).size<1000)
  throw Error("Theia static preview is missing the bundled browser LSP Worker");
console.log("STUDIO_THEIA_LSP_WORKER_ASSET",JSON.stringify({
  path:languageServerWorker,bytes:statSync(languageServerWorker).size
}));

// Exercise the pinned host matcher, including Windows URI separators. A plain
// **/assurance/procedure.yaml takes a platform-separator fast path in Theia.
const {match}=createRequire(import.meta.url)("../theia-online/node_modules/@theia/core/lib/common/glob.js");
const manifest=JSON.parse(readFileSync("experiments/ide-host/vscode/package.json","utf8"));
const editors=new Map(manifest.contributes.customEditors.map(x=>[
  x.viewType,x.selector[0].filenamePattern
]));
const expected=[
  ["skillStudio.procedurePreview","file:/workspace/assurance/procedure.yaml"],
  ["skillStudio.contractPreview","file:/workspace/assurance/contract.yaml"],
  ["skillStudio.predicatePreview","file:/workspace/assurance/predicates.yaml"]
];
for(const [view,path] of expected){
  const pattern=editors.get(view);
  if(!pattern)throw Error("Native CustomEditor selector missing: "+view);
  for(const candidate of [path,path.replace("file:/workspace","file:/C:/workspace"),
      path.replace("file:/workspace","file:/.theia/globalStorage/demo")]){
    if(!match(pattern,candidate))throw Error("Native CustomEditor selector failed: "+view+" "+candidate);
  }
  for(const [,other] of expected.filter(([otherView])=>otherView!==view)){
    const otherPattern=editors.get(other);
    if(match(otherPattern,path))throw Error("CustomEditor selector overlap: "+view+" / "+other);
  }
}
console.log("STUDIO_NATIVE_EDITOR_ASSOCIATION_MATCH_PASS",JSON.stringify(expected.map(([view])=>view)));
