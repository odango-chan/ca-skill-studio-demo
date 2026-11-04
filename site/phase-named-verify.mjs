import {parseDocument,isMap,isSeq,isScalar} from "yaml";
import {projectWorkspace} from "./workspace.mjs";
import {routeProjectionSignature} from "./route-create.mjs";
import {namedPhaseStepImpactReport} from "./phase-step-rename.mjs";

// D4-A3b2b1: only a plain Verify can acquire a Step name. Only a named
// Verify with zero Source-proven references can be deleted or swapped with an
// adjacent plain Verify. No Tool/Script/Procedure effects or general DAG edit.
const IDENT=/^[A-Za-z_][A-Za-z0-9_.-]*$/;
const NAME=/^[A-Za-z_][A-Za-z0-9_-]*$/;
const PHASES=new Set(["preconditions","postconditions"]);
const fail=x=>{throw Error(x);};
const freeze=Object.freeze;
function context(source,procedureId,nodeId){
  if(typeof source!=="string"||source.length>1024*1024||
    !IDENT.test(procedureId??"")||!IDENT.test(nodeId??""))
    fail("Invalid Procedure or Source");
  const before=projectWorkspace(source);
  const proc=before.procedures.get(procedureId);
  const node=proc?.nodes.find(x=>x.id===nodeId);
  if(before.state!=="READY"||!node)fail("Procedure/Node projection is not ready");
  const doc=parseDocument(source,{version:"1.2",schema:"core",strict:true,
    stringKeys:true,uniqueKeys:true,keepSourceTokens:true,logLevel:"silent"});
  if(doc.errors.length)fail("Ambiguous YAML document");
  return {source,procedureId,nodeId,before,node,doc};
}
function lineFor(ctx,phaseName,index){
  if(!PHASES.has(phaseName)||!Number.isInteger(index)||index<0||index>=80)
    fail("Invalid Phase selector");
  const phase=ctx.node.phases.find(x=>x.name===phaseName);
  const seq=ctx.doc.getIn(["procedures",ctx.procedureId,"nodes",
    ctx.nodeId,phaseName,"steps"],true);
  if(!phase||!isSeq(seq)||seq.items.length!==phase.steps.length||
     index>=seq.items.length||!isMap(seq.items[index]))
    fail("Phase Step list is missing or changed");
  const step=phase.steps[index],ast=seq.items[index];
  if(step.operator!=="verify"||
     ast.items.length!==(step.name?2:1))
    fail("Only a named or unnamed plain Verify is eligible");
  if(step.name&&(!NAME.test(step.name)||
       ast.items[0].key?.value!=="name"))
    fail("Named Step has unknown name or key ordering");
  const valuePair=ast.items[step.name?1:0];
  if(valuePair?.key?.value!=="verify"||
     !isScalar(valuePair.key)||!isScalar(valuePair.value)||
     valuePair.value.value!==step.value||
     typeof step.value!=="string"||!IDENT.test(step.value)||
     !Array.isArray(valuePair.key.range)||
     !Array.isArray(valuePair.value.range)||
     ctx.source.slice(valuePair.key.range[0],valuePair.key.range[1])!=="verify"||
     ctx.source.slice(valuePair.value.range[0],valuePair.value.range[1])!==step.value||
     valuePair.value.anchor||valuePair.value.tag)
    fail("Verify is quoted, tagged or structurally unknown");
  const valuePos=valuePair.value.range[0];
  const valueStart=ctx.source.lastIndexOf("\n",Math.max(0,valuePos-1))+1;
  const valueEndLine=ctx.source.indexOf("\n",valuePos);
  if(valueEndLine<0)fail("Verify must have a terminating newline");
  const valueRaw=ctx.source.slice(valueStart,valueEndLine+1);
  let start=valueStart,raw=valueRaw,indent;
  if(step.name){
    const namePair=ast.items[0],key=namePair.key,val=namePair.value;
    if(!isScalar(key)||!isScalar(val)||val.value!==step.name||
       !Array.isArray(key.range)||!Array.isArray(val.range)||
       key.anchor||key.tag||val.anchor||val.tag||
       ctx.source.slice(key.range[0],key.range[1])!=="name"||
       ctx.source.slice(val.range[0],val.range[1])!==step.name)
      fail("Named Verify must have a plain name");
    const nameStart=ctx.source.lastIndexOf("\n",Math.max(0,val.range[0]-1))+1;
    const nameRaw=ctx.source.slice(nameStart,valueStart);
    const m=/^( {8,24})- name: ([A-Za-z_][A-Za-z0-9_-]*)\r?\n$/.exec(nameRaw);
    if(!m||m[2]!==step.name||!new RegExp("^ {"+(m[1].length+2)+
      "}verify: [A-Za-z_][A-Za-z0-9_.-]*\\r?\\n$").test(valueRaw))
      fail("Named Verify must be exactly two plain adjacent YAML lines");
    indent=m[1];start=nameStart;raw=nameRaw+valueRaw;
  }else{
    const m=/^( {8,24})- verify: ([A-Za-z_][A-Za-z0-9_.-]*)\r?\n$/.exec(valueRaw);
    if(!m||m[2]!==step.value)
      fail("Unnamed Verify must be a plain single YAML line");
    indent=m[1];
  }
  const end=valueEndLine+1;
  const previous=ctx.source.slice(0,start).split(/\r?\n/).at(-2)??"";
  const next=ctx.source.slice(end).split("\n",1)[0]??"";
  if(!previous.trim()||previous.trimStart().startsWith("#")||
     !next.trim()||next.trimStart().startsWith("#"))
    fail("Adjacent comment or blank line has ambiguous ownership");
  const nextIndent=/^( *)/.exec(next)[1].length;
  if(nextIndent>indent.length)
    fail("Unexpected content nested after Verify");
  return {step,index,start,end,raw,indent,
    newline:raw.endsWith("\r\n")?"\r\n":"\n"};
}
function noReferences(ctx,phaseName,loc){
  if(!loc.step.name)return;
  const impact=namedPhaseStepImpactReport(ctx.source,ctx.procedureId,ctx.nodeId)
    .find(x=>x.phaseName===phaseName&&x.stepIndex===loc.index);
  if(!impact||!impact.editEligible||impact.referenceCount!==0)
    fail("Named Step has Source references or an unqualified name occurrence");
}
function signature(ctx,phaseName,change,index,name){
  const expected=routeProjectionSignature(ctx.before);
  const phase=expected.find(x=>x.name===ctx.procedureId)?.nodes
    .find(x=>x.id===ctx.nodeId)?.phases.find(x=>x.name===phaseName);
  if(!phase)fail("Target Phase cannot be found in structural signature");
  const list=phase.steps;
  if(change==="name")list[index].name=name;
  else if(change==="delete")list.splice(index,1);
  else if(change==="swap"){
    [list[index],list[index+1]]=[list[index+1],list[index]];
  }else fail("Unrecognized named Verify mutation");
  list.forEach((s,i)=>{s.index=i+1;});
  return JSON.stringify(expected);
}
function checkCandidate(ctx,candidate,phaseName,change,index,name){
  const after=projectWorkspace(candidate);
  if(after.state!=="READY"||
     signature(ctx,phaseName,change,index,name)!==
       JSON.stringify(routeProjectionSignature(after)))
    fail("Edited Source changed an unrelated Procedure, Step or Route");
  return after;
}
function eligibleName(ctx,phaseName,index){
  const loc=lineFor(ctx,phaseName,index);
  if(loc.step.name)fail("Cannot name an already named Step");
  return loc;
}
function eligibleDeletion(ctx,phaseName,index){
  const loc=lineFor(ctx,phaseName,index);
  if(!loc.step.name)fail("Delete of unnamed Verify uses the existing editor");
  const phase=ctx.node.phases.find(x=>x.name===phaseName);
  if(phase.steps.length<=1)fail("Cannot leave a Phase with no Steps");
  noReferences(ctx,phaseName,loc);
  return loc;
}
function eligibleSwap(ctx,phaseName,index){
  const left=lineFor(ctx,phaseName,index);
  const right=lineFor(ctx,phaseName,index+1);
  if(!left.step.name&&!right.step.name)
    fail("Use existing unnamed Verify reorder");
  if(left.step.value===right.step.value||
     left.end!==right.start||left.indent!==right.indent||
     left.newline!==right.newline)
    fail("Only distinct, physically adjacent Verifies may be swapped");
  noReferences(ctx,phaseName,left);
  noReferences(ctx,phaseName,right);
  return {left,right};
}
function namePreview(source,procedureId,nodeId,phaseName,index,newName){
  if(!NAME.test(newName??""))fail("Invalid new Step name");
  const ctx=context(source,procedureId,nodeId),loc=eligibleName(ctx,phaseName,index);
  if(source.includes(newName))
    fail("New Step name collides with existing Source");
  const prefix=loc.indent,child=" ".repeat(prefix.length+2);
  const next=prefix+"- name: "+newName+loc.newline+
    child+"verify: "+loc.step.value+loc.newline;
  const candidateSource=source.slice(0,loc.start)+next+source.slice(loc.end);
  checkCandidate(ctx,candidateSource,phaseName,"name",index,newName);
  const impact=namedPhaseStepImpactReport(candidateSource,procedureId,nodeId)
    .find(x=>x.phaseName===phaseName&&x.stepIndex===index);
  if(!impact||!impact.editEligible||impact.referenceCount!==0)
    fail("New name cannot be reconciled as an independent Verify");
  const line=source.slice(0,loc.start).split("\n").length;
  return freeze({type:"NamePlainPhaseVerify",profile:"d4-a3b2b1-verify-name-v1",
    procedureId,nodeId,phaseName,stepIndex:index,newName,
    oldPredicate:loc.step.value,baseSource:source,candidateSource,
    sourceSpan:freeze({start:loc.start,end:loc.end}),
    diff:"@@ -"+line+",1 +"+line+",2 @@\n-"+loc.raw.trimEnd()+
      "\n+"+next.trimEnd().split(/\r?\n/).join("\n+"),
    summary:"命名 "+nodeId+" / "+phaseName+" Verify 为 "+newName+
      "；仅更改 Step 身份，Runtime/5GC 未验证"});
}
function deletePreview(source,procedureId,nodeId,phaseName,index){
  const ctx=context(source,procedureId,nodeId);
  const loc=eligibleDeletion(ctx,phaseName,index);
  const candidateSource=source.slice(0,loc.start)+source.slice(loc.end);
  checkCandidate(ctx,candidateSource,phaseName,"delete",index);
  const line=source.slice(0,loc.start).split("\n").length;
  return freeze({type:"DeleteUnreferencedNamedVerify",
    profile:"d4-a3b2b1-verify-delete-v1",
    procedureId,nodeId,phaseName,stepIndex:index,stepName:loc.step.name,
    oldPredicate:loc.step.value,referenceCount:0,
    baseSource:source,candidateSource,
    sourceSpan:freeze({start:loc.start,end:loc.end}),
    diff:"@@ -"+line+",2 +"+line+",0 @@\n-"+
      loc.raw.trimEnd().split(/\r?\n/).join("\n-"),
    summary:"删除 "+nodeId+" / "+phaseName+" 的命名 Verify "+
      loc.step.name+"；0 处输出引用；业务门禁可能改变；Runtime/5GC 未验证"});
}
function swapPreview(source,procedureId,nodeId,phaseName,index){
  const ctx=context(source,procedureId,nodeId);
  const {left,right}=eligibleSwap(ctx,phaseName,index);
  const candidateSource=source.slice(0,left.start)+right.raw+left.raw+
    source.slice(right.end);
  checkCandidate(ctx,candidateSource,phaseName,"swap",index);
  const a=left.raw.trimEnd().split(/\r?\n/),b=right.raw.trimEnd().split(/\r?\n/);
  const line=source.slice(0,left.start).split("\n").length;
  return freeze({type:"SwapAdjacentNamedVerify",profile:"d4-a3b2b1-verify-swap-v1",
    procedureId,nodeId,phaseName,stepIndex:index,
    first:left.step.name||left.step.value,second:right.step.name||right.step.value,
    baseSource:source,candidateSource,
    sourceSpan:freeze({start:left.start,end:right.end}),
    diff:"@@ -"+line+","+(a.length+b.length)+" +"+line+","+
      (a.length+b.length)+" @@\n-"+[...a,...b].join("\n-")+
      "\n+"+[...b,...a].join("\n+"),
    summary:"交换 "+nodeId+" / "+phaseName+" 相邻 Verify 顺序；"+
      "命名输出引用均为 0；运行时失败短路顺序可能变化；Runtime/5GC 未验证"});
}
export function namedVerifyEditOptions(source,procedureId,nodeId){
  try{
    const ctx=context(source,procedureId,nodeId),names=[],deletions=[],swaps=[];
    for(const phase of ctx.node.phases){
      for(let i=0;i<phase.steps.length;i++){
        try{
          const x=eligibleName(ctx,phase.name,i);
          names.push(freeze({phaseName:phase.name,stepIndex:i,
            predicate:x.step.value}));
        }catch{/* only qualified unnamed Verify is nameable */}
        try{
          const x=eligibleDeletion(ctx,phase.name,i);
          deletions.push(freeze({phaseName:phase.name,stepIndex:i,
            stepName:x.step.name}));
        }catch{/* blocked named effects and referenced Verifies */}
        if(i+1<phase.steps.length)try{
          const {left,right}=eligibleSwap(ctx,phase.name,i);
          swaps.push(freeze({phaseName:phase.name,stepIndex:i,
            first:left.step.name||left.step.value,
            second:right.step.name||right.step.value}));
        }catch{/* blocked pair */}
      }
    }
    return freeze({names:freeze(names),deletions:freeze(deletions),
      swaps:freeze(swaps)});
  }catch{return freeze({names:freeze([]),deletions:freeze([]),swaps:freeze([])});}
}
export function previewNamePlainVerify(source,procedureId,nodeId,
                                       phaseName,index,newName){
  return namePreview(source,procedureId,nodeId,phaseName,index,newName);
}
export function previewDeleteUnreferencedNamedVerify(source,procedureId,nodeId,
                                                      phaseName,index){
  return deletePreview(source,procedureId,nodeId,phaseName,index);
}
export function previewSwapAdjacentNamedVerify(source,procedureId,nodeId,
                                                phaseName,index){
  return swapPreview(source,procedureId,nodeId,phaseName,index);
}
function apply(source,preview,type,compute){
  if(!preview||preview.type!==type||source!==preview.baseSource)
    fail("Stale or unsupported named Verify preview");
  const expected=compute(source,preview.procedureId,preview.nodeId,
    preview.phaseName,preview.stepIndex,
    preview.newName);
  const keys=Object.keys(expected);
  if(Object.keys(preview).length!==keys.length||
     keys.some(k=>JSON.stringify(preview[k])!==JSON.stringify(expected[k])))
    fail("Named Verify preview was changed or expired");
  return expected.candidateSource;
}
export const applyNamePlainVerify=(s,p)=>apply(s,p,"NamePlainPhaseVerify",namePreview);
export const applyDeleteUnreferencedNamedVerify=(s,p)=>
  apply(s,p,"DeleteUnreferencedNamedVerify",deletePreview);
export const applySwapAdjacentNamedVerify=(s,p)=>
  apply(s,p,"SwapAdjacentNamedVerify",swapPreview);
