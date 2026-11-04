import {parseDocument,isMap,isSeq,isScalar} from "yaml";
import {projectWorkspace} from "./workspace.mjs";
import {phaseStepDependencyReport} from "./phase-dataflow.mjs";

// D4-A2.2b1: join authored producer provenance with the actual consumer
// SCRIPT inputSchema in the active Package. Only a declaration comparison:
// no automatic rewrites, no Runtime interpretation/validation claims.
const SCHEMA_NAME=/^[A-Za-z][A-Za-z0-9]*$/;
const SCHEMA_PATH=/^schemas\/[^/]+\.schema\.ya?ml$/;
const SOURCE_READY=new Set(["DECLARED_INPUT","EARLIER_LOCAL_STEP",
  "OWN_OPERATOR_PRIOR","GRAPH_PREDECESSOR_ONLY"]);
const KNOWN_TYPES=new Set(["string","integer","number","boolean","object",
  "array","null"]);
const freeze=Object.freeze;

function empty(status){
  return freeze({status,bindings:freeze([]),summary:freeze({
    count:0,typeOnly:0,mismatched:0,unknown:0,authorizedWrites:0
  })});
}
function scriptInputSchemaName(text){
  if(typeof text!=="string"||text.length>1024*1024)return null;
  const lines=text.slice(0,2048).split(/\r?\n/);
  if(lines[0]!=="# /// connectionagent-tool")return null;
  const end=lines.findIndex((line,i)=>i>0&&line==="# ///");
  if(end<2)return null;
  const declarations=lines.slice(1,end)
    .map(line=>/^# inputSchema: ([A-Za-z][A-Za-z0-9]*)$/.exec(line))
    .filter(Boolean);
  return declarations.length===1?declarations[0][1]:null;
}
function schemaByTitle(files,title){
  if(!(files instanceof Map)||!SCHEMA_NAME.test(title??""))
    return {status:"CONSUMER_SCHEMA_NOT_FOUND"};
  const candidates=[];
  for(const [path,entry] of files){
    if(!SCHEMA_PATH.test(path)||typeof entry?.text!=="string"||
      entry.text.length>1024*1024)continue;
    try{
      const doc=parseDocument(entry.text,{version:"1.2",schema:"core",
        strict:true,uniqueKeys:true,stringKeys:true,logLevel:"silent"});
      if(doc.errors.length||doc.get("title")!==title)continue;
      candidates.push({path,doc});
    }catch{/* malformed files cannot establish a contract */}
  }
  if(candidates.length!==1)return {
    status:candidates.length?"CONSUMER_SCHEMA_AMBIGUOUS":
      "CONSUMER_SCHEMA_NOT_FOUND"
  };
  const {path,doc}=candidates[0];
  const root=doc.contents;
  if(!isMap(root)||doc.get("type")!=="object")return {
    status:"CONSUMER_SCHEMA_ROOT_UNPROVEN",schema:path
  };
  return {status:"CONSUMER_SCHEMA_RESOLVED",schema:path,root};
}
function consumerInputEvidence(step,files,key){
  const bare={schema:null,type:null,required:null,constraints:freeze([])};
  if(step?.operator!=="script")
    return {...bare,status:"CONSUMER_ABI_UNAVAILABLE"};
  const file=files instanceof Map?files.get(step.value):null;
  const name=scriptInputSchemaName(file?.text);
  if(!name)return {...bare,status:"CONSUMER_SCRIPT_METADATA_UNAVAILABLE"};
  const schema=schemaByTitle(files,name);
  if(schema.status!=="CONSUMER_SCHEMA_RESOLVED")
    return {...bare,status:schema.status,schema:schema.schema??null};
  const {root}=schema;
  const fields=root.get("properties",true);
  const property=isMap(fields)?fields.get(key,true):null;
  if(!isMap(property))return {...bare,status:"CONSUMER_FIELD_NOT_DECLARED",
    schema:schema.schema};
  const typeNode=property.get("type",true);
  const type=isScalar(typeNode)&&KNOWN_TYPES.has(typeNode.value)?
    typeNode.value:null;
  const required=root.get("required",true);
  const requiredKeys=isSeq(required)?required.items.map(item=>item.value):[];
  const constraints=property.items.map(pair=>pair.key?.value)
    .filter(k=>typeof k==="string"&&k!=="type"&&
      !["title","description","examples","default"].includes(k))
    .sort();
  // This intentionally does not resolve $ref, combinators, const, enum,
  // number bounds, patterns or nested shapes. Even matching scalar types
  // cannot prove a safe dataflow rewrite.
  return {status:type?"CONSUMER_FIELD_DECLARED":
    "CONSUMER_FIELD_TYPE_UNPROVEN",
    schema:schema.schema,type,required:requiredKeys.includes(key),
    constraints:freeze(constraints)};
}
function compare(source,consumer){
  if(!SOURCE_READY.has(source.status))
    return "PRODUCER_ORDER_OR_SOURCE_UNPROVEN";
  if(consumer.status!=="CONSUMER_FIELD_DECLARED")
    return "CONSUMER_ABI_UNPROVEN";
  if(typeof source.outputType!=="string"||
    !KNOWN_TYPES.has(source.outputType)||
    (source.status!=="DECLARED_INPUT"&&
     source.contractStatus!=="SCRIPT_SCHEMA_FIELD_DECLARED"))
    return "PRODUCER_TYPE_UNAVAILABLE";
  return source.outputType===consumer.type?"TYPE_ONLY_MATCH":"TYPE_MISMATCH";
}
export function phaseConsumerContractReport(source,procedureId,nodeId,
                                             files=null,dependencies=null){
  const lineage=dependencies??phaseStepDependencyReport(source,procedureId,
    nodeId,files);
  if(lineage.status!=="READY")return empty(lineage.status);
  const workspace=projectWorkspace(source);
  const node=workspace.procedures.get(procedureId)?.nodes.find(n=>n.id===nodeId);
  if(!node)return empty("UNAVAILABLE");
  const bindings=[];
  for(const sourceEntry of lineage.bindings){
    const step=node.phases.find(p=>p.name===sourceEntry.phaseName)
      ?.steps[sourceEntry.stepIndex];
    const consumer=consumerInputEvidence(step,files,sourceEntry.bindingKey);
    const typeRelation=compare(sourceEntry,consumer);
    bindings.push(freeze({
      phaseName:sourceEntry.phaseName,stepIndex:sourceEntry.stepIndex,
      bindingKey:sourceEntry.bindingKey,sourceValue:sourceEntry.value,
      producerStatus:sourceEntry.status,
      producerSchema:sourceEntry.contractSchema,
      producerType:sourceEntry.outputType,
      consumerOperator:step?.operator??null,
      consumerName:step?.value??null,
      consumerStatus:consumer.status,consumerSchema:consumer.schema,
      consumerType:consumer.type,consumerRequired:consumer.required,
      consumerConstraints:consumer.constraints,
      typeRelation,editEligible:false
    }));
  }
  const typeOnly=bindings.filter(b=>b.typeRelation==="TYPE_ONLY_MATCH").length;
  const mismatched=bindings.filter(b=>b.typeRelation==="TYPE_MISMATCH").length;
  return freeze({status:"READY",bindings:freeze(bindings),
    summary:freeze({count:bindings.length,typeOnly,mismatched,
      unknown:bindings.length-typeOnly-mismatched,authorizedWrites:0})});
}
