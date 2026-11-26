import test from "node:test";
import {readFileSync} from "node:fs";
import assert from "node:assert/strict";
import vm from "node:vm";
import {registerProjectWelcome} from "../vscode/src/project-welcome.mjs";

function setupWelcome(language="en",workspaceFolders=[],invokeWelcome=false){
  const commands=new Map(),sent=[],subscriptions=[],messages=[];
  let receiveMessage=null,disposePanel=null,panelCreated=0;
  const webview={
    html:"",
    postMessage(message){messages.push(message);return Promise.resolve(true);},
    onDidReceiveMessage(callback){receiveMessage=callback;return {dispose(){}};}
  };
  const panel={
    webview,
    reveal(){},
    onDidDispose(callback){disposePanel=callback;return {dispose(){}};},
    dispose(){disposePanel?.();}
  };
  const vscode={
    ViewColumn:{One:1},
    env:{language},
    workspace:{
      workspaceFolders,
      onDidChangeWorkspaceFolders(){return {dispose(){}};}
    },
    window:{
      createWebviewPanel(){panelCreated++;return panel;},
      showErrorMessage(message){sent.push({error:message});}
    },
    commands:{
      registerCommand(id,handler){commands.set(id,handler);return {dispose(){}};},
      executeCommand(id){sent.push({command:id});return Promise.resolve();}
    }
  };
  const handle=registerProjectWelcome(vscode,{subscriptions});
  const panelCreatedOnActivation=panelCreated;
  if(invokeWelcome)commands.get("skillStudio.showWelcome")();
  assert.ok(webview.html.includes('data-action="example"'));
  const source=webview.html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(source,"welcome must contain its own CSP-authorized script");
  const listeners=new Map();
  const elements=Object.fromEntries(["newProject","openProject","example","spec","guide"]
    .map(action=>[action,{
      dataset:{action},disabled:false,attributes:{},
      addEventListener(type,callback){listeners.set(action+":"+type,callback);},
      setAttribute(name,value){this.attributes[name]=value;}
    }]));
  const projectButtons=["newProject","openProject","example"].map(key=>elements[key]);
  const status={hidden:true,dataset:{},textContent:""};
  const browserListeners=new Map(),clientMessages=[];
  vm.runInNewContext(source,{
    document:{
      querySelectorAll(selector){
        if(selector==="[data-action]")return Object.values(elements);
        if(selector===".actions button")return projectButtons;
        throw Error("Unexpected query "+selector);
      },
      querySelector(selector){
        if(selector==='[data-action="example"]')return elements.example;
        throw Error("Unexpected query "+selector);
      },
      getElementById(id){
        assert.equal(id,"example-import-status");
        return status;
      }
    },
    window:{addEventListener(type,callback){browserListeners.set(type,callback);}},
    acquireVsCodeApi:()=>({
      postMessage(message){
        // The clicked button must already be busy before the extension RPC.
        assert.equal(elements.example.disabled,true);
        assert.equal(elements.example.attributes["aria-busy"],"true");
        assert.equal(status.hidden,false);
        clientMessages.push(message);
      }
    })
  });
  return {handle,webview,messages,sent,elements,status,listeners,
    browserListeners,clientMessages,receiveMessage,commands,
    panelCreatedOnActivation,panelCreated:()=>panelCreated};
}

test("Welcome immediately shows a loading spinner and prevents duplicate example clicks",()=>{
  const h=setupWelcome("zh-cn");
  assert.match(h.webview.html,/aria-live="polite"/);
  assert.match(h.webview.html,/prefers-reduced-motion/);
  assert.match(h.webview.html,/正在加载示例项目/);
  h.listeners.get("example:click")({preventDefault(){}});
  assert.equal(h.elements.example.dataset.loading,"true");
  assert.equal(h.elements.newProject.disabled,true);
  assert.equal(h.elements.openProject.disabled,true);
  assert.match(h.status.textContent,/正在加载示例项目/);
  assert.equal(h.clientMessages.length,1);
  assert.equal(h.clientMessages[0].action,"example");
  h.listeners.get("example:click")({preventDefault(){}});
  assert.equal(h.clientMessages.length,1,"repeated click must not dispatch another import");
});

