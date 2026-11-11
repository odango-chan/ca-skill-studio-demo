// Demo-only static preview adapter for Theia browser-only.
// Theia's normal default uses per-webview subdomains. GitHub Pages cannot
// provision wildcard webview DNS/certificates, so this isolated preview uses
// same-origin sandboxed webviews. Do not use this build for sensitive files
// or production. The full backend host keeps the normal isolated host pattern.
import {copyFile,cp,mkdir,readdir,readFile,stat,writeFile} from "node:fs/promises";
import {join,resolve} from "node:path";
import {prepareTheiaShellIcons} from "./prepare-theia-shell-icons.mjs";

const root=resolve("experiments/ide-host/theia-online/lib/frontend");
const classicIconTheme=await prepareTheiaShellIcons(root);
const bundlePath=join(root,"bundle.js");
let bundle=await readFile(bundlePath,"utf8");
const from='defaultPattern="{{uuid}}.webview.{{hostname}}"';
const to='defaultPattern="{{hostname}}"';
const count=bundle.split(from).length-1;
if(count!==1)throw Error("Expected exactly one pinned Theia 1.76 webview host pattern; found "+count);
bundle=bundle.replace(from,to);
await writeFile(bundlePath,bundle);

const source=resolve("experiments/ide-host/theia-online/node_modules/@theia/plugin-ext/src/main/browser/webview/pre");
const target=join(root,"webview");
await mkdir(target,{recursive:true});
const files=await readdir(source,{withFileTypes:true});
let copied=0;
for(const entry of files){
  if(!entry.isFile())continue;
  await copyFile(join(source,entry.name),join(target,entry.name));
  copied++;
}
for(const required of ["index.html","fake.html","main.js"]){
  if(!files.some(entry=>entry.isFile()&&entry.name===required))
    throw Error("Missing pinned Theia webview asset: "+required);
}
const indexPath=join(root,"index.html");
let indexHtml=await readFile(indexPath,"utf8");
const warning='<div id="skill-studio-preview-warning" role="note" style="position:fixed;right:12px;bottom:12px;z-index:2147483000;display:flex;gap:10px;align-items:center;padding:7px 11px;border:1px solid #d6a84b;border-radius:7px;background:#fff4d6;color:#614600;box-shadow:0 2px 12px #0002;font:12px/1.4 system-ui,sans-serif"><span>在线演示 · Webview 使用同源模式 · 请勿打开敏感文件</span><a href="./classic/" aria-label="打开原版完整工作台" style="color:#704c00;font-weight:600">打开原版工作台</a></div>';
if(!indexHtml.includes('id="skill-studio-preview-warning"')){
  const body=indexHtml.match(/<body(?:\s[^>]*)?>/i);
  if(!body)throw Error("Theia frontend index has no body element for the required safety/navigation banner");
  indexHtml=indexHtml.replace(body[0],body[0]+warning);
}
await writeFile(indexPath,indexHtml);
// Theia's browser-only static build emits the extension worker bundle but
// does not carry arbitrary package assets through its hostedPlugin copier.
// Explicitly stage the read-only sample package and Webview media beside it.
const pluginSource=resolve("experiments/ide-host/theia-online/plugins/odango-chan.ca-skill-studio-ide-spike");
const pluginTarget=join(root,"hostedPlugin","odango_chan_ca_skill_studio_ide_spike");
for(const name of ["samples","media","icons"]){
  await cp(join(pluginSource,name),join(pluginTarget,name),{recursive:true,force:true});
}
for(const required of [
  join(pluginTarget,"samples","skills","files.json"),
  join(pluginTarget,"samples","skills","establish-pdu-session","assurance","procedure.yaml"),
  join(pluginTarget,"samples","skills","establish-pdu-session-mas","assurance","procedure.yaml"),
  join(pluginTarget,"media","procedure.js"),
  join(pluginTarget,"media","procedure.css")
]){
  const info=await stat(required);
  if(!info.isFile()||info.size<100)
    throw Error("Static hosted plugin asset missing or empty: "+required);
}
console.log("STUDIO_THEIA_STATIC_PLUGIN_ASSETS",JSON.stringify({
  pluginTarget,assets:["samples/**","media/**","icons/**"],sameOriginOnly:true
}));
// Theia does not copy arbitrary extension assets into hostedPlugin.
// Preserve the exact theme package paths referenced by its contribution JSON.
const themePluginSource=resolve("experiments/ide-host/theia-online/plugins/odango-chan.skill-studio-theme");
const themePluginTarget=join(root,"hostedPlugin","odango_chan_skill_studio_theme");
await mkdir(themePluginTarget,{recursive:true});
await cp(join(themePluginSource,"package.json"),join(themePluginTarget,"package.json"),{force:true});
for(const name of ["themes","icons","styles"]){
  await cp(join(themePluginSource,name),join(themePluginTarget,name),{recursive:true,force:true});
}
for(const required of [
  join(themePluginTarget,"package.json"),
  join(themePluginTarget,"themes","skill-studio-light-color-theme.json"),
  join(themePluginTarget,"icons","skill-studio-file-icon-theme.json"),
  join(themePluginTarget,"styles","markdown-preview.css"),
  ...["skill","yaml","markdown","python","json","shell","text","file","folder","folder-open","code"]
    .map(name=>join(themePluginTarget,"icons",name+".svg"))
]){
  const info=await stat(required);
  if(!info.isFile()||info.size<80)
    throw Error("Static hosted Skill Studio theme asset missing or empty: "+required);
}
console.log("STUDIO_THEIA_STATIC_THEME_ASSETS",JSON.stringify({
  themePluginTarget,assets:["package.json","themes/**","icons/**","styles/**"],offlinePackage:true,
  classicShellIconCss:classicIconTheme.cssBytes
}));
// The static frontend's hostedPlugin copier omits arbitrary declarative
// extension assets just as it does for the theme package. Stage the pinned
// TextMate grammar package explicitly; otherwise YAML/Python documents fall
// back to plain-text tokenization even though the plugin manifest is listed.
const syntaxPluginSource=resolve("experiments/ide-host/theia-online/plugins/odango-chan.skill-studio-languages");
const syntaxPluginTarget=join(root,"hostedPlugin","odango_chan_skill_studio_languages");
const syntaxManifest=JSON.parse(await readFile(join(syntaxPluginSource,"package.json"),"utf8"));
if(syntaxManifest.main||syntaxManifest.browser)
  throw Error("Static syntax extension must remain declarative");
