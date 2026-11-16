import {parseDocument,isMap,isSeq,isScalar} from "yaml";
import {projectWorkspace} from "./workspace.mjs";
import {routeProjectionSignature} from "./route-create.mjs";

// D4-A3a: reorder two immediately adjacent, unnamed, single-line Verify
// steps only. No call/script effects, named outputs, bindings or comments may
// move. This is an editor-level structural patch, not Runtime qualification.
const ID=/^[A-Za-z_][A-Za-z0-9_.-]*$/;
const PHASES=new Set(["preconditions","postconditions"]);
const reject=msg=>{throw Error(msg);};
const freeze=Object.freeze;

function setup(source,procedureId,nodeId){
  if(typeof source!=="string"||source.length>1024*1024||
    !ID.test(procedureId??"")||!ID.test(nodeId??""))
    reject("Invalid Phase Step identity or Source");
  const before=projectWorkspace(source);
  if(before.state!=="READY")reject("Procedure Source is not safely projected");
  const proc=before.procedures.get(procedureId);
  const node=proc?.nodes.find(n=>n.id===nodeId);
  if(!node)reject("Selected Procedure / Node does not exist");
  const doc=parseDocument(source,{version:"1.2",schema:"core",strict:true,
    uniqueKeys:true,stringKeys:true,keepSourceTokens:true,logLevel:"silent"});
  if(doc.errors.length)reject("YAML Source is ambiguous");
  return {source,procedureId,nodeId,before,proc,node,doc};
}
function lineAt(source,scalar,expected){
  if(!isScalar(scalar)||typeof scalar.value!=="string"||
     scalar.value!==expected||!Array.isArray(scalar.range)||
     scalar.anchor||scalar.tag)reject("Verify value is not a safe scalar");
  const [at,end]=scalar.range;
  if(source.slice(at,end)!==expected)
    reject("Quoted or modified Verify is Source-only");
  const start=source.lastIndexOf("\n",Math.max(0,at-1))+1;
  const newline=source.indexOf("\n",at);
  if(newline<0)reject("Single-line Verify needs a terminal newline");
  const raw=source.slice(start,newline+1);
  const match=/^( {8,24})- verify: ([A-Za-z_][A-Za-z0-9_.-]*)\r?\n$/.exec(raw);
  if(!match||match[2]!==expected)
    reject("Only a plain single-line Verify without comments is reorderable");
  return {start,end:newline+1,raw,indent:match[1]};
}
function pair(ctx,phaseName,stepIndex){
  if(!PHASES.has(phaseName)||!Number.isInteger(stepIndex)||
      stepIndex<0||stepIndex>=79)
    reject("Invalid Phase Step selector");
  const phase=ctx.node.phases.find(p=>p.name===phaseName);
  if(!phase||stepIndex+1>=phase.steps.length)reject("Adjacent Step does not exist");
  const seq=ctx.doc.getIn(["procedures",ctx.procedureId,"nodes",
    ctx.nodeId,phaseName,"steps"],true);
  if(!isSeq(seq)||seq.items.length!==phase.steps.length)
    reject("Step list changed or cannot be projected");
  const rows=[];
  for(const i of [stepIndex,stepIndex+1]){
    const step=phase.steps[i],ast=seq.items[i];
    if(!step||step.operator!=="verify"||step.name||!isMap(ast)||
       ast.items.length!==1||!isScalar(ast.items[0].key)||
       ast.items[0].key.value!=="verify"||
       ctx.source.slice(ast.items[0].key.range?.[0],
                        ast.items[0].key.range?.[1])!=="verify")
      reject("Only unnamed, unbound Verify steps may move");
    const location=lineAt(ctx.source,ast.items[0].value,step.value);
    rows.push({step,location});
  }
  if(rows[0].step.value===rows[1].step.value||
     rows[0].location.indent!==rows[1].location.indent||
     rows[0].location.end!==rows[1].location.start)
    reject("Only distinct physically adjacent Verifies without comments may swap");
  return rows;
}
export function adjacentVerifyReorderOptions(source,procedureId,nodeId){
  try{
    const ctx=setup(source,procedureId,nodeId);
    const options=[];
    for(const phase of ctx.node.phases){
      if(!PHASES.has(phase.name))continue;
      for(let i=0;i<phase.steps.length-1;i++){
        try{
          const [a,b]=pair(ctx,phase.name,i);
          options.push(freeze({phaseName:phase.name,stepIndex:i,
            first:a.step.value,second:b.step.value}));
        }catch{/* unsupported pairs remain Source-only */}
      }
    }
    return freeze(options);
  }catch{return freeze([]);}
}
function compute(source,procedureId,nodeId,phaseName,stepIndex){
  const ctx=setup(source,procedureId,nodeId);
  const [a,b]=pair(ctx,phaseName,stepIndex);
  const start=a.location.start,end=b.location.end;
  const candidateSource=source.slice(0,start)+b.location.raw+
    a.location.raw+source.slice(end);
  const after=projectWorkspace(candidateSource);
  if(after.state!=="READY")reject("Reordered Source does not reproject");
  const expected=routeProjectionSignature(ctx.before);
  const steps=expected.find(p=>p.name===procedureId)?.nodes
    .find(n=>n.id===nodeId)?.phases.find(p=>p.name===phaseName)?.steps;
  if(!steps)reject("Missing original Step structure");
  const first={...steps[stepIndex+1],index:stepIndex+1};
  const second={...steps[stepIndex],index:stepIndex+2};
  steps.splice(stepIndex,2,first,second);
  if(JSON.stringify(expected)!==JSON.stringify(routeProjectionSignature(after)))
    reject("Unexpected Node, Child, Phase or Route mutation");
  // Requalify in the next Source revision before presenting a preview.
  const swapped=pair(setup(candidateSource,procedureId,nodeId),phaseName,stepIndex);
  if(swapped[0].step.value!==b.step.value||
     swapped[1].step.value!==a.step.value)
    reject("Reordered Steps failed source qualification");
  const line=source.slice(0,start).split("\n").length;
  return freeze({
    type:"SwapAdjacentPhaseVerifySteps",
    profile:"d4-a3a-unnamed-independent-verify-v1",
    procedureId,nodeId,phaseName,stepIndex,
    first:a.step.value,second:b.step.value,
    baseSource:source,candidateSource,
    sourceSpan:freeze({start,end}),
    diff:"@@ -"+line+",2 +"+line+",2 @@\n-"+
      a.location.raw.trimEnd()+"\n-"+b.location.raw.trimEnd()+
      "\n+"+b.location.raw.trimEnd()+"\n+"+a.location.raw.trimEnd(),
    summary:"调整 "+nodeId+" / "+phaseName+" 的第 "+
      (stepIndex+1)+"、"+(stepIndex+2)+" 个 Verify 顺序；"+
      "两步均无命名输出、参数绑定或注释；不代表 Runtime 顺序等价"
  });
}
export function previewAdjacentVerifyReorder(source,procedureId,nodeId,
                                             phaseName,stepIndex){
  return compute(source,procedureId,nodeId,phaseName,stepIndex);
}
export function applyAdjacentVerifyReorder(source,preview){
  if(!preview||preview.type!=="SwapAdjacentPhaseVerifySteps"||
     source!==preview.baseSource)
    reject("Stale or unsupported Phase reorder preview");
  const expected=compute(source,preview.procedureId,preview.nodeId,
    preview.phaseName,preview.stepIndex);
  const keys=Object.keys(expected);
  if(Object.keys(preview).length!==keys.length||
     keys.some(k=>JSON.stringify(preview[k])!==JSON.stringify(expected[k])))
    reject("Phase reorder preview is stale or modified");
  return expected.candidateSource;
}
