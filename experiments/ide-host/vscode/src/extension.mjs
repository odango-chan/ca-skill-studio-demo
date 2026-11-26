import {openNativeSource,openTextDocumentWithRetry} from "./native-source.mjs";
import {registerPreviewHost} from "./preview-host.mjs";
import {mountMarkdownPreview} from "./markdown-preview.mjs";

import {sourceViewType} from "./source-view-pair.mjs";
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
import {EXAMPLE_PROJECT_NAME,seedExampleProject,
  ensureOpenedExampleDependencies,recoverExampleReplacement,
  getExampleReplacementStatus} from "./sample-loader.mjs";
import {openProjectFolder,isSingleFolderWorkspace,restorePendingExampleProject,PENDING_EXAMPLE_OPEN_KEY} from "./project-navigation.mjs";
import {registerProjectWelcome} from "./project-welcome.mjs";

import {registerWorkbench} from "./workbench.mjs";
import {registerWorkspaceMode} from "./workspace-mode.mjs";
import {registerAiAuthoringEditor} from "./ai-authoring-editor.mjs";
import {registerSyntheticAuthoringAcceptance} from "./ai-authoring-acceptance.mjs";
import {staticPreviewResourceUrl} from "./webview-resource-url.mjs";
import {registerContractCommands,mountContractPreview} from "./contract-editor.mjs";
import {registerPredicateCommands,mountPredicatePreview} from "./predicate-editor.mjs";
import {registerSchemaCommands,mountSchemaPreview} from "./schema-editor.mjs";
import {registerPackageOverview} from "./package-overview.mjs";
import {registerDependencyIntegration} from "./dependency-integration.mjs";
import {resolveLockedDependencies} from "./dependency-service.mjs";
import {projectLockedInterfaceCompletionHints} from "./interface-schema-completion.mjs";
import {projectLockedToolCatalog} from "./dependency-catalog-projection.mjs";
import {registerCompilerIntegration} from "./compiler-integration.mjs";
import {registerPackageDiagnosticTesting} from "./package-diagnostic-testing.mjs";
import {registerPackageRouteTesting} from "./package-route-testing.mjs";
import {iconShapes} from "../../../../site/icons.mjs";
const MAX_SOURCE_BYTES=1024*1024;
const isProcedurePath=path=>typeof path==="string"&&
  /(?:^|\/)assurance\/procedure\.yaml$/.test(path);
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
export async function activate(context){
  let replacementRecoveryResult=null,replacementRecoveryError=null;
  try{replacementRecoveryResult=await recoverExampleReplacement(vscode,context.globalStorageUri);}
  catch(error){replacementRecoveryError=error;}
  let workbench=null,packageOverview=null,projectWelcome=null,workbenchReady=false;
  let lastExampleImport=null;
  const activationFailures=[];
  const activationComponents=Object.create(null);
  let activationWarningShown=false;
  const recordActivationFailure=(component,error)=>{
    const failure={component,message:String(error?.message??error)};
    activationFailures.push(failure);
    activationComponents[component]="FAILED";
    console.error("SKILL_STUDIO_ACTIVATION_FAILURE",JSON.stringify(failure));
    if(!activationWarningShown){
      activationWarningShown=true;
      try{
        void vscode.window.showWarningMessage(
          "SKILL Studio could not initialize "+component+": "+failure.message+
          ". Run SKILL Studio: Show Activation Diagnostics."
        );
      }catch{}
    }
  };
  if(replacementRecoveryError)
    recordActivationFailure("Example replacement recovery",replacementRecoveryError);
  else
    activationComponents["Example replacement recovery"]=getExampleReplacementStatus().state;
  const registerSafely=(component,register,fallback=null)=>{
    try{
      const value=register();
      activationComponents[component]="READY";
      return value??fallback;
    }catch(error){
      recordActivationFailure(component,error);
      return fallback;
    }
  };
  // Welcome must be registered before optional editors and providers. A failure
  // in Compiler, Preview or semantic highlighting must not strand the user.
  projectWelcome=registerSafely("Welcome",()=>registerProjectWelcome(vscode,context));
  if(!projectWelcome){
    registerSafely("Welcome fallback",()=>context.subscriptions.push(
      vscode.commands.registerCommand("skillStudio.showWelcome",()=>{
        void vscode.window.showWarningMessage(
          "SKILL Studio Welcome is unavailable. Run Show Activation Diagnostics."
        );
      })
    ));
  }
  registerSafely("Activation Diagnostics",()=>context.subscriptions.push(
    vscode.commands.registerCommand("skillStudio.showActivationDiagnostics",async()=>{
      const activeDocument=vscode.window.activeTextEditor?.document??null;
      const packageInventory=packageOverview?.getDiagnostics?.()??null;
      let registeredCommands=[];
      try{registeredCommands=await vscode.commands.getCommands(true);}catch{}
      let semanticTokens=null;
      try{
        semanticTokens=await vscode.commands.executeCommand(
          "skillStudio.internal.semanticTokenDiagnostics"
        );
      }catch(error){
        semanticTokens={error:String(error?.message??error)};
      }
      let extension=null;
      try{
        extension=vscode.extensions?.getExtension?.(
          "odango-chan.ca-skill-studio-ide-spike"
        )??null;
      }catch{}
      const report={
        extensionId:"odango-chan.ca-skill-studio-ide-spike",
        extensionVersion:extension?.packageJSON?.version??null,
        buildId:typeof STUDIO_BUILD_ID!=="undefined"?STUDIO_BUILD_ID:null,
        extensionActive:extension?.isActive??true,
        welcomeCommandRegistered:registeredCommands.includes("skillStudio.showWelcome"),
        welcome:projectWelcome?.getDiagnostics?.()??null,
        semanticTokens,
        workspaceName:vscode.workspace.name??null,
        workspaceFolders:(vscode.workspace.workspaceFolders??[])
          .map(folder=>folder.uri.toString()),
        activeDocument:activeDocument?{
          uri:activeDocument.uri.toString(),languageId:activeDocument.languageId
        }:null,
        components:{...activationComponents},
        failures:[...activationFailures],
        packageInventory,
        exampleReplacement:getExampleReplacementStatus(),
        lastExampleImport,
        workbenchReady
      };
      console.info("SKILL_STUDIO_ACTIVATION_DIAGNOSTICS",JSON.stringify(report));
      const failureSummary=activationFailures.length
        ?"Activation failures: "+activationFailures.map(item=>item.component).join(", ")
        :"No startup failures recorded";
      const packageSummary=packageInventory
        ?" · Package "+packageInventory.state+" ("+packageInventory.packageCount+")":"";
      void vscode.window.showInformationMessage(
        "SKILL Studio · "+failureSummary+packageSummary
      );
      return report;
    })
  ));
  const compilerIntegration=registerSafely("Compiler",
    ()=>registerCompilerIntegration(vscode,context,{
      getActiveDocument:()=>workbench?.getActiveDocument?.()??
        vscode.window.activeTextEditor?.document??null,
      getAcceptedLanguageFindings:rootUri=>
        workbench?.getAcceptedPackageDiagnostics?.(rootUri)??[]
    }),{provider:null,problems:null,dispose(){}});
  const dependencyIntegration=registerSafely("Dependencies",
    ()=>registerDependencyIntegration(vscode,context,{
      onLockChanged:()=>workbench?.invalidateDependencyAnalysis?.(),
      onProjectRootChanged:()=>void packageOverview?.refresh()
    }),{
      provider:null,getProjectRoot:()=>null,prepareToolContract:()=>null,dispose(){}
    });
  packageOverview=registerSafely("Package Explorer",
    ()=>registerPackageOverview(vscode,context,
      ()=>workbench?.getActiveDocument?.()??null,{
        dependenciesProvider:dependencyIntegration.provider,
        compilerProvider:compilerIntegration.provider,
        getProjectRoot:dependencyIntegration.getProjectRoot,
        getAvailability:()=>{
          const exampleRoot=vscode.Uri.joinPath(context.globalStorageUri,EXAMPLE_PROJECT_NAME);
          const examplePath=exampleRoot.path;
          const isWithinExample=uri=>{
            const path=uri?.path;
            return typeof path==="string"&&
              (path===examplePath||path.startsWith(examplePath+"/"));
          };
          const scanScopeTouchesExample=uri=>{
            const path=uri?.path;
            return typeof path==="string"&&
              (isWithinExample(uri)||examplePath.startsWith(path+"/"));
          };
          const folders=vscode.workspace.workspaceFolders??[];
          const selectedRoot=dependencyIntegration.getProjectRoot?.()??null;
          const active=folders.some(folder=>scanScopeTouchesExample(folder.uri))||
            scanScopeTouchesExample(selectedRoot)||
            (!folders.length&&[
              ...(vscode.workspace.textDocuments??[]),
              ...(workbench?.getActiveDocument?.()?[workbench.getActiveDocument()]:[]),
              ...(vscode.window.activeTextEditor?.document
                ?[vscode.window.activeTextEditor.document]:[])
            ].some(document=>isWithinExample(document?.uri)));
          return active?getExampleReplacementStatus():{state:"READY"};
        },
        onPackagesChanged:packages=>workbench?.syncPackages?.(packages)
      }),{
        refresh:async()=>[],revealPackages:async()=>false,
        getDiagnostics:()=>({
          state:"unavailable",message:"Package Explorer registration failed",
          packageCount:0,packages:[],treeReads:0,treeReadsByKind:{}
        }),
        dispose(){}
      });
  const unavailableWorkbench={
    getActiveDocument:()=>vscode.window.activeTextEditor?.document??null,
    syncPackages(){},invalidateDependencyAnalysis(){},
    attach(){return ()=>{};},activate(){},select(){}
  };
  workbench=registerSafely("Workbench",
    ()=>registerWorkbench(vscode,context,{
      prepareToolContract:dependencyIntegration.prepareToolContract,
      compilerProblemsProvider:compilerIntegration.problems
    }),unavailableWorkbench);
  workbenchReady=workbench!==unavailableWorkbench;
  const authoringEditor=registerSafely("AI Authoring Editor",()=>registerAiAuthoringEditor(vscode,context,{
    getActiveDocument:()=>workbench?.getActiveDocument?.()??null,
    getPackageProcedure:document=>packageOverview?.getProcedureForDocument?.(document),
    compilerIntegration
  }),null);
  const workspaceMode=authoringEditor&&registerSafely("Workspace Mode",()=>
    registerWorkspaceMode(vscode,context,{
      authoring:authoringEditor,
      showWelcome:()=>vscode.commands.executeCommand("skillStudio.showWelcome")
    }));
  void workspaceMode?.restore();
  registerSafely("Synthetic AI Authoring acceptance",()=>registerSyntheticAuthoringAcceptance(
    vscode,context,compilerIntegration,authoringEditor));
  registerSafely("Package diagnostic tests",()=>registerPackageDiagnosticTesting(vscode,context,{
    getActiveProcedure:()=>workbench?.getActiveDocument?.()??
      vscode.window.activeTextEditor?.document??null
  }));
  registerSafely("Package route tests",()=>registerPackageRouteTesting(vscode,context,{
    getActiveProcedure:()=>workbench?.getActiveDocument?.()??
      vscode.window.activeTextEditor?.document??null
  }));
  registerSafely("Contract Commands",()=>registerContractCommands(vscode,context));
  registerSafely("Predicate Commands",()=>registerPredicateCommands(vscode,context));
  registerSafely("Schema Commands",()=>registerSchemaCommands(vscode,context));
  function mountProcedurePreview(document,panel,{isCurrent=()=>true}={}){
      if(!isProcedurePath(document.uri.path)){
        vscode.window.showWarningMessage("Only assurance/procedure.yaml is supported by the Procedure Preview");
        return;
      }
      if(!workbenchReady){
        const details=activationFailures.map(item=>
          item.component+": "+item.message).join("\n")||
          "The Procedure Preview did not initialize.";
        panel.webview.options={enableScripts:false};
        panel.webview.html='<!doctype html><html lang="en"><meta charset="utf-8">'+
          '<body><main><h2>SKILL Studio Preview unavailable</h2>'+
          '<p>Source files remain available. Open Activation Diagnostics to inspect the failed component.</p>'+
          '<pre>'+escaped(details)+'</pre></main></body></html>';
        return;
      }
      const openedAt=performance.now();
      const webview=panel.webview;
      const detach=workbench.attach(document,message=>webview.postMessage(message));
      // Source remains the sole Main Editor. The right Preview WebviewView
      // is not an Editor tab, so initialize the workbench from the Source document.
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
        if(disposed||!ready||!isCurrent())return;
        const ticket=++pushTicket,version=document.version,text=document.getText();
        if(text.length>MAX_SOURCE_BYTES){
          void webview.postMessage({type:"error",message:"Source exceeds the 1 MiB Procedure editor limit"});
          return;
        }
        // The current source projection always consumes the Package Contract
        // and PredicateSet. Never choose files or analysis behavior by version.
        const contract=await readPackageText("assurance/contract.yaml");
        const predicates=await readPackageText("assurance/predicates.yaml");
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
        if(disposed||!isCurrent()||typeof message!=="object"||!message)return;
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
        return;
      });
      let releasePanel=null,cleaned=false;
      const cleanup=()=>{
        if(cleaned)return;
        cleaned=true;disposed=true;
        detach();viewState.dispose();changed.dispose();incoming.dispose();
        releasePanel?.dispose?.();
      };
      releasePanel=panel.onDidDispose(cleanup);
      return {dispose:cleanup};
  }
  // The single right-side Preview Host owns all contextual visualizations.
  // Visual open commands reveal only the native Source editor; the Preview
  // follows active Source documents without creating another EditorGroup.
  registerSafely("Preview Host",()=>registerPreviewHost(vscode,context,{
    mountProcedure:mountProcedurePreview,
    mountContract:(document,panel,options)=>mountContractPreview(vscode,document,panel,options),
    mountPredicate:(document,panel,options)=>mountPredicatePreview(vscode,document,panel,options),
    mountSchema:(document,panel,options)=>mountSchemaPreview(vscode,document,panel,options),
    mountMarkdown:(document,panel,options)=>mountMarkdownPreview(vscode,context,document,panel,options)
  }));
  try{
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
  // returns the authoritative workspace and the two current Skill URIs.
  context.subscriptions.push(vscode.commands.registerCommand(
    "skillStudio.internal.workspaceIdentityAcceptance",async(options={})=>{
      const folders=vscode.workspace.workspaceFolders??[];
      const exampleRoot=vscode.Uri.joinPath(context.globalStorageUri,EXAMPLE_PROJECT_NAME);
      const root=folders.length===1?folders[0].uri:null;
      const isExample=root?.toString?.()===exampleRoot.toString();
      if(isExample){
        const status=getExampleReplacementStatus();
        if(status.state!=="READY")
          throw Error("Example workspace identity is blocked while replacement state is "+
            status.state+": "+(status.message??"recovery has not completed"));
      }
      let seededApiVersion=null;
      if(options?.seedLegacyExample===true){
        if(folders.length!==1||folders[0].uri.toString()!==exampleRoot.toString())
          throw Error("Refusing to seed a legacy fixture outside the built-in Example workspace");
        const contract=vscode.Uri.joinPath(exampleRoot,"skills","establish-pdu-session-mas",
          "assurance","contract.yaml");
        const procedure=vscode.Uri.joinPath(exampleRoot,"skills","establish-pdu-session-mas",
          "assurance","procedure.yaml");
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(exampleRoot,"lib"));
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(exampleRoot,"output"));
        await vscode.workspace.fs.writeFile(contract,new TextEncoder().encode(
          "apiVersion: connectionagent.io/v1alpha1\n"+
          "kind: Contract\nmetadata:\n  name: legacy-example\n"
        ));
        await vscode.workspace.fs.writeFile(procedure,new TextEncoder().encode(
          "apiVersion: connectionagent.io/v1alpha1\n"+
          "kind: Procedure\nstart: legacy\nnodes: {}\n"
        ));
        seededApiVersion="connectionagent.io/v1alpha1";
      }
      const defaultProcedure=root?vscode.Uri.joinPath(root,
        "skills","establish-pdu-session-mas","assurance","procedure.yaml"):null;
      const masProcedure=root?vscode.Uri.joinPath(root,
        "skills","modify-pdu-session-mas","assurance","procedure.yaml"):null;
      const releaseProcedure=root?vscode.Uri.joinPath(root,
        "skills","release-pdu-session-mas","assurance","procedure.yaml"):null;
      const contract=root?vscode.Uri.joinPath(root,
        "skills","establish-pdu-session-mas","assurance","contract.yaml"):null;
      const lib=root?vscode.Uri.joinPath(root,"lib"):null;
      const output=root?vscode.Uri.joinPath(root,"output"):null;
      const exists=async uri=>{
        if(!uri)return false;
        try{await vscode.workspace.fs.stat(uri);return true;}
        catch{return false;}
      };
      const readSource=async uri=>{
        if(!uri)return {text:null,error:'URI unavailable'};
        try{
          const text=new TextDecoder('utf-8',{fatal:true})
            .decode(await vscode.workspace.fs.readFile(uri));
          return {text,error:null};
        }catch(error){return {text:null,error:String(error?.message??error)};}
      };
      const contractRead=await readSource(contract);
      const procedureRead=await readSource(defaultProcedure);
      const apiVersion=source=>/^\s*apiVersion\s*:\s*[\"']?([^\"'\s]+)/m.exec(source??'')?.[1]??null;
      const contractApiVersion=apiVersion(contractRead.text);
      const procedureApiVersion=apiVersion(procedureRead.text);
      // CA-SL v1alpha5 intentionally has no apiVersion field in each source file.
      // Its frozen authoring shape is a top-level Contract and a start/nodes DAG.
      const contractCurrentShape=Boolean(contractRead.text&&
        /^\s*goal\s*:/m.test(contractRead.text)&&
        /^\s*precondition\s*:/m.test(contractRead.text)&&
        /^\s*requestSchema\s*:/m.test(contractRead.text)&&
        /^\s*contextSchema\s*:/m.test(contractRead.text)&&
        /^\s*dependencies\s*:/m.test(contractRead.text)&&
        /^\s*capabilities\s*:/m.test(contractRead.text));
      const procedureCurrentShape=Boolean(procedureRead.text&&
        /^\s*start\s*:/m.test(procedureRead.text)&&
        /^\s*nodes\s*:/m.test(procedureRead.text)&&
        !/^\s*procedures\s*:/m.test(procedureRead.text));
      const dependencies=isExample
        ?await resolveLockedDependencies(vscode,root):null;
      const interfaceSnapshot=dependencies?.snapshots?.find(item=>
        item.id==="ca-client"&&item.kind==="interface-package");
      const interfaceHints=interfaceSnapshot
        ?projectLockedInterfaceCompletionHints(interfaceSnapshot):[];
      const ownerSnapshot=dependencies?.snapshots?.find(item=>
        item.id==="mas"&&item.kind==="tool-catalog");
      const ownerCatalog=ownerSnapshot
        ?projectLockedToolCatalog(ownerSnapshot):{available:false,operations:[]};
      const identity={
        workspaceName:vscode.workspace.name??null,
        workspaceFile:vscode.workspace.workspaceFile?.toString?.()??null,
        root:root?.toString?.()??null,
        workspaceFolders:folders.map(folder=>folder.uri.toString()),
        defaultProcedure:defaultProcedure?.toString?.()??null,
        defaultProcedureExists:await exists(defaultProcedure),
        masProcedure:masProcedure?.toString?.()??null,
        masProcedureExists:await exists(masProcedure),
        releaseProcedure:releaseProcedure?.toString?.()??null,
        releaseProcedureExists:await exists(releaseProcedure),
        contractApiVersion,procedureApiVersion,
        contractCurrentShape,procedureCurrentShape,
        contractReadError:contractRead.error,procedureReadError:procedureRead.error,
        libExists:await exists(lib),
        outputExists:await exists(output),
        ...(isExample?{exampleInterface:{
          status:dependencies?.status,
          imported:Boolean(interfaceSnapshot),
          lockedDependencyCount:dependencies?.snapshots?.length??0,
          availableCompletionCallables:interfaceHints.length,
          contextReadHint:interfaceHints.some(item=>
            item.id==="ca-client::openamsm.smf.mas.sc.query"&&
            item.argumentProperties?.some(p=>p.name==="supi")),
          ownerToolCatalog:{
            available:ownerCatalog.available,
            operationCount:ownerCatalog.operations?.length??0,
            operationIds:(ownerCatalog.operations??[]).map(item=>item.id)
          },
          qualification:"AUTH_NOT_CHECKED",
          diagnostics:dependencies?.diagnostics?.map(item=>item.code)??[]
        }}:{}),
        ...(seededApiVersion?{seededApiVersion}:{})
      };
      if(isExample){
        const latestStatus=getExampleReplacementStatus();
        if(latestStatus.state!=="READY")
          throw Error("Example workspace identity changed during inspection; replacement state is "+
            latestStatus.state+": "+(latestStatus.message??"recovery has not completed"));
      }
      return identity;
    }
  ));
  let exampleLoadPromise=null;
  let projectWelcome=null;
  const progressZh=String(vscode.env?.language??"en").toLowerCase().startsWith("zh");
  const exampleText=progressZh?{
    title:"加载示例项目",
    replacePrompt:"检测到已有 Example 项目。是否替换为最新 当前 CA-SL 示例？替换将删除整个 Example 目录中的现有内容，包括本地修改和旧版样例。",
    replaceAction:"替换 Example",
    cancelAction:"取消",
    starting:"正在准备 current CA-SL Skills…",
    replacing:"正在验证旧 Example 备份并提交替换…",
    rollback:"替换未完成，正在恢复旧 Example…",
    recoveryRequired:"Example 恢复未完成；工作区已阻止就绪状态，请保留恢复数据。",
    manifest:"正在读取示例清单…",
    files:(completed,total)=>"正在导入示例文件（"+completed+"/"+total+"）…",
    workspace:"正在打开示例工作区…",
    packages:"正在加载 Package Explorer…",
    procedure:"正在打开 current Procedure…",
    success:"示例项目已打开",
    failure:"示例项目载入失败"
  }:{
    title:"Loading example project",
    replacePrompt:"An Example project already exists. Replace the entire Example folder with the latest current CA-SL sample? This deletes all existing Example contents, including local edits and retired samples.",
    replaceAction:"Replace Example",
    cancelAction:"Cancel",
    starting:"Preparing current CA-SL Skills…",
    replacing:"Verifying the previous Example backup and committing replacement…",
    rollback:"Replacement did not complete; restoring the previous Example…",
    recoveryRequired:"Example recovery is incomplete; the workspace is blocked. Keep the recovery data intact.",
    manifest:"Reading example manifests…",
    files:(completed,total)=>"Importing sample files ("+completed+"/"+total+")…",
    workspace:"Opening example workspace…",
    packages:"Preparing Package Explorer…",
    procedure:"Opening the current Procedure…",
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
            console.log("STUDIO_EXAMPLE_REPLACEMENT_DECISION",JSON.stringify({
              existingExample,choice:choice??null,
              replaceAction:exampleText.replaceAction,
              replaceExisting:choice===exampleText.replaceAction
            }));
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
                    if(phase==="replacement-started"||
                       phase==="replacement-rolled-back"||
                       phase==="replacement-aborted"||
                       phase==="replacement-recovery-required"||
                       phase==="project-ready")
                      void packageOverview?.refresh?.();
                    if(phase==="replacement-started")report(exampleText.replacing);
                    else if(phase==="replacement-rolled-back")report(exampleText.rollback);
                    else if(phase==="replacement-recovery-required")report(exampleText.recoveryRequired);
                    else if(phase==="manifest")report(exampleText.manifest);
                    else if(phase==="files")report(
                      exampleText.files(completed,total),{completed,total});
                    else if(phase==="project-ready")report(exampleText.workspace);
                  }
                });
              lastExampleImport={
                state:"success",stage:"complete",replaceRequested:replaceExisting,
                replacedExisting:result.replacedExisting,
                candidateFiles:result.candidateFiles,created:result.created,
                skipped:result.skipped,readmeUpdated:result.readmeUpdated
              };
              console.log("STUDIO_EXAMPLE_IMPORT_RESULT",JSON.stringify({
                root:result.root.toString(),replaceRequested:replaceExisting,
                replacedExisting:result.replacedExisting,
                candidateFiles:result.candidateFiles,created:result.created,
                skipped:result.skipped,readmeUpdated:result.readmeUpdated,
                exampleDependencySeeded:result.exampleDependencySeeded,
                exampleDependencyIds:result.exampleDependencyIds,
                exampleDependencySnapshotDigests:result.exampleDependencySnapshotDigests
              }));
              if(replaceExisting&&(!result.replacedExisting||
                 result.created!==result.candidateFiles||result.skipped!==0||
                 !result.readmeUpdated))
                throw Error("Explicit Example replacement did not replace the complete existing root");
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
              // Open the authoritative native Source; the shared right Preview follows it.
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
                editor:"native-source",preview:"skillStudio.preview"
              }));
              projectWelcome?.setImportStatus({
                state:"success",message:exampleText.success
              });
              // Keep the established success notification used by Chromium
              // acceptance and report whether the existing Example was replaced.
              void vscode.window.showInformationMessage(
                "示例项目已载入并打开工作区：skill-studio-demo/。默认已打开 CA-SL current Procedure（DRAFT / NOT_QUALIFIED）。"+
                (result.replacedExisting?"已替换原有 Example 内容。":"")+
                "导入当前 CA-SL Skill 文件 "+result.candidateFiles+" 个。"+
                (viewOpened&&revealed?"已展开 Package Explorer（三个 Scheme C Skills）。":
                  "可在 Explorer → Package Explorer 查看当前 CA-SL Skills。"));
              return result;
            }catch(error){
              const detail=String(error?.message??error);
              lastExampleImport={
                state:"error",stage,message:detail,
                replacement:getExampleReplacementStatus()
              };
              console.error("STUDIO_EXAMPLE_IMPORT_FAILURE",JSON.stringify(lastExampleImport));
              const message=exampleText.failure+" ["+stage+"]："+detail;
              projectWelcome?.setImportStatus({state:"error",message});
              // A pre-commit abort leaves the old Example READY; a failed
              // rollback remains blocked. Re-read either state before showing
              // the error so Package Explorer cannot retain a stale snapshot.
              try{await packageOverview?.refresh?.();}catch{}
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
      await openNativeSource(vscode,target,{viewColumn:vscode.ViewColumn.One,preserveFocus:false,preview:false});
      await vscode.commands.executeCommand("skillStudio.showPreview",target);
    }));
  // The right-side Preview Host follows the active TextEditor itself.
  // Do not reopen a Source file from active-editor callbacks or move tabs
  // between groups after the fact: those repairs caused the third-column
  // regression and can trigger recursive open events.
  // Real-Chromium acceptance only: exercise multiple visualizable Source tabs
  // followed by ordinary Python/YAML Source documents in the same editor group.
  // The command is deliberately not contributed to the user command palette.
  // Real-Chromium acceptance opens the exact Example Python Source file
  // directly, independent of Quick Open focus or Compiler Output ownership.
  context.subscriptions.push(vscode.commands.registerCommand(
    "skillStudio.internal.openPythonSyntaxAcceptance",async()=>{
      const folders=vscode.workspace.workspaceFolders??[];
      if(folders.length!==1)throw Error("Python syntax probe needs one Example workspace");
      const fixtureRoot=vscode.Uri.joinPath(context.globalStorageUri,"browser-acceptance");
      const uri=vscode.Uri.joinPath(fixtureRoot,"validate-subscription-request.py");
      await vscode.workspace.fs.createDirectory(fixtureRoot);
      await vscode.workspace.fs.writeFile(uri,new TextEncoder().encode(
        "# Native Python syntax acceptance\ndef validate(value: int) -> bool:\n    return value == 1\n"));
      const doc=await openTextDocumentWithRetry(vscode,uri);
      const editor=await vscode.window.showTextDocument(doc,{
        viewColumn:vscode.ViewColumn.One,preserveFocus:false,preview:false
      });
      return {uri:doc.uri.toString(),languageId:doc.languageId,
        viewColumn:editor.viewColumn};
    }
  ));
  context.subscriptions.push(vscode.commands.registerCommand(
    "skillStudio.internal.editorGroupAcceptance",async()=>{
      const discoveredProcedures=await vscode.workspace.findFiles(
        "**/assurance/procedure.yaml","**/node_modules/**",20);
      if(discoveredProcedures.length<1)throw Error("No real Skill Procedure files found for editor-group acceptance");
      // The Example contains both the baseline 5GC Skill and its MAS
      // adaptation. Keep the editor-group baseline deterministic instead of
      // relying on filesystem enumeration order.
      const baseline=discoveredProcedures.find(uri=>
        /\/skills\/establish-pdu-session-mas\/assurance\/procedure\.yaml$/i.test(uri.path));
      const procedures=baseline
        ? [baseline,...discoveredProcedures.filter(uri=>uri.toString()!==baseline.toString())
            .sort((a,b)=>a.path.localeCompare(b.path))]
        : [...discoveredProcedures].sort((a,b)=>a.path.localeCompare(b.path));
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
      for(const uri of firstPackageVisuals)await openNativeSource(vscode,uri,{viewColumn:vscode.ViewColumn.One,preserveFocus:false,preview:false});
      const python=await vscode.commands.executeCommand("skillStudio.internal.openPythonSyntaxAcceptance");
      const waitForPrimary=async uri=>{
        const started=Date.now();
        while(Date.now()-started<3000){
          const editor=(vscode.window.visibleTextEditors??[]).find(item=>
            item.document.uri.toString()===uri.toString());
          if(editor?.viewColumn===vscode.ViewColumn.One)return editor;
          await new Promise(resolve=>setTimeout(resolve,25));
        }
        throw Error("Source-only editor did not open in the primary group: "+uri.toString());
      };
      const pythonColumn=(await waitForPrimary(vscode.Uri.parse(python.uri))).viewColumn;
      // Use a saved, temporary ordinary YAML file rather than an Untitled
      // buffer so the acceptance cleanup never opens an unsaved-changes dialog.
      const projectRoot=firstRoot.with({
        path:firstRoot.path.replace(/\/skills\/[^/]+$/,"")
      });
      const yamlUri=projectRoot.with({path:projectRoot.path+"/.studio-editor-group-acceptance.yaml"});
      await vscode.workspace.fs.writeFile(yamlUri,
        new TextEncoder().encode("kind: editor-group-acceptance\\n"));
      const yamlDocument=await openTextDocumentWithRetry(vscode,yamlUri);
      if(yamlDocument.isDirty&&!await yamlDocument.save())
        throw Error("Temporary YAML fixture could not be saved");
      if(yamlDocument.isDirty)
        throw Error("Temporary YAML fixture remained dirty after save");
      await vscode.window.showTextDocument(yamlDocument,{
        viewColumn:vscode.ViewColumn.One,preserveFocus:false,preview:false
      });
      const ordinaryYamlColumn=(await waitForPrimary(yamlDocument.uri)).viewColumn;
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
      await vscode.workspace.fs.delete(yamlUri);
      // Opening a second Skill's Source must not create another EditorGroup.
      const secondProcedure=procedures.find(uri=>
        !uri.path.startsWith(firstRoot.path+"/"));
      if(secondProcedure)await openNativeSource(vscode,secondProcedure,{viewColumn:vscode.ViewColumn.One,preserveFocus:false,preview:false});
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
  // One-time, non-destructive upgrade for an already-open Example from an
  // earlier Studio. Never mutate another workspace or existing user settings.
  // This runs after extension providers are registered, before navigation.
  void ensureOpenedExampleDependencies(vscode,context.extensionUri,
    context.globalStorageUri,{
      recoveryResult:replacementRecoveryResult,recoveryError:replacementRecoveryError
    }).then(async result=>{
      if(result.status==="SEEDED"){
        console.log("STUDIO_EXAMPLE_INTERFACE_MIGRATED",JSON.stringify(result));
        workbench?.invalidateDependencyAnalysis?.();
        try{await vscode.commands.executeCommand("skillStudio.refreshDependencies");}
        catch{/* The lock is already durable; the next Explorer read verifies it. */}
      }
      // Startup recovery may have unblocked an Example after the initial
      // Package Explorer refresh was intentionally held in RECOVERY_REQUIRED.
      await packageOverview?.refresh?.();
    },error=>{
      console.warn("STUDIO_EXAMPLE_INTERFACE_MIGRATION_BLOCKED",String(error?.message??error));
    });
  // Welcome was registered first so it remains available after optional failures.
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
        editor:"native-source",preview:"skillStudio.preview"
      }));
      const detail=progressZh
        ?((pending.replacedExisting?"已替换原有 Example 内容。":"")+
          "导入当前 CA-SL Skill 文件 "+pending.candidateFiles+" 个。")
        :((pending.replacedExisting?"Replaced the previous Example contents. ":"")+
          "Imported "+pending.candidateFiles+" current CA-SL Skill files.");
      const message=progressZh
        ?("示例项目已载入并打开工作区：skill-studio-demo/。默认已打开 CA-SL current Procedure（DRAFT / NOT_QUALIFIED）。"+detail)
        :("Example project opened: skill-studio-demo/. The CA-SL current Procedure is open (DRAFT / NOT_QUALIFIED). "+detail);
      void vscode.window.showInformationMessage(message);
    }
  }).catch(error=>{
    recordActivationFailure("Pending Example restore",error);
    void vscode.window.showErrorMessage(
      "SKILL Studio could not finish opening the Example Procedure: "+
      String(error?.message??error));
  });
  return {};
  }catch(error){
    recordActivationFailure("Remaining Workbench Contributions",error);
    return {};
  }

}
export function deactivate(){}
