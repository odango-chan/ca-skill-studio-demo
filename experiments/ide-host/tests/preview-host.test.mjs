import test from "node:test";
import assert from "node:assert/strict";
import {
  PREVIEW_VIEW_ID,previewDocumentKind,previewEmptyHtml,createPreviewHostController,registerPreviewHost
} from "../vscode/src/preview-host.mjs";

const doc=(path,version=1)=>({uri:{path,toString(){return "file://"+path;}},version});
const makeView=()=>{
  const calls={html:[],options:[]},visibilityListeners=[];
  const webview={};
  Object.defineProperty(webview,"html",{set(v){calls.html.push(v);},get(){return calls.html.at(-1);}});
  Object.defineProperty(webview,"options",{set(v){calls.options.push(v);},get(){return calls.options.at(-1);}});
  return {visible:true,webview,calls,
    setVisible(value){this.visible=value;for(const listener of visibilityListeners)listener();},
    onDidDispose(){return {dispose(){}};},
    onDidChangeVisibility(listener){visibilityListeners.push(listener);return {dispose(){}};}};
};

test("one stable preview identity maps all supported source kinds",()=>{
  assert.equal(PREVIEW_VIEW_ID,"skillStudio.preview");
  assert.equal(previewDocumentKind(doc("/skills/example/assurance/procedure.yaml").uri),"procedure");
  assert.equal(previewDocumentKind(doc("/skills/example/assurance/contract.yaml").uri),
    "skillStudio.contractPreview");
  assert.equal(previewDocumentKind(doc("/skills/example/assurance/predicates.yaml").uri),
    "skillStudio.predicatePreview");
  assert.equal(previewDocumentKind(doc("/skills/example/schemas/args.schema.yaml").uri),
    "skillStudio.schemaPreview");
  assert.equal(previewDocumentKind(doc("/skills/example/SKILL.md").uri),"markdown");
  assert.equal(previewDocumentKind(doc("/notes/example.markdown").uri),"markdown");
  assert.equal(previewDocumentKind(doc("/scripts/do.py").uri),"none");
});

test("safe empty view never interpolates a document filename",()=>{
  const html=previewEmptyHtml("<img src=x onerror=alert(1)>");
  assert.ok(html.includes("default-src 'none'"));
  assert.ok(html.includes("img-src 'none'"));
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes("script src"));
});

test("Procedure session reuses the same WebviewView and disposes on active file switch",()=>{
  const mounted=[],disposed=[];
  const controller=createPreviewHostController({mountProcedure(document,panel,options){
    mounted.push({uri:document.uri.toString(),panel,options});
    return {dispose(){disposed.push(document.uri.toString());}};
  }});
  const view=makeView();
  const procedure=doc("/skills/demo/assurance/procedure.yaml");
  controller.resolve(view,procedure);
  assert.equal(mounted.length,1);
  assert.equal(mounted[0].panel.webview,view.webview);
  assert.equal(mounted[0].panel.visible,true);
  assert.equal(mounted[0].options.forgetPairOnDispose,false);
  assert.equal(mounted[0].options.isCurrent(),true);
  assert.equal(controller.update(procedure),false,"same URI must not recreate a session");
  assert.equal(mounted.length,1);
  const other=doc("/scripts/validate.py");
  assert.equal(controller.update(other),true);
  assert.deepEqual(disposed,[procedure.uri.toString()]);
  assert.equal(mounted[0].options.isCurrent(),false);
  assert.equal(controller.state.kind,"none");
  assert.equal(view.calls.html.length,1);
  assert.equal(controller.update(procedure),true);
  assert.equal(mounted.length,2);
  controller.dispose();
  assert.deepEqual(disposed,[procedure.uri.toString(),procedure.uri.toString()]);
});

// Browser-only mode-roundtrip acceptance is supplied by stacked base PR #291;
// this focused test isolates Preview session invalidation on the null-document transition.
test("resolving a live Preview with no active document invalidates and disposes the old session",()=>{
  const sessions=[];
  const controller=createPreviewHostController({mountProcedure(document,_,options){
    const session={document,options,disposed:false,dispose(){this.disposed=true;}};
    sessions.push(session);return session;
  }});
  const view=makeView(),procedure=doc("/skills/demo/assurance/procedure.yaml");
  controller.resolve(view,procedure);
  const old=sessions[0],generation=controller.state.generation;
  assert.equal(old.options.isCurrent(),true);

  controller.resolve(view,null);

  assert.equal(old.disposed,true);
  assert.equal(old.options.isCurrent(),false,"queued messages from the old Source must be stale");
  assert.equal(controller.state.uri,null);
  assert.equal(controller.state.kind,null);
  assert.ok(controller.state.generation>generation);
  assert.equal(controller.state.attached,true);
  assert.equal(view.webview.options.enableScripts,false);
  assert.equal(view.webview.html,previewEmptyHtml("none"));
  controller.dispose();
});

