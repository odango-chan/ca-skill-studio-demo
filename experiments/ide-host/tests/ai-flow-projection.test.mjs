import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  projectAiReviewProcedure,compareAiReviewProcedures,buildAiFlowGraphReview
} from "../vscode/src/ai-flow-projection.mjs";

const root="../../site/samples/v1alpha5/establish-pdu-session-mas/assurance/";
function read(name){return readFileSync(new URL(root+name,import.meta.url),"utf8");}
const source=read("procedure.yaml");
const docs=[
  {relativePath:"assurance/procedure.yaml",uri:"file:///sample/assurance/procedure.yaml",version:4,text:source},
  {relativePath:"assurance/contract.yaml",uri:"file:///sample/assurance/contract.yaml",version:4,text:read("contract.yaml")},
  {relativePath:"assurance/predicates.yaml",uri:"file:///sample/assurance/predicates.yaml",version:4,text:read("predicates.yaml")}
];
const snapshot={completeness:"complete",packageName:"establish-pdu-session-mas",documents:docs};

test("AI flow review is the EXACT current CA-SL v1alpha5 Procedure source projection",()=>{
  const before=projectAiReviewProcedure(snapshot,source);
  assert.equal(before.start,"validate-sm-subscription");
  assert.ok(before.nodes.some(x=>x.id==="skip-secondary-authentication"));
  assert.ok(before.routes.some(x=>x.source==="validate-sm-subscription"&&
    x.routeSource==="postcondition"&&x.outcome==="PASS"&&
    x.target==="skip-secondary-authentication"));
  assert.ok(before.nodes.some(x=>x.viewOnly));
  assert.equal(docs[0].text,source);
});

test("AI flow review precisely finds retargeted Route and associates only a planned group",()=>{
  const candidate=source.replace("PASS: skip-secondary-authentication",
    "PASS: create-sm-context");
  assert.notEqual(candidate,source);
  const flowGroups=[{id:"group-1",label:"Reroute postcondition",operations:[{
    type:"stage.route.set",nodeId:"validate-sm-subscription",
    stage:"postcondition",outcome:"PASS",toNodeId:"create-sm-context",rationale:"Test",references:[]
  }]}];
  const graph=buildAiFlowGraphReview({snapshot,baseSource:source,candidateSource:candidate,flowGroups});
  assert.equal(graph.available,true);
  assert.equal(graph.qualified,false);
  assert.equal(graph.languageTarget,"connectionagent.io/v1alpha5");
  assert.equal(graph.before.nodes.length,graph.after.nodes.length);
  assert.equal(graph.before.routes.length,graph.after.routes.length);
  const change=graph.change.routes.find(x=>x.source==="validate-sm-subscription"&&
    x.routeSource==="postcondition"&&x.outcome==="PASS");
  assert.equal(change.status,"retargeted");
  assert.equal(change.baseTarget,"skip-secondary-authentication");
  assert.equal(change.candidateTarget,"create-sm-context");
  assert.deepEqual(change.groupIds,["group-1"]);
  assert.ok(change.baseLine>0&&change.candidateLine>0);
  assert.equal(graph.change.counts.changedRoutes,1);
});

test("AI flow review detects added node and preserves exact endpoint accounting",()=>{
  const base=projectAiReviewProcedure(snapshot,source);
  const text=source.replace("PASS: skip-secondary-authentication",
    "PASS: new-secondary");
  const candidate=text+"\n  new-secondary:\n    operation:\n      tool: mas::SAA.SECONDARY_AUTH\n      arguments:\n        ue_identity: context.supi\n        required: \"0\"\n      routes:\n        FAILED: FAILED\n        OUTCOME_UNKNOWN: UNRESOLVED\n        DENIED: FAILED\n    postcondition:\n      predicates:\n        - predicate: establishment.mas.secondary_auth_skipped\n          arguments:\n            - new-secondary.operation.output\n      routes:\n        PASS: create-sm-context\n        FAIL: FAILED\n        UNKNOWN: UNRESOLVED\n";
  const after=projectAiReviewProcedure(snapshot,candidate);
  const d=compareAiReviewProcedures(base,after,[{id:"group-new",operations:[
    {nodeId:"new-secondary",type:"node.add"},
    {nodeId:"validate-sm-subscription",stage:"postcondition",outcome:"PASS",type:"stage.route.set"}
  ]}]);
  const added=d.nodes.find(n=>n.id==="new-secondary");
  assert.equal(added.status,"added");
  assert.deepEqual(added.groupIds,["group-new"]);
  assert.equal(d.counts.addedNodes,1);
  assert.ok(d.counts.candidateRoutes>d.counts.baseRoutes);
});

test("AI flow review fails closed for invalid YAML, stale or missing Package and malformed projection",()=>{
  assert.throws(()=>projectAiReviewProcedure({...snapshot,completeness:"partial"},source),/complete Package/);
  assert.throws(()=>projectAiReviewProcedure(snapshot,"start: bad\nnodes: { bad: }"),/unavailable/);
  assert.throws(()=>buildAiFlowGraphReview({snapshot,baseSource:source,candidateSource:"not yaml"}),
    /unavailable/);
  const before=projectAiReviewProcedure(snapshot,source);
  assert.throws(()=>compareAiReviewProcedures(before,{
    ...before,routes:[...before.routes,{...before.routes[0]}]
  }),/duplicated Route/);
  assert.equal(snapshot.documents[0].text,source);
});
