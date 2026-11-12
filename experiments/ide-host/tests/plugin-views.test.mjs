import test from "node:test";
import assert from "node:assert/strict";
import {registerDependenciesView} from "../vscode/src/dependencies-view.mjs";
const uri=path=>({scheme:"file",authority:"",path,
  toString(){return "file://"+path;}});
class EventEmitter{
  constructor(){this.listeners=new Set();this.event=fn=>{
    this.listeners.add(fn);return {dispose:()=>this.listeners.delete(fn)};
  };}
  fire(){for(const fn of this.listeners)fn();}
  dispose(){this.listeners.clear();}
}
class TreeItem{
  constructor(label,state){this.label=label;this.collapsibleState=state;}
}
function fixture({multiRoot=false}={}){
  const roots=multiRoot?[uri("/project-a"),uri("/project-b")]:[uri("/project")];
  const commands=new Map(),messages=[],selected=[];
  const values=new Map();
  const getValues=root=>{
    const key=root?.toString?.()??"user";
    if(!values.has(key))values.set(key,{
      skillsRoot:"skills",dependencies:[],
      dependencyLock:{version:"skillc.lock/v0.1",entries:[]},
      defaultBuildTarget:"all"
    });
    return values.get(key);
  };
  const vscode={
    EventEmitter,TreeItem,
    TreeItemCollapsibleState:{None:0,Collapsed:1},
    ThemeIcon:class{constructor(id){this.id=id;}},
    ConfigurationTarget:{WorkspaceFolder:6},
    Uri:{
      joinPath:(base,...parts)=>uri([base.path,...parts].join("/")),
      from:({path})=>uri(path)
    },
    workspace:{
      workspaceFolders:roots.map((root,index)=>({uri:root,name:"Project "+index})),
      textDocuments:[],
      getConfiguration:(_section,resource)=>({
        get:(key,fallback)=>getValues(resource)[key]??fallback,
        update:async(key,value)=>{getValues(resource)[key]=value;}
      }),
      onDidChangeConfiguration:()=>({dispose(){}}),
      onDidChangeWorkspaceFolders:()=>({dispose(){}}),
      onDidChangeTextDocument:()=>({dispose(){}}),
      registerTextDocumentContentProvider:()=>({dispose(){}}),
      fs:{readFile:async()=>new Uint8Array()}
    },
    window:{
      createTreeView:()=>{throw Error("Dependencies must not register a separate TreeView");},
      showQuickPick:async items=>items[1],
      showErrorMessage:async message=>messages.push(message),
      showWarningMessage:async message=>messages.push(message),
      showInformationMessage:async message=>messages.push(message),
      showInputBox:async()=>undefined,
      showOpenDialog:async()=>undefined
    },
    commands:{
      registerCommand:(id,fn)=>{
        commands.set(id,fn);return {dispose(){commands.delete(id);}};
      }
    }
  };
  return {vscode,commands,messages,selected,roots};
}

test("Dependencies provider is composed into Package Explorer and does not create another view",async()=>{
  const h=fixture(),context={subscriptions:[],secrets:{get:async()=>undefined}};
  const view=registerDependenciesView(h.vscode,context,{
    onProjectRootChanged:root=>h.selected.push(root?.path??null)
  });
  assert.equal(h.commands.has("skillStudio.addDependency"),true);
  assert.equal(h.commands.has("skillStudio.refreshDependency"),true);
  assert.equal(h.commands.has("skillStudio.updateDependencyLock"),true);
  assert.equal(h.commands.has("skillStudio.removeDependency"),true);
  assert.equal(h.commands.has("skillStudio.selectProjectRoot"),true);
  assert.equal(view.getProjectRoot().path,h.roots[0].path);
  const rows=await view.provider.getChildren();
  assert.match(rows[0].text,/No dependencies/);
  assert.equal(view.provider.getTreeItem(rows[0]).label,rows[0].text);
});

test("multi-root Dependency operations require explicit project selection",async()=>{
  const h=fixture({multiRoot:true}),context={subscriptions:[],secrets:{get:async()=>undefined}};
  const view=registerDependenciesView(h.vscode,context,{
    onProjectRootChanged:root=>h.selected.push(root?.path??null)
  });
  assert.equal(view.getProjectRoot(),null);
  const before=await view.provider.getChildren();
  assert.match(before[0].text,/Select a project root/);
  await h.commands.get("skillStudio.selectProjectRoot")();
  assert.equal(view.getProjectRoot().path,h.roots[1].path);
  assert.deepEqual(h.selected,[h.roots[1].path]);
  const after=await view.provider.getChildren();
  assert.match(after[0].text,/No dependencies/);
});
