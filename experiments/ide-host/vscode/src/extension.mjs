import {openNativeSource} from "./native-source.mjs";
import {createSourceOnlyEditorNormalizer} from "./editor-group-placement.mjs";
import {openSourceViewPair,sourceViewType,hasSourceViewPair,forgetSourceViewPair} from "./source-view-pair.mjs";
import {assertStudioMutation} from "./project-policy.mjs";
import * as vscode from "vscode";
// Web Crypto is available in both modern Node extension hosts and browser
// workers. Do not import node:crypto: the online host has no Node APIs.
function newNonce(){
  const bytes=new Uint8Array(20);
  if(!globalThis.crypto?.getRandomValues)
    throw new Error("Secure randomness unavailable: refusing to render Webview");
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map(n=>n.toString(16).padStart(2,"0")).join("");
}
import {isProcedurePath,validateRouteProposal,
  validateCanvasRouteCreationProposal,MAX_SOURCE_BYTES} from "./bridge.mjs";
import {isV1Alpha4Procedure} from "../../../../language/core/v1alpha4.ts";
import {EXAMPLE_PROJECT_NAME,seedExampleProject} from "./sample-loader.mjs";
import {openProjectFolder,isSingleFolderWorkspace,restorePendingExampleProject,PENDING_EXAMPLE_OPEN_KEY} from "./project-navigation.mjs";
import {registerProjectWelcome} from "./project-welcome.mjs";

