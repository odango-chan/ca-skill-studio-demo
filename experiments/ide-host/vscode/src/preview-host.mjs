import {sourceViewType} from "./source-view-pair.mjs";

export const PREVIEW_VIEW_ID = "skillStudio.preview";

const labels = Object.freeze({
  "skillStudio.contractPreview": "Contract",
  "skillStudio.predicatePreview": "Predicates",
  "skillStudio.schemaPreview": "Schema",
  "markdown": "Markdown"
});

export function previewDocumentKind(uri) {
  if (!uri || typeof uri.path !== "string") return "none";
  const pair=sourceViewType(uri);
  if(pair==="skillStudio.procedurePreview")return "procedure";
  if(pair)return pair;
  if(/\.(md|markdown)$/i.test(uri.path))return "markdown";
  return "none";
}

// All dynamic file names appear as text, not HTML. No untrusted Source ever
// enters the placeholder DOM; only the Procedure viewer owns executable JS.
export function previewEmptyHtml(kind) {
  const known=Object.hasOwn(labels,kind);
  const title=known ? labels[kind] : "Preview";
  const message=known
    ? "This visualizer has not yet migrated into the unified Preview Host."
    : "Open a Skill Studio source file to see its preview here.";
  return `<!doctype html><html><head><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none';">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>body{font:13px system-ui,sans-serif;background:var(--vscode-sideBar-background);
      color:var(--vscode-foreground);padding:16px;margin:0}
      h2{font-size:15px;margin:0 0 8px}
      p{opacity:.7;line-height:1.5}</style></head>
    <body><h2>${title}</h2><p>${message}</p></body></html>`;
}

export function createPreviewHostController({mountProcedure,mountContract,mountPredicate,mountSchema}) {
  let view=null,activeSession=null,activeUri=null,activeKind=null,closed=false,generation=0;
  const clear=()=>{
    const former=activeSession;
    activeSession=null;
    activeUri=null;
    activeKind=null;
    // Discard old subscriptions before replacing HTML: a Webview may deliver
    // queued messages even after the next document has become active.
    former?.dispose?.();
  };
  const update=(document)=>{
    if(!view||closed||!document?.uri)return false;
    const uri=document.uri.toString(),kind=previewDocumentKind(document.uri);
    if(uri===activeUri&&kind===activeKind)return false;
    clear();
    const selectedGeneration=++generation;
    activeUri=uri;activeKind=kind;
    const mountForKind={
      procedure:mountProcedure,
      "skillStudio.contractPreview":mountContract,
      "skillStudio.predicatePreview":mountPredicate,
      "skillStudio.schemaPreview":mountSchema
    }[kind];
    if(!mountForKind){
      view.webview.options={enableScripts:false};
      view.webview.html=previewEmptyHtml(kind);
      return true;
    }
    // The WebviewView is an independent right-sidebar view, not an Editor tab.
    // Adapt only the minimal lifecycle required by the existing Procedure UI.
    const currentView=view;
    const panel={
      webview:currentView.webview,
      get active(){return currentView.visible;},
      get visible(){return currentView.visible;},
      onDidChangeViewState:listener=>currentView.onDidChangeVisibility(listener),
      onDidDispose:listener=>currentView.onDidDispose(listener)
    };
    try{
      const session=mountForKind(document,panel,{
        forgetPairOnDispose:false,
        isCurrent:()=>!closed&&generation===selectedGeneration&&view===currentView&&
          activeUri===uri
      });
      if(!closed&&view===currentView&&generation===selectedGeneration)activeSession=session;
      else session?.dispose?.();
    }catch(error){
      clear();
      view.webview.options={enableScripts:false};
      view.webview.html=previewEmptyHtml("none");
      throw error;
    }
    return true;
  };
  return {
    resolve(nextView,activeDocument){
      if(closed)return;
      if(view&&view!==nextView)clear();
      view=nextView;
      if(activeDocument)update(activeDocument);
      else{
        view.webview.options={enableScripts:false};
        view.webview.html=previewEmptyHtml("none");
      }
    },
    update,
    disposeView(disposedView){
      if(view!==disposedView)return;
      ++generation;clear();view=null;
    },
    dispose(){
      if(closed)return;
      closed=true;++generation;clear();view=null;
    },
    get state(){return {uri:activeUri,kind:activeKind,generation,attached:!!view};}
  };
}

export function registerPreviewHost(vscode,context,renderers) {
  const controller=createPreviewHostController(renderers);
  // A non-Theia/older VS Code-compatible host may not expose WebviewView.
  // Preserve native Source/CustomEditor behavior rather than blocking startup.
  if(typeof vscode.window.registerWebviewViewProvider!=="function"){
    console.warn("SKILL Studio Preview Host unavailable: WebviewViewProvider API missing");
    context.subscriptions.push({dispose:()=>controller.dispose()});
    return controller;
  }
  const subscription=vscode.window.registerWebviewViewProvider(PREVIEW_VIEW_ID,{
    resolveWebviewView(view){
      controller.resolve(view,vscode.window.activeTextEditor?.document??null);
      // Theia can recreate a view after it has been closed. Do not register
      // process-global Webview subscriptions or survive a disposed instance.
      const release=view.onDidDispose(()=>{controller.disposeView(view);release.dispose();});
    }
  },{webviewOptions:{retainContextWhenHidden:true}});
  const active=vscode.window.onDidChangeActiveTextEditor(editor=>{
    // The active text editor can momentarily be null while focus transfers to
    // a sidebar view. Keep the last Source document rather than clearing it.
    if(editor?.document)controller.update(editor.document);
  });
  context.subscriptions.push(subscription,active,{dispose:()=>controller.dispose()});
  return controller;
}
