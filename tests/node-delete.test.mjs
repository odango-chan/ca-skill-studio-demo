import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {projectWorkspace} from "../site/workspace.mjs";
import {previewNodeInsert,applyNodeInsert} from "../site/node-create.mjs";
import {deleteNodeOptions,previewNodeDelete,applyNodeDelete} from "../site/node-delete.mjs";

const read=skill=>readFileSync(new URL(
  "../site/samples/packages/"+skill+"/assurance/procedure.yaml",
  import.meta.url),"utf8");
const ensure=read("ensure-pdu-session");
const created=read("establish-pdu-session");
const ensureModel=projectWorkspace(ensure);

test("A3 merge a FAILED terminal, repairing every incoming Route",()=>{
  const p=ensureModel.procedure;
  const options=deleteNodeOptions(ensure,p.name,"strategy-conflict");
  assert.deepEqual(options.targets,["failed"]);
  assert.equal(options.mode,"merge-terminal");
  const preview=previewNodeDelete(ensure,p.name,"strategy-conflict","failed");
  const next=applyNodeDelete(ensure,preview);
  const after=projectWorkspace(next).procedure;
  assert.equal(after.nodes.length,p.nodes.length-1);
  assert.equal(after.routes.length,p.routes.length);
  assert.equal(after.start,p.start);
  assert.ok(!after.nodes.some(n=>n.id==="strategy-conflict"));
  assert.equal(after.routes.find(r=>r.id==="observe-session-absence:FAIL").target,"failed");
  assert.equal(after.nodes.find(n=>n.id==="failed").value,"FAILED");
  assert.match(preview.diff,/-      strategy-conflict:/);
  assert.equal(ensure,read("ensure-pdu-session"));
});
test("A3 bypass an inserted single-outcome call, round-tripping both YAML and graph",()=>{
  const p=ensureModel.procedure;
  const route=p.routes.find(r=>r.source==="observe-target-session"&&r.outcome==="FAIL");
  const inserted=applyNodeInsert(ensure,previewNodeInsert(ensure,p.name,route.id,{
    nodeId:"d2-ephemeral-node",operator:"call",value:"sbi.demo.read",
    outcome:"COMMITTED"
  }));
  const choices=deleteNodeOptions(inserted,p.name,"d2-ephemeral-node");
  assert.deepEqual(choices.targets,[route.target]);
  assert.equal(choices.mode,"bypass-single-outcome");
  const preview=previewNodeDelete(inserted,p.name,"d2-ephemeral-node",route.target);
  const deleted=applyNodeDelete(inserted,preview);
  assert.deepEqual(projectWorkspace(deleted).procedure.nodes.map(n=>n.id),
    p.nodes.map(n=>n.id));
  assert.deepEqual(projectWorkspace(deleted).procedure.routes.map(r=>[r.id,r.target]),
    p.routes.map(r=>[r.id,r.target]));
  assert.equal(deleted,ensure);
});
test("A3 works on a CreatedSession multi-Procedure after one A2 terminal insert",()=>{
  const m=projectWorkspace(created),root=m.procedure;
  const route=root.routes.find(r=>r.target==="failed"&&r.patchable);
  assert.ok(route);
  const inserted=applyNodeInsert(created,previewNodeInsert(created,root.name,route.id,{
    nodeId:"d2-created-terminal",operator:"terminal",value:"FAILED",outcome:""
  }));
  const choices=deleteNodeOptions(inserted,root.name,"d2-created-terminal");
  assert.deepEqual(choices.targets,["failed"]);
  const deleted=applyNodeDelete(inserted,previewNodeDelete(inserted,root.name,
    "d2-created-terminal","failed"));
  assert.equal(projectWorkspace(deleted).state,"READY");
  assert.equal(projectWorkspace(deleted).procedures.size,6);
  assert.equal(deleted,created);
});
test("A3 blocks start, incompatible terminals, multi-outcome calls and wrong redirect",()=>{
  const p=ensureModel.procedure;
  assert.equal(deleteNodeOptions(ensure,p.name,p.start),null);
  assert.equal(deleteNodeOptions(ensure,p.name,"done"),null);
  assert.equal(deleteNodeOptions(ensure,p.name,"create-session"),null);
  assert.equal(deleteNodeOptions(ensure,p.name,"not-a-node"),null);
  assert.throws(()=>previewNodeDelete(ensure,p.name,p.start,"failed"));
  assert.throws(()=>previewNodeDelete(ensure,p.name,"strategy-conflict","done"));
  assert.throws(()=>previewNodeDelete(ensure,p.name,"strategy-conflict","not-a-node"));
});
test("A3 refuses external Node output references and quoted incoming Routes",()=>{
  const p=ensureModel.procedure;
  const route=p.routes.find(r=>r.source==="observe-target-session"&&r.outcome==="FAIL");
  const inserted=applyNodeInsert(ensure,previewNodeInsert(ensure,p.name,route.id,{
    nodeId:"d2-referenced-call",operator:"call",value:"sbi.demo.read",
    outcome:"COMMITTED"
  }));
  const withRef=inserted.replace(
    "          retryOfBackendOperationRef:\n            from: reconcile-create.output.controlledRetryBackendOperationRef",
    "          retryOfBackendOperationRef:\n            from: d2-referenced-call.output.controlledRetryBackendOperationRef");
  assert.equal(projectWorkspace(withRef).state,"READY");
  assert.equal(deleteNodeOptions(withRef,p.name,"d2-referenced-call"),null);
  assert.throws(()=>previewNodeDelete(withRef,p.name,"d2-referenced-call",route.target));
  const quoted=ensure.replace("FAIL: strategy-conflict","FAIL: 'strategy-conflict'");
  assert.equal(projectWorkspace(quoted).state,"READY");
  assert.equal(deleteNodeOptions(quoted,p.name,"strategy-conflict"),null);
  assert.throws(()=>previewNodeDelete(quoted,p.name,"strategy-conflict","failed"));
});
test("A3 rejects tampered, stale, missing and spoofed previews",()=>{
  const p=ensureModel.procedure;
  const preview=previewNodeDelete(ensure,p.name,"strategy-conflict","failed");
  assert.throws(()=>applyNodeDelete(ensure+"\n",preview));
  assert.throws(()=>applyNodeDelete(ensure,{...preview,redirectTarget:"done"}));
  assert.throws(()=>applyNodeDelete(ensure,{...preview,diff:"forged"}));
  assert.throws(()=>applyNodeDelete(ensure,{...preview,sourceSpans:[]}));
  assert.throws(()=>applyNodeDelete(ensure,{...preview,extra:true}));
  assert.throws(()=>applyNodeDelete(ensure,null));
});
