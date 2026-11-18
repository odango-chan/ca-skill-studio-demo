// Studio-only deterministic Procedure route scenario replay (CA-SL v1alpha5).
// This is NOT a Runtime, Tool executor, Predicate evaluator, Ingress admission,
// Compiler verification or authoritative Evidence proof.
import {parseDocument,isMap,isScalar} from "yaml";

export const ROUTE_SCENARIO_API="skill-studio-route-scenario/v1";
const STAGES=["precondition","operation","observation","postcondition"];
const NORMAL={precondition:"PASS",operation:"SUCCEEDED",observation:"SUCCEEDED",postcondition:"PASS"};
const OUTCOMES={
  precondition:new Set(["PASS","FAIL","UNKNOWN"]),
  postcondition:new Set(["PASS","FAIL","UNKNOWN"]),
  operation:new Set(["SUCCEEDED","FAILED","DENIED","UNKNOWN","NOT_COMMITTED","OUTCOME_UNKNOWN","COMMITTED"]),
  observation:new Set(["SUCCEEDED","FAILED","DENIED","UNKNOWN"]),
  wait:new Set(["EVENT_RECEIVED","TIMEOUT"])
};
const TERMINALS=new Set(["SUCCEEDED","FAILED","UNRESOLVED","SAFE_STOPPED"]);
const MAX_STEPS=256;
const NODE_ID=/^[A-Za-z][A-Za-z0-9_-]*$/;
const readKey=(map,key)=>isMap(map)?map.get(key,true):undefined;
const string=node=>isScalar(node)&&typeof node.value==="string"?node.value:null;
const failure=(status,reason,trace=[],terminal=null)=>Object.freeze({
  status,reason,trace:Object.freeze(trace),terminal,
  scope:"ROUTE_TRACE_ONLY",qualification:"NOT_QUALIFIED"
});

function parseGraph(files){
  const entry=files instanceof Map?files.get("assurance/procedure.yaml"):null;
  const text=typeof entry==="string"?entry:entry?.text;
  if(typeof text!=="string"||text.length>1024*1024)
    throw Error("Procedure source unavailable or over 1 MiB");
  const parsed=parseDocument(text,{version:"1.2",schema:"core",strict:true,uniqueKeys:true,logLevel:"silent"});
  if(parsed.errors.length||!isMap(parsed.contents))
    throw Error("Procedure YAML not safely parseable");
  const start=string(readKey(parsed.contents,"start"));
  const raw=readKey(parsed.contents,"nodes");
  if(!start||!isMap(raw)||!raw.items.length||raw.items.length>128)
    throw Error("Procedure start/nodes unavailable");
  const nodes=new Map();
  for(const pair of raw.items){
    const id=string(pair.key),body=pair.value;
    if(!id||!NODE_ID.test(id)||TERMINALS.has(id)||!isMap(body))
      throw Error("Invalid Procedure Node identity or shape");
    const stages=STAGES.filter(stage=>readKey(body,stage)!==undefined);
    const hasWait=readKey(body,"wait")!==undefined;
    if(!stages.length)throw Error("A Procedure Node needs a business Stage");
    if(nodes.has(id))throw Error("Duplicate Procedure Node");
    const stageRoutes=new Map();
    for(const stage of stages){
      const value=readKey(body,stage);
      if(!isMap(value))throw Error("Invalid "+stage+" Stage shape");
      const routes=readKey(value,"routes");
      if(routes!==undefined&&!isMap(routes))throw Error("Stage routes must be a mapping");
      stageRoutes.set(stage,readRoutes(routes));
    }
    const wait=readKey(body,"wait");
    let waitRoutes=null;
    if(hasWait){
      if(!isMap(wait))throw Error("Invalid Node-entry Wait shape");
      waitRoutes=readRoutes(readKey(wait,"routes"));
      if(waitRoutes.size!==1||!waitRoutes.has("TIMEOUT"))
        throw Error("Wait must have exactly one TIMEOUT route");
    }
    nodes.set(id,{id,stages,hasWait,waitRoutes,stageRoutes});
  }
  if(!nodes.has(start))throw Error("Procedure start Node is not declared");
  return {start,nodes};
}
function readRoutes(map){
  const routes=new Map();
  if(map===undefined)return routes;
  if(!isMap(map))throw Error("Routes must be a YAML mapping");
  for(const pair of map.items){
    const key=string(pair.key),dest=string(pair.value);
    if(!key||!dest||routes.has(key))throw Error("Invalid or duplicate Route mapping");
    routes.set(key,dest);
  }
  return routes;
}
function normalizeScenario(value){
  if(!value||typeof value!=="object"||Array.isArray(value)||
     value.apiVersion!==ROUTE_SCENARIO_API||
     typeof value.id!=="string"||!NODE_ID.test(value.id)||
     !Array.isArray(value.steps)||!value.steps.length||value.steps.length>MAX_STEPS||
     !TERMINALS.has(value.expect?.terminal))
    throw Error("Invalid Studio route scenario envelope");
  const steps=value.steps.map((step,i)=>{
    if(!step||typeof step!=="object"||typeof step.node!=="string"||
       typeof step.stage!=="string"||typeof step.outcome!=="string"||
       !OUTCOMES[step.stage]?.has(step.outcome))
      throw Error("Invalid scripted Stage Outcome at index "+i);
    return {node:step.node,stage:step.stage,outcome:step.outcome};
  });
  return {id:value.id,steps,expectedTerminal:value.expect.terminal};
}

