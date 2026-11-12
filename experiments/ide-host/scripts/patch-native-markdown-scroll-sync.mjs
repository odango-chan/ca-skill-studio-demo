// The VS Code Markdown Preview uses a suppression counter to ignore scroll
// events caused by source-driven preview positioning. In Theia, one source
// update can generate several programmatic scrolls without matching browser
// scroll events. A later genuine wheel gesture is then swallowed by the stale
// counter, breaking Preview -> Source synchronization. Clear only that stale
// suppression when the user starts a real scroll gesture.
import {readFile,writeFile,stat} from "node:fs/promises";
import {resolve,join} from "node:path";

const root=resolve(process.argv[2]??"experiments/ide-host/theia-online/plugins/vscode.markdown-language-features");
const manifest=JSON.parse(await readFile(join(root,"package.json"),"utf8"));
if(manifest.name!=="markdown-language-features"||manifest.version!=="1.95.3")
  throw Error("Unexpected native Markdown extension identity/version: "+
    JSON.stringify({name:manifest.name,version:manifest.version}));
if(!(manifest.contributes?.["markdown.previewScripts"]??[]).includes("./media/index.js"))
  throw Error("Pinned Markdown extension no longer uses media/index.js as its Preview runtime");
const scriptPath=join(root,"media","index.js");
const info=await stat(scriptPath);
if(!info.isFile()||info.size<1000)throw Error("Native Markdown Preview runtime is missing or empty");
let script=await readFile(scriptPath,"utf8");
const marker="STUDIO_NATIVE_MARKDOWN_USER_SCROLL_RESET";
if(script.includes(marker)){
  console.log("STUDIO_NATIVE_MARKDOWN_SCROLL_PATCH",JSON.stringify({
    root,version:manifest.version,alreadyPatched:true,bytes:info.size
  }));
  process.exit(0);
}
const declaration=/\\bscrollDisabledCount\\s*=\\s*0\\b/;
const match=script.match(declaration);
if(!match){
  const reveal=script.indexOf("revealLine");
  console.log("STUDIO_NATIVE_MARKDOWN_SCROLL_RUNTIME_DIAGNOSTIC",JSON.stringify({
    bytes:script.length,hasCounter:script.includes("scrollDisabledCount"),
    revealSnippet:reveal>=0?script.slice(Math.max(0,reveal-900),Math.min(script.length,reveal+250)):"revealLine token not found"
  }));
  throw Error("Pinned Markdown Preview runtime no longer exposes its expected scroll suppression counter");
}
const reset=`
// STUDIO_NATIVE_MARKDOWN_USER_SCROLL_RESET: a real user gesture supersedes stale programmatic-scroll suppression.
const studioResetNativeMarkdownScrollSuppression = () => { scrollDisabledCount = 0; };
window.addEventListener("wheel", studioResetNativeMarkdownScrollSuppression, {capture:true, passive:true});
window.addEventListener("touchstart", studioResetNativeMarkdownScrollSuppression, {capture:true, passive:true});
window.addEventListener("pointerdown", studioResetNativeMarkdownScrollSuppression, true);
window.addEventListener("keydown", event => {
  if (["ArrowUp","ArrowDown","PageUp","PageDown","Home","End"," "].includes(event.key))
    studioResetNativeMarkdownScrollSuppression();
}, true);
`;
const insertionAt=match.index+match[0].length;
script=script.slice(0,insertionAt)+reset+script.slice(insertionAt);
if(!script.includes(marker)||!script.includes('addEventListener("wheel"'))
  throw Error("Native Markdown user-scroll compatibility patch did not apply");
await writeFile(scriptPath,script);
console.log("STUDIO_NATIVE_MARKDOWN_SCROLL_PATCH",JSON.stringify({
  root,version:manifest.version,alreadyPatched:false,bytesBefore:info.size,bytesAfter:script.length
}));
