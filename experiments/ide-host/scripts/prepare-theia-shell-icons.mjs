// Install the shared Classic icon artwork into any Theia browser frontend.
// This is presentation-only: Theia continues to own command execution and DOM actions.
import {readFile,writeFile} from "node:fs/promises";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {buildClassicIconsCss} from "./classic-icons-css.mjs";
import {prepareTheiaBrand} from "./prepare-theia-brand.mjs";

export async function prepareTheiaShellIcons(rootPath){
  if(typeof rootPath!=="string"||!rootPath.trim())
    throw new Error("Theia frontend root path is required");
  const root=resolve(rootPath);
  const css=buildClassicIconsCss();
  await writeFile(join(root,"classic-icons.css"),css);
  const indexPath=join(root,"index.html");
  let html=await readFile(indexPath,"utf8");
  if(!html.includes('id="skill-studio-classic-icon-theme"')){
    const head=html.match(/<\/head>/i);
    if(!head)throw new Error("Theia frontend index has no head element for Classic shell icons");
    const link='<link id="skill-studio-classic-icon-theme" rel="stylesheet" href="./classic-icons.css">';
    html=html.replace(head[0],link+head[0]);
    await writeFile(indexPath,html);
  }
  const brand=await prepareTheiaBrand(root);
  return Object.freeze({root,cssBytes:Buffer.byteLength(css),stylesheet:"classic-icons.css",brand});
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=process.argv[2]||"experiments/ide-host/theia-online/lib/frontend";
  const result=await prepareTheiaShellIcons(root);
  console.log("THEIA_CLASSIC_SHELL_ICONS_PREPARED",JSON.stringify(result));
}