/**
 * Replay ONLY explicit simulated Stage Outcomes. A synthetic PASS at the final
 * Postcondition is a test assertion, not accepted Predicate/Evidence proof.
 * Missing events, missing routes, ambiguous graph or an unexpected transition
 * must never be converted to successful execution.
 */
export function replayProcedureRouteScenario({files,scenario}={}){
  let script,graph;
  try{
    script=normalizeScenario(scenario);
  }catch(error){return failure("FAIL",String(error?.message??error));}
  try{
    graph=parseGraph(files);
  }catch(error){return failure("NOT_RUN",String(error?.message??error));}
  let nodeId=graph.start;
  let stageIndex=graph.nodes.get(nodeId).hasWait?-1:0;
  const trace=[],visited=new Set();
  let terminal=null;
  for(let i=0;i<script.steps.length;i++){
    const node=graph.nodes.get(nodeId);
    if(!node)return failure("FAIL","Route target references undeclared Node: "+nodeId,trace);
    const stage=stageIndex<0?"wait":node.stages[stageIndex];
    const scripted=script.steps[i];
    if(scripted.node!==nodeId||scripted.stage!==stage)
      return failure("FAIL","Scenario step "+(i+1)+" expected "+nodeId+"."+stage+
        " but scripted "+scripted.node+"."+scripted.stage,trace);
    const visit=nodeId+"."+stage;
    if(visited.has(visit))return failure("FAIL","Repeated Stage in a single path: "+visit,trace);
    visited.add(visit);
    let dest=null,routeKind=null;
    if(stage==="wait"){
      if(scripted.outcome==="EVENT_RECEIVED"){
        stageIndex=0;routeKind="event-accepted";
      }else{
        dest=node.waitRoutes.get("TIMEOUT");
        routeKind="timeout";
      }
    }else{
      const normal=NORMAL[stage]===scripted.outcome;
      const routes=node.stageRoutes.get(stage);
      if(normal&&stageIndex+1<node.stages.length){
        if(routes.has(scripted.outcome))
          return failure("FAIL","Normal non-final Outcome must not declare a Route: "+visit,trace);
        stageIndex++;
        routeKind="stage-fallthrough";
      }else{
        dest=routes.get(scripted.outcome);
        if(!dest)return failure("FAIL","No explicit Route for "+visit+" outcome "+scripted.outcome,trace);
        routeKind="explicit";
      }
    }
    if(dest!==null){
      if(TERMINALS.has(dest)){
        if(dest==="SUCCEEDED"&&!(stage==="postcondition"&&scripted.outcome==="PASS"))
          return failure("FAIL","Only final Postcondition PASS may request SUCCEEDED",trace);
        terminal=dest;
      }else if(graph.nodes.has(dest)){
        nodeId=dest;
        stageIndex=graph.nodes.get(nodeId).hasWait?-1:0;
      }else return failure("FAIL","Dangling Route target: "+dest,trace);
    }
    trace.push(Object.freeze({
      node:scripted.node,stage,outcome:scripted.outcome,
      transition:routeKind,to:dest??(stage==="wait"?nodeId+"."+node.stages[0]:
        nodeId+"."+node.stages[stageIndex])
    }));
    if(terminal!==null){
      if(i!==script.steps.length-1)
        return failure("FAIL","Scenario scripts additional stages after terminal "+terminal,trace,terminal);
      return failure(terminal===script.expectedTerminal?"PASS":"FAIL",
        terminal===script.expectedTerminal
          ?"Scripted Route trace reached the expected terminal request (NOT Runtime publication)"
          :"Expected "+script.expectedTerminal+" but trace requested "+terminal,
        trace,terminal);
    }
  }
  return failure("FAIL","Scenario ended before reaching any terminal route",trace);
}

export function makeNormalPathScenario(id,nodeStages,terminal="SUCCEEDED"){
  if(!Array.isArray(nodeStages)||!nodeStages.length)throw Error("Expected explicit Node/Stage fixture");
  const steps=[];
  for(const [node,stages] of nodeStages)
    for(const stage of stages)
      steps.push({node,stage,outcome:stage==="wait"?"EVENT_RECEIVED":NORMAL[stage]});
  return {
    apiVersion:ROUTE_SCENARIO_API,id,steps,expect:{terminal}
  };
}
