import test from "node:test";
import assert from "node:assert/strict";
import {registerDependenciesView} from "../vscode/src/dependencies-view.mjs";
import {registerBuildView} from "../vscode/src/build-view.mjs";
const uri=path=>({scheme:"file",authority:"",path,
  toString(){return "file://"+this.path;}});
function fixture(){
  const root=uri("/project"),commands=new Map(),views=new Map();
  const settings={skillsRoot:"skills",dependencies:[],
    dependencyLock:{version:"skillc.lock/v0.1",entries:[]}};
  const messages=[];
  class EventEmitter{
    constructor(){this.event=()=>({dispose(){}});}
    fire(){}dispose(){}
  }
  class TreeItem{constructor(label,collapsibleState){
    this.label=label;this.collapsibleState=collapsibleState;}}
  const vscode={
    EventEmitter,TreeItem,
    TreeItemCollapsibleState:{None:0,Collapsed:1},
    ThemeIcon:class {constructor(name){this.id=name;}},
    Uri:{joinPath:(base,...parts)=>uri(base.path+"/"+parts.join("/")),
      from:({path})=>uri(path)},
    RelativePattern:class {constructor(base,pattern){this.base=base;this.pattern=pattern;}},
    workspace:{
      workspaceFolders:[{uri:root,name:"Project"}],
      textDocuments:[],
      getConfiguration:()=>({get:(key,backup)=>settings[key]??backup}),
      onDidChangeConfiguration:()=>({dispose(){}}),
      onDidChangeWorkspaceFolders:()=>({dispose(){}}),
      onDidChangeTextDocument:()=>({dispose(){}}),
      registerTextDocumentContentProvider:()=>({dispose(){}}),
      findFiles:async()=>[uri("/project/skills/one/SKILL.md")],
      fs:{readFile:async()=>new TextEncoder().encode("# one")}
    },
    window:{
      createTreeView:(id,{treeDataProvider})=>{
        views.set(id,treeDataProvider);return {dispose(){}};
      },
      showWarningMessage:async text=>{messages.push(text);return undefined;},
      showErrorMessage:async text=>{messages.push(text);return undefined;},
      showQuickPick:async()=>undefined,
      showInformationMessage:async text=>{messages.push(text);}
    },
    commands:{
      registerCommand:(name,action)=>{
        commands.set(name,action);return {dispose(){commands.delete(name);}};
      }
    }
  };
  return {vscode,root,views,commands,messages};
}
test("native Dependencies contributes commands and derives empty status from project Settings",async()=>{
  const h=fixture(),context={subscriptions:[],secrets:{}};
  const view=registerDependenciesView(h.vscode,context);
  assert.equal(h.views.has("skillStudio.dependencies"),true);
  for(const id of ["skillStudio.addDependency","skillStudio.refreshDependency",
    "skillStudio.updateDependencyLock","skillStudio.removeDependency",
    "skillStudio.inspectDependencyContract","skillStudio.selectProjectRoot"])
    assert.equal(h.commands.has(id),true,id);
  const rows=await h.views.get("skillStudio.dependencies").getChildren();
  assert.match(rows[0].text,/No dependencies/);
  assert.equal(view.getProjectRoot().path,h.root.path);
  assert.equal(h.messages.length,0);
});
test("native Build never claims success or outputs without a real compiler ABI",async()=>{
  const h=fixture(),context={subscriptions:[]};
  const build=registerBuildView(h.vscode,context,{getProjectRoot:()=>h.root});
  assert.equal(h.views.has("skillStudio.build"),true);
  assert.equal(build.getStatus(),"NOT_RUN");
  const check=await h.commands.get("skillStudio.checkProject")();
  assert.equal(check.status,"UNAVAILABLE");
  assert.equal(build.getStatus(),"UNAVAILABLE");
  assert.equal(h.commands.has("skillStudio.exportBuildZip"),true);
  const exportResult=await h.commands.get("skillStudio.exportBuildZip")();
  assert.equal(exportResult,null);
  assert.match(h.messages.at(-1),/No real Compiler BuildResult/);
  const rows=h.views.get("skillStudio.build").getChildren();
  assert.equal(rows[0].label,"Compiler · BLOCKED",
    "export refusal must be visible and never a fake PASS");
});
