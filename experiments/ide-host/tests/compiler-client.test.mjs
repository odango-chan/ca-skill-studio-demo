import test from "node:test";
import assert from "node:assert/strict";
import {createCompilerWorkerClient} from "../vscode/src/compiler-client.mjs";

class FakeWorker{
  constructor(url,options){
    this.url=url;this.options=options;this.listeners=new Map();
    this.messages=[];this.terminated=false;
    FakeWorker.instances.push(this);
  }
  addEventListener(type,listener){
    if(!this.listeners.has(type))this.listeners.set(type,new Set());
    this.listeners.get(type).add(listener);
  }
  emit(type,event){
    for(const listener of this.listeners.get(type)??[])listener(event);
  }
  postMessage(message){
    this.messages.push(message);
    queueMicrotask(()=>{
      if(message.command==="build"){
        this.emit("message",{data:{id:message.id,error:"synthetic compiler failure"}});
      }else{
        this.emit("message",{data:{id:message.id,result:{command:message.command}}});
      }
    });
  }
  terminate(){this.terminated=true;}
}
FakeWorker.instances=[];

function host(WorkerCtor=FakeWorker){
  const vscode={Uri:{joinPath(base,...parts){
    return {
      scheme:"https",
      toString(){return "https://example.test/"+parts.join("/");}
    };
  }}};
  const context={extensionUri:{scheme:"https"}};
  return {client:createCompilerWorkerClient(vscode,context,{WorkerCtor,timeoutMs:1000})};
}

test("Compiler Worker client serializes requests and preserves response correlation",async()=>{
  FakeWorker.instances.length=0;
  const {client}=host();
  try{
    const results=await Promise.all([
      client.request("check",{sequence:1}),
      client.request("inspect",{sequence:2})
    ]);
    assert.deepEqual(results,[{command:"check"},{command:"inspect"}]);
    const worker=FakeWorker.instances[0];
    assert.equal(worker.messages.length,2);
    assert.deepEqual(worker.messages.map(item=>item.command),["check","inspect"]);
    assert.equal(worker.options.name,"skill-studio-compiler-v2.1.0");
  }finally{client.dispose();}
});

test("Compiler Worker command errors reject one request without corrupting the next request",async()=>{
  FakeWorker.instances.length=0;
  const {client}=host();
  try{
    await assert.rejects(client.request("build",{}),/synthetic compiler failure/);
    assert.deepEqual(await client.request("check",{}),{command:"check"});
    assert.equal(FakeWorker.instances[0].terminated,false);
  }finally{client.dispose();}
});

test("Compiler Worker transport failure terminates the failed Worker and rejects pending work",async()=>{
  FakeWorker.instances.length=0;
  class CrashWorker extends FakeWorker{
    postMessage(){
      this.emit("error",{message:"synthetic worker crash"});
    }
  }
  const {client}=host(CrashWorker);
  await assert.rejects(client.request("check",{}),/synthetic worker crash/);
  assert.equal(CrashWorker.instances[0].terminated,true);
  client.dispose();
});

test("Compiler Worker client rejects unsupported commands before dispatch",async()=>{
  FakeWorker.instances.length=0;
  const {client}=host();
  try{
    await assert.rejects(client.request("run",{}),/Unsupported Compiler command/);
    assert.equal(FakeWorker.instances.length,0);
  }finally{client.dispose();}
});

class FakeNodeWorker{
  constructor(path,options){
    this.path=path;this.options=options;this.listeners=new Map();
    this.messages=[];this.terminated=false;
    FakeNodeWorker.instances.push(this);
  }
  on(type,listener){
    if(!this.listeners.has(type))this.listeners.set(type,new Set());
    this.listeners.get(type).add(listener);
  }
  emit(type,value){
    for(const listener of this.listeners.get(type)??[])listener(value);
  }
  postMessage(message){
    this.messages.push(message);
    queueMicrotask(()=>{
      if(message.command==="build"){
        this.emit("message",{id:message.id,error:"synthetic node compiler failure"});
      }else{
        this.emit("message",{id:message.id,result:{command:message.command}});
      }
    });
  }
  terminate(){this.terminated=true;}
}
FakeNodeWorker.instances=[];

function nodeHost(NodeWorkerCtor=FakeNodeWorker){
  const vscode={Uri:{joinPath(base,...parts){
    const path="/extension/"+parts.join("/");
    return {scheme:"file",fsPath:path,toString(){return "file://"+path;}};
  }}};
  const context={extensionUri:{scheme:"file",fsPath:"/extension"}};
  return {client:createCompilerWorkerClient(vscode,context,{
    WorkerCtor:null,NodeWorkerCtor,timeoutMs:1000
  })};
}

test("Node extension hosts run the same pinned Go/WASM Compiler through worker_threads",async()=>{
  FakeNodeWorker.instances.length=0;
  const {client}=nodeHost();
  try{
    const results=await Promise.all([
      client.request("check",{sequence:1}),
      client.request("inspect",{sequence:2})
    ]);
    assert.deepEqual(results,[{command:"check"},{command:"inspect"}]);
    const worker=FakeNodeWorker.instances[0];
    assert.equal(worker.path,"/extension/dist/compiler-node-worker.mjs");
    assert.equal(worker.options.workerData.wasmPath,"/extension/dist/skillc.wasm");
    assert.equal(worker.options.name,"skill-studio-compiler-v2.1.0");
    assert.deepEqual(worker.messages.map(item=>item.command),["check","inspect"]);
  }finally{client.dispose();}
});

test("Node Compiler worker command errors do not corrupt the next request",async()=>{
  FakeNodeWorker.instances.length=0;
  const {client}=nodeHost();
  try{
    await assert.rejects(client.request("build",{}),/synthetic node compiler failure/);
    assert.deepEqual(await client.request("check",{}),{command:"check"});
    assert.equal(FakeNodeWorker.instances[0].terminated,false);
  }finally{client.dispose();}
});

test("Node Compiler worker transport failure terminates the failed worker and rejects pending work",async()=>{
  FakeNodeWorker.instances.length=0;
  class CrashNodeWorker extends FakeNodeWorker{
    postMessage(){this.emit("error",new Error("synthetic node worker crash"));}
  }
  const {client}=nodeHost(CrashNodeWorker);
  await assert.rejects(client.request("check",{}),/synthetic node worker crash/);
  assert.equal(CrashNodeWorker.instances[0].terminated,true);
  client.dispose();
});
