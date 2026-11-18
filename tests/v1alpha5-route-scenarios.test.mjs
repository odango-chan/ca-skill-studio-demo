import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  ROUTE_SCENARIO_API,makeNormalPathScenario,replayProcedureRouteScenario
} from "../site/v1alpha5-route-scenarios.mjs";

const root=new URL("../site/samples/v1alpha5/",import.meta.url);
const source=name=>new Map([["assurance/procedure.yaml",{
  text:readFileSync(new URL(name+"/assurance/procedure.yaml",root),"utf8")
}]]);
const normal=[
 ["get-sm-subscription-data",["precondition","operation","observation","postcondition"]],
 ["subscribe-sm-data",["operation","postcondition"]],
 ["establish-sm-policy-association",["operation","postcondition"]],
 ["establish-n4-session",["operation","postcondition"]],
 ["transfer-n1n2-message",["operation","postcondition"]],
 ["update-sm-context",["wait","operation","observation","postcondition"]],
 ["modify-n4-session",["operation","postcondition"]],
 ["ensure-uecm-registration",["operation","postcondition"]],
 ["prepare-step17-response",["observation"]],
 ["verify-pdu-session-establishment",["postcondition"]]
];
const mas=[
 ["validate-sm-subscription",["precondition","operation","observation","postcondition"]],
 ["skip-secondary-authentication",["operation","postcondition"]],
 ["create-sm-context",["operation","postcondition"]],
 ["register-uecm",["operation","postcondition"]],
 ["establish-sm-policy-association",["operation","postcondition"]],
 ["select-upf-anchor",["operation","postcondition"]],
 ["allocate-pdu-session-address",["operation","postcondition"]],
 ["modify-sm-policy-association",["operation","postcondition"]],
 ["execute-charging-step",["operation","postcondition"]],
 ["establish-n4-session",["operation","postcondition"]],
 ["signal-ue-and-access-network",["operation","postcondition"]],
 ["modify-n4-session",["operation","postcondition"]],
 ["record-session-establishment-event",["operation","postcondition"]],
 ["verify-pdu-session-establishment",["postcondition"]]
];
const full=makeNormalPathScenario("success-path",normal);
const fixtures=[{name:"establish-pdu-session",scenario:full},
 {name:"establish-pdu-session-mas",scenario:makeNormalPathScenario("mas-success",mas)}];

