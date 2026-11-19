import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {projectWorkspace} from "../site/workspace.mjs";
import {routeProjectionSignature} from "../site/route-create.mjs";
import {phaseVerifyAddOptions,phaseVerifyDeleteOptions,
  previewAddPhaseVerify,applyAddPhaseVerify,
  previewDeletePhaseVerify,applyDeletePhaseVerify}
  from "../site/phase-step-structural.mjs";

const root=new URL("./fixtures/establish-pre-hold/",
  import.meta.url);
const source=readFileSync(new URL("assurance/procedure.yaml",root),"utf8");
const predicates=readFileSync(new URL("assurance/predicates.yaml",root),"utf8");
const proc="ue-requested-pdu-session-establishment";
const node="nudm-sdm-subscribe",phase="preconditions";
const ingress="createdsession.ingress.eligible";
const lifecycle="createdsession.lifecycle.ready";
const added="createdsession.n4.initial_resources_ready";
const one="            - verify: "+ingress+"\n";
const two="            - verify: "+lifecycle+"\n";
const three="            - verify: "+added+"\n";
const addArgs=(s=source,p=predicates,name=added)=>
  [s,proc,node,phase,name,p,"establish-pdu-session"];
const delArgs=(s=source,index=4)=>[s,proc,node,phase,index];

