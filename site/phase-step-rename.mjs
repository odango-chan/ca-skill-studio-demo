import {parseDocument,isMap,isSeq,isScalar} from "yaml";
import {projectWorkspace} from "./workspace.mjs";
import {routeProjectionSignature} from "./route-create.mjs";

// D4-A3b2a: rename an existing named Step together with all proven output
// references. Unknown occurrences block Visual mutation; never infer Runtime.
const ID=/^[A-Za-z_][A-Za-z0-9_.-]*$/;
const STEP=/^[A-Za-z_][A-Za-z0-9_-]*$/;
const PHASES=new Set(["preconditions","postconditions"]);
const SUFFIX="(?:\\.[A-Za-z_][A-Za-z0-9_-]*)*";
const reject=message=>{throw Error(message);};
const freeze=Object.freeze;
const escapeRegex=value=>value.split("").map(c=>
  ".*+?^$()[]{}|\\".includes(c)?"\\"+c:c).join("");

function context(source,procedureId,nodeId){
  if(typeof source!=="string"||source.length>1024*1024||
    !ID.test(procedureId??"")||!ID.test(nodeId??""))
    reject("Invalid named Step identity or Source");
  const before=projectWorkspace(source);
  const proc=before.procedures.get(procedureId);
  const node=proc?.nodes.find(n=>n.id===nodeId);
  if(before.state!=="READY"||!node)reject("Procedure/Node is not projected");
  const doc=parseDocument(source,{version:"1.2",schema:"core",strict:true,
    uniqueKeys:true,stringKeys:true,keepSourceTokens:true,logLevel:"silent"});
  if(doc.errors.length)reject("Invalid or ambiguous YAML Source");
  return {source,procedureId,nodeId,before,proc,node,doc};
}
function named(ctx,phaseName,index){
  if(!PHASES.has(phaseName)||!Number.isInteger(index)||
     index<0||index>=80)reject("Invalid named Step selector");
  const phase=ctx.node.phases.find(p=>p.name===phaseName);
  const step=phase?.steps[index];
  const seq=ctx.doc.getIn(["procedures",ctx.procedureId,"nodes",
    ctx.nodeId,phaseName,"steps"],true);
  if(!phase||!isSeq(seq)||seq.items.length!==phase.steps.length||
     !step?.name||!STEP.test(step.name)||!isMap(seq.items[index]))
    reject("Named Step is missing or cannot be projected");
  const item=seq.items[index];
  const pair=item.items.find(x=>x.key?.value==="name");
  if(!pair||!isScalar(pair.key)||!isScalar(pair.value)||
     pair.value.value!==step.name||pair.value.anchor||pair.value.tag||
     pair.key.anchor||pair.key.tag||!Array.isArray(pair.value.range)||
     !Array.isArray(pair.key.range)||item.items[0]!==pair||
     ctx.source.slice(pair.key.range[0],pair.key.range[1])!=="name"||
     ctx.source.slice(pair.value.range[0],pair.value.range[1])!==step.name)
    reject("Quoted, anchored or non-leading Step name is Source-only");
  const start=pair.value.range[0],end=pair.value.range[1];
  const lineStart=ctx.source.lastIndexOf("\n",Math.max(0,start-1))+1;
  const newline=ctx.source.indexOf("\n",end);
  if(newline<0||!new RegExp(
      "^( {8,24})- name: "+escapeRegex(step.name)+"\\r?\\n$"
    ).test(ctx.source.slice(lineStart,newline+1)))
    reject("Named Step line is not a plain, unannotated Source line");
  return {phase,step,index,span:{start,end,kind:"identity"}};
}
function walkFrom(node,callback){
  if(isMap(node))for(const pair of node.items){
    if(pair.key?.value==="from")callback(pair.value);
    walkFrom(pair.value,callback);
  }
  else if(isSeq(node))for(const item of node.items)walkFrom(item,callback);
}
function collect(ctx,phaseName,index){
  const item=named(ctx,phaseName,index);
  const name=item.step.name;
  const names=[];
  for(const node of ctx.proc.nodes)
    for(const phase of node.phases)
      for(const step of phase.steps)
        if(step.name===name)names.push([node.id,phase.name,step.index]);
  if(names.length!==1)reject("Named Step is not unique in this Procedure");
  const nodeMap=ctx.doc.getIn(["procedures",ctx.procedureId,"nodes"],true);
  if(!isMap(nodeMap))reject("Procedure Nodes map is unavailable");
  const escaped=escapeRegex(name),p=phaseName;
  const local=new RegExp("^"+p+"\\."+escaped+"\\.output"+SUFFIX+"$");
  const qualified=new RegExp("^"+escapeRegex(ctx.nodeId)+"\\."+p+
    "\\."+escaped+"\\.output"+SUFFIX+"$");
  const spans=[item.span],refs=[];
  for(const pair of nodeMap.items){
    const consumerNodeId=pair.key?.value;
    if(!ID.test(consumerNodeId??""))reject("Ambiguous consumer Node identity");
    walkFrom(pair.value,scalar=>{
      if(!isScalar(scalar)||typeof scalar.value!=="string"||
         !scalar.value.includes(name))return;
      const value=scalar.value;
      const isLocal=consumerNodeId===ctx.nodeId&&local.test(value);
      const isQualified=qualified.test(value);
      if(!isLocal&&!isQualified)
        reject("Unqualified or unsupported reference to named Step: "+value);
      const startOfName=isLocal?p.length+1:
        ctx.nodeId.length+1+p.length+1;
      const range=scalar.range;
      if(!Array.isArray(range)||scalar.anchor||scalar.tag||
         ctx.source.slice(range[0],range[1])!==value||
         value.slice(startOfName,startOfName+name.length)!==name)
        reject("Quoted, aliased or modified from-reference is Source-only");
      const start=range[0]+startOfName,end=start+name.length;
      const line=ctx.source.slice(0,start).split("\n").length;
      spans.push({start,end,kind:"reference"});
      refs.push(freeze({consumerNodeId,value,line,
        spelling:isLocal?"LOCAL":"QUALIFIED"}));
    });
  }
  spans.sort((a,b)=>a.start-b.start);
  for(let i=1;i<spans.length;i++)
    if(spans[i].start<spans[i-1].end)
      reject("Overlapping Step reference Source ranges");
  // Closed-world byte audit: comments, other fields, other Procedures and
  // unrecognized reference spellings cannot be silently left dangling.
  const starts=new Set(spans.map(x=>x.start));
  let found=0;
  for(let at=ctx.source.indexOf(name);at!==-1;at=ctx.source.indexOf(name,at+name.length)){
    if(++found>400)reject("Too many Step name occurrences to audit");
    if(!starts.has(at))
      reject("Unrecognized Step name occurrence outside declared from/reference");
  }
  if(found!==spans.length)
    reject("Named Step reference count does not reconcile");
  return {name,spans,refs,phaseName,index,item};
}
export function namedPhaseStepImpactReport(source,procedureId,nodeId){
  try{
    const ctx=context(source,procedureId,nodeId),results=[];
    for(const phase of ctx.node.phases)
      for(let i=0;i<phase.steps.length;i++){
        const step=phase.steps[i];
        if(!step.name)continue;
        try{
          const report=collect(ctx,phase.name,i);
          results.push(freeze({phaseName:phase.name,stepIndex:i,
            stepName:report.name,operator:step.operator,status:"READY",
            referenceCount:report.refs.length,
            references:freeze(report.refs),editEligible:true,reason:null}));
        }catch(err){
          results.push(freeze({phaseName:phase.name,stepIndex:i,
            stepName:step.name,operator:step.operator,
            status:"BLOCKED",referenceCount:null,
            references:freeze([]),editEligible:false,
            reason:String(err?.message??err)}));
        }
      }
    return freeze(results);
  }catch{return freeze([]);}
}
function lineDiff(source,span,replacement){
  const a=source.lastIndexOf("\n",Math.max(0,span.start-1))+1;
  const endLine=source.indexOf("\n",span.end);
  const b=endLine<0?source.length:endLine;
  const before=source.slice(a,b).replace(/\r$/,"");
  const after=before.slice(0,span.start-a)+replacement+
    before.slice(span.end-a);
  const line=source.slice(0,a).split("\n").length;
  return "@@ -"+line+",1 +"+line+",1 @@\n-"+before+"\n+"+after;
}
function compute(source,procedureId,nodeId,phaseName,stepIndex,newName){
  if(!STEP.test(newName??""))reject("Invalid target Step name");
  const ctx=context(source,procedureId,nodeId);
  const report=collect(ctx,phaseName,stepIndex);
  if(report.name===newName||newName.includes(report.name)||
     source.includes(newName))
    reject("Target Step name is unchanged or collides with existing Source");
  const change=report.spans.map(span=>({
    start:span.start,end:span.end,kind:span.kind,
    oldValue:report.name,newValue:newName
  }));
  let candidateSource=source;
  for(const span of [...change].reverse()){
    if(candidateSource.slice(span.start,span.end)!==span.oldValue)
      reject("Source offset drifted during Step rename");
    candidateSource=candidateSource.slice(0,span.start)+newName+
      candidateSource.slice(span.end);
  }
  const after=projectWorkspace(candidateSource);
  if(after.state!=="READY")reject("Named Step rename cannot be projected");
  const expected=routeProjectionSignature(ctx.before);
  const step=expected.find(p=>p.name===procedureId)?.nodes
    .find(n=>n.id===nodeId)?.phases
    .find(p=>p.name===phaseName)?.steps[stepIndex];
  if(!step||step.name!==report.name)
    reject("Named Step source identity drifted");
  step.name=newName;
  if(JSON.stringify(expected)!==JSON.stringify(routeProjectionSignature(after)))
    reject("Step rename changed unrelated Procedure/Node/Route semantics");
  const checked=collect(context(candidateSource,procedureId,nodeId),
    phaseName,stepIndex);
  if(checked.name!==newName||checked.refs.length!==report.refs.length)
    reject("Updated Step references failed source reconciliation");
  const summary=nodeId+" / "+phaseName+" Step "+(stepIndex+1)+
    " · "+report.name+" → "+newName+"，同步更新 "+
    report.refs.length+" 处 from 引用；Runtime/5GC 未验证";
  return freeze({
    type:"RenameNamedPhaseStepAndReferences",
    profile:"d4-a3b2a-source-closed-name-rename-v1",
    procedureId,nodeId,phaseName,stepIndex,
    oldName:report.name,newName,
    referenceCount:report.refs.length,
    sourceSpans:freeze(change.map(span=>freeze(span))),
    baseSource:source,candidateSource,
    diff:change.map(span=>lineDiff(source,span,newName)).join("\n"),
    summary
  });
}
export function previewNamedPhaseStepRename(source,procedureId,nodeId,
                                             phaseName,stepIndex,newName){
  return compute(source,procedureId,nodeId,phaseName,stepIndex,newName);
}
export function applyNamedPhaseStepRename(source,preview){
  if(!preview||preview.type!=="RenameNamedPhaseStepAndReferences"||
     source!==preview.baseSource)
    reject("Stale or unsupported named Step rename preview");
  const expected=compute(source,preview.procedureId,preview.nodeId,
    preview.phaseName,preview.stepIndex,preview.newName);
  const keys=Object.keys(expected);
  if(Object.keys(preview).length!==keys.length||
     keys.some(key=>JSON.stringify(preview[key])!==JSON.stringify(expected[key])))
    reject("Named Step patch was forged or expired");
  return expected.candidateSource;
}