test("disposed and replaced Preview WebviewViews cannot retain old Source sessions",()=>{
  const sessions=[];
  const controller=createPreviewHostController({mountProcedure(doc,_,options){
    const session={uri:doc.uri.toString(),options,disposed:false,dispose(){this.disposed=true;}};
    sessions.push(session);return session;
  }});
  const first=makeView(),second=makeView(),procedure=doc("/assurance/procedure.yaml");
  controller.resolve(first,procedure);
  controller.resolve(second,procedure);
  assert.equal(sessions[0].disposed,true);
  assert.equal(sessions[0].options.isCurrent(),false);
  assert.equal(sessions[1].disposed,false);
  controller.disposeView(first);
  assert.equal(sessions[1].disposed,false,"late disposal of former view must not remove current session");
  controller.disposeView(second);
  assert.equal(sessions[1].disposed,true);
  assert.equal(controller.state.attached,false);
});

test("Markdown Source activates native language features without opening the native Preview CustomEditor",async()=>{
  let activeListener=null,activationCount=0,markdownMounts=0,markdownActive=false;
  const calls=[],context={subscriptions:[]};
  const extension={
    get isActive(){return markdownActive;},
    async activate(){activationCount++;markdownActive=true;return {};}
  };
  const vscode={
    env:{uriScheme:"theia"},
    extensions:{getExtension(id){
      assert.equal(id,"vscode.markdown-language-features");return extension;
    }},
    commands:{executeCommand:async id=>{calls.push(id);return true;}},
    window:{
      activeTextEditor:null,
      registerWebviewViewProvider(id,provider){
        assert.equal(id,PREVIEW_VIEW_ID);return {dispose(){}};
      },
      onDidChangeActiveTextEditor(listener){activeListener=listener;return {dispose(){}};}
    }
  };
  const controller=registerPreviewHost(vscode,context,{
    mountMarkdown(document){
      markdownMounts++;
      return {dispose(){}};
    }
  });
  const view=makeView();
  view.onDidDispose=()=>({dispose(){}});
  const providerRegistration=context.subscriptions.find(item=>item&&typeof item.dispose==="function");
  assert.ok(providerRegistration);
  const markdown=doc("/skills/demo/SKILL.md");
  activeListener({document:markdown});
  await Promise.resolve();await Promise.resolve();await Promise.resolve();
  assert.equal(activationCount,1,
    "the Markdown language extension is explicitly activated after Source selection");
  assert.equal(markdownMounts,0,
    "the shared Preview is mounted only after its WebviewView resolves");
  controller.resolve(view,markdown);
  assert.equal(markdownMounts,1);
  activeListener({document:doc("/skills/demo/references/guide.md")});
  await Promise.resolve();await Promise.resolve();
  assert.equal(activationCount,1,"subsequent Markdown Source files reuse the active language extension");
  assert.equal(markdownMounts,2);
  assert.deepEqual(calls,[],
    "Markdown activation must not invoke vscode.openWith or native Markdown Preview commands");
  controller.dispose();
});

