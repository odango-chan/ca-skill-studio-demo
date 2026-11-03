import {parseDocument,isMap,isSeq,isScalar} from "yaml";
import {projectWorkspace} from "./workspace.mjs";
import {predicateChoices} from "./attribute-patch.mjs";

// D2-A4: existing scalar Operator values + existing with.<key>.from values.
// This is SOURCE-authoritative structural authoring, NOT execution qualification.
const ID=/^[A-Za-z_][A-Za-z0-9_.-]*$/;
const REF=/^[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*)+$/;
const fail=message=>{throw new Error(message);};
function docOf(source){
  if(typeof source!=="string"||source.length>1024*1024)
    fail("Source exceeds edit budget");
  const doc=parseDocument(source,{version:"1.2",schema:"core",strict:true,
    uniqueKeys:true,stringKeys:true,keepSourceTokens:true,logLevel:"silent"});
  if(doc.errors.length)fail("Source cannot be safely parsed");
  return doc;
}
function plainScalar(source,ast,expected){
  if(!isScalar(ast)||typeof ast.value!=="string"||ast.value!==expected||
     !Array.isArray(ast.range))fail("Scalar does not match the selected source field");
  const [start,end]=ast.range;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||
     start<0||end<=start||source.slice(start,end)!==expected)
    fail("Quoted, aliased or non-plain source scalar is not editable");
  return {start,end};
}
function findNode(source,procedureId,nodeId){
  if(!ID.test(procedureId)||!ID.test(nodeId))fail("Invalid Node selector");
  const before=projectWorkspace(source);
  if(before.state!=="READY")fail("Source projection unavailable");
  const procedure=before.procedures.get(procedureId);
  const node=procedure?.nodes.find(n=>n.id===nodeId);
  if(!node)fail("Node not found");
  const doc=docOf(source);
  const ast=doc.getIn(["procedures",procedureId,"nodes",nodeId],true);
  if(!isMap(ast))fail("Node AST is not a mapping");
  return {before,procedure,node,doc,ast};
}
function predicateSet(source,skillName){
  if(typeof source!=="string"||typeof skillName!=="string"||
    !ID.test(skillName))return [];
  const doc=docOf(source);
  if(doc.get("kind")!=="PredicateSet"||
     doc.getIn(["metadata","skill"])!==skillName)return [];
  return predicateChoices(source);
}
function operatorChoices(ctx,predicateSource,skillName){
  const {node,procedure,before}=ctx;
  if(node.operator==="verify"||node.operator==="predicate")
    return {type:"select",values:predicateSet(predicateSource,skillName)};
  if(node.operator==="terminal")
    return {type:"select",values:[...new Set(procedure.nodes.filter(n=>n.operator==="terminal")
      .map(n=>n.value))]};
  if(node.operator==="procedure")
    return {type:"select",values:[...before.procedures.keys()]};
  if(["call","tool","reconcile"].includes(node.operator))
    return {type:"input",values:[]};
  return null; // Script paths and operator-kind replacement require package validation.
}
function bindingList(ctx){
  const {doc,procedure,node,ast}=ctx;
  const withMap=ast.get("with",true);
  if(!isMap(withMap))return [];
  const choices=new Set();
  const inputs=doc.getIn(["procedures",procedure.name,"inputs"],true);
  const inputKeys=new Set();
  if(isMap(inputs))for(const pair of inputs.items){
    if(isScalar(pair.key)&&typeof pair.key.value==="string"&&ID.test(pair.key.value)){
      inputKeys.add(pair.key.value);
      choices.add("input."+pair.key.value);
    }
  }
  // Reuse only references physically authored in this Procedure. The editor
  // does not fabricate output field paths or imply their type compatibility.
  const astProcedure=doc.getIn(["procedures",procedure.name,"nodes"],true);
  function collect(ast,field){
    if(isMap(ast)){
      for(const pair of ast.items)collect(pair.value,
        isScalar(pair.key)?pair.key.value:null);
    }else if(isSeq(ast)){
      for(const entry of ast.items)collect(entry,null);
    }else if(field==="from"&&isScalar(ast)&&typeof ast.value==="string"&&
      REF.test(ast.value)&&ast.value.length<=240&&
      sourceQualifiedRef(ast.value,inputKeys,procedure)){
      choices.add(ast.value);
    }
  }
  collect(astProcedure,null);
  const allowed=[...choices].sort();
  const result=[];
  for(const pair of withMap.items){
    if(!isScalar(pair.key)||typeof pair.key.value!=="string"||
       !ID.test(pair.key.value)||!isMap(pair.value))continue;
    const from=pair.value.get("from",true);
    if(!isScalar(from)||typeof from.value!=="string")continue;
    try{plainScalar(doc.source??ctxSource(ctx),from,from.value);}
    catch{continue;}
    if(!allowed.includes(from.value))continue;
    result.push({key:pair.key.value,value:from.value,choices:allowed});
  }
  return result.slice(0,80);
}
function ctxSource(ctx){return ctx.source;}
function sourceQualifiedRef(ref,inputKeys,procedure){
  if(ref.startsWith("input."))
    return inputKeys.has(ref.slice(6));
  // Existing authored output/phase references are not validated as output
  // schemas here; they are only offered for reuse, not newly constructed.
  return REF.test(ref)&&ref.length<=240;
}
function snapshot(model){
  return [...model.procedures.values()].map(p=>({
    name:p.name,start:p.start,
    nodes:p.nodes.map(n=>({id:n.id,operator:n.operator,value:n.value,
      children:n.children.map(c=>({procedure:c.procedure,via:c.via})),
      phases:n.phases.map(phase=>({name:phase.name,
        steps:phase.steps.map(step=>({name:step.name,operator:step.operator,value:step.value}))}))
    })),
    routes:p.routes.map(r=>({id:r.id,source:r.source,outcome:r.outcome,
      target:r.target,routeSource:r.routeSource}))
  }));
}
function ensureAcyclic(model){
  const graph=new Map([...model.procedures.values()].map(p=>[
    p.name,p.children.map(c=>c.procedure)
  ]));
  const active=new Set(),finished=new Set();
  function visit(name){
    if(active.has(name))fail("Procedure reference would create a cycle");
    if(finished.has(name))return;
    active.add(name);
    for(const next of graph.get(name)||[])visit(next);
    active.delete(name);finished.add(name);
  }
  for(const name of graph.keys())visit(name);
}
function replacement(source,span,newValue){
  const next=source.slice(0,span.start)+newValue+source.slice(span.end);
  const a=source.lastIndexOf("\n",Math.max(0,span.start-1))+1;
  const b=source.indexOf("\n",span.end);
  const oldLine=source.slice(a,b<0?source.length:b).replace(/\r$/,"");
  const newLine=oldLine.slice(0,span.start-a)+newValue+
    oldLine.slice(span.end-a);
  const line=source.slice(0,span.start).split("\n").length;
  return {candidateSource:next,sourceSpan:Object.freeze(span),
    diff:"@@ -"+line+",1 +"+line+",1 @@\n-"+oldLine+"\n+"+newLine};
}
export function nodeAttributeState(source,procedureId,nodeId,
                                    predicateSource=null,skillName=null){
  try{
    const ctx={...findNode(source,procedureId,nodeId),source};
    let operator=null;
    const op=operatorChoices(ctx,predicateSource,skillName);
    if(op){
      try{
        plainScalar(source,ctx.doc.getIn(
          ["procedures",procedureId,"nodes",nodeId,ctx.node.operator],true),ctx.node.value);
        if(op.type==="input"||op.values.includes(ctx.node.value))
          operator={operator:ctx.node.operator,value:ctx.node.value,...op};
      }catch{/* Source-only for unsafe scalars */}
    }
    return {operator,bindings:bindingList(ctx)};
  }catch{return null;}
}
function computeOperator(source,procedureId,nodeId,newValue,
                         predicateSource,skillName){
  if(typeof newValue!=="string"||!ID.test(newValue)||newValue.length>120)
    fail("Invalid Operator value");
  const ctx=findNode(source,procedureId,nodeId);
  const op=operatorChoices(ctx,predicateSource,skillName);
  if(!op)fail("This Operator is Source-only");
  if(op.type==="select"&&!op.values.includes(newValue))
    fail("Operator value is outside the qualified Package choices");
  if(newValue===ctx.node.value)fail("Operator value has not changed");
  const span=plainScalar(source,ctx.doc.getIn(
    ["procedures",procedureId,"nodes",nodeId,ctx.node.operator],true),ctx.node.value);
  const edit=replacement(source,span,newValue);
  const after=projectWorkspace(edit.candidateSource);
  if(after.state!=="READY")fail("New Operator value cannot be projected");
  const expected=snapshot(ctx.before);
  const node=expected.find(p=>p.name===procedureId).nodes.find(n=>n.id===nodeId);
  node.value=newValue;
  if(ctx.node.operator==="procedure"){
    const child=node.children.find(c=>c.via==="operator");
    if(!child)fail("Procedure child binding is unavailable");
    child.procedure=newValue;
    ensureAcyclic(after);
  }
  if(JSON.stringify(expected)!==JSON.stringify(snapshot(after)))
    fail("Operator edit modified unrelated semantic fields");
  return Object.freeze({
    type:"SetNodeOperatorValue",profile:"d2-node-operator-value-v1",
    procedureId,nodeId,operator:ctx.node.operator,
    oldValue:ctx.node.value,newValue,baseSource:source,
    ...edit,summary:nodeId+" · "+ctx.node.operator+" · "+
      ctx.node.value+" → "+newValue
  });
}
function computeBinding(source,procedureId,nodeId,bindingKey,newValue){
  if(typeof bindingKey!=="string"||!ID.test(bindingKey)||
     typeof newValue!=="string"||!REF.test(newValue)||newValue.length>240)
    fail("Invalid Binding selector or source");
  const ctx={...findNode(source,procedureId,nodeId),source};
  const bindings=bindingList(ctx);
  const binding=bindings.find(b=>b.key===bindingKey);
  if(!binding)fail("Binding is not source-qualified");
  if(!binding.choices.includes(newValue))
    fail("Binding must reuse an authored reference or Procedure input");
  if(binding.value===newValue)fail("Binding source is unchanged");
  const span=plainScalar(source,ctx.doc.getIn(
    ["procedures",procedureId,"nodes",nodeId,"with",bindingKey,"from"],true),
    binding.value);
  const edit=replacement(source,span,newValue);
  const after=projectWorkspace(edit.candidateSource);
  if(after.state!=="READY"||
     JSON.stringify(snapshot(ctx.before))!==JSON.stringify(snapshot(after)))
    fail("Binding edit changed Procedure graph semantics");
  const check={...findNode(edit.candidateSource,procedureId,nodeId),source:edit.candidateSource};
  const afterBinding=bindingList(check).find(b=>b.key===bindingKey);
  if(afterBinding?.value!==newValue)fail("Binding source was not reprojected");
  return Object.freeze({
    type:"SetNodeBindingFrom",profile:"d2-node-binding-from-v1",
    procedureId,nodeId,bindingKey,oldValue:binding.value,newValue,
    baseSource:source,...edit,
    summary:nodeId+" · with."+bindingKey+".from · "+
      binding.value+" → "+newValue
  });
}
function verifyPreview(source,preview,expected,type){
  if(!preview||preview.type!==type||source!==preview.baseSource)
    fail("Unsupported or stale Node attribute Preview");
  const keys=Object.keys(expected);
  if(keys.length!==Object.keys(preview).length||
     keys.some(k=>JSON.stringify(preview[k])!==JSON.stringify(expected[k])))
    fail("Node attribute Preview is tampered or stale");
  return expected.candidateSource;
}
export function previewNodeOperatorValue(source,procedureId,nodeId,newValue,
                                         predicateSource=null,skillName=null){
  return computeOperator(source,procedureId,nodeId,newValue,predicateSource,skillName);
}
export function applyNodeOperatorValue(source,preview,predicateSource=null,skillName=null){
  const expected=computeOperator(source,preview?.procedureId,preview?.nodeId,
    preview?.newValue,predicateSource,skillName);
  return verifyPreview(source,preview,expected,"SetNodeOperatorValue");
}
export function previewNodeBindingFrom(source,procedureId,nodeId,key,newValue){
  return computeBinding(source,procedureId,nodeId,key,newValue);
}
export function applyNodeBindingFrom(source,preview){
  const expected=computeBinding(source,preview?.procedureId,preview?.nodeId,
    preview?.bindingKey,preview?.newValue);
  return verifyPreview(source,preview,expected,"SetNodeBindingFrom");
}