test("Progress messages update the welcome page without remounting it, errors allow retry",()=>{
  const h=setupWelcome("en");
  const initialHtml=h.webview.html;
  h.handle.setImportStatus({state:"loading",message:"Importing official files (4/18)…",
    completed:4,total:18});
  assert.equal(h.webview.html,initialHtml,"progress must not recreate the Webview");
  assert.equal(h.messages.at(-1).type,"exampleImportStatus");
  assert.equal(h.messages.at(-1).completed,4);
  h.browserListeners.get("message")({data:h.messages.at(-1)});
  assert.equal(h.status.textContent,"Importing official files (4/18)…");
  assert.equal(h.elements.example.disabled,true);
  h.handle.setImportStatus({state:"error",message:"Import failed"});
  h.browserListeners.get("message")({data:h.messages.at(-1)});
  assert.equal(h.status.textContent,"Import failed");
  assert.equal(h.status.dataset.state,"error");
  assert.equal(h.elements.example.disabled,false,"import error must allow retry");
  assert.equal(h.elements.example.dataset.loading,"false");
  h.handle.setImportStatus({state:"success",message:"Example project opened"});
  h.browserListeners.get("message")({data:h.messages.at(-1)});
  assert.equal(h.elements.example.disabled,false);
  assert.equal(h.status.dataset.state,"success");
});


test("Welcome can be explicitly reopened while an existing project workspace is active",()=>{
  const h=setupWelcome("en",[{uri:{toString(){return "file:///project";}}}],true);
  assert.equal(h.panelCreatedOnActivation,0,
    "an existing workspace must not force-open the Welcome page on every startup");
  assert.equal(h.panelCreated(),1,
    "the registered Welcome command must create the page on demand");
  assert.equal(h.handle.getDiagnostics().panelOpen,true);
  assert.equal(h.handle.getDiagnostics().createWebviewPanelAvailable,true);
  assert.equal(h.handle.getDiagnostics().lastError,null);
  assert.match(h.webview.html,/three OpenAMSM Scheme C CA-SL v1alpha5 Create, Modify and Release Skills/,
    "Welcome must describe the three current OpenAMSM Scheme C Skills");
  assert.doesNotMatch(h.webview.html,/5GC Establish/,
    "the separate conventional 5GC fixture must not be presented as part of the default Example");
});


test("Chinese Welcome describes only the three current OpenAMSM Scheme C Skills",()=>{
  const h=setupWelcome("zh-cn");
  assert.match(h.webview.html,/OpenAMSM Scheme C 的 CA-SL v1alpha5 Create、Modify、Release 三个 Skill/);
  assert.doesNotMatch(h.webview.html,/5GC\/MAS 参考 Skill/);
  assert.match(h.webview.html,/DRAFT \/ NOT_QUALIFIED/);
});

test("retired Procedure-AST authoring commands are not exposed in the current host",()=>{
  const manifest=JSON.parse(readFileSync(
    new URL("../vscode/package.json",import.meta.url),"utf8"));
  const retired=[
    "skillStudio.renameNode","skillStudio.editNodeOperatorValue",
    "skillStudio.insertNode","skillStudio.deleteNode"
  ];
  const commands=new Set(manifest.contributes.commands.map(item=>item.command));
  for(const command of retired)assert.equal(commands.has(command),false,command);
  for(const items of Object.values(manifest.contributes.menus??{}))
    for(const item of items??[])
      assert.equal(retired.includes(item.command),false,item.command);
  const workbench=readFileSync(
    new URL("../vscode/src/workbench.mjs",import.meta.url),"utf8");
  for(const command of retired)
    assert.equal(workbench.includes(command),false,command);
});