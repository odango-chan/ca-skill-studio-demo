import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {projectWorkspace} from "../site/workspace.mjs";
import {nodeAttributeState,previewNodeOperatorValue,applyNodeOperatorValue,
        previewNodeBindingFrom,applyNodeBindingFrom} from "../site/node-attributes.mjs";
const read=(skill,path)=>readFileSync(new URL(
  "../site/samples/packages/"+skill+"/assurance/"+path,import.meta.url),"utf8");
const ensure=read("ensure-pdu-session","procedure.yaml");
const ensurePred=read("ensure-pdu-session","predicates.yaml");
const created=read("establish-pdu-session","procedure.yaml");
const createdPred=read("establish-pdu-session","predicates.yaml");
const entry=projectWorkspace(created).entry;
const skill="establish-pdu-session";

test("A4 call Operator value is a one-span source patch, not a kind conversion",()=>{
  const opts=nodeAttributeState(ensure,"ensure-session","create-session",
    ensurePred,"ensure-pdu-session");
  assert.equal(opts.operator.operator,"call");
  assert.equal(opts.operator.value,"pdu_session.create");
  const p=previewNodeOperatorValue(ensure,"ensure-session","create-session",
    "pdu_session.reconcile");
  const next=applyNodeOperatorValue(ensure,p);
  assert.equal(projectWorkspace(next).procedure.nodes.find(n=>n.id==="create-session").value,
    "pdu_session.reconcile");
  assert.equal(next,ensure.slice(0,p.sourceSpan.start)+p.newValue+
    ensure.slice(p.sourceSpan.end));
  assert.match(p.diff,/call: pdu_session.create/);
  assert.equal(ensure,read("ensure-pdu-session","procedure.yaml"));
});
test("A4 verify/terminal choices grounded in matching active Package and Procedure",()=>{
  const opts=nodeAttributeState(ensure,"ensure-session","observe-target-session",
    ensurePred,"ensure-pdu-session");
  assert.ok(opts.operator.values.includes("pdu_session.absent"));
  const p=previewNodeOperatorValue(ensure,"ensure-session","observe-target-session",
    "pdu_session.absent",ensurePred,"ensure-pdu-session");
  assert.equal(applyNodeOperatorValue(ensure,p,ensurePred,"ensure-pdu-session"),
    p.candidateSource);
  assert.throws(()=>previewNodeOperatorValue(ensure,"ensure-session","observe-target-session",
    "invalid.predicate",ensurePred,"ensure-pdu-session"));
  assert.throws(()=>applyNodeOperatorValue(ensure,p,ensurePred,"different-skill"));
  const terminal=nodeAttributeState(ensure,"ensure-session","safe-stopped");
  assert.ok(terminal.operator.values.includes("FAILED"));
  const changed=previewNodeOperatorValue(ensure,"ensure-session",
    "safe-stopped","FAILED");
  assert.equal(projectWorkspace(applyNodeOperatorValue(ensure,changed)).state,"READY");
});
test("A4 with.foo.from stays under its exact source key, no other binding changes",()=>{
  const opts=nodeAttributeState(ensure,"ensure-session","create-session");
  const supi=opts.bindings.find(x=>x.key==="supi");
  assert.equal(supi.value,"input.supi");
  assert.ok(supi.choices.includes("input.dnn"));
  const p=previewNodeBindingFrom(ensure,"ensure-session","create-session",
    "supi","input.dnn");
  const next=applyNodeBindingFrom(ensure,p);
  assert.match(next,/supi:\n            from: input.dnn/);
  assert.match(next,/pduSessionId:\n            from: input.pdu-session-id/);
  assert.equal(projectWorkspace(next).state,"READY");
  assert.deepEqual(projectWorkspace(next).procedure.routes.map(r=>[r.id,r.target]),
    projectWorkspace(ensure).procedure.routes.map(r=>[r.id,r.target]));
  assert.equal(next,ensure.slice(0,p.sourceSpan.start)+"input.dnn"+
    ensure.slice(p.sourceSpan.end));
});
test("A4 CreatedSession reuses current Package bindings without CreatedSession-specific rules",()=>{
  const state=nodeAttributeState(created,entry,"nudm-sdm-get",createdPred,skill);
  const binding=state.bindings.find(b=>b.key==="ueRef");
  assert.equal(binding.value,"input.ue-ref");
  assert.ok(binding.choices.includes("input.psi"));
  const p=previewNodeBindingFrom(created,entry,"nudm-sdm-get","ueRef","input.psi");
  const next=applyNodeBindingFrom(created,p);
  assert.equal(projectWorkspace(next).state,"READY");
  assert.equal(projectWorkspace(next).procedures.size,6);
  assert.equal(next,created.slice(0,p.sourceSpan.start)+"input.psi"+
    created.slice(p.sourceSpan.end));
});
test("A4 procedure references cannot point to self or create recursive calls",()=>{
  const state=nodeAttributeState(created,entry,"n4-session-establishment",createdPred,skill);
  assert.equal(state.operator.operator,"procedure");
  assert.ok(state.operator.values.includes(entry));
  assert.throws(()=>previewNodeOperatorValue(created,entry,"n4-session-establishment",
    entry,createdPred,skill));
  assert.throws(()=>previewNodeOperatorValue(created,entry,"n4-session-establishment",
    "nonexistent-child",createdPred,skill));
});
test("A4 refuses quoted scalars, unknown binding paths and duplicate/replaced previews",()=>{
  const quoted=ensure.replace("from: input.supi","from: 'input.supi'");
  assert.equal(projectWorkspace(quoted).state,"READY");
  const opts=nodeAttributeState(quoted,"ensure-session","create-session");
  assert.equal(opts.bindings.some(b=>b.key==="supi"),false);
  assert.throws(()=>previewNodeBindingFrom(quoted,"ensure-session","create-session",
    "supi","input.dnn"));
  assert.throws(()=>previewNodeBindingFrom(ensure,"ensure-session","create-session",
    "supi","input.does-not-exist"));
  assert.throws(()=>previewNodeBindingFrom(ensure,"ensure-session","create-session",
    "nonexistent","input.supi"));
  const op=previewNodeOperatorValue(ensure,"ensure-session","create-session",
    "demo.op");
  assert.throws(()=>applyNodeOperatorValue(ensure+"\n",op));
  assert.throws(()=>applyNodeOperatorValue(ensure,{...op,diff:"spoof"}));
  assert.throws(()=>applyNodeOperatorValue(ensure,{...op,extra:true}));
  const binding=previewNodeBindingFrom(ensure,"ensure-session","create-session",
    "supi","input.dnn");
  assert.throws(()=>applyNodeBindingFrom(ensure+"\n",binding));
  assert.throws(()=>applyNodeBindingFrom(ensure,{...binding,newValue:"input.supi"}));
  assert.throws(()=>applyNodeBindingFrom(ensure,{...binding,sourceSpan:{start:0,end:1}}));
});
