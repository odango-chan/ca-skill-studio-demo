// Stages the exact same prebuilt VS Code Web extension into an isolated
// Theia browser-only application. No changes to Pages dist/ or source files.
import {cp,mkdir,readFile,rm,stat,writeFile} from "node:fs/promises";
import {join} from "node:path";
const app="experiments/ide-host/theia-online";
const ext="experiments/ide-host/vscode";
const target=join(app,"plugins","odango-chan.ca-skill-studio-ide-spike");
const manifest=JSON.parse(await readFile(join(ext,"package.json"),"utf8"));
if(!manifest.browser||!manifest.contributes?.customEditors?.length)
  throw Error("VS Code Web extension entry or CustomEditor missing");
for(const source of [manifest.browser,join("media","procedure.js"),join("media","procedure.css")]){
  const info=await stat(join(ext,source));
  if(!info.isFile()||info.size<1000)throw Error("Missing built Web extension file: "+source);
}
await rm(target,{recursive:true,force:true});
await mkdir(target,{recursive:true});
await writeFile(join(target,"package.json"),JSON.stringify(manifest,null,2)+"\n");
await cp(join(ext,"dist"),join(target,"dist"),{recursive:true});
await cp(join(ext,"media"),join(target,"media"),{recursive:true});
console.log("STUDIO_THEIA_PREPARED_WEB_EXTENSION",JSON.stringify({
  app,target,name:manifest.name,browser:manifest.browser,
  customEditors:manifest.contributes.customEditors.map(x=>x.viewType)
}));
