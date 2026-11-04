import {parseDocument,isMap,isSeq,isScalar} from "yaml";
import {projectWorkspace} from "./workspace.mjs";
import {routeProjectionSignature} from "./route-create.mjs";

// D4-A2/A1: normalize one already-authored Phase Step output binding
// between its local and fully-qualified spelling. Both spellings must occur
// in the same Procedure Source, and they must denote the identical producer,
// output suffix and past Step. No output type or consumer ABI inference.
const ID=/^[A-Za-z_][A-Za-z0-9_.-]*$/;
const STEP=/^[A-Za-z_][A-Za-z0-9_-]*$/;
const PHASES=new Set(["preconditions","postconditions"]);
const SUFFIX=/^(?:\.[A-Za-z_][A-Za-z0-9_-]*)*$/;
const fail=message=>{throw new Error(message);};

function sourceScalar(source,scalar,expected){
  if(!isScalar(scalar)||typeof scalar.value!=="string"||
    scalar.value!==expected||scalar.anchor||scalar.tag||
    !Array.isArray(scalar.range))fail("Unqualified, alias or non-string output reference");
  const [start,end]=scalar.range;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||
     start<0||end<=start||end>source.length||
     source.slice(start,end)!==expected)
    fail("Output reference requires an exact plain YAML Source scalar");
  return {start,end};
}
function setup(source,procedureId,nodeId){
  if(typeof source!=="string"||source.length>1024*1024||
    !ID.test(procedureId??"")||!ID.test(nodeId??""))
    fail("Invalid Phase output reference selector");
  const before=projectWorkspace(source);
  if(before.state!=="READY")fail("Source projection is unavailable");
  const procedure=before.procedures.get(procedureId);
  const node=procedure?.nodes.find(x=>x.id===nodeId);
  if(!node)fail("Selected Procedure/Node not found");
  const doc=parseDocument(source,{version:"1.2",schema:"core",strict:true,
    uniqueKeys:true,stringKeys:true,keepSourceTokens:true,logLevel:"silent"});
  if(doc.errors.length)fail("Output reference Source cannot be parsed");
  const procAst=doc.getIn(["procedures",procedureId],true);
  if(!isMap(procAst))fail("Procedure Source is unavailable");
  const observed=new Set();
  function traverse(ast){
    if(isMap(ast)){
      for(const pair of ast.items){
        if(pair.key?.value==="from"&&isScalar(pair.value)&&
          typeof pair.value.value==="string"){
          try{sourceScalar(source,pair.value,pair.value.value);
            observed.add(pair.value.value);}catch{/* Source-only reference */}
        }
        traverse(pair.value);
      }
    }else if(isSeq(ast))for(const entry of ast.items)traverse(entry);
  }
  traverse(procAst);
  return {source,before,procedure,node,doc,observed};
}
function availableProducers(node,consumerPhase,consumerIndex){
  const results=[];
  for(const phase of node.phases){
    if(!PHASES.has(phase.name))continue;
    const counts=new Map();
    for(const step of phase.steps)
      if(step.name)counts.set(step.name,(counts.get(step.name)||0)+1);
    for(let i=0;i<phase.steps.length;i++){
      const step=phase.steps[i];
      if(!STEP.test(step.name||"")||counts.get(step.name)!==1)continue;
      const isEarlier=phase.name===consumerPhase?i<consumerIndex:
        phase.name==="preconditions"&&consumerPhase==="postconditions";
      if(!isEarlier)continue;
      results.push({phaseName:phase.name,stepName:step.name,
        stepIndex:i,operator:step.operator,value:step.value});
    }
  }
  return results;
}
function normalize(source,ctx,phaseName,stepIndex,bindingKey,value){
  if(!PHASES.has(phaseName)||!Number.isInteger(stepIndex)||
    stepIndex<0||stepIndex>=80||!ID.test(bindingKey??"")||
    typeof value!=="string"||!ctx.observed.has(value))
    return null;
  const producers=availableProducers(ctx.node,phaseName,stepIndex);
  const pairs=[];
  for(const p of producers){
    const local=p.phaseName+"."+p.stepName+".output";
    const full=ctx.node.id+"."+local;
    const prefix=value===local||value.startsWith(local+".")?local:
      value===full||value.startsWith(full+".")?full:null;
    if(prefix===null)continue;
    const suffix=value.slice(prefix.length);
    if(!SUFFIX.test(suffix))continue;
    const choices=[local+suffix,full+suffix].filter(v=>ctx.observed.has(v));
    if(choices.length<2)continue;
    pairs.push({value,producerNodeId:ctx.node.id,
      producerPhase:p.phaseName,producerStep:p.stepName,
      producerStepIndex:p.stepIndex,outputSuffix:suffix,
      choices:Object.freeze(choices)});
  }
  // Dot-delimited step/node IDs can be ambiguous: never guess identity.
  return pairs.length===1?pairs[0]:null;
}
function candidates(ctx){
  const {doc,procedure,node,source}=ctx;
  const rows=[];
  for(const phase of node.phases){
    if(!PHASES.has(phase.name))continue;
    const steps=doc.getIn(["procedures",procedure.name,"nodes",node.id,
      phase.name,"steps"],true);
    if(!isSeq(steps)||steps.items.length!==phase.steps.length)continue;
    for(let i=0;i<phase.steps.length;i++){
      const stepAst=steps.items[i],step=phase.steps[i];
      if(!isMap(stepAst))continue;
      const withMap=stepAst.get("with",true);
      if(!isMap(withMap))continue;
      for(const pair of withMap.items){
        const key=pair.key?.value;
        if(typeof key!=="string"||!ID.test(key)||!isMap(pair.value)||
          pair.value.items.length!==1||
          pair.value.items[0].key?.value!=="from")continue;
        const raw=pair.value.items[0].value;
        if(!isScalar(raw)||typeof raw.value!=="string")continue;
        try{sourceScalar(source,raw,raw.value);}
        catch{continue;}
        const info=normalize(source,ctx,phase.name,i,key,raw.value);
        if(!info)continue;
        rows.push(Object.freeze({
          phaseName:phase.name,stepIndex:i,stepName:step.name,
          operator:step.operator,operatorValue:step.value,
          bindingKey:key,...info
        }));
      }
    }
  }
  return rows;
}
export function phaseOutputReferenceOptions(source,procedureId,nodeId){
  try{return Object.freeze(candidates(setup(source,procedureId,nodeId)));}
  catch{return Object.freeze([]);}
}
function compute(source,procedureId,nodeId,phaseName,stepIndex,bindingKey,newValue){
  if(typeof newValue!=="string"||newValue.length>300)
    fail("Invalid output binding choice");
  const ctx=setup(source,procedureId,nodeId);
  const selected=candidates(ctx).find(item=>item.phaseName===phaseName&&
    item.stepIndex===stepIndex&&item.bindingKey===bindingKey);
  if(!selected)fail("The output reference is not a qualified past local producer");
  if(selected.value===newValue)fail("Output reference has not changed");
  if(!selected.choices.includes(newValue))
    fail("Replacement changes output producer, field, or observed syntax");
  const path=["procedures",procedureId,"nodes",nodeId,phaseName,
    "steps",stepIndex,"with",bindingKey,"from"];
  const span=sourceScalar(source,ctx.doc.getIn(path,true),selected.value);
  const candidateSource=source.slice(0,span.start)+newValue+source.slice(span.end);
  const after=projectWorkspace(candidateSource);
  if(after.state!=="READY"||
    JSON.stringify(routeProjectionSignature(ctx.before))!==
    JSON.stringify(routeProjectionSignature(after)))
    fail("Rebind unexpectedly changed Procedure, Node, Step or Route structure");
  const again=candidates(setup(candidateSource,procedureId,nodeId)).find(x=>
    x.phaseName===phaseName&&x.stepIndex===stepIndex&&x.bindingKey===bindingKey);
  if(!again||again.value!==newValue||
    again.producerNodeId!==selected.producerNodeId||
    again.producerPhase!==selected.producerPhase||
    again.producerStep!==selected.producerStep||
    again.producerStepIndex!==selected.producerStepIndex||
    again.outputSuffix!==selected.outputSuffix)
    fail("Rebind did not preserve observed producer identity");
  const lineStart=source.lastIndexOf("\n",Math.max(0,span.start-1))+1;
  const lineEnd=source.indexOf("\n",span.end);
  const beforeLine=source.slice(lineStart,lineEnd===-1?source.length:lineEnd)
    .replace(/\r$/,"");
  const afterLine=beforeLine.slice(0,span.start-lineStart)+newValue+
    beforeLine.slice(span.end-lineStart);
  const line=source.slice(0,span.start).split("\n").length;
  return Object.freeze({
    type:"NormalizePhaseOutputReference",profile:"d4-a2-local-producer-v1",
    procedureId,nodeId,phaseName,stepIndex,bindingKey,
    producerNodeId:selected.producerNodeId,producerPhase:selected.producerPhase,
    producerStep:selected.producerStep,producerStepIndex:selected.producerStepIndex,
    outputSuffix:selected.outputSuffix,
    oldValue:selected.value,newValue,
    baseSource:source,candidateSource,sourceSpan:Object.freeze(span),
    diff:"@@ -"+line+",1 +"+line+",1 @@\n-"+beforeLine+"\n+"+afterLine,
    summary:nodeId+" / "+phaseName+".steps["+(stepIndex+1)+"]."+
      bindingKey+" · 同一生产 Step 的引用写法 · "+
      selected.value+" → "+newValue+
      "（不代表 Runtime 解析别名或输出字段类型已验证）"
  });
}
export function previewPhaseOutputReference(source,procedureId,nodeId,
                                             phaseName,stepIndex,bindingKey,newValue){
  return compute(source,procedureId,nodeId,phaseName,stepIndex,bindingKey,newValue);
}
export function applyPhaseOutputReference(source,preview){
  if(!preview||preview.type!=="NormalizePhaseOutputReference"||
    source!==preview.baseSource)
    fail("Stale or unsupported Phase output reference Preview");
  const expected=compute(source,preview.procedureId,preview.nodeId,
    preview.phaseName,preview.stepIndex,preview.bindingKey,preview.newValue);
  if(Object.keys(preview).length!==Object.keys(expected).length||
    Object.keys(expected).some(k=>JSON.stringify(preview[k])!==JSON.stringify(expected[k])))
    fail("Output reference preview is stale or altered");
  return expected.candidateSource;
}
