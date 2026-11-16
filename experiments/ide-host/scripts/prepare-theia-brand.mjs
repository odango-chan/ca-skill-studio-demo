// Register one native SKILL Studio top-level menu in the pinned Theia browser host.
// Keep the real Lumino menu bar and its keyboard/command behavior authoritative.
import {readFile,writeFile} from "node:fs/promises";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";

export function buildSkillStudioBrandCss(){
  return `/* Theia 1.76 fades out its preload overlay before removing it.
   * Once it is marked hidden, never let that transparent overlay intercept
   * real menu clicks during the final transition frame. */
.theia-preload.theia-hidden{
  pointer-events:none;
}
/* The first top-level item is the real Theia menu model contribution.
 * Style only its native Lumino title; never add a separate branded button. */
.lm-MenuBar{
  min-width:0;
}
.lm-MenuBar > .lm-MenuBar-content{
  min-width:0;
}
.lm-MenuBar .lm-MenuBar-item:first-child{
  font-weight:650;
  letter-spacing:-.02em;
  color:var(--theia-ui-font-color1,#233550);
}
`;
}

export function buildSkillStudioBrandScript(){
  return `// Theia 1.76 native MenuModelRegistry adapter.
  // This is not a DOM menu or an event interception: the registry owns every
  // action and Lumino owns the entire rendered menu and keyboard navigation.
(() => {
  const TOP=["menubar","00_skill_studio"];
  const zh=/^zh\\b/i.test(document.documentElement.lang||navigator.language||"");
  const labels=zh?{
    welcome:"欢迎页面",newProject:"新建项目",openProject:"打开项目",
    example:"打开示例项目",selectRoot:"选择项目",refresh:"刷新 Package",
    dependency:"添加依赖",audit:"审计当前 Package（编辑器）",
    spec:"Skill 语言规范",guide:"编写指南"
  }:{
    welcome:"Welcome",newProject:"New Project",openProject:"Open Project",
    example:"Open Example Project",selectRoot:"Select Project",refresh:"Refresh Packages",
    dependency:"Add Dependency",audit:"Audit Current Package (Editor)",
    spec:"Skill Language Specification",guide:"Authoring Guide"
  };
  const actions=[
    ["01_project","0","skillStudio.showWelcome",labels.welcome],
    ["01_project","1","skillStudio.newProject",labels.newProject],
    ["01_project","2","skillStudio.openProject",labels.openProject],
    ["01_project","3","skillStudio.loadExample",labels.example],
    ["02_package","0","skillStudio.selectProjectRoot",labels.selectRoot],
    ["02_package","1","skillStudio.refreshPackages",labels.refresh],
    ["02_package","2","skillStudio.addDependency",labels.dependency],
    ["02_package","3","skillStudio.auditPackage",labels.audit],
    ["03_documentation","0","skillStudio.openLanguageSpec",labels.spec],
    ["03_documentation","1","skillStudio.openAuthoringGuide",labels.guide]
  ];
  let attempts=0;
  function install(){
    const container=window.theia?.container;
    const bar=document.querySelector('[id="theia:menubar"].lm-MenuBar');
    const keys=container?._bindingDictionary?._map?.keys?.();
    if(!bar||!keys)return false;
    const all=[...keys];
    const menuKey=all.find(key=>typeof key==="function"&&
      key.prototype?.registerSubmenu&&key.prototype?.registerMenuAction&&
      key.prototype?.getMenuNode);
    const commandsKey=all.find(key=>typeof key==="function"&&
      key.prototype?.executeCommand&&key.prototype?.registerCommand&&
      key.prototype?.getCommand);
    if(!menuKey||!commandsKey)return false;
    const commands=container.get(commandsKey);
    // Wait for the real VS Code extension commands. Missing commands must not
    // result in an empty or misleading menu that appears to have succeeded.
    if(!actions.every(([, , id])=>
      commands.getCommand(id)&&commands.isVisible(id)))return false;
    const menus=container.get(menuKey);
    const root=menus.getMenuNode(["menubar"]);
    if(root?.children?.some(node=>node.id===TOP[1])){
      const existing=root.children.find(node=>node.id===TOP[1]);
      if(existing?.label!=="SKILL Studio")throw Error("Conflicting Studio top-level menu");
    }else{
      // Pre-register all groups and actions, then turn the placeholder group
      // into the named submenu. Theia emits a native menu-bar change on
      // registerSubmenu, rebuilding the real Lumino menu in one operation.
      for(const [group,order,id,label] of actions)
        menus.registerMenuAction([...TOP,group],{commandId:id,label,order});
      menus.registerSubmenu(TOP,"SKILL Studio",{sortString:"00"});
    }
    document.documentElement.dataset.skillStudioBrand="ready";
    document.documentElement.dataset.skillStudioNativeMenu="ready";
    return true;
  }
  const handle=setInterval(()=>{
    try{
      if(install()){clearInterval(handle);return;}
      if(++attempts>200){
        clearInterval(handle);
        document.documentElement.dataset.skillStudioNativeMenu="unavailable";
        console.error("SKILL Studio native menu: registry or commands unavailable");
      }
    }catch(error){
      clearInterval(handle);
      document.documentElement.dataset.skillStudioNativeMenu="error";
      console.error("SKILL Studio native menu registration failed",error);
    }
  },200);
})();
`;
}

function ensureHeadLink(html,id,href){
  const expected='<link id="'+id+'" rel="stylesheet" href="'+href+'">';
  if(html.includes('id="'+id+'"')){
    if(!html.includes(expected))
      throw new Error("Unexpected existing SKILL Studio stylesheet tag: "+id);
    return html;
  }
  const head=html.match(/<\/head>/i);
  if(!head)throw new Error("Theia frontend index has no head element for "+id);
  return html.replace(head[0],expected+head[0]);
}

function ensureBodyScript(html,id,src){
  const expected='<script id="'+id+'" type="module" src="'+src+'"></script>';
  if(html.includes('id="'+id+'"')){
    if(!html.includes(expected))
      throw new Error("Unexpected existing SKILL Studio script tag: "+id);
    return html;
  }
  const body=html.match(/<\/body>/i);
  if(!body)throw new Error("Theia frontend index has no body element for "+id);
  return html.replace(body[0],expected+body[0]);
}

export async function prepareTheiaBrand(rootPath){
  if(typeof rootPath!=="string"||!rootPath.trim())
    throw new Error("Theia frontend root path is required");
  const root=resolve(rootPath);
  const css=buildSkillStudioBrandCss();
  const script=buildSkillStudioBrandScript();
  await writeFile(join(root,"skill-studio-brand.css"),css);
  await writeFile(join(root,"skill-studio-brand.js"),script);

  const indexPath=join(root,"index.html");
  const original=await readFile(indexPath,"utf8");
  let html=ensureHeadLink(original,"skill-studio-brand-theme","./skill-studio-brand.css");
  html=ensureBodyScript(html,"skill-studio-brand-script","./skill-studio-brand.js");
  if(html!==original)await writeFile(indexPath,html);

  return Object.freeze({
    root,
    stylesheet:"skill-studio-brand.css",
    script:"skill-studio-brand.js",
    cssBytes:Buffer.byteLength(css),
    scriptBytes:Buffer.byteLength(script)
  });
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=process.argv[2]||"experiments/ide-host/theia-online/lib/frontend";
  const result=await prepareTheiaBrand(root);
  console.log("THEIA_SKILL_STUDIO_BRAND_PREPARED",JSON.stringify(result));
}
