// Stage the shared Source-backed Preview Web extension plus standalone theme into
// the isolated Theia browser-only application. Both are built-in plugins.
import {cp,mkdir,readFile,rm,stat,writeFile} from "node:fs/promises";
import {join} from "node:path";
const app="experiments/ide-host/theia-online";
const ext="experiments/ide-host/vscode";
const target=join(app,"plugins","odango-chan.ca-skill-studio-ide-spike");
const manifest=JSON.parse(await readFile(join(ext,"package.json"),"utf8"));
if(!manifest.browser||manifest.contributes?.customEditors?.length)
  throw Error("VS Code Web extension must use native Source plus the shared Preview View; legacy CustomEditors are forbidden");
const rightContainers=manifest.contributes?.viewsContainers?.secondarySidebar??[];
const previewViews=manifest.contributes?.views?.skillStudioPreview??[];
const inspectorViews=manifest.contributes?.views?.skillStudioInspector??[];
if(!rightContainers.some(item=>item.id==="skillStudioPreview"&&item.title==="Preview")||
   !rightContainers.some(item=>item.id==="skillStudioInspector")||
   !previewViews.some(view=>view.id==="skillStudio.preview"&&view.type==="webview")||
   !inspectorViews.some(view=>view.id==="skillStudio.inspection")||
   inspectorViews.some(view=>view.id==="skillStudio.preview"))
  throw Error("Preview must own a dedicated right Secondary Sidebar container, separate from Inspector");
for(const source of [manifest.browser,"./dist/extension-theia.js","./dist/skill-language-server.js","./dist/compiler-worker.js","./dist/skillc.wasm","./dist/wasm_exec.js",join("media","procedure.js"),join("media","procedure.css"),join("media","studio-markdown-preview.css")]){
  const info=await stat(join(ext,source));
  if(!info.isFile()||info.size<1000)throw Error("Missing built Web extension file: "+source);
}
await rm(target,{recursive:true,force:true});
await mkdir(target,{recursive:true});
const prepared={...manifest,browser:"./dist/extension-theia.js"};
await writeFile(join(target,"package.json"),JSON.stringify(prepared,null,2)+"\n");
for(const resource of ["package.nls.json","package.nls.zh-cn.json","l10n"])
  await cp(join(ext,resource),join(target,resource),{recursive:true});
await cp(join(ext,"dist"),join(target,"dist"),{recursive:true});
await cp(join(ext,"media"),join(target,"media"),{recursive:true});
await cp(join(ext,"icons"),join(target,"icons"),{recursive:true});
await cp(join(ext,"samples"),join(target,"samples"),{recursive:true});
console.log("STUDIO_THEIA_PREPARED_WEB_EXTENSION",JSON.stringify({
  app,target,name:manifest.name,browser:prepared.browser,
  previewView:"skillStudio.preview",previewContainer:"skillStudioPreview",
  inspectorContainer:"skillStudioInspector",legacyCustomEditors:0
}));

const themeSource="extensions/skill-studio-theme";
const themeTarget=join(app,"plugins","odango-chan.skill-studio-theme");
const themeManifest=JSON.parse(await readFile(join(themeSource,"package.json"),"utf8"));
if(!themeManifest.contributes?.themes?.some(x=>x.label==="SKILL Studio Light")||
   !themeManifest.contributes?.iconThemes?.some(x=>x.id==="skill-studio-file-icons"))
  throw Error("Standalone Skill Studio color/file icon themes are missing");
for(const source of [
  join(themeSource,"themes","skill-studio-light-color-theme.json"),
  join(themeSource,"icons","skill-studio-file-icon-theme.json"),
  join(themeSource,"styles","markdown-preview.css"),
  ...["skill","yaml","markdown","python","json","shell","text","file","folder","folder-open","code"]
    .map(name=>join(themeSource,"icons",name+".svg"))
]){
  const info=await stat(source);
  if(!info.isFile()||info.size<80)throw Error("Missing Skill Studio theme asset: "+source);
}
await rm(themeTarget,{recursive:true,force:true});
await mkdir(themeTarget,{recursive:true});
await cp(themeSource,themeTarget,{recursive:true});
console.log("STUDIO_THEIA_PREPARED_THEME_EXTENSION",JSON.stringify({
  target:themeTarget,name:themeManifest.name,
  themes:themeManifest.contributes.themes.map(x=>x.label),
  iconThemes:themeManifest.contributes.iconThemes.map(x=>x.id),
  runtimeDependencies:Object.keys(themeManifest.dependencies??{}).length
}));

// YAML/Python language and TextMate contributions now belong to the
// primary Skill Studio extension. Validate the packaged assets there and
// remove any stale copy of the former standalone syntax plugin.
const syntaxSource="extensions/skill-studio-languages";
const syntaxTarget=join(app,"plugins","odango-chan.skill-studio-languages");
const syntaxManifest=JSON.parse(await readFile(join(syntaxSource,"package.json"),"utf8"));
for(const language of ["yaml","python"]){
  if(!manifest.contributes?.languages?.some(x=>x.id===language)||
     !manifest.contributes.grammars?.some(x=>x.language===language))
    throw Error("Primary Skill Studio extension is missing "+language+" language/grammar contributions");
}
for(const grammar of syntaxManifest.contributes.grammars){
  const packaged=manifest.contributes.grammars.find(item=>item.scopeName===grammar.scopeName);
  if(!packaged||!packaged.path.startsWith("./dist/grammars/"))
    throw Error("Primary extension does not own grammar scope "+grammar.scopeName);
  const info=await stat(join(target,packaged.path));
  if(!info.isFile()||info.size<100)
    throw Error("Primary extension grammar asset missing: "+packaged.path);
}
for(const language of syntaxManifest.contributes.languages){
  const packaged=manifest.contributes.languages.find(item=>item.id===language.id);
  if(!packaged||!packaged.configuration?.startsWith("./dist/grammars/"))
    throw Error("Primary extension does not own "+language.id+" language configuration");
  const info=await stat(join(target,packaged.configuration));
  if(!info.isFile()||info.size<80)
    throw Error("Primary extension language configuration missing: "+packaged.configuration);
}
await rm(syntaxTarget,{recursive:true,force:true});
console.log("STUDIO_THEIA_PRIMARY_EXTENSION_SYNTAX_ASSETS",JSON.stringify({
  target,syntaxes:["yaml","python"],grammarCount:syntaxManifest.contributes.grammars.length,
  standaloneSyntaxPluginRemoved:true
}));
