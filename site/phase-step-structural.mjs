import {parseDocument,isMap,isSeq,isScalar} from "yaml";
import {projectWorkspace} from "./workspace.mjs";
import {routeProjectionSignature} from "./route-create.mjs";

// D4-A3b1: bounded editor-tier addition/removal of one unnamed, unbound,
// single-line verify Step in an EXISTING Phase.steps list. No Runtime claim.
// All writes are original Source spans; never dump/reformat the YAML document.
const IDENT=/^[A-Za-z_][A-Za-z0-9_.-]*$/;
const PHASES=new Set(["preconditions","postconditions"]);
const fail=message=>{throw Error(message);};
const freeze=Object.freeze;

function setup(source,procedureId,nodeId){
  if(typeof source!=="string"||source.length>1024*1024||
     !IDENT.test(procedureId??"")||!IDENT.test(nodeId??""))
    fail("Invalid Phase source or selected identity");
  const before=projectWorkspace(source);
  const proc=before.procedures.get(procedureId);
  const node=proc?.nodes.find(item=>item.id===nodeId);
  if(before.state!=="READY"||!node)fail("Procedure/Node is not projected");
  const doc=parseDocument(source,{version:"1.2",schema:"core",strict:true,
    uniqueKeys:true,stringKeys:true,keepSourceTokens:true,logLevel:"silent"});
  if(doc.errors.length)fail("YAML Source cannot be parsed unambiguously");
  return {source,procedureId,nodeId,before,proc,node,doc};
}
function steps(ctx,phaseName){
  if(!PHASES.has(phaseName))fail("Invalid Phase");
  const phase=ctx.node.phases.find(p=>p.name===phaseName);
  if(!phase)fail("The selected Phase has no authored Steps");
  const seq=ctx.doc.getIn(["procedures",ctx.procedureId,"nodes",
    ctx.nodeId,phaseName,"steps"],true);
  if(!isSeq(seq)||!seq.items.length||seq.items.length!==phase.steps.length||
     seq.items.length>80)fail("Step list is absent, empty or ambiguous");
  return {phase,seq};
}
function lineFor(ctx,phaseName,index){
  const {phase,seq}=steps(ctx,phaseName);
  if(!Number.isInteger(index)||index<0||index>=phase.steps.length)
    fail("Step selector is outside the authored list");
  const step=phase.steps[index],ast=seq.items[index];
  if(step?.operator!=="verify"||step.name||!isMap(ast)||
     ast.items.length!==1||ast.items[0]?.key?.value!=="verify")
    fail("Only unnamed, unbound Verify Steps may be edited structurally");
  const key=ast.items[0].key,val=ast.items[0].value;
  if(!isScalar(key)||!isScalar(val)||key.anchor||key.tag||
     val.anchor||val.tag||typeof val.value!=="string"||
     val.value!==step.value||!IDENT.test(step.value)||
     !Array.isArray(key.range)||!Array.isArray(val.range)||
     ctx.source.slice(key.range[0],key.range[1])!=="verify"||
     ctx.source.slice(val.range[0],val.range[1])!==step.value)
    fail("Step is not a plain Source-authored Verify");
  const scalarStart=val.range[0];
  const start=ctx.source.lastIndexOf("\n",Math.max(0,scalarStart-1))+1;
  const newline=ctx.source.indexOf("\n",scalarStart);
  if(newline<0)fail("Step must end with a newline");
  const raw=ctx.source.slice(start,newline+1);
  const match=/^( {8,24})- verify: ([A-Za-z_][A-Za-z0-9_.-]*)\r?\n$/.exec(raw);
  if(!match||match[2]!==step.value)
    fail("Quoted, annotated, multiline or tagged Verify is Source-only");
  const previous=ctx.source.slice(0,start).split(/\r?\n/).at(-2)??"";
  const next=ctx.source.slice(newline+1).split("\n",1)[0]??"";
  if(!previous.trim()||previous.trimStart().startsWith("#")||
     !next.trim()||next.trimStart().startsWith("#"))
    fail("Ambiguous adjoining comment/blank-line ownership");
  return {phase,seq,step,start,end:newline+1,raw,
    indent:match[1],newline:raw.endsWith("\r\n")?"\r\n":"\n",next};
}
function endAnchor(ctx,phaseName){
  const {phase}=steps(ctx,phaseName);
  if(phase.steps.length>=80)fail("Step limit reached");
  const last=lineFor(ctx,phaseName,phase.steps.length-1);
  // Require immediate transition to a less-indented mapping sibling,
  // without comments or whitespace that could belong to the old last Step.
  const m=/^( *)(\S.*)$/.exec(last.next.replace(/\r$/,""));
  if(!m||m[1].length>=last.indent.length||m[2].startsWith("-"))
    fail("Cannot prove a safe insertion boundary after Phase Steps");
  return {last,stepIndex:phase.steps.length};
}
function predicateCatalog(source,skillName){
  if(typeof source!=="string"||source.length>1024*1024||
     !IDENT.test(skillName??""))
    fail("Missing pinned Package PredicateSet");
  const doc=parseDocument(source,{version:"1.2",schema:"core",strict:true,
    uniqueKeys:true,stringKeys:true,keepSourceTokens:true,logLevel:"silent"});
  if(doc.errors.length||doc.get("kind")!=="PredicateSet"||
     doc.getIn(["metadata","skill"])!==skillName)
    fail("PredicateSet metadata does not match current Package");
  const predicates=doc.get("predicates",true);
  if(!isMap(predicates)||!predicates.items.length)fail("No authoritative predicates");
  const names=[];
  for(const pair of predicates.items){
    const name=pair.key?.value;
    if(!isScalar(pair.key)||!IDENT.test(name??"")||
       !Array.isArray(pair.key.range)||
       source.slice(pair.key.range[0],pair.key.range[1])!==name||
       !isMap(pair.value))fail("Ambiguous predicate declaration");
    names.push(name);
  }
  return names.sort();
}
function expectedProjection(ctx,phaseName,operation,index,value){
  const signature=routeProjectionSignature(ctx.before);
  const node=signature.find(p=>p.name===ctx.procedureId)?.nodes
    .find(n=>n.id===ctx.nodeId);
  const phase=node?.phases.find(p=>p.name===phaseName);
  if(!phase)fail("Target Phase disappeared");
  if(operation==="add"){
    phase.steps.push({index:index+1,name:"",operator:"verify",value});
  }else{
    phase.steps.splice(index,1);
  }
  phase.steps.forEach((step,i)=>{step.index=i+1;});
  return JSON.stringify(signature);
}
function verifyCandidate(ctx,candidate,phaseName,operation,index,value){
  const after=projectWorkspace(candidate);
  if(after.state!=="READY"||
     expectedProjection(ctx,phaseName,operation,index,value)!==
       JSON.stringify(routeProjectionSignature(after)))
    fail("Structural mutation touched an unrelated Step, Node, Route or Procedure");
}
function addPreview(source,procedureId,nodeId,phaseName,value,predSource,skillName){
  if(!IDENT.test(value??""))fail("Invalid predicate name");
  const ctx=setup(source,procedureId,nodeId);
  const {phase}=steps(ctx,phaseName);
  if(!predicateCatalog(predSource,skillName).includes(value))
    fail("Predicate is not declared by the active Package");
  if(phase.steps.some(step=>step.operator==="verify"&&step.value===value))
    fail("The Phase already contains this Verify");
  const {last,stepIndex}=endAnchor(ctx,phaseName);
  const newLine=last.indent+"- verify: "+value+last.newline;
  const start=last.end, candidateSource=source.slice(0,start)+
    newLine+source.slice(start);
  verifyCandidate(ctx,candidateSource,phaseName,"add",stepIndex,value);
  const line=source.slice(0,start).split("\n").length;
  return freeze({type:"AddPhaseVerifyStep",profile:"d4-a3b1-verify-add-v1",
    procedureId,nodeId,phaseName,stepIndex,skillName,
    predicate:value,basePredicateSource:predSource,
    baseSource:source,candidateSource,
    sourceSpan:freeze({start,end:start}),
    diff:"@@ -"+(line-1)+",0 +"+line+",1 @@\n+"+newLine.trimEnd(),
    summary:"新增 "+nodeId+" / "+phaseName+" 最末尾 Verify · "+value+
      "；改变业务检查集合；Runtime/5GC 未验证"});
}
function deletePreview(source,procedureId,nodeId,phaseName,stepIndex){
  const ctx=setup(source,procedureId,nodeId);
  const {phase}=steps(ctx,phaseName);
  if(phase.steps.length<2)fail("Cannot leave an empty Steps YAML sequence");
  const target=lineFor(ctx,phaseName,stepIndex);
  if(phase.steps.filter(step=>step.operator==="verify"&&
       step.value===target.step.value).length!==1)
    fail("Duplicate Verify predicate in this Phase is ambiguous");
  const start=target.start,end=target.end;
  const candidateSource=source.slice(0,start)+source.slice(end);
  verifyCandidate(ctx,candidateSource,phaseName,"delete",stepIndex,target.step.value);
  const line=source.slice(0,start).split("\n").length;
  return freeze({type:"DeletePhaseVerifyStep",profile:"d4-a3b1-verify-delete-v1",
    procedureId,nodeId,phaseName,stepIndex,
    predicate:target.step.value,baseSource:source,candidateSource,
    sourceSpan:freeze({start,end}),
    diff:"@@ -"+line+",1 +"+line+",0 @@\n-"+target.raw.trimEnd(),
    summary:"删除 "+nodeId+" / "+phaseName+" Step "+(stepIndex+1)+
      " · "+target.step.value+
      "；改变业务检查集合与失败门禁；Runtime/5GC 未验证"});
}
export function phaseVerifyAddOptions(source,procedureId,nodeId,
                                      predicateSource,skillName){
  try{
    const ctx=setup(source,procedureId,nodeId);
    const names=predicateCatalog(predicateSource,skillName);
    const options=[];
    for(const phase of ctx.node.phases){
      try{
        const {stepIndex}=endAnchor(ctx,phase.name);
        const available=names.filter(name=>!phase.steps.some(step=>
          step.operator==="verify"&&step.value===name));
        if(available.length)options.push(freeze({phaseName:phase.name,
          stepIndex,choices:freeze(available)}));
      }catch{/* complex tail remains Source-only */}
    }
    return freeze(options);
  }catch{return freeze([]);}
}
export function phaseVerifyDeleteOptions(source,procedureId,nodeId){
  try{
    const ctx=setup(source,procedureId,nodeId),options=[];
    for(const phase of ctx.node.phases){
      if(phase.steps.length<2)continue;
      for(let i=0;i<phase.steps.length;i++){
        try{
          const {step}=lineFor(ctx,phase.name,i);
          // Require this exact source mutation to reproject, not just syntax.
          deletePreview(source,procedureId,nodeId,phase.name,i);
          options.push(freeze({phaseName:phase.name,stepIndex:i,
            predicate:step.value}));
        }catch{/* fail closed */}
      }
    }
    return freeze(options);
  }catch{return freeze([]);}
}
export function previewAddPhaseVerify(source,procedureId,nodeId,phaseName,
                                      predicate,predicateSource,skillName){
  return addPreview(source,procedureId,nodeId,phaseName,
    predicate,predicateSource,skillName);
}
export function applyAddPhaseVerify(source,preview,predicateSource){
  if(!preview||preview.type!=="AddPhaseVerifyStep"||
     source!==preview.baseSource||
     predicateSource!==preview.basePredicateSource)
    fail("Stale Package or Source for Verify creation");
  const expected=addPreview(source,preview.procedureId,preview.nodeId,
    preview.phaseName,preview.predicate,predicateSource,preview.skillName);
  checkPreview(expected,preview);
  return expected.candidateSource;
}
export function previewDeletePhaseVerify(source,procedureId,nodeId,
                                         phaseName,stepIndex){
  return deletePreview(source,procedureId,nodeId,phaseName,stepIndex);
}
export function applyDeletePhaseVerify(source,preview){
  if(!preview||preview.type!=="DeletePhaseVerifyStep"||
     source!==preview.baseSource)
    fail("Stale or unsupported Phase deletion");
  const expected=deletePreview(source,preview.procedureId,preview.nodeId,
    preview.phaseName,preview.stepIndex);
  checkPreview(expected,preview);
  return expected.candidateSource;
}
function checkPreview(expected,actual){
  const keys=Object.keys(expected);
  if(Object.keys(actual).length!==keys.length||
     keys.some(key=>JSON.stringify(actual[key])!==JSON.stringify(expected[key])))
    fail("Phase Step preview was modified or expired");
}
