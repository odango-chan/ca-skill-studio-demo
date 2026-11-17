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
  return "// Theia 1.76 native MenuModelRegistry adapter.\n  // This is not a DOM menu or an event interception: the registry owns every\n  // action and Lumino owns the rendered menu and keyboard navigation.\n(() => {\n  const TOP=[\"menubar\",\"00_skill_studio\"];\n  const zh=/^zh\\b/i.test(document.documentElement.lang||navigator.language||\"\");\n  const labels=zh?{\n    project:\"项目\",skill:\"Skill\",dependencies:\"依赖\",authoring:\"编写\",tools:\"工具\",help:\"帮助\",\n    welcome:\"欢迎页面\",newProject:\"新建项目\",openProject:\"打开项目\",\n    example:\"打开示例项目\",selectRoot:\"选择项目根目录\",refresh:\"刷新 Package\",\n    check:\"检查 Skill\",build:\"构建 Skill\",inspect:\"检查依赖\",\n    audit:\"审计当前 Package\",export:\"导出 Package ZIP\",\n    addDependency:\"添加依赖\",refreshDependencies:\"刷新依赖\",\n    refreshDependency:\"刷新上游依赖\",updateLock:\"更新依赖锁\",\n    inspectContract:\"检查锁定契约\",removeDependency:\"移除依赖\",\n    procedure:\"打开 Procedure 设计器\",contract:\"打开 Contract 设计器\",\n    predicates:\"打开 Predicate 设计器\",schema:\"打开 Schema 设计器\",\n    refreshInspection:\"刷新检查结果\",restartLsp:\"重启语言服务\",\n    spec:\"Skill 语言规范\",guide:\"编写指南\"\n  }:{\n    project:\"Project\",skill:\"Skill\",dependencies:\"Dependencies\",authoring:\"Authoring\",tools:\"Tools\",help:\"Help\",\n    welcome:\"Welcome\",newProject:\"New Project\",openProject:\"Open Project\",\n    example:\"Open Example Project\",selectRoot:\"Select Project Root\",refresh:\"Refresh Packages\",\n    check:\"Check Skill\",build:\"Build Skill\",inspect:\"Inspect Dependencies\",\n    audit:\"Audit Current Package\",export:\"Export Package ZIP\",\n    addDependency:\"Add Dependency\",refreshDependencies:\"Refresh Dependencies\",\n    refreshDependency:\"Refresh Upstream Dependency\",updateLock:\"Update Dependency Lock\",\n    inspectContract:\"Inspect Locked Contract\",removeDependency:\"Remove Dependency\",\n    procedure:\"Open Procedure Designer\",contract:\"Open Contract Designer\",\n    predicates:\"Open Predicate Designer\",schema:\"Open Schema Designer\",\n    refreshInspection:\"Refresh Inspection\",restartLsp:\"Restart Language Service\",\n    spec:\"Skill Language Specification\",guide:\"Authoring Guide\"\n  };\n  const groups=[\n    {id:\"01_project\",label:labels.project,actions:[\n      [\"0\",\"skillStudio.showWelcome\",labels.welcome],\n      [\"1\",\"skillStudio.newProject\",labels.newProject],\n      [\"2\",\"skillStudio.openProject\",labels.openProject],\n      [\"3\",\"skillStudio.loadExample\",labels.example],\n      [\"4\",\"skillStudio.selectProjectRoot\",labels.selectRoot],\n      [\"5\",\"skillStudio.refreshPackages\",labels.refresh]\n    ]},\n    {id:\"02_skill\",label:labels.skill,actions:[\n      [\"0\",\"skillStudio.checkSkill\",labels.check],\n      [\"1\",\"skillStudio.buildSkill\",labels.build],\n      [\"2\",\"skillStudio.inspectCompilerDependencies\",labels.inspect],\n      [\"3\",\"skillStudio.auditPackage\",labels.audit],\n      [\"4\",\"skillStudio.exportPackageZip\",labels.export]\n    ]},\n    {id:\"03_dependencies\",label:labels.dependencies,actions:[\n      [\"0\",\"skillStudio.addDependency\",labels.addDependency],\n      [\"1\",\"skillStudio.refreshDependencies\",labels.refreshDependencies],\n      [\"2\",\"skillStudio.refreshDependency\",labels.refreshDependency],\n      [\"3\",\"skillStudio.updateDependencyLock\",labels.updateLock],\n      [\"4\",\"skillStudio.inspectDependencyContract\",labels.inspectContract],\n      [\"5\",\"skillStudio.removeDependency\",labels.removeDependency]\n    ]},\n    {id:\"04_authoring\",label:labels.authoring,actions:[\n      [\"0\",\"skillStudio.openProcedure\",labels.procedure],\n      [\"1\",\"skillStudio.openContract\",labels.contract],\n      [\"2\",\"skillStudio.openPredicates\",labels.predicates],\n      [\"3\",\"skillStudio.openSchema\",labels.schema]\n    ]},\n    {id:\"05_tools\",label:labels.tools,actions:[\n      [\"0\",\"skillStudio.refreshInspection\",labels.refreshInspection],\n      [\"1\",\"skillStudio.restartLanguageService\",labels.restartLsp]\n    ]},\n    {id:\"06_help\",label:labels.help,actions:[\n      [\"0\",\"skillStudio.openLanguageSpec\",labels.spec],\n      [\"1\",\"skillStudio.openAuthoringGuide\",labels.guide]\n    ]}\n  ];\n  const fileActions=[\n    {path:[\"menubar\",\"1_file\",\"1_new\"],order:\"80\",id:\"skillStudio.newProject\",label:labels.newProject},\n    {path:[\"menubar\",\"1_file\",\"2_open\"],order:\"80\",id:\"skillStudio.openProject\",label:labels.openProject},\n    {path:[\"menubar\",\"1_file\",\"2_open\"],order:\"81\",id:\"skillStudio.loadExample\",label:labels.example}\n  ];\n  const actionIds=[\n    ...groups.flatMap(group=>group.actions.map(([,id])=>id)),\n    ...fileActions.map(action=>action.id)\n  ];\n  let attempts=0;\n  function install(){\n    const container=window.theia?.container;\n    const bar=document.querySelector('[id=\"theia:menubar\"].lm-MenuBar');\n    const keys=container?._bindingDictionary?._map?.keys?.();\n    if(!bar||!keys)return false;\n    const all=[...keys];\n    const menuKey=all.find(key=>typeof key===\"function\"&&\n      key.prototype?.registerSubmenu&&key.prototype?.registerMenuAction&&\n      key.prototype?.getMenuNode);\n    const commandsKey=all.find(key=>typeof key===\"function\"&&\n      key.prototype?.executeCommand&&key.prototype?.registerCommand&&\n      key.prototype?.getCommand);\n    if(!menuKey||!commandsKey)return false;\n    const commands=container.get(commandsKey);\n    // Wait for actual extension handlers, but do not gate registration on\n    // contextual visibility: selected-item commands are hidden by their own\n    // native visibility predicates when no matching tree item is selected.\n    if(!actionIds.every(id=>commands.getCommand(id)))return false;\n    const menus=container.get(menuKey);\n    const root=menus.getMenuNode([\"menubar\"]);\n    const existing=root?.children?.find(node=>node.id===TOP[1]);\n    if(existing){\n      if(existing.label!==\"SKILL Studio\")throw Error(\"Conflicting Studio top-level menu\");\n      const existingGroups=new Set((existing.children??[]).map(node=>node.id));\n      const missing=groups.map(group=>group.id).filter(id=>!existingGroups.has(id));\n      if(missing.length)throw Error(\"Incomplete existing Studio menu: \"+missing.join(\", \"));\n    }else{\n      // Create real nested Theia submenus; the command registry remains the\n      // sole owner of enablement, visibility and execution.\n      for(const group of groups){\n        const groupPath=[...TOP,group.id];\n        menus.registerSubmenu(groupPath,group.label,{sortString:group.id});\n        for(const [order,id,label] of group.actions)\n          menus.registerMenuAction(groupPath,{commandId:id,label,order});\n      }\n      menus.registerSubmenu(TOP,\"SKILL Studio\",{sortString:\"00\"});\n      // Project creation/opening also lives where IDE users expect it: File.\n      for(const action of fileActions)\n        menus.registerMenuAction(action.path,{\n          commandId:action.id,label:action.label,order:action.order\n        });\n    }\n    document.documentElement.dataset.skillStudioBrand=\"ready\";\n    document.documentElement.dataset.skillStudioNativeMenu=\"ready\";\n    return true;\n  }\n  const handle=setInterval(()=>{\n    try{\n      if(install()){clearInterval(handle);return;}\n      if(++attempts>200){\n        clearInterval(handle);\n        document.documentElement.dataset.skillStudioNativeMenu=\"unavailable\";\n        console.error(\"SKILL Studio native menu: registry or commands unavailable\");\n      }\n    }catch(error){\n      clearInterval(handle);\n      document.documentElement.dataset.skillStudioNativeMenu=\"error\";\n      console.error(\"SKILL Studio native menu registration failed\",error);\n    }\n  },200);\n})();\n";
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