test("first visual Source reveals Preview, then the user's hidden preference is respected",async()=>{
  const calls=[],sessions=[],stored=new Map();
  let provider=null,activeListener=null;
  const context={subscriptions:[],globalState:{
    get(key){return stored.get(key);},
    update(key,value){stored.set(key,value);return Promise.resolve();}
  }};
  const vscode={
    commands:{executeCommand:async id=>{calls.push(id);return true;}},
    window:{
      activeTextEditor:{document:doc("/skills/demo/assurance/procedure.yaml")},
      registerWebviewViewProvider(id,value){
        assert.equal(id,PREVIEW_VIEW_ID);provider=value;return {dispose(){}};
      },
      onDidChangeActiveTextEditor(listener){activeListener=listener;return {dispose(){}};}
    }
  };
  const controller=registerPreviewHost(vscode,context,{
    mountProcedure(document,panel,options){
      const session={document,panel,options,disposed:false,dispose(){this.disposed=true;}};
      sessions.push(session);return session;
    }
  });
  await Promise.resolve();await Promise.resolve();
  assert.equal(calls.filter(x=>x==="workbench.view.extension.skillStudioPreview").length,1,
    "the default Preview container is revealed for the first visual Source");
  assert.ok(provider);
  const view=makeView();
  provider.resolveWebviewView(view);
  assert.equal(sessions.length,1);
  assert.equal(controller.state.visible,true);
  assert.equal(controller.state.kind,"procedure");
  assert.equal(sessions[0].panel.webview,view.webview);
  assert.equal(sessions[0].options.isCurrent(),true);
  assert.equal(stored.get("skillStudio.preview.visible"),true);

  view.setVisible(false);
  assert.equal(stored.get("skillStudio.preview.visible"),false,
    "a deliberate hide is persisted");
  activeListener({document:doc("/skills/demo/assurance/contract.yaml")});
  await Promise.resolve();await Promise.resolve();
  assert.equal(calls.filter(x=>x==="workbench.view.extension.skillStudioPreview").length,1,
    "switching to another visual Source must not undo the user's hide choice");

  // A manual reopen from the native View menu is observed and persisted.
  view.setVisible(true);
  assert.equal(stored.get("skillStudio.preview.visible"),true);
  view.setVisible(false);
  activeListener({document:doc("/skills/demo/assurance/predicates.yaml")});
  await Promise.resolve();await Promise.resolve();
  assert.equal(calls.filter(x=>x==="workbench.view.extension.skillStudioPreview").length,1);
  controller.dispose();
});

test("a persisted hidden Preview is not auto-opened on extension activation",async()=>{
  const calls=[],stored=new Map([["skillStudio.preview.visible",false]]);
  const context={subscriptions:[],globalState:{
    get(key){return stored.get(key);},
    update(key,value){stored.set(key,value);return Promise.resolve();}
  }};
  const vscode={
    commands:{executeCommand:async id=>{calls.push(id);return true;}},
    window:{
      activeTextEditor:{document:doc("/skills/demo/assurance/procedure.yaml")},
      registerWebviewViewProvider(){return {dispose(){}};},
      onDidChangeActiveTextEditor(){return {dispose(){}};}
    }
  };
  const controller=registerPreviewHost(vscode,context,{mountProcedure(){}});
  await Promise.resolve();await Promise.resolve();
  assert.deepEqual(calls,[],
    "the host must respect the persisted hidden preference on reload");
  controller.dispose();
});

test("explicit YAML Designer opens the nested Preview without using a CustomEditor",async()=>{
  let openView=0,provider=null,show=null;
  const source=doc("/skills/demo/assurance/contract.yaml");
  const view=makeView();
  const context={subscriptions:[],globalState:{
    get(){return false;},update(){return Promise.resolve();}
  }};
  const vscode={
    env:{uriScheme:"theia"},
    Uri:{parse(value){return doc(new URL(value).pathname).uri;}},
    workspace:{async openTextDocument(uri){return {uri};}},
    commands:{
      registerCommand(id,listener){if(id==="skillStudio.showPreview")show=listener;
        return {dispose(){}};},
      async executeCommand(id){
        assert.equal(id,"skillStudio.preview.open");
        openView++;
        provider.resolveWebviewView(view);
      }
    },
    window:{
      activeTextEditor:null,
      registerWebviewViewProvider(id,p){assert.equal(id,PREVIEW_VIEW_ID);
        provider=p;return {dispose(){}};},
      onDidChangeActiveTextEditor(){return {dispose(){}};}
    }
  };
  let rendered=0;
  const ctrl=registerPreviewHost(vscode,context,{
    mountContract(document){
      assert.equal(document.uri.toString(),source.uri.toString());
      rendered++;
      return {dispose(){}};
    }
  });
  assert.equal(typeof show,"function");
  assert.equal(await show(source.uri),true);
  assert.equal(openView,1);
  assert.equal(rendered,1);
  assert.equal(ctrl.state.kind,"skillStudio.contractPreview");
  assert.equal(await show(doc("/random/unrelated.yaml").uri),false);
  assert.equal(openView,1,"unsupported YAML must remain Source-only");
  ctrl.dispose();
});
