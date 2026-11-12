import * as vscode from "vscode";

/**
 * Experimental adapter over Theia 1.76's supported VS Code Markdown extension.
 * Markdown source remains a native TextDocument; rendering, preview security,
 * incremental updates and bidirectional scroll synchronization are owned by
 * vscode.markdown-language-features.
 */
export function registerNativeMarkdown(vscodeApi,context){
  const layouts=new Map();
  const opening=new Set();
  let lastAutoOpenedUri=null;

  async function openPreview(uri,layout="side"){
    uri=uri??vscodeApi.window.activeTextEditor?.document.uri;
    if(!uri||!uri.path?.toLowerCase().endsWith(".md"))return false;
    const key=uri.toString();
    if(opening.has(key))return false;
    opening.add(key);
    try{
      const document=await vscodeApi.workspace.openTextDocument(uri);
      await vscodeApi.window.showTextDocument(document,{
        viewColumn:vscodeApi.ViewColumn.One,
        preview:false,
        preserveFocus:false
      });
      const command=layout==="side"
        ?"markdown.showPreviewToSide"
        :"markdown.showPreview";
      await vscodeApi.commands.executeCommand(command);
      layouts.set(key,layout);
      lastAutoOpenedUri=key;
      return {uri:key,layout,command};
    }finally{
      opening.delete(key);
    }
  }

  context.subscriptions.push(vscodeApi.commands.registerCommand(
    "skillStudio.previewMarkdown",uri=>openPreview(uri,"side")
  ));
  context.subscriptions.push(vscodeApi.commands.registerCommand(
    "skillStudio.toggleMarkdownLayout",async uri=>{
      const target=uri??vscodeApi.window.activeTextEditor?.document.uri;
      if(!target||!target.path?.toLowerCase().endsWith(".md"))return false;
      const key=target.toString();
      const next=layouts.get(key)==="side"?"inline":"side";
      return openPreview(target,next);
    }
  ));
  context.subscriptions.push(vscodeApi.commands.registerCommand(
    "skillStudio.internal.markdownNativeAcceptance",async uri=>{
      const target=uri??vscodeApi.window.activeTextEditor?.document.uri;
      const result=await openPreview(target,"side");
      if(!result)throw Error("Native Markdown preview did not open");
      return {...result,sourceColumn:vscodeApi.ViewColumn.One,
        previewOwner:"vscode.markdown-language-features"};
    }
  ));

  // Opening a Markdown file from Explorer creates the paired native preview.
  // Re-opening the same source does not create duplicate preview panels.
  context.subscriptions.push(vscodeApi.window.onDidChangeActiveTextEditor(editor=>{
    const target=editor?.document?.uri;
    if(!target)return;
    if(!target.path.toLowerCase().endsWith(".md")){
      lastAutoOpenedUri=null;
      return;
    }
    const key=target.toString();
    if(key===lastAutoOpenedUri||opening.has(key))return;
    setTimeout(()=>{
      if(vscodeApi.window.activeTextEditor?.document.uri.toString()!==key||
         opening.has(key)||lastAutoOpenedUri===key)return;
      void openPreview(target,"side").catch(error=>{
        void vscodeApi.window.showWarningMessage(
          "Native Markdown Preview could not open: "+String(error?.message??error)
        );
      });
    },0);
  }));
}
