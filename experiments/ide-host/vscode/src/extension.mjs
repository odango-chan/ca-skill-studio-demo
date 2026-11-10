import {openNativeSource} from "./native-source.mjs";
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
import {seedExampleWorkspace} from "./sample-loader.mjs";

import {registerWorkbench} from "./workbench.mjs";
import {iconShapes} from "../../../../site/icons.mjs";
const VIEW="skillStudio.procedurePreview";
// Theia's browser-only static build can omit its Pages subpath when creating
// webview resource URLs. Restrict the workaround to the same-origin static
// plugin worker; normal VS Code and backend-backed Theia retain host URIs.
function staticPreviewResourceUrl(uri,extensionUri){
  const value=uri.toString();
  const path=globalThis.location?.pathname??"";
  if(!path.endsWith("/plugin-worker.js")||
     (extensionUri.scheme!=="http"&&extensionUri.scheme!=="https"))
    return value;
  const base=path.slice(0,-"/plugin-worker.js".length);
  if(!base)return value;
  try{
    const origin=globalThis.location.origin;
    const parsed=new URL(value,origin);
    if(parsed.origin!==origin||!parsed.pathname.startsWith("/hostedPlugin/"))
      return value;
    return base+parsed.pathname+parsed.search+parsed.hash;
  }catch{return value;}
}
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
  const workbench=registerWorkbench(vscode,context);
  const provider={
    async resolveCustomTextEditor(document,panel){
      if(!isProcedurePath(document.uri.path)){
        vscode.window.showWarningMessage("Only assurance/procedure.yaml is supported in this spike");
        return;
      }
      const openedAt=performance.now();
      const webview=panel.webview;
      const detach=workbench.attach(document,message=>webview.postMessage(message));
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
                <button id="nodeFocusReturn" type="button" class="node-focus-back" title="返回流程图">${svgIcon("arrow-left")}<span>返回流程图</span></button>
                <div class="node-focus-heading">
                  <span class="node-focus-eyebrow">NODE · 局部流程图（真实 Route / 阶段顺序）</span>
                  <h2 id="nodeFocusTitle"></h2>
                  <p id="nodeFocusSubtitle"></p>
                </div>
              </header>
              <div class="node-focus-toolbar">
                <span id="nodeFocusStats"></span>
                <div id="nodeFocusChildren"></div>
                <button id="nodeFocusFit" type="button" class="node-focus-back" title="适配局部图">${svgIcon("maximize")}<span>适配局部图</span></button>
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
      let disposed=false,ready=false;
      const push=()=>{
        if(disposed||!ready)return;
        const text=document.getText();
        if(text.length>MAX_SOURCE_BYTES){
          void webview.postMessage({type:"error",message:"Source exceeds the 1 MiB spike limit"});
          return;
        }
        void webview.postMessage({type:"snapshot",text,version:document.version,
          path:document.uri.path});
      };
      const changed=vscode.workspace.onDidChangeTextDocument(event=>{
        if(event.document.uri.toString()===document.uri.toString())push();
      });
      const incoming=webview.onDidReceiveMessage(async message=>{
        if(disposed||typeof message!=="object"||!message)return;
        if(message.type==="selection"){if(panel.active)workbench.select(document,message);return;}
        if(message.type==="rendered"){
          if(message.version===document.version)console.log("STUDIO_OPEN_TIMING",JSON.stringify({version:document.version,hostToRenderMs:performance.now()-openedAt,projectionMs:message.projectionMs,layoutMs:message.layoutMs,cacheHit:message.cacheHit}));
          return;
        }
        if(message.type==="ready"){ready=true;push();return;}
        if(message.type==="exportPackageZip"){
          await vscode.commands.executeCommand("skillStudio.exportPackageZip");
          return;
        }
        if(message.type==="openSource"){
          await openNativeSource(vscode,document.uri,{viewColumn:vscode.ViewColumn.Beside,
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
            viewColumn:vscode.ViewColumn.Beside,preserveFocus:false,preview:false,
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
          const patch=new vscode.WorkspaceEdit();
          patch.replace(document.uri,new vscode.Range(
            document.positionAt(edit.start),document.positionAt(edit.end)),
            creating?edit.newText:edit.newTarget);
          const applied=await vscode.workspace.applyEdit(patch);
          if(!applied)throw Error("Host rejected WorkspaceEdit");
          void webview.postMessage({type:"applied",routeId:edit.routeId});
        }catch(error){
          void webview.postMessage({type:"error",message:String(error?.message??error)});
          push();
        }
      });
      panel.onDidDispose(()=>{
        disposed=true;detach();viewState.dispose();changed.dispose();incoming.dispose();
      });
    }
  };
  context.subscriptions.push(vscode.window.registerCustomEditorProvider(VIEW,provider,{
    webviewOptions:{retainContextWhenHidden:true}
  }));
  context.subscriptions.push(vscode.commands.registerCommand("skillStudio.loadExample",
    async()=>{
      let stage="seed-example";
      try{
        const result=await seedExampleWorkspace(vscode,context.extensionUri,context.globalStorageUri);
        stage="open-procedure";
        await vscode.commands.executeCommand("vscode.open",result.procedure);
        void vscode.window.showInformationMessage(
          "示例 SKILL 已载入浏览器工作区："+result.created+" 新文件，"+
          result.skipped+" 个已存在文件保持不变");
      }catch(error){
        await vscode.window.showErrorMessage(
          "SKILL 示例载入失败 ["+stage+"]："+String(error?.message??error));
      }
    }));
  // Make the first-run path discoverable without requiring users to know
  // the command palette. The Explorer welcome content and toolbar provide
  // persistent entry points; this one-time-per-empty-session prompt is a
  // convenient shortcut for the online demo.
  if(!(vscode.workspace.workspaceFolders??[]).length){
    const welcome=vscode.window.showInformationMessage?.(
      "欢迎使用 SKILL Studio。可以先载入内置演示 SKILL 项目体验编辑器。",
      "载入演示 SKILL 项目"
    );
    if(welcome&&typeof welcome.then==="function"){
      void welcome.then(choice=>{
        if(choice==="载入演示 SKILL 项目")
          return vscode.commands.executeCommand("skillStudio.loadExample");
        return undefined;
      });
    }
  }
  context.subscriptions.push(vscode.commands.registerCommand("skillStudio.openProcedure",
    async uri=>{
      let target=uri;
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
      await vscode.commands.executeCommand("vscode.openWith",target,VIEW);
    }));
}
export function deactivate(){}
