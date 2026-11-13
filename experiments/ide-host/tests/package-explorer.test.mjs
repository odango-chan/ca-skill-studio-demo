import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {registerPackageOverview} from "../vscode/src/package-overview.mjs";

const uri=path=>({
  scheme:"file",authority:"",path,
  toString(){return "file://"+path;},
  with(change){return uri(change.path);}
});
class EventEmitter{
  constructor(){
    this.listeners=new Set();
    this.event=listener=>{
      this.listeners.add(listener);
      return {dispose:()=>this.listeners.delete(listener)};
    };
  }
  fire(value){for(const listener of this.listeners)listener(value);}
  dispose(){this.listeners.clear();}
}
class TreeItem{
  constructor(label,collapsibleState){this.label=label;this.collapsibleState=collapsibleState;}
}
function host({folders=[uri("/project")],selectedRoot=()=>folders.length===1?folders[0]:null,
  files=null,dependenciesProvider=null,statImpl=async()=>({type:2})}={}){
  const rootFiles=files??[
    uri("/project/skills/one/SKILL.md"),
    uri("/project/skills/one/assurance/contract.yaml"),
    uri("/project/skills/one/assurance/procedure.yaml"),
    uri("/project/skills/one/assurance/predicates.yaml")
  ];
  const commands=new Map(),views=new Map(),subscriptions=[];
  const noEvent=()=>({dispose(){}});
  const vscode={
    EventEmitter,TreeItem,
    TreeItemCollapsibleState:{None:0,Collapsed:1,Expanded:2},
    ThemeIcon:class{constructor(id){this.id=id;}},
    RelativePattern:class{constructor(base,pattern){this.base=base;this.pattern=pattern;}},
    Uri:{joinPath:(base,...parts)=>uri([base.path,...parts].join("/"))},
    workspace:{
      workspaceFolders:folders.map((folder,index)=>({
        uri:folder.uri??folder,name:folder.name??"project-"+index
      })),
      textDocuments:[],
      fs:{stat:statImpl},
      findFiles:async()=>rootFiles,
      asRelativePath:target=>target.path,
      onDidChangeWorkspaceFolders:noEvent,
      onDidCreateFiles:noEvent,
      onDidDeleteFiles:noEvent,
      onDidRenameFiles:noEvent,
      onDidOpenTextDocument:noEvent,
      onDidCloseTextDocument:noEvent,
      onDidChangeTextDocument:noEvent,
      onDidSaveTextDocument:noEvent
    },
    window:{
      createTreeView:(id,options)=>{
        views.set(id,options.treeDataProvider);
        return {reveal:async()=>true,dispose(){}};
      }
    },
    commands:{
      registerCommand:(id,fn)=>{
        commands.set(id,fn);
        return {dispose(){commands.delete(id);}};
      }
    }
  };
  const context={subscriptions};
  const registered=registerPackageOverview(vscode,context,()=>null,{
    dependenciesProvider,getProjectRoot:selectedRoot
  });
  return {vscode,commands,views,subscriptions,registered};
}
function dependencyProvider(){
  const events=new EventEmitter();
  const dependency={
    kind:"dependency",
    dependency:{id:"network-tools",kind:"tool-catalog",source:{type:"builtin"}},
    state:"READY"
  };
  return {
    onDidChangeTreeData:events.event,
    fire(){events.fire();},
    async getChildren(node){
      if(node?.kind==="dependency")return [{
        kind:"operation",dependency:node.dependency,
        operation:{id:"ping",effect:{classification:"UNKNOWN",authority:"UNVERIFIED"}}
      }];
      return [dependency];
    },
    getTreeItem(node){
      const label=node.kind==="dependency"?node.dependency.id:node.operation.id;
      return new TreeItem(label,node.kind==="dependency"?1:0);
    }
  };
}

test("Package Explorer composes Skills and Plugin Dependencies in one native TreeView",async()=>{
  const dependencies=dependencyProvider(),h=host({dependenciesProvider:dependencies});
  await h.commands.get("skillStudio.refreshPackages")();
  assert.deepEqual([...h.views.keys()],["skillStudio.packages"]);
  const tree=h.views.get("skillStudio.packages");
  const sections=await tree.getChildren();
  assert.deepEqual(sections.map(item=>item.section),["skills","dependencies"]);
  assert.equal(tree.getTreeItem(sections[0]).collapsibleState,2,
    "Skills is expanded by default");
  assert.equal(tree.getTreeItem(sections[1]).collapsibleState,1,
    "Dependencies stays collapsed until needed");

  const skills=await tree.getChildren(sections[0]);
  const pkg=skills.find(item=>item.kind==="package");
  assert.ok(pkg,"authored Skill inventory is visible under Skills");
  assert.equal((await tree.getParent(pkg)).section,"skills");
  const groups=await tree.getChildren(pkg);
  assert.ok(groups.some(group=>group.key==="assurance"));

  const deps=await tree.getChildren(sections[1]);
  assert.equal(deps[0].dependency.id,"network-tools");
  assert.equal(tree.getTreeItem(deps[0]).label,"network-tools");
  assert.equal((await tree.getParent(deps[0])).section,"dependencies");
  const operations=await tree.getChildren(deps[0]);
  assert.equal(operations[0].operation.id,"ping");
  assert.equal((await tree.getParent(operations[0])).dependency.id,"network-tools");
});

test("Package Explorer paints an honest loading state before the initial inventory scan completes",async()=>{
  let releaseStat;
  const statGate=new Promise(resolve=>{releaseStat=resolve;});
  const h=host({statImpl:()=>statGate});
  const tree=h.views.get("skillStudio.packages");
  const [skills]=await tree.getChildren();
  const [summary,notice]=await tree.getChildren(skills);
  assert.match(summary.description,/等待扫描当前 Workspace/);
  assert.equal(notice.label,"正在读取 Package 文件清单…");
  assert.match(notice.description,/后台进行/);
  // Let the background scan finish so the fixture does not leave pending work.
  releaseStat({type:2});
});

test("multi-root workspace does not scan an implicit project; it asks for explicit selection",async()=>{
  const h=host({
    folders:[uri("/project-a"),uri("/project-b")],
    selectedRoot:()=>null
  });
  const result=await h.commands.get("skillStudio.refreshPackages")();
  assert.equal(result.state,"select-project-root");
  const tree=h.views.get("skillStudio.packages");
  const sections=await tree.getChildren();
  const skills=await tree.getChildren(sections[0]);
  assert.match(skills.find(item=>item.kind==="notice").label,/Project Root/);
});

test("manifest puts the visible Package Explorer in native Explorer without a Studio Activity Bar",()=>{
  const manifest=JSON.parse(readFileSync("experiments/ide-host/vscode/package.json","utf8"));
  const view=manifest.contributes.views.explorer.find(item=>item.id==="skillStudio.packages");
  assert.equal(view.name,"Package Explorer");
  assert.equal(view.visibility,"visible");
  assert.equal(manifest.contributes.viewsContainers?.activitybar,undefined);
  assert.equal(manifest.contributes.views.explorer.some(item=>
    item.id==="skillStudio.dependencies"||item.id==="skillStudio.build"),false);
});
