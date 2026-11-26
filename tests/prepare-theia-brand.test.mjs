import test from "node:test";
import assert from "node:assert/strict";
import {runInNewContext} from "node:vm";
import {buildSkillStudioBrandScript}
  from "../experiments/ide-host/scripts/prepare-theia-brand.mjs";

function installWithCommands(commandIds,language="zh-CN",ticks=1){
  const root={id:"menubar",children:[]};
  const ensure=path=>{
    let node=root;
    for(const id of path.slice(1)){
      let child=node.children.find(item=>item.id===id);
      if(!child){child={id,children:[]};node.children.push(child);}
      node=child;
    }
    return node;
  };
  ensure(["menubar","1_file","1_new"]);
  ensure(["menubar","1_file","2_open"]);
  const menus={
    getMenuNode:ensure,
    registerSubmenu(path,label,options={}){
      const node=ensure(path);
      node.label=label;node.sortString=options.sortString??null;
    },
    registerMenuAction(path,action){
      ensure(path).children.push({
        id:action.commandId,commandId:action.commandId,
        label:action.label,order:action.order
      });
    }
  };
  const commands={
    getCommand(id){return commandIds.has(id)?{id}:undefined;}
  };
  function MenuKey(){}
  Object.assign(MenuKey.prototype,{
    registerSubmenu(){},registerMenuAction(){},getMenuNode(){}
  });
  function CommandsKey(){}
  Object.assign(CommandsKey.prototype,{
    executeCommand(){},registerCommand(){},getCommand(){}
  });
  const container={
    _bindingDictionary:{_map:new Map([[MenuKey,{}],[CommandsKey,{}]])},
    get(key){return key===MenuKey?menus:key===CommandsKey?commands:undefined;}
  };
  const document={
    documentElement:{lang:language,dataset:{}},
    querySelector(selector){
      assert.equal(selector,'[id="theia:menubar"].lm-MenuBar');
      return {};
    }
  };
  let install;
  let cleared=false;
  runInNewContext(buildSkillStudioBrandScript(),{
    window:{theia:{container}},document,navigator:{language},
    setInterval(callback){install=callback;return 7;},
    clearInterval(id){assert.equal(id,7);cleared=true;},
    console:{warn(){},error(){}}
  });
  for(let tick=0;tick<ticks&&!cleared;tick++)install();
  return {root,document,cleared:()=>cleared};
}
const menu=root=>root.children.find(node=>node.id==="5z_skill_studio");
const child=(node,id)=>node?.children?.find(item=>item.id===id);

test("core SKILL Studio Project menu remains visible when optional Compiler/Workbench commands are missing",()=>{
  const available=new Set([
    "skillStudio.showWelcome","skillStudio.showActivationDiagnostics",
    "skillStudio.newProject","skillStudio.openProject","skillStudio.loadExample",
    "skillStudio.selectProjectRoot","skillStudio.refreshPackages",
    "skillStudio.openLanguageSpec","skillStudio.openAuthoringGuide"
  ]);
  const result=installWithCommands(available);
  const studio=menu(result.root);
  assert.ok(studio,"the native top-level SKILL Studio menu must be installed");
  assert.equal(studio.label,"SKILL Studio");
  const project=child(studio,"01_project");
  assert.deepEqual(project.children.map(item=>item.commandId),[
    "skillStudio.showWelcome","skillStudio.newProject",
    "skillStudio.openProject","skillStudio.loadExample",
    "skillStudio.selectProjectRoot","skillStudio.refreshPackages"
  ]);
  assert.equal(child(studio,"02_skill"),undefined,
    "an unavailable optional Skill/Compiler group is omitted, not fatal");
  const tools=child(studio,"05_tools");
  assert.deepEqual(tools.children.map(item=>item.commandId),
    ["skillStudio.showActivationDiagnostics"]);
  const fileOpen=child(child(result.root,"1_file"),"2_open");
  assert.ok(fileOpen.children.some(item=>item.commandId==="skillStudio.loadExample"),
    "Open Example remains available from the native File menu");
  assert.equal(result.document.documentElement.dataset.skillStudioNativeMenu,"ready");
  assert.match(
    result.document.documentElement.dataset.skillStudioNativeMenuMissingCommands,
    /skillStudio\.checkSkill/
  );
  assert.equal(result.cleared(),true);
});

test("Activation Diagnostics alone can retain a visible recovery entry when Welcome registration fails",()=>{
  const result=installWithCommands(new Set(["skillStudio.showActivationDiagnostics"]),"en",21);
  const studio=menu(result.root);
  assert.ok(studio);
  assert.equal(studio.label,"SKILL Studio");
  assert.equal(child(studio,"05_tools").children[0].commandId,
    "skillStudio.showActivationDiagnostics");
  assert.equal(result.document.documentElement.dataset.skillStudioNativeMenu,"ready");
});

test("Chinese labels are preserved in the generated native menu",()=>{
  const available=new Set([
    "skillStudio.showWelcome","skillStudio.showActivationDiagnostics",
    "skillStudio.loadExample"
  ]);
  const result=installWithCommands(available,"zh-CN");
  assert.equal(child(menu(result.root),"01_project").label,"项目");
  assert.equal(child(menu(result.root),"05_tools").label,"工具");
});

test("Authoring submenu labels identify read-only Preview in English and Chinese",()=>{
  const commands=new Set([
    "skillStudio.showWelcome","skillStudio.showActivationDiagnostics",
    "skillStudio.loadExample","skillStudio.openProcedure",
    "skillStudio.openContract","skillStudio.openPredicates","skillStudio.openSchema"
  ]);
  const english=installWithCommands(commands,"en");
  const chinese=installWithCommands(commands,"zh-CN");
  const englishLabels=child(menu(english.root),"04_authoring").children.map(item=>item.label);
  const chineseLabels=child(menu(chinese.root),"04_authoring").children.map(item=>item.label);
  assert.deepEqual(englishLabels,[
    "Open Procedure Preview","Open Contract Preview",
    "Open Predicate Preview","Open Schema Preview"
  ]);
  assert.deepEqual(chineseLabels,[
    "打开 Procedure 预览","打开 Contract 预览",
    "打开 Predicate 预览","打开 Schema 预览"
  ]);
  assert.ok(englishLabels.every(label=>!label.includes("Designer")));
  assert.ok(chineseLabels.every(label=>!label.includes("设计器")));
});
