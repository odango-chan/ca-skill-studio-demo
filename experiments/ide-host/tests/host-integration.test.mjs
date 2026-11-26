// Contract-level VS Code host simulation. This is NOT a real desktop UI test.
// Exercise the actual bundled extension's provider/message/WorkspaceEdit wiring.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import Module from "node:module";
import {projectWorkspace} from "../../../site/workspace.mjs";
import {routeTargetChoices,previewTargetPatch} from "../vscode/src/route-target.mjs";
import {proposeCanvasRouteConnection,previewCanvasRouteConnection}
  from "../../../site/route-connect.mjs";

test("Bundled CustomTextEditor uses native document, guarded WorkspaceEdit and native Source",async()=>{
  const source=readFileSync("tests/fixtures/v1alpha5-conventional/establish-pdu-session/assurance/procedure.yaml","utf8");
  const makeUri=path=>({path,toString(){return "file://"+this.path;},with(change){return makeUri(change.path??this.path);}});
  const uri=makeUri("/workspace/assurance/procedure.yaml");
  const document={uri,text:source,version:21,
    getText(){return this.text;},
    get lineCount(){return this.text.split(/\r?\n/).length;},
    positionAt(offset){return {offset};}
  };
  const listeners=new Set(),commands=new Map(),posted=[],writes=[],opened=[],registered=[],revealed=[];
  let confirmChoice="确认并应用";
  const textEditor={document,viewColumn:1,selection:null,revealRange(range,kind){revealed.push({range,kind});}};
  let previewProvider=null,onMessage=null;
  class WorkspaceEdit{
    constructor(){this.changes=[];}
    replace(file,range,value){this.change={file,range,value};this.changes.push(this.change);}
  }
  class Range{constructor(start,end){this.start=start;this.end=end;}}
  class Position{constructor(line,character){this.line=line;this.character=character;}}
  class Selection{constructor(anchor,active){this.anchor=anchor;this.active=active;}}
  const fake={
    EventEmitter:class {event=()=>({dispose(){}});fire(){}dispose(){}},
    languages:{createDiagnosticCollection:()=>({dispose(){},clear(){},set(){}})},
    TreeItem:class {},TreeItemCollapsibleState:{None:0,Collapsed:1},
    ViewColumn:{One:1,Two:2,Beside:-2},
    Uri:{joinPath(base,...parts){return {path:base.path+"/"+parts.join("/")};}},
    Range,Position,Selection,WorkspaceEdit,
    TextEditorRevealType:{InCenter:1},
    workspace:{
      textDocuments:[document],
      workspaceFolders:[],
      async openTextDocument(){return document;},
      onDidChangeTextDocument(cb){listeners.add(cb);return {dispose(){listeners.delete(cb);}};},
      onDidChangeConfiguration(){return {dispose(){}};},
      onDidChangeWorkspaceFolders(){return {dispose(){}};},
      registerTextDocumentContentProvider(){return {dispose(){}};},
      getConfiguration(){return {get:(_key,fallback)=>fallback,update:async()=>{}};},
      async applyEdit(edit){
        const changes=edit.changes??[edit.change];
        for(const change of changes)assert.equal(change.file,document.uri);
        writes.push(...changes);
        for(const change of [...changes].sort((a,b)=>b.range.start.offset-a.range.start.offset))
          document.text=document.text.slice(0,change.range.start.offset)+change.value+
            document.text.slice(change.range.end.offset);
        document.version++;
        for(const callback of listeners)callback({document});
        return true;
      },
      fs:{readFile:async uri=>new TextEncoder().encode(readFileSync(
        uri.path.endsWith("/assurance/contract.yaml")
          ?"tests/fixtures/v1alpha5-conventional/establish-pdu-session/assurance/contract.yaml"
          :"tests/fixtures/v1alpha5-conventional/establish-pdu-session/assurance/predicates.yaml","utf8"))},
      findFiles:async()=>[uri],
      asRelativePath:file=>file.path
    },
    window:{
      createOutputChannel:()=>({appendLine(){},show(){},dispose(){}}),
      visibleTextEditors:[textEditor],
      registerTreeDataProvider:()=>({dispose(){}}),
      registerWebviewViewProvider:(id,provider,_options)=>{
        assert.equal(id,"skillStudio.preview");previewProvider=provider;return {dispose(){}};
      },
      onDidChangeActiveTextEditor:()=>({dispose(){}}),
      activeTextEditor:{document},
      showWarningMessage:()=>{},
      showInformationMessage:async()=>confirmChoice,
      showInputBox:async()=>"unused-node-value",
      showTextDocument:async(doc,opts)=>{opened.push({doc,opts});return textEditor;},
      showQuickPick:async items=>items[0]
    },
    commands:{
      registerCommand(name,cb){commands.set(name,cb);return{dispose(){}};},
      async executeCommand(...args){registered.push(args);if(args[0]==="vscode.openWith"&&args[2]==="default")opened.push({doc:document,opts:args[3]});}
    }
  };
  const original=Module._load;
  Module._load=function(request,parent,isMain){
    if(request==="vscode")return fake;
    return original.apply(this,arguments);
  };
  let activate;
  try{
    ({activate}=createRequire(import.meta.url)("../vscode/dist/extension.cjs"));
  }finally{
    Module._load=original;
  }
  const context={
    extensionUri:makeUri("/extension"),globalStorageUri:makeUri("/global-storage"),
    subscriptions:[],globalState:{get:()=>undefined,update:async()=>{}}
  };
  // Extension activation now awaits transaction recovery before registering providers.
  await activate(context);
  assert.ok(previewProvider);
  assert.ok(commands.has("skillStudio.openProcedure"));
  for(const retired of ["skillStudio.renameNode","skillStudio.editNodeOperatorValue",
    "skillStudio.insertNode","skillStudio.deleteNode"])
    assert.equal(commands.has(retired),false,
      "retired Procedure-AST command must not be exposed: "+retired);
  assert.ok(commands.has("skillStudio.exportPackageZip"));
  const webview={
    cspSource:"vscode-resource:",
    options:null,html:"",
    asWebviewUri:resource=>"vscode-resource:"+resource.path,
    postMessage:async data=>{posted.push(data);return true;},
    onDidReceiveMessage:cb=>{onMessage=cb;return{dispose(){}};}
  };
  const view={visible:true,webview,
    onDidChangeVisibility:()=>({dispose(){}}),
    onDidDispose:()=>({dispose(){}})};
  await previewProvider.resolveWebviewView(view);
  assert.match(webview.html,/Content-Security-Policy/);
  assert.ok(webview.html.includes("procedure.js"));
  assert.ok(webview.html.includes("procedure.css"));
  for(const id of ["exportPackageZip","zipExportNotice","zipExportDetails",
    "downloadPackageZip","dismissPackageZip"]){
    assert.ok(webview.html.includes('id="'+id+'"'),id+" must be present in the native ZIP export UI");
  }
  for(const id of ["layoutDirection","zoomIn","zoomOut","fit","fitWidth","fitHeight",
    "centerSelection","neighborsOnly","showAllLabels","rootPathMode",
    "rootPathFilters","pathFailure","pathUncertain","pathRecovery"]){
    assert.match(webview.html,new RegExp('id="'+id+'"'),id+" must be in the native graph toolbar");
  }
  for(const [id,name] of [
    ["neighborsOnly","network"],["showAllLabels","eye"],["centerSelection","locate-fixed"],
    ["zoomOut","zoom-out"],["zoomIn","zoom-in"],["fit","maximize"],
    ["fitWidth","fit-width"],["fitHeight","fit-height"]
  ]){
    assert.match(webview.html,new RegExp('id="'+id+'"[^>]*aria-label="[^"]+"'),
      id+" must retain an accessible label");
    assert.ok(webview.html.includes('data-icon="'+name+'"'),
      id+" must use the shared Classic icon "+name);
  }
  for(const name of ["columns-2","git-branch"])
    assert.ok(webview.html.includes('data-icon="'+name+'"'),
      "Canvas layout and route controls must use shared icon "+name);
  assert.ok(webview.html.includes('<option value="DOWN" selected>垂直</option>'));
  assert.doesNotMatch(webview.html,/unsafe-inline/);
  assert.ok(typeof onMessage==="function");
  await onMessage({type:"ready"});
  assert.equal(posted.at(-1).type,"snapshot");
  assert.equal(posted.at(-1).version,21);
  assert.equal(posted.at(-1).packageRootUri,"file:///workspace");
  assert.equal(posted.at(-1).packageName,"workspace");
  assert.equal(typeof posted.at(-1).contractText,"string",
    "the current Language Service snapshot must include Contract even when Procedure is invalid");
  assert.equal(typeof posted.at(-1).predicatesText,"string",
    "the current Language Service snapshot must include PredicateSet independently");
  assert.match(posted.at(-1).contractText,/goal:/);
  assert.match(posted.at(-1).predicatesText,/predicates:/);
  await onMessage({type:"exportPackageZip"});
  assert.ok(registered.some(args=>args[0]==="skillStudio.exportPackageZip"),
    "the native Procedure Webview routes ZIP export to the host command");

  await commands.get("skillStudio.openProcedure")(uri);
  assert.ok(registered.some(args=>args[0]==="vscode.openWith"),
    "the Procedure command must still open the native YAML Source");
  assert.equal(registered.at(-1)[0],"skillStudio.showPreview",
    "the explicit YAML Designer entry must also reveal the right Preview");
  await onMessage({type:"openSource"});
  assert.equal(opened.at(-1).doc,document);
  assert.equal(opened.at(-1).opts.viewColumn,1);

  assert.ok(document.lineCount>100,"the fixture must count real YAML lines");
  const sourceLine=source.split(/\r?\n/).findIndex(line=>line.trim()==="subscribe-sm-data:")+1;
  assert.ok(sourceLine>1,"the selected Node must be below the first YAML line");
  await onMessage({type:"revealSourceLine",line:sourceLine});
  assert.equal(opened.at(-1).doc,document);
  assert.equal(textEditor.selection.anchor.line,sourceLine-1);
  assert.equal(textEditor.selection.active.line,sourceLine-1);
  assert.equal(revealed.at(-1).range.start.line,sourceLine-1);
  assert.equal(revealed.at(-1).kind,1);
  const revealCount=revealed.length;
  await onMessage({type:"revealSourceLine",line:0});
  assert.equal(revealed.length,revealCount,"invalid line must not move the Source editor");
  assert.equal(posted.at(-1).type,"error");

  const model=projectWorkspace(source);
  assert.equal(model.state,"READY");
  assert.ok(model.procedure.routes.length>0);
  assert.ok(model.procedure.routes.every(route=>
    routeTargetChoices(model.procedure,route.id).length===0),
    "current Stage routes must remain read-only until a current-grammar patch contract is implemented");
  await onMessage({
    type:"applyRoute",expectedVersion:21,baseSource:source,
    candidateSource:source+"\\n# forged",routeId:"forged-route",
    procedureId:model.procedure.name,newTarget:"FAILED"
  });
  assert.equal(document.text,source);
  assert.equal(writes.length,0,"unsupported legacy Route patch commands must never mutate current source");
  assert.equal(posted.at(-1).type,"error");

});


