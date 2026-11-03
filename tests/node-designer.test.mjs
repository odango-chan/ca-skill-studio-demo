import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {projectWorkspace} from "../site/workspace.mjs";
import {nodeRenameAvailable,previewNodeRename,applyNodeRename} from "../site/node-designer.mjs";
const read=skill=>readFileSync(new URL(
  "../site/samples/packages/"+skill+"/assurance/procedure.yaml",import.meta.url),"utf8");
const ensure=read("ensure-pdu-session");
const created=read("establish-pdu-session");

test("D2 generic rename updates start and preserves unrelated text",()=>{
  const before=projectWorkspace(ensure);
  assert.equal(before.state,"READY");
  const preview=previewNodeRename(ensure,"ensure-session",
    "observe-target-session","observe-target-session-v2");
  const next=applyNodeRename(ensure,preview);
  assert.match(next,/start: observe-target-session-v2/);
  assert.match(next,/      observe-target-session-v2:/);
  assert.equal(projectWorkspace(next).state,"READY");
  assert.equal(projectWorkspace(next).procedure.start,"observe-target-session-v2");
  assert.equal(next,preview.candidateSource);
  assert.match(preview.diff,/start: observe-target-session-v2/);
  assert.equal(ensure,read("ensure-pdu-session"));
});
test("D2 rename changes inbound and outgoing Route IDs plus with.from output refs",()=>{
  const preview=previewNodeRename(ensure,"ensure-session",
    "create-session","create-session-v2");
  const next=applyNodeRename(ensure,preview);
  const projection=projectWorkspace(next);
  assert.equal(projection.state,"READY");
  const p=projection.procedure;
  assert.ok(p.nodes.some(n=>n.id==="create-session-v2"));
  assert.ok(p.routes.some(r=>r.target==="create-session-v2"));
  assert.ok(p.routes.some(r=>r.source==="create-session-v2" &&
    r.id.startsWith("create-session-v2:")));
  assert.match(next,/from: create-session-v2\.output\.c6BackendOperationRef/);
  assert.doesNotMatch(next,/from: create-session\.output\./);
  assert.match(next,/retry-create-session:/);
});
test("D2 CreatedSession rename uses current procedure, not a pinned profile",()=>{
  const before=projectWorkspace(created);
  assert.equal(before.state,"READY");
  const procId=before.entry;
  const preview=previewNodeRename(created,procId,
    "nudm-sdm-get","nudm-sdm-get-v2");
  const next=applyNodeRename(created,preview);
  const after=projectWorkspace(next);
  assert.equal(after.state,"READY");
  assert.equal(after.procedures.size,6);
  assert.equal(after.procedures.get(procId).start,"nudm-sdm-get-v2");
  assert.ok(after.procedures.get(procId).routes.some(r=>r.source==="nudm-sdm-get-v2"));
  assert.match(next,/from: nudm-sdm-get-v2\.output/);
  for(const [name,proc] of before.procedures){
    if(name===procId)continue;
    assert.deepEqual(after.procedures.get(name).nodes.map(n=>n.id),
      proc.nodes.map(n=>n.id));
  }
});
test("D2 rejects collisions, quoted spans, forged preview and stale Source",()=>{
  assert.ok(nodeRenameAvailable(ensure,"ensure-session","create-session"));
  assert.throws(()=>previewNodeRename(ensure,"ensure-session","create-session","failed"));
  assert.throws(()=>previewNodeRename(ensure,"ensure-session","create-session","create-session"));
  assert.throws(()=>previewNodeRename(ensure,"ensure-session","create-session","not allowed"));
  const quoted=ensure.replace("      create-session:","      'create-session':");
  assert.equal(projectWorkspace(quoted).state,"READY");
  assert.equal(nodeRenameAvailable(quoted,"ensure-session","create-session"),false);
  assert.throws(()=>previewNodeRename(quoted,"ensure-session","create-session","other-node"));
  const preview=previewNodeRename(ensure,"ensure-session","create-session","new-create");
  assert.throws(()=>applyNodeRename(ensure+"\n",preview));
  assert.throws(()=>applyNodeRename(ensure,{...preview,newId:"forged"}));
  assert.throws(()=>applyNodeRename(ensure,{...preview,diff:"forged"}));
  assert.throws(()=>applyNodeRename(ensure,{...preview,sourceSpans:[]}));
});
test("D2 fails closed for quoted references, preserving original bytes",()=>{
  const changed=ensure.replace(
    "from: create-session.output.c6BackendOperationRef",
    "from: 'create-session.output.c6BackendOperationRef'");
  assert.equal(projectWorkspace(changed).state,"READY");
  assert.equal(nodeRenameAvailable(changed,"ensure-session","create-session"),false);
  assert.throws(()=>previewNodeRename(changed,"ensure-session","create-session","new-create"));
});
