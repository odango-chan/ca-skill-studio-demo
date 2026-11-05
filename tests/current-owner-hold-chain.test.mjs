import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {projectWorkspace} from "../site/workspace.mjs";
import {routeProjectionSignature} from "../site/route-create.mjs";
import {phaseStepBindingOptions,previewPhaseInputBinding,
  applyPhaseInputBinding} from "../site/phase-bindings.mjs";
import {phaseStepDependencyReport} from "../site/phase-dataflow.mjs";
import {namedStepMutationImpactReport} from "../site/phase-step-impact.mjs";
import {phaseOutputReferenceOptions} from "../site/phase-output-refs.mjs";

const source=readFileSync(new URL(
  "../site/samples/packages/establish-pdu-session/assurance/procedure.yaml",
  import.meta.url),"utf8");
const pid="ue-requested-pdu-session-establishment";
const udm="nudm-sdm-subscribe";
const pcf="npcf-sm-policy-control-create";
const step=(name,idx)=>projectWorkspace(source).procedures.get(pid)
  .nodes.find(n=>n.id===name).phases.find(p=>p.name==="preconditions")
  .steps[idx];
const bind=(name,key,index)=>phaseStepDependencyReport(source,pid,name)
  .bindings.find(b=>b.phaseName==="preconditions"&&
    b.stepIndex===index&&b.bindingKey===key);

test("current owner UDM hold is an explicit named Call; its waiter is not an inferred fact",()=>{
  const graph=projectWorkspace(source);
  assert.equal(graph.state,"READY");
  assert.equal(graph.procedures.size,5);
  assert.equal(graph.procedure.routes.length,63);
  assert.equal(step(udm,1).name,"bind-udm-hold");
  assert.equal(step(udm,1).operator,"call");
  assert.equal(step(udm,1).value,"ca.session.udm_hold.bind");
  assert.equal(step(udm,2).value,"createdsession.udm.hold_bound");
  const hold=bind(udm,"udmHoldRef",2);
  assert.ok(hold);
  assert.equal(hold.value,"preconditions.bind-udm-hold.output.holdRef");
  assert.equal(hold.status,"EARLIER_LOCAL_STEP");
  assert.equal(hold.producerStep,"bind-udm-hold");
  assert.equal(hold.contractStatus,"NO_OWNER_OUTPUT_SCHEMA");
  assert.equal(hold.editEligible,false);
  const waiter=source.match(/waiterRef:\s*\n\s*from: preconditions\.bind-udm-hold\.output\.holdRef/);
  assert.ok(waiter,"UDM Subscribe must use the selected hold output");
});

test("current owner PCF hold and create-inputs preserve explicit ordering and unproven Tool ABI",()=>{
  assert.equal(step(pcf,0).name,"bind-pcf-hold");
  assert.equal(step(pcf,0).value,"ca.session.pcf_hold.bind");
  assert.equal(step(pcf,1).value,"createdsession.pcf.hold_bound");
  assert.equal(step(pcf,2).name,"resolve-pcf-create-inputs");
  const hold=bind(pcf,"pcfHoldRef",1);
  assert.ok(hold);
  assert.equal(hold.value,"preconditions.bind-pcf-hold.output.holdRef");
  assert.equal(hold.status,"EARLIER_LOCAL_STEP");
  assert.equal(hold.contractStatus,"NO_OWNER_OUTPUT_SCHEMA");
  assert.equal(hold.editEligible,false);
  const inputRef=bind(pcf,"fabricHoldRef",2);
  assert.ok(inputRef);
  assert.equal(inputRef.producerStep,"bind-pcf-hold");
  assert.equal(inputRef.status,"EARLIER_LOCAL_STEP");
  assert.equal(inputRef.editEligible,false);
});

test("new hold Call Steps have Source-observed consumers but no delete/reorder grant",()=>{
  for(const [name,idx,next] of [[udm,1,"createdsession.udm.hold_bound"],
    [pcf,0,"createdsession.pcf.hold_bound"]]){
    const report=namedStepMutationImpactReport(source,pid,name);
    assert.equal(report.status,"READY");
    const row=report.steps.find(x=>x.phaseName==="preconditions"&&x.stepIndex===idx);
    assert.ok(row,name);
    assert.equal(row.operator,"call");
    assert.ok(row.referenceCount>0);
    assert.equal(row.deletion.code,"OUTPUT_CONSUMERS");
    assert.equal(row.move.code,"DIRECT_DATA_DEPENDENCY");
    assert.ok(row.directReferences.some(x=>x.value.includes("holdRef")));
    assert.equal(row.nextStepName,next);
  }
  // A relative output alone does not authorize a visual output ref rewrite.
  for(const name of [udm,pcf]){
    const edits=phaseOutputReferenceOptions(source,pid,name);
    assert.equal(edits.some(e=>e.producerStep==="bind-udm-hold"||
      e.producerStep==="bind-pcf-hold"),false);
  }
});

test("current owner hold input Patch remains exact/opt-in and rejects untyped sources",()=>{
  const fields=phaseStepBindingOptions(source,pid,udm);
  const row=fields.find(x=>x.phaseName==="preconditions"&&
    x.stepIndex===1&&x.bindingKey==="ueRef");
  assert.ok(row);
  assert.equal(row.value,"input.ue-ref");
  assert.equal(row.inputType,"string");
  assert.ok(row.choices.includes("input.dnn"));
  assert.equal(row.choices.includes("input.psi"),false);
  // The following edit is *only* editor-level syntax/typing proof, NOT a
  // semantically valid way to bind a SUPI to a DNN in the real Skill.
  const preview=previewPhaseInputBinding(source,pid,udm,
    "preconditions",1,"ueRef","input.dnn");
  const changed=applyPhaseInputBinding(source,preview);
  assert.equal(changed,source.slice(0,preview.sourceSpan.start)+"input.dnn"+
    source.slice(preview.sourceSpan.end));
  assert.equal(projectWorkspace(changed).state,"READY");
  assert.deepEqual(routeProjectionSignature(projectWorkspace(changed)),
    routeProjectionSignature(projectWorkspace(source)));
  assert.throws(()=>previewPhaseInputBinding(source,pid,udm,
    "preconditions",1,"ueRef","input.psi"));
  assert.throws(()=>applyPhaseInputBinding(source+"\n",preview),/Stale/);
  assert.throws(()=>applyPhaseInputBinding(source,{...preview,newValue:"input.psi"}));
});
