import {parseDocument,isScalar} from "yaml";
import {projectWorkspace} from "./workspace.mjs";
import {predicateChoices} from "./attribute-patch.mjs";

// Source-authoritative scoped edits for the real CreatedSession profile.
// These patches check syntax and structural isolation, NOT 3GPP/business validity.
const fail=msg=>{throw new Error(msg);};
const NAME=/^[A-Za-z_][A-Za-z0-9_.-]*$/;
function modelOf(source,skillName){
  if(skillName!=="establish-pdu-session")fail("Not a qualified CreatedSession asset");
  const model=projectWorkspace(source);
  if(model.state!=="READY"||model.procedures.size!==6||
     model.entry!=="ue-requested-pdu-session-establishment")
    fail("Source is not the pinned CreatedSession Procedure profile");
  return model;
}
function predicateSet(source,name){
  const doc=parseDocument(source,{version:"1.2",strict:true,uniqueKeys:true,logLevel:"silent"});
  if(doc.errors.length||doc.get("kind")!=="PredicateSet"||
     doc.getIn(["metadata","skill"])!==name)
    fail("Predicate set is not from this active Package");
  return predicateChoices(source);
}
function getScalar(text,path){
  const doc=parseDocument(text,{version:"1.2",strict:true,
    schema:"core",keepSourceTokens:true,uniqueKeys:true,logLevel:"silent"});
  if(doc.errors.length)fail("Source parse failed");
  const node=doc.getIn(path,true);
  if(!isScalar(node)||typeof node.value!=="string"||!node.range)fail("Scalar span absent");
  const [start,end]=node.range;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start||
     text.slice(start,end)!==node.value)fail("Quoted, aliased or non-plain Scalar is not editable");
  return {start,end,value:node.value};
}
function isolatedChange(text,span,from,to){
  if(from===to||!NAME.test(to))fail("No valid edit");
  if(span.value!==from)fail("Current value drift");
  const next=text.slice(0,span.start)+to+text.slice(span.end);
  const lineStart=text.lastIndexOf("\n",Math.max(0,span.start-1))+1;
  const lineEnd=text.indexOf("\n",span.end);
  const oldLine=text.slice(lineStart,lineEnd===-1?text.length:lineEnd).replace(/\r$/,"");
  const newLine=oldLine.slice(0,span.start-lineStart)+to+oldLine.slice(span.end-lineStart);
  const line=text.slice(0,span.start).split("\n").length;
  return {candidateSource:next,sourceSpan:Object.freeze({start:span.start,end:span.end}),
    line,diff:"@@ -"+line+",1 +"+line+",1 @@\n-"+oldLine+"\n+"+newLine};
}
function semanticModel(model){
  return [...model.procedures.values()].map(p=>({
    name:p.name,start:p.start,
    nodes:p.nodes.map(n=>({
      id:n.id,operator:n.operator,value:n.value,children:n.children,
      phases:n.phases.map(phase=>({
        name:phase.name,steps:phase.steps.map(step=>({
          name:step.name,operator:step.operator,value:step.value
        }))
      }))
    })),
    routes:p.routes.map(r=>({
      id:r.id,source:r.source,outcome:r.outcome,target:r.target,routeSource:r.routeSource
    }))
  }));
}
function isolatedSemanticChange(before,after,modifyExpected){
  const expected=semanticModel(before),actual=semanticModel(after);
  modifyExpected(expected);
  if(JSON.stringify(expected)!==JSON.stringify(actual))
    fail("Patch affected unrelated Procedure, Node, Step or Route");
}
function checkPreview(input,expected){
  if(!input||input.type!==expected.type)fail("Unsupported Patch Preview");
  for(const key of Object.keys(expected)){
    if(key==="sourceSpan"){
      if(!input.sourceSpan||input.sourceSpan.start!==expected.sourceSpan.start||
         input.sourceSpan.end!==expected.sourceSpan.end)fail("Patch source span mismatch");
    }else if(input[key]!==expected[key])fail("Patch preview is stale or modified");
  }
}
function phaseStep(source,skillName,procedureId,nodeId,phaseName,stepIndex) {
  const model=modelOf(source,skillName);
  if(!NAME.test(procedureId)||!NAME.test(nodeId)||
     !["preconditions","postconditions"].includes(phaseName)||
     !Number.isInteger(stepIndex)||stepIndex<0||stepIndex>79)fail("Invalid Step selector");
  const procedure=model.procedures.get(procedureId);
  const node=procedure?.nodes.find(n=>n.id===nodeId);
  const phase=node?.phases.find(p=>p.name===phaseName);
  const step=phase?.steps[stepIndex];
  if(step?.operator!=="verify")fail("Selected Step is not a Verify Predicate");
  return {model,step};
}
export function phaseVerifyChoices(source,skillName,procedureId,nodeId,phaseName,stepIndex,predicateSource){
  try{
    const {step}=phaseStep(source,skillName,procedureId,nodeId,phaseName,stepIndex);
    const choices=predicateSet(predicateSource,skillName);
    return choices.includes(step.value)?choices:[];
  }catch{return [];}
}
export function previewPhaseVerifyPatch(source,skillName,procedureId,nodeId,phaseName,stepIndex,value,predicateSource){
  if(!NAME.test(value))fail("Invalid Predicate name");
  const {model,step}=phaseStep(source,skillName,procedureId,nodeId,phaseName,stepIndex);
  if(!predicateSet(predicateSource,skillName).includes(value))fail("Predicate not in active Package");
  const span=getScalar(source,["procedures",procedureId,"nodes",nodeId,
    phaseName,"steps",stepIndex,"verify"]);
  const edit=isolatedChange(source,span,step.value,value);
  const after=modelOf(edit.candidateSource,skillName);
  isolatedSemanticChange(model,after,items=>{
    const node=items.find(p=>p.name===procedureId).nodes.find(n=>n.id===nodeId);
    node.phases.find(p=>p.name===phaseName).steps[stepIndex].value=value;
  });
  return Object.freeze({
    type:"SetPhaseVerify",profile:"createdsession-phase-verify-v1",
    skillName,procedureId,nodeId,phaseName,stepIndex,
    oldValue:step.value,newValue:value,baseSource:source,...edit,
    summary:nodeId+" / "+phaseName+" / Verify · "+step.value+" → "+value
  });
}
export function applyPhaseVerifyPatch(source,preview,predicateSource){
  if(!preview||preview.type!=="SetPhaseVerify")fail("Unsupported Verify Patch");
  if(source!==preview.baseSource)fail("Source revision changed");
  const expected=previewPhaseVerifyPatch(source,preview.skillName,preview.procedureId,
    preview.nodeId,preview.phaseName,preview.stepIndex,preview.newValue,predicateSource);
  checkPreview(preview,expected);
  return expected.candidateSource;
}
function routeModel(source,skillName,procedureId,routeId){
  const model=modelOf(source,skillName);
  const procedure=model.procedures.get(procedureId);
  const route=procedure?.routes.find(r=>r.id===routeId);
  if(!route||!route.patchable||!route.sourceSpan)fail("Route cannot be safely patched");
  return {model,procedure,route};
}
export function createdRouteTargets(source,skillName,procedureId,routeId){
  try{
    const {procedure}=routeModel(source,skillName,procedureId,routeId);
    return procedure.nodes.map(n=>n.id);
  }catch{return [];}
}
export function previewCreatedRoutePatch(source,skillName,procedureId,routeId,target){
  if(!NAME.test(target))fail("Invalid target");
  const {model,procedure,route}=routeModel(source,skillName,procedureId,routeId);
  if(!procedure.nodes.some(n=>n.id===target))fail("Target is not a Node in this Procedure");
  const phase=route.routeSource==="operator.on"?"on":
    route.routeSource==="preconditions.on"?"preconditions":
    route.routeSource==="postconditions.on"?"postconditions":null;
  if(!phase)fail("Unsupported Route origin");
  const path=["procedures",procedureId,"nodes",route.source];
  if(phase!=="on")path.push(phase);
  path.push("on",route.outcome);
  const span=getScalar(source,path);
  const edit=isolatedChange(source,span,route.target,target);
  const after=modelOf(edit.candidateSource,skillName);
  isolatedSemanticChange(model,after,items=>{
    items.find(p=>p.name===procedureId).routes.find(r=>r.id===routeId).target=target;
  });
  return Object.freeze({
    type:"SetCreatedRouteTarget",profile:"createdsession-route-target-v1",
    skillName,procedureId,routeId,oldValue:route.target,newValue:target,
    baseSource:source,...edit,
    summary:route.source+" · "+route.outcome+" → "+target
  });
}
export function applyCreatedRoutePatch(source,preview){
  if(!preview||preview.type!=="SetCreatedRouteTarget")fail("Unsupported Route Patch");
  if(source!==preview.baseSource)fail("Source revision changed");
  const expected=previewCreatedRoutePatch(source,preview.skillName,preview.procedureId,
    preview.routeId,preview.newValue);
  checkPreview(preview,expected);
  return expected.candidateSource;
}
