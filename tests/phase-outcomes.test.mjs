import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {projectWorkspace} from "../site/workspace.mjs";
import {routeProjectionSignature} from "../site/route-create.mjs";
import {phaseOutcomeEditOptions,previewAddObservedPhaseOutcome,
  previewRenameNoncorePhaseOutcome,previewDeleteNoncorePhaseOutcome,
  applyAddObservedPhaseOutcome,applyRenameNoncorePhaseOutcome,
  applyDeleteNoncorePhaseOutcome} from "../site/phase-outcomes.mjs";

const original=readFileSync(new URL("../site/samples/packages/"+
 "establish-pdu-session/assurance/procedure.yaml",import.meta.url),"utf8");
const pid="ue-requested-pdu-session-establishment";
const subscribe="nudm-sdm-subscribe",pcf="npcf-sm-policy-control-create";
const prepare="preconditions";
const full="          'on':\n            FAILED: failed\n            UNRESOLVED: unresolved\n";
const missing="          'on':\n            UNRESOLVED: unresolved\n";
const missingSource=original.replace(full,missing);
const addArgs=(s=missingSource)=>[s,pid,subscribe,prepare,"FAILED","finalize-failed"];
const addPreview=s=>previewAddObservedPhaseOutcome(...addArgs(s));
const pcfPhase="          'on':\n            FAILED: finalize-failed\n            UNRESOLVED: finalize-unresolved\n";
const mistaken="          'on':\n            MISTYPED: finalize-failed\n            UNRESOLVED: finalize-unresolved\n";
const mistakenSource=original.replace(pcfPhase,mistaken);
const extra="          'on':\n            FAILED: failed\n            UNRESOLVED: unresolved\n            EXTRA: failed\n";
const extraSource=original.replace(full,extra);

