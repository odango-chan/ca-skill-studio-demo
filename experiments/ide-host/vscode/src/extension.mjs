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
import {isProcedurePath,validateRouteProposal,MAX_SOURCE_BYTES} from "./bridge.mjs";
import {seedExampleWorkspace} from "./sample-loader.mjs";

const VIEW="skillStudio.procedurePreview";
function escaped(value){
  return String(value).replace(/[&<>"']/g,ch=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[ch]));
}
export function activate(context){
  const provider={
    async resolveCustomTextEditor(document,panel){
      if(!isProcedurePath(document.uri.path)){
        vscode.window.showWarningMessage("Only assurance/procedure.yaml is supported in this spike");
        return;
      }
      const webview=panel.webview;
      const media=vscode.Uri.joinPath(context.extensionUri,"media");
      webview.options={enableScripts:true,localResourceRoots:[media]};
      const nonce=newNonce();
      const script=webview.asWebviewUri(vscode.Uri.joinPath(media,"procedure.js"));
      const style=webview.asWebviewUri(vscode.Uri.joinPath(media,"procedure.css"));
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
          <span id="revision"></span></div>
          <div id="message" role="status">等待当前文档…</div>
          <div class="graph-pane spike-pane"><div id="reactFlowRoot" class="spike-flow"></div></div>
          <div id="patch" class="spike-patch" hidden>
            <strong>现有 Route 的 Source-backed Patch 预览</strong>
            <label>Route <select id="routeList"></select></label>
            <label>新目标 <select id="targetList"></select></label>
            <button id="preview">生成 Diff</button>
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
        if(message.type==="ready"){ready=true;push();return;}
        if(message.type==="openSource"){
          await vscode.window.showTextDocument(document,{viewColumn:vscode.ViewColumn.Beside,
            preserveFocus:false,preview:false});
          return;
        }
        if(message.type!=="applyRoute")return;
        try{
          const source=document.getText();
          const edit=validateRouteProposal(source,document.version,message);
          // A single scalar replacement: native TextDocument owns undo/redo,
          // save, backup and external file changes. No second editor buffer.
          const patch=new vscode.WorkspaceEdit();
          patch.replace(document.uri,new vscode.Range(
            document.positionAt(edit.start),document.positionAt(edit.end)),edit.newTarget);
          const applied=await vscode.workspace.applyEdit(patch);
          if(!applied)throw Error("Host rejected WorkspaceEdit");
          void webview.postMessage({type:"applied",routeId:edit.routeId});
        }catch(error){
          void webview.postMessage({type:"error",message:String(error?.message??error)});
          push();
        }
      });
      panel.onDidDispose(()=>{
        disposed=true;changed.dispose();incoming.dispose();
      });
    }
  };
  context.subscriptions.push(vscode.window.registerCustomEditorProvider(VIEW,provider,{
    webviewOptions:{retainContextWhenHidden:false}
  }));
  context.subscriptions.push(vscode.commands.registerCommand("skillStudio.loadExample",
    async()=>{
      try{
        const result=await seedExampleWorkspace(vscode,context.extensionUri);
        await vscode.window.showInformationMessage(
          "示例 SKILL 已载入浏览器工作区："+result.created+" 新文件，"+
          result.skipped+" 个已存在文件保持不变");
        await vscode.commands.executeCommand("vscode.openWith",result.procedure,VIEW);
      }catch(error){
        await vscode.window.showErrorMessage(
          "SKILL 示例载入失败："+String(error?.message??error));
      }
    }));
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
