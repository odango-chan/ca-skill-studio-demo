import {parseDocument,isMap,isSeq,isScalar} from "yaml";
import {projectWorkspace} from "./workspace.mjs";
import {routeProjectionSignature} from "./route-create.mjs";

// D4-A1: rebind an EXISTING phase Step with.<key>.from to another
// declared input of the same declared type within the SAME Procedure.
// No Step/Phase/Route creation, no output-producer references, no guessed
// runtime parameter contract. All writes are precise YAML source spans.
const ID=/^[A-Za-z_][A-Za-z0-9_.-]*$/;
const FROM=/^input\.([A-Za-z_][A-Za-z0-9_-]*)$/;
const PHASES=new Set(["preconditions","postconditions"]);
const INPUT_TYPES=new Set(["string","integer","number","boolean","object","array"]);
const fail=msg=>{throw new Error(msg);};
function plain(source,node,expected){
  if(!isScalar(node)||typeof node.value!=="string"||node.value!==expected||
    !Array.isArray(node.range)||node.anchor||node.tag)
    fail("Phase binding is not a plain Source scalar");
  const [start,end]=node.range;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||
    start<0||end<=start||end>source.length||
    source.slice(start,end)!==expected)
    fail("Quoted, aliased or modified Phase binding cannot be edited");
  return {start,end};
}
function context(source,procedureId,nodeId){
  if(typeof source!=="string"||source.length>1024*1024||
    typeof procedureId!=="string"||!ID.test(procedureId)||
    typeof nodeId!=="string"||!ID.test(nodeId))
    fail("Invalid Phase binding source or identity");
  const before=projectWorkspace(source);
  const proc=before.procedures.get(procedureId);
  const node=proc?.nodes.find(n=>n.id===nodeId);
  if(before.state!=="READY"||!node)fail("Selected Node is not projected");
  const doc=parseDocument(source,{version:"1.2",schema:"core",strict:true,
    uniqueKeys:true,stringKeys:true,keepSourceTokens:true,logLevel:"silent"});
  if(doc.errors.length)fail("Unsafe YAML for Phase editing");
  const inputMap=doc.getIn(["procedures",procedureId,"inputs"],true);
  if(!isMap(inputMap))fail("Procedure has no qualified input declarations");
  const inputs=new Map();
  for(const pair of inputMap.items){
    const key=pair.key?.value;
    if(typeof key!=="string"||!ID.test(key)||!isMap(pair.value))
      continue;
    const declared=pair.value.get("type",true);
    if(!isScalar(declared)||typeof declared.value!=="string"||
      !INPUT_TYPES.has(declared.value))continue;
    inputs.set(key,declared.value);
  }
  return {source,before,proc,node,doc,inputs};
}
function bindingCandidates(ctx){
  const {doc,inputs,source,node,proc}=ctx;
  const rows=[];
  for(const phase of node.phases){
    if(!PHASES.has(phase.name))continue;
    const ast=doc.getIn(["procedures",proc.name,"nodes",node.id,phase.name,"steps"],true);
    if(!isSeq(ast)||ast.items.length!==phase.steps.length)continue;
    for(let i=0;i<phase.steps.length;i++){
      const step=phase.steps[i],stepAst=ast.items[i];
      if(!isMap(stepAst))continue;
      const withMap=stepAst.get("with",true);
      if(!isMap(withMap))continue;
      for(const pair of withMap.items){
        const bindingKey=pair.key?.value;
        if(typeof bindingKey!=="string"||!ID.test(bindingKey)||
          !isMap(pair.value)||pair.value.items.length!==1)continue;
        const fromPair=pair.value.items[0];
        if(fromPair.key?.value!=="from")continue;
        const value=fromPair.value?.value;
        const match=typeof value==="string"?FROM.exec(value):null;
        if(!match||!inputs.has(match[1]))continue;
        try{plain(source,fromPair.value,value);}
        catch{continue;}
        const type=inputs.get(match[1]);
        const choices=[...inputs].filter(([,t])=>t===type)
          .map(([key])=>"input."+key).sort();
        if(choices.length<2)continue;
        rows.push(Object.freeze({
          phaseName:phase.name,stepIndex:i,stepName:step.name,
          operator:step.operator,operatorValue:step.value,bindingKey,
          value,inputType:type,choices:Object.freeze(choices)
        }));
      }
    }
  }
  return rows;
}
export function phaseStepBindingOptions(source,procedureId,nodeId){
  try{return Object.freeze(bindingCandidates(context(source,procedureId,nodeId)));}
  catch{return Object.freeze([]);}
}
function compute(source,procedureId,nodeId,phaseName,stepIndex,bindingKey,newValue){
  if(!PHASES.has(phaseName)||!Number.isInteger(stepIndex)||
     stepIndex<0||stepIndex>=80||typeof bindingKey!=="string"||
     !ID.test(bindingKey)||typeof newValue!=="string"||!FROM.test(newValue))
    fail("Invalid Phase Step binding selector");
  const ctx=context(source,procedureId,nodeId);
  const item=bindingCandidates(ctx).find(x=>x.phaseName===phaseName&&
    x.stepIndex===stepIndex&&x.bindingKey===bindingKey);
  if(!item)fail("Phase Step binding is outside the bounded input profile");
  if(!item.choices.includes(newValue))
    fail("Input source is not a same-type declared Procedure input");
  if(item.value===newValue)fail("No Phase Step binding change");
  const path=["procedures",procedureId,"nodes",nodeId,
    phaseName,"steps",stepIndex,"with",bindingKey,"from"];
  const scalar=ctx.doc.getIn(path,true);
  const span=plain(source,scalar,item.value);
  const candidateSource=source.slice(0,span.start)+newValue+source.slice(span.end);
  const after=projectWorkspace(candidateSource);
  if(after.state!=="READY"||
    JSON.stringify(routeProjectionSignature(ctx.before))!==
    JSON.stringify(routeProjectionSignature(after)))
    fail("Phase input edit changed Node, Step, Child or Route semantics");
  const modified=context(candidateSource,procedureId,nodeId);
  const afterEntry=bindingCandidates(modified).find(x=>
    x.phaseName===phaseName&&x.stepIndex===stepIndex&&x.bindingKey===bindingKey);
  if(afterEntry?.value!==newValue||afterEntry.inputType!==item.inputType)
    fail("New Phase binding failed qualification");
  const a=source.lastIndexOf("\n",Math.max(0,span.start-1))+1;
  const b=source.indexOf("\n",span.end);
  const beforeLine=source.slice(a,b<0?source.length:b).replace(/\r$/,"");
  const afterLine=beforeLine.slice(0,span.start-a)+newValue+
    beforeLine.slice(span.end-a);
  const line=source.slice(0,span.start).split("\n").length;
  return Object.freeze({
    type:"SetPhaseInputFrom",profile:"d4-a1-phase-input-from-v1",
    procedureId,nodeId,phaseName,stepIndex,bindingKey,
    oldValue:item.value,newValue,inputType:item.inputType,
    baseSource:source,candidateSource,
    sourceSpan:Object.freeze(span),
    diff:"@@ -"+line+",1 +"+line+",1 @@\n-"+beforeLine+"\n+"+afterLine,
    summary:nodeId+" · "+phaseName+".steps["+(stepIndex+1)+"].with."+
      bindingKey+".from · "+item.value+" → "+newValue+
      "（仅同类型已声明输入，不代表 Runtime 参数兼容）"
  });
}
export function previewPhaseInputBinding(source,procedureId,nodeId,
                                        phaseName,stepIndex,bindingKey,newValue){
  return compute(source,procedureId,nodeId,phaseName,stepIndex,bindingKey,newValue);
}
export function applyPhaseInputBinding(source,preview){
  if(!preview||preview.type!=="SetPhaseInputFrom"||
     source!==preview.baseSource)fail("Stale or unsupported Phase Step preview");
  const expected=compute(source,preview.procedureId,preview.nodeId,
    preview.phaseName,preview.stepIndex,preview.bindingKey,preview.newValue);
  const keys=Object.keys(expected);
  if(Object.keys(preview).length!==keys.length||
     keys.some(key=>JSON.stringify(preview[key])!==JSON.stringify(expected[key])))
    fail("Phase Step preview is modified or expired");
  return expected.candidateSource;
}
