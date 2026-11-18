import {parseDocument,LineCounter,isMap,isSeq,isScalar} from "yaml";

const CORE_FILES=Object.freeze({
  contract:"assurance/contract.yaml",
  procedure:"assurance/procedure.yaml",
  predicates:"assurance/predicates.yaml"
});
const ALIAS=/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const SCHEMA_REF=/^([a-z][a-z0-9]*(?:-[a-z0-9]+)*)::(.+)$/;
const TOOL_REF=/^([a-z][a-z0-9]*(?:-[a-z0-9]+)*)::([A-Za-z0-9_][A-Za-z0-9_.-]*)$/;
const STAGES=["precondition","operation","observation","postcondition"];
const scalar=node=>isScalar(node)?node.value:null;
const entries=node=>isMap(node)?node.items:[];
const get=(node,key)=>isMap(node)?node.get(key,true):null;
const safePath=value=>typeof value==="string"&&value.length>0&&
  !value.startsWith("/")&&!value.includes("\\")&&
  value.split("/").every(part=>part&&part!=="."&&part!=="..");

function parseYaml(path,file){
  if(typeof file?.text!=="string")return null;
  const counter=new LineCounter();
  const document=parseDocument(file.text,{
    version:"1.2",schema:"core",strict:true,uniqueKeys:true,
    stringKeys:true,lineCounter:counter,logLevel:"silent"
  });
  if(document.errors.length||!isMap(document.contents))return null;
  return {root:document.contents,counter,text:file.text};
}
function sourceLocation(parsed,node){
  const offset=Array.isArray(node?.range)?node.range[0]:0;
  const position=parsed?.counter?.linePos?.(offset)??{line:1,col:1};
  return {line:position.line||1,column:position.col||1};
}
function diagnostic(path,parsed,node,code,message,severity="error"){
  return {
    kind:"package-diagnostic",severity,code,path,
    ...sourceLocation(parsed,node),message,
    source:"Skill Studio · v1alpha5 package audit"
  };
}
function add(list,path,parsed,node,code,message,severity="error"){
  if(list.length>=240)return;
  list.push(diagnostic(path,parsed,node,code,message,severity));
}
function schemaIds(text){
  const parsed=parseDocument(text,{version:"1.2",schema:"core",strict:true,
    uniqueKeys:true,stringKeys:true,logLevel:"silent"});
  if(parsed.errors.length||!isMap(parsed.contents))return [];
  const ids=[];
  for(const key of ["$id","id","schemaId"]){
    const value=scalar(parsed.contents.get(key,true));
    if(typeof value==="string"&&value)ids.push(value);
  }
  return ids;
}
function resolverMessage(diagnostics,id){
  const item=(diagnostics??[]).find(value=>value.dependencyId===id);
  return item?.message??"No verified immutable dependency snapshot is available";
}

/**
 * Package-local v1alpha5 checks. These are deliberately not Compiler or
 * Owner qualification: unavailable trusted declarations are emitted as
 * NOT_CHECKED diagnostics rather than silently treated as PASS.
 */