test("both v1alpha5 Examples have deterministic success Route traces, not qualified execution",()=>{
  for(const fixture of fixtures){
    const before=source(fixture.name);
    const original=before.get("assurance/procedure.yaml").text;
    const result=replayProcedureRouteScenario({files:before,scenario:fixture.scenario});
    assert.equal(result.status,"PASS",fixture.name+": "+result.reason);
    assert.equal(result.terminal,"SUCCEEDED");
    assert.equal(result.trace.length,fixture.scenario.steps.length);
    assert.equal(result.qualification,"NOT_QUALIFIED");
    assert.equal(result.scope,"ROUTE_TRACE_ONLY");
    assert.equal(before.get("assurance/procedure.yaml").text,original);
    assert.ok(result.trace.some(x=>x.transition==="stage-fallthrough"));
    assert.ok(result.trace.some(x=>x.transition==="explicit"));
  }
});
test("v1alpha5 Wait accepts only simulated EVENT_RECEIVED, never creates an extra business Stage",()=>{
  const result=replayProcedureRouteScenario({files:source("establish-pdu-session"),scenario:full});
  assert.equal(result.status,"PASS",result.reason);
  const wait=result.trace.find(x=>x.stage==="wait");
  assert.deepEqual(wait,{
    node:"update-sm-context",stage:"wait",outcome:"EVENT_RECEIVED",
    transition:"event-accepted",to:"update-sm-context.operation"
  });
});
test("Wait TIMEOUT routes SAFE_STOPPED without running the UpdateSMContext Operation",()=>{
  const steps=full.steps.slice(0,full.steps.findIndex(x=>x.stage==="wait"));
  steps.push({node:"update-sm-context",stage:"wait",outcome:"TIMEOUT"});
  const result=replayProcedureRouteScenario({files:source("establish-pdu-session"),
    scenario:{apiVersion:ROUTE_SCENARIO_API,id:"timeout",steps,expect:{terminal:"SAFE_STOPPED"}}});
  assert.equal(result.status,"PASS",result.reason);
  assert.equal(result.terminal,"SAFE_STOPPED");
  assert.equal(result.trace.at(-1).transition,"timeout");
  assert.ok(!result.trace.some(item=>item.node==="update-sm-context"&&item.stage==="operation"));
});
test("Precondition FAIL routes immediately to FAILED; no Operation is dispatched",()=>{
  const result=replayProcedureRouteScenario({files:source("establish-pdu-session"),
    scenario:{apiVersion:ROUTE_SCENARIO_API,id:"entry-rejected",
      steps:[{node:"get-sm-subscription-data",stage:"precondition",outcome:"FAIL"}],
      expect:{terminal:"FAILED"}}});
  assert.equal(result.status,"PASS",result.reason);
  assert.equal(result.trace.length,1);
});
test("READ UNKNOWN and DENIED are distinct safe terminal traces",()=>{
  for(const [outcome,terminal] of [["UNKNOWN","UNRESOLVED"],["DENIED","FAILED"]]){
    const result=replayProcedureRouteScenario({files:source("establish-pdu-session"),
      scenario:{apiVersion:ROUTE_SCENARIO_API,id:"read-"+outcome.toLowerCase(),
      steps:[
        {node:"get-sm-subscription-data",stage:"precondition",outcome:"PASS"},
        {node:"get-sm-subscription-data",stage:"operation",outcome}
      ],expect:{terminal}}});
    assert.equal(result.status,"PASS",outcome+": "+result.reason);
  }
});
test("missing scripted Outcome, unexpected node/stage and wrong expected terminal cannot pass",()=>{
  const files=source("establish-pdu-session");
  for(const scenario of [
    {...full,steps:full.steps.slice(0,3)},
    {...full,steps:[{node:"other",stage:"precondition",outcome:"PASS"}]},
    {...full,expect:{terminal:"FAILED"}}
  ]){
    const result=replayProcedureRouteScenario({files,scenario});
    assert.equal(result.status,"FAIL");
    assert.equal(result.qualification,"NOT_QUALIFIED");
  }
});
test("unsafe YAML and absent Procedure do not run simulated Route tests",()=>{
  for(const files of [new Map(),new Map([["assurance/procedure.yaml",{text:"start: [\n"}]])]){
    const result=replayProcedureRouteScenario({files,scenario:full});
    assert.equal(result.status,"NOT_RUN");
    assert.equal(result.terminal,null);
  }
});
test("a Route bypassing the final Postcondition may not manufacture SUCCEEDED",()=>{
  const files=source("establish-pdu-session");
  const original=files.get("assurance/procedure.yaml").text;
  const modified=original.replace(
    "        DENIED: FAILED\n    observation:",
    "        DENIED: SUCCEEDED\n    observation:");
  assert.notEqual(modified,original);
  files.get("assurance/procedure.yaml").text=modified;
  const result=replayProcedureRouteScenario({files,
    scenario:{apiVersion:ROUTE_SCENARIO_API,id:"invalid-success",
      steps:[
        {node:"get-sm-subscription-data",stage:"precondition",outcome:"PASS"},
        {node:"get-sm-subscription-data",stage:"operation",outcome:"DENIED"}
      ],expect:{terminal:"SUCCEEDED"}}});
  assert.equal(result.status,"FAIL");
  assert.match(result.reason,/Only final Postcondition PASS/);
});
test("unbounded or invalid scenario envelopes fail closed",()=>{
  const files=source("establish-pdu-session");
  for(const scenario of [
    null,{}, {...full,apiVersion:"other"},
    {...full,steps:[]}, {...full,expect:{terminal:"UNKNOWN"}},
    {...full,steps:[{node:"x",stage:"precondition",outcome:"SUCCEEDED"}]}
  ])assert.equal(replayProcedureRouteScenario({files,scenario}).status,"FAIL");
});
