import test from "node:test";
import assert from "node:assert/strict";
import {
  createAuthoringLineDiff,createAuthoringFlowChanges,createAuthoringValidationView,
} from "../review-presentation.mjs";

test("AI review diff reports accurate original/candidate line numbers without source mutation",()=>{
  const original="start: a\nnodes:\n  a: hello\n  b: old\n  c: same\n";
  const candidate="start: a\nnodes:\n  a: hello\n  b: new\n  c: same\n";
  const diff=createAuthoringLineDiff(original,candidate);
  assert.equal(diff.changed,true);
  assert.equal(diff.added,1);
  assert.equal(diff.removed,1);
  assert.deepEqual(diff.rows.filter(x=>x.kind==="removed")
    .map(x=>[x.beforeLine,x.text]),[[4,"  b: old"]]);
  assert.deepEqual(diff.rows.filter(x=>x.kind==="added")
    .map(x=>[x.afterLine,x.text]),[[4,"  b: new"]]);
  assert.equal(diff.truncated,false);
  assert.equal(original.includes("b: old"),true);
});

test("AI review diff distinguishes multiple separate edits and collapses only unchanged spans",()=>{
  const original=Array.from({length:100},(_,i)=>"line "+i).join("\n");
  const candidate=original.replace("line 9\n","line TEN\n").replace("line 90\n","line NINETY\n");
  const diff=createAuthoringLineDiff(original,candidate);
  assert.equal(diff.added,2);
  assert.equal(diff.removed,2);
  assert.ok(diff.rows.some(x=>x.kind==="omitted"&&x.count>50));
  assert.deepEqual(diff.rows.filter(x=>x.kind==="added")
    .map(x=>x.afterLine),[10,91]);
});

test("AI review diff bounds huge rendering, discloses truncated output and line ending changes",()=>{
  const old=Array.from({length:1000},(_,i)=>"old "+i).join("\n");
  const candidate=Array.from({length:1000},(_,i)=>"new "+i).join("\n");
  const diff=createAuthoringLineDiff(old,candidate,{maxRows:100});
  assert.equal(diff.added,1000);
  assert.equal(diff.removed,1000);
  assert.equal(diff.truncated,true);
  assert.ok(diff.rows.length<=101);
  assert.ok(diff.rows.some(x=>x.truncated));
  const normalized=createAuthoringLineDiff("a\r\nb\r\n","a\nb\n");
  assert.equal(normalized.changed,true);
  assert.equal(normalized.lineEndingsOnly,true);
  assert.equal(normalized.added,0);
  assert.throws(()=>createAuthoringLineDiff("","",{maxRows:5}),/Diff display limit/);
});

test("AI semantic outline uses only Patch Plan groups and never asserts a qualified flow graph",()=>{
  const changes=createAuthoringFlowChanges({
    operations:[
      {id:"op1",type:"stage.route.set",target:{nodeId:"verify",stage:"postcondition",outcome:"FAIL"},
        payload:{targetNodeId:"FAILED"},rationale:"Use the defined terminal.",references:["procedure-current"]},
      {id:"op2",type:"node.add",target:{nodeId:"unrelated"},payload:{definition:{operation:{}}},
        rationale:"not part of the planned groups",references:[]},
    ]
  },{groups:[{id:"group1",label:"Route change",operationIds:["op1"]}]});
  assert.equal(changes.length,1);
  assert.equal(changes[0].operations.length,1);
  assert.deepEqual(changes[0].operations[0],{
    id:"op1",type:"stage.route.set",nodeId:"verify",stage:"postcondition",
    outcome:"FAIL",toNodeId:"FAILED",rationale:"Use the defined terminal.",
    references:["procedure-current"]
  });
  assert.throws(()=>createAuthoringFlowChanges({operations:[]},
    {groups:[{id:"forged",operationIds:["unknown"]}]}),/unknown operation/);
});

test("AI review Compiler diagnostics are derived from exact Check state without making qualification claims",()=>{
  const data=createAuthoringValidationView({
    compilerVersion:"v2.0.2",state:"FAIL",errorCount:1,warningCount:1,
    diagnostics:[
      {severity:"error",code:"E123",message:"Missing Owner trust",path:"assurance/procedure.yaml",line:30},
      {severity:"warning",code:"W1",message:"Review context"},
    ]
  },"sha256:"+"a".repeat(64));
  assert.equal(data.state,"FAIL");
  assert.equal(data.errorCount,1);
  assert.deepEqual(data.diagnostics[0],{
    severity:"error",code:"E123",message:"Missing Owner trust",
    path:"assurance/procedure.yaml",line:30
  });
  assert.equal(data.diagnostics[1].line,null);
  assert.equal(createAuthoringValidationView(null,null).state,"NOT_RUN");
});
