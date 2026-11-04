import {parseDocument,isMap,isSeq,isScalar} from "yaml";
import {projectWorkspace} from "./workspace.mjs";

// D4-A2.2 first slice: READ-ONLY authored dependency and contract-evidence
// inspector. No edit capability, no inferred producer/consumer ABI, no graph
// mutation. Producer existence and path ordering are distinct from Runtime
// availability and output type compatibility.
const NAME=/^[A-Za-z_][A-Za-z0-9_-]*$/;
const NODE=/^[A-Za-z_][A-Za-z0-9_.-]*$/;
const FIELD=/^[A-Za-z_][A-Za-z0-9_-]*$/;
const MAX_ROWS=400;
const OUT=/^([A-Za-z_][A-Za-z0-9_.-]*)\.output((?:\.[A-Za-z_][A-Za-z0-9_-]*)*)$/;
const LOCAL=/^(preconditions|postconditions)\.([A-Za-z_][A-Za-z0-9_-]*)\.output((?:\.[A-Za-z_][A-Za-z0-9_-]*)*)$/;
const QUALIFIED=/^([A-Za-z_][A-Za-z0-9_.-]*)\.(preconditions|postconditions)\.([A-Za-z_][A-Za-z0-9_-]*)\.output((?:\.[A-Za-z_][A-Za-z0-9_-]*)*)$/;
const freeze=x=>Object.freeze(x);
const reason={
  DECLARED_INPUT:"当前 Procedure 已声明该输入；消费参数契约未验证",
  INPUT_NOT_DECLARED:"输入未在当前 Procedure 声明",
  EARLIER_LOCAL_STEP:"生产 Step 在当前 Node 的消费 Step 前执行；输出可用性及消费类型仍未验证",
  FUTURE_OR_SELF_STEP:"生产 Step 是当前或未来 Step，不能作为已存在的输出",
  UNKNOWN_PRODUCER_STEP:"未找到相应的命名生产 Step",
  AMBIGUOUS_PRODUCER_STEP:"存在同名生产 Step，来源不唯一",
  OWN_OPERATOR_PRIOR:"当前 Node 主 Operator 在 postconditions 前；结果结构与消费类型仍未验证",
  FUTURE_OWN_OPERATOR:"当前 Node 主 Operator 尚未执行",
  GRAPH_PREDECESSOR_ONLY:"生产 Node 在流程图中支配消费 Node，但输出可用性和类型没有契约保证",
  GRAPH_ORDER_UNPROVEN:"无法证明生产 Node 在所有到达消费 Node 的路径上先执行",
  UNKNOWN_PRODUCER_NODE:"输出引用的生产 Node 不存在",
  UNSUPPORTED_REFERENCE:"该来源不属于当前只读分析可解释的引用语法",
  SOURCE_NOT_PLAIN:"来源不是无歧义的 YAML 普通标量；保留 Source 模式"
};
function dominators(proc){
  const ids=new Set(proc.nodes.map(n=>n.id));
  const preds=new Map([...ids].map(id=>[id,new Set()]));
  const reachable=new Set(ids.has(proc.start)?[proc.start]:[]);
  for(const route of proc.routes)
    if(ids.has(route.source)&&ids.has(route.target))
      preds.get(route.target).add(route.source);
  const pending=[...reachable];
  for(let i=0;i<pending.length;i++)
    for(const [target,from] of preds)
      if(!reachable.has(target)&&[...from].some(id=>pending[i]===id)){
        // Reachability is recomputed below to avoid iteration-order reliance.
      }
  const successors=new Map([...ids].map(id=>[id,[]]));
  for(const route of proc.routes)
    if(ids.has(route.source)&&ids.has(route.target))
      successors.get(route.source).push(route.target);
  const queue=[...reachable];
  for(let i=0;i<queue.length;i++)
    for(const next of successors.get(queue[i]))
      if(!reachable.has(next)){reachable.add(next);queue.push(next);}
  const dom=new Map();
  for(const id of reachable)
    dom.set(id,id===proc.start?new Set([id]):new Set(reachable));
  for(let turn=0;turn<ids.size*ids.size+2;turn++){
    let changed=false;
    for(const id of reachable){
      if(id===proc.start)continue;
      const previous=[...preds.get(id)].filter(n=>reachable.has(n));
      if(!previous.length)continue;
      const intersection=new Set(dom.get(previous[0]));
      for(const p of previous.slice(1))
        for(const v of intersection)if(!dom.get(p).has(v))intersection.delete(v);
      intersection.add(id);
      const cur=dom.get(id);
      if(cur.size!==intersection.size||[...cur].some(x=>!intersection.has(x))){
        dom.set(id,intersection);changed=true;
      }
    }
    if(!changed)break;
  }
  return {reachable,dom};
}
function stepStatus(producer,consumerPhase,consumerIndex){
  if(producer.phaseName===consumerPhase)
    return producer.index<consumerIndex?"EARLIER_LOCAL_STEP":"FUTURE_OR_SELF_STEP";
  if(producer.phaseName==="preconditions"&&consumerPhase==="postconditions")
    return "EARLIER_LOCAL_STEP";
  return "FUTURE_OR_SELF_STEP";
}
function producerStep(node,phaseName,name){
  const phase=node.phases.find(p=>p.name===phaseName);
  const matches=phase?.steps.flatMap((s,i)=>
    s.name===name?[{step:s,index:i,phaseName}]:[])??[];
  return {status:matches.length===0?"UNKNOWN_PRODUCER_STEP":
    matches.length>1?"AMBIGUOUS_PRODUCER_STEP":null,match:matches[0]??null};
}
function schemaEvidence(files,producer,suffix){
  if(producer?.step?.operator!=="script"||!(files instanceof Map))
    return freeze({status:"NO_OWNER_OUTPUT_SCHEMA",schema:null,type:null});
  const file=files.get(producer.step.value);
  const meta=file?.text?.match(/^# outputSchema:\s*([A-Za-z][A-Za-z0-9]*)\s*$/m);
  if(!meta)return freeze({status:"NO_OWNER_OUTPUT_SCHEMA",schema:null,type:null});
  const name=meta[1],matches=[];
  for(const [path,record] of files){
    if(!/^schemas\/[^/]+\.schema\.ya?ml$/.test(path)||!record?.text)continue;
    try{
      const doc=parseDocument(record.text,{uniqueKeys:true,strict:true,logLevel:"silent"});
      if(doc.errors.length||doc.get("title")!==name)continue;
      matches.push({doc,path});
    }catch{/* invalid schema is not an admissible contract */}
  }
  if(matches.length!==1)return freeze({
    status:"SCHEMA_NOT_UNIQUELY_RESOLVED",schema:name,type:null});
  const {doc,path}=matches[0];
  let current=doc.contents;
  for(const field of suffix? suffix.slice(1).split("."):[]){
    if(!FIELD.test(field)||!isMap(current))return freeze({
      status:"FIELD_SHAPE_NOT_PROVEN",schema:path,type:null});
    current=current.get("properties",true);
    if(!isMap(current))return freeze({
      status:"FIELD_SHAPE_NOT_PROVEN",schema:path,type:null});
    current=current.get(field,true);
    if(!isMap(current))return freeze({
      status:"FIELD_SHAPE_NOT_PROVEN",schema:path,type:null});
  }
  const declared=current?.get?.("type",true);
  if(!isScalar(declared)||typeof declared.value!=="string")return freeze({
    status:"FIELD_SHAPE_NOT_PROVEN",schema:path,type:null});
  return freeze({status:"SCRIPT_SCHEMA_FIELD_DECLARED",
    schema:path,type:declared.value});
}
function resolve(ctx,phaseName,index,raw){
  const {proc,node,inputs,graph,files}=ctx;
  if(raw.startsWith("input.")){
    const key=raw.slice(6),value=inputs.get(key);
    return {status:value?"DECLARED_INPUT":"INPUT_NOT_DECLARED",
      producerNodeId:null,producerPhase:null,producerStep:null,
      fieldSuffix:"",schema:freeze({status:"NO_CONSUMER_ABI",schema:null,
        type:value??null})};
  }
  let match=LOCAL.exec(raw),targetNode=node,phase,stepName,suffix;
  if(match){[,phase,stepName,suffix]=match;}
  else if((match=QUALIFIED.exec(raw))){
    targetNode=proc.nodes.find(n=>n.id===match[1]);
    [, ,phase,stepName,suffix]=match;
    if(!targetNode)return {status:"UNKNOWN_PRODUCER_NODE",
      producerNodeId:match[1],producerPhase:phase,
      producerStep:stepName,fieldSuffix:suffix};
  }else if((match=OUT.exec(raw))){
    const producer=proc.nodes.find(n=>n.id===match[1]);
    if(!producer)return {status:"UNKNOWN_PRODUCER_NODE",
      producerNodeId:match[1],producerPhase:null,
      producerStep:null,fieldSuffix:match[2]};
    const status=producer.id===node.id?
      phaseName==="postconditions"?"OWN_OPERATOR_PRIOR":"FUTURE_OWN_OPERATOR":
      graph.reachable.has(node.id)&&graph.dom.get(node.id)?.has(producer.id)?
        "GRAPH_PREDECESSOR_ONLY":"GRAPH_ORDER_UNPROVEN";
    return {status,producerNodeId:producer.id,producerPhase:null,
      producerStep:null,fieldSuffix:match[2],
      schema:freeze({status:"NO_OWNER_OUTPUT_SCHEMA",schema:null,type:null})};
  }else return {status:"UNSUPPORTED_REFERENCE",producerNodeId:null,
    producerPhase:null,producerStep:null,fieldSuffix:""};
  const found=producerStep(targetNode,phase,stepName);
  const target=found.match;
  const status=found.status??(targetNode.id===node.id?
    stepStatus(target,phaseName,index):
    graph.reachable.has(node.id)&&graph.dom.get(node.id)?.has(targetNode.id)?
      "GRAPH_PREDECESSOR_ONLY":"GRAPH_ORDER_UNPROVEN");
  return {status,producerNodeId:targetNode.id,producerPhase:phase,
    producerStep:stepName,fieldSuffix:suffix,
    schema:target?schemaEvidence(files,target,suffix):undefined};
}
export function phaseStepDependencyReport(source,procedureId,nodeId,files=null){
  const empty=(status="UNAVAILABLE")=>freeze({status,bindings:freeze([]),summary:freeze({
    count:0,unresolved:0,editEligible:0})});
  if(typeof source!=="string"||source.length>1024*1024||
    !NODE.test(procedureId??"")||!NODE.test(nodeId??""))return empty();
  const before=projectWorkspace(source);
  if(before.state!=="READY")return empty();
  const proc=before.procedures.get(procedureId);
  const node=proc?.nodes.find(n=>n.id===nodeId);
  if(!node)return empty();
  let doc;
  try{
    doc=parseDocument(source,{version:"1.2",schema:"core",strict:true,
      uniqueKeys:true,stringKeys:true,keepSourceTokens:true,logLevel:"silent"});
  }catch{return empty();}
  if(doc.errors.length)return empty();
  const inputAst=doc.getIn(["procedures",procedureId,"inputs"],true);
  const inputs=new Map();
  if(isMap(inputAst))
    for(const pair of inputAst.items){
      const type=pair.value?.get?.("type",true)?.value;
      if(NAME.test(pair.key?.value??"")&&typeof type==="string")inputs.set(pair.key.value,type);
    }
  const ctx={proc,node,inputs,files,graph:dominators(proc)};
  const bindings=[];
  for(const phase of node.phases){
    const seq=doc.getIn(["procedures",procedureId,"nodes",nodeId,
      phase.name,"steps"],true);
    if(!isSeq(seq))continue;
    for(let i=0;i<seq.items.length;i++){
      const step=seq.items[i];
      if(!isMap(step))continue;
      const withMap=step.get("with",true);
      if(!isMap(withMap))continue;
      for(const pair of withMap.items){
        if(bindings.length>=MAX_ROWS)return empty("TOO_MANY_BINDINGS");
        const key=pair.key?.value;
        const from=isMap(pair.value)?pair.value.get("from",true):null;
        if(typeof key!=="string"||!from)continue;
        const val=typeof from.value==="string"?from.value:String(from.value??"");
        const original=Array.isArray(from.range)?
          source.slice(from.range[0],from.range[1]):"";
        const plain=isScalar(from)&&!from.anchor&&!from.tag&&val===original;
        const result=plain?resolve(ctx,phase.name,i,val):{status:"SOURCE_NOT_PLAIN",
          producerNodeId:null,producerPhase:null,producerStep:null,fieldSuffix:""};
        const at=Array.isArray(from.range)?from.range[0]:0;
        const line=source.slice(0,at).split("\n").length;
        bindings.push(freeze({
          phaseName:phase.name,stepIndex:i,stepName:phase.steps[i]?.name??"",
          stepOperator:phase.steps[i]?.operator??"",
          consumerNodeId:nodeId,bindingKey:key,value:val,line,
          ...result,reason:reason[result.status],
          contractStatus:result.schema?.status??"NO_OWNER_OUTPUT_SCHEMA",
          contractSchema:result.schema?.schema??null,
          outputType:result.schema?.type??null,
          editEligible:false
        }));
      }
    }
  }
  const unresolved=bindings.filter(b=>!["DECLARED_INPUT","EARLIER_LOCAL_STEP",
    "OWN_OPERATOR_PRIOR","GRAPH_PREDECESSOR_ONLY"].includes(b.status)).length;
  return freeze({status:"READY",bindings:freeze(bindings),
    summary:freeze({count:bindings.length,unresolved,editEligible:0})});
}