import {extendMarkdownIt} from "./markdown-link-policy.mjs";
import {registerWorkbench} from "./workbench.mjs";
import {staticPreviewResourceUrl} from "./webview-resource-url.mjs";
import {registerContractEditor} from "./contract-editor.mjs";
import {registerPredicateEditor} from "./predicate-editor.mjs";
import {registerSchemaEditor} from "./schema-editor.mjs";
import {registerPackageOverview} from "./package-overview.mjs";
import {registerDependencyIntegration} from "./dependency-integration.mjs";
import {registerCompilerIntegration} from "./compiler-integration.mjs";
import {iconShapes} from "../../../../site/icons.mjs";
const VIEW="skillStudio.procedurePreview";
// Theia's browser-only static build can omit its Pages subpath when creating
// webview resource URLs. Restrict the workaround to the same-origin static
// plugin worker; normal VS Code and backend-backed Theia retain host URIs.
function escaped(value){
  return String(value).replace(/[&<>"']/g,ch=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[ch]));
}
function svgIcon(name){
  const shapes=iconShapes(name).map(({tag,attrs})=>{
    const attributes=Object.entries(attrs)
      .map(([key,value])=>key+'="'+escaped(value)+'"').join(" ");
    return "<"+tag+" "+attributes+"/>";
  }).join("");
  return '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" '+
    'stroke="currentColor" stroke-width="1.75" stroke-linecap="round" '+
    'stroke-linejoin="round" aria-hidden="true" focusable="false" '+
    'class="studio-icon" data-icon="'+escaped(name)+'">'+shapes+"</svg>";
}
function toolbarIconButton(id,name,label,{pressed=false}={}){
  return '<button id="'+escaped(id)+'" type="button" title="'+escaped(label)+
    '" aria-label="'+escaped(label)+'"'+
    (pressed?' aria-pressed="false"':'')+'>'+svgIcon(name)+'</button>';
}
export function activate(context){
  // Register the Package Explorer before the heavier editor/workbench
  // contributions. Its TreeView can paint its loading state immediately;
  // inventory discovery continues asynchronously in the background.
  let workbench=null,packageOverview=null;
  const compilerIntegration=registerCompilerIntegration(vscode,context,{
    getActiveDocument:()=>workbench?.getActiveDocument?.()??vscode.window.activeTextEditor?.document??null
  });
  const dependencyIntegration=registerDependencyIntegration(vscode,context,{
    onLockChanged:()=>workbench?.invalidateDependencyAnalysis?.(),
    onProjectRootChanged:()=>void packageOverview?.refresh()
  });
  packageOverview=registerPackageOverview(vscode,context,
    ()=>workbench?.getActiveDocument?.()??null,{
      dependenciesProvider:dependencyIntegration.provider,
      compilerProvider:compilerIntegration.provider,
      getProjectRoot:dependencyIntegration.getProjectRoot,
      onPackagesChanged:packages=>workbench?.syncPackages?.(packages)
    });
  workbench=registerWorkbench(vscode,context,{
    prepareToolContract:dependencyIntegration.prepareToolContract,
    compilerProblemsProvider:compilerIntegration.problems
  });
  registerContractEditor(vscode,context);
  registerPredicateEditor(vscode,context);
  registerSchemaEditor(vscode,context);
  const provider={
    async resolveCustomTextEditor(document,panel){
      if(!isProcedurePath(document.uri.path)){
        vscode.window.showWarningMessage("Only assurance/procedure.yaml is supported by the Procedure visual editor");
        return;
      }
      const openedAt=performance.now();
      const webview=panel.webview;
      const detach=workbench.attach(document,message=>webview.postMessage(message));
      // Source is the active editor after the fixed split is established, so
      // initialize the Procedure workbench explicitly instead of relying on
      // the visual Webview becoming the active tab.
      workbench.activate(document);
      let wasActive=panel.active;
      const viewState=panel.onDidChangeViewState(()=>{
        const becameActive=panel.active&&!wasActive;wasActive=panel.active;
        if(becameActive)workbench.activate(document);
      });
      const media=vscode.Uri.joinPath(context.extensionUri,"media");
      webview.options={enableScripts:true,localResourceRoots:[media]};
      const nonce=newNonce();
      const script=staticPreviewResourceUrl(
        webview.asWebviewUri(vscode.Uri.joinPath(media,"procedure.js")),
        context.extensionUri);
      const style=staticPreviewResourceUrl(
        webview.asWebviewUri(vscode.Uri.joinPath(media,"procedure.css")),
        context.extensionUri);
      const csp="default-src 'none'; img-src "+webview.cspSource+" data:; "+
        "style-src "+webview.cspSource+"; script-src 'nonce-"+nonce+"'; "+
        "worker-src 'none'; connect-src 'none';";
      webview.html=`<!doctype html><html lang="zh"><head><meta charset="utf-8">
        <meta http-equiv="Content-Security-Policy" content="${escaped(csp)}">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="stylesheet" href="${style}"></head>
        <body><div class="spike-head"><strong>SKILL · Procedure</strong>
          <select id="procedureList" aria-label="Procedure"></select>
          <button id="openSource">打开原生 YAML 编辑器</button>
          <button id="exportPackageZip" type="button" title="导出当前 Package 的 ZIP 备份">导出 Package ZIP</button>
          <span id="revision"></span></div>
          <section id="goalSummary" class="spike-goal" hidden aria-label="Contract Goal">
            <span class="spike-goal-label">CONTRACT GOAL</span>
            <strong id="contractGoal"></strong>
            <span id="contractGate"></span>
            <small id="goalQualification"></small>
          </section>
          <div id="message" role="status">等待当前文档…</div>
          <div id="zipExportNotice" class="spike-zip-notice" role="status" hidden>
            <span id="zipExportDetails"></span>
            <button id="downloadPackageZip" type="button">下载 ZIP</button>
            <button id="dismissPackageZip" type="button" aria-label="关闭 ZIP 下载提示">关闭</button>
          </div>
          <div id="graphTools" class="spike-tools" role="toolbar" aria-label="流程图显示选项">
            <label>${svgIcon("columns-2")} 布局 <select id="layoutDirection" aria-label="自动布局方向">
              <option value="DOWN" selected>垂直</option><option value="RIGHT">水平</option>
            </select></label>
            <label id="rootPathToolbar" hidden>${svgIcon("git-branch")} 路径 <select id="rootPathMode" aria-label="Root Procedure 路径显示">
              <option value="normal" selected>主路径</option>
              <option value="custom">选择路径</option><option value="all">全部路径</option>
            </select></label>
            ${toolbarIconButton("neighborsOnly","network","仅显示当前节点的一跳邻居",{pressed:true})}
            ${toolbarIconButton("showAllLabels","eye","显示全部 Route 标签",{pressed:true})}
            ${toolbarIconButton("centerSelection","locate-fixed","定位已选节点；未选中时适配画布")}
            <span class="spike-tools-separator" aria-hidden="true"></span>
            ${toolbarIconButton("zoomOut","zoom-out","缩小")}
            ${toolbarIconButton("zoomIn","zoom-in","放大")}
            ${toolbarIconButton("fit","maximize","适配整张流程图")}
            ${toolbarIconButton("fitWidth","fit-width","横向铺满流程图")}
            ${toolbarIconButton("fitHeight","fit-height","纵向铺满流程图")}
          </div>
          <div id="rootPathFilters" class="spike-path-filters" role="group" aria-label="按需显示 Root 分支" hidden>
            <label><input id="pathFailure" type="checkbox">失败分支</label>
            <label><input id="pathUncertain" type="checkbox">未决分支</label>
            <label><input id="pathRecovery" type="checkbox">恢复/其他分支</label>
            <span>点击节点上的 +N 条，可逐个展开；再次点击收起</span>
          </div>
          <div id="graphPane" class="graph-pane spike-pane">
            <div id="reactFlowRoot" class="spike-flow"></div>
            <section id="nodeFocus" class="node-focus" aria-label="节点上下游与内部流程" tabindex="-1" hidden>
              <header class="node-focus-header">
                <button id="nodeFocusReturn" type="button" class="node-focus-back">返回流程图</button>
                <div class="node-focus-heading">
                  <span class="node-focus-eyebrow">NODE · 局部流程图（真实 Route / 阶段顺序）</span>
                  <h2 id="nodeFocusTitle"></h2>
                  <p id="nodeFocusSubtitle"></p>
                </div>
              </header>
              <div class="node-focus-toolbar">
                <span id="nodeFocusStats"></span>
                <div id="nodeFocusChildren"></div>
                <button id="nodeFocusFit" type="button" class="node-focus-back">适配局部图</button>
              </div>
              <div id="nodeFocusFlow" class="node-focus-flow-host" aria-label="当前节点一跳局部 React Flow 流程图"></div>
            </section>
          </div>
          <div id="patch" class="spike-patch" hidden>
            <strong>Source-backed Route Patch · 预览后显式确认</strong>
            <div id="existingRouteEditor" class="spike-route-editor">
              <label>现有 Route <select id="routeList"></select></label>
              <label>新目标 <select id="targetList"></select></label>
              <button id="preview">预览目标变更</button>
            </div>
            <div id="newRouteEditor" class="spike-route-editor spike-route-create" hidden>
              <span id="newRouteSummary"></span>
              <label>Outcome <select id="newRouteOutcome"></select></label>
              <button id="newRoutePreview" disabled>预览新增 Route</button>
              <button id="newRouteCancel">放弃提案</button>
            </div>
            <pre id="diff"></pre>
            <button id="commit" disabled>确认并修改当前文档</button>
          </div>
          <script nonce="${nonce}" src="${script}"></script></body></html>`;
      let disposed=false,ready=false,pushTicket=0;
      const packageSuffix="/assurance/procedure.yaml";
      const packageRootPath=document.uri.path.slice(0,-packageSuffix.length);
      const packageName=packageRootPath.replace(/\/$/,"").split("/").at(-1);
      const readPackageText=async relativePath=>{
        const uri=document.uri.with({path:packageRootPath+"/"+relativePath});
        const opened=(vscode.workspace.textDocuments??[]).find(item=>
          item.uri.toString()===uri.toString());
        if(opened)return {text:opened.getText(),version:opened.version};
        try{
          const bytes=await vscode.workspace.fs.readFile(uri);
          return {text:new TextDecoder("utf-8",{fatal:true}).decode(bytes),version:0};
        }catch{return {text:null,version:0};}
      };
      const push=async()=>{
        if(disposed||!ready)return;
        const ticket=++pushTicket,version=document.version,text=document.getText();
        if(text.length>MAX_SOURCE_BYTES){
          void webview.postMessage({type:"error",message:"Source exceeds the 1 MiB Procedure editor limit"});
          return;
        }
        // Legacy Packages do not need the v1alpha4 Contract / PredicateSet
        // visual projection. Avoid extra filesystem reads for the legacy
        // default Example and keep the Theia virtual filesystem load bounded.
        let contract={text:null,version:0},predicates={text:null,version:0};
        if(isV1Alpha4Procedure(text)){
          contract=await readPackageText("assurance/contract.yaml");
          predicates=await readPackageText("assurance/predicates.yaml");
        }
        if(disposed||ticket!==pushTicket||document.version!==version)return;
        void webview.postMessage({
          type:"snapshot",text,version,path:document.uri.path,
          packageRootUri:document.uri.with({path:packageRootPath}).toString(),
          packageName,contractText:contract.text,contractVersion:contract.version,
          predicatesText:predicates.text,predicatesVersion:predicates.version
        });
      };
      const relatedPaths=new Set([
        document.uri.path,
        packageRootPath+"/assurance/contract.yaml",
        packageRootPath+"/assurance/predicates.yaml"
      ]);
      const changed=vscode.workspace.onDidChangeTextDocument(event=>{
        if(relatedPaths.has(event.document.uri.path))void push();
      });
      const incoming=webview.onDidReceiveMessage(async message=>{
        if(disposed||typeof message!=="object"||!message)return;
        if(message.type==="selection"){
          // A visible Procedure editor can lose active status when the user
          // opens the Inspector sidebar. Its real graph selection still belongs
          // to this editor; only hidden Webviews must be ignored.
          if(panel.active||panel.visible)workbench.select(document,message);
          return;
        }
        if(message.type==="rendered"){
          if(message.version===document.version)console.log("STUDIO_OPEN_TIMING",JSON.stringify({version:document.version,hostToRenderMs:performance.now()-openedAt,projectionMs:message.projectionMs,layoutMs:message.layoutMs,cacheHit:message.cacheHit}));
          return;
        }
        if(message.type==="ready"){ready=true;await push();return;}
        if(message.type==="exportPackageZip"){
          await vscode.commands.executeCommand("skillStudio.exportPackageZip");
          return;
        }
        if(message.type==="openSource"){
          await openNativeSource(vscode,document.uri,{viewColumn:vscode.ViewColumn.One,
            preserveFocus:false,preview:false});
          return;
        }
        if(message.type==="revealSourceLine"){
          const line=message.line;
          if(!Number.isSafeInteger(line)||line<1||line>document.lineCount){
            void webview.postMessage({type:"error",message:"Source 行号无效或已过期"});
            return;
          }
          const position=new vscode.Position(line-1,0);
          const selection=new vscode.Range(position,position);
          // Pass the selection as part of the document-open request as well as
          // setting it on the visible native editor. Theia uses its dedicated
          // preview-capable text opener to bypass the visual association.
          await openNativeSource(vscode,document.uri,{
            viewColumn:vscode.ViewColumn.One,preserveFocus:false,preview:false,
            selection
          });
          const editor=vscode.window.visibleTextEditors.find(editor=>editor.document.uri.toString()===document.uri.toString());
          if(editor){editor.selection=new vscode.Selection(position,position);
            editor.revealRange(selection,vscode.TextEditorRevealType.InCenter);
          }
          return;
        }
        if(message.type!=="applyRoute"&&message.type!=="applyRouteCreation")return;
        try{
          const source=document.getText();
          const creating=message.type==="applyRouteCreation";
          const edit=creating
            ?validateCanvasRouteCreationProposal(source,document.version,message)
            :validateRouteProposal(source,document.version,message);
          // Native TextDocument remains the only write owner. Existing Route
          // edits replace one scalar; new Route creation inserts one exact
          // source line at a zero-length CST span. Both use native Undo/Save.
          assertStudioMutation(document.uri,vscode.workspace.workspaceFolders??[],"edit");
          const patch=new vscode.WorkspaceEdit();
          patch.replace(document.uri,new vscode.Range(
            document.positionAt(edit.start),document.positionAt(edit.end)),
            creating?edit.newText:edit.newTarget);
          const applied=await vscode.workspace.applyEdit(patch);
          if(!applied)throw Error("Host rejected WorkspaceEdit");
          await push();
          void webview.postMessage({type:"applied",routeId:edit.routeId});
        }catch(error){
          void webview.postMessage({type:"error",message:String(error?.message??error)});
          await push();
        }
      });
      panel.onDidDispose(()=>{
        disposed=true;forgetSourceViewPair(document.uri);
        detach();viewState.dispose();changed.dispose();incoming.dispose();
      });
    }
  };
  context.subscriptions.push(vscode.window.registerCustomEditorProvider(VIEW,provider,{
    webviewOptions:{retainContextWhenHidden:true}
  }));
  const projectText=value=>vscode.l10n?.t(value)??value;
  context.subscriptions.push(
    vscode.commands.registerCommand("skillStudio.newProject",async()=>{
      const name=await vscode.window.showInputBox({
        prompt:projectText("Name your Skill Studio project"),
        validateInput:value=>/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value)
          ?undefined:projectText("Use up to 64 letters, numbers, hyphens or underscores.")
      });
      if(!name)return;
      const root=vscode.Uri.joinPath(context.globalStorageUri,"projects",name);
      try{
        await vscode.workspace.fs.stat(root);
        void vscode.window.showErrorMessage(projectText("A project with this name already exists."));
        return;
      }catch(error){
        if(error?.code!=="FileNotFound")throw error;
      }
      await vscode.workspace.fs.createDirectory(root);
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(root,"skills"));
      await openProjectFolder(vscode,root);
    }),
    vscode.commands.registerCommand("skillStudio.openProject",async()=>{
      const folders=await vscode.window.showOpenDialog({
        canSelectFiles:false,canSelectFolders:true,canSelectMany:false,
        openLabel:projectText("Open Project")
      });
      if(folders?.[0])await openProjectFolder(vscode,folders[0]);
    }),
    vscode.commands.registerCommand("skillStudio.openLanguageSpec",()=>vscode.env.openExternal(
      vscode.Uri.parse("https://github.com/odango-chan/ca-skills/blob/main/docs/skill-language-spec.zh-CN.md"))),
    vscode.commands.registerCommand("skillStudio.openAuthoringGuide",()=>vscode.env.openExternal(
      vscode.Uri.parse("https://github.com/odango-chan/ca-skills/blob/main/docs/authoring.zh-CN.md")))
  );
  // Keep browser acceptance independent of Extension Host console forwarding.
  // This command is internal (not contributed to the Command Palette) and
  // returns the authoritative workspace and the two v1alpha4 Skill URIs.
  context.subscriptions.push(vscode.commands.registerCommand(
    "skillStudio.internal.workspaceIdentityAcceptance",async()=>{
      const folders=vscode.workspace.workspaceFolders??[];
      const root=folders.length===1?folders[0].uri:null;
      const defaultProcedure=root?vscode.Uri.joinPath(root,
        "skills","establish-pdu-session","assurance","procedure.yaml"):null;
      const masProcedure=root?vscode.Uri.joinPath(root,
        "skills","establish-pdu-session-mas","assurance","procedure.yaml"):null;
      const exists=async uri=>{
        if(!uri)return false;
        try{await vscode.workspace.fs.stat(uri);return true;}
        catch{return false;}
      };
      return {
        workspaceName:vscode.workspace.name??null,
        workspaceFile:vscode.workspace.workspaceFile?.toString?.()??null,
        root:root?.toString?.()??null,
        workspaceFolders:folders.map(folder=>folder.uri.toString()),
        defaultProcedure:defaultProcedure?.toString?.()??null,
        defaultProcedureExists:await exists(defaultProcedure),
        masProcedure:masProcedure?.toString?.()??null,
        masProcedureExists:await exists(masProcedure)
      };
    }
  ));
  let exampleLoadPromise=null;
  let projectWelcome=null;
  const progressZh=String(vscode.env?.language??"en").toLowerCase().startsWith("zh");
  const exampleText=progressZh?{
    title:"加载示例项目",
    replacePrompt:"检测到已有 Example 项目。是否替换为最新 CA-SL v1alpha4 示例？替换将删除整个 Example 目录中的现有内容，包括本地修改和旧版样例。",
    replaceAction:"替换 Example",
    cancelAction:"取消",
    starting:"正在准备 CA-SL v1alpha4 Skills…",
    manifest:"正在读取示例清单…",
    files:(completed,total)=>"正在导入示例文件（"+completed+"/"+total+"）…",
    workspace:"正在打开示例工作区…",
    packages:"正在加载 Package Explorer…",
    procedure:"正在打开 v1alpha4 Procedure…",
    success:"示例项目已打开",
    failure:"示例项目载入失败"
  }:{
    title:"Loading example project",
    replacePrompt:"An Example project already exists. Replace the entire Example folder with the latest CA-SL v1alpha4 sample? This deletes all existing Example contents, including local edits and retired samples.",
    replaceAction:"Replace Example",
    cancelAction:"Cancel",
    starting:"Preparing CA-SL v1alpha4 Skills…",
    manifest:"Reading example manifests…",
    files:(completed,total)=>"Importing sample files ("+completed+"/"+total+")…",
    workspace:"Opening example workspace…",
    packages:"Preparing Package Explorer…",
    procedure:"Opening the v1alpha4 Procedure…",
    success:"Example project opened",
    failure:"Example project failed to load"
  };
  context.subscriptions.push(vscode.commands.registerCommand("skillStudio.loadExample",
    ()=>{
      // All entry points (Welcome, menu and Command Palette) share this task.
      // Repeated clicks must never start concurrent file imports.
      if(exampleLoadPromise)return exampleLoadPromise;
      exampleLoadPromise=(async()=>{
        // Also show the native status bar for hosts where notifications are
        // delayed or don't render until the extension's first awaited I/O.
        let statusBar=null;
        try{
          const exampleRoot=vscode.Uri.joinPath(context.globalStorageUri,EXAMPLE_PROJECT_NAME);
          let existingExample=false;
          try{await vscode.workspace.fs.stat(exampleRoot);existingExample=true;}
          catch(error){if(error?.code!=="FileNotFound")throw error;}
          let replaceExisting=false;
          if(existingExample){
            const choice=await vscode.window.showWarningMessage(
              exampleText.replacePrompt,{modal:true},
              exampleText.replaceAction,exampleText.cancelAction
            );
            if(choice!==exampleText.replaceAction)return null;
            replaceExisting=true;
          }
          statusBar=typeof vscode.window.setStatusBarMessage==="function"
            ?vscode.window.setStatusBarMessage(exampleText.starting):null;
          const run=async progress=>{
            const report=(message,details={})=>{
              progress?.report?.({message});
              projectWelcome?.setImportStatus({state:"loading",message,...details});
            };
            let stage="seed-example";
            try{
              report(exampleText.starting);
              const result=await seedExampleProject(
                vscode,context.extensionUri,context.globalStorageUri,{
                  replaceExisting,
                  onProgress:({phase,completed,total})=>{
                    if(phase==="manifest")report(exampleText.manifest);
                    else if(phase==="files")report(
                      exampleText.files(completed,total),{completed,total});
                    else if(phase==="project-ready")report(exampleText.workspace);
                  }
                });
              // A Theia browser-only session may currently be backed by an
              // Untitled multi-root workspace file. Opening the project folder
              // natively replaces that workspace and gives the workbench its
              // real folder identity. Resume the default Procedure after the
              // extension host is reactivated in the newly opened folder.
              if(!isSingleFolderWorkspace(vscode,result.root)){
                stage="open-project";
                report(exampleText.workspace);
                const pending={
                  root:result.root.toString(),
                  procedure:result.procedure.toString(),
                  files:result.files,candidateFiles:result.candidateFiles,
                  replacedExisting:result.replacedExisting,
                  skills:result.skills,sourceShas:result.sourceShas
                };
                await context.globalState.update(PENDING_EXAMPLE_OPEN_KEY,pending);
                try{
                  await openProjectFolder(vscode,result.root);
                }catch(error){
                  await context.globalState.update(PENDING_EXAMPLE_OPEN_KEY,undefined);
                  throw error;
                }
                return result;
              }
              stage="show-packages";
              report(exampleText.packages);
              // End in the real Package Explorer, not a custom duplicate view.
              let viewOpened=false;
              for(const id of ["workbench.view.explorer","skillStudio.packages.focus"]){
                try{
                  await vscode.commands.executeCommand(id);
                  viewOpened=true;
                  break;
                }catch{/* The alternative is optional, not a load failure. */}
              }
              let revealed=false;
              try{revealed=await packageOverview.revealPackages();}
              catch(error){
                console.warn("SKILL Package reveal unavailable:",String(error?.message??error));
                await packageOverview.refresh();
              }
              stage="open-procedure";
              report(exampleText.procedure);
              // Preserve the established Source/Visual pairing and editor focus.
              const confirmedFolders=(vscode.workspace.workspaceFolders??[])
                .map(folder=>folder.uri.toString());
              if(!confirmedFolders.includes(result.root.toString()))
                throw Error("Theia has not confirmed the skill-studio-demo workspace root");
              if(!isSingleFolderWorkspace(vscode,result.root))
                throw Error("Theia did not open the project as a named single-folder workspace");
              await vscode.commands.executeCommand("skillStudio.openProcedure",result.procedure);
              console.log("STUDIO_DEFAULT_WORKSPACE_OPENED",JSON.stringify({
                root:result.root.toString(),
                workspaceName:vscode.workspace.name??null,
                workspaceFile:vscode.workspace.workspaceFile?.toString?.()??null,
                workspaceFolders:confirmedFolders,
                defaultProcedure:result.procedure.toString(),
                editor:VIEW
              }));
              projectWelcome?.setImportStatus({
                state:"success",message:exampleText.success
              });
              // Keep the established success notification used by Chromium
              // acceptance and report whether the existing Example was replaced.
              void vscode.window.showInformationMessage(
                "示例项目已载入并打开工作区：skill-studio-demo/。默认已打开 CA-SL v1alpha4 Procedure（DRAFT / NOT_QUALIFIED）。"+
                (result.replacedExisting?"已替换原有 Example 内容。":"")+
                "导入 v1alpha4 Skill 文件 "+result.candidateFiles+" 个。"+
                (viewOpened&&revealed?"已展开 Package Explorer（两个 CA-SL v1alpha4 Skills）。":
                  "可在 Explorer → Package Explorer 查看 v1alpha4 Skills。"));
              return result;
            }catch(error){
              const message=exampleText.failure+" ["+stage+"]："+String(error?.message??error);
              projectWelcome?.setImportStatus({state:"error",message});
              void vscode.window.showErrorMessage(
                "SKILL 示例载入失败 ["+stage+"]："+String(error?.message??error));
              return null;
            }
          };
          // Theia and VS Code display their own native progress notification.
          // No cancellation: the importer may have created some of its files.
          if(typeof vscode.window.withProgress==="function"&&
             vscode.ProgressLocation?.Notification!==undefined){
            return await vscode.window.withProgress({
              location:vscode.ProgressLocation.Notification,
              title:exampleText.title,cancellable:false
            },run);
          }
          return await run({report(){}});
        }catch(error){
          void vscode.window.showErrorMessage(
            "SKILL Example replacement check failed: "+String(error?.message??error));
          return null;
        }finally{
          statusBar?.dispose?.();
        }
      })().finally(()=>{exampleLoadPromise=null;});
      return exampleLoadPromise;
    }));
  context.subscriptions.push(vscode.commands.registerCommand("skillStudio.openProcedure",
    async uri=>{
      // Commands may cross a Theia/VS Code extension-host RPC boundary where
      // Uri instances arrive as plain objects. Rehydrate them before passing
      // them to workspace/editor APIs; otherwise showTextDocument can receive
      // a serialized object and fail with "Failed to show text document
      // [object Object]" during recovery cleanup.
      let target=typeof uri==="string"?vscode.Uri.parse(uri):
        uri?.scheme&&uri?.path!==undefined
          ?vscode.Uri.from({scheme:uri.scheme,authority:uri.authority??"",
            path:uri.path,query:uri.query??"",fragment:uri.fragment??""})
          :uri;
      if(!target){
        const active=vscode.window.activeTextEditor?.document.uri;
        if(active&&isProcedurePath(active.path))target=active;
      }
      if(!target){
        const candidates=await vscode.workspace.findFiles(
          "**/assurance/procedure.yaml","**/node_modules/**",50);
        if(!candidates.length){
          void vscode.window.showInformationMessage("Open a SKILL folder containing assurance/procedure.yaml");
          return;
        }
        if(candidates.length===1)target=candidates[0];
        else{
          const choice=await vscode.window.showQuickPick(candidates.map(file=>({
            label:vscode.workspace.asRelativePath(file),uri:file
          })),{placeHolder:"Choose the Procedure Source file"});
          if(!choice)return;
          target=choice.uri;
        }
      }
      if(!isProcedurePath(target.path))return;
      await openSourceViewPair(vscode,target);
    }));
  const pairActiveYamlSource=uri=>{
    if(!uri||!sourceViewType(uri)||hasSourceViewPair(uri))return;
    void openSourceViewPair(vscode,uri).catch(error=>{
      console.warn("SKILL Studio Source/Visual pairing failed:",String(error?.message??error));
      void vscode.window.showWarningMessage(
        "无法打开对应的 Skill Designer；原始 Source 仍可继续编辑。");
    });
  };
  // Keep ordinary editable documents in the primary Source group. Without
  // this normalization, opening a Python/unsupported YAML file while a
  // Designer is focused inherits the right-hand Visual group; the next
  // Source/Visual pair can then cause Theia to create a third editor column.
  // Paired YAML is deliberately excluded because openSourceViewPair owns its
  // two fixed positions. Moving an ordinary tab preserves its TextDocument,
  // dirty state, native Undo history and editor identity.
  const normalizeSourceOnlyEditor=createSourceOnlyEditorNormalizer(vscode,{
    sourceViewType,hasSourceViewPair,
    onError:error=>console.warn(
      "SKILL Studio could not return a Source-only editor to the primary group:",
      String(error?.message??error))
  });
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor=>{
    pairActiveYamlSource(editor?.document?.uri);
    normalizeSourceOnlyEditor(editor);
  }));
  // A restored YAML Source may already be active before onStartupFinished
  // activates this extension, so apply the same pairing once after activation.
  const initiallyActiveYaml=vscode.window.activeTextEditor?.document?.uri;
  if(initiallyActiveYaml)setTimeout(()=>{
    if(vscode.window.activeTextEditor?.document?.uri?.toString()===initiallyActiveYaml.toString()){
      pairActiveYamlSource(initiallyActiveYaml);
      // Also normalize a Source-only document restored by the host before
      // extension activation (there is no active-editor event in that case).
      normalizeSourceOnlyEditor(vscode.window.activeTextEditor);
    }
  },0);
  // Real-Chromium acceptance only: exercise several Designer tabs followed by
  // ordinary Python/YAML Source documents while the Visual group is focused.
  // The command is deliberately not contributed to the user command palette.
  context.subscriptions.push(vscode.commands.registerCommand(
    "skillStudio.internal.editorGroupAcceptance",async()=>{
      const procedures=await vscode.workspace.findFiles(
        "**/assurance/procedure.yaml","**/node_modules/**",20);
      if(procedures.length<1)throw Error("No real Skill Procedure files found for editor-group acceptance");
      const visualUris=[];
      const add=uri=>{
        if(uri&&sourceViewType(uri)&&!visualUris.some(item=>item.toString()===uri.toString()))
          visualUris.push(uri);
      };
      const procedureRoots=[];
      for(const procedure of procedures){
        const rootPath=procedure.path.replace(/\/assurance\/procedure\.yaml$/,"");
        const root=procedure.with({path:rootPath});
        procedureRoots.push({procedure,root});
        add(procedure);
        for(const relative of ["assurance/contract.yaml","assurance/predicates.yaml"]){
          const uri=procedure.with({path:rootPath+"/"+relative});
          try{await vscode.workspace.fs.stat(uri);add(uri);}catch{/* Optional authored view. */}
        }
        const schemas=await vscode.workspace.findFiles(
          new vscode.RelativePattern(root,"schemas/*.schema.yaml"),"**/node_modules/**",10);
        for(const schema of schemas)add(schema);
      }
      const firstRoot=procedureRoots[0].root;
      const firstPackageVisuals=visualUris.filter(uri=>uri.path.startsWith(firstRoot.path+"/"));
      for(const uri of firstPackageVisuals)await openSourceViewPair(vscode,uri);
      const pythonFiles=await vscode.workspace.findFiles(
        "**/scripts/validate-subscription-request.py","**/node_modules/**",5);
      if(!pythonFiles.length)throw Error("CA-SL v1alpha4 Python acceptance fixture is missing");
      const python=await vscode.workspace.openTextDocument(pythonFiles[0]);
      await vscode.window.showTextDocument(python,{
        viewColumn:vscode.ViewColumn.Two,preserveFocus:false,preview:false
      });
      const waitForPrimary=async uri=>{
        const started=Date.now();
        while(Date.now()-started<3000){
          const editor=(vscode.window.visibleTextEditors??[]).find(item=>
            item.document.uri.toString()===uri.toString());
          if(editor?.viewColumn===vscode.ViewColumn.One)return editor;
          await new Promise(resolve=>setTimeout(resolve,25));
        }
        throw Error("Source-only editor was not normalized into the primary group: "+uri.toString());
      };
      const pythonColumn=(await waitForPrimary(python.uri)).viewColumn;
      // Use a saved, temporary ordinary YAML file rather than an Untitled
      // buffer so the acceptance cleanup never opens an unsaved-changes dialog.
      const projectRoot=firstRoot.with({
        path:firstRoot.path.replace(/\/skills\/[^/]+$/,"")
      });
      const yamlUri=projectRoot.with({path:projectRoot.path+"/.studio-editor-group-acceptance.yaml"});
      await vscode.workspace.fs.writeFile(yamlUri,
        new TextEncoder().encode("kind: editor-group-acceptance\\n"));
      const yamlDocument=await vscode.workspace.openTextDocument(yamlUri);
      if(yamlDocument.isDirty&&!await yamlDocument.save())
        throw Error("Temporary YAML fixture could not be saved");
      if(yamlDocument.isDirty)
        throw Error("Temporary YAML fixture remained dirty after save");
      await vscode.window.showTextDocument(yamlDocument,{
        viewColumn:vscode.ViewColumn.Two,preserveFocus:false,preview:false
      });
      const ordinaryYamlColumn=(await waitForPrimary(yamlDocument.uri)).viewColumn;
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
      await vscode.workspace.fs.delete(yamlUri);
      // Open a second Package's Designer after the Source-only tabs have been
      // normalized. This catches the original two-to-three-column regression.
      const secondProcedure=procedures.find(uri=>
        !uri.path.startsWith(firstRoot.path+"/"));
      if(secondProcedure)await openSourceViewPair(vscode,secondProcedure);
      const groups=(vscode.window.tabGroups?.all??[]).map(group=>({
        viewColumn:group.viewColumn,tabCount:group.tabs?.length??0
      }));
      const visibleEditors=(vscode.window.visibleTextEditors??[]).map(editor=>({
        uri:editor.document.uri.toString(),viewColumn:editor.viewColumn
      }));
      const maxViewColumn=Math.max(0,...groups.map(group=>group.viewColumn??0),
        ...visibleEditors.map(editor=>editor.viewColumn??0));
      return {openedVisualCount:visualUris.length,groupCount:groups.length,
        groups,visibleEditors,maxViewColumn,
        pythonColumn,ordinaryYamlColumn};
    }));
  // A real empty-workspace editor page is required: Theia currently does not
  // render Explorer viewsWelcome without a workspace folder.
  projectWelcome=registerProjectWelcome(vscode,context);
  // Open Example switches to a named folder, which restarts the extension host.
  // Complete the user-requested default Procedure open only after the new
  // single-folder workspace is active; never auto-open on unrelated projects.
  void restorePendingExampleProject(vscode,context,{
    revealPackages:async()=>{
      for(const id of ["workbench.view.explorer","skillStudio.packages.focus"]){
        try{await vscode.commands.executeCommand(id);break;}
        catch{/* The alternative is optional. */}
      }
      try{await packageOverview?.revealPackages?.();}
      catch{await packageOverview?.refresh?.();}
    },
    onRestored:pending=>{
      const folders=(vscode.workspace.workspaceFolders??[])
        .map(folder=>folder.uri.toString());
      console.log("STUDIO_DEFAULT_WORKSPACE_OPENED",JSON.stringify({
        root:pending.root,
        workspaceName:vscode.workspace.name??null,
        workspaceFile:vscode.workspace.workspaceFile?.toString?.()??null,
        workspaceFolders:folders,
        defaultProcedure:pending.procedure,
        editor:VIEW
      }));
      const detail=progressZh
        ?((pending.replacedExisting?"已替换原有 Example 内容。":"")+
          "导入 v1alpha4 Skill 文件 "+pending.candidateFiles+" 个。")
        :((pending.replacedExisting?"Replaced the previous Example contents. ":"")+
          "Imported "+pending.candidateFiles+" CA-SL v1alpha4 Skill files.");
      const message=progressZh
        ?("示例项目已载入并打开工作区：skill-studio-demo/。默认已打开 CA-SL v1alpha4 Procedure（DRAFT / NOT_QUALIFIED）。"+detail)
        :("Example project opened: skill-studio-demo/. The CA-SL v1alpha4 Procedure is open (DRAFT / NOT_QUALIFIED). "+detail);
      void vscode.window.showInformationMessage(message);
    }
  }).catch(error=>{
    void vscode.window.showErrorMessage(
      "SKILL Studio could not finish opening the Example Procedure: "+
      String(error?.message??error));
  });
  return {extendMarkdownIt};
}
export function deactivate(){}
