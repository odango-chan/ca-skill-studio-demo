import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {phaseStepDependencyReport} from "../site/phase-dataflow.mjs";
import {phaseConsumerContractReport} from "../site/phase-consumer-contract.mjs";
import {bindingEvidenceExplanation,phaseStepEvidenceSummary}
  from "../site/phase-evidence-copy.mjs";
import {SAMPLE_PACKAGES,createFileWorkspace} from "../site/sample-packages.mjs";

const root=new URL("../site/samples/packages/establish-pdu-session/",import.meta.url);
const get=path=>readFileSync(new URL(path,root),"utf8");
const source=get("assurance/procedure.yaml");
const files=createFileWorkspace("establish-pdu-session",
  SAMPLE_PACKAGES.establish.files.map(path=>({path,text:get(path)}))).files;
const proc="ue-requested-pdu-session-establishment";
function evidence(node){
  const lineage=phaseStepDependencyReport(source,proc,node,files);
  return {lineage,contracts:phaseConsumerContractReport(source,proc,node,
    files,lineage)};
}
function binding(node,index,key){
  const {lineage,contracts}=evidence(node);
  const entry=lineage.bindings.find(x=>x.phaseName==="preconditions"&&
    x.stepIndex===index&&x.bindingKey===key);
  const abi=contracts.bindings.find(x=>x.phaseName==="preconditions"&&
    x.stepIndex===index&&x.bindingKey===key);
  assert.ok(entry&&abi);
  return {entry,abi};
}
test("D4 display: real UDM hold Call names missing consumer ABI without granting edit",()=>{
  const {entry,abi}=binding("nudm-sdm-subscribe",1,"ueRef");
  assert.equal(entry.status,"DECLARED_INPUT");
  assert.equal(abi.consumerStatus,"CONSUMER_ABI_UNAVAILABLE");
  const info=bindingEvidenceExplanation(entry,abi);
  assert.equal(info.code,"CONSUMER_ABI_UNPROVEN");
  assert.match(info.reason,/输入 ABI/);
  assert.match(info.origin,/Procedure input/);
  assert.ok(Object.isFrozen(info));
  const {lineage,contracts}=evidence("nudm-sdm-subscribe");
  const summary=phaseStepEvidenceSummary("preconditions",1,lineage,contracts);
  assert.equal(summary.code,"CONSUMER_ABI_UNPROVEN");
  assert.ok(summary.label.includes("只读证据"));
  assert.equal(summary.readOnly,true);
});
test("D4 display: UDM/PCF hold outputs remain source-located but lack owner output schema",()=>{
  for(const [node,idx,key,producer] of [
    ["nudm-sdm-subscribe",2,"udmHoldRef","bind-udm-hold"],
    ["npcf-sm-policy-control-create",1,"pcfHoldRef","bind-pcf-hold"]
  ]){
    const {entry,abi}=binding(node,idx,key);
    assert.equal(entry.status,"EARLIER_LOCAL_STEP");
    assert.equal(entry.producerStep,producer);
    const info=bindingEvidenceExplanation(entry,abi);
    assert.equal(info.code,"PRODUCER_SCHEMA_UNPROVEN");
    assert.match(info.origin,/同 Node/);
    assert.match(info.reason,/输出 Schema/);
    const {lineage,contracts}=evidence(node);
    assert.equal(phaseStepEvidenceSummary("preconditions",idx,
      lineage,contracts).code,"PRODUCER_SCHEMA_UNPROVEN");
  }
});
test("D4 display: declared Script fields report type-only, never runtime rebind authority",()=>{
  const {entry,abi}=binding("nudm-sdm-subscribe",0,"dnn");
  assert.equal(abi.typeRelation,"TYPE_ONLY_MATCH");
  const info=bindingEvidenceExplanation(entry,abi);
  assert.equal(info.code,"TYPE_ONLY");
  assert.match(info.reason,/业务含义/);
});
test("D4 display: graph predecessor and explicit mismatch are not shown as qualified mutations",()=>{
  const {entry,abi}=binding("nudm-sdm-subscribe",0,"udmResult");
  assert.equal(entry.status,"GRAPH_PREDECESSOR_ONLY");
  const info=bindingEvidenceExplanation(entry,abi);
  assert.match(info.origin,/仅图结构/);
  assert.equal(info.code,"PRODUCER_SCHEMA_UNPROVEN");
  const conflict=bindingEvidenceExplanation(entry,{
    ...abi,typeRelation:"TYPE_MISMATCH"});
  assert.equal(conflict.code,"TYPE_MISMATCH");
  assert.match(conflict.reason,/类型冲突/);
});
test("D4 display: unknown, quoted or unavailable Sources do not acquire invented provenance",()=>{
  const forged=bindingEvidenceExplanation({bindingKey:"holdRef",
    value:"'preconditions.unknown.output'",status:"SOURCE_NOT_PLAIN",
    reason:"Source is not a plain scalar"},null);
  assert.equal(forged.code,"SOURCE_UNPROVEN");
  assert.match(forged.origin,/尚无法证明/);
  assert.equal(bindingEvidenceExplanation(null).code,"UNAVAILABLE");
  assert.equal(phaseStepEvidenceSummary("preconditions",40,{
    status:"READY",bindings:[]},null),null);
  assert.equal(phaseStepEvidenceSummary("preconditions",1,{
    status:"UNAVAILABLE",bindings:[]},null),null);
});
