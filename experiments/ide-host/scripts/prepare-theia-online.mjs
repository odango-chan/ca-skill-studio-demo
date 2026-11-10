// Stage the Procedure Web extension and standalone theme extension into
// the isolated Theia browser-only application. Both are built-in plugins.
import {cp,mkdir,readFile,rm,stat,writeFile} from "node:fs/promises";
import {join} from "node:path";
const app="experiments/ide-host/theia-online";
const ext="experiments/ide-host/vscode";
const target=join(app,"plugins","odango-chan.ca-skill-studio-ide-spike");
const manifest=JSON.parse(await readFile(join(ext,"package.json"),"utf8"));
if(!manifest.browser||!manifest.contributes?.customEditors?.length)
  throw Error("VS Code Web extension entry or CustomEditor missing");
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