test("D4-A3b1 owner PredicateSet qualifies tail append but not duplicates",()=>{
  const list=phaseVerifyAddOptions(source,proc,node,predicates,
    "establish-pdu-session");
  const option=list.find(x=>x.phaseName===phase);
  assert.ok(option,"existing Phase must have a qualified append anchor");
  assert.equal(option.stepIndex,5);
  assert.ok(option.choices.includes(added));
  assert.ok(!option.choices.includes(ingress));
  assert.ok(!option.choices.includes(lifecycle));
  assert.ok(Object.isFrozen(list)&&Object.isFrozen(option)&&
    Object.isFrozen(option.choices));
});
test("D4-A3b1 add a declared unbound Verify at Phase tail with exact Source insertion",()=>{
  assert.ok(source.includes(one+two));
  const p=previewAddPhaseVerify(...addArgs());
  assert.equal(p.type,"AddPhaseVerifyStep");
  assert.equal(p.sourceSpan.start,p.sourceSpan.end);
  assert.match(p.summary,/Runtime\/5GC 未验证/);
  assert.equal(p.candidateSource,source.replace(one+two,one+two+three));
  assert.equal(p.candidateSource.slice(p.sourceSpan.start,p.sourceSpan.start+
    three.length),three);
  assert.match(p.diff,/^\@\@.*\n\+ {12}- verify: createdsession.n4.initial_resources_ready$/m);
  const after=applyAddPhaseVerify(source,p,predicates);
  assert.equal(after,p.candidateSource);
  assert.equal(projectWorkspace(after).state,"READY");
  assert.equal(routeProjectionSignature(projectWorkspace(after))[0].nodes
    .find(x=>x.id===node).phases.find(x=>x.name===phase)
    .steps.at(-1).value,added);
  const back=previewDeletePhaseVerify(...delArgs(after,5));
  assert.equal(applyDeletePhaseVerify(after,back),source);
});
test("D4-A3b1 delete one plain unnamed Verify and preserve all other bytes",()=>{
  const options=phaseVerifyDeleteOptions(source,proc,node);
  assert.ok(options.some(x=>x.phaseName===phase&&x.stepIndex===4));
  assert.ok(options.some(x=>x.phaseName===phase&&x.stepIndex===3));
  assert.equal(options.some(x=>x.phaseName===phase&&x.stepIndex<3),false);
  assert.equal(Object.isFrozen(options),true);
  const p=previewDeletePhaseVerify(...delArgs());
  assert.equal(p.type,"DeletePhaseVerifyStep");
  assert.equal(source.slice(p.sourceSpan.start,p.sourceSpan.end),two);
  assert.equal(p.candidateSource,source.replace(one+two,one));
  assert.match(p.diff,/- {12}- verify: createdsession.lifecycle.ready/);
  const after=applyDeletePhaseVerify(source,p);
  assert.equal(after,p.candidateSource);
  assert.equal(projectWorkspace(after).state,"READY");
  assert.deepEqual(routeProjectionSignature(projectWorkspace(after))[0].routes,
    routeProjectionSignature(projectWorkspace(source))[0].routes);
});
test("D4-A3b1 rejects undeclared, duplicate, mismatched or invalid PredicateSets",()=>{
  const invalid=[
    ["createdsession.unlisted",predicates,"establish-pdu-session"],
    [ingress,predicates,"establish-pdu-session"],
    [added,predicates,"wrong-package"],
    [added,predicates.replace("kind: PredicateSet","kind: NotPredicates"),
      "establish-pdu-session"],
    [added,predicates.replace("skill: establish-pdu-session",
      "skill: other-skill"),"establish-pdu-session"],
    [added,predicates.replace(
      "createdsession.n4.initial_resources_ready:",
      "'createdsession.n4.initial_resources_ready':"),"establish-pdu-session"],
    [added,"kind: PredicateSet\npredicates: [","establish-pdu-session"]
  ];
  for(const [name,set,skill] of invalid){
    assert.throws(()=>previewAddPhaseVerify(source,proc,node,phase,
      name,set,skill));
  }
  assert.deepEqual(phaseVerifyAddOptions(source,proc,node,
    "kind: PredicateSet\npredicates: [","establish-pdu-session"),[]);
});
test("D4-A3b1 refuses unsafe append boundaries and phase overflow",()=>{
  for(const changed of [
    source.replace(two,two.replace(lifecycle,"'"+lifecycle+"'")),
    source.replace(two,two.replace(lifecycle,lifecycle+" # note")),
    source.replace(two,two+"          # trailing phase comment\n"),
    source.replace(one+two,one+two+"\n"),
    source.replace(two,two.replace("- verify:","- call:")),
    "procedures: ["
  ]){
    assert.throws(()=>previewAddPhaseVerify(...addArgs(changed)));
  }
  assert.throws(()=>previewAddPhaseVerify(source,proc,"nonexistent",phase,
    added,predicates,"establish-pdu-session"));
  assert.throws(()=>previewAddPhaseVerify(source,proc,node,"operator",
    added,predicates,"establish-pdu-session"));
});
test("D4-A3b1 deletion refuses named, bound, quoted, commented and sole Steps",()=>{
  for(const index of [-1,0,1,2,5,90,1.5]){
    assert.throws(()=>previewDeletePhaseVerify(...delArgs(source,index)));
  }
  for(const changed of [
    source.replace(two,"            - name: custom\n              verify: "+lifecycle+"\n"),
    source.replace(two,"            - verify: '"+lifecycle+"'\n"),
    source.replace(two,"            - verify: "+lifecycle+" # inline\n"),
    source.replace(one+two,one+"            # owning comment\n"+two),
    source.replace(one+two,one+"\n"+two),
    source.replace(two,"            - verify: "+lifecycle+"\n              with:\n                x:\n                  from: input.dnn\n"),
    source.replace(one+two,one+one),
    "procedures: ["
  ])assert.throws(()=>previewDeletePhaseVerify(...delArgs(changed)));
  assert.equal(phaseVerifyDeleteOptions("procedures: [",proc,node).length,0);
});
test("D4-A3b1 source revision and forged append/delete previews fail closed",()=>{
  const add=previewAddPhaseVerify(...addArgs());
  for(const changed of [
    {...add,diff:"wrong"},
    {...add,sourceSpan:{start:0,end:0}},
    {...add,predicate:ingress},
    {...add,candidateSource:source},
    {...add,stepIndex:0},
    {...add,extra:42},
    {...add,basePredicateSource:"forged"},
  ])assert.throws(()=>applyAddPhaseVerify(source,changed,predicates));
  assert.throws(()=>applyAddPhaseVerify(source+"\n",add,predicates),/Stale/);
  assert.throws(()=>applyAddPhaseVerify(source,add,predicates+"\n"),/Stale/);
  const del=previewDeletePhaseVerify(...delArgs());
  for(const changed of [
    {...del,diff:"wrong"},
    {...del,sourceSpan:{start:0,end:0}},
    {...del,stepIndex:3},
    {...del,candidateSource:source},
    {...del,unknown:true}
  ])assert.throws(()=>applyDeletePhaseVerify(source,changed));
  assert.throws(()=>applyDeletePhaseVerify(source+" ",del),/Stale/);
});
test("D4-A3b1 retains CRLF Source and is reversible across add/delete",()=>{
  const crlf=source.replace(/\n/g,"\r\n");
  const add=previewAddPhaseVerify(...addArgs(crlf));
  const after=applyAddPhaseVerify(crlf,add,predicates);
  assert.ok(after.includes(three.replace(/\n/g,"\r\n")));
  const del=previewDeletePhaseVerify(...delArgs(after,5));
  assert.equal(applyDeletePhaseVerify(after,del),crlf);
  const before=previewDeletePhaseVerify(...delArgs(crlf));
  assert.equal(projectWorkspace(applyDeletePhaseVerify(crlf,before)).state,
    "READY");
});
