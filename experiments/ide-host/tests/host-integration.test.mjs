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
  const source=readFileSync("site/samples/packages/establish-pdu-session/assurance/procedure.yaml","utf8");
  const makeUri=path=>({path,toString(){return "file://"+this.path;},with(change){return makeUri(change.path??this.path);}});
  const uri=makeUri("/workspace/assurance/procedure.yaml");
  const document={uri,text:source,version:21,
    getText(){return this.text;},
    get lineCount(){return this.text.split(/\r?\n/).length;},
    positionAt(offset){return {offset};}
  };
  const listeners=new Set(),commands=new Map(),posted=[],writes=[],opened=[],registered=[],revealed=[];
  let confirmChoice="确认并应用";
  const textEditor={document,selection:null,revealRange(range,kind){revealed.push({range,kind});}};
  let provider=null,onMessage=null;
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
    ViewColumn:{Beside:2},
    Uri:{joinPath(base,...parts){return {path:base.path+"/"+parts.join("/")};}},
    Range,Position,Selection,WorkspaceEdit,
    TextEditorRevealType:{InCenter:1},
    workspace:{
      textDocuments:[document],
      onDidChangeTextDocument(cb){listeners.add(cb);return {dispose(){listeners.delete(cb);}};},
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
      fs:{readFile:async()=>new TextEncoder().encode(readFileSync("site/samples/packages/establish-pdu-session/assurance/predicates.yaml","utf8"))},
      findFiles:async()=>[uri],
      asRelativePath:file=>file.path
    },
    window:{
      visibleTextEditors:[textEditor],
      registerTreeDataProvider:()=>({dispose(){}}),
      onDidChangeActiveTextEditor:()=>({dispose(){}}),
      activeTextEditor:{document},
      registerCustomEditorProvider(_name,p){provider=p;return{dispose(){}};},
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
  const context={extensionUri:{path:"/extension"},subscriptions:[]};
  activate(context);
  assert.ok(provider);
  assert.ok(commands.has("skillStudio.openProcedure"));
  assert.ok(commands.has("skillStudio.renameNode"));
  assert.ok(commands.has("skillStudio.editNodeOperatorValue"));
  const webview={
    cspSource:"vscode-resource:",
    options:null,html:"",
    asWebviewUri:resource=>"vscode-resource:"+resource.path,
    postMessage:async data=>{posted.push(data);return true;},
    onDidReceiveMessage:cb=>{onMessage=cb;return{dispose(){}};}
  };
  const panel={webview,onDidChangeViewState:()=>({dispose(){}}),onDidDispose:()=>({dispose(){}})};
  await provider.resolveCustomTextEditor(document,panel);
  assert.match(webview.html,/Content-Security-Policy/);
  assert.match(webview.html,/procedure\.js/);
  assert.match(webview.html,/procedure\\.css/);
  for(const id of ["layoutDirection","zoomIn","zoomOut","fit","fitWidth","fitHeight",
    "centerSelection","neighborsOnly","showAllLabels","rootPathMode",
    "rootPathFilters","pathFailure","pathUncertain","pathRecovery"]){
    assert.match(webview.html,new RegExp('id="'+id+'"'),id+" must be in the native graph toolbar");
  }
  assert.ok(webview.html.includes('<option value="DOWN" selected>垂直</option>'));
  assert.doesNotMatch(webview.html,/unsafe-inline/);
  assert.ok(typeof onMessage==="function");
  await onMessage({type:"ready"});
  assert.equal(posted.at(-1).type,"snapshot");
  assert.equal(posted.at(-1).version,21);

  await commands.get("skillStudio.openProcedure")(uri);
  assert.equal(registered.at(-1)[0],"vscode.openWith");
  await onMessage({type:"openSource"});
  assert.equal(opened.at(-1).doc,document);
  assert.equal(opened.at(-1).opts.viewColumn,2);

  assert.ok(document.lineCount>100,"the fixture must count real YAML lines");
  const sourceLine=source.split(/\r?\n/).findIndex(line=>line.includes("nudm-sdm-subscribe"))+1;
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
  let trial=null;
  for(const procedure of model.procedures.values()){
    for(const route of procedure.routes){
      const target=routeTargetChoices(procedure,route.id)[0];
      if(target){
        trial=previewTargetPatch(source,procedure.name,route.id,target);
        break;
      }
    }
    if(trial)break;
  }
  assert.ok(trial);
  const message={type:"applyRoute",expectedVersion:21,baseSource:source,
    candidateSource:trial.candidateSource,routeId:trial.routeId,
    procedureId:trial.procedureId,newTarget:trial.newTarget};

  await onMessage({...message,candidateSource:source+"\n# forged"});
  assert.equal(document.text,source);
  assert.equal(writes.length,0);
  assert.equal(posted.at(-2).type,"error");
  assert.equal(posted.at(-1).type,"snapshot");

  await onMessage(message);
  assert.equal(document.text,trial.candidateSource);
  assert.equal(document.version,22);
  assert.equal(writes.length,1);
  assert.equal(writes[0].range.start.offset,trial.sourceSpan.start);
  assert.equal(writes[0].range.end.offset,trial.sourceSpan.end);
  assert.equal(writes[0].value,trial.newTarget);
  assert.equal(posted.at(-1).type,"applied");
  assert.ok(posted.some(x=>x.type==="snapshot"&&x.version===22));

  await onMessage(message);
  assert.equal(writes.length,1,"stale proposal must not write twice");
  assert.equal(posted.at(-2).type,"error");
  assert.equal(posted.at(-1).type,"snapshot");

  // Switch the same host document to a second real fixture with one
  // observed Outcome intentionally removed. The new Route still requires
  // a fresh gesture proposal, explicit Outcome, Diff and host revalidation.
  const ensureSource=readFileSync(
    "site/samples/packages/ensure-pdu-session/assurance/procedure.yaml","utf8");
  const ensureModel=projectWorkspace(ensureSource);
  const existing=ensureModel.procedures.get("ensure-session").routes.find(r=>
    r.id==="observe-target-session:UNKNOWN"&&r.routeSource==="operator.on");
  assert.ok(existing);
  const lineStart=ensureSource.lastIndexOf("\n",existing.sourceSpan.start-1)+1;
  const lineEnd=ensureSource.indexOf("\n",existing.sourceSpan.end);
  assert.ok(lineEnd>=0);
  const missing=ensureSource.slice(0,lineStart)+ensureSource.slice(lineEnd+1);
  assert.equal(projectWorkspace(missing).state,"READY");
  document.text=missing;document.version=23;
  await onMessage({type:"ready"});
  const intent=proposeCanvasRouteConnection({
    source:missing,procedureId:"ensure-session",
    sourceId:"observe-target-session",targetId:"unresolved",
    sourceHandle:"new-route-out",targetHandle:"in"
  });
  const createPreview=previewCanvasRouteConnection(missing,intent,"UNKNOWN");
  const createMessage={
    type:"applyRouteCreation",expectedVersion:23,baseSource:missing,
    candidateSource:createPreview.candidateSource,diff:createPreview.diff,
    procedureId:"ensure-session",sourceId:"observe-target-session",
    targetId:"unresolved",sourceHandle:"new-route-out",targetHandle:"in",
    outcome:"UNKNOWN"
  };
  await onMessage({...createMessage,candidateSource:missing+"\\n# forged"});
  assert.equal(document.text,missing);
  assert.equal(writes.length,1,"forged Route creation must not write");
  assert.equal(posted.at(-2).type,"error");
  assert.equal(posted.at(-1).type,"snapshot");
  await onMessage(createMessage);
  assert.equal(document.text,createPreview.candidateSource);
  assert.equal(document.version,24);
  assert.equal(writes.length,2);
  assert.equal(writes[1].range.start.offset,createPreview.sourceSpan.start);
  assert.equal(writes[1].range.end.offset,createPreview.sourceSpan.end);
  assert.ok(writes[1].value.includes("UNKNOWN: unresolved"));
  assert.equal(posted.at(-1).type,"applied");
  await onMessage(createMessage);
  assert.equal(writes.length,2,"stale Route creation must not insert twice");
  assert.equal(posted.at(-2).type,"error");
  assert.equal(posted.at(-1).type,"snapshot");

  // Native Inspector authoring reuses the Classic typed patch modules. A
  // cancelled confirmation and stale selection never mutate the TextDocument.
  const selected={procedureId:"ensure-session",nodeId:"create-session",
    sourceVersion:document.version,documentUri:document.uri.toString()};
  const beforeOperator=document.text;
  confirmChoice="取消";
  await commands.get("skillStudio.editNodeOperatorValue")(selected,"pdu_session.reconcile");
  assert.equal(document.text,beforeOperator,"cancelled Inspector edit must not write");
  assert.equal(writes.length,2);
  confirmChoice="确认并应用";
  await commands.get("skillStudio.editNodeOperatorValue")(selected,"pdu_session.reconcile");
  assert.equal(document.version,25);
  assert.match(document.text,/call: pdu_session\.reconcile/);
  assert.equal(writes.length,3);
  assert.equal(writes[2].range.end.offset-writes[2].range.start.offset,
    "pdu_session.create".length,"Operator edit replaces only its original scalar span");

  await commands.get("skillStudio.editNodeOperatorValue")(
    {...selected,sourceVersion:24},"pdu_session.create");
  assert.equal(document.version,25,"stale Inspector selection must not change Source");
  assert.equal(writes.length,3);

  const renamedId="create-session-renamed";
  await commands.get("skillStudio.renameNode")({
    ...selected,sourceVersion:document.version
  },renamedId);
  assert.equal(document.version,26);
  assert.equal(projectWorkspace(document.text).state,"READY");
  assert.match(document.text,/create-session-renamed:/);
  assert.doesNotMatch(document.text,/^\\s{6}create-session:/m);
  assert.doesNotMatch(document.text,/from: create-session\\./);
  assert.ok(writes.length>3,"Node rename applies its complete non-overlapping CST span set");
});
