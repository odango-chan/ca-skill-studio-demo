// Native Build TreeView. Compiler v0.1 ABI is not available on current main:
// show UNAVAILABLE rather than falling back to the pre-v0.1 lib compiler.
import {assembleProjectContext,createCompilerAdapter} from "./compiler-adapter.mjs";
import {decodeBase64,validateSnapshotPath} from "./dependency-snapshot.mjs";
import {zipPackage} from "../../../../site/zip.mjs";
export function registerBuildView(vscode,context,{getProjectRoot,adapter=
  createCompilerAdapter()}={}){
  const events=new vscode.EventEmitter();
  let result=null,runStatus="NOT_RUN",detail="No v0.1 Check/Build executed";
  let revision=0;
  const previews=new Map();
  const outputFiles=()=>{
    if(!result||!Array.isArray(result.outputFiles))return [];
    return result.outputFiles.map(file=>{
      validateSnapshotPath(file.path);
      return {path:file.path,bytes:decodeBase64(file.bytes)};
    });
  };
  const refresh=()=>events.fire();
  const reset=()=>{revision++;result=null;runStatus="NOT_RUN";
    detail="Source, configuration or dependency lock changed";refresh();};
  const provider={
    onDidChangeTreeData:events.event,
    getChildren(node){
      if(!node)return [
        {kind:"status",label:"Compiler · "+runStatus},
        {kind:"problems",label:"Problems",
          count:Array.isArray(result?.diagnostics)?result.diagnostics.length:0},
        {kind:"generated",label:"Generated Files",count:outputFiles().length}
      ];
      if(node.kind==="status")return [{kind:"message",label:detail}];
      if(node.kind==="problems")
        return (result?.diagnostics??[]).map(x=>({
          kind:"message",label:(x.code??"COMPILER")+" · "+(x.message??"unknown"),
          severity:x.severity??"error"
        }));
      if(node.kind==="generated")return outputFiles().map(file=>({
        kind:"file",label:file.path
      }));
      return [];
    },
    getTreeItem(node){
      const state=vscode.TreeItemCollapsibleState;
      const item=new vscode.TreeItem(node.label,
        ["status","problems","generated"].includes(node.kind)?
          state.Collapsed:state.None);
      if(node.kind==="status")item.iconPath=new vscode.ThemeIcon(
        runStatus==="UNAVAILABLE"?"warning":"tools");
      else if(node.kind==="problems")item.iconPath=new vscode.ThemeIcon("error");
      else if(node.kind==="generated")item.iconPath=new vscode.ThemeIcon("files");
      else if(node.kind==="file"){
        item.iconPath=new vscode.ThemeIcon("file-code");
        item.command={command:"skillStudio.previewBuildFile",
          title:"Preview generated file",arguments:[node.label]};
      }
      else item.iconPath=new vscode.ThemeIcon("info");
      if(node.count!==undefined)item.description=String(node.count);
      return item;
    }
  };
  const view=vscode.window.createTreeView("skillStudio.build",
    {treeDataProvider:provider});
  context.subscriptions.push(view,events);
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(
    "skill-studio-build",{
      provideTextDocumentContent(uri){return previews.get(uri.path)??"";}
    }));
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument?.(event=>{
    if(event.document?.uri?.path?.includes("/skills/"))reset();
  })??{dispose(){}});
  const command=(name,fn)=>context.subscriptions.push(vscode.commands.registerCommand(name,
    async(...args)=>{try{return await fn(...args);}catch(error){
      runStatus="BLOCKED";detail=String(error?.message??error);refresh();
      await vscode.window.showErrorMessage("Skill Studio Build: "+detail);return null;
    }}));
  const run=async(mode)=>{
    result=null;
    const root=getProjectRoot?.();
    if(!root)throw Error("Select a Skill Project root in Dependencies first");
    const contextSnapshot=await assembleProjectContext(vscode,root,++revision);
    if(!adapter.available){
      runStatus="UNAVAILABLE";
      detail="Compiler skillc.build/v0.1 Go/WASM ABI is not installed; "+
        "no old lib/ parser or linker fallback";
      refresh();await vscode.window.showWarningMessage(detail);
      return {status:runStatus,reason:detail,contextSnapshot};
    }
    const response=await adapter[mode](contextSnapshot);
    if(!response||typeof response!=="object")
      throw Error("Compiler v0.1 ABI returned no BuildResult");
    result=response;
    runStatus=response.status??"ERROR";
    detail="Compiler "+mode+" response · "+runStatus;
    refresh();return response;
  };
  command("skillStudio.checkProject",()=>run("check"));
  command("skillStudio.buildProject",()=>run("build"));
  command("skillStudio.previewBuildFile",async path=>{
    const file=outputFiles().find(x=>x.path===path);
    if(!file)throw Error("Generated file missing or Build unavailable");
    const virtualPath="/"+revision+"/"+path;
    previews.set(virtualPath,new TextDecoder().decode(file.bytes));
    const doc=await vscode.workspace.openTextDocument(
      vscode.Uri.from({scheme:"skill-studio-build",path:virtualPath}));
    await vscode.window.showTextDocument(doc,{preview:true});
  });
  command("skillStudio.exportBuildZip",async()=>{
    const entries=outputFiles().map(file=>({path:file.path,bytes:file.bytes}));
    if(!entries.length)throw Error("No real Compiler BuildResult outputs to export");
    const file=await vscode.window.showSaveDialog({
      saveLabel:"Export generated ZIP",filters:{"ZIP":["zip"]}});
    if(!file)return;
    const bytes=zipPackage(entries);
    await vscode.workspace.fs.writeFile(file,bytes);
    return true;
  });
  command("skillStudio.exportBuildDirectory",async()=>{
    const files=outputFiles();
    if(!files.length)throw Error("No real Compiler BuildResult outputs to export");
    const picked=await vscode.window.showOpenDialog({
      canSelectFiles:false,canSelectFolders:true,canSelectMany:false,
      openLabel:"Select export directory"});
    if(!picked?.length)throw Error("Host directory picker unavailable or cancelled");
    const base=picked[0],fs=vscode.workspace.fs;
    const target=path=>vscode.Uri.joinPath(base,...path.split("/"));
    for(const file of files){
      try{await fs.stat(target(file.path));
        throw Error("Refusing to overwrite existing exported file "+file.path);
      }catch(error){if(error.code!=="FileNotFound")throw error;}
    }
    for(const file of files){
      const parts=file.path.split("/");
      if(parts.length>1)
        await fs.createDirectory(vscode.Uri.joinPath(base,...parts.slice(0,-1)));
      await fs.writeFile(target(file.path),file.bytes);
    }
    return true;
  });
  return {refresh,reset,getStatus:()=>runStatus};
}
