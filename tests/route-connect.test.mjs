import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {projectWorkspace} from "../site/workspace.mjs";
import {proposeCanvasRouteConnection,previewCanvasRouteConnection}
  from "../site/route-connect.mjs";
import {applyAddRouteOutcome} from "../site/route-create.mjs";

const load=name=>readFileSync(new URL("../site/samples/packages/"+
  name+"/assurance/procedure.yaml",import.meta.url),"utf8");
const ensure=load("ensure-pdu-session");
const created=load("establish-pdu-session");
const missing=ensure.replace("          UNKNOWN: unresolved\n","");
const request=source=>({
  source,procedureId:"ensure-session",
  sourceId:"observe-target-session",targetId:"unresolved",
  sourceHandle:"new-route-out",targetHandle:"in"
});
test("D3-A3 only proposes an A1 Patch; no YAML change until explicit Outcome and Apply",()=>{
  assert.equal(projectWorkspace(missing).state,"READY");
  const proposal=proposeCanvasRouteConnection(request(missing));
  assert.equal(proposal.routeSource,"operator.on");
  assert.deepEqual(proposal.outcomes,["UNKNOWN"]);
  assert.equal(Object.isFrozen(proposal),true);
  assert.equal(Object.isFrozen(proposal.outcomes),true);
  assert.equal(missing.includes("observe-target-session:UNKNOWN"),false);
  assert.throws(()=>previewCanvasRouteConnection(missing,proposal,""),/Choose/);
  const preview=previewCanvasRouteConnection(missing,proposal,"UNKNOWN");
  assert.equal(preview.type,"AddRouteOutcome");
  assert.equal(preview.routeSource,"operator.on");
  assert.equal(preview.target,"unresolved");
  assert.ok(preview.diff.includes("+          UNKNOWN: unresolved"));
  assert.equal(applyAddRouteOutcome(missing,preview),ensure);
});
test("D3-A3 fails closed on invalid source handles and targets",()=>{
  for(const handle of ["out","edge-0-out","in","other",null,""])
    assert.throws(()=>proposeCanvasRouteConnection({
      ...request(missing),sourceHandle:handle}),/dedicated/);
  for(const handle of ["new-route-out","edge-0-out","none",null,""])
    assert.throws(()=>proposeCanvasRouteConnection({
      ...request(missing),targetHandle:handle}),/dedicated/);
  for(const targetId of ["nonexistent","observe-target-session","bad name","",null])
    assert.throws(()=>proposeCanvasRouteConnection({
      ...request(missing),targetId}));
  assert.throws(()=>proposeCanvasRouteConnection({
    ...request(missing),sourceId:"done"}));
  assert.throws(()=>proposeCanvasRouteConnection({
    ...request(missing),procedureId:"another-procedure"}));
  assert.throws(()=>proposeCanvasRouteConnection(request(ensure)),/No source-qualified/);
});
test("D3-A3 rejects stale, forged, unrelated or ambiguous Outcome proposals",()=>{
  const proposal=proposeCanvasRouteConnection(request(missing));
  for(const p of [
    {...proposal,outcomes:["INVENTED"]},
    {...proposal,targetId:"done"},
    {...proposal,routeSource:"postconditions.on"},
    {...proposal,profile:"unsafe"},
    {...proposal,extra:"any"}
  ])assert.throws(()=>previewCanvasRouteConnection(missing,p,"UNKNOWN"));
  assert.throws(()=>previewCanvasRouteConnection(missing+"\n",proposal,"UNKNOWN"),/stale/i);
  assert.throws(()=>previewCanvasRouteConnection(missing,proposal,"PASS"),/Choose/);
  assert.throws(()=>previewCanvasRouteConnection(missing,proposal,"FAKE"),/Choose/);
});
test("D3-A3 isolates actual CreatedSession child Procedure and Phase-only Routes",()=>{
  const before=projectWorkspace(created);
  const proc=before.procedures.get("await-initial-n4-session-establishment");
  assert.ok(proc);
  const route=proc.routes.find(r=>r.source==="await-initial-resources"&&
    r.outcome==="DENIED"&&r.routeSource==="operator.on");
  assert.ok(route);
  const at=created.indexOf("      await-initial-resources:");
  const start=created.indexOf("          DENIED:",at);
  const end=created.indexOf("\n",start);
  assert.ok(at>=0&&start>at&&end>start);
  const current=created.slice(0,start)+created.slice(end+1);
  assert.equal(projectWorkspace(current).state,"READY");
  const p=proposeCanvasRouteConnection({
    source:current,procedureId:proc.name,
    sourceId:route.source,targetId:route.target,
    sourceHandle:"new-route-out",targetHandle:"edge-2-in"
  });
  assert.ok(p.outcomes.includes("DENIED"));
  const preview=previewCanvasRouteConnection(current,p,"DENIED");
  assert.equal(applyAddRouteOutcome(current,preview),created);
  const phaseRoute=before.procedure.routes.find(r=>r.routeSource==="postconditions.on");
  assert.ok(phaseRoute);
  assert.throws(()=>proposeCanvasRouteConnection({
    source:created,procedureId:before.procedure.name,
    sourceId:phaseRoute.source,targetId:phaseRoute.target,
    sourceHandle:"edge-0-out",targetHandle:"in"
  }));
});
