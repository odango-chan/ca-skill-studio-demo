import test from "node:test";
import assert from "node:assert/strict";
import {registerCompilerIntegration}
  from "../experiments/ide-host/vscode/src/compiler-integration.mjs";

class Uri{
  constructor(path,scheme="file",authority=""){
    this.path=path;this.scheme=scheme;this.authority=authority;
  }
  static parse(value){
    const url=new URL(value);
    return new Uri(url.pathname,url.protocol.slice(0,-1),url.host);
  }
  static from({path,scheme="file",authority=""}){
    return new Uri(path,scheme,authority);
  }
  static joinPath(base,...parts){
    return new Uri([base.path.replace(/\/$/,""),...parts].join("/"),
      base.scheme,base.authority);
  }
  with({path}){return new Uri(path,this.scheme,this.authority);}
  toString(){return this.scheme+"://"+this.authority+this.path;}
}
class Emitter{
  constructor(){
    this.listeners=new Set();
    this.event=handler=>{
      this.listeners.add(handler);
      return {dispose:()=>this.listeners.delete(handler)};
    };
  }
  fire(value){for(const fn of [...this.listeners])fn(value);}
  dispose(){this.listeners.clear();}
}
class WorkerStub{
  static instances=[];
  constructor(){this.listeners=new Map();this.messages=[];WorkerStub.instances.push(this);}
  addEventListener(type,fn){
    if(!this.listeners.has(type))this.listeners.set(type,[]);
    this.listeners.get(type).push(fn);
  }
  postMessage(message){this.messages.push(message);}
  respond(index,result){
    const request=this.messages[index];
    assert.ok(request,"expected a pending Compiler Worker request");
    for(const fn of this.listeners.get("message")??[])
      fn({data:{id:request.id,result}});
  }
  terminate(){}
}
const compilerResponse=()=>[{
  severity:"error",phase:"C_STATIC",code:"YAML_PARSE_ERROR",
  path:"skills/example/assurance/procedure.yaml",line:1,column:1,
  message:"Compiler rejected the edited Procedure"
}];

function host(){
  const events={
    changeText:new Emitter(),create:new Emitter(),delete:new Emitter(),
    rename:new Emitter(),config:new Emitter(),folders:new Emitter(),
    diagnostics:new Emitter()
  };
  const collections=new Map(),commands=new Map(),warnings=[];
  const procedureUri=Uri.parse("file:///workspace/skills/example/assurance/procedure.yaml");
  const readmeUri=Uri.parse("file:///workspace/skills/example/SKILL.md");
  const procedure={
    uri:procedureUri,version:1,getText:()=> "start: check\nnodes: {}\n"
  };
  const readme={
    uri:readmeUri,version:1,getText:()=> "# Example\n"
  };
  const docs=new Map([[procedureUri.toString(),procedure],[readmeUri.toString(),readme]]);
  const output={appendLine(){},show(){},dispose(){}};
  const languages={
    createDiagnosticCollection(name){
      const entries=new Map();
      const c={
        set(uri,items){
          entries.set(uri.toString(),[...items]);
          events.diagnostics.fire({uris:[uri]});
        },
        delete(uri){
          entries.delete(uri.toString());
          events.diagnostics.fire({uris:[uri]});
        },
        forEach(cb){
          for(const [key,items] of entries)cb(Uri.parse(key),items);
        },
        get(uri){return entries.get(uri.toString())??[];},
        dispose(){entries.clear();}
      };
      collections.set(name,c);
      return c;
    },
    getDiagnostics(uri){
      return [...collections.values()].flatMap(c=>c.get(uri));
    },
    onDidChangeDiagnostics:events.diagnostics.event
  };
  const vscode={
    Uri,EventEmitter:Emitter,languages,
    DiagnosticSeverity:{Error:0,Warning:1,Information:2},
    Diagnostic:class{
      constructor(range,message,severity){
        this.range=range;this.message=message;this.severity=severity;
      }
    },
    Position:class{constructor(line,character){this.line=line;this.character=character;}},
    Range:class{
      constructor(start,end){this.start=start;this.end=end;}
    },
    RelativePattern:class{constructor(root,pattern){this.root=root;this.pattern=pattern;}},
    commands:{
      registerCommand(id,fn){commands.set(id,fn);return {dispose(){commands.delete(id);}};}
    },
    workspace:{
      textDocuments:[procedure,readme],
      openTextDocument:async uri=>{
        const document=docs.get(uri.toString());
        if(!document)throw Error("Test document not found: "+uri);
        return document;
      },
      findFiles:async()=>[procedureUri,readmeUri],
      getWorkspaceFolder:()=>({uri:Uri.parse("file:///workspace")}),
      getConfiguration:()=>({get:(_key,defaultValue)=>defaultValue}),
      registerTextDocumentContentProvider:()=>({dispose(){}}),
      onDidChangeTextDocument:events.changeText.event,
      onDidCreateFiles:events.create.event,
      onDidDeleteFiles:events.delete.event,
      onDidRenameFiles:events.rename.event,
      onDidChangeConfiguration:events.config.event,
      onDidChangeWorkspaceFolders:events.folders.event
    },
    window:{
      createOutputChannel:()=>output,
      showWarningMessage:message=>{warnings.push(message);return Promise.resolve();},
      showInformationMessage:()=>Promise.resolve()
    }
  };
  const context={extensionUri:Uri.parse("file:///extension"),subscriptions:[]};
  return {vscode,context,events,commands,collections,procedure,
    procedureUri,warnings};
}
async function waitForMessages(count){
  for(let i=0;i<50;i++){
    const worker=WorkerStub.instances[0];
    if(worker?.messages.length>=count)return worker;
    await new Promise(resolve=>setImmediate(resolve));
  }
  throw Error("Compiler Worker did not receive request "+count);
}

