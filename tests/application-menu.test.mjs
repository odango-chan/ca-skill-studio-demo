import {readFileSync} from "node:fs";
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
  assert.equal(STUDIO_COMMAND_TARGETS["file.loadSample"],"establishSampleButton");
  assert.equal(STUDIO_COMMAND_TARGETS["file.exportPackage"],"exportPackageButton");
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

test("CSS-concealed action bridge retains real command eligibility",()=>{
  // A transport button is not [hidden] or disabled; only its visible duplicate
  // is removed from Explorer. The menu remains the accessible entry.
  const sample=target();
  const zip=target();
  const map=new Map([
    ["establishSampleButton",sample],
    ["exportPackageButton",zip]
  ]);
  assert.equal(studioCommandTarget(root(map),"file.loadSample"),sample);
  assert.equal(studioCommandTarget(root(map),"file.exportPackage"),zip);
  zip.hidden=true;
  assert.equal(studioCommandTarget(root(map),"file.exportPackage"),null);
});

test("Top-level File/Edit/View/Help menus share one dispatcher and real commands",()=>{
  const html=readFileSync(new URL("../site/index.html",import.meta.url),"utf8");
  const js=readFileSync(new URL("../site/application-menu.mjs",import.meta.url),"utf8");
  for(const name of ["file","edit","view","help"])
    assert.match(html,new RegExp('data-app-menu="'+name+'"'));
  assert.match(html,/id="applicationMenu" class="application-menubar"/);
  assert.equal((html.match(/class="application-menu" data-app-menu="/g)||[]).length,4);
  assert.match(js,/closeMenus\(menu\)/);
  assert.match(js,/event\.key==="Escape"/);
  assert.match(js,/event\.key==="ArrowRight"/);
  assert.doesNotMatch(html,/class="application-menu-trigger">菜单/);
});
