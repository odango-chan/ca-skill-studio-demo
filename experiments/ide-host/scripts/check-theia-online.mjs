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
const index=files.find(p=>p.endsWith("/index.html"));
if(!index)throw Error("Browser-only frontend index.html was not emitted");
if(statSync(index).size<200)throw Error("Empty HTML");
const pluginLists=files.filter(p=>p.endsWith("/hostedPlugin/list.json"));
const pluginListEvidence=pluginLists.map(p=>({path:p,text:readFileSync(p,"utf8").slice(0,3000)}));
const hasProcedurePlugin=files.some(p=>p.includes("odango_chan_ca_skill_studio_ide_spike"))||
  pluginListEvidence.some(p=>p.text.includes("ca-skill-studio-ide-spike"));
const hasThemePlugin=files.some(p=>p.includes("odango_chan_skill_studio_theme"))||
  pluginListEvidence.some(p=>p.text.includes("skill-studio-theme"));
const themeAssets=[
  "hostedPlugin/odango_chan_skill_studio_theme/package.json",
  "hostedPlugin/odango_chan_skill_studio_theme/themes/skill-studio-light-color-theme.json",
  "hostedPlugin/odango_chan_skill_studio_theme/icons/skill-studio-file-icon-theme.json",
  "hostedPlugin/odango_chan_skill_studio_theme/icons/skill.svg",
  "hostedPlugin/odango_chan_skill_studio_theme/icons/yaml.svg"
].map(p=>join(root,p));
const missingThemeAssets=themeAssets.filter(p=>!existsSync(p));
console.log("STUDIO_THEIA_FRONTEND_ARTIFACT",JSON.stringify({
  index,files:files.length,pluginLists:pluginLists.map(p=>p.path),
  procedurePlugin:hasProcedurePlugin,themePlugin:hasThemePlugin,
  themeAssets:themeAssets.filter(existsSync),missingThemeAssets
}));
if(!hasProcedurePlugin)throw Error("Theia browser-only build lacks prepared SKILL Studio Web extension");
if(!hasThemePlugin)throw Error("Theia browser-only build lacks the built-in Skill Studio theme extension");
if(missingThemeAssets.length)throw Error("Theia static preview is missing theme assets: "+missingThemeAssets.join(", "));

// Exercise the pinned host matcher, including Windows URI separators. A plain
// **/assurance/procedure.yaml takes a platform-separator fast path in Theia.
const {match}=createRequire(import.meta.url)("../theia-online/node_modules/@theia/core/lib/common/glob.js");
const manifest=JSON.parse(readFileSync("experiments/ide-host/vscode/package.json","utf8"));
const pattern=manifest.contributes.customEditors[0].selector[0].filenamePattern;
for(const path of ["file:/workspace/assurance/procedure.yaml","file:/C:/workspace/assurance/procedure.yaml","file:/.theia/globalStorage/demo/assurance/procedure.yaml"]){
  if(!match(pattern,path))throw Error("Native CustomEditor selector failed: "+path);
}
for(const path of ["file:/workspace/procedure.yaml","file:/workspace/assurance/contract.yaml"]){
  if(match(pattern,path))throw Error("CustomEditor selector claimed unrelated Source: "+path);
}
console.log("STUDIO_NATIVE_EDITOR_ASSOCIATION_MATCH_PASS");
