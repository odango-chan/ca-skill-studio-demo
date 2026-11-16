import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {projectWorkspace} from "../site/workspace.mjs";
import {projectPathFocus,branchCategory} from "../site/path-focus.mjs";
import {selectGraphScope,layoutProcedureELK} from "../site/layout.mjs";
import {makeFlowElements} from "../site/react-flow-projection.mjs";

const source=readFileSync(new URL(
  "../site/samples/packages/establish-pdu-session/assurance/procedure.yaml",
  import.meta.url),"utf8");
const workspace=projectWorkspace(source);
assert.equal(workspace.state,"READY");
const root=workspace.procedure;
const snapshot=JSON.stringify(root);
const names=scope=>new Set(scope.nodes.map(n=>n.id));
const ids=scope=>new Set(scope.routes.map(r=>r.id));
const connected=scope=>{
  const present=names(scope);
  assert.ok(scope.routes.every(r=>present.has(r.source)&&present.has(r.target)));
  assert.equal(ids(scope).size,scope.routes.length);
};

test("Root defaults to a proven success backbone, preserving source Route identities",()=>{
  const focus=projectPathFocus(root);
  assert.equal(root.nodes.length,17);
  assert.equal(root.routes.length,63);
  assert.ok(focus.isFiltered);
  assert.ok(focus.nodes.length<root.nodes.length);
  assert.ok(focus.routes.length<root.routes.length);
  assert.ok(names(focus).has(root.start));
  assert.ok(names(focus).has("done"));
  assert.ok(!names(focus).has("failed"));
  assert.ok(!names(focus).has("safe-stopped"));
  assert.ok(focus.routes.every(r=>["PASS","SUCCEEDED","SUCCESS","COMMITTED"].includes(r.outcome)));
  assert.ok((focus.hiddenByNode.get(root.start)??0)>0);
  for(const route of focus.routes)
    assert.equal(root.routes.find(r=>r.id===route.id),route);
  connected(focus);
  assert.equal(JSON.stringify(root),snapshot);
});

test("custom categories reveal explicit failure, uncertainty and reconcile detours",()=>{
  const failure=projectPathFocus(root,{mode:"custom",categories:["failure"]});
  const uncertain=projectPathFocus(root,{mode:"custom",categories:["uncertain"]});
  const recovery=projectPathFocus(root,{mode:"custom",categories:["recovery"]});
  assert.ok(names(failure).has("failed"));
  assert.ok(names(uncertain).has("unresolved"));
  assert.ok(names(recovery).has("reconcile-nudm-sdm-subscribe"));
  for(const scope of [failure,uncertain,recovery])connected(scope);
  const baseline=ids(projectPathFocus(root));
  for(const scope of [failure,uncertain,recovery])
    assert.ok([...baseline].every(id=>ids(scope).has(id)));
  assert.ok(failure.routes.length>baseline.size);
  assert.ok(recovery.routes.some(r=>r.outcome==="COMMITTED"&&r.source.startsWith("reconcile-")));
  assert.equal(JSON.stringify(root),snapshot);
});

test("per-node expansion reveals only that node's detours and their downstream completion",()=>{
  const base=projectPathFocus(root);
  const expanded=projectPathFocus(root,{mode:"custom",expandedNodes:[root.start]});
  assert.ok(names(expanded).has("failed"));
  assert.ok(names(expanded).has("unresolved"));
  assert.ok(expanded.routes.length>base.routes.length);
  assert.equal(expanded.hiddenByNode.get(root.start),undefined);
  assert.equal(expanded.expandedNodeIds.has(root.start),true);
  assert.ok(expanded.hiddenByNode.size>0);
  // A second click removes this node from expandedNodes, returning exactly
  // to the previous happy-path projection without modifying Source.
  const collapsed=projectPathFocus(root,{mode:"custom",expandedNodes:[]});
  assert.equal(collapsed.expandedNodeIds.has(root.start),false);
  assert.deepEqual([...ids(collapsed)].sort(),[...ids(base)].sort());
  assert.equal(collapsed.hiddenByNode.get(root.start),base.hiddenByNode.get(root.start));
  // Category filters remain active after the per-node manual expansion closes.
  const withFilter=projectPathFocus(root,{mode:"custom",
    categories:["failure"],expandedNodes:[root.start]});
  const withoutManual=projectPathFocus(root,{mode:"custom",
    categories:["failure"],expandedNodes:[]});
  assert.equal(withFilter.expandedNodeIds.has(root.start),true);
  assert.equal(withoutManual.expandedNodeIds.has(root.start),false);
  assert.ok([...ids(withoutManual)].every(id=>ids(withFilter).has(id)));
  assert.ok(names(withoutManual).has("failed"));
  connected(expanded);
  connected(collapsed);
  connected(withoutManual);
  assert.equal(JSON.stringify(root),snapshot);
});

