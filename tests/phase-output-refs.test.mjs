import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {projectWorkspace} from "../site/workspace.mjs";
import {phaseOutputReferenceOptions,previewPhaseOutputReference,
  applyPhaseOutputReference} from "../site/phase-output-refs.mjs";
import {routeProjectionSignature} from "../site/route-create.mjs";
const source=readFileSync(new URL("../site/samples/packages/"+
  "establish-pdu-session/assurance/procedure.yaml",import.meta.url),"utf8");
const pid="ue-requested-pdu-session-establishment";
const node="nudm-sdm-subscribe",phase="preconditions",index=1,key="selection";
const relative="preconditions.select-subscription-configuration.output";
const qualified="nudm-sdm-subscribe."+relative;
const args=(text=source,to=qualified)=>[text,pid,node,phase,index,key,to];
test("D4-A2 real CreatedSession discovers two actually observed forms of same earlier Step",()=>{
  const choices=phaseOutputReferenceOptions(source,pid,node);
  const row=choices.find(x=>x.phaseName===phase&&x.stepIndex===index&&
    x.bindingKey===key);
  assert.ok(row,"real CreatedSession second precondition Step should be editable");
  assert.equal(row.value,relative);
  assert.equal(row.producerNodeId,node);
  assert.equal(row.producerPhase,phase);
  assert.equal(row.producerStep,"select-subscription-configuration");
  assert.equal(row.producerStepIndex,0);
  assert.equal(row.outputSuffix,"");
  assert.deepEqual(row.choices,[relative,qualified]);
  assert.ok(Object.isFrozen(row.choices)&&Object.isFrozen(choices));
});
test("D4-A2 swaps only precise Source scalar and does not change the Procedure graph",()=>{
  const before=projectWorkspace(source);
  const preview=previewPhaseOutputReference(...args());
  assert.equal(preview.type,"NormalizePhaseOutputReference");
  assert.equal(source.slice(preview.sourceSpan.start,preview.sourceSpan.end),relative);
  assert.match(preview.diff,/\+\s+from: nudm-sdm-subscribe\.preconditions\.select-subscription-configuration\.output/);
  assert.equal(source.includes(qualified),true);
  const next=applyPhaseOutputReference(source,preview);
  assert.equal(next,source.slice(0,preview.sourceSpan.start)+qualified+
    source.slice(preview.sourceSpan.end));
  assert.deepEqual(routeProjectionSignature(projectWorkspace(next)),
    routeProjectionSignature(before));
  assert.equal(projectWorkspace(next).state,"READY");
});
test("D4-A2 accepts reverse normalization only when both spellings are observed",()=>{
  const next=applyPhaseOutputReference(source,previewPhaseOutputReference(...args()));
  const reversed=previewPhaseOutputReference(...args(next,relative));
  assert.equal(applyPhaseOutputReference(next,reversed),source);
});
test("D4-A2 refuses arbitrary producers, output keys, external nodes and future steps",()=>{
  for(const to of [
    "preconditions.resolve-pcf-create-inputs.output",
    "preconditions.select-subscription-configuration.output.other",
    "nudm-sdm-get.output.result",
    "npcf-sm-policy-control-create.preconditions.select-subscription-configuration.output",
    "preconditions.resolve-pcf-create-inputs.output.pcfCreateInputsRef",
    "preconditions.no-such-step.output", "input.dnn",relative,null
  ])assert.throws(()=>previewPhaseOutputReference(...args(source,to)));
  assert.throws(()=>previewPhaseOutputReference(source,pid,node,phase,0,
    "udmResult",qualified));
  assert.throws(()=>previewPhaseOutputReference(source,pid,
    "nudm-sdm-get","postconditions",0,"udmReadReceipt",qualified));
});
test("D4-A2 never introduces an unobserved reference or silently accepts absent aliases",()=>{
  const edited=source.replaceAll(qualified,"input.dnn");
  const option=phaseOutputReferenceOptions(edited,pid,node).find(x=>x.bindingKey===key);
  assert.equal(option,undefined);
  assert.throws(()=>previewPhaseOutputReference(...args(edited)));
});
test("D4-A2 requires unique earlier named producer and rejects malformed YAML/aliases",()=>{
  const original="            - name: select-subscription-configuration";
  assert.ok(source.includes(original));
  const cases=[
    source.replace(original,"            - name: other-configuration"),
    source.replace("            - name: resolve-pcf-create-inputs",
      "            - name: select-subscription-configuration"),
    source.replace("            from: "+relative,
      "            from: '"+relative+"'"),
    source.replace("            from: "+relative,
      "            from: &r "+relative),
    source.replace("            from: "+relative,"            from: *r"),
    source.replace("            from: "+relative,
      "            from: "+relative+"\n            from: "+relative),
    "procedures: ["
  ];
  for(const text of cases){
    assert.equal(phaseOutputReferenceOptions(text,pid,node)
      .find(x=>x.bindingKey===key),undefined);
    assert.throws(()=>previewPhaseOutputReference(...args(text)));
  }
});
test("D4-A2 retains inline comments, CRLF and rejects stale or forged patches",()=>{
  const comment=source.replace("            from: "+relative,
    "            from: "+relative+" # keep binding reason");
  const p=previewPhaseOutputReference(...args(comment));
  const output=applyPhaseOutputReference(comment,p);
  assert.ok(output.includes("from: "+qualified+" # keep binding reason"));
  for(const altered of [
    {...p,diff:"not real"},
    {...p,sourceSpan:{start:0,end:0}},
    {...p,producerStep:"other"},
    {...p,outputSuffix:".invented"},
    {...p,candidateSource:comment},
    {...p,extra:"tampered"}
  ])assert.throws(()=>applyPhaseOutputReference(comment,altered));
  assert.throws(()=>applyPhaseOutputReference(comment+"\n",p),/Stale/);
  const crlf=source.replace(/\n/g,"\r\n");
  const cr=previewPhaseOutputReference(...args(crlf));
  assert.ok(applyPhaseOutputReference(crlf,cr).includes("from: "+qualified+"\r\n"));
});
test("D4-A2 does not expose unrelated downstream nodes or root-only refs",()=>{
  const noPhase=phaseOutputReferenceOptions(source,pid,"npcf-sm-policy-control-create");
  assert.ok(noPhase.every(x=>x.producerNodeId==="npcf-sm-policy-control-create"));
  assert.deepEqual(phaseOutputReferenceOptions(source,pid,"not-node"),[]);
  assert.deepEqual(phaseOutputReferenceOptions(source,"not-proc",node),[]);
});
