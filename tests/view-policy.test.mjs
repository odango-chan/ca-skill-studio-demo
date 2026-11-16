import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {viewKindFor,availableModes,permittedMode,graphControlsAvailable} from "../site/view-policy.mjs";
const file=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
test("Markdown Visual is preview independent of Procedure projection",()=>{
  assert.equal(viewKindFor({path:"SKILL.md",projection:{state:"SOURCE_ONLY"}}),"markdown");
  assert.equal(viewKindFor({path:"README.MD",projection:{state:"UNAVAILABLE"}}),"markdown");
  for(const path of ["references/3gpp-procedure.md","references/session-selection.md",
    "references/failure-handling.md"])
    assert.equal(viewKindFor({path,projection:{state:"SOURCE_ONLY"}}),"markdown");
  assert.equal(viewKindFor({path:"SKILL.md",previewAvailable:false}),"source");
  assert.deepEqual(availableModes("markdown"),["visual","source","split"]);
  assert.equal(permittedMode("markdown","visual"),"visual");
});
test("Procedure Visual exists only for a successful current projection",()=>{
  assert.equal(viewKindFor({path:"assurance/procedure.yaml",projection:{state:"READY"}}),"procedure");
  assert.equal(viewKindFor({path:"assurance/procedure.yaml",projection:{state:"UNAVAILABLE"}}),"source");
  assert.deepEqual(availableModes("procedure"),["visual","source","split"]);
  assert.equal(graphControlsAvailable("procedure"),true);
});
test("Contract, Schema, Predicate and Script are source-only",()=>{
  for(const path of ["assurance/contract.yaml","assurance/predicates.yaml",
    "schemas/selection.schema.yaml","scripts/evaluate_udm_read.py","request.json","unknown.txt"]){
    assert.equal(viewKindFor({path,projection:{state:"SOURCE_ONLY"}}),"source");
  }
  assert.deepEqual(availableModes("source"),["source"]);
  assert.equal(permittedMode("source","visual"),"source");
  assert.equal(permittedMode("source","split"),"source");
  assert.equal(graphControlsAvailable("source"),false);
});
