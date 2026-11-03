import {parseDocument,isMap,isSeq,isScalar} from "yaml";
import {projectWorkspace} from "./workspace.mjs";

// D2-A3: explicit, bounded Node deletion with inbound Route remediation.
// The source YAML remains the only authority. No Runtime validity is implied.
const ID=/^[A-Za-z_][A-Za-z0-9_.-]*$/;
const reject=message=>{throw new Error(message);};
function scalarSpan(source,node,value){
  if(!isScalar(node)||node.value!==value||!Array.isArray(node.range))
    reject("A referenced source scalar is missing");
  const [start,end]=node.range;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||
     start<0||end<=start||source.slice(start,end)!==value)
    reject("Quoted or non-plain Route references are not eligible");
  return {start,end};
}
function view(model){
  return [...model.procedures.values()].map(p=>({
    name:p.name,start:p.start,
    nodes:p.nodes.map(n=>({
      id:n.id,operator:n.operator,value:n.value,
      phases:n.phases.map(ph=>({
        name:ph.name,steps:ph.steps.map(st=>({
          name:st.name,operator:st.operator,value:st.value
        }))
      })),
      children:n.children.map(c=>({
        procedure:c.procedure,via:c.via,caller:c.caller
      }))
    })),
    routes:p.routes.map(r=>({
      id:r.id,source:r.source,outcome:r.outcome,
      target:r.target,routeSource:r.routeSource
    }))
  }));
}
function eligibility(source,procedureId,nodeId){
  if(typeof source!=="string"||!ID.test(procedureId)||!ID.test(nodeId))
    reject("Invalid Node selector");
  const before=projectWorkspace(source);
  if(before.state!=="READY")reject("Source cannot be projected");
  const proc=before.procedures.get(procedureId);
  const node=proc?.nodes.find(n=>n.id===nodeId);
  if(!node)reject("Node not found");
  if(node.id===proc.start)reject("Cannot delete the Procedure start Node");
  if(node.children.length)reject("Child Procedure references must not be removed");
  const outgoing=proc.routes.filter(r=>r.source===nodeId);
  let choices=[];
  let mode=null;
  if(node.operator==="terminal"){
    if(outgoing.length)reject("Terminal has outgoing Routes");
    choices=proc.nodes.filter(n=>n.id!==nodeId&&n.operator==="terminal"&&
      n.value===node.value).map(n=>n.id);
    mode="merge-terminal";
  }else if(node.operator!=="procedure" && node.phases.length===0 &&
    outgoing.length===1 && outgoing[0].routeSource==="operator.on" &&
    outgoing[0].target!==nodeId){
    choices=[outgoing[0].target];
    mode="bypass-single-outcome";
  }else reject("Node has multiple outcomes, phases or child dependencies");
  if(!choices.length)reject("No safe redirect target is available");
  const incoming=proc.routes.filter(r=>r.target===nodeId&&r.source!==nodeId);
  return {before,proc,node,incoming,outgoing,choices,mode};
}
export function deleteNodeOptions(source,procedureId,nodeId){
  try{
    const e=eligibility(source,procedureId,nodeId);
    // Do not expose a clickable delete action unless the full source
    // reference safety inspection succeeds for at least one legal target.
    const allowed=e.choices.filter(target=>{
      try{compute(source,procedureId,nodeId,target);return true;}
      catch{return false;}
    });
    return allowed.length?Object.freeze({
      nodeId,mode:e.mode,targets:Object.freeze(allowed),
      incomingCount:e.incoming.length,outgoingCount:e.outgoing.length
    }):null;
  }catch{return null;}
}
function compute(source,procedureId,nodeId,redirectTarget){
  const e=eligibility(source,procedureId,nodeId);
  if(!ID.test(redirectTarget)||!e.choices.includes(redirectTarget))
    reject("Redirect must be an explicitly qualified existing Node");
  const doc=parseDocument(source,{version:"1.2",schema:"core",
    strict:true,uniqueKeys:true,stringKeys:true,
    keepSourceTokens:true,logLevel:"silent"});
  if(doc.errors.length)reject("Invalid YAML document");
  const nodes=doc.getIn(["procedures",procedureId,"nodes"],true);
  if(!isMap(nodes)||nodes.items.length<2)reject("Node map unavailable");
  const index=nodes.items.findIndex(pair=>isScalar(pair.key)&&
    pair.key.value===nodeId);
  if(index<0)reject("Node key not found");
  const item=nodes.items[index];
  const keySpan=scalarSpan(source,item.key,nodeId);
  if(!isMap(item.value)||!Array.isArray(item.value.range))
    reject("Node block cannot be sliced");
  const lineStart=source.lastIndexOf("\n",keySpan.start-1)+1;
  const prefix=source.slice(lineStart,keySpan.start);
  if(!/^ {2,20}$/.test(prefix))reject("Node indentation is unsupported");
  // Value range is the last actual Node content line. Do not swallow
  // neighboring comment blocks, trailing sections or the following key.
  const last=Math.max(keySpan.end,item.value.range[1])-1;
  const newline=source.indexOf("\n",last);
  const blockEnd=newline<0?source.length:newline+1;
  if(blockEnd<=lineStart)reject("Unusable Node block span");
  if(index<nodes.items.length-1){
    const following=nodes.items[index+1].key;
    if(!isScalar(following)||!following.range)reject("Next Node key missing");
    const nextStart=source.lastIndexOf("\n",following.range[0]-1)+1;
    if(blockEnd>nextStart)reject("Deletion overlaps the next Node");
  }
  const removal={start:lineStart,end:blockEnd,
    oldValue:source.slice(lineStart,blockEnd),newValue:""};
  if(!removal.oldValue.startsWith(prefix+nodeId+":"))
    reject("Node block uses a non-plain mapping key");
  const changes=[removal],approved=new Set();
  for(const route of e.incoming){
    const path=["procedures",procedureId,"nodes",route.source];
    if(route.routeSource!=="operator.on"){
      if(!["preconditions.on","postconditions.on"].includes(route.routeSource))
        reject("Unknown Route source");
      path.push(route.routeSource.split(".")[0]);
    }
    path.push("on",route.outcome);
    const span=scalarSpan(source,doc.getIn(path,true),nodeId);
    if(span.start>=lineStart&&span.end<=blockEnd)
      reject("Unexpected self-reference in incoming Route");
    changes.push({...span,oldValue:nodeId,newValue:redirectTarget});
    approved.add(span.start+":"+span.end);
  }
  // Any reference in another Node, Procedure or field is an unsupported
  // semantic dependency; only the complete incoming Route set may change.
  function walk(node){
    if(isMap(node)){
      for(const pair of node.items){
        walk(pair.key);
        walk(pair.value);
      }
    }else if(isSeq(node)){
      for(const child of node.items)walk(child);
    }else if(isScalar(node)&&typeof node.value==="string"){
      const value=node.value;
      if(value!==nodeId&&!value.startsWith(nodeId+"."))return;
      if(!node.range)reject("Potential Node reference has no source span");
      const [start,end]=node.range;
      if(start>=lineStart&&end<=blockEnd)return;
      if(approved.has(start+":"+end))return;
      reject("Unresolved reference to the deleted Node: "+value);
    }
  }
  walk(doc.contents);
  const asc=changes.sort((a,b)=>a.start-b.start);
  for(let i=1;i<asc.length;i++)
    if(asc[i-1].end>asc[i].start)reject("Overlapping Patch source spans");
  let candidateSource=source;
  for(const change of [...asc].reverse()){
    if(source.slice(change.start,change.end)!==change.oldValue)
      reject("Source changed before patch generation");
    candidateSource=candidateSource.slice(0,change.start)+
      change.newValue+candidateSource.slice(change.end);
  }
  const after=projectWorkspace(candidateSource);
  if(after.state!=="READY")reject("Deletion failed to reproject: "+
    (after.diagnostics?.[0]?.message??"unknown"));
  const expected=view(e.before),p=expected.find(x=>x.name===procedureId);
  p.nodes=p.nodes.filter(n=>n.id!==nodeId);
  p.routes=p.routes.filter(r=>r.source!==nodeId);
  for(const route of p.routes)
    if(route.target===nodeId)route.target=redirectTarget;
  if(JSON.stringify(expected)!==JSON.stringify(view(after)))
    reject("Delete changed unrelated Procedure semantics");
  const diff=changes.map(change=>{
    const line=source.slice(0,change.start).split("\n").length;
    if(change.newValue===""){
      const old=change.oldValue.replace(/\r?\n$/,"").split(/\r?\n/);
      return "@@ -"+line+","+old.length+" +"+line+",0 @@\n"+
        old.map(x=>"-"+x).join("\n");
    }
    const a=source.lastIndexOf("\n",Math.max(0,change.start-1))+1;
    const b=source.indexOf("\n",change.end);
    const oldLine=source.slice(a,b<0?source.length:b).replace(/\r$/,"");
    const newLine=oldLine.slice(0,change.start-a)+change.newValue+
      oldLine.slice(change.end-a);
    return "@@ -"+line+",1 +"+line+",1 @@\n-"+oldLine+"\n+"+newLine;
  }).join("\n");
  return Object.freeze({
    type:"DeleteNode",profile:"d2-delete-node-v1",
    procedureId,nodeId,redirectTarget,mode:e.mode,
    incomingCount:e.incoming.length,outgoingCount:e.outgoing.length,
    baseSource:source,candidateSource,
    sourceSpans:asc.map(x=>Object.freeze({
      start:x.start,end:x.end,oldValue:x.oldValue,newValue:x.newValue
    })),
    diff,summary:"Delete "+nodeId+" · "+e.mode+
      " · "+e.incoming.length+" inbound Route(s) → "+redirectTarget
  });
}
export function previewNodeDelete(source,procedureId,nodeId,redirectTarget){
  return compute(source,procedureId,nodeId,redirectTarget);
}
export function applyNodeDelete(source,preview){
  if(!preview||preview.type!=="DeleteNode"||source!==preview.baseSource)
    reject("Unsupported or stale Node delete Preview");
  const expected=compute(source,preview.procedureId,
    preview.nodeId,preview.redirectTarget);
  const keys=Object.keys(expected);
  if(keys.length!==Object.keys(preview).length||
    keys.some(key=>JSON.stringify(preview[key])!==JSON.stringify(expected[key])))
    reject("Node delete Preview has changed");
  return expected.candidateSource;
}
