import {parseDocument,isScalar,isMap} from "yaml";
import {projectWorkspace} from "./workspace.mjs";

export class AttributePatchError extends Error {
  constructor(message){super(message);this.name="AttributePatchError";}
}
const fail=msg=>{throw new AttributePatchError(msg);};
const NAME=/^[A-Za-z_][A-Za-z0-9_.-]*$/;
function documentOf(text){
  if(typeof text!=="string"||text.length>1024*1024)fail("Source exceeds patch budget");
  const doc=parseDocument(text,{version:"1.2",schema:"core",strict:true,
    stringKeys:true,uniqueKeys:true,keepSourceTokens:true,logLevel:"silent"});
  if(doc.errors.length||!isMap(doc.contents))fail("YAML cannot be safely patched");
  return doc;
}
function scalarAt(doc,path){
  const value=doc.getIn(path,true);
  if(!isScalar(value)||!Array.isArray(value.range)||
     !Number.isSafeInteger(value.range[0])||!Number.isSafeInteger(value.range[1]))
    fail("Source scalar or source span unavailable");
  return value;
}
function diffLine(source,start,end,replacement){
  const a=source.lastIndexOf("\n",Math.max(0,start-1))+1;
  const b=source.indexOf("\n",end);
  const before=source.slice(a,b<0?source.length:b).replace(/\r$/,"");
  const after=before.slice(0,start-a)+replacement+before.slice(end-a);
  const line=source.slice(0,start).split("\n").length;
  return {line,diff:"@@ -"+line+",1 +"+line+",1 @@\n-"+before+"\n+"+after};
}
function replaceScalar(source,scalar,oldValue,replacement){
  const start=scalar.range[0],end=scalar.range[1];
  if(end<=start||end>source.length||source.slice(start,end)!==oldValue)
    fail("Expected plain scalar does not match the source span");
  const candidate=source.slice(0,start)+replacement+source.slice(end);
  return {candidate,span:Object.freeze({start,end}),...diffLine(source,start,end,replacement)};
}
function freezePreview(obj){return Object.freeze(obj);}
function comparePreview(input,expected){
  if(!input||input.type!==expected.type)fail("Unsupported preview type");
  for(const key of Object.keys(expected)){
    if(key==="sourceSpan"){
      if(!input.sourceSpan||input.sourceSpan.start!==expected.sourceSpan.start||
         input.sourceSpan.end!==expected.sourceSpan.end)fail("Source span changed");
    }else if(input[key]!==expected[key])fail("Preview has changed or is forged");
  }
}
export function predicateChoices(predicateSource){
  const doc=documentOf(predicateSource);
  if(doc.get("kind")!=="PredicateSet")return [];
  const definitions=doc.get("predicates",true);
  if(!isMap(definitions))return [];
  return definitions.items.map(p=>p.key?.value)
    .filter(x=>typeof x==="string"&&NAME.test(x));
}
function ensureVerifyModel(source,nodeId,procedureId){
  const model=projectWorkspace(source);
  if(model.state!=="READY"||model.procedures.size!==1||procedureId!=="ensure-session"||
     model.entry!==procedureId||model.procedure.start!=="observe-target-session"||
     model.procedure.nodes.length!==11||model.procedure.routes.length!==24)
    fail("This Node is outside the permitted ensure demo profile");
  const node=model.procedure.nodes.find(n=>n.id===nodeId);
  if(!node||node.operator!=="verify")fail("Only ensure verify predicates are currently editable");
  return {model,node};
}
export function nodeVerifyEditChoices(source,procedureId,nodeId,predicateSource){
  try {
    ensureVerifyModel(source,nodeId,procedureId);
    return predicateChoices(predicateSource);
  }catch{return [];}
}
export function previewVerifyPredicatePatch(source,procedureId,nodeId,newValue,predicateSource){
  if(!NAME.test(newValue)||!NAME.test(nodeId))fail("Invalid predicate or Node ID");
  const {model,node}=ensureVerifyModel(source,nodeId,procedureId);
  if(!predicateChoices(predicateSource).includes(newValue))fail("Predicate is not in this Package");
  if(node.value===newValue)fail("No change");
  const doc=documentOf(source);
  const scalar=scalarAt(doc,["procedures",procedureId,"nodes",nodeId,"verify"]);
  if(scalar.value!==node.value)fail("Operator value mismatch");
  const edit=replaceScalar(source,scalar,node.value,newValue);
  const after=projectWorkspace(edit.candidate);
  if(after.state!=="READY")fail("Modified Procedure does not parse");
  const normalized=p=>JSON.stringify({
    name:p.name,start:p.start,
    nodes:p.nodes.map(n=>({id:n.id,operator:n.operator,value:n.value,phases:n.phases,children:n.children})),
    routes:p.routes.map(r=>({id:r.id,source:r.source,target:r.target,outcome:r.outcome,routeSource:r.routeSource}))
  });
  const expected=structuredClone(model.procedure);
  expected.nodes.find(n=>n.id===nodeId).value=newValue;
  if(normalized(expected)!==normalized(after.procedure))
    fail("Patch affected another Node, Phase or Route");
  return freezePreview({
    type:"SetVerifyPredicate",profile:"ensure-verify-scalar-v1",
    procedureId,nodeId,oldValue:node.value,newValue,
    baseSource:source,candidateSource:edit.candidate,
    sourceSpan:edit.span,line:edit.line,diff:edit.diff,
    summary:nodeId+" · "+node.value+" → "+newValue
  });
}
export function applyVerifyPredicatePatch(source,preview,predicateSource){
  if(!preview||preview.type!=="SetVerifyPredicate")fail("Unsupported Node patch");
  if(source!==preview.baseSource)fail("Source revision changed");
  const expected=previewVerifyPredicatePatch(source,preview.procedureId,
    preview.nodeId,preview.newValue,predicateSource);
  comparePreview(preview,expected);
  return expected.candidateSource;
}
function maxActionsModel(source,packageName){
  const doc=documentOf(source);
  if(doc.get("kind")!=="SkillContract"||
     doc.getIn(["metadata","name"])!==packageName)
    fail("Not the active Skill Contract");
  const scalar=scalarAt(doc,["spec","planning","maxActions"]);
  if(!Number.isInteger(scalar.value)||scalar.value<1||scalar.value>128)
    fail("Invalid maxActions");
  const original=source.slice(scalar.range[0],scalar.range[1]);
  if(!/^[1-9][0-9]*$/.test(original)||Number(original)!==scalar.value)
    fail("Only plain decimal integers can be patched");
  return {doc,scalar,oldValue:scalar.value};
}
export function contractMaxActions(source,packageName){
  try{
    const {scalar,oldValue}=maxActionsModel(source,packageName);
    return {value:oldValue,line:source.slice(0,scalar.range[0]).split("\n").length};
  }catch{return null;}
}
export function previewContractMaxActionsPatch(source,packageName,newValue){
  if(!Number.isInteger(newValue)||newValue<1||newValue>128)
    fail("maxActions must be an integer from 1 to 128");
  const {doc,scalar,oldValue}=maxActionsModel(source,packageName);
  if(newValue===oldValue)fail("No change");
  const edit=replaceScalar(source,scalar,String(oldValue),String(newValue));
  const next=documentOf(edit.candidate);
  const beforeJS=doc.toJS();
  beforeJS.spec.planning.maxActions=newValue;
  if(JSON.stringify(beforeJS)!==JSON.stringify(next.toJS()))
    fail("Patch changed unrelated Contract content");
  return freezePreview({
    type:"SetMaxActions",profile:"contract-planning-number-v1",packageName,
    oldValue,newValue,baseSource:source,candidateSource:edit.candidate,
    sourceSpan:edit.span,line:edit.line,diff:edit.diff,
    summary:"planning.maxActions · "+oldValue+" → "+newValue
  });
}
export function applyContractMaxActionsPatch(source,preview){
  if(!preview||preview.type!=="SetMaxActions")fail("Unsupported Contract patch");
  if(source!==preview.baseSource)fail("Source revision changed");
  const expected=previewContractMaxActionsPatch(source,preview.packageName,preview.newValue);
  comparePreview(preview,expected);
  return expected.candidateSource;
}
