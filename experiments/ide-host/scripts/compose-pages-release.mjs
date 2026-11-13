// Publish only the supported Theia browser-only workbench.
// No Classic application, compatibility copy, or alternate legacy entrypoint
// is staged into the Pages artifact.
import {cp,mkdir,readdir,readFile,rm,stat,writeFile} from "node:fs/promises";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";

async function requireFile(root,relative){
  const path=join(root,relative);
  const info=await stat(path).catch(()=>null);
  if(!info?.isFile()||info.size===0)
    throw new Error("Required Pages asset missing or empty: "+path);
  return path;
}

export async function composePagesRelease({theiaFrontend,outputDist,siteRoot=null}){
  if(!theiaFrontend||!outputDist)throw new Error("theiaFrontend and outputDist are required");
  const theia=resolve(theiaFrontend),output=resolve(outputDist);
  for(const asset of [
    "index.html","bundle.js","hostedPlugin/list.json","webview/index.html",
    "hostedPlugin/odango_chan_ca_skill_studio_ide_spike/package.json",
    "hostedPlugin/odango_chan_ca_skill_studio_ide_spike/dist/extension-theia.js",
    "hostedPlugin/odango_chan_ca_skill_studio_ide_spike/dist/skill-language-server.js",
    "hostedPlugin/odango_chan_skill_studio_theme/package.json",
    "hostedPlugin/odango_chan_skill_studio_theme/themes/skill-studio-light-color-theme.json",
    "hostedPlugin/odango_chan_skill_studio_theme/icons/skill-studio-file-icon-theme.json",
    "hostedPlugin/odango_chan_skill_studio_theme/icons/skill.svg",
    "hostedPlugin/odango_chan_skill_studio_languages/package.json"
  ])await requireFile(theia,asset);

  const html=await readFile(join(theia,"index.html"),"utf8");
  if(!html.includes('id="skill-studio-preview-warning"')||
     !html.includes("在线演示")||
     html.includes("/classic/")||
     html.includes("classic-icons.css"))
    throw new Error("Theia index must show the same-origin demo safety warning and contain no Classic navigation/assets");

  const pluginList=await readFile(join(theia,"hostedPlugin/list.json"),"utf8");
  for(const id of ["ca-skill-studio-ide-spike","skill-studio-theme","skill-studio-languages"]){
    if(!pluginList.includes(id))throw new Error("Theia hostedPlugin list is missing "+id);
  }

  await rm(output,{recursive:true,force:true});
  await mkdir(output,{recursive:true});
  for(const entry of await readdir(theia,{withFileTypes:true})){
    await cp(join(theia,entry.name),join(output,entry.name),{recursive:true,force:true});
  }
  await writeFile(join(output,".nojekyll"),"");
  if(siteRoot){
    try{
      const domain=await readFile(join(resolve(siteRoot),"CNAME"),"utf8");
      await writeFile(join(output,"CNAME"),domain);
    }catch(error){if(error?.code!=="ENOENT")throw error;}
  }
  await requireFile(output,"index.html");
  await requireFile(output,"bundle.js");
  await requireFile(output,"hostedPlugin/list.json");
  await requireFile(output,"hostedPlugin/odango_chan_ca_skill_studio_ide_spike/dist/skill-language-server.js");
  const forbidden=["classic","app.js","studio.css","light.css","app.css","ide-preview"];
  for(const name of forbidden){
    const info=await stat(join(output,name)).catch(()=>null);
    if(info)throw new Error("Legacy Classic artifact must not be published: "+name);
  }
  return Object.freeze({defaultHost:"theia-browser-only",classicPublished:false,
    legacyRedirects:false,sameOriginWarning:true});
}

function arg(name){
  const index=process.argv.indexOf(name);
  if(index<0||!process.argv[index+1])throw new Error("Missing required argument "+name);
  return process.argv[index+1];
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=await composePagesRelease({
    theiaFrontend:arg("--theia"),outputDist:arg("--output"),
    siteRoot:process.argv.includes("--site-root")?arg("--site-root"):null
  });
  console.log("STUDIO_PAGES_COMPOSED",JSON.stringify(result));
}
