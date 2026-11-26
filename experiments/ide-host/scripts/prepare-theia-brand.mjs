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
/* Keep the standard IDE menu order. Skill Studio is a native menu entry,
 * not a replacement for File or a separate branded button. */
.lm-MenuBar{
  min-width:0;
}
.lm-MenuBar > .lm-MenuBar-content{
  min-width:0;
}
`;
}
export function buildSkillStudioBrandScript(){
  return String.raw`// Theia 1.76 native MenuModelRegistry adapter.
(() => {
  const TOP=["menubar","5z_skill_studio"];
  const zh=/^zh\b/i.test(document.documentElement.lang||navigator.language||"");
  const labels=zh?{
    project:"项目",skill:"Skill",dependencies:"依赖",authoring:"编写",tools:"工具",help:"帮助",
    welcome:"欢迎页面",diagnostics:"激活诊断",newProject:"新建项目",openProject:"打开项目",
    example:"打开示例项目",selectRoot:"选择项目根目录",refresh:"刷新 Package",
    check:"检查 Skill",build:"构建 Skill",inspect:"检查依赖",
    audit:"审计当前 Package",export:"导出 Package ZIP",
    addDependency:"添加依赖",refreshDependencies:"刷新依赖",
    procedure:"打开 Procedure 预览",contract:"打开 Contract 预览",
    predicates:"打开 Predicate 预览",schema:"打开 Schema 预览",
    refreshInspection:"刷新检查结果",restartLsp:"重启语言服务",
    spec:"Skill 语言规范",guide:"编写指南"
  }:{
    project:"Project",skill:"Skill",dependencies:"Dependencies",authoring:"Authoring",tools:"Tools",help:"Help",
    welcome:"Welcome",diagnostics:"Activation Diagnostics",newProject:"New Project",openProject:"Open Project",
    example:"Open Example Project",selectRoot:"Select Project Root",refresh:"Refresh Packages",
    check:"Check Skill",build:"Build Skill",inspect:"Inspect Dependencies",
    audit:"Audit Current Package",export:"Export Package ZIP",
    addDependency:"Add Dependency",refreshDependencies:"Refresh Dependencies",
    procedure:"Open Procedure Preview",contract:"Open Contract Preview",
    predicates:"Open Predicate Preview",schema:"Open Schema Preview",
    refreshInspection:"Refresh Inspection",restartLsp:"Restart Language Service",
    spec:"Skill Language Specification",guide:"Authoring Guide"
  };
  const groups=[
    {id:"01_project",label:labels.project,actions:[
      ["0","skillStudio.showWelcome",labels.welcome],
      ["1","skillStudio.newProject",labels.newProject],
      ["2","skillStudio.openProject",labels.openProject],
      ["3","skillStudio.loadExample",labels.example],
      ["4","skillStudio.selectProjectRoot",labels.selectRoot],
      ["5","skillStudio.refreshPackages",labels.refresh]
    ]},
    {id:"02_skill",label:labels.skill,actions:[
      ["0","skillStudio.checkSkill",labels.check],
      ["1","skillStudio.buildSkill",labels.build],
      ["2","skillStudio.inspectCompilerDependencies",labels.inspect],
      ["3","skillStudio.auditPackage",labels.audit],
      ["4","skillStudio.exportPackageZip",labels.export]
    ]},
    {id:"03_dependencies",label:labels.dependencies,actions:[
      ["0","skillStudio.addDependency",labels.addDependency],
      ["1","skillStudio.refreshDependencies",labels.refreshDependencies]
    ]},
    {id:"04_authoring",label:labels.authoring,actions:[
      ["0","skillStudio.openProcedure",labels.procedure],
      ["1","skillStudio.openContract",labels.contract],
      ["2","skillStudio.openPredicates",labels.predicates],
      ["3","skillStudio.openSchema",labels.schema]
    ]},
    {id:"05_tools",label:labels.tools,actions:[
      ["0","skillStudio.refreshInspection",labels.refreshInspection],
      ["1","skillStudio.restartLanguageService",labels.restartLsp],
      ["2","skillStudio.showActivationDiagnostics",labels.diagnostics]
    ]},
    {id:"06_help",label:labels.help,actions:[
      ["0","skillStudio.openLanguageSpec",labels.spec],
      ["1","skillStudio.openAuthoringGuide",labels.guide]
    ]}
  ];
  const fileActions=[
    {path:["menubar","1_file","1_new"],order:"80",id:"skillStudio.newProject",label:labels.newProject},
    {path:["menubar","1_file","2_open"],order:"80",id:"skillStudio.openProject",label:labels.openProject},
    {path:["menubar","1_file","2_open"],order:"81",id:"skillStudio.loadExample",label:labels.example}
  ];
  const actionIds=[
    ...groups.flatMap(group=>group.actions.map(([,id])=>id)),
    ...fileActions.map(action=>action.id)
  ];
  const fallbackAnchorIds=["skillStudio.showWelcome","skillStudio.showActivationDiagnostics"];
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
    const hasCommand=id=>Boolean(commands.getCommand(id));
    // Core navigation is sufficient to create the product entry. Optional
    // Compiler, dependency, authoring and LSP actions are added independently;
    // one failed feature must never hide Welcome or Open Example.
    // Prefer the complete Project recovery path. If Example loading itself
    // failed to register, still expose Welcome/Activation Diagnostics after a
    // short grace period rather than leaving the user with no product entry.
    if(!hasCommand("skillStudio.loadExample")&&
       !(attempts>=20&&fallbackAnchorIds.some(hasCommand)))return false;
    const availableGroups=groups.map(group=>({
      ...group,actions:group.actions.filter(([,id])=>hasCommand(id))
    })).filter(group=>group.actions.length);
    const availableFileActions=fileActions.filter(action=>hasCommand(action.id));
    const missing=actionIds.filter(id=>!hasCommand(id));
    const menus=container.get(menuKey);
    const root=menus.getMenuNode(["menubar"]);
    if(!root)return false;
    const existing=root.children?.find(node=>node.id===TOP[1]);
    if(existing&&existing.label!=="SKILL Studio")
      throw Error("Conflicting Studio top-level menu");
    if(existing){
      const existingGroups=new Set((existing.children??[]).map(node=>node.id));
      const missingGroups=availableGroups.map(group=>group.id)
        .filter(id=>!existingGroups.has(id));
      if(missingGroups.length)
        throw Error("Incomplete existing Studio menu: "+missingGroups.join(", "));
    }else{
      for(const group of availableGroups){
        const groupPath=[...TOP,group.id];
        menus.registerSubmenu(groupPath,group.label,{sortString:group.id});
        for(const [order,id,label] of group.actions)
          menus.registerMenuAction(groupPath,{commandId:id,label,order});
      }
      menus.registerSubmenu(TOP,"SKILL Studio",{sortString:"5z_skill_studio"});
    }
    for(const action of availableFileActions)
      menus.registerMenuAction(action.path,{
        commandId:action.id,label:action.label,order:action.order
      });
    document.documentElement.dataset.skillStudioBrand="ready";
    document.documentElement.dataset.skillStudioNativeMenu="ready";
    document.documentElement.dataset.skillStudioNativeMenuMissingCommands=missing.join(",");
    if(missing.length)
      console.warn("SKILL Studio menu installed with unavailable optional commands:",missing);
    return true;
  }
  const handle=setInterval(()=>{
    try{
      if(install()){clearInterval(handle);return;}
      if(++attempts>200){
        clearInterval(handle);
        document.documentElement.dataset.skillStudioNativeMenu="unavailable";
        console.error("SKILL Studio native menu: core commands or Theia registry unavailable");
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
