import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {projectWorkspace} from "../site/workspace.mjs";
import {layoutProcedureELK} from "../site/layout.mjs";
import {layoutProcedure} from "../site/graph.mjs";
import {axisFitViewport} from "../site/fit-axis.mjs";
const sample=name=>readFileSync(new URL("../site/samples/"+
  name+".procedure.yaml",import.meta.url),"utf8");
const ready=name=>{
  const p=projectWorkspace(sample(name));
  assert.equal(p.state,"READY");return p.procedure;
};
const center=(graph,proc)=>{
  const positions=(graph.visibleNodes??proc.nodes).map(n=>graph.positions.get(n.id));
  return {
    x:(Math.min(...positions.map(x=>x.x))+
      Math.max(...positions.map(x=>x.x+238)))/2,
    y:(Math.min(...positions.map(x=>x.y))+
      Math.max(...positions.map(x=>x.y+80)))/2,
    width:Math.max(...positions.map(x=>x.x+238))-
      Math.min(...positions.map(x=>x.x)),
    height:Math.max(...positions.map(x=>x.y+80))-
      Math.min(...positions.map(x=>x.y))
  };
};
for(const name of ["ensure-pdu-session","establish-pdu-session"])
  for(const direction of ["DOWN","RIGHT"])
    test("axis fill is centered on active "+name+" "+direction+" ELK graph",async()=>{
      const procedure=ready(name);
      const graph=await layoutProcedureELK(procedure,{direction});
      const box={width:980,height:620},bounds=center(graph,procedure);
      for(const axis of ["width","height"]){
        const v=axisFitViewport(graph,procedure,box,axis);
        assert.ok(v,axis);
        assert.ok(v.zoom>=0.05&&v.zoom<=2.5);
        assert.ok(Math.abs(v.x+bounds.x*v.zoom-box.width/2)<0.001);
        assert.ok(Math.abs(v.y+bounds.y*v.zoom-box.height/2)<0.001);
        const expected=Math.min(2.5,Math.max(0.05,
          ((axis==="width"?box.width:box.height)-48)/
          (axis==="width"?bounds.width:bounds.height)));
        assert.ok(Math.abs(v.zoom-expected)<0.000001);
      }
    });
test("fits only the active neighbor subset and follows live canvas dimensions",()=>{
  const nodes=[
    {id:"a"},{id:"b"},{id:"far"}
  ];
  const graph={
    visibleNodes:nodes.slice(0,2),
    positions:new Map([
      ["a",{x:10,y:20}],["b",{x:380,y:40}],["far",{x:8000,y:8000}]
    ])
  };
  const proc={nodes};
  const wide=axisFitViewport(graph,proc,{width:1000,height:640},"width");
  const narrow=axisFitViewport(graph,proc,{width:500,height:640},"width");
  assert.ok(wide.zoom>narrow.zoom);
  const bounds=center(graph,proc);
  assert.ok(Math.abs(wide.zoom-(1000-48)/bounds.width)<0.00001);
  assert.ok(Math.abs(narrow.zoom-(500-48)/bounds.width)<0.00001);
});
test("large graph fallback is supported and zoom respects React Flow clamps",()=>{
  const nodes=Array.from({length:150},(_,i)=>({id:"node-"+i}));
  const graph={visibleNodes:nodes,positions:new Map(nodes.map((n,i)=>
    [n.id,{x:20,y:120*i}]))};
  const proc={nodes};
  const h=axisFitViewport(graph,proc,{width:600,height:400},"height");
  const w=axisFitViewport(graph,proc,{width:600,height:400},"width");
  assert.equal(h.zoom,0.05);
  assert.ok(w.zoom>h.zoom);
  const mini={visibleNodes:[{id:"one"}],
    positions:new Map([["one",{x:0,y:0}]])};
  const c=axisFitViewport(mini,{nodes:mini.visibleNodes},
    {width:1600,height:1200},"width");
  assert.equal(c.zoom,2.5);
});
test("invalid, stale, empty, non-finite or tiny viewport inputs fail closed",()=>{
  const proc={nodes:[{id:"one"}]};
  const graph={positions:new Map([["one",{x:0,y:0}]])};
  for(const args of [
    [null,proc,{width:900,height:500},"width"],
    [graph,null,{width:900,height:500},"height"],
    [graph,proc,{width:900,height:500},"all"],
    [graph,proc,{width:0,height:500},"width"],
    [graph,proc,{width:900,height:40},"height"],
    [{positions:new Map()},proc,{width:900,height:500},"width"],
    [{positions:new Map([["one",{x:NaN,y:3}]])},proc,{width:900,height:500},"width"],
    [{positions:new Map()}, {nodes:[]},{width:900,height:500},"height"]
  ])assert.equal(axisFitViewport(...args),null);
});
test("axis fit never mutates the input graph or Source/projection",()=>{
  const proc=ready("ensure-pdu-session");
  const graph=layoutProcedure(proc);
  const old=JSON.stringify([...graph.positions]),source=sample("ensure-pdu-session");
  axisFitViewport(graph,proc,{width:1000,height:600},"width");
  axisFitViewport(graph,proc,{width:1000,height:600},"height");
  assert.equal(JSON.stringify([...graph.positions]),old);
  assert.equal(sample("ensure-pdu-session"),source);
});
