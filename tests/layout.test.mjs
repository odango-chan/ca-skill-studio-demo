import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { projectWorkspace } from "../site/workspace.mjs";
import {
  selectGraphScope, groupRouteEntries, layoutProcedureELK
} from "../site/layout.mjs";

const read = name => readFileSync(
  new URL("../site/samples/" + name + ".procedure.yaml", import.meta.url), "utf8"
);
const ensure = projectWorkspace(read("ensure-pdu-session"));
const establish = projectWorkspace(read("establish-pdu-session"));
assert.equal(ensure.state, "READY");
assert.equal(establish.state, "READY");

function checkCompleteLayout(procedure, graph, visible = procedure.nodes.length) {
  assert.equal(graph.positions.size, visible);
  assert.ok(Number.isFinite(graph.width) && graph.width > 0);
  assert.ok(Number.isFinite(graph.height) && graph.height > 0);
  assert.equal(graph.engine, "ELK layered");
  const positions = [...graph.positions.values()];
  assert.ok(positions.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
  assert.equal(new Set(positions.map(p => p.x + ":" + p.y)).size, positions.length);
  assert.ok(graph.bundles.every(b => b.routes.length && graph.positions.has(b.source) && graph.positions.has(b.target)));
  assert.ok(graph.bundles.every(b => b.label && Number.isFinite(b.label.x) && Number.isFinite(b.label.y)));
  assert.equal(
    graph.bundles.reduce((sum, b) => sum + b.routes.length, 0),
    graph.visibleRoutes.length
  );
}

test("ELK lays out fixed ensure with all 11 nodes and all 24 route entries", async () => {
  const graph = await layoutProcedureELK(ensure.procedure);
  checkCompleteLayout(ensure.procedure, graph, 11);
  assert.equal(graph.visibleRoutes.length, 24);
  assert.equal(graph.direction, "DOWN");
  assert.equal(graph.isFiltered, false);
});

test("ELK handles the CreatedSession 17 node / 65 outcome root without dropping edges", async () => {
  const graph = await layoutProcedureELK(establish.procedure);
  checkCompleteLayout(establish.procedure, graph, 17);
  assert.equal(graph.visibleRoutes.length, 65);
  assert.ok(graph.bundles.some(b => b.path?.startsWith("M")));
  assert.ok(graph.width > 400);
});

test("horizontal and vertical ELK modes preserve node and route identity", async () => {
  const child = establish.procedures.get("finalize-resource-responsibility");
  const horizontal = await layoutProcedureELK(child, {direction:"RIGHT"});
  const vertical = await layoutProcedureELK(child, {direction:"DOWN"});
  checkCompleteLayout(child, horizontal, child.nodes.length);
  checkCompleteLayout(child, vertical, child.nodes.length);
  assert.deepEqual([...horizontal.positions.keys()], [...vertical.positions.keys()]);
  assert.equal(horizontal.visibleRoutes.length, vertical.visibleRoutes.length);
  assert.equal(vertical.direction, "DOWN");
});

test("visual groups keep operator routes distinct from phase routes", () => {
  const routes = establish.procedure.routes.filter(r => r.source === "nudm-sdm-get");
  const bundles = groupRouteEntries(routes);
  assert.equal(routes.length, 6);
  assert.ok(bundles.some(g => g.routeSource === "operator.on"));
  assert.ok(bundles.some(g => g.routeSource === "postconditions.on"));
  for (const route of routes) assert.equal(
    bundles.filter(g => g.routes.some(r => r.id === route.id)).length, 1
  );
  assert.equal(bundles.reduce((sum,g)=>sum+g.routes.length,0),6);
});

test("neighbor view is a temporary graph filter, never a source mutation", async () => {
  const proc = establish.procedure;
  const before = JSON.stringify(proc);
  const scope = selectGraphScope(proc, "nudm-sdm-get", true);
  assert.equal(scope.isFiltered, true);
  assert.ok(scope.nodes.length >= 2 && scope.nodes.length < proc.nodes.length);
  assert.ok(scope.nodes.some(n => n.id === "nudm-sdm-get"));
  const present = new Set(scope.nodes.map(n => n.id));
  assert.ok(scope.routes.every(r => present.has(r.source) && present.has(r.target)));
  const graph = await layoutProcedureELK(proc, {
    focus:"nudm-sdm-get", neighborsOnly:true
  });
  checkCompleteLayout(proc, graph, scope.nodes.length);
  assert.equal(graph.isFiltered, true);
  assert.equal(JSON.stringify(proc), before);
});

test("unselected neighbor view gracefully preserves the full graph", async () => {
  const full = selectGraphScope(ensure.procedure, null, true);
  assert.equal(full.isFiltered, false);
  const graph = await layoutProcedureELK(ensure.procedure, {neighborsOnly:true});
  assert.equal(graph.positions.size, 11);
  assert.equal(graph.isFiltered, false);
});

test("invalid layout inputs are rejected before creating plausible geometry", async () => {
  await assert.rejects(layoutProcedureELK(ensure.procedure, {direction:"SIDEWAYS"}), /Unsupported/);
  const malformed = {
    ...ensure.procedure,
    nodes: ensure.procedure.nodes.slice(1)
  };
  await assert.rejects(layoutProcedureELK(malformed), /Unresolved route/);
});

test("every route bundle still contains original exact route ids and source locations", async () => {
  const graph = await layoutProcedureELK(establish.procedure);
  const lookup = new Map(establish.procedure.routes.map(r=>[r.id,r]));
  for (const group of graph.bundles) {
    for (const route of group.routes) {
      assert.equal(lookup.get(route.id),route);
      assert.equal(route.source,group.source);
      assert.equal(route.target,group.target);
      assert.equal(route.routeSource,group.routeSource);
    }
  }
});

test("vertical is the default across initial UI and ELK, with horizontal still selectable",()=>{
  const app=readFileSync(new URL("../site/app.mjs",import.meta.url),"utf8");
  const html=readFileSync(new URL("../site/index.html",import.meta.url),"utf8");
  const layout=readFileSync(new URL("../site/layout.mjs",import.meta.url),"utf8");
  assert.match(app,/let layoutDirection = "DOWN";/);
  assert.match(app,/layoutProcedure\(proc,direction\)/);
  assert.match(html,/<option value="RIGHT">水平<\/option>/);
  assert.match(html,/<option value="DOWN" selected>垂直<\/option>/);
  assert.match(layout,/direction = "DOWN", focus = null/);
  assert.match(app,/const vertical=graph.direction==="DOWN";/);
});
