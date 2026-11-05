import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {SAMPLE_PACKAGES,createFileWorkspace} from "../site/sample-packages.mjs";
import {phaseConsumerContractReport} from "../site/phase-consumer-contract.mjs";
import {phaseStepDependencyReport} from "../site/phase-dataflow.mjs";
import {projectWorkspace} from "../site/workspace.mjs";
const proc="ue-requested-pdu-session-establishment",node="nudm-sdm-subscribe";
const root=new URL("./fixtures/establish-pre-hold/",import.meta.url);
const get=path=>readFileSync(new URL(path,root),"utf8");
const source=get("assurance/procedure.yaml");
const files=()=>createFileWorkspace("establish-pdu-session",
  SAMPLE_PACKAGES.establish.files.map(path=>({path,text:get(path)}))).files;
const report=(text=source,fs=files(),who=node)=>
  phaseConsumerContractReport(text,proc,who,fs);
const row=(data,stepIndex,key)=>data.bindings.find(x=>
  x.phaseName==="preconditions"&&x.stepIndex===stepIndex&&
  x.bindingKey===key);
test("D4-A2.2b1 pinned script consumer inputSchema joins concrete typed producer declarations",()=>{
  const r=report();
  assert.equal(r.status,"READY");
  assert.ok(r.summary.typeOnly>=4);
  assert.equal(r.summary.authorizedWrites,0);
  for(const [key,expected] of [["dnn","string"],["sNssai","object"],
    ["requestedPduSessionType","string"],["requestedSscMode","integer"]]){
    const item=row(r,0,key);
    assert.ok(item,key);
    assert.equal(item.producerStatus,"DECLARED_INPUT");
    assert.equal(item.producerType,expected);
    assert.equal(item.consumerStatus,"CONSUMER_FIELD_DECLARED");
    assert.equal(item.consumerSchema,"schemas/selection-input.schema.yaml");
    assert.equal(item.consumerType,expected);
    assert.equal(item.consumerRequired,true);
    assert.equal(item.typeRelation,"TYPE_ONLY_MATCH");
    assert.equal(item.editEligible,false);
  }
  assert.ok(row(r,0,"dnn").consumerConstraints.includes("pattern"));
  assert.ok(row(r,0,"requestedPduSessionType").consumerConstraints.includes("const"));
  assert.ok(Object.isFrozen(r)&&Object.isFrozen(r.bindings)&&
    Object.isFrozen(row(r,0,"dnn").consumerConstraints));
});
test("D4-A2.2b1 call output lacks producer ABI while consumer script field is declared",()=>{
  const item=row(report(),0,"udmResult");
  assert.equal(item.producerStatus,"GRAPH_PREDECESSOR_ONLY");
  assert.equal(item.producerType,null);
  assert.equal(item.consumerSchema,"schemas/selection-input.schema.yaml");
  assert.equal(item.consumerType,"object");
  assert.equal(item.typeRelation,"PRODUCER_TYPE_UNAVAILABLE");
  assert.equal(item.editEligible,false);
});
test("D4-A2.2b1 call/verify consumers cannot be inferred from script output schemas",()=>{
  const item=row(report(),1,"selection");
  assert.equal(item.producerStatus,"EARLIER_LOCAL_STEP");
  assert.equal(item.producerType,"object");
  assert.equal(item.producerSchema,"schemas/selection.schema.yaml");
  assert.equal(item.consumerStatus,"CONSUMER_ABI_UNAVAILABLE");
  assert.equal(item.typeRelation,"CONSUMER_ABI_UNPROVEN");
  assert.equal(item.editEligible,false);
});
test("D4-A2.2b1 mismatched declared types are visible but not editable",()=>{
  const modified=source.replace("                  from: input.dnn\n",
    "                  from: input.psi\n");
  assert.notEqual(modified,source);
  const r=report(modified),item=row(r,0,"dnn");
  assert.equal(item.producerType,"integer");
  assert.equal(item.consumerType,"string");
  assert.equal(item.typeRelation,"TYPE_MISMATCH");
  assert.equal(item.editEligible,false);
  assert.equal(r.summary.mismatched,1);
});
test("D4-A2.2b1 missing or duplicate schema title fails closed",()=>{
  const missing=files();missing.delete("schemas/selection-input.schema.yaml");
  assert.equal(row(report(source,missing),0,"dnn").consumerStatus,
    "CONSUMER_SCHEMA_NOT_FOUND");
  const duplicate=files();duplicate.set("schemas/selection-input-copy.schema.yaml",
    {text:duplicate.get("schemas/selection-input.schema.yaml").text});
  assert.equal(row(report(source,duplicate),0,"dnn").consumerStatus,
    "CONSUMER_SCHEMA_AMBIGUOUS");
  assert.equal(row(report(source,duplicate),0,"dnn").editEligible,false);
});
test("D4-A2.2b1 malformed or duplicated script frontmatter does not establish ABI",()=>{
  for(const changed of [
    get("scripts/select_establishment_configuration.py")
      .replace("# inputSchema: EstablishmentSelectionInput",
        "# inputSchema: NotInstalled"),
    get("scripts/select_establishment_configuration.py")
      .replace("# outputSchema:", "# inputSchema: EstablishmentSelectionInput\n# outputSchema:"),
    "def main(x): return x"
  ]){
    const fs=files();fs.get("scripts/select_establishment_configuration.py").text=changed;
    const r=row(report(source,fs),0,"dnn");
    assert.notEqual(r.typeRelation,"TYPE_ONLY_MATCH");
    assert.equal(r.editEligible,false);
  }
});
test("D4-A2.2b1 unproved field constraints or ambiguous types never grant edit authority",()=>{
  const fs=files(),path="schemas/selection-input.schema.yaml";
  const src=fs.get(path).text;
  fs.get(path).text=src.replace("  dnn:\n    type: string",
    "  dnn:\n    $ref: '#/$defs/oneOf'");
  const unknown=row(report(source,fs),0,"dnn");
  assert.equal(unknown.consumerStatus,"CONSUMER_FIELD_TYPE_UNPROVEN");
  assert.equal(unknown.typeRelation,"CONSUMER_ABI_UNPROVEN");
  assert.equal(unknown.editEligible,false);
  fs.get(path).text=src.replace("  dnn:\n    type: string",
    "  otherName:\n    type: string");
  assert.equal(row(report(source,fs),0,"dnn").consumerStatus,
    "CONSUMER_FIELD_NOT_DECLARED");
});
test("D4-A2.2b1 does not change Source, Package files or current projection",()=>{
  const copy=source;
  const fs=files(),before=[...fs.values()].map(x=>x.text);
  const dependencies=phaseStepDependencyReport(source,proc,node,fs);
  const joined=phaseConsumerContractReport(source,proc,node,fs,dependencies);
  assert.deepEqual(joined.bindings,report(source,fs).bindings);
  assert.equal(joined.summary.authorizedWrites,0);
  assert.ok(joined.bindings.every(x=>x.editEligible===false));
  assert.equal(source,copy);
  assert.deepEqual([...fs.values()].map(x=>x.text),before);
  assert.equal(projectWorkspace(source).state,"READY");
  assert.equal(phaseConsumerContractReport("procedures: [",proc,node,fs).status,
    "UNAVAILABLE");
});
