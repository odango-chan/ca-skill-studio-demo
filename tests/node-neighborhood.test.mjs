import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {projectWorkspace} from "../site/workspace.mjs";
import {nodeJourney,nodeNeighborhood} from "../site/workbench.mjs";

const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");
const owner=projectWorkspace(read("../site/samples/packages/establish-pdu-session/assurance/procedure.yaml"));
assert.equal(owner.state,"READY");
const root=owner.procedure;

test("A3 every Root Node has an exact one-hop incoming / outgoing Route projection",()=>{
  assert.equal(root.nodes.length,17);
  const original=JSON.stringify(root);
  let incomingTotal=0,outgoingTotal=0;
  for(const node of root.nodes){
    const projected=nodeNeighborhood(root,node.id);
    const internal=nodeJourney(root,node.id);
    assert.equal(projected.node,node);
    assert.equal(internal.node,node);
    const incoming=projected.previous.peers.flatMap(x=>x.routes);
    const outgoing=projected.next.peers.flatMap(x=>x.routes);
    assert.equal(incoming.length,projected.previous.routeCount);
    assert.equal(outgoing.length,projected.next.routeCount);
    assert.deepEqual(incoming.map(x=>x.id),
      root.routes.filter(x=>x.target===node.id).map(x=>x.id));
    assert.deepEqual(outgoing.map(x=>x.id),
      root.routes.filter(x=>x.source===node.id).map(x=>x.id));
    for(const peer of projected.previous.peers){
      assert.ok(root.nodes.includes(peer.node));
      assert.ok(peer.routes.every(route=>route.source===peer.node.id&&
        route.target===node.id));
    }
    for(const peer of projected.next.peers){
      assert.ok(root.nodes.includes(peer.node));
      assert.ok(peer.routes.every(route=>route.source===node.id&&
        route.target===peer.node.id));
    }
    incomingTotal+=incoming.length;
    outgoingTotal+=outgoing.length;
  }
  assert.equal(incomingTotal,root.routes.length);
  assert.equal(outgoingTotal,root.routes.length);
  assert.equal(JSON.stringify(root),original);
});

test("A3 multi-outcome same-peer, Phase source, cycle and terminal are not hidden",()=>{
  const nodes=["a","b","c"].map(id=>({id,operator:id==="c"?"terminal":"call",value:id}));
  const routes=[
    {id:"a:PASS",source:"a",target:"b",outcome:"PASS",routeSource:"operator.on",line:1},
    {id:"a:preconditions:FAILED",source:"a",target:"b",outcome:"FAILED",routeSource:"preconditions.on",line:2},
    {id:"b:RETRY",source:"b",target:"b",outcome:"RETRY",routeSource:"operator.on",line:3},
    {id:"b:postconditions:UNKNOWN",source:"b",target:"c",outcome:"UNKNOWN",routeSource:"postconditions.on",line:4}
  ];
  const p={start:"a",nodes,routes};
  const b=nodeNeighborhood(p,"b");
  assert.deepEqual(b.previous.peers.map(x=>x.node.id),["a","b"]);
  assert.deepEqual(b.next.peers.map(x=>x.node.id),["b","c"]);
  assert.deepEqual(b.previous.peers[0].routes.map(x=>x.id),[
    "a:PASS","a:preconditions:FAILED"
  ]);
  assert.deepEqual(b.next.peers[1].routes.map(x=>x.id),["b:postconditions:UNKNOWN"]);
  assert.equal(b.previous.routeCount,3);
  assert.equal(b.next.routeCount,2);
  const a=nodeNeighborhood(p,"a");
  const c=nodeNeighborhood(p,"c");
  assert.equal(a.previous.routeCount,0);
  assert.equal(c.next.routeCount,0);
  assert.equal(nodeNeighborhood(p,"none"),null);
  assert.equal(nodeNeighborhood(null,"a"),null);
  assert.deepEqual(routes.map(r=>r.routeSource),[
    "operator.on","preconditions.on","operator.on","postconditions.on"
  ]);
});

test("A3 one-hop UI exposes all lanes, original Route identity and click-to-pivot",()=>{
  const html=read("../site/index.html");
  const css=read("../site/light.css");
  const app=read("../site/app.mjs");
  for(const id of ["nodeFocusPrevious","nodeFocusStages","nodeFocusNext"])
    assert.ok(html.includes('id="'+id+'"'),id);
  assert.match(app,/nodeNeighborhood\(lastGood,nodeFocusId\)/);
  assert.match(app,/renderNeighbors\("nodeFocusPrevious",neighborhood.previous,"previous"\)/);
  assert.match(app,/renderNeighbors\("nodeFocusNext",neighborhood.next,"next"\)/);
  assert.match(app,/chip\.dataset\.routeId=route\.id/);
  assert.match(app,/chip\.dataset\.routeSource=route\.routeSource/);
  assert.match(app,/\(\)=>openNodeFocus\(peer\.node\.id\)/);
  assert.match(css,/\.node-focus-neighborhood\{/);
  assert.match(css,/@media\(max-width:990px\)/);
  assert.match(css,/\.node-focus-neighbor-empty\{/);
});
