// Contract-level VS Code host simulation. This is NOT a real desktop UI test.
// Exercise the actual bundled extension's provider/message/WorkspaceEdit wiring.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import Module from "node:module";
import {projectWorkspace} from "../../../site/workspace.mjs";
import {routeTargetChoices,previewTargetPatch} from "../vscode/src/route-target.mjs";

test("Bundled CustomTextEditor uses native document, guarded WorkspaceEdit and native Source",async()=>{
  const source=readFileSync("site/samples/packages/establish-pdu-session/assurance/procedure.yaml","utf8");
  const uri={path:"/workspace/assurance/procedure.yaml",toString(){return "file://"+this.path;}};
  const document={uri,text:source,version:21,
    getText(){return this.text;},
    get lineCount(){return this.text.split(/\r?\n/).length;},
    positionAt(offset){return {offset};}
  };
  const listeners=new Set(),commands=new Map(),posted=[],writes=[],opened=[],registered=[],revealed=[];
  const textEditor={selection:null,revealRange(range,kind){revealed.push({range,kind});}};
  let provider=null,onMessage=null;
  class WorkspaceEdit{
    replace(file,range,value){this.change={file,range,value};}
  }
  class Range{constructor(start,end){this.start=start;this.end=end;}}
  class Position{constructor(line,character){this.line=line;this.character=character;}}
  class Selection{constructor(anchor,active){this.anchor=anchor;this.active=active;}}
  const fake={
    ViewColumn:{Beside:2},
    Uri:{joinPath(base,...parts){return {path:base.path+"/"+parts.join("/")};}},
    Range,Position,Selection,WorkspaceEdit,
    TextEditorRevealType:{InCenter:1},
    workspace:{
      onDidChangeTextDocument(cb){listeners.add(cb);return {dispose(){listeners.delete(cb);}};},
      async applyEdit(edit){
        const {file,range,value}=edit.change;
        assert.equal(file,document.uri);
        writes.push(edit.change);
        document.text=document.text.slice(0,range.start.offset)+value+
          document.text.slice(range.end.offset);
        document.version++;
        for(const callback of listeners)callback({document});
        return true;
      },
      findFiles:async()=>[uri],
      asRelativePath:file=>file.path
    },
    window:{
      activeTextEditor:{document},
      registerCustomEditorProvider(_name,p){provider=p;return{dispose(){}};},
      showWarningMessage:()=>{},
      showInformationMessage:()=>{},
      showTextDocument:async(doc,opts)=>{opened.push({doc,opts});return textEditor;},
      showQuickPick:async items=>items[0]
    },
    commands:{
      registerCommand(name,cb){commands.set(name,cb);return{dispose(){}};},
      async executeCommand(...args){registered.push(args);}
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
  const webview={
    cspSource:"vscode-resource:",
    options:null,html:"",
    asWebviewUri:resource=>"vscode-resource:"+resource.path,
    postMessage:async data=>{posted.push(data);return true;},
    onDidReceiveMessage:cb=>{onMessage=cb;return{dispose(){}};}
  };
  const panel={webview,onDidDispose:()=>({dispose(){}})};
  await provider.resolveCustomTextEditor(document,panel);
  assert.match(webview.html,/Content-Security-Policy/);
  assert.match(webview.html,/procedure\.js/);
  assert.match(webview.html,/procedure\.css/);
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
});
