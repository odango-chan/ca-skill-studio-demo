// Demo-only static preview adapter for Theia browser-only.
// Theia's normal default uses per-webview subdomains. GitHub Pages cannot
// provision wildcard webview DNS/certificates, so this isolated preview uses
// same-origin sandboxed webviews. Do not use this build for sensitive files
// or production. The full backend host keeps the normal isolated host pattern.
import {copyFile,mkdir,readdir,readFile,writeFile} from "node:fs/promises";
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
console.log("STUDIO_THEIA_STATIC_WEBVIEW_PREVIEW",JSON.stringify({
  theiaVersion:"1.76.0",hostPattern:"{{hostname}}",sameOriginDemoOnly:true,
  webviewAssets:copied,target
}));
