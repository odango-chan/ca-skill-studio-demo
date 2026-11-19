import test from "node:test";
import assert from "node:assert/strict";
import {
  PREVIEW_VIEW_ID,previewDocumentKind,previewEmptyHtml,createPreviewHostController,registerPreviewHost
} from "../vscode/src/preview-host.mjs";

const doc=(path,version=1)=>({uri:{path,toString(){return "file://"+path;}},version});
const makeView=()=>{
  const calls={html:[],options:[]};
  const webview={};
  Object.defineProperty(webview,"html",{set(v){calls.html.push(v);},get(){return calls.html.at(-1);}});
  Object.defineProperty(webview,"options",{set(v){calls.options.push(v);},get(){return calls.options.at(-1);}});
  return {visible:true,webview,calls,onDidDispose(){return {dispose(){}};},
    onDidChangeVisibility(){return {dispose(){}};}};
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

test("active visual Source reveals the collapsed right Inspector and mounts the Preview View",async()=>{
  const calls=[],sessions=[];
  let provider=null,activeListener=null;
  const context={subscriptions:[]};
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
  assert.ok(calls.includes("workbench.view.extension.skillStudioInspector"),
    "the hidden secondary sidebar must be revealed for the initial Procedure");
  assert.ok(provider);
  const view=makeView();
  view.onDidDispose=()=>({dispose(){}});
  provider.resolveWebviewView(view);
  assert.equal(sessions.length,1);
  assert.equal(controller.state.visible,true);
  assert.equal(controller.state.kind,"procedure");
  assert.equal(sessions[0].panel.webview,view.webview);
  assert.equal(sessions[0].options.isCurrent(),true);
  activeListener(null);
  assert.equal(controller.state.kind,"procedure","focus transfer must retain the active Source");
  activeListener({document:doc("/skills/demo/scripts/check.py")});
  assert.equal(controller.state.kind,"none");
  assert.equal(sessions[0].disposed,true);
  view.visible=false;
  activeListener({document:doc("/skills/demo/assurance/contract.yaml")});
  await Promise.resolve();await Promise.resolve();
  assert.ok(calls.filter(x=>x==="workbench.view.extension.skillStudioInspector").length>=2,
    "opening a visual Source after the right container was hidden must reveal it again");
  controller.dispose();
});
