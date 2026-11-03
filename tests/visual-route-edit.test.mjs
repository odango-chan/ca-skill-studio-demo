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
  new URL("../site/samples/packages/"+skill+"/"+path,import.meta.url),"utf8");
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
test("on-canvas drag is preview-only, uses hit-tested Node IDs and preserves the existing apply gate",()=>{
  const app=readFileSync(new URL("../site/app.mjs",import.meta.url),"utf8");
  assert.match(app,/class:"route-rewire-handle"/);
  assert.match(app,/"data-node-id":node\.id/);
  assert.match(app,/document\.elementFromPoint\(event\.clientX,event\.clientY\)/);
  assert.match(app,/dropTargetAllowed\(drag\.targets,drag\.oldTarget,target\)/);
  assert.match(app,/showPreview\(previewVisualRouteEdit\(currentRouteEditContext\(drag\.routeId\),target\)\)/);
  assert.match(app,/if\(source\.value!==drag\.revision/);
  assert.match(app,/svg\.setPointerCapture\(event\.pointerId\)/);
  assert.match(app,/svg\.addEventListener\("pointercancel"/);
  assert.match(app,/history\.record\(nextSource\)/);
  assert.doesNotMatch(app,/source\.value\s*=\s*drag\.newTarget/);
});
test("NODES owns the remaining left column, with its own scroll and no fixed 220px cap",()=>{
  const css=readFileSync(new URL("../site/light.css",import.meta.url),"utf8");
  assert.match(css,/Tall NODES explorer/);
  assert.match(css,/\.workbench \.explorer \.explorer-nodes\[open\]\s*\{[^}]*flex:1 1 0/s);
  assert.match(css,/\.workbench \.explorer \.explorer-nodes\[open\] \.outline\s*\{[^}]*max-height:none/s);
  assert.match(css,/overscroll-behavior:contain/);
  assert.match(css,/@media\(max-width:980px\)/);
  assert.match(css,/\.route-reroute-ghost/);
});