function compareRouteMutation(a,b,update){
 const expected=routeProjectionSignature(projectWorkspace(a));
 const p=expected.find(x=>x.name===pid);
 update(p.routes);
 assert.deepEqual(routeProjectionSignature(projectWorkspace(b)),expected);
}
test("D4-A4b1 owner Phase maps are complete; protect all core Outcomes",()=>{
 assert.notEqual(missingSource,original);
 assert.notEqual(mistakenSource,original);
 assert.notEqual(extraSource,original);
 const model=projectWorkspace(original);
 assert.equal(model.state,"READY");
 const a=phaseOutcomeEditOptions(original,pid,subscribe);
 const pre=a.find(x=>x.phaseName==="preconditions");
 const post=a.find(x=>x.phaseName==="postconditions");
 assert.deepEqual(pre.required,["FAILED","UNRESOLVED"]);
 assert.deepEqual(pre.present,["FAILED","UNRESOLVED"]);
 assert.deepEqual(post.required,["PASS","FAIL","UNKNOWN"]);
 assert.deepEqual(pre.adds,[]);
 assert.deepEqual(pre.renames,[]);
 assert.deepEqual(pre.deletions,[]);
 assert.deepEqual(post.deletions,[]);
 assert.ok(Object.isFrozen(a)&&Object.isFrozen(pre));
 assert.throws(()=>previewDeleteNoncorePhaseOutcome(original,pid,subscribe,
   "preconditions","FAILED"));
 assert.throws(()=>previewDeleteNoncorePhaseOutcome(original,pid,subscribe,
   "postconditions","PASS"));
});
test("D4-A4b1 repair missing FAILED only from exact same-Phase/Outcome observed targets",()=>{
 assert.equal(projectWorkspace(missingSource).state,"READY");
 const opt=phaseOutcomeEditOptions(missingSource,pid,subscribe)
   .find(x=>x.phaseName===prepare);
 assert.ok(opt.adds.some(x=>x.outcome==="FAILED"&&x.target==="finalize-failed"));
 assert.equal(opt.adds.some(x=>x.outcome==="FAILED"&&x.target==="finalize-unresolved"),false);
 const p=addPreview(missingSource);
 assert.equal(p.type,"AddObservedPhaseOutcome");
 assert.equal(p.mode,"add");
 assert.equal(missingSource.slice(p.sourceSpan.start,p.sourceSpan.end),"");
 assert.match(p.diff,/\+            FAILED: finalize-failed/);
 const changed=applyAddObservedPhaseOutcome(missingSource,p);
 assert.equal(changed,missingSource.replace(missing,
   missing+"            FAILED: finalize-failed\n"));
 assert.equal(projectWorkspace(changed).state,"READY");
 compareRouteMutation(missingSource,changed,r=>{
  const idx=r.findIndex(x=>x.id===subscribe+":preconditions:UNRESOLVED");
  r.splice(idx+1,0,{id:subscribe+":preconditions:FAILED",source:subscribe,
    target:"finalize-failed",outcome:"FAILED",routeSource:"preconditions.on"});
 });
 assert.deepEqual(phaseOutcomeEditOptions(changed,pid,subscribe)
  .find(x=>x.phaseName===prepare).adds,[]);
});
test("D4-A4b1 correct a uniquely misspelled noncore key with observed target",()=>{
 assert.equal(projectWorkspace(mistakenSource).state,"READY");
 const options=phaseOutcomeEditOptions(mistakenSource,pid,pcf)
   .find(x=>x.phaseName===prepare);
 assert.ok(options.renames.some(x=>x.oldOutcome==="MISTYPED"&&
   x.newOutcome==="FAILED"&&x.target==="finalize-failed"));
 assert.equal(options.deletions.length,0,"missing core prevents deletion");
 const p=previewRenameNoncorePhaseOutcome(mistakenSource,pid,pcf,
   prepare,"MISTYPED","FAILED");
 assert.equal(p.type,"RenameNoncorePhaseOutcome");
 assert.equal(p.target,"finalize-failed");
 assert.equal(applyRenameNoncorePhaseOutcome(mistakenSource,p),original);
 assert.equal(mistakenSource.slice(p.sourceSpan.start,p.sourceSpan.end),"MISTYPED");
 compareRouteMutation(mistakenSource,original,rs=>{
  const row=rs.find(x=>x.id===pcf+":preconditions:MISTYPED");
  row.id=pcf+":preconditions:FAILED";row.outcome="FAILED";
 });
});
test("D4-A4b1 allow deletion of an isolated noncore extra with full core present",()=>{
 assert.equal(projectWorkspace(extraSource).state,"READY");
 const opts=phaseOutcomeEditOptions(extraSource,pid,subscribe)
  .find(x=>x.phaseName===prepare);
 assert.deepEqual(opts.deletions,[{outcome:"EXTRA",target:"failed"}]);
 const p=previewDeleteNoncorePhaseOutcome(extraSource,pid,subscribe,
   prepare,"EXTRA");
 assert.equal(p.type,"DeleteNoncorePhaseOutcome");
 assert.equal(extraSource.slice(p.sourceSpan.start,p.sourceSpan.end),
   "            EXTRA: failed\n");
 assert.match(p.diff,/-            EXTRA: failed/);
 assert.equal(applyDeleteNoncorePhaseOutcome(extraSource,p),original);
 compareRouteMutation(extraSource,original,rs=>{
  rs.splice(rs.findIndex(x=>x.id===subscribe+":preconditions:EXTRA"),1);
 });
});
test("D4-A4b1 reject fabricated outcomes, incorrect values and cross origin",()=>{
 const forbidden=[
  ()=>previewAddObservedPhaseOutcome(missingSource,pid,subscribe,prepare,
    "INVENTED","failed"),
  ()=>previewAddObservedPhaseOutcome(missingSource,pid,subscribe,prepare,
    "FAILED","unresolved"),
  ()=>previewAddObservedPhaseOutcome(missingSource,pid,subscribe,prepare,
    "UNRESOLVED","finalize-unresolved"),
  ()=>previewAddObservedPhaseOutcome(original,pid,subscribe,prepare,
    "FAILED","finalize-failed"),
  ()=>previewAddObservedPhaseOutcome(missingSource,pid,subscribe,
    "postconditions","FAILED","finalize-failed"),
  ()=>previewAddObservedPhaseOutcome(missingSource,pid,subscribe,prepare,
    "FAILED","missing-node"),
  ()=>previewAddObservedPhaseOutcome(missingSource,"missing",subscribe,
    prepare,"FAILED","finalize-failed"),
  ()=>previewRenameNoncorePhaseOutcome(original,pid,subscribe,
    prepare,"FAILED","UNRESOLVED"),
  ()=>previewRenameNoncorePhaseOutcome(mistakenSource,pid,pcf,
    prepare,"MISTYPED","UNRESOLVED"),
  ()=>previewDeleteNoncorePhaseOutcome(mistakenSource,pid,pcf,
    prepare,"MISTYPED"),
  ()=>previewDeleteNoncorePhaseOutcome(extraSource,pid,subscribe,
    prepare,"FAILED"),
 ];
 for(const fn of forbidden)assert.throws(fn);
 assert.deepEqual(phaseOutcomeEditOptions("procedures: [",pid,subscribe),[]);
});
test("D4-A4b1 reject noncore references, reused unknown keys and unsafe structures",()=>{
 const externallyReferenced=extraSource+
   "# nudm-sdm-subscribe:preconditions:EXTRA\n";
 assert.throws(()=>previewDeleteNoncorePhaseOutcome(externallyReferenced,
   pid,subscribe,prepare,"EXTRA"));
 const cases=[
  missingSource.replace("          'on':\n            UNRESOLVED: unresolved",
    "          on:\n            UNRESOLVED: unresolved"),
  missingSource.replace("UNRESOLVED: unresolved",
    "'UNRESOLVED': unresolved"),
  missingSource.replace("UNRESOLVED: unresolved",
    "UNRESOLVED: 'unresolved'"),
  missingSource.replace("UNRESOLVED: unresolved",
    "UNRESOLVED: &x unresolved"),
  missingSource.replace("UNRESOLVED: unresolved",
    "UNRESOLVED: unresolved # note"),
  missingSource.replace("UNRESOLVED: unresolved",
    "UNRESOLVED: unresolved\n            UNRESOLVED: unresolved"),
  missingSource.replace("          'on':\n            UNRESOLVED",
    "          'on':\n            # comment\n            UNRESOLVED"),
  missingSource.replace("UNRESOLVED: unresolved",
    "UNRESOLVED: unresolved\n            # attached"),
  missingSource.replace("UNRESOLVED: unresolved",
    "UNRESOLVED: unresolved\n\n"),
 ];
 for(const s of cases){
   assert.throws(()=>addPreview(s));
   const o=phaseOutcomeEditOptions(s,pid,subscribe)
      .find(x=>x.phaseName===prepare);
   assert.equal(o?.adds?.length??0,0);
 }
});
test("D4-A4b1 noncore Outcome deletion rejects inline, preceding and duplicated rows",()=>{
 const cases=[
   extraSource.replace("EXTRA: failed","EXTRA: failed # comment"),
   extraSource.replace("            EXTRA: failed",
     "            # attached\n            EXTRA: failed"),
   extraSource.replace("            EXTRA: failed",
     "            EXTRA: failed\n            EXTRA: failed"),
   extraSource.replace("            EXTRA: failed","'EXTRA': failed"),
 ];
 for(const text of cases)
   assert.throws(()=>previewDeleteNoncorePhaseOutcome(text,pid,subscribe,
      prepare,"EXTRA"));
});
test("D4-A4b1 preview Apply always checks full current Source and immutable fields",()=>{
 for(const [s,p,fn] of [
  [missingSource,addPreview(missingSource),applyAddObservedPhaseOutcome],
  [mistakenSource,previewRenameNoncorePhaseOutcome(mistakenSource,
   pid,pcf,prepare,"MISTYPED","FAILED"),applyRenameNoncorePhaseOutcome],
  [extraSource,previewDeleteNoncorePhaseOutcome(extraSource,pid,subscribe,
   prepare,"EXTRA"),applyDeleteNoncorePhaseOutcome]
 ]){
  assert.throws(()=>fn(s+"\n",p),/Stale/);
  for(const forged of [
   {...p,profile:"other"},{...p,diff:"forged"},
   {...p,candidateSource:s},{...p,sourceSpan:{start:0,end:0}},
   {...p,phaseName:"postconditions"},{...p,routeId:"fake"},
   {...p,extra:true}
  ])assert.throws(()=>fn(s,forged));
 }
});
test("D4-A4b1 preserve original CRLF and reject mixed line endings",()=>{
 const cr=missingSource.replace(/\n/g,"\r\n");
 const p=addPreview(cr),actual=applyAddObservedPhaseOutcome(cr,p);
 assert.equal(actual,missingSource.replace(missing,
    missing+"            FAILED: finalize-failed\n").replace(/\n/g,"\r\n"));
 const typo=mistakenSource.replace(/\n/g,"\r\n");
 assert.equal(applyRenameNoncorePhaseOutcome(typo,
    previewRenameNoncorePhaseOutcome(typo,pid,pcf,prepare,
       "MISTYPED","FAILED")),original.replace(/\n/g,"\r\n"));
 const ext=extraSource.replace(/\n/g,"\r\n");
 assert.equal(applyDeleteNoncorePhaseOutcome(ext,
    previewDeleteNoncorePhaseOutcome(ext,pid,subscribe,prepare,"EXTRA")),
    original.replace(/\n/g,"\r\n"));
 assert.throws(()=>addPreview(missingSource.replace("\n","\r\n")),
   /Mixed|unsupported/);
});
