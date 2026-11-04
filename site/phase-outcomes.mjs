import {parseDocument,isMap,isScalar} from "yaml";
import {projectWorkspace} from "./workspace.mjs";
import {routeProjectionSignature} from "./route-create.mjs";

// D4-A4b1. Source-bound recovery of missing *observed* Phase outcomes.
// Runtime may have other outcomes: an unrecognized key is not "invalid" merely
// because it is absent from this small editor profile. Noncore keys can only
// be renamed/deleted under additional evidence and explicit Diff consent.
const ID=/^[A-Za-z_][A-Za-z0-9_.-]*$/;
const OUTCOME=/^[A-Z][A-Z0-9_]*$/;
const PHASE_KEYS=Object.freeze({
  preconditions:Object.freeze(["FAILED","UNRESOLVED"]),
  postconditions:Object.freeze(["PASS","FAIL","UNKNOWN"])
});
const fail=why=>{throw Error(why);};
const freeze=Object.freeze;

function reachability(proc){
  const map=new Map(proc.nodes.map(n=>[n.id,[]]));
  for(const edge of proc.routes)map.get(edge.source)?.push(edge.target);
  const found=new Set([proc.start]),todo=[proc.start];
  for(let i=0;i<todo.length;i++)
    for(const id of map.get(todo[i])||[])
      if(!found.has(id)){found.add(id);todo.push(id);}
  return [...found].sort().join("|");
}
function sourceContext(source,procedureId,nodeId,phaseName){
  if(typeof source!=="string"||source.length>1024*1024||
      !ID.test(procedureId??"")||!ID.test(nodeId??"")||
      !PHASE_KEYS[phaseName])
    fail("Invalid Phase Outcome identity");
  if(/\r(?!\n)/.test(source)||
      (source.includes("\r\n")&&/(^|[^\r])\n/.test(source)))
    fail("Unsupported or mixed YAML newlines");
  const before=projectWorkspace(source);
  const proc=before.procedures.get(procedureId);
  const node=proc?.nodes.find(n=>n.id===nodeId);
  if(before.state!=="READY"||!node||node.operator==="terminal"||
     !node.phases.some(p=>p.name===phaseName))
    fail("Authored Phase is not projectable");
  const doc=parseDocument(source,{version:"1.2",schema:"core",
    uniqueKeys:true,stringKeys:true,strict:true,keepSourceTokens:true,
    logLevel:"silent"});
  if(doc.errors.length)fail("YAML AST is ambiguous");
  const phase=doc.getIn(["procedures",procedureId,"nodes",nodeId,
    phaseName],true);
  if(!isMap(phase))fail("Phase YAML mapping unavailable");
  const on=phase.items.find(x=>isScalar(x.key)&&x.key.value==="on");
  if(!on||!isScalar(on.key)||!Array.isArray(on.key.range)||
     source.slice(on.key.range[0],on.key.range[1])!=="'on'"||
     !isMap(on.value)||on.value.items.length<1||
     on.value.items.length>12)
    fail("Only an existing literal Phase 'on' map is supported");
  const hStart=source.lastIndexOf("\n",Math.max(0,on.key.range[0]-1))+1;
  const hEnd=source.indexOf("\n",on.key.range[1]);
  if(hEnd<0)fail("Phase 'on' map requires terminating newline");
  const header=source.slice(hStart,hEnd+1);
  const mHeader=/^( {8,24})'on':\r?\n$/.exec(header);
  if(!mHeader||hStart+mHeader[1].length!==on.key.range[0])
    fail("Phase 'on' map has non-plain header");
  const rowIndent=mHeader[1]+"  ",rows=[];
  for(const pair of on.value.items){
    const key=pair.key,val=pair.value;
    if(!isScalar(key)||!isScalar(val)||
       !Array.isArray(key.range)||!Array.isArray(val.range)||
       typeof key.value!=="string"||typeof val.value!=="string"||
       key.anchor||key.tag||val.anchor||val.tag||
       !OUTCOME.test(key.value)||!ID.test(val.value)||
       source.slice(key.range[0],key.range[1])!==key.value||
       source.slice(val.range[0],val.range[1])!==val.value)
      fail("Phase Outcome key/target is quoted, anchored or unknown");
    const start=source.lastIndexOf("\n",Math.max(0,key.range[0]-1))+1;
    const stop=source.indexOf("\n",val.range[1]);
    if(stop<0)fail("Unterminated Phase Outcome row");
    const raw=source.slice(start,stop+1);
    if(raw!==rowIndent+key.value+": "+val.value+
       (raw.endsWith("\r\n")?"\r\n":"\n")||
       key.range[0]!==start+rowIndent.length||
       val.range[0]!==key.range[1]+2)
      fail("Only full plain Outcome rows with no comments qualify");
    const routeId=nodeId+":"+phaseName+":"+key.value;
    const route=proc.routes.find(r=>r.id===routeId&&
      r.source===nodeId&&r.routeSource===phaseName+".on");
    if(!route||!route.patchable||route.target!==val.value||
       route.sourceSpan?.start!==val.range[0]||
       route.sourceSpan?.end!==val.range[1])
      fail("Outcome Source row does not match projected Route");
    rows.push({outcome:key.value,target:val.value,
      routeId,line:source.slice(0,start).split("\n").length,
      start,end:stop+1,keyStart:key.range[0],keyEnd:key.range[1],
      raw});
  }
  if(rows[0].start!==hEnd+1||
     rows.some((row,i)=>i>0&&rows[i-1].end!==row.start)||
     new Set(rows.map(x=>x.outcome)).size!==rows.length)
    fail("Phase Outcome row order or comments are ambiguous");
  const next=source.slice(rows.at(-1).end).split(/\r?\n/,1)[0];
  if(next.trimStart().startsWith("#"))
    fail("A comment following this mapping has ambiguous ownership");
  const otherNodes=new Set(proc.nodes.map(x=>x.id));
  const options=outcome=>[...new Set(proc.routes.filter(r=>
    r.routeSource===phaseName+".on"&&r.outcome===outcome&&
    r.source!==nodeId&&otherNodes.has(r.target)&&
    r.target!==nodeId).map(r=>r.target))].sort();
  return {source,before,proc,node,nodeId,phaseName,rows,
    header,keys:PHASE_KEYS[phaseName],options,
    eol:source.includes("\r\n")?"\r\n":"\n"};
}

