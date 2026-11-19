import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {namedStepMutationImpactReport} from "../site/phase-step-impact.mjs";
import {previewNamePlainVerify,applyNamePlainVerify,
  namedVerifyEditOptions} from "../site/phase-named-verify.mjs";

const source=readFileSync(new URL("./fixtures/establish-pre-hold/assurance/procedure.yaml",import.meta.url),"utf8");
const pid="ue-requested-pdu-session-establishment";
const node="nudm-sdm-subscribe",phase="preconditions";
const report=s=>namedStepMutationImpactReport(s,pid,node);
const row=(s,index)=>report(s).steps.find(x=>x.phaseName===phase&&
  x.stepIndex===index);
const first="select-subscription-configuration";
const second="resolve-pcf-create-inputs";

test("D4-A3b2b2a pinned named Script has five consumers and a direct dependency into next Call",()=>{
  const data=report(source);
  assert.equal(data.status,"READY");
  const s=row(source,0);
  assert.equal(s.stepName,first);
  assert.equal(s.operator,"script");
  assert.equal(s.nextStepName,second);
  assert.equal(s.referenceCount,5);
  assert.equal(s.deletion.code,"OUTPUT_CONSUMERS");
  assert.equal(s.move.code,"DIRECT_DATA_DEPENDENCY");
  assert.equal(s.directReferences.length,1);
  assert.equal(s.directReferences[0].value,
    "preconditions.select-subscription-configuration.output");
  assert.equal(s.directReferences[0].bindingKey,"selection");
  assert.ok(s.directReferences[0].line>0);
  assert.equal(Object.isFrozen(data),true);
  assert.equal(Object.isFrozen(data.steps),true);
  assert.equal(Object.isFrozen(s),true);
  assert.equal(Object.isFrozen(s.directReferences),true);
});
test("D4-A3b2b2a next named Call also feeds the following Verify and cannot move across it",()=>{
  const c=row(source,1);
  assert.equal(c.operator,"call");
  assert.equal(c.stepName,second);
  assert.equal(c.deletion.code,"OUTPUT_CONSUMERS");
  assert.ok(c.referenceCount>0);
  assert.equal(c.move.code,"DIRECT_DATA_DEPENDENCY");
  assert.equal(c.directReferences.length,2);
  assert.ok(c.directReferences.every(x=>x.value.startsWith(
    "preconditions.resolve-pcf-create-inputs.output.")));
});
test("D4-A3b2b2a removing direct edge still does not authorize moving Script or Call",()=>{
  const altered=source.replace(
    "from: preconditions.select-subscription-configuration.output",
    "from: input.dnn");
  assert.notEqual(altered,source);
  const s=row(altered,0);
  assert.equal(s.directReferences.length,0);
  assert.equal(s.move.code,"EFFECT_UNPROVEN");
  assert.equal(s.deletion.code,"OUTPUT_CONSUMERS");
  assert.equal(s.referenceCount,4);
});
test("D4-A3b2b2a plain named Verify is only a candidate for existing AST-gated editors",()=>{
  const preview=previewNamePlainVerify(source,pid,node,phase,3,"check-ingress");
  const named=applyNamePlainVerify(source,preview);
  const s=row(named,3);
  assert.equal(s.operator,"verify");
  assert.equal(s.referenceCount,0);
  assert.equal(s.deletion.code,"VERIFY_EDITOR_RULES");
  assert.equal(s.move.code,"VERIFY_EDITOR_RULES");
  const existing=namedVerifyEditOptions(named,pid,node);
  assert.ok(existing.deletions.some(x=>x.phaseName===phase&&x.stepIndex===3));
  assert.ok(existing.swaps.some(x=>x.phaseName===phase&&x.stepIndex===3));
  assert.equal(s.directReferences.length,0);
});
test("D4-A3b2b2a referenced Verify is blocked from deletion and move",()=>{
  const preview=previewNamePlainVerify(source,pid,node,phase,3,"check-ingress");
  const named=applyNamePlainVerify(source,preview);
  const changed=named.replace(
    "            - verify: createdsession.lifecycle.ready\n",
    "            - verify: createdsession.lifecycle.ready\n"+
    "              with:\n                source:\n"+
    "                  from: preconditions.check-ingress.output\n");
  assert.notEqual(changed,named);
  const s=row(changed,3);
  assert.equal(s.deletion.code,"OUTPUT_CONSUMERS");
  assert.equal(s.move.code,"DIRECT_DATA_DEPENDENCY");
  assert.equal(s.directReferences.length,1);
  const opts=namedVerifyEditOptions(changed,pid,node);
  assert.equal(opts.deletions.some(x=>x.stepIndex===3&&
    x.phaseName===phase),false);
});
test("D4-A3b2b2a quoted/unknown refs report unqualified source instead of allowing mutation",()=>{
  const changed=source.replace(
    "from: preconditions.select-subscription-configuration.output",
    "from: 'preconditions.select-subscription-configuration.output'");
  assert.notEqual(changed,source);
  const s=row(changed,0);
  assert.equal(s.deletion.code,"UNKNOWN_REFERENCES");
  assert.equal(s.move.code,"UNKNOWN_REFERENCES");
  assert.equal(s.referenceCount,null);
});
test("D4-A3b2b2a fail closed for absent, malformed or oversized Source",()=>{
  for(const text of ["procedures: [", "", source+"\n".repeat(1048576)])
    assert.equal(report(text).status,"UNAVAILABLE");
  assert.equal(namedStepMutationImpactReport(source,pid,"unknown").status,
    "UNAVAILABLE");
});
