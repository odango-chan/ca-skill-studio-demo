import test from "node:test";
import assert from "node:assert/strict";
import {createSessionProposalHistory,buildRefinementTask} from "../proposal-history.mjs";

const changeSet=n=>({
  taskId:"task-"+n,
  summary:"change route",
  base:{documentVersion:4,sourceDigest:"sha256:"+"a".repeat(64)},
  operations:[{id:"host-generated-id",type:"stage.route.set",
    target:{nodeId:"check",stage:"postcondition",outcome:"FAIL"},
    payload:{to:"FAILED"},rationale:"reason"}]
});
const view=()=>({type:"proposal",canApply:true,compilerState:"PASS",
  candidateDigest:"sha256:"+"b".repeat(64),groups:[{id:"group-a"}]});

test("F4 history is session-only, bounded and never restores Apply authority",()=>{
  const history=createSessionProposalHistory({limit:2});
  const first=history.record({task:"initial",changeSet:changeSet(1),
    generation:2,groupCount:1,compilerState:"PASS",view:view()});
  assert.equal(first.number,1);
  assert.equal(history.list()[0].compilerState,"PASS");
  const inspected=history.inspect(first.id);
  assert.equal(inspected.canApply,false);
  assert.equal(inspected.readonly,true);
  assert.equal(inspected.type,"historyInspect");
  inspected.groups[0].id="modified-client-copy";
  assert.equal(history.inspect(first.id).groups[0].id,"group-a");
  history.record({task:"refine",changeSet:changeSet(2),
    generation:2,groupCount:1,compilerState:"FAIL",reason:"E_VALIDATION",view:view()});
  history.record({task:"third",changeSet:changeSet(3),
    generation:3,groupCount:0,compilerState:"UNAVAILABLE",view:view()});
  assert.deepEqual(history.list().map(x=>x.number),[3,2]);
  assert.equal(history.inspect(first.id),null);
  history.clear();
  assert.deepEqual(history.list(),[]);
});

test("F4 refinement sends semantic context but never Host-owned IDs or source offsets",()=>{
  const result=buildRefinementTask(changeSet(1),"Keep the same terminal and adjust the rationale.");
  assert.match(result,/REFINE THE PREVIOUS SEMANTIC PROPOSAL/);
  assert.match(result,/stage.route.set/);
  assert.match(result,/Keep the same terminal/);
  assert.doesNotMatch(result,/host-generated-id|sourceDigest|documentVersion|workspaceEdit/);
  assert.throws(()=>buildRefinementTask(changeSet(1),"x".repeat(1601)),/1600/);
  const huge = changeSet(1);
  huge.operations = Array.from({length:15},(_,index)=>({
    id:"host-"+index,type:"node.add",target:{nodeId:"node-"+index},
    payload:{definition:{notes:"semantic-".repeat(50)}},
  }));
  assert.throws(()=>buildRefinementTask(huge,"Keep every operation."),
    /lossless Refine budget/, "Refine must not silently drop older semantic operations");
  assert.throws(()=>createSessionProposalHistory({limit:13}),/limit/);
});