await mkdir(syntaxPluginTarget,{recursive:true});
await copyFile(join(syntaxPluginSource,"package.json"),join(syntaxPluginTarget,"package.json"));
await cp(join(syntaxPluginSource,"upstream"),join(syntaxPluginTarget,"upstream"),
  {recursive:true,force:true});
const missingSyntaxAssets=[];
for(const grammar of syntaxManifest.contributes?.grammars??[]){
  const asset=join(syntaxPluginTarget,grammar.path);
  try{
    const info=await stat(asset);
    if(!info.isFile()||info.size<100)missingSyntaxAssets.push(grammar.path);
  }catch{missingSyntaxAssets.push(grammar.path);}
}
if(missingSyntaxAssets.length)
  throw Error("Static hosted syntax grammar assets missing: "+missingSyntaxAssets.join(", "));
console.log("STUDIO_THEIA_STATIC_SYNTAX_ASSETS",JSON.stringify({
  syntaxPluginTarget,languages:syntaxManifest.contributes.languages.map(item=>item.id),
  grammarCount:syntaxManifest.contributes.grammars.length,offlinePackage:true
}));
console.log("STUDIO_THEIA_STATIC_WEBVIEW_PREVIEW",JSON.stringify({
  theiaVersion:"1.76.0",hostPattern:"{{hostname}}",sameOriginDemoOnly:true,
  webviewAssets:copied,target
}));