test("Skill Studio authoring views live in native Explorer while Inspector stays in right sidebar",()=>{
  const manifest=JSON.parse(readFileSync("experiments/ide-host/vscode/package.json","utf8"));
  assert.equal(manifest.contributes.viewsContainers?.activitybar,undefined,
    "no competing Skill Studio Activity Bar container");
  const explorer=manifest.contributes.views.explorer;
  assert.deepEqual(explorer.map(view=>[view.id,view.name]),[
    ["skillStudio.packages","Package Explorer"],
    ["skillStudio.outline","Procedure Outline"],
    ["skillStudio.problems","Problems"]
  ]);
  assert.equal(explorer.find(view=>view.id==="skillStudio.packages")?.visibility,"visible");
  assert.equal(manifest.contributes.views.skillStudio,undefined);
  assert.ok(!explorer.some(view=>view.name==="Outline"),
    "semantic Procedure Outline must not impersonate Theia's document-symbol Outline");
  const containers=manifest.contributes.viewsContainers?.secondarySidebar;
  assert.deepEqual(containers?.map(container=>container.id),[
    "skillStudioPreview","skillStudioInspector"
  ],"Preview is its own primary right panel, distinct from Inspector");
  assert.deepEqual(manifest.contributes.views.skillStudioPreview?.map(view=>[
    view.id,view.name
  ]),[["skillStudio.preview","Preview"]]);
  assert.deepEqual(manifest.contributes.views.skillStudioInspector?.map(view=>[
    view.id,view.name
  ]),[["skillStudio.inspection","Inspector"]]);
});
