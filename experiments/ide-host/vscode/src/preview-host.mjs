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

export function createPreviewHostController({mountProcedure,mountContract,mountPredicate,mountSchema,mountMarkdown}) {
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
      "skillStudio.schemaPreview":mountSchema,
      "markdown":mountMarkdown
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
        // A null active document is a real Preview lifecycle transition. Invalidate
        // queued messages before disposing the previous renderer, then expose the
        // empty state with no retained Source identity.
        ++generation;
        clear();
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
    get state(){return {uri:activeUri,kind:activeKind,generation,
      attached:!!view,visible:!!view?.visible};}
  };
}

export function registerPreviewHost(vscode,context,renderers) {
  const controller=createPreviewHostController(renderers);
  // A non-Theia/older VS Code-compatible host may not expose WebviewView.
  // Preserve native Source editing rather than blocking startup.
  if(typeof vscode.window.registerWebviewViewProvider!=="function"){
    console.warn("SKILL Studio Preview Host unavailable: WebviewViewProvider API missing");
    context.subscriptions.push({dispose:()=>controller.dispose()});
    return controller;
  }
  // A contributed view with visibility=visible can still live inside a
  // collapsed Secondary Sidebar container. Reveal the container when the
  // first visualizable Source becomes active; otherwise the WebviewView never
  // resolves and the preview silently remains an inactive EditorGroup iframe.
  const containerCommand="workbench.view.extension.skillStudioPreview";
  const isTheiaHost=vscode.env?.uriScheme==="theia"||
    (typeof STUDIO_THEIA_HOST!=="undefined"&&STUDIO_THEIA_HOST);
  let lastDocument=vscode.window.activeTextEditor?.document??null;
  const visibilityKey="skillStudio.preview.visible";
  let previewVisibilityPreference;
  try{previewVisibilityPreference=context.globalState?.get(visibilityKey);}
  catch{previewVisibilityPreference=undefined;}
  let previewWasVisible=false;
  const persistPreviewVisibility=visible=>{
    previewVisibilityPreference=visible;
    try{
      const pending=context.globalState?.update?.(visibilityKey,visible);
      if(pending&&typeof pending.catch==="function")
        void pending.catch(error=>console.warn("SKILL Studio could not persist Preview visibility:",String(error)));
    }catch(error){
      console.warn("SKILL Studio could not persist Preview visibility:",String(error));
    }
  };
  let revealInFlight=null,markdownActivation=null;
  const activateMarkdownLanguageFeatures=()=>{
    const extension=vscode.extensions?.getExtension?.("vscode.markdown-language-features");
    if(!extension||extension.isActive)return Promise.resolve(Boolean(extension));
    if(markdownActivation)return markdownActivation;
    // Browser-only Theia removes onLanguage:markdown to prevent the built-in
    // extension racing the first-open lifecycle. Activate its language
    // features explicitly when Markdown Source becomes active; do not invoke
    // any of its Preview commands or CustomEditor providers.
    markdownActivation=Promise.resolve().then(()=>extension.activate())
      .then(()=>true)
      .catch(error=>{
        console.warn("SKILL Studio could not activate native Markdown language features:",
          String(error?.message??error));
        return false;
      })
      .finally(()=>{markdownActivation=null;});
    return markdownActivation;
  };
  const revealContainer=()=>{
    // Theia's generated view-container commands are not exposed to the plugin
    // host. Its native ApplicationShell contribution opens this container.
    if(isTheiaHost)return Promise.resolve();
    if(revealInFlight)return revealInFlight;
    revealInFlight=Promise.resolve(vscode.commands.executeCommand(containerCommand))
      .catch(error=>console.warn("SKILL Studio could not reveal Preview container:",
        String(error?.message??error)))
      .finally(()=>{revealInFlight=null;});
    return revealInFlight;
  };
  const subscription=vscode.window.registerWebviewViewProvider(PREVIEW_VIEW_ID,{
    resolveWebviewView(view){
      controller.resolve(view,lastDocument);
      const syncVisibility=()=>{
        if(view.visible){
          previewWasVisible=true;
          if(previewVisibilityPreference!==true)persistPreviewVisibility(true);
        }else if(previewWasVisible&&previewVisibilityPreference!==false){
          // Only record a hide after this view has actually been shown. A
          // provider resolved inside a collapsed container is not user intent.
          persistPreviewVisibility(false);
        }
      };
      if(view.visible)syncVisibility();
      const visibility=view.onDidChangeVisibility?.(syncVisibility);
      // Theia can recreate a view after it has been closed. Do not register
      // process-global Webview subscriptions or survive a disposed instance.
      const release=view.onDidDispose(()=>{
        visibility?.dispose?.();
        controller.disposeView(view);
        release.dispose();
      });
    }
  },{webviewOptions:{retainContextWhenHidden:true}});
  const active=vscode.window.onDidChangeActiveTextEditor(editor=>{
    // Focus can temporarily move away from Source when the Preview is revealed.
    // Retain the last document and ignore the transient null editor event.
    if(!editor?.document)return;
    lastDocument=editor.document;
    const kind=previewDocumentKind(lastDocument.uri);
    if(kind==="markdown")void activateMarkdownLanguageFeatures();
    controller.update(lastDocument);
    if(kind!=="none"&&!controller.state.visible&&previewVisibilityPreference!==false)
      void revealContainer();
  });
  // The extension may activate after the initial Source editor is already open.
  if(lastDocument){
    const kind=previewDocumentKind(lastDocument.uri);
    if(kind==="markdown")void activateMarkdownLanguageFeatures();
    if(kind!=="none"&&previewVisibilityPreference!==false)void revealContainer();
  }
  // Explorer commands must retain an explicit Designer entry after retiring
  // CustomEditors. Theia registers <view-id>.open for contributed WebviewViews,
  // so this command reveals the nested Preview without a new EditorGroup.
  const explicitPreview=vscode.commands.registerCommand?.("skillStudio.showPreview",async uri=>{
    const target=typeof uri==="string"?vscode.Uri.parse(uri):
      uri?.scheme&&uri?.path!==undefined
        ?vscode.Uri.from({scheme:uri.scheme,authority:uri.authority??"",
          path:uri.path,query:uri.query??"",fragment:uri.fragment??""})
        :uri;
    const document=target
      ?await vscode.workspace.openTextDocument(target)
      :vscode.window.activeTextEditor?.document??lastDocument;
    if(!document||previewDocumentKind(document.uri)==="none")return false;
    lastDocument=document;
    try{
      await vscode.commands.executeCommand(isTheiaHost
        ? PREVIEW_VIEW_ID+".open" : containerCommand);
      controller.update(document);
      return true;
    }catch(error){
      console.warn("SKILL Studio could not open contextual Preview:",String(error?.message??error));
      return false;
    }
  });
  context.subscriptions.push(subscription,active,...(explicitPreview?[explicitPreview]:[]),
    {dispose:()=>controller.dispose()});
  return controller;
}
