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
    assert.equal(worker.options.name,"skill-studio-compiler-v1alpha4");
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
  const {client}=host();
  try{
    await assert.rejects(client.request("run",{}),/Unsupported Compiler command/);
    assert.equal(FakeWorker.instances.length,0);
  }finally{client.dispose();}
});
