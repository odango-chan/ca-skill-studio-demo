import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {projectWorkspace} from "../site/workspace.mjs";
import {insertNodeOptions,previewNodeInsert,applyNodeInsert} from "../site/node-create.mjs";

const read=(skill,file="procedure.yaml")=>readFileSync(new URL(
  "../site/samples/packages/"+skill+"/assurance/"+file,import.meta.url),"utf8");
const ensure=read("ensure-pdu-session"),created=read("establish-pdu-session");
const ensureProc=projectWorkspace(ensure).procedure;
const root=projectWorkspace(created).procedure;
const createdPred=read("establish-pdu-session","predicates.yaml");

test("insert a terminal on an Ensure Route atomically, with unchanged original target",()=>{
  const route=ensureProc.routes.find(r=>r.source==="observe-target-session"&&r.outcome==="FAIL");
  const options=insertNodeOptions(ensure,ensureProc.name,route.id);
  assert.ok(options?.terminalValues.includes("FAILED"));
  const spec={nodeId:"safe-stop-new",operator:"terminal",value:"FAILED",outcome:""};
  const preview=previewNodeInsert(ensure,ensureProc.name,route.id,spec);
  const applied=applyNodeInsert(ensure,preview);
  const proj=projectWorkspace(applied);
  assert.equal(proj.state,"READY");
  assert.equal(proj.procedure.nodes.length,ensureProc.nodes.length+1);
  assert.equal(proj.procedure.routes.length,ensureProc.routes.length);
  assert.equal(proj.procedure.start,ensureProc.start);
  assert.equal(proj.procedure.routes.find(r=>r.id===route.id).target,"safe-stop-new");
  assert.ok(proj.procedure.nodes.some(n=>n.id==="safe-stop-new"&&
    n.operator==="terminal"&&n.value==="FAILED"));
  assert.ok(proj.procedure.nodes.some(n=>n.id===route.target));
  assert.equal(ensure,read("ensure-pdu-session"));
  assert.match(preview.diff,/\+      safe-stop-new:/);
});
test("insert a call Node on an existing Route with a return edge to old target",()=>{
  const route=ensureProc.routes.find(r=>r.source==="observe-target-session"&&r.outcome==="FAIL");
  const preview=previewNodeInsert(ensure,ensureProc.name,route.id,{
    nodeId:"read-again",operator:"call",value:"sbi.demo.read",outcome:"COMMITTED"});
  const applied=applyNodeInsert(ensure,preview);
  const p=projectWorkspace(applied).procedure;
  assert.equal(p.nodes.length,ensureProc.nodes.length+1);
  assert.equal(p.routes.length,ensureProc.routes.length+1);
  assert.equal(p.routes.find(r=>r.id==="read-again:COMMITTED").routeSource,
    "operator.on");
  assert.equal(p.routes.find(r=>r.id==="read-again:COMMITTED").target,route.target);
  assert.equal(p.routes.find(r=>r.id===route.id).target,"read-again");
  assert.match(applied,/read-again:\n        call: sbi\.demo\.read\n        'on':\n          COMMITTED: observe-session-absence/);
});
test("generic insert works in CreatedSession multi-Procedure and Phase route",()=>{
  const model=projectWorkspace(created);
  const route=root.routes.find(r=>r.routeSource==="postconditions.on"&&r.patchable);
  assert.ok(route,"CreatedSession must have a Phase route");
  const preview=previewNodeInsert(created,root.name,route.id,{
    nodeId:"post-check-new",operator:"call",value:"sbi.demo.audit",outcome:"COMMITTED"});
  const applied=applyNodeInsert(created,preview);
  const after=projectWorkspace(applied);
  assert.equal(after.state,"READY");
  assert.equal(after.procedures.size,6);
  assert.equal(after.procedures.get(root.name).routes.find(r=>r.id===route.id).target,"post-check-new");
  assert.equal(after.procedures.get(root.name).routes.find(r=>r.id==="post-check-new:COMMITTED").target,route.target);
  for(const [name,proc] of model.procedures){
    if(name===root.name)continue;
    assert.deepEqual(after.procedures.get(name).nodes.map(n=>n.id),proc.nodes.map(n=>n.id));
  }
});
test("Verify insertion requires predicate in the matching active package",()=>{
  const route=root.routes.find(r=>r.patchable);
  const spec={nodeId:"verify-new",operator:"verify",
    value:"createdsession.ingress.eligible",outcome:"PASS"};
  const yes=insertNodeOptions(created,root.name,route.id,createdPred,"establish-pdu-session");
  assert.ok(yes?.predicates.includes(spec.value));
  const preview=previewNodeInsert(created,root.name,route.id,spec,createdPred,
    "establish-pdu-session");
  assert.equal(projectWorkspace(applyNodeInsert(created,preview,createdPred,
    "establish-pdu-session")).state,"READY");
  assert.throws(()=>previewNodeInsert(created,root.name,route.id,spec));
  assert.throws(()=>applyNodeInsert(created,preview,createdPred,"ensure-pdu-session"));
  assert.throws(()=>previewNodeInsert(created,root.name,route.id,
    {...spec,value:"unregistered.predicate"},createdPred,"establish-pdu-session"));
});
test("rejects duplicate IDs, bad Outcomes, bad terminal statuses, stale and forged previews",()=>{
  const route=ensureProc.routes.find(r=>r.patchable);
  const spec={nodeId:"new-leaf",operator:"terminal",value:"FAILED",outcome:""};
  assert.throws(()=>previewNodeInsert(ensure,ensureProc.name,route.id,
    {...spec,nodeId:ensureProc.start}));
  assert.throws(()=>previewNodeInsert(ensure,ensureProc.name,route.id,
    {...spec,value:"NOT_A_TERMINAL_STATUS"}));
  assert.throws(()=>previewNodeInsert(ensure,ensureProc.name,route.id,
    {...spec,outcome:"PASS"}));
  assert.throws(()=>previewNodeInsert(ensure,ensureProc.name,route.id,
    {nodeId:"wrong",operator:"call",value:"sbi.test",outcome:"bad outcome"}));
  const p=previewNodeInsert(ensure,ensureProc.name,route.id,spec);
  assert.throws(()=>applyNodeInsert(ensure+"\n",p));
  assert.throws(()=>applyNodeInsert(ensure,{...p,diff:"forged"}));
  assert.throws(()=>applyNodeInsert(ensure,{...p,sourceSpans:[]}));
  assert.throws(()=>applyNodeInsert(ensure,{...p,oldTarget:"forged"}));
});
test("quoted Route source is never rewritten; no partial insert",()=>{
  const route=ensureProc.routes.find(r=>r.source==="observe-target-session"&&r.outcome==="FAIL");
  const quoted=ensure.replace("FAIL: observe-session-absence",
    "FAIL: 'observe-session-absence'");
  assert.equal(projectWorkspace(quoted).state,"READY");
  assert.equal(insertNodeOptions(quoted,ensureProc.name,route.id),null);
  assert.throws(()=>previewNodeInsert(quoted,ensureProc.name,route.id,{
    nodeId:"new-node",operator:"terminal",value:"FAILED",outcome:""}));
});