test("full scope and neighbor override remain independent",()=>{
  const full=projectPathFocus(root,{mode:"all"});
  assert.strictEqual(full.nodes,root.nodes);
  assert.strictEqual(full.routes,root.routes);
  assert.equal(full.isFiltered,false);
  const filtered=selectGraphScope(root,null,false,{mode:"normal"});
  assert.ok(filtered.isFiltered);
  const neighbor=selectGraphScope(root,root.start,true,{mode:"normal"});
  assert.ok(neighbor.nodes.length<root.nodes.length);
  assert.ok(neighbor.routes.some(r=>r.outcome==="FAILED"));
  assert.ok(neighbor.nodes.some(n=>n.id==="failed"));
  assert.equal(neighbor.hiddenByNode,undefined);
  connected(neighbor);
});

test("unrecognized outcome and missing success proof fall back to full graph",()=>{
  const unknown={...root,routes:[...root.routes.slice(0,1),{
    ...root.routes[1],id:"unknown:scenario",outcome:"SURPRISE"
  },...root.routes.slice(2)]};
  const n=projectPathFocus(unknown);
  assert.equal(n.isFiltered,false);
  assert.equal(n.nodes,unknown.nodes);
  assert.match(n.reason,/无法可靠分类/);
  const noSuccess={...root,nodes:root.nodes.map(node=>node.operator==="terminal"&&
    node.value==="SUCCEEDED"?{...node,value:"UNRESOLVED"}:node)};
  const result=projectPathFocus(noSuccess);
  assert.equal(result.isFiltered,false);
  assert.match(result.reason,/成功终态/);
  const noProof={...root,routes:root.routes.filter(r=>r.outcome!=="PASS"&&r.outcome!=="SUCCEEDED")};
  const hidden=projectPathFocus(noProof);
  assert.equal(hidden.isFiltered,false);
  assert.match(hidden.reason,/无法证明/);
});

test("all parallel success routes and joins survive even in cyclic graphs",()=>{
  const p={
    start:"a",
    nodes:[
      {id:"a",operator:"call",value:"a"},
      {id:"b",operator:"call",value:"b"},
      {id:"c",operator:"call",value:"c"},
      {id:"d",operator:"terminal",value:"SUCCEEDED"},
      {id:"bad",operator:"terminal",value:"FAILED"}
    ],
    routes:[
      {id:"a:b",source:"a",target:"b",outcome:"PASS",routeSource:"operator.on"},
      {id:"a:c",source:"a",target:"c",outcome:"SUCCEEDED",routeSource:"operator.on"},
      {id:"b:d",source:"b",target:"d",outcome:"PASS",routeSource:"operator.on"},
      {id:"c:d",source:"c",target:"d",outcome:"SUCCESS",routeSource:"operator.on"},
      {id:"b:c",source:"b",target:"c",outcome:"PASS",routeSource:"operator.on"},
      {id:"c:b",source:"c",target:"b",outcome:"PASS",routeSource:"operator.on"},
      {id:"a:bad",source:"a",target:"bad",outcome:"FAIL",routeSource:"operator.on"}
    ]
  };
  const focus=projectPathFocus(p);
  assert.equal(focus.routes.length,6);
  assert.ok(focus.routes.some(r=>r.id==="a:b"));
  assert.ok(focus.routes.some(r=>r.id==="a:c"));
  assert.ok(!focus.routes.some(r=>r.id==="a:bad"));
  connected(focus);
  assert.equal(projectPathFocus(p,{mode:"custom",categories:["failure"]}).routes.length,7);
});

test("branch categorization uses explicit source operator and outcome, never node names",()=>{
  const byId=new Map(root.nodes.map(n=>[n.id,n]));
  const recover=root.routes.find(r=>r.target==="reconcile-nudm-sdm-subscribe");
  assert.equal(branchCategory(recover,byId),"recovery");
  assert.equal(branchCategory({source:"a",target:"b",outcome:"FAILED"},new Map()),"failure");
  assert.equal(branchCategory({source:"a",target:"b",outcome:"UNKNOWN"},new Map()),"uncertain");
  assert.equal(branchCategory({source:"a",target:"b",outcome:"COMMITTED"},new Map()),"other");
});

test("ELK and React Flow remain exact on the focused subset",async()=>{
  const focused=projectPathFocus(root);
  const graph=await layoutProcedureELK(root,{pathFocus:{mode:"normal"}});
  assert.equal(graph.visibleRoutes.length,focused.routes.length);
  assert.equal(graph.positions.size,focused.nodes.length);
  assert.equal(graph.hiddenByNode.get(root.start),focused.hiddenByNode.get(root.start));
  const flow=makeFlowElements(graph,root);
  assert.equal(flow.nodes.length,focused.nodes.length);
  assert.equal(flow.edges.reduce((n,e)=>n+e.data.bundle.routes.length,0),focused.routes.length);
  assert.equal(flow.nodes.find(n=>n.id===root.start).data.hiddenBranchCount,
    focused.hiddenByNode.get(root.start));
  const expanded=await layoutProcedureELK(root,{pathFocus:{mode:"custom",
    expandedNodes:[root.start]}});
  const start=makeFlowElements(expanded,root).nodes.find(n=>n.id===root.start);
  assert.equal(start.data.hiddenBranchCount,0);
  assert.equal(start.data.branchesExpanded,true,
    "Collapse button must persist even when every outgoing Route is visible");
  assert.ok(flow.edges.every(e=>e.markerEnd.type==="arrow"));
  assert.equal(JSON.stringify(root),snapshot);
});
