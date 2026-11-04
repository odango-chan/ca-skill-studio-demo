import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {projectWorkspace} from "../site/workspace.mjs";
import {adjacentVerifyReorderOptions,previewAdjacentVerifyReorder,
  applyAdjacentVerifyReorder} from "../site/phase-step-order.mjs";

const source=readFileSync(new URL("../site/samples/packages/"+
  "establish-pdu-session/assurance/procedure.yaml",import.meta.url),"utf8");
const proc="ue-requested-pdu-session-establishment";
const node="nudm-sdm-subscribe",phase="preconditions",index=3;
const ingress="createdsession.ingress.eligible";
const lifecycle="createdsession.lifecycle.ready";
const first="            - verify: "+ingress+"\n";
const second="            - verify: "+lifecycle+"\n";
const args=(text=source,i=index)=>[text,proc,node,phase,i];

test("D4-A3a real owner SKILL offers only qualifying adjacent single-line Verifies",()=>{
  const options=adjacentVerifyReorderOptions(source,proc,node);
  const row=options.find(x=>x.phaseName===phase&&x.stepIndex===index);
  assert.ok(row);
  assert.equal(row.first,ingress);
  assert.equal(row.second,lifecycle);
  assert.equal(options.some(o=>o.stepIndex===0||o.stepIndex===1||
    o.stepIndex===2),false);
  assert.equal(Object.isFrozen(options),true);
  assert.equal(Object.isFrozen(row),true);
});
test("D4-A3a swaps precisely two complete Source lines and leaves other YAML byte-identical",()=>{
  assert.ok(source.includes(first+second));
  const preview=previewAdjacentVerifyReorder(...args());
  assert.equal(preview.type,"SwapAdjacentPhaseVerifySteps");
  assert.equal(source.slice(preview.sourceSpan.start,preview.sourceSpan.end),
    first+second);
  assert.equal(preview.candidateSource,
    source.replace(first+second,second+first));
  assert.match(preview.diff,/-            - verify: createdsession\.ingress\.eligible/);
  assert.match(preview.diff,/\+            - verify: createdsession\.lifecycle\.ready/);
  const after=applyAdjacentVerifyReorder(source,preview);
  assert.equal(after,preview.candidateSource);
  assert.equal(projectWorkspace(after).state,"READY");
  const beforeView=projectWorkspace(source).procedures.get(proc);
  const afterView=projectWorkspace(after).procedures.get(proc);
  assert.deepEqual(beforeView.routes.map(x=>[x.id,x.outcome,x.target]),
    afterView.routes.map(x=>[x.id,x.outcome,x.target]));
  assert.deepEqual(beforeView.nodes.map(x=>[x.id,x.operator,x.value]),
    afterView.nodes.map(x=>[x.id,x.operator,x.value]));
  const reordered=afterView.nodes.find(x=>x.id===node).phases
    .find(x=>x.name===phase).steps;
  assert.equal(reordered[index].value,lifecycle);
  assert.equal(reordered[index+1].value,ingress);
  const back=previewAdjacentVerifyReorder(...args(after));
  assert.equal(applyAdjacentVerifyReorder(after,back),source);
});
test("D4-A3a rejects named, bound, side-effect, non-adjacent, invalid or repeated Steps",()=>{
  for(const idx of [0,1,2,4,5,-1,79,1.5])
    assert.throws(()=>previewAdjacentVerifyReorder(...args(source,idx)));
  for(const changed of [
    source.replace(first,first.replace("- verify:","- name: named\n              verify:")),
    source.replace(first,first.replace("- verify:","- call:")),
    source.replace(first,first.replace("- verify:","- script:")),
    source.replace(first,"            - verify: "+ingress+"\n              with:\n                dnn:\n                  from: input.dnn\n"),
    source.replace(first,first.replace(ingress,"'"+ingress+"'")),
    source.replace(first,first.replace(ingress,"&anchor "+ingress)),
    source.replace(first+second,first+"            # between them\n"+second),
    source.replace(first,first.replace("\n"," # inline\n")),
    source.replace(second,first),
    source.replace(first,first.replace("- verify:","- verify:")+"  "),
    "procedures: ["
  ]){
    assert.equal(adjacentVerifyReorderOptions(changed,proc,node)
      .some(o=>o.phaseName===phase&&o.stepIndex===index),false);
    assert.throws(()=>previewAdjacentVerifyReorder(...args(changed)));
  }
  assert.deepEqual(adjacentVerifyReorderOptions(source,"wrong",node),[]);
  assert.deepEqual(adjacentVerifyReorderOptions(source,proc,"missing"),[]);
});
test("D4-A3a previews reject stale Source or forged fields and survive CRLF",()=>{
  const p=previewAdjacentVerifyReorder(...args());
  for(const changed of [
    {...p,diff:"forged"},
    {...p,candidateSource:source},
    {...p,sourceSpan:{start:0,end:0}},
    {...p,stepIndex:2},
    {...p,type:"SetRouteTarget"},
    {...p,other:true}
  ])assert.throws(()=>applyAdjacentVerifyReorder(source,changed));
  assert.throws(()=>applyAdjacentVerifyReorder(source+"\n",p),/Stale/);
  const crlf=source.replace(/\n/g,"\r\n");
  const c=previewAdjacentVerifyReorder(...args(crlf));
  assert.ok(c.candidateSource.includes(second.replace(/\n/g,"\r\n")+
    first.replace(/\n/g,"\r\n")));
  assert.equal(projectWorkspace(applyAdjacentVerifyReorder(crlf,c)).state,"READY");
});
