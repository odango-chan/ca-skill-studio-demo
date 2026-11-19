import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {projectWorkspace} from "../../../site/workspace.mjs";
import {routeTargetChoices,previewTargetPatch} from "../vscode/src/route-target.mjs";
import {validateRouteProposal,isProcedurePath} from "../vscode/src/bridge.mjs";

const source=readFileSync(
  "site/samples/v1alpha5/establish-pdu-session/assurance/procedure.yaml","utf8");
const model=projectWorkspace(source);

test("Host identifies only the current assurance/procedure.yaml entry point",()=>{
  assert.ok(isProcedurePath("/skill/assurance/procedure.yaml"));
  assert.ok(isProcedurePath("assurance/procedure.yaml"));
  assert.ok(!isProcedurePath("assurance/contract.yaml"));
  assert.ok(!isProcedurePath("procedure.yaml"));
  assert.ok(!isProcedurePath("assurance/procedure.yaml.bak"));
});

test("current CA-SL Example graph is projected from the latest source grammar",()=>{
  assert.equal(model.state,"READY");
  assert.equal(model.procedures.size,1);
  assert.equal(model.procedure.nodes.length,10);
  assert.ok(model.procedure.routes.length>0);
  assert.equal(model.procedure.entry,model.procedure.name);
});

test("current Stage routes remain read-only until a current-grammar patch contract exists",()=>{
  const route=model.procedure.routes[0];
  assert.ok(route);
  assert.deepEqual(routeTargetChoices(model.procedure,route.id),[]);
  assert.throws(()=>previewTargetPatch(source,model.procedure.name,route.id,"FAILED"),
    /source-qualified|candidate/i);
  assert.throws(()=>validateRouteProposal(source,17,{
    type:"applyRoute",expectedVersion:17,baseSource:source,
    candidateSource:source,procedureId:model.procedure.name,
    routeId:route.id,newTarget:"FAILED"
  }));
});

test("historical procedures/call syntax is ordinary invalid source, never a fallback profile",()=>{
  const historical=projectWorkspace(
    "procedures:\n  legacy:\n    nodes:\n      step:\n        call: ca.sample.read\n");
  assert.equal(historical.state,"UNAVAILABLE");
  assert.ok(historical.diagnostics.some(item=>item.code==="UNKNOWN_FIELD"));
  assert.ok(historical.diagnostics.some(item=>item.code==="SOURCE_ROOT_INVALID"));
});
