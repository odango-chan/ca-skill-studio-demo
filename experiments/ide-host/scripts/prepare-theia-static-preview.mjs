// Demo-only static preview adapter for Theia browser-only.
// Theia's normal default uses per-webview subdomains. GitHub Pages cannot
// provision wildcard webview DNS/certificates, so this isolated preview uses
// same-origin sandboxed webviews. Do not use this build for sensitive files
// or production. The full backend host keeps the normal isolated host pattern.
import {copyFile,cp,mkdir,readdir,readFile,stat,writeFile} from "node:fs/promises";
import {join,resolve} from "node:path";
const root=resolve("experiments/ide-host/theia-online/lib/frontend");
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
const warning='<div id="skill-studio-preview-warning" role="note" style="position:fixed;right:12px;bottom:12px;z-index:2147483000;padding:7px 11px;border:1px solid #d6a84b;border-radius:7px;background:#fff4d6;color:#614600;box-shadow:0 2px 12px #0002;font:12px/1.4 system-ui,sans-serif">在线演示 · Webview 使用同源模式 · 请勿打开敏感文件</div>';
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
for(const name of ["samples","media","icons","l10n","package.nls.json","package.nls.zh-cn.json"]){
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
// The built-in Markdown extension starts its language server in a browser
// Worker relative to extensionUri. Stage the complete pinned extension into
// the static frontend because Theia's static copier omits arbitrary plugin assets.
const markdownPluginSource=resolve(
  "experiments/ide-host/theia-online/plugins/vscode.markdown-language-features");
const markdownPluginTarget=join(root,"hostedPlugin","vscode_markdown_language_features");
await mkdir(markdownPluginTarget,{recursive:true});
await cp(markdownPluginSource,markdownPluginTarget,{recursive:true,force:true});
const markdownManifest=JSON.parse(await readFile(
  join(markdownPluginTarget,"package.json"),"utf8"));
// The host owns the first-open lifecycle. Let Skill Studio activate this
// extension explicitly after a Markdown editor is selected; the upstream
// onLanguage event otherwise races that explicit activation in Theia's
// browser PluginHost and can strand LanguageClient in Starting.
const markdownActivationEvents=markdownManifest.activationEvents;
if(!Array.isArray(markdownActivationEvents))
  throw Error("Pinned Markdown manifest does not expose activationEvents");
const markdownLanguageActivationCount=markdownActivationEvents.filter(
  event=>event==="onLanguage:markdown").length;
if(markdownLanguageActivationCount!==1)
  throw Error("Expected exactly one upstream onLanguage:markdown activation event; found "+
    markdownLanguageActivationCount);
markdownManifest.activationEvents=markdownActivationEvents.filter(
  event=>event!=="onLanguage:markdown");
await writeFile(join(markdownPluginTarget,"package.json"),
  JSON.stringify(markdownManifest,null,2)+"\n");
const hostedPluginListPath=join(root,"hostedPlugin","list.json");
const hostedPluginList=JSON.parse(await readFile(hostedPluginListPath,"utf8"));
const markdownPluginEntry=hostedPluginList.find(entry=>
  entry.metadata?.model?.id==="vscode.markdown-language-features");
if(!markdownPluginEntry)
  throw Error("Theia hostedPlugin list is missing the pinned Markdown extension");
const hostedActivationEvents=markdownPluginEntry.contributes?.activationEvents;
if(!Array.isArray(hostedActivationEvents))
  throw Error("Theia hostedPlugin list is missing Markdown activation events");
const hostedLanguageActivationCount=hostedActivationEvents.filter(
  event=>event==="onLanguage:markdown").length;
if(hostedLanguageActivationCount!==1)
  throw Error("Expected exactly one Theia onLanguage:markdown activation event; found "+
    hostedLanguageActivationCount);
markdownPluginEntry.contributes.activationEvents=hostedActivationEvents.filter(
  event=>event!=="onLanguage:markdown");
await writeFile(hostedPluginListPath,JSON.stringify(hostedPluginList,null,2)+"\n");
console.log("STUDIO_THEIA_STATIC_MARKDOWN_COLD_ACTIVATION",JSON.stringify({
  extensionId:"vscode.markdown-language-features",
  removedOnLanguageActivation:true,
  packageActivationEvents:markdownManifest.activationEvents,
  hostedActivationEvents:markdownPluginEntry.contributes.activationEvents
}));
const markdownBrowserEntry=String(markdownManifest.browser??"").startsWith("./")
  ?markdownManifest.browser.slice(2):markdownManifest.browser;
const markdownWorker=join(markdownPluginTarget,"dist","browser","serverWorkerMain.js");
for(const required of [
  join(markdownPluginTarget,"package.json"),
  join(markdownPluginTarget,markdownBrowserEntry??""),
  markdownWorker
]){
  const info=await stat(required);
  if(!info.isFile()||info.size<100)
    throw Error("Static hosted native Markdown asset missing or empty: "+required);
}
const markdownBrowserEntryPath=join(markdownPluginTarget,markdownBrowserEntry??"");
let markdownBrowserBundle=await readFile(markdownBrowserEntryPath,"utf8");
const markdownWorkerCreation="const worker = new Worker(serverMain.toString());";
const markdownWorkerCreationPatched=String.raw`const workerBase = new URL(".", globalThis.location.href);
const workerUrl = new URL(serverMain.toString(), workerBase);
const workerBasePath = workerBase.pathname.replace(/\/$/, "");
if (workerBasePath && workerUrl.origin === workerBase.origin &&
    workerUrl.pathname.startsWith("/hostedPlugin/") &&
    !workerUrl.pathname.startsWith(workerBasePath + "/")) {
  workerUrl.pathname = workerBasePath + workerUrl.pathname;
}
const worker = new Worker(workerUrl.toString());
worker.addEventListener("error", event => {
  console.error("[Skill Studio Markdown Language Server Worker Error]", JSON.stringify({
    url: workerUrl.toString(),
    message: event.message || "Worker error",
    filename: event.filename || "",
    lineno: event.lineno || 0,
    colno: event.colno || 0,
    error: event.error ? String(event.error.stack || event.error.message || event.error) : ""
  }));
});
worker.addEventListener("messageerror", event => {
  console.error("[Skill Studio Markdown Language Server Worker MessageError]", JSON.stringify({
    url: workerUrl.toString(),
    message: event.message || "Worker message deserialization failed"
  }));
});`;
const markdownWorkerCreationCount=markdownBrowserBundle.split(markdownWorkerCreation).length-1;
if(markdownWorkerCreationCount!==1)
  throw Error("Pinned Markdown Worker creation changed; expected exactly one patch point, found "+markdownWorkerCreationCount);
markdownBrowserBundle=markdownBrowserBundle.replace(markdownWorkerCreation,markdownWorkerCreationPatched);
await writeFile(markdownBrowserEntryPath,markdownBrowserBundle);
console.log("STUDIO_THEIA_STATIC_MARKDOWN_WORKER_BASE_PATH",JSON.stringify({
  browserEntry:markdownBrowserEntryPath,basePathAware:true,patchCount:markdownWorkerCreationCount
}));
const pluginWorkerPath=join(root,"plugin-worker.js");
let pluginWorkerBundle=await readFile(pluginWorkerPath,"utf8");
const webviewResourceMapping=String.raw`toGeneralWebviewResource(e,t){let n=Hd.URI.parse(e.packageUri),i=t.path.replace(n.path,""),r=Xke.PluginPackage.toPluginUrl(e,"")+i;return Hd.URI.parse(this.initData.webviewResourceRoot.replace("{{uuid}}","webviewUUID")).with({path:r})}`;
const webviewResourceMappingPatched=String.raw`toGeneralWebviewResource(e,t){let n=Hd.URI.parse(e.packageUri),i=t.path.replace(n.path,""),r=Xke.PluginPackage.toPluginUrl(e,"")+i;const basePath=new URL(".",globalThis.location.href).pathname.replace(/\/$/,"");const resourcePath=r.startsWith("/")?r:"/"+r;if(basePath&&resourcePath.startsWith("/hostedPlugin/")&&!resourcePath.startsWith(basePath+"/"))r=basePath+resourcePath;return Hd.URI.parse(this.initData.webviewResourceRoot.replace("{{uuid}}","webviewUUID")).with({path:r})}`;
const webviewResourceMappingCount=pluginWorkerBundle.split(webviewResourceMapping).length-1;
if(webviewResourceMappingCount!==1)
  throw Error("Pinned Theia plugin-worker Webview resource mapping changed; expected exactly one patch point, found "+webviewResourceMappingCount);
pluginWorkerBundle=pluginWorkerBundle.replace(webviewResourceMapping,webviewResourceMappingPatched);
const webviewAsWebviewUri=String.raw`asWebviewUri(e){let t=this.initData.webviewResourceRoot.replace("{{scheme}}",e.scheme).replace("{{authority}}",e.authority).replace("{{path}}",e.path.replace(/^\//,"")).replace("{{uuid}}",this.origin??this.viewId);return Hd.URI.parse(t).with({query:e.query})}`;
const webviewAsWebviewUriPatched=String.raw`asWebviewUri(e){let t=this.initData.webviewResourceRoot.replace("{{scheme}}",e.scheme).replace("{{authority}}",e.authority).replace("{{path}}",e.path.replace(/^\//,"")).replace("{{uuid}}",this.origin??this.viewId);const basePath=new URL(".",globalThis.location.href).pathname.replace(/\/$/,"");if(basePath){const resource=Hd.URI.parse(t);if((resource.scheme==="http"||resource.scheme==="https")&&resource.path.startsWith("/hostedPlugin/")&&!resource.path.startsWith(basePath+"/"))t=resource.with({path:basePath+resource.path}).toString()}return Hd.URI.parse(t).with({query:e.query})}`;
const webviewAsWebviewUriCount=pluginWorkerBundle.split(webviewAsWebviewUri).length-1;
if(webviewAsWebviewUriCount!==1)
  throw Error("Pinned Theia Webview.asWebviewUri mapping changed; expected exactly one patch point, found "+webviewAsWebviewUriCount);
pluginWorkerBundle=pluginWorkerBundle.replace(webviewAsWebviewUri,webviewAsWebviewUriPatched);
console.log("STUDIO_THEIA_STATIC_WEBVIEW_API_BASE_PATH",JSON.stringify({
  pluginWorkerPath,basePathAware:true,patchCount:webviewAsWebviewUriCount
}));
await writeFile(pluginWorkerPath,pluginWorkerBundle);
console.log("STUDIO_THEIA_STATIC_WEBVIEW_RESOURCE_BASE_PATH",JSON.stringify({
  pluginWorkerPath,basePathAware:true,patchCount:webviewResourceMappingCount
}));
console.log("STUDIO_THEIA_STATIC_MARKDOWN_ASSETS",JSON.stringify({
  markdownPluginTarget,version:markdownManifest.version,
  browser:markdownManifest.browser,workerBytes:(await stat(markdownWorker)).size
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
