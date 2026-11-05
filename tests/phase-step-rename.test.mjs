import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {projectWorkspace} from "../site/workspace.mjs";
import {routeProjectionSignature} from "../site/route-create.mjs";
import {namedPhaseStepImpactReport,previewNamedPhaseStepRename,
  applyNamedPhaseStepRename} from "../site/phase-step-rename.mjs";

const source=readFileSync(new URL("./fixtures/establish-pre-hold/assurance/procedure.yaml",import.meta.url),"utf8");
const pid="ue-requested-pdu-session-establishment";
const node="nudm-sdm-subscribe";
const oldName="select-subscription-configuration";
const nextName="select-subscription-config-v2";
const phase="preconditions",index=0;
const args=(src=source,newStepName=nextName)=>
  [src,pid,node,phase,index,newStepName];

test("D4-A3b2a pinned predecessor Step impact locates all same-Node and cross-Node consumers",()=>{
  const rows=namedPhaseStepImpactReport(source,pid,node);
  const selection=rows.find(x=>x.phaseName===phase&&x.stepIndex===index);
  assert.ok(selection);
  assert.equal(selection.stepName,oldName);
  assert.equal(selection.operator,"script");
  assert.equal(selection.status,"READY");
  assert.equal(selection.editEligible,true);
  assert.equal(selection.referenceCount,5);
  assert.equal(selection.references.length,5);
  assert.equal(selection.references.filter(x=>x.spelling==="LOCAL").length,2);
  assert.equal(selection.references.filter(x=>x.spelling==="QUALIFIED").length,3);
  assert.ok(selection.references.some(x=>x.consumerNodeId===
    "npcf-sm-policy-control-create"));
  assert.ok(selection.references.every(x=>x.line>0&&x.value.includes(oldName)));
  assert.ok(Object.isFrozen(rows)&&Object.isFrozen(selection)&&
    Object.isFrozen(selection.references));
});
test("D4-A3b2a renames real named Script Step and all five refs in one exact Source Patch",()=>{
  const p=previewNamedPhaseStepRename(...args());
  assert.equal(p.type,"RenameNamedPhaseStepAndReferences");
  assert.equal(p.referenceCount,5);
  assert.equal(p.sourceSpans.length,6);
  assert.equal(p.sourceSpans[0].kind,"identity");
  assert.equal(p.sourceSpans.slice(1).every(x=>x.kind==="reference"),true);
  assert.match(p.summary,/同步更新 5 处 from 引用；Runtime\/5GC 未验证/);
  assert.equal((p.diff.match(/@@ -/g)||[]).length,6);
  assert.equal(source.includes(nextName),false);
  assert.equal(p.candidateSource,source.replaceAll(oldName,nextName));
  assert.equal(p.candidateSource.includes(oldName),false);
  assert.equal(projectWorkspace(p.candidateSource).state,"READY");
  const after=applyNamedPhaseStepRename(source,p);
  assert.equal(after,p.candidateSource);
  const oldSig=routeProjectionSignature(projectWorkspace(source));
  const newSig=routeProjectionSignature(projectWorkspace(after));
  const selected=oldSig.find(p=>p.name===pid).nodes.find(n=>n.id===node)
    .phases.find(x=>x.name===phase).steps[index];
  selected.name=nextName;
  assert.deepEqual(newSig,oldSig);
  const reverse=previewNamedPhaseStepRename(...args(after,oldName));
  assert.equal(applyNamedPhaseStepRename(after,reverse),source);
});
test("D4-A3b2a unknown, ambiguous, quoted and comment Step uses block rename",()=>{
  const local="from: preconditions."+oldName+".output";
  const cases=[
    source.replace(local,"from: 'preconditions."+oldName+".output'"),
    source.replace(local,"from: &ref preconditions."+oldName+".output"),
    source.replace(local,"from: unknown."+oldName+".output"),
    source.replace(local,"from: "+oldName+".output"),
    source.replace("            - name: "+oldName,
      "            - name: '"+oldName+"'"),
    source.replace("            - name: "+oldName,
      "            - name: &x "+oldName),
    source.replace("            - name: "+oldName,
      "            - name: "+oldName+" # comment"),
    source.replace("            - name: resolve-pcf-create-inputs",
      "            - name: "+oldName),
    source.replace("            - name: "+oldName,
      "            # "+oldName+"\n            - name: "+oldName),
    source.replace("              with:\n", "              foo: "+oldName+"\n              with:\n"),
    "procedures: ["
  ];
  for(const changed of cases){
    const impact=namedPhaseStepImpactReport(changed,pid,node)
      .find(x=>x.stepName===oldName);
    if(impact)assert.equal(impact.editEligible,false);
    assert.throws(()=>previewNamedPhaseStepRename(...args(changed)));
  }
});
test("D4-A3b2a refuses collisions, invalid scope, step index and names",()=>{
  for(const name of [
    oldName,"resolve-pcf-create-inputs",oldName+"-suffix",
    "0bad","a space","x.y",""
  ])assert.throws(()=>previewNamedPhaseStepRename(...args(source,name)));
  for(const [p,n,ph,i] of [
    ["unknown",node,phase,index],[pid,"missing",phase,index],
    [pid,node,"on",index],[pid,node,phase,2],
    [pid,node,phase,-1],[pid,node,phase,99]
  ])assert.throws(()=>previewNamedPhaseStepRename(source,p,n,ph,i,nextName));
  assert.deepEqual(namedPhaseStepImpactReport(source,pid,"missing"),[]);
});
test("D4-A3b2a rejects stale, forged or conflicting previews",()=>{
  const p=previewNamedPhaseStepRename(...args());
  for(const altered of [
    {...p,diff:"bad"}, {...p,sourceSpans:[]},
    {...p,referenceCount:0}, {...p,candidateSource:source},
    {...p,stepIndex:1}, {...p,oldName:"other"},
    {...p,newName:"resolve-pcf-create-inputs"}, {...p,unexpected:true}
  ])assert.throws(()=>applyNamedPhaseStepRename(source,altered));
  assert.throws(()=>applyNamedPhaseStepRename(source+"\n",p),/Stale/);
});
test("D4-A3b2a CRLF Source is edited without normalizing line endings",()=>{
  const crlf=source.replace(/\n/g,"\r\n");
  const p=previewNamedPhaseStepRename(...args(crlf));
  const changed=applyNamedPhaseStepRename(crlf,p);
  assert.equal(changed,crlf.replaceAll(oldName,nextName));
  assert.ok(changed.includes("\r\n"));
  const reverse=previewNamedPhaseStepRename(...args(changed,oldName));
  assert.equal(applyNamedPhaseStepRename(changed,reverse),crlf);
});
