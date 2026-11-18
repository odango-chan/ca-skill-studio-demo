import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  BUILTIN_ROUTE_SCENARIOS,discoverAuthoredRouteScenarios,
  ROUTE_TEST_SUITE_API,runRouteScenarioSuite
} from "../site/v1alpha5-route-test-suite.mjs";

const root=new URL("../site/samples/v1alpha5/",import.meta.url);
const source=packageName=>new Map([["assurance/procedure.yaml",{
  text:readFileSync(new URL(packageName+"/assurance/procedure.yaml",root),"utf8")
}]]);
const simple=id=>JSON.stringify({
  apiVersion:"skill-studio-route-scenario/v1",id,
  steps:[{node:"get-sm-subscription-data",stage:"precondition",outcome:"FAIL"}],
  expect:{terminal:"FAILED"}
});

test("the v1alpha5 5GC and MAS Example route suites pass without Runtime claims",()=>{
  for(const [name,count] of [["establish-pdu-session",5],
    ["establish-pdu-session-mas",2]]){
    const files=source(name);
    const old=files.get("assurance/procedure.yaml").text;
    const result=runRouteScenarioSuite({files,packageName:name});
    assert.equal(result.apiVersion,ROUTE_TEST_SUITE_API);
    assert.deepEqual(result.summary,{PASS:count,FAIL:0,NOT_RUN:0},name);
    assert.equal(result.scope,"STUDIO_ROUTE_SCENARIO_ONLY");
    assert.equal(result.qualification,"NOT_QUALIFIED");
    assert.ok(result.results.every(item=>item.trace.length>0));
    assert.equal(files.get("assurance/procedure.yaml").text,old);
  }
});
test("author-created tests/*.route-scenario.json are read-only, selected and repeatable",()=>{
  const files=source("establish-pdu-session");
  files.set("tests/entry-rejected.route-scenario.json",{text:simple("entry-rejected")});
  const all=runRouteScenarioSuite({files,packageName:"establish-pdu-session"});
  assert.deepEqual(all.summary,{PASS:6,FAIL:0,NOT_RUN:0});
  const id="authored:tests/entry-rejected.route-scenario.json";
  const selected=runRouteScenarioSuite({files,packageName:"establish-pdu-session",include:[id]});
  assert.deepEqual(selected.summary,{PASS:1,FAIL:0,NOT_RUN:0});
  assert.equal(selected.results[0].terminal,"FAILED");
  assert.equal(selected.results[0].trace[0].transition,"explicit");
});
test("invalid authored JSON and duplicate logical IDs never silently PASS",()=>{
  const files=source("establish-pdu-session");
  files.set("tests/a.route-scenario.json",{text:simple("same-id")});
  files.set("tests/b.route-scenario.json",{text:simple("same-id")});
  files.set("tests/c.route-scenario.json",{text:"{bad"});
  const cases=discoverAuthoredRouteScenarios(files);
  assert.equal(cases.length,3);
  assert.match(cases[1].invalidReason,/duplicate/);
  assert.match(cases[2].invalidReason,/Invalid scenario JSON/);
  const result=runRouteScenarioSuite({files,packageName:"establish-pdu-session"});
  assert.deepEqual(result.summary,{PASS:6,FAIL:2,NOT_RUN:0});
});
test("foreign paths and too many scenario sidecars do not widen Suite access",()=>{
  const files=source("establish-pdu-session");
  files.set("../tests/x.route-scenario.json",{text:simple("x")});
  files.set("tests/subdir/x.route-scenario.json",{text:simple("x")});
  assert.deepEqual(discoverAuthoredRouteScenarios(files),[]);
  for(let i=0;i<33;i++)
    files.set("tests/s"+String(i).padStart(2,"0")+".route-scenario.json",
      {text:simple("test"+i)});
  const choices=discoverAuthoredRouteScenarios(files);
  assert.equal(choices.length,33);
  assert.match(choices.at(-1).invalidReason,/At most 32/);
});
test("incomplete selected Package produces NOT_RUN rather than successful execution",()=>{
  const results=runRouteScenarioSuite({
    files:null,packageName:"establish-pdu-session"
  });
  assert.deepEqual(results.summary,{PASS:0,FAIL:0,NOT_RUN:5});
});
test("stale/unknown case IDs remain visible as failures instead of passing invisibly",()=>{
  const files=source("establish-pdu-session");
  const result=runRouteScenarioSuite({files,packageName:"establish-pdu-session",
    include:["authored:tests/removed.route-scenario.json"]});
  assert.deepEqual(result.summary,{PASS:0,FAIL:1,NOT_RUN:0});
  assert.match(result.results[0].reason,/not present/);
  assert.equal(BUILTIN_ROUTE_SCENARIOS.length,7);
});
