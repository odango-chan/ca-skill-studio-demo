import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {projectWorkspace} from "../site/workspace.mjs";
import {routeProjectionSignature} from "../site/route-create.mjs";
import {phaseRouteTargetOptions,previewPhaseRouteTarget,
  applyPhaseRouteTarget} from "../site/phase-routes.mjs";

const source=readFileSync(new URL("../site/samples/packages/"+
  "establish-pdu-session/assurance/procedure.yaml",import.meta.url),"utf8");
const pid="ue-requested-pdu-session-establishment";
const sub="nudm-sdm-subscribe";
const get="nudm-sdm-get";
const before=()=>projectWorkspace(source);
const rid=sub+":preconditions:FAILED";
const postId=get+":postconditions:FAIL";

test("D4-A4a real owner sample offers only same-Phase/same-Outcome failure destinations",()=>{
  const options=phaseRouteTargetOptions(source,pid,sub);
  const failed=options.find(x=>x.routeId===rid);
  assert.ok(failed,"root UDM subscribe preconditions FAILED route must qualify");
  assert.equal(failed.phaseName,"preconditions");
  assert.equal(failed.routeSource,"preconditions.on");
  assert.equal(failed.outcome,"FAILED");
  assert.equal(failed.target,"failed");
  assert.ok(failed.targets.includes("finalize-failed"));
  assert.ok(!failed.targets.includes("finalize-unresolved"));
  assert.ok(!failed.targets.includes("npcf-sm-policy-control-create"));
  assert.equal(options.some(x=>x.routeId===sub+":postconditions:PASS"),false);
  assert.equal(options.some(x=>x.routeId===sub+":NOT_COMMITTED"),false);
  assert.equal(Object.isFrozen(options),true);
  assert.equal(Object.isFrozen(failed.targets),true);
});

test("D4-A4a retarget existing preconditions FAILED without touching operator/on or other Phases",()=>{
  const preview=previewPhaseRouteTarget(source,pid,rid,"finalize-failed");
  assert.equal(preview.type,"SetPhaseRouteTarget");
  assert.equal(preview.phaseName,"preconditions");
  assert.equal(preview.routeSource,"preconditions.on");
  assert.equal(source.slice(preview.sourceSpan.start,preview.sourceSpan.end),"failed");
  assert.match(preview.diff,/-            FAILED: failed/);
  assert.match(preview.diff,/\+            FAILED: finalize-failed/);
  assert.match(preview.summary,/资源清理路径；Runtime\/5GC 未验证/);
  const applied=applyPhaseRouteTarget(source,preview);
  assert.equal(applied,preview.candidateSource);
  assert.equal(applied,source.slice(0,preview.sourceSpan.start)+"finalize-failed"+
    source.slice(preview.sourceSpan.end));
  const after=projectWorkspace(applied);
  assert.equal(after.state,"READY");
  const expected=routeProjectionSignature(before());
  const route=expected.find(x=>x.name===pid).routes.find(x=>x.id===rid);
  route.target="finalize-failed";
  assert.deepEqual(routeProjectionSignature(after),expected);
  assert.equal(after.procedures.get(pid).routes.find(x=>
    x.id===sub+":FAILED").target,
    before().procedures.get(pid).routes.find(x=>x.id===sub+":FAILED").target);
  assert.equal(after.procedures.get(pid).routes.find(x=>
    x.id===sub+":postconditions:PASS").target,
    before().procedures.get(pid).routes.find(x=>x.id===sub+":postconditions:PASS").target);
  // Only current same-Phase/same-Outcome values qualify. After the edit
  // the original target is no longer observed there; Undo is authoritative.
  assert.throws(()=>previewPhaseRouteTarget(applied,pid,rid,"failed"));
  assert.equal(phaseRouteTargetOptions(applied,pid,sub).some(x=>
    x.routeId===rid),false);
});