function hasOtherReference(ctx,row){
  const rest=ctx.source.slice(0,row.start)+ctx.source.slice(row.end);
  return rest.includes(row.routeId)||
    rest.includes(ctx.phaseName+".on."+row.outcome);
}
function check(source,procedureId,nodeId,phaseName,mode,oldOutcome,
               newOutcome,target){
  const c=sourceContext(source,procedureId,nodeId,phaseName);
  const {rows,keys,proc}=c;
  const row=rows.find(x=>x.outcome===oldOutcome);
  const core=k=>keys.includes(k);
  let start,end,replacement,id,outcome,selectedTarget,oldTarget;
  if(mode==="add"){
    if(oldOutcome!==null||row||!core(newOutcome)||
       rows.some(r=>r.outcome===newOutcome)||
       !c.options(newOutcome).includes(target)||
       proc.routes.length>=1600)
      fail("Missing Phase Outcome/Target is not owner-observed");
    start=end=rows.at(-1).end;
    replacement=rows[0].raw.slice(0,rows[0].raw.indexOf(rows[0].outcome))+
      newOutcome+": "+target+c.eol;
    id=c.nodeId+":"+phaseName+":"+newOutcome;
    outcome=newOutcome;selectedTarget=target;oldTarget=null;
  }else if(mode==="rename"){
    if(!row||core(oldOutcome)||!core(newOutcome)||
       rows.some(r=>r.outcome===newOutcome)||
       target!==row.target||hasOtherReference(c,row)||
       proc.routes.some(r=>r.routeSource===phaseName+".on"&&
         r.outcome===oldOutcome&&r.source!==c.nodeId)||
       !c.options(newOutcome).includes(row.target))
      fail("Only a unique noncore spelling of a missing observed Outcome may be corrected");
    start=row.keyStart;end=row.keyEnd;replacement=newOutcome;
    id=c.nodeId+":"+phaseName+":"+newOutcome;
    outcome=newOutcome;selectedTarget=row.target;oldTarget=row.target;
  }else if(mode==="delete"){
    if(!row||core(oldOutcome)||newOutcome!==null||target!==null||
       keys.some(k=>!rows.some(r=>r.outcome===k))||
       rows.length<=keys.length||
       hasOtherReference(c,row)||
       proc.routes.some(r=>r.routeSource===phaseName+".on"&&
         r.outcome===oldOutcome&&r.source!==c.nodeId))
      fail("Required or possibly owner-defined Phase Outcome cannot be deleted");
    start=row.start;end=row.end;replacement="";
    id=row.routeId;outcome=oldOutcome;
    selectedTarget=null;oldTarget=row.target;
  }else fail("Unsupported Phase Outcome mutation");
  const candidateSource=source.slice(0,start)+replacement+source.slice(end);
  const after=projectWorkspace(candidateSource);
  if(after.state!=="READY")
    fail("Phase Outcome patch did not reproject");
  const expected=routeProjectionSignature(c.before);
  const p=expected.find(x=>x.name===procedureId);
  const index=p?.routes.findIndex(r=>r.id===row?.routeId);
  if(!p)fail("Procedure signature missing");
  if(mode==="add"){
    const last=p.routes.findLastIndex(r=>
      r.source===nodeId&&r.routeSource===phaseName+".on");
    if(last<0)fail("Phase Route signature missing");
    p.routes.splice(last+1,0,{
      id,source:nodeId,target:selectedTarget,
      routeSource:phaseName+".on",outcome
    });
  }else if(index<0)fail("Old Outcome is absent from signature");
  else if(mode==="rename"){
    p.routes[index].id=id;p.routes[index].outcome=newOutcome;
  }else p.routes.splice(index,1);
  if(JSON.stringify(expected)!==JSON.stringify(routeProjectionSignature(after)))
    fail("Outcome mutation altered unrelated Nodes, Phases or Routes");
  if(reachability(proc)!==reachability(after.procedures.get(procedureId)))
    fail("Outcome mutation would change reachable Nodes");
  const line=mode==="add"?source.slice(0,start).split("\n").length:
    row.line;
  const diff=mode==="add"
    ?"@@ -"+line+",0 +"+line+",1 @@\n+"+replacement.trimEnd()
    :mode==="rename"
      ?"@@ -"+line+",1 +"+line+",1 @@\n-"+row.raw.trimEnd()+
        "\n+"+row.raw.replace(oldOutcome+":",newOutcome+":").trimEnd()
      :"@@ -"+line+",1 +"+line+",0 @@\n-"+row.raw.trimEnd();
  const summary=(mode==="add"?"补齐":mode==="rename"?"修正":"删除")+
    " "+nodeId+" · "+phaseName+".on · "+outcome+
    (selectedTarget?" → "+selectedTarget:"")+
    "；仅为 Source 编辑，不证明 Runtime Outcome 集合或失败处理等价";
  return freeze({
    type:mode==="add"?"AddObservedPhaseOutcome":
      mode==="rename"?"RenameNoncorePhaseOutcome":"DeleteNoncorePhaseOutcome",
    profile:"d4-a4b1-phase-outcome-source-v1",
    procedureId,nodeId,phaseName,mode,
    oldOutcome:oldOutcome??null,newOutcome:newOutcome??null,
    target:target??null,routeId:row?.routeId??null,
    baseSource:source,candidateSource,
    sourceSpan:freeze({start,end}),
    diff,summary
  });
}
export function phaseOutcomeEditOptions(source,procedureId,nodeId){
  try{
    const before=projectWorkspace(source);
    const node=before.procedures.get(procedureId)?.nodes.find(x=>x.id===nodeId);
    if(before.state!=="READY"||!node)return freeze([]);
    const result=[];
    for(const phase of node.phases){
      try{
        const c=sourceContext(source,procedureId,nodeId,phase.name);
        const adds=[],renames=[],deletions=[];
        for(const outcome of c.keys.filter(k=>!c.rows.some(r=>r.outcome===k))){
          for(const target of c.options(outcome)){
            try{check(source,procedureId,nodeId,phase.name,
              "add",null,outcome,target);
              adds.push(freeze({outcome,target}));
            }catch{/* unqualified add */}
          }
        }
        for(const row of c.rows.filter(r=>!c.keys.includes(r.outcome))){
          for(const key of c.keys.filter(k=>!c.rows.some(r=>r.outcome===k))){
            try{check(source,procedureId,nodeId,phase.name,
              "rename",row.outcome,key,row.target);
              renames.push(freeze({oldOutcome:row.outcome,
                newOutcome:key,target:row.target}));
            }catch{/* unqualified spelling correction */}
          }
          try{check(source,procedureId,nodeId,phase.name,
            "delete",row.outcome,null,null);
            deletions.push(freeze({outcome:row.outcome,target:row.target}));
          }catch{/* unknown key may be owner-defined */}
        }
        result.push(freeze({
          phaseName:phase.name,
          present:freeze(c.rows.map(r=>r.outcome)),
          required:freeze([...c.keys]),
          adds:freeze(adds),renames:freeze(renames),
          deletions:freeze(deletions)
        }));
      }catch{/* this Phase is Source-only */}
    }
    return freeze(result);
  }catch{return freeze([]);}
}
export function previewAddObservedPhaseOutcome(source,procedureId,nodeId,
                                                phaseName,outcome,target){
  return check(source,procedureId,nodeId,phaseName,
    "add",null,outcome,target);
}
export function previewRenameNoncorePhaseOutcome(source,procedureId,nodeId,
                                                  phaseName,oldOutcome,newOutcome){
  const c=sourceContext(source,procedureId,nodeId,phaseName);
  const row=c.rows.find(r=>r.outcome===oldOutcome);
  return check(source,procedureId,nodeId,phaseName,"rename",oldOutcome,
    newOutcome,row?.target??null);
}
export function previewDeleteNoncorePhaseOutcome(source,procedureId,nodeId,
                                                  phaseName,outcome){
  return check(source,procedureId,nodeId,phaseName,
    "delete",outcome,null,null);
}
function apply(source,preview,type,mode){
  if(!preview||preview.type!==type||source!==preview.baseSource)
    fail("Stale or unsupported Phase Outcome Preview");
  const expected=check(source,preview.procedureId,preview.nodeId,
    preview.phaseName,mode,preview.oldOutcome,preview.newOutcome,
    preview.target);
  const keys=Object.keys(expected);
  if(Object.keys(preview).length!==keys.length||
     keys.some(k=>JSON.stringify(preview[k])!==JSON.stringify(expected[k])))
    fail("Phase Outcome Preview was forged or expired");
  return expected.candidateSource;
}
export const applyAddObservedPhaseOutcome=(s,p)=>
  apply(s,p,"AddObservedPhaseOutcome","add");
export const applyRenameNoncorePhaseOutcome=(s,p)=>
  apply(s,p,"RenameNoncorePhaseOutcome","rename");
export const applyDeleteNoncorePhaseOutcome=(s,p)=>
  apply(s,p,"DeleteNoncorePhaseOutcome","delete");
