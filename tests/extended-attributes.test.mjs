import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {projectWorkspace} from "../site/workspace.mjs";
import {predicateChoices} from "../site/attribute-patch.mjs";
import {
 phaseVerifyChoices,previewPhaseVerifyPatch,applyPhaseVerifyPatch,
 createdRouteTargets,previewCreatedRoutePatch,applyCreatedRoutePatch
} from "../site/extended-attributes.mjs";
const folder="./fixtures/establish-pre-hold/assurance/";
const read=name=>readFileSync(new URL(folder+name,import.meta.url),"utf8");
const text=read("procedure.yaml");
const predicateSource=read("predicates.yaml");
const name="establish-pdu-session";
const model=projectWorkspace(text);
assert.equal(model.state,"READY");
const actualChoices=predicateChoices(predicateSource);
const stepChoices=[];
for(const procedure of model.procedures.values())
  for(const node of procedure.nodes)
    for(const phase of node.phases)
      for(const step of phase.steps)
        if(step.operator==="verify"&&actualChoices.includes(step.value))
          stepChoices.push({procedure,node,phase,step});
const first=stepChoices[0];
const target=actualChoices.find(value=>value!==first?.step.value);
test("pinned predecessor CreatedSession has source-grounded enum choices for phase Verify references",()=>{
  assert.ok(stepChoices.length>=8);
  assert.ok(actualChoices.length>8);
  const choices=phaseVerifyChoices(text,name,first.procedure.name,first.node.id,
    first.phase.name,first.step.index-1,predicateSource);
  assert.deepEqual(choices,actualChoices);
  assert.ok(choices.includes(first.step.value));
  assert.equal(phaseVerifyChoices(text,name,first.procedure.name,first.node.id,
    first.phase.name,-1,predicateSource).length,0);
});
test("phase Verify edit patches exactly one plain YAML scalar and reprojects",()=>{
  const preview=previewPhaseVerifyPatch(text,name,first.procedure.name,first.node.id,
    first.phase.name,first.step.index-1,target,predicateSource);
  assert.equal(preview.type,"SetPhaseVerify");
  assert.equal(preview.oldValue,first.step.value);
  assert.equal(preview.newValue,target);
  assert.equal(preview.candidateSource,text.slice(0,preview.sourceSpan.start)+
    target+text.slice(preview.sourceSpan.end));
  assert.equal(applyPhaseVerifyPatch(text,preview,predicateSource),preview.candidateSource);
  const after=projectWorkspace(preview.candidateSource);
  assert.equal(after.state,"READY");
  const step=after.procedures.get(first.procedure.name)
    .nodes.find(n=>n.id===first.node.id)
    .phases.find(p=>p.name===first.phase.name).steps[first.step.index-1];
  assert.equal(step.value,target);
  assert.deepEqual(after.procedures.get(first.procedure.name).routes.map(r=>r.target),
    first.procedure.routes.map(r=>r.target));
});
test("phase edit fails for fake predicates, non Verify steps and tampered previews",()=>{
  assert.throws(()=>previewPhaseVerifyPatch(text,name,first.procedure.name,first.node.id,
    first.phase.name,first.step.index-1,"not.in.package",predicateSource));
  assert.throws(()=>previewPhaseVerifyPatch(text,name,first.procedure.name,first.node.id,
    first.phase.name,first.step.index-1,first.step.value,predicateSource));
  const preview=previewPhaseVerifyPatch(text,name,first.procedure.name,first.node.id,
    first.phase.name,first.step.index-1,target,predicateSource);
  assert.throws(()=>applyPhaseVerifyPatch(text+" ",preview,predicateSource));
  assert.throws(()=>applyPhaseVerifyPatch(text,{...preview,candidateSource:"forged"},predicateSource));
  assert.throws(()=>applyPhaseVerifyPatch(text,preview,"kind: PredicateSet\npredicates: {}\n"));
});
test("CreatedSession Route dropdown choices come only from the actual Procedure nodes",()=>{
  const proc=model.procedure;
  const route=proc.routes.find(r=>r.patchable);
  const choices=createdRouteTargets(text,name,proc.name,route.id);
  assert.deepEqual(choices,proc.nodes.map(n=>n.id));
  assert.ok(choices.includes(route.target));
  assert.ok(choices.length>=10);
  assert.deepEqual(createdRouteTargets(text,name,proc.name,"not-a-route"),[]);
});
test("source-backed Route target edit preserves every non-selected Route",()=>{
  const proc=model.procedure;
  const route=proc.routes.find(r=>r.patchable);
  const newTarget=proc.nodes.find(n=>n.id!==route.target).id;
  const preview=previewCreatedRoutePatch(text,name,proc.name,route.id,newTarget);
  assert.equal(preview.type,"SetCreatedRouteTarget");
  assert.equal(preview.oldValue,route.target);
  assert.equal(preview.newValue,newTarget);
  assert.equal(preview.candidateSource,text.slice(0,preview.sourceSpan.start)+
    newTarget+text.slice(preview.sourceSpan.end));
  assert.equal(applyCreatedRoutePatch(text,preview),preview.candidateSource);
  const after=projectWorkspace(preview.candidateSource);
  assert.equal(after.state,"READY");
  for(const p of model.procedures.values()){
    const targetProc=after.procedures.get(p.name);
    for(const r of p.routes){
      const targetRoute=targetProc.routes.find(x=>x.id===r.id);
      assert.equal(targetRoute.target,r.id===route.id&&p.name===proc.name?
        newTarget:r.target);
    }
  }
});
test("Route target previews fail closed for missing targets, forged and stale source",()=>{
  const proc=model.procedure;
  const route=proc.routes.find(r=>r.patchable);
  const next=proc.nodes.find(n=>n.id!==route.target).id;
  assert.throws(()=>previewCreatedRoutePatch(text,name,proc.name,route.id,"not-a-node"));
  const preview=previewCreatedRoutePatch(text,name,proc.name,route.id,next);
  assert.throws(()=>applyCreatedRoutePatch(text+"\n",preview));
  assert.throws(()=>applyCreatedRoutePatch(text,{...preview,routeId:"spoof"}));
  assert.throws(()=>applyCreatedRoutePatch(text,{...preview,diff:"forged"}));
  assert.throws(()=>applyCreatedRoutePatch(text,{...preview,sourceSpan:{start:0,end:1}}));
});
test("new enums remain explicitly scoped to the pinned CreatedSession profile",()=>{
  assert.deepEqual(createdRouteTargets(text,"ensure-pdu-session",model.entry,"x"),[]);
  assert.deepEqual(phaseVerifyChoices(text,"ensure-pdu-session",first.procedure.name,
    first.node.id,first.phase.name,first.step.index-1,predicateSource),[]);
});
