import {parseDocument,isMap,isScalar} from "yaml";
import {projectWorkspace} from "./workspace.mjs";
import {routeProjectionSignature,observedOperatorOutcomes} from "./route-create.mjs";

// D3-A2, not a general Runtime verifier: edit one operator.on key or remove
// one demonstrably optional row; no Phase edits or entire-map deletion.
const ID=/^[A-Za-z_][A-Za-z0-9_.-]*$/;
const OUTCOME=/^[A-Z][A-Z0-9_]*$/;
const PROTECTED=new Set([
  "PASS","FAIL","UNKNOWN","COMMITTED","NOT_COMMITTED",
  "OUTCOME_UNKNOWN","FAILED","DENIED","SUCCEEDED","UNRESOLVED"
]);
const fail=msg=>{throw new Error(msg);};
function lineInfo(source,start,end){
  const lineStart=source.lastIndexOf("\n",start-1)+1;
  let lineEnd=source.indexOf("\n",end);
  if(lineEnd<0)lineEnd=source.length;
  const full=source.slice(lineStart,lineEnd).replace(/\r$/,"");
  const eol=lineEnd===source.length?"":source.slice(lineEnd,lineEnd+1);
  return {lineStart,lineEnd,full,eol,number:source.slice(0,start).split("\n").length};
}
function reachable(proc){
  const edges=new Map(proc.nodes.map(n=>[n.id,[]]));
  for(const r of proc.routes)edges.get(r.source)?.push(r.target);
  const seen=new Set([proc.start]),work=[proc.start];
  for(let i=0;i<work.length;i++)
    for(const target of edges.get(work[i])||[])
      if(!seen.has(target)){seen.add(target);work.push(target);}
  return seen;
}
function context(source,procedureId,routeId){
  if(typeof source!=="string"||source.length>1024*1024||
    !ID.test(procedureId??"")||typeof routeId!=="string"||
    routeId.length>240)fail("Invalid Route edit identity");
  const before=projectWorkspace(source);
  if(before.state!=="READY")fail("Source is not safely projectable");
  const proc=before.procedures.get(procedureId);
  const route=proc?.routes.find(r=>r.id===routeId);
  const node=proc?.nodes.find(n=>n.id===route?.source);
  if(!route||!node||node.operator==="terminal"||
    route.routeSource!=="operator.on"||!route.patchable||!route.sourceSpan||
    !OUTCOME.test(route.outcome))
    fail("Only explicitly qualified Node operator.on routes can be changed");
  const doc=parseDocument(source,{
    version:"1.2",schema:"core",strict:true,stringKeys:true,
    uniqueKeys:true,keepSourceTokens:true,logLevel:"silent"
  });
  if(doc.errors.length)fail("Cannot safely parse Route source");
  if(/\r(?!\n)/.test(source))fail("Unsupported newline sequence");
  const crlf=source.includes("\r\n");
  if(crlf&&/(^|[^\r])\n/.test(source))fail("Mixed newline sequences");
  const nodeMap=doc.getIn(["procedures",procedureId,"nodes",node.id],true);
  if(!isMap(nodeMap))fail("Node source map unavailable");
  const onPair=nodeMap.items.find(x=>isScalar(x.key)&&x.key.value==="on");
  if(!onPair||!isScalar(onPair.key)||!Array.isArray(onPair.key.range)||
    source.slice(...onPair.key.range.slice(0,2))!=="'on'"||
    !isMap(onPair.value)||!onPair.value.items.length)
    fail("Route origin is not an explicit source on map");
  const rows=[];
  for(const pair of onPair.value.items){
    if(!isScalar(pair.key)||!isScalar(pair.value)||
      !Array.isArray(pair.key.range)||!Array.isArray(pair.value.range)||
      typeof pair.key.value!=="string"||typeof pair.value.value!=="string"||
      !OUTCOME.test(pair.key.value)||!ID.test(pair.value.value)||
      source.slice(...pair.key.range.slice(0,2))!==pair.key.value||
      source.slice(...pair.value.range.slice(0,2))!==pair.value.value)
      fail("Route row contains an unqualified scalar, quote or alias");
    const key=pair.key.value,target=pair.value.value;
    const keyStart=pair.key.range[0],keyEnd=pair.key.range[1];
    const valueEnd=pair.value.range[1];
    const line=lineInfo(source,keyStart,valueEnd);
    const indent=source.slice(line.lineStart,keyStart);
    if(!/^ {6,28}$/.test(indent)||!line.full.startsWith(indent+key+": "))
      fail("Route is not a dedicated plain indented line");
    const suffix=source.slice(valueEnd,line.lineEnd).replace(/\r$/,"");
    if(!/^[ \t]*(?:#.*)?$/.test(suffix))
      fail("Unsupported multiline Route structure");
    rows.push({key,target,keyStart,keyEnd,valueEnd,indent,suffix,line});
  }
  if(new Set(rows.map(r=>r.key)).size!==rows.length||
    rows.some(r=>r.indent!==rows[0].indent))
    fail("Duplicated Outcome or mixed indentation");
  const row=rows.find(r=>r.key===route.outcome&&r.target===route.target);
  if(!row)fail("Semantic Route and source span disagree");
  if(route.sourceSpan.start!==undefined&&
    route.sourceSpan.start!==row.keyStart&&
    route.sourceSpan.start!==row.valueEnd-(route.target.length))
    // The YAML projection's sourceSpan may cover just the value.
    fail("Route span does not match the expected Source row");
  return {source,before,proc,node,route,rows,row,
    candidates:observedOperatorOutcomes(before,node)
      .filter(k=>k!==route.outcome&&!rows.some(r=>r.key===k))};
}
function deletionSafety(ctx){
  const {source,proc,row,route,rows}=ctx;
  if(PROTECTED.has(route.outcome))
    return "Core Operator verdict cannot be deleted without owner qualification";
  if(rows.length<=1)
    return "Cannot remove the last operator.on outcome";
  if(row.suffix.trim().length)
    return "Cannot discard a Route line that owns an inline comment";
  const beforeLine=source.slice(0,row.line.lineStart).split(/\r?\n/).at(-2)??"";
  if(/^\s*#/.test(beforeLine))
    return "A preceding comment may belong to the Route";
  // Do not remove direct references to an Outcome identity in other text.
  const identity=route.id;
  const other=source.slice(0,row.line.lineStart)+
    source.slice(row.line.lineEnd+row.line.eol.length);
  if(other.includes(identity))
    return "Other Source content references the Route identity";
  const clone={...proc,routes:proc.routes.filter(r=>r.id!==route.id)};
  const old=reachable(proc),next=reachable(clone);
  if([...old].some(id=>!next.has(id)))
    return "Removing this Route would make a previously reachable Node unreachable";
  return null;
}
export function routeOutcomeEditOptions(source,procedureId,routeId){
  try{
    const c=context(source,procedureId,routeId);
    const reason=deletionSafety(c);
    if(!c.candidates.length&&reason)return null;
    return Object.freeze({
      procedureId,routeId,nodeId:c.node.id,routeSource:"operator.on",
      outcome:c.route.outcome,target:c.route.target,
      renameChoices:Object.freeze(c.candidates),
      canDelete:!reason,deleteBlockedReason:reason,
      warning:"Structural edit only. Runtime branch completeness not verified"
    });
  }catch{return null;}
}
function compute(source,procedureId,routeId,mode,newOutcome){
  const c=context(source,procedureId,routeId);
  if(!["rename","delete"].includes(mode))fail("Unsupported Route operation");
  if(mode==="rename"&&!c.candidates.includes(newOutcome))
    fail("The replacement Outcome is not a qualified observed choice");
  if(mode==="delete"){
    if(newOutcome!==null)fail("Delete must not silently rename a Route");
    const reason=deletionSafety(c);
    if(reason)fail(reason);
    if(!c.row.line.eol)fail("Cannot delete an unterminated Route line");
  }
  const start=mode==="rename"?c.row.keyStart:c.row.line.lineStart;
  const end=mode==="rename"?c.row.keyEnd:
    c.row.line.lineEnd+c.row.line.eol.length;
  const original=source.slice(start,end);
  const replacement=mode==="rename"?newOutcome:"";
  const candidateSource=source.slice(0,start)+replacement+source.slice(end);
  const after=projectWorkspace(candidateSource);
  if(after.state!=="READY")
    fail("Edited Route did not reproject: "+(after.diagnostics?.[0]?.message||"unknown"));
  const expected=routeProjectionSignature(c.before);
  const p=expected.find(p=>p.name===procedureId);
  const idx=p.routes.findIndex(r=>r.id===routeId);
  if(idx<0||p.routes[idx].routeSource!=="operator.on")fail("Route identity drift");
  if(mode==="rename"){
    p.routes[idx].id=c.node.id+":"+newOutcome;
    p.routes[idx].outcome=newOutcome;
  }else p.routes.splice(idx,1);
  if(JSON.stringify(expected)!==JSON.stringify(routeProjectionSignature(after)))
    fail("Route mutation changed unrelated Procedure, Node, Phase or Route");
  const line=c.row.line.number;
  const diff=mode==="rename"
    ?"@@ -"+line+",1 +"+line+",1 @@\n-"+c.row.line.full+
      "\n+"+c.row.line.full.slice(0,c.row.keyStart-c.row.line.lineStart)+
      newOutcome+c.row.line.full.slice(c.row.keyEnd-c.row.line.lineStart)
    :"@@ -"+line+",1 +"+line+",0 @@\n-"+c.row.line.full;
  return Object.freeze({
    type:mode==="rename"?"RenameRouteOutcome":"DeleteRouteOutcome",
    profile:"d3-a2-operator-on-v1",procedureId,nodeId:c.node.id,
    routeId,routeSource:"operator.on",outcome:c.route.outcome,
    target:c.route.target,newOutcome:mode==="rename"?newOutcome:null,
    baseSource:source,candidateSource,sourceSpan:{start,end},
    diff,summary:(mode==="rename"?"重命名":"删除")+" Route "+routeId+
      (mode==="rename"?" → "+newOutcome:"")+
      "（仅结构检查，不代表 Runtime 接受）"
  });
}
export function previewRenameRouteOutcome(source,procedureId,routeId,newOutcome){
  return compute(source,procedureId,routeId,"rename",newOutcome);
}
export function previewDeleteRouteOutcome(source,procedureId,routeId){
  return compute(source,procedureId,routeId,"delete",null);
}
function apply(source,preview,type,mode){
  if(!preview||preview.type!==type||source!==preview.baseSource)
    fail("Stale or unsupported Route mutation preview");
  const expected=compute(source,preview.procedureId,preview.routeId,mode,
    mode==="rename"?preview.newOutcome:null);
  const a=Object.keys(expected),b=Object.keys(preview);
  if(a.length!==b.length||a.some(k=>!b.includes(k)||
    JSON.stringify(expected[k])!==JSON.stringify(preview[k])))
    fail("Route mutation preview has been forged");
  return expected.candidateSource;
}
export function applyRenameRouteOutcome(source,preview){
  return apply(source,preview,"RenameRouteOutcome","rename");
}
export function applyDeleteRouteOutcome(source,preview){
  return apply(source,preview,"DeleteRouteOutcome","delete");
}
