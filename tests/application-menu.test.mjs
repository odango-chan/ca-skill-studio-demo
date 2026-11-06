import test from "node:test";
import assert from "node:assert/strict";
import {STUDIO_COMMAND_TARGETS,studioCommandTarget} from "../site/application-menu.mjs";

const root=map=>({getElementById:id=>map.get(id)||null});
const target=options=>({
  disabled:false,hidden:false,
  closest:()=>null,
  ...options
});

test("Shared app menu exposes only implemented editor actions",()=>{
  const commands=Object.keys(STUDIO_COMMAND_TARGETS);
  assert.ok(commands.includes("file.openDirectory"));
  assert.ok(commands.includes("edit.undo"));
  assert.ok(commands.includes("view.visual"));
  assert.equal(new Set(Object.values(STUDIO_COMMAND_TARGETS)).size,commands.length);
  assert.ok(!commands.some(id=>id.startsWith("run.")||id.startsWith("debug.")));
});

test("Menu must respect real command state and cannot bypass hidden/disabled actions",()=>{
  const enabled=target();
  const disabled=target({disabled:true});
  const hidden=target({hidden:true});
  const parentHidden=target({closest:selector=>selector==="[hidden]"?{}:null});
  const name=STUDIO_COMMAND_TARGETS["file.saveDirectory"];
  assert.equal(studioCommandTarget(root(new Map([[name,enabled]])),"file.saveDirectory"),enabled);
  assert.equal(studioCommandTarget(root(new Map([[name,disabled]])),"file.saveDirectory"),null);
  assert.equal(studioCommandTarget(root(new Map([[name,hidden]])),"file.saveDirectory"),null);
  assert.equal(studioCommandTarget(root(new Map([[name,parentHidden]])),"file.saveDirectory"),null);
  assert.equal(studioCommandTarget(root(new Map()),"file.saveDirectory"),null);
  assert.equal(studioCommandTarget(root(new Map()),"run.start"),null);
});
