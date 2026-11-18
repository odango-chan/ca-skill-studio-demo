// Studio-only route scenario suite. "PASS" means an explicit mock Outcome trace
// followed the authored Procedure routes, not that any Tool, Predicate,
// Evidence or Runtime has been executed or qualified.
import {
  ROUTE_SCENARIO_API,makeNormalPathScenario,replayProcedureRouteScenario
} from "./v1alpha5-route-scenarios.mjs";

export const ROUTE_TEST_SUITE_API="skill-studio-route-test-results/v1";
const MAX_AUTHORED=32,MAX_SCENARIO_TEXT=128*1024;
const SIDECAR=/^tests\/[A-Za-z0-9][A-Za-z0-9._-]{0,79}\.route-scenario\.json$/;
const stage=(node,stage,outcome)=>({node,stage,outcome});
const path5gc=[
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
const pathMas=[
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
const success5gc=makeNormalPathScenario("success-5gc",path5gc);
const successMas=makeNormalPathScenario("success-mas",pathMas);
const waitIndex=success5gc.steps.findIndex(x=>x.stage==="wait");
const timeout5gc={
  apiVersion:ROUTE_SCENARIO_API,id:"timeout-5gc",
  steps:[...success5gc.steps.slice(0,waitIndex),
    stage("update-sm-context","wait","TIMEOUT")],
  expect:{terminal:"SAFE_STOPPED"}
};
const builtins=Object.freeze([
  {id:"builtin:5gc-success",packageName:"establish-pdu-session",
    label:"5GC · Normal Route to final Postcondition",scenario:success5gc},
  {id:"builtin:5gc-timeout",packageName:"establish-pdu-session",
    label:"5GC · Step 15 Wait TIMEOUT safely stops",scenario:timeout5gc},
  {id:"builtin:5gc-precondition-fail",packageName:"establish-pdu-session",
    label:"5GC · Entry Precondition FAIL",scenario:{
      apiVersion:ROUTE_SCENARIO_API,id:"entry-fail",
      steps:[stage("get-sm-subscription-data","precondition","FAIL")],
      expect:{terminal:"FAILED"}
    }},
  {id:"builtin:5gc-read-unknown",packageName:"establish-pdu-session",
    label:"5GC · READ UNKNOWN is unresolved",scenario:{
      apiVersion:ROUTE_SCENARIO_API,id:"read-unknown",
      steps:[stage("get-sm-subscription-data","precondition","PASS"),
        stage("get-sm-subscription-data","operation","UNKNOWN")],
      expect:{terminal:"UNRESOLVED"}
    }},
  {id:"builtin:5gc-read-denied",packageName:"establish-pdu-session",
    label:"5GC · READ DENIED is rejected",scenario:{
      apiVersion:ROUTE_SCENARIO_API,id:"read-denied",
      steps:[stage("get-sm-subscription-data","precondition","PASS"),
        stage("get-sm-subscription-data","operation","DENIED")],
      expect:{terminal:"FAILED"}
    }},
  {id:"builtin:mas-success",packageName:"establish-pdu-session-mas",
    label:"MAS · Normal Route to final Postcondition",scenario:successMas},
  {id:"builtin:mas-precondition-fail",packageName:"establish-pdu-session-mas",
    label:"MAS · Entry Precondition FAIL",scenario:{
      apiVersion:ROUTE_SCENARIO_API,id:"mas-entry-fail",
      steps:[stage("validate-sm-subscription","precondition","FAIL")],
      expect:{terminal:"FAILED"}
    }}
].map(item=>Object.freeze(item)));

export const BUILTIN_ROUTE_SCENARIOS=builtins;

export function discoverAuthoredRouteScenarios(files){
  if(!(files instanceof Map))return [];
  const matched=[...files.entries()]
    .filter(([path])=>SIDECAR.test(path))
    .sort(([a],[b])=>a.localeCompare(b));
  const records=[];
  const seen=new Set();
  for(const [index,[path,value]] of matched.entries()){
    const id="authored:"+path,label=path;
    const invalid=reason=>({id,label,packageName:null,path,source:"authored",
      scenario:null,invalidReason:reason});
    if(index>=MAX_AUTHORED){
      records.push(invalid("At most 32 Package-local scenario files are supported"));
      continue;
    }
    const text=typeof value==="string"?value:value?.text;
    if(typeof text!=="string"||text.length>MAX_SCENARIO_TEXT){
      records.push(invalid("Scenario file is not UTF-8 text or exceeds 128 KiB"));
      continue;
    }
    try{
      const scenario=JSON.parse(text);
      if(typeof scenario?.id!=="string"||seen.has(scenario.id)){
        records.push(invalid("Missing or duplicate authored scenario id"));
        continue;
      }
      seen.add(scenario.id);
      records.push({id,label:scenario.id,packageName:null,path,
        source:"authored",scenario,invalidReason:null});
    }catch(error){
      records.push(invalid("Invalid scenario JSON: "+String(error?.message??error)));
    }
  }
  return records;
}

export function runRouteScenarioSuite({
  files,packageName,include=null
}={}){
  const authored=discoverAuthoredRouteScenarios(files);
  const choices=[
    ...builtins.filter(item=>item.packageName===packageName),
    ...authored
  ];
  if(include!==null&&(!Array.isArray(include)||new Set(include).size!==include.length||
     include.some(id=>typeof id!=="string")))
    throw Error("Invalid Route test selection");
  const selected=include===null?choices:
    include.map(id=>choices.find(item=>item.id===id)??{
      id,label:id,source:"unknown",invalidReason:"Scenario is not present in this Package"
    });
  const results=selected.map(item=>{
    if(item.invalidReason)return Object.freeze({
      id:item.id,label:item.label,status:"FAIL",reason:item.invalidReason,
      terminal:null,trace:[],source:item.source??"unknown"
    });
    if(!(files instanceof Map))return Object.freeze({
      id:item.id,label:item.label,status:"NOT_RUN",
      reason:"No complete Package source snapshot",terminal:null,trace:[],
      source:item.source??"builtin"
    });
    const result=replayProcedureRouteScenario({files,scenario:item.scenario});
    return Object.freeze({
      id:item.id,label:item.label,source:item.source??"builtin",
      status:result.status,reason:result.reason,
      terminal:result.terminal,trace:result.trace
    });
  });
  return Object.freeze({
    apiVersion:ROUTE_TEST_SUITE_API,
    scope:"STUDIO_ROUTE_SCENARIO_ONLY",qualification:"NOT_QUALIFIED",
    summary:Object.freeze({
      PASS:results.filter(item=>item.status==="PASS").length,
      FAIL:results.filter(item=>item.status==="FAIL").length,
      NOT_RUN:results.filter(item=>item.status==="NOT_RUN").length
    }),
    results:Object.freeze(results)
  });
}
