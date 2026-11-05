// Presentation-only explanations for current Source dependency evidence.
// This module MUST NOT grant a Visual mutation or infer any Tool/Runtime ABI.
const freeze=Object.freeze;
const located=new Set(["DECLARED_INPUT","EARLIER_LOCAL_STEP",
  "OWN_OPERATOR_PRIOR","GRAPH_PREDECESSOR_ONLY"]);
const labels=freeze({
  SOURCE_UNPROVEN:"来源需要核验",
  TYPE_MISMATCH:"声明类型冲突",
  PRODUCER_SCHEMA_UNPROVEN:"输出 Schema 未证明",
  CONSUMER_ABI_UNPROVEN:"消费端 ABI 未证明",
  TYPE_ONLY:"只有类型证据",
  CONSTRAINTS_UNPROVEN:"约束与行为未证明",
  UNAVAILABLE:"依赖证据不可用"
});
export function bindingEvidenceExplanation(entry,abi=null){
  if(!entry||typeof entry.bindingKey!=="string"||
     typeof entry.value!=="string")return freeze({
       code:"UNAVAILABLE",origin:"没有可核验的 Source 绑定",
       reason:"无法确定依赖来源；请查看原始 YAML，不会推测可编辑资格。"
     });
  const origin=entry.status==="DECLARED_INPUT"?
    "源头：Procedure input（仅有声明）":
    entry.status==="EARLIER_LOCAL_STEP"?
      "源头：同 Node 中较早的 Phase Step":
    entry.status==="OWN_OPERATOR_PRIOR"?
      "源头：本 Node 已位于此前的主操作（静态顺序）":
    entry.status==="GRAPH_PREDECESSOR_ONLY"?
      "源头：前驱 Node（仅图结构可追溯，不代表结果已生成）":
      "源头：尚无法证明 · "+(entry.reason||entry.status||"未知原因");
  let code,reason;
  if(!located.has(entry.status)){
    code="SOURCE_UNPROVEN";
    reason="来源、执行先后或原文表达尚未核验；仅可在 Source 中检查。";
  }else if(abi?.typeRelation==="TYPE_MISMATCH"){
    code="TYPE_MISMATCH";
    reason="已有的生产者/消费者声明类型冲突，不能据此重新绑定。";
  }else if(entry.status!=="DECLARED_INPUT"&&
           entry.contractStatus!=="SCRIPT_SCHEMA_FIELD_DECLARED"){
    code="PRODUCER_SCHEMA_UNPROVEN";
    reason="来源虽可定位，但当前 Package 未能提供唯一的生产者输出 Schema，无法证明输出字段类型。";
  }else if(abi?.consumerStatus!=="CONSUMER_FIELD_DECLARED"){
    code="CONSUMER_ABI_UNPROVEN";
    reason="当前 Package 未能提供可核验的消费端输入 ABI；Call 的版本化操作契约不能靠字段名猜测。";
  }else if(abi?.typeRelation==="TYPE_ONLY_MATCH"){
    code="TYPE_ONLY";
    reason="仅证明声明类型相同，尚未核验字段约束、业务含义或 Runtime 行为。";
  }else{
    code="CONSTRAINTS_UNPROVEN";
    reason="来源已定位，但消费约束或执行资格尚未被证明，不能从依赖视图授权改绑。";
  }
  return freeze({code,origin,reason});
}
export function phaseStepEvidenceSummary(phaseName,stepIndex,lineage,contracts){
  if(lineage?.status!=="READY"||typeof phaseName!=="string"||
     !Number.isInteger(stepIndex)||stepIndex<0)return null;
  const rows=lineage.bindings.filter(row=>row.phaseName===phaseName&&
    row.stepIndex===stepIndex);
  if(!rows.length)return null;
  const explanations=rows.map(row=>{
    const abi=contracts?.status==="READY"?contracts.bindings.find(x=>
      x.phaseName===row.phaseName&&x.stepIndex===row.stepIndex&&
      x.bindingKey===row.bindingKey):null;
    return bindingEvidenceExplanation(row,abi);
  });
  const priority=["SOURCE_UNPROVEN","TYPE_MISMATCH",
    "PRODUCER_SCHEMA_UNPROVEN","CONSUMER_ABI_UNPROVEN",
    "TYPE_ONLY","CONSTRAINTS_UNPROVEN"];
  const code=priority.find(v=>explanations.some(x=>x.code===v))||
    "UNAVAILABLE";
  return freeze({
    code,count:rows.length,readOnly:true,
    label:rows.length+" 项依赖 · "+labels[code]+" · 只读证据"
  });
}
