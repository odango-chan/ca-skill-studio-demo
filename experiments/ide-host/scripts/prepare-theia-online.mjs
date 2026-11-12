// Stage the Procedure, Contract, Predicate and Schema Web extension plus standalone theme into
// the isolated Theia browser-only application. Both are built-in plugins.
import {cp,mkdir,readFile,rm,stat,writeFile} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import {join} from "node:path";
const app="experiments/ide-host/theia-online";
const ext="experiments/ide-host/vscode";
// Theia 1.76 removed @theia/preview. Bundle the official VS Code Markdown
// language-features and language-basics extensions at build time for both
// backend-backed and browser-only hosts.
execFileSync(process.platform==="win32"?"npm.cmd":"npm",["run","download:plugins"],{
  cwd:app,stdio:"inherit"
});
for(const [folder,id] of [
  ["vscode.markdown","vscode.markdown"],
  ["vscode.markdown-language-features","vscode.markdown-language-features"]
]){
  const manifest=JSON.parse(await readFile(join(app,"plugins",folder,"package.json"),"utf8"));
  if(manifest.publisher+"."+manifest.name!==id)
    throw Error("Unexpected native Markdown plugin identity: "+folder);
  if(id==="vscode.markdown-language-features"){
    if(!manifest.browser||!manifest.contributes?.commands?.some(x=>
      x.command==="markdown.showPreviewToSide"))
      throw Error("Native Markdown preview extension is missing its browser entry or side-preview command");
    const browserPath=join(app,"plugins",folder,manifest.browser);
    const info=await stat(browserPath);
    if(!info.isFile()||info.size<1000)
      throw Error("Native Markdown browser extension bundle missing: "+browserPath);
  }
}
console.log("STUDIO_THEIA_PREPARED_NATIVE_MARKDOWN",JSON.stringify({
  extensions:["vscode.markdown","vscode.markdown-language-features"],
  version:"1.95.3",preview:"markdown.showPreviewToSide"
}));
const target=join(app,"plugins","odango-chan.ca-skill-studio-ide-spike");
const manifest=JSON.parse(await readFile(join(ext,"package.json"),"utf8"));
if(!manifest.browser||!manifest.contributes?.customEditors?.length)
  throw Error("VS Code Web extension entry or CustomEditor missing");
const requiredEditors=["skillStudio.procedurePreview","skillStudio.contractPreview",
  "skillStudio.predicatePreview","skillStudio.schemaPreview"];
const editorViews=new Set(manifest.contributes.customEditors.map(x=>x.viewType));
for(const view of requiredEditors)if(!editorViews.has(view))
  throw Error("Required visual editor is missing from prepared Web extension: "+view);
for(const source of [manifest.browser,"./dist/extension-theia.js","./dist/skill-language-server.js",join("media","procedure.js"),join("media","procedure.css")]){
  const info=await stat(join(ext,source));
  if(!info.isFile()||info.size<1000)throw Error("Missing built Web extension file: "+source);
}
await rm(target,{recursive:true,force:true});
await mkdir(target,{recursive:true});
const prepared={...manifest,browser:"./dist/extension-theia.js"};
await writeFile(join(target,"package.json"),JSON.stringify(prepared,null,2)+"\n");
await cp(join(ext,"dist"),join(target,"dist"),{recursive:true});
await cp(join(ext,"media"),join(target,"media"),{recursive:true});
await cp(join(ext,"icons"),join(target,"icons"),{recursive:true});
await cp(join(ext,"samples"),join(target,"samples"),{recursive:true});
console.log("STUDIO_THEIA_PREPARED_WEB_EXTENSION",JSON.stringify({
  app,target,name:manifest.name,browser:prepared.browser,
  customEditors:manifest.contributes.customEditors.map(x=>x.viewType)
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

// Syntax highlighting must not depend on the deferred LSP workstream.
// Browser-only Theia does not ship VS Code's default language extensions:
// bundle a declarative, pinned YAML/Python TextMate plugin at build time.
const syntaxSource="extensions/skill-studio-languages";
const syntaxTarget=join(app,"plugins","odango-chan.skill-studio-languages");
const syntaxManifest=JSON.parse(await readFile(join(syntaxSource,"package.json"),"utf8"));
for(const language of ["yaml","python"]){
  if(!syntaxManifest.contributes?.languages?.some(x=>x.id===language)||
     !syntaxManifest.contributes.grammars?.some(x=>x.language===language))
    throw Error("Missing bundled "+language+" language and TextMate grammar");
}
if(syntaxManifest.main||syntaxManifest.browser)
  throw Error("Syntax extension must remain declarative");
for(const grammar of syntaxManifest.contributes.grammars){
  const info=await stat(join(syntaxSource,grammar.path));
  if(!info.isFile()||info.size<100)
    throw Error("Bundled grammar missing: "+grammar.path);
}
await rm(syntaxTarget,{recursive:true,force:true});
await cp(syntaxSource,syntaxTarget,{recursive:true});
console.log("STUDIO_THEIA_PREPARED_SYNTAX_EXTENSION",JSON.stringify({
  target:syntaxTarget,syntaxes:syntaxManifest.contributes.languages.map(x=>x.id),
  grammarCount:syntaxManifest.contributes.grammars.length
}));
