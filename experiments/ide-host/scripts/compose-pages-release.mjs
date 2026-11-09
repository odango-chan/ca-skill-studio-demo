// Compose the Pages artifact with Theia as the default root and the full
// previous browser Studio preserved at /classic/.
// The caller must build and smoke-test both inputs before invoking this step.
import {cp,mkdtemp,mkdir,readdir,readFile,rm,stat,writeFile} from "node:fs/promises";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";

async function requireFile(root,relative){
  const path=join(root,relative);
  const info=await stat(path).catch(()=>null);
  if(!info?.isFile()||info.size===0)
    throw new Error("Required Pages asset missing or empty: "+path);
  return path;
}

function injectBeforeBody(html,markup,id){
  if(html.includes('id="'+id+'"'))return html;
  const match=html.match(/<body(?:\\s[^>]*)?>/i);
  if(!match)throw new Error("Cannot add navigation banner: HTML has no body element");
  return html.replace(match[0],match[0]+markup);
}

export async function composePagesRelease({classicDist,theiaFrontend,outputDist=classicDist}){
  const classic=resolve(classicDist);
  const output=resolve(outputDist);
  const theia=resolve(theiaFrontend);
  if(classic!==output)
    throw new Error("outputDist must equal classicDist: the original Classic build is staged before replacement");

  // Validate all inputs before touching the original build output.
  for(const asset of ["index.html","app.js","studio.css","light.css","app.css"])
    await requireFile(classic,asset);
  const theiaIndexPath=await requireFile(theia,"index.html");
  for(const asset of ["bundle.js","hostedPlugin/list.json","webview/index.html"])
    await requireFile(theia,asset);
  const theiaHtml=await readFile(theiaIndexPath,"utf8");
  if(!theiaHtml.includes('id="skill-studio-preview-warning"')||
     !theiaHtml.includes('href="./classic/"'))
    throw new Error("Theia index must display the same-origin warning and Classic navigation link");

  const stage=await mkdtemp(join(dirname(output),".skill-studio-classic-"));
  const stagedClassic=join(stage,"classic");
  try{
    await cp(classic,stagedClassic,{recursive:true});
    const classicIndex=await readFile(join(stagedClassic,"index.html"),"utf8");
    const banner='<div id="skill-studio-classic-banner" role="note" style="position:fixed;right:12px;bottom:12px;z-index:2147483000;display:flex;gap:10px;align-items:center;padding:7px 11px;border:1px solid #c8d5e6;border-radius:7px;background:#f7faff;color:#26364a;box-shadow:0 2px 12px #0002;font:12px/1.4 system-ui,sans-serif"><span>Classic · 原版完整工作台</span><a href="../" aria-label="切换新版插件工作台" style="color:#1759a6;font-weight:600">打开新版工作台</a></div>';
    await writeFile(join(stagedClassic,"index.html"),
      injectBeforeBody(classicIndex,banner,"skill-studio-classic-banner"));

    await rm(output,{recursive:true,force:true});
    await mkdir(output,{recursive:true});
    await cp(stagedClassic,join(output,"classic"),{recursive:true});

    for(const entry of await readdir(theia,{withFileTypes:true})){
      await cp(join(theia,entry.name),join(output,entry.name),{
        recursive:true,force:true
      });
    }

    const legacyPreview=join(output,"ide-preview");
    await mkdir(legacyPreview,{recursive:true});
    await writeFile(join(legacyPreview,"index.html"),
      '<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=../"><link rel="canonical" href="../"><meta name="robots" content="noindex"></head><body><p>Theia 已成为默认入口。<a href="../">打开新版工作台</a></p></body></html>');

    // Final artifact assertions: Theia is at root; Classic remains complete.
    await requireFile(output,"index.html");
    await requireFile(output,"bundle.js");
    await requireFile(output,"hostedPlugin/list.json");
    await requireFile(output,"webview/index.html");
    await requireFile(output,"classic/index.html");
    await requireFile(output,"classic/app.js");
    await requireFile(output,"classic/studio.css");
    await requireFile(output,"ide-preview/index.html");
    const rootHtml=await readFile(join(output,"index.html"),"utf8");
    const classicHtml=await readFile(join(output,"classic","index.html"),"utf8");
    if(!rootHtml.includes('href="./classic/"')||
       !classicHtml.includes('href="../"'))
      throw new Error("Published root/Classic navigation is incomplete");
    return Object.freeze({
      defaultHost:"theia-browser-only",
      classicPath:"/classic/",
      legacyPreviewRedirect:"/ide-preview/ -> /",
      sameOriginWarning:true
    });
  }finally{
    await rm(stage,{recursive:true,force:true,maxRetries:4,retryDelay:100});
  }
}

function arg(name){
  const index=process.argv.indexOf(name);
  if(index<0||!process.argv[index+1])
    throw new Error("Missing required argument "+name);
  return process.argv[index+1];
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=await composePagesRelease({
    classicDist:arg("--classic"),
    theiaFrontend:arg("--theia"),
    outputDist:arg("--output")
  });
  console.log("STUDIO_PAGES_COMPOSED",JSON.stringify(result));
}
