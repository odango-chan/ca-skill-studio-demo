import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {projectWorkspace} from "../site/workspace.mjs";
import {applyRouteTargetPatch} from "../site/patch.mjs";
import {applyCreatedRoutePatch} from "../site/extended-attributes.mjs";
import {
  visualRouteTargets,previewVisualRouteEdit,dropTargetAllowed
} from "../site/visual-route-edit.mjs";

const read=(skill,path)=>readFileSync(
  new URL((skill==="establish-pdu-session"?"./fixtures/establish-pre-hold/":"../site/samples/packages/"+skill+"/")+path,import.meta.url),"utf8");
const ensureSource=read("ensure-pdu-session","assurance/procedure.yaml");
const ensure=projectWorkspace(ensureSource);
const createdSource=read("establish-pdu-session","assurance/procedure.yaml");
const created=projectWorkspace(createdSource);

test("graph edits keep the exact Ensure failure Route eligibility",()=>{
  const route=ensure.procedure.routes.find(r=>r.id==="verify-created-target:FAIL");
  assert.ok(route);
  const ctx={source:ensureSource,procedure:ensure.procedure,
    procedureId:ensure.entry,routeId:route.id,packageName:"ensure-pdu-session"};
  const choices=visualRouteTargets(ctx);
  assert.deepEqual(choices,["strategy-conflict","failed","unresolved","safe-stopped"]);
  assert.ok(choices.includes(route.target));
  const next=choices.find(x=>x!==route.target);
  const preview=previewVisualRouteEdit(ctx,next);
  assert.equal(preview.type,"SetRouteTarget");
  assert.equal(applyRouteTargetPatch(ensureSource,preview),preview.candidateSource);
  assert.throws(()=>previewVisualRouteEdit(ctx,route.target));
  assert.throws(()=>previewVisualRouteEdit(ctx,"done"));
  assert.deepEqual(visualRouteTargets({...ctx,routeId:"create-session:COMMITTED"}),[]);
});
test("qualified CreatedSession Route drag proposes only a single current Procedure target",()=>{
  const proc=created.procedure;
  const route=proc.routes.find(r=>r.patchable);
  assert.ok(route,"Pinned CreatedSession has a qualified Route");
  const ctx={source:createdSource,procedure:proc,procedureId:created.entry,
    routeId:route.id,packageName:"establish-pdu-session"};
  const choices=visualRouteTargets(ctx);
  assert.deepEqual(choices,proc.nodes.map(n=>n.id));
  const next=choices.find(x=>x!==route.target);
  const preview=previewVisualRouteEdit(ctx,next);
  assert.equal(preview.type,"SetCreatedRouteTarget");
  assert.equal(preview.newValue,next);
  assert.equal(applyCreatedRoutePatch(createdSource,preview),preview.candidateSource);
  assert.equal(projectWorkspace(preview.candidateSource).procedure.routes
    .find(r=>r.id===route.id).target,next);
});
test("gesture refuses empty background, original target, or non-member drops",()=>{
  const choices=["failed","unresolved","safe-stopped"];
  assert.equal(dropTargetAllowed(choices,"failed","unresolved"),true);
  assert.equal(dropTargetAllowed(choices,"failed","failed"),false);
  assert.equal(dropTargetAllowed(choices,"failed","done"),false);
  assert.equal(dropTargetAllowed(choices,"failed",null),false);
  assert.equal(dropTargetAllowed(choices,"failed",{}),false);
});
test("graph targets fail closed for unrelated package and unsupported Route",()=>{
  const ctx={source:createdSource,procedure:created.procedure,procedureId:created.entry,
    routeId:"unrecognized-route",packageName:"establish-pdu-session"};
  assert.deepEqual(visualRouteTargets(ctx),[]);
  assert.throws(()=>previewVisualRouteEdit(ctx,"done"));
  assert.deepEqual(visualRouteTargets({...ctx,routeId:created.procedure.routes[0].id,
    packageName:"unknown-skill"}),[]);
});