test("actual Compiler host adapter rejects stale Check and restores markers after LSP loss",async()=>{
  const previous=globalThis.Worker;
  globalThis.Worker=WorkerStub;
  WorkerStub.instances.length=0;
  const h=host();
  let accepted=[];
  const integration=registerCompilerIntegration(h.vscode,h.context,{
    getActiveDocument:()=>h.procedure,
    getAcceptedLanguageFindings:()=>accepted
  });
  try{
    const runCheck=h.commands.get("skillStudio.checkSkill");
    const pending=runCheck(h.procedureUri);
    const worker=await waitForMessages(1);
    assert.equal(worker.messages[0].command,"check");
    h.events.changeText.fire({document:h.procedure});
    worker.respond(0,compilerResponse());
    assert.equal(await pending,null,"superseded Worker result must not be published");
    assert.deepEqual(integration.problems.getProblems(),[]);
    assert.equal(h.vscode.languages.getDiagnostics(h.procedureUri).length,0);

    const current=runCheck(h.procedureUri);
    await waitForMessages(2);
    worker.respond(1,compilerResponse());
    const check=await current;
    assert.equal(check.errors,1);
    assert.equal(integration.problems.getProblems().length,1);
    const compiler=h.collections.get("skill-compiler");
    assert.equal(compiler.get(h.procedureUri).length,1);

    accepted=[{
      code:"YAML_PARSE_ERROR",message:"LSP found malformed YAML",
      uri:h.procedureUri.toString(),line:1,relativePath:"assurance/procedure.yaml",
      status:"confirmed",confidence:"exact",
      severity:"error",source:"package-audit"
    }];
    const lsp=h.vscode.languages.createDiagnosticCollection("lsp-local");
    const local=new h.vscode.Diagnostic(new h.vscode.Range(
      new h.vscode.Position(0,0),new h.vscode.Position(0,5)),
    "LSP found malformed YAML",h.vscode.DiagnosticSeverity.Error);
    local.code="YAML_PARSE_ERROR";
    local.source="Skill Studio · package-audit";
    lsp.set(h.procedureUri,[local]);
    integration.problems.refreshMarkers(h.procedureUri.toString());
    assert.equal(compiler.get(h.procedureUri).length,0,
      "a confirmed current LSP marker owns the single visible squiggle");
    assert.equal(h.vscode.languages.getDiagnostics(h.procedureUri).length,1);
    assert.equal(integration.problems.getProblems().length,1);

    lsp.delete(h.procedureUri);
    assert.equal(compiler.get(h.procedureUri).length,1,
      "Compiler marker returns when native LSP diagnostics disappear");
    assert.equal(h.vscode.languages.getDiagnostics(h.procedureUri).length,1);
    lsp.dispose();
  }finally{
    integration.dispose();
    for(const disposable of h.context.subscriptions)
      disposable?.dispose?.();
    if(previous===undefined)delete globalThis.Worker;
    else globalThis.Worker=previous;
  }
});