test("D4-A4a postconditions FAIL can retarget but PASS happy-path cannot",()=>{
  const options=phaseRouteTargetOptions(source,pid,get);
  const failRow=options.find(x=>x.routeId===postId);
  assert.ok(failRow?.targets.includes("finalize-failed"));
  assert.equal(failRow.routeSource,"postconditions.on");
  const preview=previewPhaseRouteTarget(source,pid,postId,"finalize-failed");
  const after=applyPhaseRouteTarget(source,preview);
  assert.equal(projectWorkspace(after).state,"READY");
  assert.equal(projectWorkspace(after).procedures.get(pid).routes.find(r=>
    r.id===postId).target,"finalize-failed");
  assert.throws(()=>previewPhaseRouteTarget(source,pid,
    get+":postconditions:PASS","npcf-sm-policy-control-create"));
});

test("D4-A4a fails closed for invented Outcome/Target, other route origin and Phase",()=>{
  for(const [procedure,route,target] of [
    [pid,rid,"UNKNOWN"],[pid,rid,"missing-node"],[pid,rid,"failed"],
    [pid,rid,"finalize-unresolved"],[pid,sub+":FAILED","finalize-failed"],
    [pid,sub+":postconditions:PASS","finalize-failed"],
    [pid,sub+":preconditions:UNRESOLVED","finalize-failed"],
    ["await-initial-n4-session-establishment",rid,"finalize-failed"],
    [pid,"missing:preconditions:FAILED","finalize-failed"]
  ])assert.throws(()=>previewPhaseRouteTarget(source,procedure,route,target));
  assert.deepEqual(phaseRouteTargetOptions(source,pid,"missing-node"),[]);
  assert.deepEqual(phaseRouteTargetOptions("procedures: [",pid,sub),[]);
});

test("D4-A4a quoted/aliased/annotated Phase Route never enables Visual target change",()=>{
  const block="          'on':\n            FAILED: failed\n            UNRESOLVED: unresolved";
  assert.ok(source.includes(block));
  const cases=[
    source.replace(block,block.replace("'on':","on:")),
    source.replace(block,block.replace("FAILED: failed","'FAILED': failed")),
    source.replace(block,block.replace("FAILED: failed","FAILED: 'failed'")),
    source.replace(block,block.replace("FAILED: failed","FAILED: &x failed")),
    source.replace(block,block.replace("FAILED: failed","FAILED: failed # note")),
    source.replace(block,block.replace("FAILED: failed",
      "FAILED: failed\n            FAILED: failed")),
    source.replace(block,block.replace("FAILED: failed",
      "# owned comment\n            FAILED: failed")),
    source.replace(block,block.replace("FAILED: failed",
      "FAILED: failed\n\n")),
    "procedures: ["
  ];
  for(const changed of cases){
    assert.equal(phaseRouteTargetOptions(changed,pid,sub).some(x=>x.routeId===rid),
      false);
    assert.throws(()=>previewPhaseRouteTarget(changed,pid,rid,"finalize-failed"));
  }
});

test("D4-A4a rejects stale, modified or forged target previews on Apply",()=>{
  const p=previewPhaseRouteTarget(source,pid,rid,"finalize-failed");
  for(const f of [
    {...p,diff:"other"},{...p,routeSource:"operator.on"},
    {...p,routeId:sub+":postconditions:PASS"},{...p,phaseName:"postconditions"},
    {...p,sourceSpan:{start:0,end:0}},{...p,oldTarget:"other"},
    {...p,candidateSource:source},{...p,newTarget:"unresolved"},
    {...p,profile:"unsafe"},{...p,extra:42}
  ])assert.throws(()=>applyPhaseRouteTarget(source,f));
  assert.throws(()=>applyPhaseRouteTarget(source+"\n",p),/Stale/);
});

test("D4-A4a keeps CRLF bytes and refuses mixed EOL",()=>{
  const crlf=source.replace(/\n/g,"\r\n");
  const p=previewPhaseRouteTarget(crlf,pid,rid,"finalize-failed");
  const changed=applyPhaseRouteTarget(crlf,p);
  assert.equal(changed,crlf.slice(0,p.sourceSpan.start)+"finalize-failed"+
    crlf.slice(p.sourceSpan.end));
  assert.equal(changed.match(/\r\n/g).length,crlf.match(/\r\n/g).length);
  assert.throws(()=>previewPhaseRouteTarget(changed,pid,rid,"failed"));
  assert.throws(()=>previewPhaseRouteTarget(source.replace("\n","\r\n"),
    pid,rid,"finalize-failed"),/Mixed/);
});