export function auditV1Alpha5Package({
  name,files,dependencyContext={}
}={}){
  if(!(files instanceof Map)||
     ![CORE_FILES.contract,CORE_FILES.procedure,CORE_FILES.predicates]
       .every(path=>typeof files.get(path)?.text==="string"))
    return [];

  const contract=parseYaml(CORE_FILES.contract,files.get(CORE_FILES.contract));
  const procedure=parseYaml(CORE_FILES.procedure,files.get(CORE_FILES.procedure));
  const predicates=parseYaml(CORE_FILES.predicates,files.get(CORE_FILES.predicates));
  if(!contract||!procedure||!predicates)return [];

  const diagnostics=[];
  const declarations=Array.isArray(dependencyContext.declarations)
    ?dependencyContext.declarations:[];
  const snapshots=Array.isArray(dependencyContext.snapshots)
    ?dependencyContext.snapshots:[];
  const dependencyDiagnostics=Array.isArray(dependencyContext.diagnostics)
    ?dependencyContext.diagnostics:[];
  const operations=Array.isArray(dependencyContext.operations)
    ?dependencyContext.operations:[];
  const schemas=Array.isArray(dependencyContext.schemas)
    ?dependencyContext.schemas:[];
  const contextAvailable=dependencyContext.available===true;
  const declarationById=new Map(declarations.map(item=>[item.id,item]));
  const snapshotById=new Map(snapshots.map(item=>[item.id,item]));
  const dependencyNode=get(contract.root,"dependencies");
  const contractDependencies=new Map();

  if(!isMap(dependencyNode)){
    add(diagnostics,CORE_FILES.contract,contract,dependencyNode,
      "DEPENDENCIES_INVALID","Contract dependencies must be a mapping");
  }else{
    for(const pair of dependencyNode.items){
      const alias=scalar(pair.key),reference=scalar(pair.value);
      if(typeof alias!=="string"||!ALIAS.test(alias)){
        add(diagnostics,CORE_FILES.contract,contract,pair.key,
          "DEPENDENCY_ALIAS_INVALID","Dependency alias must use lowercase kebab-case");
        continue;
      }
      if(typeof reference!=="string"||!reference.trim()){
        add(diagnostics,CORE_FILES.contract,contract,pair.value,
          "DEPENDENCY_REFERENCE_INVALID","Dependency "+alias+" must reference a non-empty package identity");
        continue;
      }
      contractDependencies.set(alias,{reference,node:pair.value,key:pair.key});
      if(!contextAvailable){
        add(diagnostics,CORE_FILES.contract,contract,pair.value,
          "DEPENDENCY_LINK_NOT_CHECKED",
          "Dependency "+alias+" ("+reference+") is declared, but the project Dependency Service state is unavailable; linking is NOT_CHECKED",
          "warning");
        continue;
      }
      const declaration=declarationById.get(alias);
      if(!declaration){
        add(diagnostics,CORE_FILES.contract,contract,pair.value,
          "DEPENDENCY_NOT_CONFIGURED",
          "Contract dependency "+alias+" ("+reference+") has no matching project-managed dependency declaration or pinned snapshot");
        continue;
      }
      if(!snapshotById.has(alias)){
        add(diagnostics,CORE_FILES.contract,contract,pair.value,
          "DEPENDENCY_SNAPSHOT_UNAVAILABLE",
          "Dependency "+alias+" has no verified immutable snapshot: "+
            resolverMessage(dependencyDiagnostics,alias));
      }
    }
  }

  const capabilityNode=get(contract.root,"capabilities");
  if(capabilityNode!==null){
    if(!isSeq(capabilityNode)){
      add(diagnostics,CORE_FILES.contract,contract,capabilityNode,
        "CAPABILITY_GRANTS_INVALID","Contract capabilities must be an ordered list");
    }else{
      const seen=new Set();
      for(const item of capabilityNode.items){
        const id=scalar(item);
        if(typeof id!=="string"||!id.trim()){
          add(diagnostics,CORE_FILES.contract,contract,item,
            "CAPABILITY_GRANT_INVALID","Capability grant must be a non-empty CapabilityId");
          continue;
        }
        if(seen.has(id)){
          add(diagnostics,CORE_FILES.contract,contract,item,
            "CAPABILITY_GRANT_DUPLICATE","Capability grant is duplicated: "+id);
          continue;
        }
        seen.add(id);
        add(diagnostics,CORE_FILES.contract,contract,item,
          "CAPABILITY_GRANT_NOT_CHECKED",
          "Capability grant reference "+id+
            " has no trusted CapabilityContracts declaration source in the current Studio snapshot; uniqueness and membership are NOT_CHECKED",
          "warning");
      }
    }
  }

  const requestSchema=get(contract.root,"requestSchema");
  const requestSchemaPath=scalar(requestSchema);
  if(typeof requestSchemaPath!=="string"||!safePath(requestSchemaPath)){
    add(diagnostics,CORE_FILES.contract,contract,requestSchema,
      "REQUEST_SCHEMA_REFERENCE_INVALID","Contract requestSchema must be a safe Package-relative path");
  }else if(!files.has(requestSchemaPath)){
    add(diagnostics,CORE_FILES.contract,contract,requestSchema,
      "REQUEST_SCHEMA_NOT_FOUND","Request Schema is not present in the complete Package snapshot: "+requestSchemaPath);
  }

  const checkSchemaReference=(path,parsed,node,reference,label)=>{
    if(typeof reference!=="string")return;
    const match=SCHEMA_REF.exec(reference);
    if(!match){
      if(!safePath(reference))
        add(diagnostics,path,parsed,node,"SCHEMA_REFERENCE_INVALID",
          label+" must be a Package-relative path or alias::SchemaId reference");
      else if(!files.has(reference))
        add(diagnostics,path,parsed,node,"SCHEMA_DECLARATION_NOT_FOUND",
          label+" is not present in the complete Package snapshot: "+reference);
      return;
    }
    const [,alias,id]=match;
    if(!contractDependencies.has(alias)){
      add(diagnostics,path,parsed,node,"SCHEMA_DEPENDENCY_UNDECLARED",
        label+" references undeclared dependency alias "+alias);
      return;
    }
    if(!contextAvailable){
      add(diagnostics,path,parsed,node,"SCHEMA_LINK_NOT_CHECKED",
        label+" references "+alias+"::"+id+
          ", but the project Dependency Service state is unavailable; linking is NOT_CHECKED",
        "warning");
      return;
    }
    const declaration=declarationById.get(alias);
    const snapshot=snapshotById.get(alias);
    if(!declaration||!snapshot){
      add(diagnostics,path,parsed,node,"SCHEMA_DEPENDENCY_UNAVAILABLE",
        label+" cannot resolve "+alias+"::"+id+": "+
          resolverMessage(dependencyDiagnostics,alias));
      return;
    }
    if(declaration.kind!=="schema-bundle"){
      add(diagnostics,path,parsed,node,"SCHEMA_EXPORT_NOT_CHECKED",
        label+" references "+alias+"::"+id+
          ", but "+alias+" is not a Schema Bundle; the current Studio linker does not inspect Owner Schema exports from this dependency",
        "warning");
      return;
    }
    const matches=schemas.filter(item=>item.dependencyId===alias&&
      typeof item.text==="string"&&schemaIds(item.text).includes(id));
    if(matches.length===0){
      add(diagnostics,path,parsed,node,"SCHEMA_DECLARATION_NOT_FOUND",
        label+" has no exact SchemaId declaration in the locked "+alias+" snapshot: "+id);
    }else if(matches.length>1){
      add(diagnostics,path,parsed,node,"SCHEMA_DECLARATION_AMBIGUOUS",
        label+" resolves to multiple declarations in the locked "+alias+" snapshot: "+id);
    }
  };

  const contextSchema=get(contract.root,"contextSchema");
  if(contextSchema!==null)
    checkSchemaReference(CORE_FILES.contract,contract,contextSchema,
      scalar(contextSchema),"Contract contextSchema");

  const predicateRoot=get(predicates.root,"predicates");
  const predicateIds=new Set(entries(predicateRoot).map(pair=>scalar(pair.key)).filter(Boolean));
  if(isMap(predicateRoot)){
    for(const pair of predicateRoot.items){
      const predicateId=scalar(pair.key),body=pair.value;
      const parameters=get(body,"parameters");
      if(isSeq(parameters))for(const parameter of parameters.items){
        if(!isMap(parameter))continue;
        for(const item of parameter.items){
          const type=scalar(item.value);
          if(typeof type==="string"&&SCHEMA_REF.test(type))
            checkSchemaReference(CORE_FILES.predicates,predicates,item.value,type,
              "Predicate "+predicateId+" parameter "+String(scalar(item.key)));
        }
      }
      const evidence=get(body,"evidence");
      const requirements=get(evidence,"requires");
      if(isMap(requirements))for(const requirement of requirements.items){
        if(!isSeq(requirement.value))continue;
        for(const item of requirement.value.items){
          const reference=scalar(item);
          const match=typeof reference==="string"?SCHEMA_REF.exec(reference):null;
          if(match&&!contractDependencies.has(match[1])){
            add(diagnostics,CORE_FILES.predicates,predicates,item,
              "EVIDENCE_DEPENDENCY_UNDECLARED",
              "Evidence reference "+reference+" uses undeclared dependency alias "+match[1]);
          }else if(typeof reference==="string"){
            add(diagnostics,CORE_FILES.predicates,predicates,item,
              "EVIDENCE_GUARANTEE_NOT_CHECKED",
              "Evidence guarantee "+reference+
                " requires a trusted Owner Evidence declaration; current Studio snapshot cannot verify it",
              "warning");
          }
        }
      }
      const evaluator=get(body,"evaluator");
      if(scalar(get(evaluator,"type"))==="script"){
        const script=get(evaluator,"script"),scriptPath=scalar(script);
        if(typeof scriptPath!=="string"||!safePath(scriptPath)||!files.has(scriptPath))
          add(diagnostics,CORE_FILES.predicates,predicates,script,
            "PREDICATE_SCRIPT_NOT_FOUND",
            "Predicate "+predicateId+" Script is not present in the complete Package snapshot: "+String(scriptPath??""));
      }
    }
  }

  const nodes=get(procedure.root,"nodes");
  const declaredNodes=new Map(entries(nodes).map(pair=>[scalar(pair.key),pair.value]));
  const checkProducer=(path,parsed,node,value)=>{
    if(typeof value!=="string")return;
    const match=/^([A-Za-z][A-Za-z0-9_-]*)\.(operation|observation|wait)\.output(?:\.|$)/.exec(value);
    if(!match)return;
    const [,producer,stage]=match;
    const body=declaredNodes.get(producer);
    if(!body){
      add(diagnostics,path,parsed,node,"PRODUCER_NODE_NOT_FOUND",
        "Source reference "+value+" names an undeclared Node: "+producer);
      return;
    }
    const stageNode=get(body,stage);
    if(!stageNode){
      add(diagnostics,path,parsed,node,"PRODUCER_STAGE_NOT_FOUND",
        "Source reference "+value+" names a Node without the declared "+stage+" stage/control");
    }
  };

  for(const nodePair of entries(nodes)){
    const nodeId=scalar(nodePair.key),body=nodePair.value;
    for(const stageName of STAGES){
      const stage=get(body,stageName);
      if(!isMap(stage))continue;
      const tool=get(stage,"tool");
      const toolId=scalar(tool);
      if(tool!==null){
        const match=typeof toolId==="string"?TOOL_REF.exec(toolId):null;
        if(!match){
          add(diagnostics,CORE_FILES.procedure,procedure,tool,
            "TOOL_REFERENCE_INVALID",
            "Tool reference must use dependencyAlias::callableId: "+String(toolId??""));
        }else{
          const [,alias,callableId]=match;
          if(!contractDependencies.has(alias)){
            add(diagnostics,CORE_FILES.procedure,procedure,tool,
              "TOOL_DEPENDENCY_UNDECLARED",
              "Node "+nodeId+" references Tool "+toolId+
                " but Contract.dependencies does not declare alias "+alias);
          }else if(!contextAvailable){
            add(diagnostics,CORE_FILES.procedure,procedure,tool,
              "TOOL_LINK_NOT_CHECKED",
              "Tool "+toolId+" cannot be checked because the project Dependency Service state is unavailable",
              "warning");
          }else{
            const declaration=declarationById.get(alias);
            const snapshot=snapshotById.get(alias);
            if(!declaration||!snapshot){
              add(diagnostics,CORE_FILES.procedure,procedure,tool,
                "TOOL_DEPENDENCY_UNAVAILABLE",
                "Tool "+toolId+" has no verified locked dependency "+alias+": "+
                  resolverMessage(dependencyDiagnostics,alias));
            }else if(declaration.kind!=="tool-catalog"){
              add(diagnostics,CORE_FILES.procedure,procedure,tool,
                "TOOL_DEPENDENCY_KIND_MISMATCH",
                "Tool "+toolId+" requires a Tool Catalog dependency, but "+alias+
                  " is declared as "+declaration.kind);
            }else{
              const matches=operations.filter(item=>item.dependencyId===alias&&
                item.id===callableId);
              if(matches.length===0){
                add(diagnostics,CORE_FILES.procedure,procedure,tool,
                  "TOOL_DECLARATION_NOT_FOUND",
                  "Tool "+toolId+" has no matching callable declaration in the locked "+alias+" Tool Catalog");
              }else if(matches.length>1){
                add(diagnostics,CORE_FILES.procedure,procedure,tool,
                  "TOOL_DECLARATION_AMBIGUOUS",
                  "Tool "+toolId+" has multiple callable declarations in the locked "+alias+" Tool Catalog");
              }
            }
          }
        }
      }
      const script=get(stage,"script"),scriptPath=scalar(script);
      if(script!==null&&
         (typeof scriptPath!=="string"||!safePath(scriptPath)||!files.has(scriptPath))){
        add(diagnostics,CORE_FILES.procedure,procedure,script,
          "PROCEDURE_SCRIPT_NOT_FOUND",
          "Node "+nodeId+" Script is not present in the complete Package snapshot: "+String(scriptPath??""));
      }
      const argumentsNode=get(stage,"arguments");
      if(isMap(argumentsNode))for(const argument of argumentsNode.items)
        checkProducer(CORE_FILES.procedure,procedure,argument.value,scalar(argument.value));
      const calls=get(stage,"predicates");
      if(isSeq(calls))for(const call of calls.items){
        const predicate=get(call,"predicate"),predicateId=scalar(predicate);
        if(typeof predicateId==="string"&&!predicateIds.has(predicateId))
          add(diagnostics,CORE_FILES.procedure,procedure,predicate,
            "PREDICATE_REFERENCE_NOT_FOUND",
            "Node "+nodeId+" references an undeclared Predicate: "+predicateId);
        const argumentsList=get(call,"arguments");
        if(isSeq(argumentsList))for(const argument of argumentsList.items)
          checkProducer(CORE_FILES.procedure,procedure,argument,scalar(argument));
      }
    }
  }

  return Object.freeze(diagnostics);
}

export const V1ALPHA5_PACKAGE_AUDIT_FILES=CORE_FILES;
