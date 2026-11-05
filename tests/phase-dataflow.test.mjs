import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {projectWorkspace} from "../site/workspace.mjs";
import {phaseStepDependencyReport} from "../site/phase-dataflow.mjs";
const fixture=readFileSync(new URL("./fixtures/establish-pre-hold/assurance/procedure.yaml",import.meta.url),"utf8");
const proc="ue-requested-pdu-session-establishment";
const readSample=(path)=>readFileSync(new URL("../site/samples/packages/"+
  "establish-pdu-session/"+path,import.meta.url),"utf8");
const files=new Map([
 ["scripts/select_establishment_configuration.py",{
   text:readSample("scripts/select_establishment_configuration.py")}],
 ["schemas/selection.schema.yaml",{text:readSample("schemas/selection.schema.yaml")}]
]);
const dep=(node,text=fixture,fs=files)=>phaseStepDependencyReport(text,proc,node,fs);
test("D4-A2.2 read-only provenance on pinned predecessor CreatedSession resolves earlier local Step and source input",()=>{
  const r=dep("nudm-sdm-subscribe");
  assert.equal(r.status,"READY");
  assert.ok(r.summary.count>10);
  assert.equal(r.summary.editEligible,0);
  const select=r.bindings.find(x=>x.phaseName==="preconditions"&&
    x.stepIndex===1&&x.bindingKey==="selection");
  assert.ok(select);
  assert.equal(select.value,"preconditions.select-subscription-configuration.output");
  assert.equal(select.status,"EARLIER_LOCAL_STEP");
  assert.equal(select.producerNodeId,"nudm-sdm-subscribe");
  assert.equal(select.producerStep,"select-subscription-configuration");
  assert.equal(select.producerPhase,"preconditions");
  assert.equal(select.contractStatus,"SCRIPT_SCHEMA_FIELD_DECLARED");
  assert.equal(select.contractSchema,"schemas/selection.schema.yaml");
  assert.equal(select.outputType,"object");
  assert.equal(select.editEligible,false);
  const dnn=r.bindings.find(x=>x.stepIndex===0&&x.bindingKey==="dnn");
  assert.equal(dnn.status,"DECLARED_INPUT");
  assert.equal(dnn.outputType,"string");
  const udm=r.bindings.find(x=>x.stepIndex===0&&x.bindingKey==="udmResult");
  assert.equal(udm.producerNodeId,"nudm-sdm-get");
  assert.equal(udm.status,"GRAPH_PREDECESSOR_ONLY");
  assert.equal(udm.contractStatus,"NO_OWNER_OUTPUT_SCHEMA");
});
test("D4-A2.2 detects an own Node main output before/after execution",()=>{
  const earlier=dep("nudm-sdm-get").bindings.find(x=>x.bindingKey==="udmReadReceipt");
  assert.ok(earlier);
  assert.equal(earlier.status,"OWN_OPERATOR_PRIOR");
  const changed=fixture.replace("                  from: input.dnn\n","                  from: nudm-sdm-subscribe.output.result\n");
  const future=dep("nudm-sdm-subscribe",changed).bindings.find(x=>
    x.stepIndex===0&&x.bindingKey==="dnn");
  assert.equal(future.status,"FUTURE_OWN_OPERATOR");
});
test("D4-A2.2 diagnoses future and ambiguous local producers without making edits",()=>{
  const future=fixture.replace("from: preconditions.select-subscription-configuration.output\n",
    "from: preconditions.resolve-pcf-create-inputs.output\n");
  const row=dep("nudm-sdm-subscribe",future).bindings.find(x=>
    x.stepIndex===1&&x.bindingKey==="selection");
  assert.equal(row.status,"FUTURE_OR_SELF_STEP");
  const duplicate=fixture.replace("- name: resolve-pcf-create-inputs",
    "- name: select-subscription-configuration");
  const next=dep("nudm-sdm-subscribe",duplicate).bindings.find(x=>
    x.stepIndex===1&&x.bindingKey==="selection");
  assert.equal(next.status,"AMBIGUOUS_PRODUCER_STEP");
});
test("D4-A2.2 cross-Node order is only structural and cannot qualify output consumption",()=>{
  const r=dep("namf-communication-n1n2-message-transfer");
  const ref=r.bindings.find(x=>x.bindingKey==="selection"&&
    x.value.startsWith("nudm-sdm-subscribe.preconditions"));
  assert.ok(ref);
  assert.equal(ref.status,"GRAPH_PREDECESSOR_ONLY");
  assert.equal(ref.contractStatus,"SCRIPT_SCHEMA_FIELD_DECLARED");
  assert.equal(ref.editEligible,false);
  const changed=fixture.replaceAll("nudm-sdm-subscribe.preconditions.select-subscription-configuration.output",
    "namf-communication-n1n2-message-transfer.preconditions.select-subscription-configuration.output");
  const bad=dep("namf-communication-n1n2-message-transfer",changed).bindings.find(x=>
    x.bindingKey==="selection");
  assert.equal(bad.status,"UNKNOWN_PRODUCER_STEP");
});
test("D4-A2.2 owner schema evidence fails closed for absent, conflicting or unknown fields",()=>{
  const empty=dep("nudm-sdm-subscribe",fixture,new Map()).bindings.find(x=>
    x.stepIndex===1&&x.bindingKey==="selection");
  assert.equal(empty.contractStatus,"NO_OWNER_OUTPUT_SCHEMA");
  const duplicate=new Map(files);
  duplicate.set("schemas/duplicated.schema.yaml",files.get("schemas/selection.schema.yaml"));
  const conflict=dep("nudm-sdm-subscribe",fixture,duplicate).bindings.find(x=>
    x.stepIndex===1&&x.bindingKey==="selection");
  assert.equal(conflict.contractStatus,"SCHEMA_NOT_UNIQUELY_RESOLVED");
  const altered=fixture.replace("from: preconditions.select-subscription-configuration.output\n",
    "from: preconditions.select-subscription-configuration.output.fakeField\n");
  const bad=dep("nudm-sdm-subscribe",altered).bindings.find(x=>
    x.stepIndex===1&&x.bindingKey==="selection");
  assert.equal(bad.contractStatus,"FIELD_SHAPE_NOT_PROVEN");
});
test("D4-A2.2 report is Source read-only, and unavailable/quoted values are explicit",()=>{
  const origin=fixture,proj=projectWorkspace(fixture),r=dep("nudm-sdm-subscribe");
  assert.ok(Object.isFrozen(r)&&Object.isFrozen(r.bindings));
  assert.ok(Object.isFrozen(r.bindings[0]));
  assert.ok(r.bindings.every(x=>x.editEligible===false));
  assert.equal(fixture,origin);
  assert.equal(projectWorkspace(fixture).state,proj.state);
  const quoted=fixture.replace("from: preconditions.select-subscription-configuration.output\n",
    "from: 'preconditions.select-subscription-configuration.output'\n");
  const row=dep("nudm-sdm-subscribe",quoted).bindings.find(x=>
    x.stepIndex===1&&x.bindingKey==="selection");
  assert.equal(row.status,"SOURCE_NOT_PLAIN");
  assert.deepEqual(dep("no-such-node").bindings,[]);
  assert.equal(phaseStepDependencyReport("procedures: [",proc,
    "nudm-sdm-subscribe").status,"UNAVAILABLE");
});
test("D4-A2.2 distinguishes missing input and missing Node; never authorizes producer swap",()=>{
  const changed=fixture.replace("                  from: input.dnn\n","                  from: input.no-such-input\n");
  const missing=dep("nudm-sdm-subscribe",changed).bindings.find(x=>
    x.stepIndex===0&&x.bindingKey==="dnn");
  assert.equal(missing.status,"INPUT_NOT_DECLARED");
  const other=fixture.replace("from: nudm-sdm-get.output.result",
    "from: missing-node.output.result");
  const unresolved=dep("nudm-sdm-subscribe",other).bindings.find(x=>
    x.stepIndex===0&&x.bindingKey==="udmResult");
  assert.equal(unresolved.status,"UNKNOWN_PRODUCER_NODE");
});
