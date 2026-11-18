import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {registerPackageDiagnosticTesting}
  from "../vscode/src/package-diagnostic-testing.mjs";

const root=new URL("../../../site/samples/v1alpha5/",import.meta.url);
const manifest=JSON.parse(readFileSync(new URL("files.json",root),"utf8"));
const snapshot={
  completeness:"complete",
  documents:manifest.files.filter(path=>path.startsWith("establish-pdu-session/"))
    .map(path=>({
      relativePath:path.slice("establish-pdu-session/".length),
      text:readFileSync(new URL(path,root),"utf8")
    }))
};
const active={uri:{path:"/workspace/skills/establish-pdu-session/assurance/procedure.yaml"}};

function host({native=true,activeProcedure=active,sourceSnapshot=snapshot}={}){
  const commands=new Map(),lines=[],runs=[],results=[];
  let profile=null,rootItem=null;
  const output={appendLine:line=>lines.push(line),show(){},dispose(){}};
  const makeItem=(id,label)=>({
    id,label,children:{items:[],add(item){this.items.push(item);}}
  });
  const controller={
    items:{add(item){rootItem=item;}},
    createTestItem:makeItem,
    createRunProfile(label,kind,handler){
      profile={label,kind,handler};
      return {dispose(){}};
    },
    createTestRun(){
      const events=[];
      runs.push(events);
      return {
        enqueued:item=>events.push(["enqueued",item.id]),
        started:item=>events.push(["started",item.id]),
        passed:item=>events.push(["passed",item.id]),
        failed:(item,message)=>events.push(["failed",item.id,message.message]),
        skipped:item=>events.push(["skipped",item.id]),
        errored:(item,message)=>events.push(["errored",item.id,message.message]),
        appendOutput:message=>events.push(["output",message]),
        end:()=>events.push(["end"])
      };
    },
    dispose(){}
  };
  const vscode={
    window:{createOutputChannel:()=>output,activeTextEditor:null},
    commands:{registerCommand:(id,callback)=>{commands.set(id,callback);return {dispose(){}};}},
    TestRunProfileKind:{Run:1},
    TestMessage:class{constructor(message){this.message=message;}},
    tests:native?{createTestController:()=>controller}:undefined
  };
  const context={subscriptions:[]};
  const testing=registerPackageDiagnosticTesting(vscode,context,{
    getActiveProcedure:()=>activeProcedure,
    snapshotProvider:async()=>sourceSnapshot
  });
  return {commands,lines,runs,results,testing,controller,context,
    get profile(){return profile;},get rootItem(){return rootItem;}};
}

test("native Test Explorer groups 11 diagnostic tests by domain",()=>{
  const state=host();
  assert.equal(state.testing.hasNativeTestExplorer,true);
  assert.equal(state.testing.testCount,11);
  assert.equal(state.rootItem.id,"skillStudio.diagnosticRegressions");
  const groups=state.rootItem.children.items;
  assert.ok(groups.some(item=>item.id==="domain:capabilities"));
  assert.ok(groups.some(item=>item.id==="domain:schemas"));
  assert.equal(groups.reduce((sum,item)=>sum+item.children.items.length,0),11);
  assert.equal(state.profile.label,"Run offline diagnostics");
});

test("native test run passes on synthetic Example defects without writing source",async()=>{
  const state=host();
  await state.profile.handler({}, {isCancellationRequested:false});
  const events=state.runs.at(-1);
  assert.equal(events.filter(event=>event[0]==="passed").length,11);
  assert.ok(!events.some(event=>["failed","errored"].includes(event[0])));
  assert.equal(events.at(-1)[0],"end");
  assert.ok(state.lines.some(line=>line.includes("Skill qualification NOT_QUALIFIED")));
});

test("native Test API supports selecting a domain and excluding one case",async()=>{
  const state=host();
  await state.profile.handler({
    include:[{id:"domain:capabilities"}],
    exclude:[{id:"capability-grant-duplicate"}]
  },{isCancellationRequested:false});
  const events=state.runs.at(-1);
  assert.deepEqual(events.filter(event=>event[0]==="passed").map(event=>event[1]),
    ["capability-owner-unavailable"]);
});

test("missing native Testing API still exposes a safe command-based results surface",async()=>{
  const state=host({native:false});
  assert.equal(state.testing.hasNativeTestExplorer,false);
  const result=await state.commands.get("skillStudio.runDiagnosticTests")();
  assert.deepEqual(result.summary,{PASS:11,FAIL:0,NOT_RUN:0});
  assert.ok(state.lines.some(line=>line.includes("Native Testing API unavailable")));
});

test("missing or partial source produces NOT_RUN, never a qualified PASS",async()=>{
  for(const state of [
    host({activeProcedure:null}),
    host({sourceSnapshot:{completeness:"partial",reason:"missing Schema",documents:[]}})
  ]){
    const result=await state.commands.get("skillStudio.runDiagnosticTests")();
    assert.deepEqual(result.summary,{PASS:0,FAIL:0,NOT_RUN:11});
    assert.equal(result.qualification,"NOT_QUALIFIED");
  }
});

test("cancellation does not execute the diagnostic suite or claim success",async()=>{
  const state=host();
  await state.profile.handler({include:[{id:"domain:capabilities"}]},
    {isCancellationRequested:true});
  const events=state.runs.at(-1);
  assert.equal(events.filter(event=>event[0]==="skipped").length,2);
  assert.ok(!events.some(event=>event[0]==="passed"));
  assert.equal(events.at(-1)[0],"end");
});
