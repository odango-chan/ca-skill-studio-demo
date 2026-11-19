import test from "node:test";
import assert from "node:assert/strict";
import {projectWorkspace} from "../site/workspace.mjs";
import {layoutProcedure} from "../site/graph.mjs";
import {selectGraphScope,groupRouteEntries} from "../site/layout.mjs";
import {detailedLayoutAllowed} from "../site/graph-scale.mjs";

function largeYaml(count=300){
  const lines=["start: node-0","nodes:"];
  for(let i=0;i<count;i++){
    lines.push("  node-"+i+":","    operation:",
      "      tool: demo.noop","      arguments: {}","      routes:");
    let outcomes;
    if(i===count-1)outcomes=["SUCCEEDED","FAILED","DENIED"];
    else if(i===count-2)outcomes=["SUCCEEDED","FAILED"];
    else outcomes=["SUCCEEDED","FAILED","DENIED","COMMITTED","NOT_COMMITTED"];
    for(const outcome of outcomes){
      let target;
      if(i<count-2)target="node-"+(i+1);
      else if(i===count-2)target=outcome==="SUCCEEDED"?"node-"+(i+1):"FAILED";
      else target=outcome==="SUCCEEDED"?"UNRESOLVED":
        outcome==="FAILED"?"FAILED":"SAFE_STOPPED";
      lines.push("        "+outcome+": "+target);
    }
  }
  return lines.join("\n")+"\n";
}

test("A5 near-budget 300 Node / 1495 Route projection retains source identity",()=>{
  const p=projectWorkspace(largeYaml());
  assert.equal(p.state,"READY");
  assert.equal(p.procedure.nodes.length,300);
  assert.equal(p.procedure.routes.length,1495);
  const scope=selectGraphScope(p.procedure);
  assert.equal(detailedLayoutAllowed(scope),false);
  const fallback=layoutProcedure(p.procedure,"DOWN");
  assert.equal(fallback.positions.size,300);
  assert.ok(Number.isFinite(fallback.width)&&Number.isFinite(fallback.height));
  assert.equal(groupRouteEntries(scope.routes).reduce((s,x)=>s+x.routes.length,0),1495);
});
test("A5 small neighbor scope still supports detailed layout with all its Routes",()=>{
  const p=projectWorkspace(largeYaml()).procedure;
  const scope=selectGraphScope(p,"node-120",true);
  assert.equal(scope.isFiltered,true);
  assert.deepEqual(scope.nodes.map(n=>n.id),["node-119","node-120","node-121"]);
  assert.equal(scope.routes.length,10);
  assert.equal(detailedLayoutAllowed(scope),true);
  const fallback=layoutProcedure({...p,start:"node-120",nodes:scope.nodes,
    routes:scope.routes},"DOWN");
  assert.equal(fallback.positions.size,3);
  assert.equal(groupRouteEntries(scope.routes).reduce((s,x)=>s+x.routes.length,0),10);
});
test("A5 over-budget file fails closed rather than displaying an incomplete graph",()=>{
  const p=projectWorkspace(largeYaml(302));
  assert.equal(p.state,"UNAVAILABLE");
  assert.ok(p.diagnostics.length);
});
