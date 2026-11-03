import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  predicateChoices,nodeVerifyEditChoices,previewVerifyPredicatePatch,applyVerifyPredicatePatch,
  contractMaxActions,previewContractMaxActionsPatch,applyContractMaxActionsPatch
} from "../site/attribute-patch.mjs";
import {projectWorkspace} from "../site/workspace.mjs";

const read=(skill,path)=>readFileSync(
  new URL("../site/samples/packages/"+skill+"/"+path,import.meta.url),"utf8");
const ensure="ensure-pdu-session";
const proc=read(ensure,"assurance/procedure.yaml");
const predicates=read(ensure,"assurance/predicates.yaml");
const contract=read(ensure,"assurance/contract.yaml");

test("node Verify inspector choices derive from the actual Package PredicateSet",()=>{
  const choices=predicateChoices(predicates);
  assert.deepEqual(choices,["ue.registered","pdu_session.absent","pdu_session.target.satisfied"]);
  assert.deepEqual(nodeVerifyEditChoices(proc,"ensure-session","observe-target-session",predicates),choices);
  assert.deepEqual(nodeVerifyEditChoices(proc,"ensure-session","create-session",predicates),[]);
});
test("qualified Verify field patch changes exactly one scalar and preserves all routes",()=>{
  const preview=previewVerifyPredicatePatch(proc,"ensure-session","observe-target-session",
    "pdu_session.absent",predicates);
  assert.equal(preview.type,"SetVerifyPredicate");
  assert.equal(preview.oldValue,"pdu_session.target.satisfied");
  assert.equal(preview.newValue,"pdu_session.absent");
  assert.equal(preview.candidateSource,
    proc.slice(0,preview.sourceSpan.start)+"pdu_session.absent"+proc.slice(preview.sourceSpan.end));
  assert.equal(applyVerifyPredicatePatch(proc,preview,predicates),preview.candidateSource);
  const before=projectWorkspace(proc).procedure;
  const after=projectWorkspace(preview.candidateSource).procedure;
  assert.deepEqual(after.routes.map(r=>[r.id,r.target,r.outcome]),
    before.routes.map(r=>[r.id,r.target,r.outcome]));
  assert.equal(after.nodes[0].value,"pdu_session.absent");
  assert.equal(after.nodes[1].value,before.nodes[1].value);
});
test("Verify patch rejects unknown predicates, stale revisions, tampering and CreatedSession",()=>{
  assert.throws(()=>previewVerifyPredicatePatch(proc,"ensure-session","observe-target-session",
    "not.in.package",predicates));
  assert.throws(()=>previewVerifyPredicatePatch(proc,"ensure-session","observe-target-session",
    "pdu_session.target.satisfied",predicates));
  const preview=previewVerifyPredicatePatch(proc,"ensure-session","observe-target-session",
    "pdu_session.absent",predicates);
  assert.throws(()=>applyVerifyPredicatePatch(proc+"\n",preview,predicates));
  assert.throws(()=>applyVerifyPredicatePatch(proc,{...preview,candidateSource:"spoof"},predicates));
  assert.throws(()=>applyVerifyPredicatePatch(proc,preview,"kind: PredicateSet\npredicates: {}\n"));
  const established=read("establish-pdu-session","assurance/procedure.yaml");
  assert.deepEqual(nodeVerifyEditChoices(established,"ue-requested-pdu-session-establishment",
    "nudm-sdm-get",predicates),[]);
});
test("Contract inspector reads the bounded planning.maxActions field",()=>{
  assert.equal(contractMaxActions(contract,ensure).value,6);
  assert.ok(contractMaxActions(contract,ensure).line>0);
  assert.equal(contractMaxActions(read("establish-pdu-session","assurance/contract.yaml"),
    "establish-pdu-session").value,32);
  assert.equal(contractMaxActions(contract,"some-other-package"),null);
});
test("Contract numeric Typed Patch has exact source diff and guarded apply",()=>{
  const preview=previewContractMaxActionsPatch(contract,ensure,8);
  assert.equal(preview.type,"SetMaxActions");
  assert.match(preview.diff,/-    maxActions: 6|\-    maxActions: 6/);
  assert.equal(applyContractMaxActionsPatch(contract,preview),preview.candidateSource);
  assert.equal(contractMaxActions(preview.candidateSource,ensure).value,8);
  assert.equal(preview.candidateSource,contract.slice(0,preview.sourceSpan.start)+
    "8"+contract.slice(preview.sourceSpan.end));
  assert.equal(read(ensure,"assurance/contract.yaml"),contract);
});
test("Contract Patch rejects overflow, unchanged value, forged preview and stale revision",()=>{
  for(const value of [-1,0,1.5,129,"9"])
    assert.throws(()=>previewContractMaxActionsPatch(contract,ensure,value));
  assert.throws(()=>previewContractMaxActionsPatch(contract,ensure,6));
  const preview=previewContractMaxActionsPatch(contract,ensure,9);
  assert.throws(()=>applyContractMaxActionsPatch(contract+"\n",preview));
  assert.throws(()=>applyContractMaxActionsPatch(contract,{...preview,newValue:10}));
  assert.throws(()=>applyContractMaxActionsPatch(contract,{...preview,sourceSpan:{start:0,end:1}}));
});
