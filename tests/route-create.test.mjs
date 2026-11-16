import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {projectWorkspace} from "../site/workspace.mjs";
import {addRouteOutcomeOptions,previewAddRouteOutcome,applyAddRouteOutcome}
  from "../site/route-create.mjs";
const fixture=skill=>readFileSync(new URL("../site/samples/packages/"+
  skill+"/assurance/procedure.yaml",import.meta.url),"utf8");
const ensure=fixture("ensure-pdu-session");
const created=fixture("establish-pdu-session");

function removeOutcome(source,nodeId,outcome){
  const model=projectWorkspace(source);
  const proc=[...model.procedures.values()].find(p=>p.nodes.some(n=>n.id===nodeId));
  const route=proc.routes.find(r=>r.source===nodeId&&r.outcome===outcome&&
    r.routeSource==="operator.on");
  assert.ok(route,"test must use actual original Route");
  const lineStart=source.lastIndexOf("\n",route.sourceSpan.start-1)+1;
  const lineEnd=source.indexOf("\n",route.sourceSpan.end);
  assert.ok(lineEnd>=0);
  return source.slice(0,lineStart)+source.slice(lineEnd+1);
}
test("D3-A1 adds one known verify Outcome with exact source-only line insertion",()=>{
  const text=removeOutcome(ensure,"observe-target-session","UNKNOWN");
  const p=projectWorkspace(text).procedure,oldCount=p.routes.length;
  const options=addRouteOutcomeOptions(text,p.name,"observe-target-session");
  assert.ok(options?.outcomes.includes("UNKNOWN"));
  assert.deepEqual(options?.routeSource,"operator.on");
  const preview=previewAddRouteOutcome(text,p.name,"observe-target-session",
    "UNKNOWN","unresolved");
  assert.equal(preview.type,"AddRouteOutcome");
  assert.equal(p.routes.some(r=>r.id==="observe-target-session:UNKNOWN"),false);
  assert.equal(projectWorkspace(preview.candidateSource).procedure.routes.some(r=>
    r.id==="observe-target-session:UNKNOWN"&&r.target==="unresolved"),true);
  assert.equal(preview.sourceSpan.start,preview.sourceSpan.end);
  const output=applyAddRouteOutcome(text,preview),next=projectWorkspace(output);
  assert.equal(next.state,"READY");
  assert.equal(next.procedure.routes.length,oldCount+1);
  assert.equal(next.procedure.routes.find(r=>
    r.id==="observe-target-session:UNKNOWN").target,"unresolved");
  assert.equal(output.length-text.length,"          UNKNOWN: unresolved\n".length);
  assert.ok(output.startsWith(text.slice(0,preview.sourceSpan.start)));
  assert.ok(output.endsWith(text.slice(preview.sourceSpan.end)));
  assert.equal(ensure,fixture("ensure-pdu-session"));
});
test("D3-A1 adds a known Outcome across CreatedSession child Procedures without changing siblings",()=>{
  const before=projectWorkspace(created);
  const procedure=before.procedures.get("await-initial-n4-session-establishment");
  const node=procedure.nodes.find(n=>n.id==="await-initial-resources");
  assert.equal(node.operator,"call");
  assert.equal(node.value,"ca.session.evidence.await");
  const route=procedure.routes.find(r=>r.source===node.id&&
    r.routeSource==="operator.on"&&r.outcome==="DENIED");
  assert.ok(route,"real CreatedSession child Procedure must have DENIED");
  const text=removeOutcome(created,node.id,route.outcome);
  const opts=addRouteOutcomeOptions(text,procedure.name,node.id);
  assert.ok(opts?.outcomes.includes(route.outcome),
    "the repeated ca.session.evidence.await Operator provides known outcome evidence");
  const preview=previewAddRouteOutcome(text,procedure.name,node.id,
    route.outcome,route.target);
  const output=applyAddRouteOutcome(text,preview);
  const after=projectWorkspace(output);
  assert.equal(after.state,"READY");
  assert.equal(after.procedures.size,before.procedures.size);
  assert.equal(after.procedures.get(procedure.name).routes.find(r=>
    r.id===node.id+":DENIED").target,route.target);
  assert.deepEqual([...after.procedures.keys()],[...before.procedures.keys()]);
});
test("D3-A1 never adds arbitrary Outcomes, missing nodes or duplicated keys",()=>{
  const text=removeOutcome(ensure,"observe-target-session","UNKNOWN");
  const id="observe-target-session",procedureId="ensure-session";
  assert.throws(()=>previewAddRouteOutcome(text,procedureId,id,"NOT_DEFINED","failed"));
  assert.throws(()=>previewAddRouteOutcome(text,procedureId,id,"UNKNOWN","missing-node"));
  assert.throws(()=>previewAddRouteOutcome(ensure,procedureId,id,"UNKNOWN","unresolved"));
  assert.equal(addRouteOutcomeOptions(ensure,procedureId,id),null);
  assert.equal(addRouteOutcomeOptions(text,procedureId,"done"),null);
  assert.equal(addRouteOutcomeOptions(text,procedureId,"not-existing"),null);
});
test("D3-A1 rejects stale Source and forged preview without modifying source",()=>{
  const text=removeOutcome(ensure,"observe-target-session","UNKNOWN");
  const preview=previewAddRouteOutcome(text,"ensure-session",
    "observe-target-session","UNKNOWN","unresolved");
  assert.throws(()=>applyAddRouteOutcome(text+"\n",preview),/Stale/);
  assert.throws(()=>applyAddRouteOutcome(text,{...preview,diff:"made-up"}));
  assert.throws(()=>applyAddRouteOutcome(text,{...preview,target:"done"}));
  assert.throws(()=>applyAddRouteOutcome(text,{...preview,sourceSpan:{start:0,end:0}}));
  assert.throws(()=>applyAddRouteOutcome(text,{...preview,unexpected:1}));
});
test("D3-A1 rejects quoted maps, quoted route scalars, duplicate keys, anchors and malformed source",()=>{
  const clean=removeOutcome(ensure,"observe-target-session","UNKNOWN");
  const cases=[
    clean.replace("'on':","on:"),
    clean.replace("PASS: done","'PASS': done"),
    clean.replace("PASS: done","PASS: 'done'"),
    clean.replace("PASS: done","PASS: &t done"),
    clean.replace("          FAIL: observe-session-absence",
      "          PASS: done\n          FAIL: observe-session-absence"),
    "procedures: ["
  ];
  for(const text of cases){
    assert.equal(addRouteOutcomeOptions(text,"ensure-session",
      "observe-target-session"),null);
    assert.throws(()=>previewAddRouteOutcome(text,"ensure-session",
      "observe-target-session","UNKNOWN","unresolved"));
  }
});
test("D3-A1 preserves inline comments and CRLF, fails closed on mixed newlines",()=>{
  const clean=removeOutcome(ensure,"observe-target-session","UNKNOWN");
  const annotated=clean.replace("FAIL: observe-session-absence",
    "FAIL: observe-session-absence # owner comment");
  const preview=previewAddRouteOutcome(annotated,"ensure-session",
    "observe-target-session","UNKNOWN","unresolved");
  const applied=applyAddRouteOutcome(annotated,preview);
  assert.match(applied,/FAIL: observe-session-absence # owner comment\n\s*UNKNOWN: unresolved/);
  const crlf=clean.replace(/\n/g,"\r\n");
  const p=previewAddRouteOutcome(crlf,"ensure-session",
    "observe-target-session","UNKNOWN","unresolved");
  assert.match(applyAddRouteOutcome(crlf,p),/UNKNOWN: unresolved\r\n/);
  assert.throws(()=>previewAddRouteOutcome(clean.replace("\n","\r\n"),
    "ensure-session","observe-target-session","UNKNOWN","unresolved"));
});
test("D3-A1 never writes Phase on when editing Operator on",()=>{
  const source=created;
  const parsed=projectWorkspace(source);
  const hasPhase=parsed.procedure.routes.find(r=>r.routeSource==="postconditions.on");
  assert.ok(hasPhase);
  assert.equal(addRouteOutcomeOptions(source,parsed.procedure.name,"not-a-node"),null);
  assert.throws(()=>previewAddRouteOutcome(source,parsed.procedure.name,
    hasPhase.source,"NOT_A_VALID_LABEL","failed"));
});
