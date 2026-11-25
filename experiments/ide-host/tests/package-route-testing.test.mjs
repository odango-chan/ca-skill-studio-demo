import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {registerPackageRouteTesting}
  from "../vscode/src/package-route-testing.mjs";

const path=new URL("../../../tests/fixtures/v1alpha5-conventional/establish-pdu-session/assurance/procedure.yaml",import.meta.url);
const document={uri:{path:"/workspace/skills/establish-pdu-session/assurance/procedure.yaml"}};
const snapshot={
  completeness:"complete",packageName:"establish-pdu-session",
  documents:[{relativePath:"assurance/procedure.yaml",text:readFileSync(path,"utf8")}]
};
const authored=JSON.stringify({
  apiVersion:"skill-studio-route-scenario/v1",id:"refuse-entry",
  steps:[{node:"get-sm-subscription-data",stage:"precondition",outcome:"FAIL"}],
  expect:{terminal:"FAILED"}
});
function host({native=true,active=document,source=snapshot}={}){
  const commands=new Map(),events=[],lines=[];
  let profile=null,root=null,onActive=null;
  const createItem=(id,label)=>({
    id,label,children:{
      list:new Map(),
      add(item){this.list.set(item.id,item);},
      delete(id){this.list.delete(id);},
      get(id){return this.list.get(id);},
      get size(){return this.list.size;}
    }
  });
  const controller={
    items:{add(item){root=item;}},
    createTestItem:createItem,
    createRunProfile:(_label,_kind,handler)=>{profile=handler;},
    createTestRun:()=>({
      enqueued:item=>events.push(["enqueued",item.id]),
      started:item=>events.push(["started",item.id]),
      passed:item=>events.push(["passed",item.id]),
      skipped:item=>events.push(["skipped",item.id]),
      failed:(item,message)=>events.push(["failed",item.id,message.message]),
      errored:(item,message)=>events.push(["errored",item.id,message.message]),
      appendOutput:()=>{},
      end:()=>events.push(["end"])
    }),
    dispose(){}
  };
  const vscode={
    tests:native?{createTestController:()=>controller}:null,
    TestRunProfileKind:{Run:1},
    TestMessage:class{constructor(message){this.message=message;}},
    window:{
      createOutputChannel:()=>({appendLine:line=>lines.push(line),show(){},dispose(){}}),
      onDidChangeActiveTextEditor:cb=>{onActive=cb;return {dispose(){}};}
    },
    commands:{
      registerCommand:(id,callback)=>{commands.set(id,callback);return {dispose(){}};}
    }
  };
  const context={subscriptions:[]};
  const provider=registerPackageRouteTesting(vscode,context,{
    getActiveProcedure:()=>active,
    snapshotProvider:async(_vs,_doc,generation)=>{
      assert.equal(generation,0);
      return source;
    }
  });
  return {provider,commands,lines,events,controller,context,
    get root(){return root;},get profile(){return profile;},
    changed:()=>onActive?.()};
}

test("native Route Test Explorer discovers five pinned Example cases",async()=>{
  const h=host();
  const current=await h.provider.refresh();
  assert.equal(current.packageName,"establish-pdu-session");
  const builtin=h.root.children.get("builtins");
  assert.equal(builtin.children.size,5);
  assert.equal(h.root.children.get("authored").children.size,0);
  assert.equal(h.provider.hasNativeTestExplorer,true);
});
test("route replay Command Palette returns five 5GC PASS with zero Runtime claims",async()=>{
  const h=host();
  const r=await h.commands.get("skillStudio.runRouteScenarios")();
  assert.deepEqual(r.summary,{PASS:5,FAIL:0,NOT_RUN:0});
  assert.equal(r.nativeTestExplorer,true);
  assert.equal(r.qualification,"NOT_QUALIFIED");
  assert.ok(h.lines.some(line=>line.includes("Owner / Runtime NOT_QUALIFIED")));
});
test("Package-local JSON is dynamically added to native Testing API",async()=>{
  const extra={
    ...snapshot,documents:[
      ...snapshot.documents,
      {relativePath:"tests/refusal.route-scenario.json",text:authored}
    ]
  };
  const h=host({source:extra});
  await h.provider.refresh();
  assert.equal(h.root.children.get("authored").children.size,1);
  const result=await h.commands.get("skillStudio.runRouteScenarios")();
  assert.deepEqual(result.summary,{PASS:6,FAIL:0,NOT_RUN:0});
  await h.profile({
    include:[{id:"authored:tests/refusal.route-scenario.json"}]
  },{isCancellationRequested:false});
  assert.deepEqual(h.events.filter(e=>e[0]==="passed").map(e=>e[1]),
    ["authored:tests/refusal.route-scenario.json"]);
});
test("invalid authored JSON reports FAIL, not an invented PASS",async()=>{
  const source={...snapshot,documents:[...snapshot.documents,
    {relativePath:"tests/invalid.route-scenario.json",text:"{"}]};
  const h=host({source});
  await h.provider.refresh();
  const r=await h.commands.get("skillStudio.runRouteScenarios")();
  assert.equal(r.summary.FAIL,1);
  assert.equal(r.summary.PASS,5);
});
test("no selected Procedure reports no qualified tests",async()=>{
  const h=host({active:null});
  const result=await h.commands.get("skillStudio.runRouteScenarios")();
  assert.equal(result.summary.PASS,0);
  assert.equal(result.qualification,"NOT_QUALIFIED");
  assert.ok(h.lines.some(l=>l.includes("NOT_RUN boundary")));
});
test("native Testing API missing retains command fallback",async()=>{
  const h=host({native:false});
  const r=await h.commands.get("skillStudio.runRouteScenarios")();
  assert.equal(r.nativeTestExplorer,false);
  assert.equal(r.summary.PASS,5);
});
test("cancellation does not mark scripted test as passed",async()=>{
  const h=host();
  await h.provider.refresh();
  await h.profile({include:[{id:"builtin:5gc-timeout"}]},
    {isCancellationRequested:true});
  assert.ok(h.events.some(x=>x[0]==="skipped"&&x[1]==="builtin:5gc-timeout"));
  assert.ok(!h.events.some(x=>x[0]==="passed"));
  assert.equal(h.events.at(-1)[0],"end");
});
