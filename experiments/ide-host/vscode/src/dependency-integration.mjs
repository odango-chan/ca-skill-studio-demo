// VS Code/Theia integration for Plugin-managed Dependencies.
// It owns acquisition commands and exposes a TreeDataProvider composed by
// the single Package Explorer; it does not register a standalone view.
import {readProjectConfiguration,watchProjectConfiguration}
  from "./project-configuration.mjs";
import {applyDependency,removeDependency,refreshDependency,
  resolveLockedDependencies} from "./dependency-service.mjs";
import {acquireUpload,acquireMcp,acquireGit,acquireBuiltin}
  from "./contract-acquisition.mjs";
import {discoverMcpHttpTools,readGitHubPinnedFile}
  from "./acquisition-transports.mjs";
import {decodeBase64} from "./dependency-snapshot.mjs";
import {projectDependencyReadiness,projectLockedToolCatalog}
  from "./dependency-catalog-projection.mjs";
const aliasPattern=/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
export function registerDependencyIntegration(vscode,context,{onLockChanged=()=>{},
  onProjectRootChanged=()=>{}}={}){
  const emitter=new vscode.EventEmitter();
  const previews=new Map();
  let selectedRoot=null,latest=null;
  const refresh=()=>{latest=null;emitter.fire();};
  const roots=()=>vscode.workspace.workspaceFolders??[];
  async function chooseRoot(){
    if(selectedRoot&&roots().some(folder=>folder.uri.toString()===selectedRoot.toString()))
      return selectedRoot;
    if(roots().length===1){selectedRoot=roots()[0].uri;return selectedRoot;}
    if(!roots().length)throw Error("Open a project workspace folder first");
    const chosen=await vscode.window.showQuickPick(roots().map(folder=>({
      label:folder.name,description:folder.uri.toString(),uri:folder.uri
    })),{placeHolder:"Select the Skill Project root (multi-root)"});
    if(!chosen)return null;
    selectedRoot=chosen.uri;refresh();onProjectRootChanged(selectedRoot);return selectedRoot;
  }
  async function ensureRoot(){const root=await chooseRoot();if(!root)throw Error("No project root selected");return root;}
  const report=error=>vscode.window.showErrorMessage(
    "Skill Studio Dependencies: "+String(error?.message??error));
  // Declaration indexing is shared with the active Package Audit; never
  // interpret a retired skillc.tool/v0.1 tool-contract.json as ToolCatalog.
  const provider={
    onDidChangeTreeData:emitter.event,
    async getChildren(node){
      if(node?.kind==="dependency"){
        const resolved=latest??await resolveLockedDependencies(vscode,selectedRoot);
        if(node.state!=="SNAPSHOT_VERIFIED")
          return [{kind:"message",text:node.blocked?.message??
            "BLOCKED · verified locked snapshot unavailable"}];
        const snapshot=resolved.snapshots.find(s=>s.id===node.dependency.id&&
          s.snapshotDigest===node.entry?.snapshotDigest);
        if(!snapshot)return [{kind:"message",text:
          "BLOCKED · verified locked snapshot unavailable"}];
        if(node.dependency.kind!=="tool-catalog")
          return [{kind:"message",text:
            "Schema Bundle snapshot verified · Owner/Schema export authorization NOT_CHECKED"}];
        const catalog=projectLockedToolCatalog(snapshot);
        if(!catalog.available)
          return [{kind:"message",text:"BLOCKED · "+catalog.reason}];
        const operations=catalog.operations.map(operation=>({
          kind:"operation",dependency:node.dependency,operation
        }));
        return operations.length?operations:[{kind:"message",text:
          "ToolCatalog has no declared callables · Owner authorization NOT_CHECKED"}];
      }
      if(node)return [];
      if(!selectedRoot){
        if(roots().length===1)selectedRoot=roots()[0].uri;
        else return [{kind:"message",text:"Select a project root to inspect dependencies"}];
      }
      try{
        const config=readProjectConfiguration(vscode,selectedRoot);
        latest=await resolveLockedDependencies(vscode,selectedRoot);
        if(!config.settings.dependencies.length)
          return [{kind:"message",text:"No dependencies · Add Dependency"}];
        return config.settings.dependencies.map(dependency=>{
          const entry=config.settings.dependencyLock.entries.find(e=>e.id===dependency.id);
          return projectDependencyReadiness(dependency,entry,latest);
        });
      }catch(error){return [{kind:"message",text:"BLOCKED · "+String(error.message)}];}
    },
    getTreeItem(node){
      const state=vscode.TreeItemCollapsibleState;
      if(node.kind==="message"){
        const item=new vscode.TreeItem(node.text,state.None);
        item.iconPath=new vscode.ThemeIcon("info");
        return item;
      }
      if(node.kind==="operation"){
        const item=new vscode.TreeItem(node.operation.id,state.None);
        item.id="operation:"+node.dependency.id+":"+node.operation.id;
        item.description=(node.operation.kind??"callable")+
          " · "+(node.operation.effect??"UNKNOWN");
        item.iconPath=new vscode.ThemeIcon("symbol-method");
        item.tooltip="ToolCatalog declaration · Owner: "+
          (node.operation.owner??"UNKNOWN")+" (DECLARED, NOT AUTHORIZED)"+
          "\nEffect: "+(node.operation.effect??"UNKNOWN")+
          "\nOwner/Capability authorization: NOT_CHECKED"+
          "\nRuntime readiness: NOT_CHECKED";
        item.command={command:"skillStudio.inspectDependencyContract",
          title:"Inspect Contract",arguments:[node.dependency.id,node.operation.id]};
        return item;
      }
      const item=new vscode.TreeItem(node.dependency.id,state.Collapsed);
      item.description=node.state+
        " · Owner "+node.ownerState+" · "+node.dependency.source.type;
      item.id="dependency:"+node.dependency.id;
      item.contextValue="skillStudio.dependency";
      item.iconPath=new vscode.ThemeIcon(
        node.state==="SNAPSHOT_VERIFIED"?"package":"warning");
      item.tooltip=[node.dependency.kind,node.entry?.snapshotDigest??"UNLOCKED",
        JSON.stringify(node.dependency.source),node.blocked?.message??"",
        "Snapshot status: "+node.state,
        "Owner/Capability/Evidence publication: NOT_CHECKED",
        "A pinned snapshot does not establish Owner authorization or Runtime readiness"
      ].filter(Boolean).join("\n");
      return item;
    }
  };
  context.subscriptions.push(emitter,
    watchProjectConfiguration(vscode,()=>{refresh();onLockChanged();}));
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders?.(()=>{
    if(selectedRoot&&!roots().some(folder=>folder.uri.toString()===selectedRoot.toString())){
      selectedRoot=null;onProjectRootChanged(getProjectRoot());
    }
    refresh();
  })??{dispose(){}});
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(
    "skill-studio-dependency",{
      provideTextDocumentContent(uri){return previews.get(uri.path)??"";}
    }));
  function prepareToolCatalog(snapshot,sourcePath,text){
    // This is a virtual read-only view of the exact verified lock bytes.
    // Never change the underlying snapshot or open an unpinned remote URL.
    const path="/"+snapshot.id+"/"+snapshot.snapshotDigest.slice(7)+"/"+sourcePath;
    const uri=vscode.Uri.from({scheme:"skill-studio-dependency",path});
    previews.set(path,text);
    return uri;
  }
  async function inspect(id,operationId=null){
    const root=await ensureRoot(),resolved=await resolveLockedDependencies(vscode,root);
    const snap=resolved.snapshots.find(entry=>entry.id===id);
    if(!snap)throw Error("Locked snapshot missing or invalid; refusing to use remote latest");
    const catalog=projectLockedToolCatalog(snap);
    if(!catalog.available)throw Error("Locked ToolCatalog is not available: "+catalog.reason);
    const matches=typeof operationId==="string"&&operationId
      ?catalog.operations.filter(item=>item.id===operationId):catalog.operations;
    if(matches.length!==1)throw Error(matches.length
      ?"ToolCatalog callable selection is ambiguous"
      :"ToolCatalog callable was not found in the verified lock");
    const selected=matches[0];
    const file=snap.files.find(item=>item.path===selected.catalogPath);
    if(!file)throw Error("ToolCatalog declaration file is missing from verified lock");
    const text=new TextDecoder("utf-8",{fatal:true}).decode(decodeBase64(file.bytes));
    const document=await vscode.workspace.openTextDocument(
      prepareToolCatalog(snap,selected.catalogPath,text));
    const editor=await vscode.window.showTextDocument(document,{
      viewColumn:vscode.ViewColumn.One,preview:true,preserveFocus:false
    });
    if(selected.idRange&&typeof document.positionAt==="function"){
      const start=document.positionAt(selected.idRange.start);
      const end=document.positionAt(selected.idRange.end);
      editor.selection=new vscode.Selection(start,end);
      editor.revealRange?.(new vscode.Range(start,end),
        vscode.TextEditorRevealType?.InCenter);
    }
  }
  async function askAlias(){
    return vscode.window.showInputBox({
      prompt:"Dependency ID (project-local, e.g. network-tools)",
      validateInput:value=>aliasPattern.test(value)&&value.length<=80?
        null:"Use lowercase kebab-case (max 80 characters)"});
  }
  async function askSecret(key){
    const existing=await context.secrets?.get?.(key);
    if(existing)return existing;
    const token=await vscode.window.showInputBox({prompt:"Optional access token (leave blank for public)",
      password:true,ignoreFocusOut:true});
    if(token)await context.secrets?.store?.(key,token);
    return token??undefined;
  }
  async function acquireSource(source){
    switch(source.type){
      case "builtin":return acquireBuiltin(source);
      case "git":{
        const token=await askSecret("skillStudio.git.github");
        return acquireGit({...source,
          readPinnedFile:params=>readGitHubPinnedFile({...params,token})});
      }
      case "mcp":{
        const endpoint=await vscode.window.showInputBox({
          prompt:"MCP HTTPS Streamable HTTP endpoint (not saved in Workspace Settings)",
          placeHolder:"https://example.org/mcp"});
        if(!endpoint)throw Error("MCP endpoint not supplied");
        const token=await askSecret("skillStudio.mcp."+source.connectionId);
        return acquireMcp({...source,selectedTools:source.tools,
          toolsList:()=>discoverMcpHttpTools({endpoint,token})});
      }
      case "upload":{
        const picked=await vscode.window.showOpenDialog({canSelectMany:false,
          canSelectFiles:true,canSelectFolders:false,
          filters:{"Tool Contracts":["yaml","yml","json"]}});
        if(!picked?.length)throw Error("Upload Refresh/Update needs the selected new file");
        const format=picked[0].path.toLowerCase().endsWith(".json")?"json":"yaml";
        return acquireUpload({upload:source.upload,format,
          rawBytes:await vscode.workspace.fs.readFile(picked[0])});
      }
      default:throw Error("Unrecognized dependency source");
    }
  }
  async function acquireNew(type){
    if(type==="builtin")return acquireBuiltin({
      bundleId:"studio-example-tools",version:"1.0.0"});
    if(type==="upload"){
      const picked=await vscode.window.showOpenDialog({canSelectMany:false,
        canSelectFiles:true,canSelectFolders:false,
        filters:{"Tool Contracts":["yaml","yml","json"]}});
      if(!picked?.length)return null;
      const name=picked[0].path.toLowerCase();
      const format=name.endsWith(".json")?"json":"yaml";
      const upload=await vscode.window.showInputBox({prompt:"Stable upload alias",
        value:picked[0].path.split("/").at(-1)});
      if(!upload)return null;
      return acquireUpload({upload,format,rawBytes:await vscode.workspace.fs.readFile(picked[0])});
    }
    if(type==="git"){
      const repository=await vscode.window.showInputBox({
        prompt:"Git HTTPS repository (GitHub supported in Browser-only v0.1)",
        placeHolder:"https://github.com/owner/repository"});
      if(!repository)return null;
      const path=await vscode.window.showInputBox({prompt:"Exact Tool Contract YAML/JSON path"});
      if(!path)return null;
      const ref=await vscode.window.showInputBox({prompt:"Requested Git revision",value:"main"});
      if(!ref)return null;
      const token=await askSecret("skillStudio.git.github");
      return acquireGit({repository,path,ref,
        readPinnedFile:params=>readGitHubPinnedFile({...params,token})});
    }
    if(type==="mcp"){
      const connectionId=await vscode.window.showInputBox({
        prompt:"MCP discovery connection alias",value:"sample-mcp",
        validateInput:value=>aliasPattern.test(value)?null:"Use lowercase kebab-case"});
      if(!connectionId)return null;
      const endpoint=await vscode.window.showInputBox({
        prompt:"MCP HTTPS Streamable HTTP endpoint (not stored in Workspace Settings)"});
      if(!endpoint)return null;
      const token=await askSecret("skillStudio.mcp."+connectionId);
      const tools=await discoverMcpHttpTools({endpoint,token});
      const chosen=await vscode.window.showQuickPick(tools.map(tool=>({
        label:tool.name,description:tool.description??"",value:tool.name
      })),{canPickMany:true,placeHolder:"Select MCP tools (discovery only)"});
      if(!chosen?.length)return null;
      return acquireMcp({connectionId,selectedTools:chosen.map(x=>x.value),
        toolsList:async()=>tools});
    }
    throw Error("Unsupported dependency acquisition source");
  }
  async function confirm(message,button){
    return (await vscode.window.showWarningMessage(message,{modal:true},button))===button;
  }
  const command=(id,fn)=>context.subscriptions.push(vscode.commands.registerCommand(id,
    async(...args)=>{try{return await fn(...args);}catch(error){await report(error);return null;}}));
  command("skillStudio.selectProjectRoot",async()=>{
    selectedRoot=null;await chooseRoot();refresh();
  });
  command("skillStudio.refreshDependencies",async()=>{await ensureRoot();refresh();});
  command("skillStudio.inspectDependencyContract",inspect);
  command("skillStudio.addDependency",async()=>{
    const root=await ensureRoot();
    const type=await vscode.window.showQuickPick([
      {label:"Upload YAML / JSON Tool Contract",value:"upload"},
      {label:"MCP tools/list Discovery",value:"mcp"},
      {label:"Git pinned contract",value:"git"},
      {label:"Built-in example contract",value:"builtin"}
    ],{placeHolder:"Choose Dependency Contract source"});
    if(!type)return;
    const alias=await askAlias();if(!alias)return;
    const acquired=await acquireNew(type.value);if(!acquired)return;
    const result=await applyDependency(vscode,root,alias,acquired,{
      confirm:()=>confirm("Pin "+alias+" from "+acquired.source.type+
        "? Effect remains UNKNOWN until Owner verification.","Add Dependency")});
    refresh();onLockChanged();return result;
  });
  const aliasOf=node=>typeof node==="string"?node:node?.dependency?.id;
  command("skillStudio.refreshDependency",async node=>{
    const root=await ensureRoot(),id=aliasOf(node);
    if(!id)throw Error("Select a dependency in Package Explorer");
    const result=await refreshDependency(vscode,root,id,acquireSource);
    refresh();
    await vscode.window.showInformationMessage(result.changed?
      "Dependency "+id+" upstream changed; lock unchanged. Use Update Lock to apply.":
      "Dependency "+id+" is unchanged; lock unchanged.");
  });
  command("skillStudio.updateDependencyLock",async node=>{
    const root=await ensureRoot(),id=aliasOf(node);
    if(!id)throw Error("Select a dependency in Package Explorer");
    const current=readProjectConfiguration(vscode,root).settings.dependencies
      .find(dep=>dep.id===id);
    if(!current)throw Error("Unknown dependency "+id);
    const acquired=await acquireSource(current.source);
    const result=await applyDependency(vscode,root,id,acquired,{
      confirm:()=>confirm("Explicitly update pinned lock for "+id+
        "? This invalidates dependency-derived analysis.","Update Lock")});
    refresh();onLockChanged();return result;
  });
  command("skillStudio.removeDependency",async node=>{
    const root=await ensureRoot(),id=aliasOf(node);
    if(!id)throw Error("Select a dependency in Package Explorer");
    const result=await removeDependency(vscode,root,id,{
      confirm:()=>confirm("Remove dependency "+id+" from declarations and lock? "+
        "Immutable unreferenced snapshots remain until explicit cleanup.","Remove Dependency")});
    refresh();onLockChanged();return result;
  });
  const getProjectRoot=()=>selectedRoot??(roots().length===1?roots()[0].uri:null);
  return {refresh,getProjectRoot,provider,prepareToolContract};
}
