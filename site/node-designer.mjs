import {parseDocument,isMap,isSeq,isScalar} from "yaml";
import {projectWorkspace} from "./workspace.mjs";

// D2/A1: rename an existing Node ID without owning a second graph model.
// This checks source/structure isolation, NOT Runtime or cross-asset semantics.
const ID=/^[A-Za-z_][A-Za-z0-9_.-]*$/;
const fail=message=>{throw new Error(message);};
function plainSpan(source,node,value){
  if(!isScalar(node)||typeof node.value!=="string"||node.value!==value||!node.range)
    fail("Expected source scalar is missing");
  const [start,end]=node.range;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||
    start<0||end<=start||source.slice(start,end)!==value)
    fail("Quoted, aliased or non-plain Node reference cannot be edited");
  return {start,end};
}
function view(model){
  return [...model.procedures.values()].map(p=>({
    name:p.name,start:p.start,
    nodes:p.nodes.map(n=>({
      id:n.id,operator:n.operator,value:n.value,
      children:n.children.map(c=>({procedure:c.procedure,via:c.via})),
      phases:n.phases.map(ph=>({
        name:ph.name,steps:ph.steps.map(st=>({
          name:st.name,operator:st.operator,value:st.value
        }))
      }))
    })),
    routes:p.routes.map(r=>({
      id:r.id,source:r.source,outcome:r.outcome,
      target:r.target,routeSource:r.routeSource
    }))
  }));
}
function compute(source,procedureId,nodeId,newId){
  if(typeof source!=="string"||!ID.test(procedureId)||!ID.test(nodeId)||
    !ID.test(newId)||newId.length>80||newId===nodeId)
    fail("Invalid or unchanged Node ID");
  const before=projectWorkspace(source);
  if(before.state!=="READY")fail("Procedure Source cannot be safely projected");
  const proc=before.procedures.get(procedureId);
  if(!proc||!proc.nodes.some(n=>n.id===nodeId))fail("Node not found in this Procedure");
  if(proc.nodes.some(n=>n.id===newId))fail("New Node ID already exists");
  const doc=parseDocument(source,{
    version:"1.2",schema:"core",uniqueKeys:true,stringKeys:true,
    strict:true,keepSourceTokens:true,logLevel:"silent"
  });
  if(doc.errors.length)fail("YAML parsing failed");
  const procAst=doc.getIn(["procedures",procedureId],true);
  const nodesAst=doc.getIn(["procedures",procedureId,"nodes"],true);
  if(!isMap(procAst)||!isMap(nodesAst))fail("Procedure mapping unavailable");
  const keyPair=nodesAst.items.find(pair=>isScalar(pair.key)&&pair.key.value===nodeId);
  if(!keyPair)fail("Node mapping key missing");
  const changes=[],seen=new Set();
  function add(node,oldValue,replacement){
    const span=plainSpan(source,node,oldValue);
    const id=span.start+":"+span.end;
    if(seen.has(id)){
      const original=changes.find(c=>c.start===span.start&&c.end===span.end);
      if(original?.replacement!==replacement)fail("Conflicting Node references");
      return;
    }
    seen.add(id);
    changes.push({...span,oldValue,replacement});
  }
  add(keyPair.key,nodeId,newId);
  if(proc.start===nodeId)
    add(doc.getIn(["procedures",procedureId,"start"],true),nodeId,newId);
  for(const route of proc.routes.filter(r=>r.target===nodeId)){
    const phase=route.routeSource==="operator.on"?[]:
      route.routeSource==="preconditions.on"?["preconditions"]:
      route.routeSource==="postconditions.on"?["postconditions"]:null;
    if(!phase)fail("Unknown Route origin");
    const path=["procedures",procedureId,"nodes",route.source,...phase,"on",route.outcome];
    add(doc.getIn(path,true),nodeId,newId);
  }
  // Only explicit plain from: node-id.* values within this Procedure
  // can be rewritten; other reference-like values fail closed.
  function walk(node,field){
    if(isMap(node)){
      for(const pair of node.items)walk(pair.value,isScalar(pair.key)?pair.key.value:null);
    }else if(isSeq(node)){
      for(const item of node.items)walk(item,null);
    }else if(isScalar(node)&&typeof node.value==="string"){
      const value=node.value;
      const exact=value===nodeId;
      const ref=value.startsWith(nodeId+".");
      if(!exact&&!ref)return;
      const span=node.range;
      if(span&&seen.has(span[0]+":"+span[1]))return;
      if(field==="from"&&ref&&node.range&&
        node.range[0]>=nodesAst.range[0]&&node.range[1]<=nodesAst.range[1]){
        add(node,value,newId+value.slice(nodeId.length));
      }else fail("Unqualified Node reference found; edit in Source instead");
    }
  }
  walk(procAst,null);
  const ascending=changes.sort((a,b)=>a.start-b.start);
  for(let i=1;i<ascending.length;i++)
    if(ascending[i-1].end>ascending[i].start)fail("Overlapping source spans");
  let candidateSource=source;
  for(const c of [...ascending].reverse())
    candidateSource=candidateSource.slice(0,c.start)+c.replacement+candidateSource.slice(c.end);
  const after=projectWorkspace(candidateSource);
  if(after.state!=="READY")fail("Renamed Source is no longer projectable");
  const expected=view(before);
  const target=expected.find(p=>p.name===procedureId);
  target.start=target.start===nodeId?newId:target.start;
  target.nodes.find(n=>n.id===nodeId).id=newId;
  for(const route of target.routes){
    if(route.source===nodeId){
      route.source=newId;
      route.id=newId+route.id.slice(nodeId.length);
    }
    if(route.target===nodeId)route.target=newId;
  }
  if(JSON.stringify(expected)!==JSON.stringify(view(after)))
    fail("Node rename changed unrelated Procedure projection");
  const oldLines=source.split("\n"),newLines=candidateSource.split("\n");
  const changed=[...new Set(ascending.map(c=>source.slice(0,c.start).split("\n").length))];
  const diff=changed.map(line=>
    "@@ -"+line+",1 +"+line+",1 @@\n-"+oldLines[line-1]+"\n+"+newLines[line-1]
  ).join("\n");
  return Object.freeze({
    type:"RenameNode",profile:"d2-node-rename-v1",
    procedureId,nodeId,newId,baseSource:source,
    candidateSource,
    sourceSpans:ascending.map(c=>Object.freeze({
      start:c.start,end:c.end,oldValue:c.oldValue,newValue:c.replacement
    })),
    diff,summary:procedureId+" / "+nodeId+" → "+newId+
      " ("+ascending.length+" source replacements)"
  });
}
export function previewNodeRename(source,procedureId,nodeId,newId){
  return compute(source,procedureId,nodeId,newId);
}
export function nodeRenameAvailable(source,procedureId,nodeId){
  try{
    const candidate="node-renamed-"+nodeId.slice(0,40);
    compute(source,procedureId,nodeId,candidate);
    return true;
  }catch{return false;}
}
export function applyNodeRename(source,preview){
  if(!preview||preview.type!=="RenameNode"||source!==preview.baseSource)
    fail("Unsupported or stale Node rename");
  const expected=compute(source,preview.procedureId,preview.nodeId,preview.newId);
  for(const key of Object.keys(expected)){
    if(JSON.stringify(preview[key])!==JSON.stringify(expected[key]))
      fail("Node rename preview has changed");
  }
  if(Object.keys(preview).length!==Object.keys(expected).length)
    fail("Unexpected Node rename preview fields");
  return expected.candidateSource;
}
