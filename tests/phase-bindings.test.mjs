import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {projectWorkspace} from "../site/workspace.mjs";
import {phaseStepBindingOptions,previewPhaseInputBinding,
        applyPhaseInputBinding} from "../site/phase-bindings.mjs";
const procedure=readFileSync(new URL(
  "../site/samples/packages/establish-pdu-session/assurance/procedure.yaml",
  import.meta.url),"utf8");
const ensure=readFileSync(new URL(
  "../site/samples/packages/ensure-pdu-session/assurance/procedure.yaml",
  import.meta.url),"utf8");
const pid="ue-requested-pdu-session-establishment";
const node="nudm-sdm-subscribe";
const args=(source=procedure,value="input.ue-ref")=>
  [source,pid,node,"preconditions",0,"dnn",value];
test("D4-A1 source-qualified step binding choices preserve original input type",()=>{
  const choices=phaseStepBindingOptions(procedure,pid,node);
  const row=choices.find(x=>x.phaseName==="preconditions"&&
    x.stepIndex===0&&x.bindingKey==="dnn");
  assert.ok(row);
  assert.equal(row.value,"input.dnn");
  assert.equal(row.inputType,"string");
  assert.ok(row.choices.includes("input.ue-ref"));
  assert.ok(row.choices.includes("input.dnn"));
  assert.equal(row.choices.includes("input.psi"),false);
  assert.equal(row.choices.some(x=>x.startsWith("preconditions.")),false);
  assert.ok(Object.isFrozen(choices)&&Object.isFrozen(row.choices));
});
test("D4-A1 only rebinds one physical Phase Step from scalar and preserves graph",()=>{
  const before=projectWorkspace(procedure);
  const preview=previewPhaseInputBinding(...args());
  assert.equal(preview.type,"SetPhaseInputFrom");
  assert.match(preview.diff,/-\s+from: input.dnn\n\+\s+from: input.ue-ref/);
  assert.equal(procedure.slice(preview.sourceSpan.start,preview.sourceSpan.end),"input.dnn");
  const after=applyPhaseInputBinding(procedure,preview);
  assert.equal(after,procedure.slice(0,preview.sourceSpan.start)+
    "input.ue-ref"+procedure.slice(preview.sourceSpan.end));
  const projected=projectWorkspace(after);
  assert.equal(projected.state,"READY");
  assert.equal(projected.procedures.size,before.procedures.size);
  assert.deepEqual([...projected.procedures.keys()],[...before.procedures.keys()]);
  assert.ok(after.includes("dnn:\n                  from: input.ue-ref"));
  assert.ok(after.includes("selection:\n            from: preconditions.select-subscription-configuration.output"));
  assert.equal(procedure,readFileSync(new URL(
    "../site/samples/packages/establish-pdu-session/assurance/procedure.yaml",
    import.meta.url),"utf8"));
});
test("D4-A1 rejects wrong types, invented and cross-procedure references",()=>{
  for(const to of ["input.psi","input.unknown","input.slice","input.input.dnn",
    "nudm-sdm-get.output","preconditions.other.output",null,""]){
    assert.throws(()=>previewPhaseInputBinding(...args(procedure,to)));
  }
  assert.throws(()=>previewPhaseInputBinding(...args(procedure,"input.dnn")),/No Phase Step binding change/);
});
test("D4-A1 is isolated to a valid Phase, Step, node and declared input",()=>{
  const invalid=[
    [procedure,pid,node,"preconditions",81,"dnn","input.ue-ref"],
    [procedure,pid,node,"postconditions",0,"dnn","input.ue-ref"],
    [procedure,pid,node,"operator",0,"dnn","input.ue-ref"],
    [procedure,pid,node,"preconditions",4,"dnn","input.ue-ref"],
    [procedure,pid,"nudm-sdm-get","preconditions",0,"dnn","input.ue-ref"],
    [procedure,"not-a-procedure",node,"preconditions",0,"dnn","input.ue-ref"],
    [procedure,pid,node,"preconditions",0,"bad","input.ue-ref"]
  ];
  for(const args of invalid)assert.throws(()=>previewPhaseInputBinding(...args));
  assert.deepEqual(phaseStepBindingOptions(ensure,"ensure-session","create-session"),[]);
});
test("D4-A1 rejects quoted scalars, anchors, alias and malformed Source",()=>{
  const marked="                  from: input.dnn";
  assert.ok(procedure.includes(marked));
  for(const altered of [
    procedure.replace(marked,"                  from: 'input.dnn'"),
    procedure.replace(marked,"                  from: &ref input.dnn"),
    procedure.replace(marked,"                  from: *ref"),
    procedure.replace(marked,"                  from: input.dnn\n                  from: input.ue-ref"),
    "procedures: ["
  ]){
    assert.equal(phaseStepBindingOptions(altered,pid,node).find(
      x=>x.stepIndex===0&&x.bindingKey==="dnn"),undefined);
    assert.throws(()=>previewPhaseInputBinding(...args(altered)));
  }
});
test("D4-A1 protects comments, exact source span, CRLF and immutable previews",()=>{
  const text=procedure.replace("                  from: input.dnn",
    "                  from: input.dnn # input provenance");
  const preview=previewPhaseInputBinding(...args(text));
  const applied=applyPhaseInputBinding(text,preview);
  assert.ok(applied.includes("from: input.ue-ref # input provenance"));
  for(const modified of [
    {...preview,diff:"forged"}, {...preview,sourceSpan:{start:0,end:0}},
    {...preview,candidateSource:text}, {...preview,oldValue:"wrong"},
    {...preview,unknown:"x"}
  ])assert.throws(()=>applyPhaseInputBinding(text,modified));
  assert.throws(()=>applyPhaseInputBinding(text+"\n",preview),/Stale/);
  const crlf=procedure.replace(/\n/g,"\r\n");
  const p=previewPhaseInputBinding(...args(crlf));
  assert.ok(applyPhaseInputBinding(crlf,p).includes("from: input.ue-ref\r\n"));
});
test("D4-A1 never changes Phase routes, Node count or Step name",()=>{
  const a=projectWorkspace(procedure);
  const newText=applyPhaseInputBinding(procedure,previewPhaseInputBinding(...args()));
  const b=projectWorkspace(newText);
  for(const [name,p] of a.procedures){
    const q=b.procedures.get(name);
    assert.deepEqual(q.routes,p.routes);
    assert.deepEqual(q.nodes,p.nodes);
    assert.deepEqual(q.children,p.children);
  }
});
