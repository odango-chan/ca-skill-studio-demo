import {projectWorkspace} from "./workspace.mjs";
import {namedPhaseStepImpactReport} from "./phase-step-rename.mjs";
import {phaseStepDependencyReport} from "./phase-dataflow.mjs";

// D4-A3b2b2a: READ-ONLY evidence for deleting / reordering a named Step.
// This cannot authorize script/call side effects. Existing precise Verify
// editors remain the only source of edit-eligibility.
const ID=/^[A-Za-z_][A-Za-z0-9_.-]*$/;
const freeze=Object.freeze;
const reasons=freeze({
  UNKNOWN_REFERENCES:"Source 存在未能闭集核验的 Step 名或输出引用",
  OUTPUT_CONSUMERS:"其他 Step/Node 正消费此命名 Step 的输出",
  DIRECT_DATA_DEPENDENCY:"相邻 Step 存在显式生产者→消费者 from 引用，不能交换",
  EFFECT_UNPROVEN:"Script/Call/Procedure 的执行副作用与顺序资格没有 owner 证明",
  UNRESOLVED_INPUTS:"Step 的输入依赖无法从当前 Source 确认",
  NO_NEXT_STEP:"此 Phase 已没有下一条 Step",
  VERIFY_EDITOR_RULES:"仅为纯 Verify 候选；仍必须通过现有 AST/Source 编辑资格检查",
  UNAVAILABLE:"依赖分析或 Procedure 投影不可用"
});
function verdict(code,detail=null){
  return freeze({code,reason:reasons[code]??reasons.UNAVAILABLE,detail});
}
function isProven(b){
  return ["DECLARED_INPUT","EARLIER_LOCAL_STEP",
    "OWN_OPERATOR_PRIOR","GRAPH_PREDECESSOR_ONLY"].includes(b.status);
}
export function namedStepMutationImpactReport(source,procedureId,nodeId,files=null){
  const empty=freeze({status:"UNAVAILABLE",steps:freeze([])});
  if(typeof source!=="string"||source.length>1024*1024||
     !ID.test(procedureId??"")||!ID.test(nodeId??""))return empty;
  const model=projectWorkspace(source);
  const proc=model.procedures?.get(procedureId);
  const node=proc?.nodes.find(n=>n.id===nodeId);
  if(model.state!=="READY"||!node)return empty;
  const named=namedPhaseStepImpactReport(source,procedureId,nodeId);
  const dependencies=phaseStepDependencyReport(source,procedureId,nodeId,files);
  if(dependencies.status!=="READY")return empty;
  const rows=[];
  for(const phase of node.phases)
    for(let index=0;index<phase.steps.length;index++){
      const current=phase.steps[index],next=phase.steps[index+1]??null;
      if(!current.name)continue;
      const evidence=named.find(x=>x.phaseName===phase.name&&
        x.stepIndex===index&&x.stepName===current.name);
      const nextEvidence=next?.name?named.find(x=>
        x.phaseName===phase.name&&x.stepIndex===index+1&&
        x.stepName===next.name):null;
      const inputs=dependencies.bindings.filter(x=>x.phaseName===phase.name&&
        x.stepIndex===index);
      const nextInputs=dependencies.bindings.filter(x=>x.phaseName===phase.name&&
        x.stepIndex===index+1);
      // A same-node explicit from edge crossing the proposed boundary is
      // always a blocker even when a script/call claims to be read-only.
      const direct=freeze(nextInputs.filter(x=>x.producerNodeId===nodeId&&
        x.producerPhase===phase.name&&x.producerStep===current.name)
        .map(x=>freeze({line:x.line,bindingKey:x.bindingKey,
          value:x.value,status:x.status})));
      const sourcesReady=evidence?.status==="READY"&&
        evidence.editEligible===true&&Number.isInteger(evidence.referenceCount);
      const nextReady=!next?.name||
        (nextEvidence?.status==="READY"&&nextEvidence.editEligible===true&&
         Number.isInteger(nextEvidence.referenceCount));
      const count=sourcesReady?evidence.referenceCount:null;
      const unresolved=inputs.filter(x=>!isProven(x));
      let deletion;
      if(!sourcesReady)deletion=verdict("UNKNOWN_REFERENCES");
      else if(count>0)deletion=verdict("OUTPUT_CONSUMERS",String(count));
      else if(current.operator!=="verify")deletion=verdict("EFFECT_UNPROVEN");
      else if(unresolved.length)deletion=verdict("UNRESOLVED_INPUTS");
      else deletion=verdict("VERIFY_EDITOR_RULES");
      let move;
      if(!next)move=verdict("NO_NEXT_STEP");
      else if(direct.length)move=verdict("DIRECT_DATA_DEPENDENCY",String(direct.length));
      else if(!sourcesReady||!nextReady)move=verdict("UNKNOWN_REFERENCES");
      else if(current.operator!=="verify"||next.operator!=="verify")
        move=verdict("EFFECT_UNPROVEN");
      else if(count>0||(next.name&&nextEvidence.referenceCount>0))
        move=verdict("OUTPUT_CONSUMERS");
      else if(unresolved.length||nextInputs.some(x=>!isProven(x)))
        move=verdict("UNRESOLVED_INPUTS");
      else move=verdict("VERIFY_EDITOR_RULES");
      rows.push(freeze({
        phaseName:phase.name,stepIndex:index,stepName:current.name,
        operator:current.operator,nextStepName:next?.name||next?.value||null,
        referenceCount:count,
        inputs:freeze(inputs.map(x=>freeze({
          line:x.line,bindingKey:x.bindingKey,value:x.value,status:x.status
        }))),
        directReferences:direct,
        deletion,move
      }));
    }
  return freeze({status:"READY",steps:freeze(rows)});
}
