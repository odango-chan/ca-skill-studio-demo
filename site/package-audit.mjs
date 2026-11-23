import {parseDocument,LineCounter,isMap,isSeq,isScalar} from "yaml";

const FILES=Object.freeze({
  contract:"assurance/contract.yaml",
  procedure:"assurance/procedure.yaml",
  predicates:"assurance/predicates.yaml"
});
const ALIAS=/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const QUALIFIED_REF=/^([a-z][a-z0-9]*(?:-[a-z0-9]+)*)::(.+)$/;
const TOOL_REF=/^([a-z][a-z0-9]*(?:-[a-z0-9]+)*)::([A-Za-z0-9_][A-Za-z0-9_.-]*)$/;
const STAGES=["precondition","operation","observation","postcondition"];
const scalar=node=>isScalar(node)&&typeof node.value==="string"?node.value:null;
const entries=node=>isMap(node)?node.items:[];
const get=(node,key)=>isMap(node)?node.get(key,true):null;
const safePath=value=>typeof value==="string"&&value.length>0&&value.length<=240&&
  !value.startsWith("/")&&!/^[A-Za-z]:/.test(value)&&!value.includes("\\")&&
  !/[\u0000-\u001f:*?"<>|]/.test(value)&&
  value.split("/").every(part=>part&&part!=="."&&part!=="..");

function parseYaml(path,file,diagnostics){
  if(typeof file?.text!=="string")return null;
  const counter=new LineCounter();
  let document;
  try{
    document=parseDocument(file.text,{
      version:"1.2",schema:"core",strict:true,uniqueKeys:true,
      stringKeys:true,keepSourceTokens:true,lineCounter:counter,logLevel:"silent"
    });
  }catch(error){
    add(diagnostics,path,null,null,"PACKAGE_YAML_PARSE_ERROR",
      "Cannot parse "+path+": "+String(error?.message??error),
      {domain:"source",status:"confirmed",severity:"error"});
    return null;
  }
  const parsed={root:isMap(document.contents)?document.contents:null,counter,text:file.text};
  for(const error of document.errors??[]){
    const node={range:[error.pos?.[0]??0,error.pos?.[1]??error.pos?.[0]??0]};
    add(diagnostics,path,parsed,node,"PACKAGE_YAML_PARSE_ERROR",
      "Cannot parse "+path+": "+error.message,
      {domain:"source",status:"confirmed",severity:"error"});
  }
  if(!parsed.root){
    add(diagnostics,path,parsed,document.contents,"PACKAGE_YAML_ROOT_INVALID",
      path+" must have a YAML mapping root",
      {domain:"source",status:"confirmed",severity:"error"});
    return null;
  }
  return parsed;
}
function sourceLocation(parsed,node){
  const offset=Array.isArray(node?.range)?node.range[0]:0;
  const position=parsed?.counter?.linePos?.(offset)??{line:1,col:1};
  return {line:position.line||1,column:position.col||1};
}
function add(list,path,parsed,node,code,message,{
  severity="error",status="confirmed",domain="package",category="reference"
}={}){
  if(list.length>=400)return;
  const location=sourceLocation(parsed,node);
  const sourceRange=Array.isArray(node?.range)&&
    Number.isSafeInteger(node.range[0])&&Number.isSafeInteger(node.range[1])&&
    node.range[0]>=0&&node.range[1]>=node.range[0]
      ?{start:node.range[0],end:node.range[1]}:null;
  const id=[code,path,location.line,location.column,message].join("|");
  if(list.some(item=>item.id===id))return;
  list.push(Object.freeze({
    id,kind:"package-diagnostic",code,message,severity,status,domain,category,
    path,relativePath:path,...location,
    ...(sourceRange?{sourceRange}:{}),
    source:"Skill Studio · Package Audit"
  }));
}
function resolverMessage(diagnostics,id){
  const item=(diagnostics??[]).find(value=>value.dependencyId===id);
  return item?.message??"No verified immutable dependency snapshot is available";
}
function schemaIds(text){
  let parsed;
  try{
    parsed=parseDocument(text,{version:"1.2",schema:"core",strict:true,
      uniqueKeys:true,stringKeys:true,logLevel:"silent"});
  }catch{return {ids:[],parseable:false};}
  if(parsed.errors.length||!isMap(parsed.contents))return {ids:[],parseable:false};
  const ids=[];
  for(const key of ["$id","id","schemaId"]){
    const value=scalar(parsed.contents.get(key,true));
    if(value)ids.push(value);
  }
  return {ids,parseable:true};
}

const SUPPORTED_SCHEMA_DIALECT="https://json-schema.org/draft/2020-12/schema";

/**
 * Parse local JSON Schema documents without reimplementing JSON Schema
 * semantics. The local audit owns YAML/JSON syntax, the declared dialect and
 * package-local $id uniqueness; full keyword/instance semantics remain with
 * the selected JSON Schema implementation in the Compiler.
 */
function auditLocalSchema(path,file,diagnostics,ids){
  if(typeof file?.text!=="string")return;
  const counter=new LineCounter();
  let document;
  try{
    document=parseDocument(file.text,{
      version:"1.2",schema:"core",strict:true,uniqueKeys:true,
      stringKeys:true,keepSourceTokens:true,lineCounter:counter,logLevel:"silent"
    });
  }catch(error){
    add(diagnostics,path,{counter,text:file.text},
      {range:[error?.pos?.[0]??0,error?.pos?.[1]??error?.pos?.[0]??0]},
      "SCHEMA_DOCUMENT_PARSE_ERROR",
      "Cannot parse local Schema "+path+": "+String(error?.message??error),
      {domain:"schemas",category:"syntax"});
    return;
  }
  // JSON files must be valid JSON, not merely YAML-compatible flow mappings.
  // The YAML parser above populates LineCounter so JSON parser offsets retain
  // exact line/column information when the JSON grammar rejects a file.
  if(/\.json$/i.test(path)){
    try{JSON.parse(file.text);}
    catch(error){
      const message=String(error?.message??error);
      const positionMatch=/position\s+(\d+)/i.exec(message);
      const parsed={counter,text:file.text};
      const node=positionMatch
        ?{range:[Number(positionMatch[1]),Math.min(file.text.length,Number(positionMatch[1])+1)]}
        :null;
      add(diagnostics,path,parsed,node,
        "SCHEMA_DOCUMENT_PARSE_ERROR",
        "Cannot parse local JSON Schema "+path+": "+message,
        {domain:"schemas",category:"syntax"});
      return;
    }
  }
  const parsed={root:isMap(document.contents)?document.contents:null,counter,text:file.text};
  for(const error of document.errors??[]){
    add(diagnostics,path,parsed,
      {range:[error.pos?.[0]??0,error.pos?.[1]??error.pos?.[0]??0]},
      "SCHEMA_DOCUMENT_PARSE_ERROR",
      "Cannot parse local Schema "+path+": "+error.message,
      {domain:"schemas",category:"syntax"});
  }
  if(document.errors?.length)return;
  if(!parsed.root){
    // JSON Schema permits boolean schemas as complete documents.
    if(isScalar(document.contents)&&typeof document.contents.value==="boolean")return;
    add(diagnostics,path,parsed,document.contents,
      "SCHEMA_DOCUMENT_ROOT_INVALID",
      "Local Schema "+path+" must have a JSON Schema object or boolean root",
      {domain:"schemas",category:"structure"});
    return;
  }

  const dialectNode=get(parsed.root,"$schema");
  const dialect=scalar(dialectNode);
  if(dialectNode==null){
    addNotChecked(diagnostics,path,parsed,null,
      "SCHEMA_DIALECT_NOT_CHECKED",
      "Local Schema "+path+" does not declare $schema; its JSON Schema dialect is NOT_CHECKED",
      "schemas");
  }else if(!dialect){
    add(diagnostics,path,parsed,dialectNode,
      "SCHEMA_DIALECT_INVALID",
      "Local Schema $schema must be a non-empty dialect URI",
      {domain:"schemas",category:"structure"});
  }else if(dialect!==SUPPORTED_SCHEMA_DIALECT){
    add(diagnostics,path,parsed,dialectNode,
      "SCHEMA_DIALECT_UNSUPPORTED",
      "Local Schema "+path+" declares unsupported JSON Schema dialect "+dialect+
        "; Skill Studio local linking supports "+SUPPORTED_SCHEMA_DIALECT,
      {domain:"schemas",category:"structure"});
  }

  const idNode=get(parsed.root,"$id");
  if(idNode!=null){
    const id=scalar(idNode);
    if(!id){
      add(diagnostics,path,parsed,idNode,
        "SCHEMA_ID_INVALID","Local Schema $id must be a non-empty string",
        {domain:"schemas",category:"structure"});
    }else if(ids.has(id)){
      add(diagnostics,path,parsed,idNode,
        "SCHEMA_ID_DUPLICATE",
        "Local Schema $id is duplicated: "+id+" (first declared in "+ids.get(id)+")",
        {domain:"schemas",category:"linking"});
    }else{
      ids.set(id,path);
    }
  }
}
/**
 * Index callable identities from a previously verified immutable snapshot.
 * the current CA-SL language contract inherits ToolCatalog v1alpha4 (F.1); a legacy skillc.tool/v0.1
 * JSON file or an arbitrary 'operations' list is never a trusted substitute.
 *
 * This index proves only structural declaration presence. It does not qualify
 * Owner identity, Capability authorization, Schema typing or runtime effects.
 */
export function indexV1Alpha4ToolCatalogCallables(dependencyId,files){
  const fail=reason=>({dependencyId,available:false,reason,operations:[]});
  if(!Array.isArray(files))return fail("The verified snapshot has no file inventory");
  const operations=[];
  let catalogCount=0;
  for(const file of [...files].sort((a,b)=>String(a.path).localeCompare(String(b.path)))){
    if(typeof file.path!=="string"||!/\.(?:json|ya?ml)$/i.test(file.path))continue;
    const filenameHint=/(?:^|\/)tool[-_]?catalog(?:[.-]|$)/i.test(file.path);
    if(typeof file.text!=="string"){
      if(filenameHint)return fail("ToolCatalog "+file.path+" has no decodable text");
      continue;
    }
    let document;
    try{
      document=parseDocument(file.text,{version:"1.2",schema:"core",
        strict:true,uniqueKeys:true,stringKeys:true,logLevel:"silent"});
    }catch(error){
      if(filenameHint)return fail("ToolCatalog "+file.path+" is unreadable: "+String(error?.message??error));
      continue;
    }
    const root=document.contents;
    const kind=scalar(get(root,"kind"));
    if(kind!=="ToolCatalog"&&!filenameHint)continue;
    if(document.errors?.length||!isMap(root))
      return fail("ToolCatalog "+file.path+" has invalid YAML/JSON syntax");
    if(kind!=="ToolCatalog")
      return fail("ToolCatalog "+file.path+" must declare kind: ToolCatalog");
    if(scalar(get(root,"apiVersion"))!=="connectionagent.io/toolcatalog/v1alpha4")
      return fail("ToolCatalog "+file.path+" requires apiVersion connectionagent.io/toolcatalog/v1alpha4; no legacy fallback");
    const owner=scalar(get(get(root,"metadata"),"owner"));
    const contracts=get(get(root,"spec"),"contracts");
    if(!owner?.trim()||!isSeq(contracts)||contracts.items.length===0)
      return fail("ToolCatalog "+file.path+" requires metadata.owner and nonempty spec.contracts");
    catalogCount++;
    for(const item of contracts.items){
      const id=scalar(get(item,"id")),callableKind=scalar(get(item,"kind"));
      const effect=scalar(get(item,"effect")),output=get(get(item,"outputSchema"),"$ref");
      const input=get(get(item,
        callableKind==="observation"?"queryContextSchema":"inputSchema"),"$ref");
      const outcomes=get(item,"ownerOutcomes");
      const validOutcomes=isSeq(outcomes)&&outcomes.items.some(v=>scalar(v)==="SUCCEEDED");
      if(!isMap(item)||!id?.trim()||
         !["operation","observation"].includes(callableKind)||
         !["READ","MUTATION"].includes(effect)||
         (callableKind==="observation"&&effect!=="READ")||
         !scalar(output)||!scalar(input)||!validOutcomes)
        return fail("ToolCatalog "+file.path+" has an invalid callable identity or required F.1 fields");
      if(callableKind==="observation"&&get(item,"inputSchema")!=null||
         callableKind==="operation"&&get(item,"queryContextSchema")!=null)
        return fail("ToolCatalog "+file.path+" mixes Operation and Observation input Schema fields");
      const idNode=get(item,"id");
      const idRange=Array.isArray(idNode?.range)&&
        Number.isSafeInteger(idNode.range[0])&&
        Number.isSafeInteger(idNode.range[1])
          ?{start:idNode.range[0],end:idNode.range[1]}:null;
      operations.push({
        dependencyId,id,kind:callableKind,owner,effect,
        catalogPath:file.path,idRange
      });
    }
  }
  if(!catalogCount)
    return fail("No v1alpha4 ToolCatalog declaration is present in the locked snapshot");
  return {dependencyId,available:true,operations};
}

function addNotChecked(list,path,parsed,node,code,message,domain){
  add(list,path,parsed,node,code,message,{
    severity:"warning",status:"not_checked",domain,category:"linking"
  });
}
function addBlocked(list,path,parsed,node,code,message,domain){
  add(list,path,parsed,node,code,message,{
    severity:"error",status:"blocked",domain,category:"linking"
  });
}

/**
 * Bounded, read-only current CA-SL Package checks. This is not Compiler Check,
 * Owner qualification, Capability authorization or Runtime execution.
 *
 * External declarations are checked only when their exact trusted snapshot is
 * supplied. Missing trust inputs produce visible NOT_CHECKED diagnostics.
 *
 * @param {{files?: Map<string, {text: string}>, dependencyContext?: Record<string, unknown>,
 *   completeness?: string, snapshotReason?: string}} options
 */
export function auditPackage({
  files,dependencyContext={},completeness="complete",snapshotReason=""
}={}){
  const diagnostics=[];
  if(!(files instanceof Map)){
    add(diagnostics,FILES.procedure,null,null,"PACKAGE_INVENTORY_UNAVAILABLE",
      "The complete Package file inventory is unavailable",
      {severity:"warning",status:"not_checked",domain:"package",category:"snapshot"});
    return Object.freeze(diagnostics);
  }

  if(completeness!=="complete"){
    add(diagnostics,FILES.procedure,null,null,"PACKAGE_SNAPSHOT_INCOMPLETE",
      "Package checks are partial; missing files and exports cannot be treated as confirmed defects"+
        (snapshotReason?": "+snapshotReason:""),
      {severity:"warning",status:"not_checked",domain:"package",category:"snapshot"});
  }

  const parsed=new Map();
  for(const path of Object.values(FILES)){
    const file=files.get(path);
    if(!file||typeof file.text!=="string"){
      if(completeness==="complete"){
        add(diagnostics,path,null,null,"PACKAGE_CORE_FILE_MISSING",
          "Required current CA-SL Package file is missing: "+path,
          {severity:"error",status:"confirmed",domain:"package",category:"inventory"});
      }
      continue;
    }
    const result=parseYaml(path,file,diagnostics);
    if(result)parsed.set(path,result);
  }
  const contract=parsed.get(FILES.contract);
  const procedure=parsed.get(FILES.procedure);
  const predicates=parsed.get(FILES.predicates);
  // Parse every local Schema document even when it is not the first referenced
  // request Schema. This catches malformed package-owned interfaces before
  // Compiler Check, while keeping full JSON Schema semantics Compiler-owned.
  const localSchemaIds=new Map();
  for(const [path,file] of [...files.entries()].sort((a,b)=>a[0].localeCompare(b[0]))){
    if(/^schemas\/.+\.(?:json|ya?ml)$/i.test(path))
      auditLocalSchema(path,file,diagnostics,localSchemaIds);
  }
  // Continue independent checks when one core document is missing or malformed.
  // Cross-document checks below emit NOT_CHECKED where the missing document is
  // required to establish an identity; they never silently stop the audit.

  const declarations=Array.isArray(dependencyContext.declarations)
    ?dependencyContext.declarations:[];
  const snapshots=Array.isArray(dependencyContext.snapshots)
    ?dependencyContext.snapshots:[];
  const dependencyDiagnostics=Array.isArray(dependencyContext.diagnostics)
    ?dependencyContext.diagnostics:[];
  const operations=Array.isArray(dependencyContext.operations)
    ?dependencyContext.operations:[];
  const toolCatalogs=Array.isArray(dependencyContext.toolCatalogs)
    ?dependencyContext.toolCatalogs:[];
  const schemas=Array.isArray(dependencyContext.schemas)
    ?dependencyContext.schemas:[];
  const capabilityDeclarations=Array.isArray(dependencyContext.capabilityDeclarations)
    ?dependencyContext.capabilityDeclarations:null;
  const capabilityDeclarationsComplete=dependencyContext.capabilityDeclarationsComplete===true;
  const evidenceDeclarations=Array.isArray(dependencyContext.evidenceDeclarations)
    ?dependencyContext.evidenceDeclarations:null;
  const evidenceDeclarationsComplete=dependencyContext.evidenceDeclarationsComplete===true;
  const contextAvailable=dependencyContext.available===true;
  const declarationById=new Map(declarations.map(item=>[item.id,item]));
  const snapshotById=new Map(snapshots.map(item=>[item.id,item]));
  const contractDependencies=new Map();
  const dependencyNode=contract?get(contract.root,"dependencies"):null;

  if(contract&&dependencyNode!=null&&!isMap(dependencyNode)){
    add(diagnostics,FILES.contract,contract,dependencyNode,
      "DEPENDENCIES_INVALID","Contract dependencies must be a mapping");
  }else if(contract){
    for(const pair of entries(dependencyNode)){
      const alias=scalar(pair.key),reference=scalar(pair.value);
      if(!alias||!ALIAS.test(alias)){
        add(diagnostics,FILES.contract,contract,pair.key,
          "DEPENDENCY_ALIAS_INVALID","Dependency alias must use lowercase kebab-case");
        continue;
      }
      if(!reference){
        add(diagnostics,FILES.contract,contract,pair.value,
          "DEPENDENCY_REFERENCE_INVALID","Dependency "+alias+" must reference a non-empty package identity");
        continue;
      }
      contractDependencies.set(alias,{reference,node:pair.value,key:pair.key});
      if(!contextAvailable){
        addNotChecked(diagnostics,FILES.contract,contract,pair.value,
          "DEPENDENCY_LINK_NOT_CHECKED",
          "Dependency "+alias+" ("+reference+") cannot be compared with a project lock because Dependency Service state is unavailable"+
            (dependencyContext.reason?": "+dependencyContext.reason:""),
          "dependencies");
        continue;
      }
      const declaration=declarationById.get(alias);
      if(!declaration){
        add(diagnostics,FILES.contract,contract,pair.value,
          "DEPENDENCY_NOT_CONFIGURED",
          "Contract dependency "+alias+" ("+reference+") has no matching project dependency declaration",
          {domain:"dependencies",category:"linking"});
        continue;
      }
      if(!snapshotById.has(alias)){
        addBlocked(diagnostics,FILES.contract,contract,pair.value,
          "DEPENDENCY_SNAPSHOT_UNAVAILABLE",
          "Dependency "+alias+" has no verified immutable snapshot: "+
            resolverMessage(dependencyDiagnostics,alias),
          "dependencies");
      }
    }
  }

  const capabilityNode=contract?get(contract.root,"capabilities"):null;
  if(capabilityNode!=null){
    if(!isSeq(capabilityNode)){
      add(diagnostics,FILES.contract,contract,capabilityNode,
        "CAPABILITY_GRANTS_INVALID","Contract capabilities must be an ordered list",
        {domain:"capabilities",category:"structure"});
    }else{
      const seen=new Set();
      for(const item of capabilityNode.items){
        const id=scalar(item);
        if(!id||(!id.startsWith("urn:")&&!/^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z][A-Za-z0-9_-]*)+$/.test(id))){
          add(diagnostics,FILES.contract,contract,item,
            "CAPABILITY_GRANT_INVALID","Capability grant must be a non-empty CapabilityId (qualified dotted ID or URN)",
            {domain:"capabilities",category:"structure"});
          continue;
        }
        if(seen.has(id)){
          add(diagnostics,FILES.contract,contract,item,
            "CAPABILITY_GRANT_DUPLICATE","Capability grant is duplicated: "+id,
            {domain:"capabilities",category:"linking"});
          continue;
        }
        seen.add(id);
        if(!capabilityDeclarations){
          addNotChecked(diagnostics,FILES.contract,contract,item,
            "CAPABILITY_GRANT_NOT_CHECKED",
            "Capability grant "+id+" has no trusted CapabilityContracts declaration set in the current Studio snapshot; declaration uniqueness and Owner binding are NOT_CHECKED",
            "capabilities");
          continue;
        }
        const matches=capabilityDeclarations.filter(value=>value?.id===id);
        const trustedMatches=matches.filter(value=>value?.trusted===true);
        if(trustedMatches.length>1){
          // Two individually verified declarations prove ambiguity even
          // when the export inventory is incomplete.
          add(diagnostics,FILES.contract,contract,item,
            "CAPABILITY_DECLARATION_AMBIGUOUS",
            "Multiple trusted CapabilityContracts declarations match "+id,
            {domain:"capabilities",category:"linking"});
        }else if(matches.length>1){
          // An unverified Owner export is not evidence of two authoritative
          // declarations. Do not turn its presence into a confirmed error.
          addNotChecked(diagnostics,FILES.contract,contract,item,
            "CAPABILITY_OWNER_NOT_VERIFIED",
            "Multiple candidate declarations match "+id+
              ", but at least one Owner publication is unverified; declaration ambiguity and authorization remain NOT_CHECKED",
            "capabilities");
        }else if(!capabilityDeclarationsComplete){
          addNotChecked(diagnostics,FILES.contract,contract,item,
            matches.length===0?"CAPABILITY_DECLARATION_NOT_CHECKED":"CAPABILITY_DECLARATION_SET_INCOMPLETE",
            matches.length===0
              ?"No match for "+id+" was found in the partial CapabilityContracts snapshot; absence is NOT_CHECKED"
              :"Capability "+id+" has a candidate declaration, but the CapabilityContracts snapshot is incomplete; uniqueness and Owner binding are NOT_CHECKED",
            "capabilities");
        }else if(matches.length===0){
          add(diagnostics,FILES.contract,contract,item,
            "CAPABILITY_DECLARATION_NOT_FOUND",
            "No trusted CapabilityContracts declaration matches "+id,
            {domain:"capabilities",category:"linking"});
        }else if(matches[0].trusted!==true){
          addNotChecked(diagnostics,FILES.contract,contract,item,
            "CAPABILITY_OWNER_NOT_VERIFIED",
            "Capability "+id+" has a declaration, but its Owner publication is not trusted; authorization is NOT_CHECKED",
            "capabilities");
        }
      }
    }
  }

  const requestSchema=contract?get(contract.root,"requestSchema"):null;
  if(requestSchema!=null){
    const requestSchemaPath=scalar(requestSchema);
    if(!requestSchemaPath||!safePath(requestSchemaPath)){
      add(diagnostics,FILES.contract,contract,requestSchema,
        "REQUEST_SCHEMA_REFERENCE_INVALID",
        "Contract requestSchema must be a safe Package-relative path",
        {domain:"schemas",category:"reference"});
    }else if(!files.has(requestSchemaPath)){
      if(completeness==="complete"){
        add(diagnostics,FILES.contract,contract,requestSchema,
          "REQUEST_SCHEMA_NOT_FOUND",
          "Request Schema is not present in the complete Package snapshot: "+requestSchemaPath,
          {domain:"schemas",category:"linking"});
      }else{
        addNotChecked(diagnostics,FILES.contract,contract,requestSchema,
          "REQUEST_SCHEMA_NOT_CHECKED",
          "Cannot confirm whether Request Schema exists because the Package snapshot is incomplete: "+requestSchemaPath,
          "schemas");
      }
    }
  }

  const checkSchemaReference=(path,source,node,reference,label)=>{
    if(typeof reference!=="string")return;
    if(!contract){
      addNotChecked(diagnostics,path,source,node,"CONTRACT_DEPENDENCIES_NOT_CHECKED",
        label+" cannot resolve dependency aliases because Contract is missing or could not be parsed",
        "dependencies");
      return;
    }
    const match=QUALIFIED_REF.exec(reference);
    if(!match){
      if(!safePath(reference)){
        add(diagnostics,path,source,node,"SCHEMA_REFERENCE_INVALID",
          label+" must be a safe Package-relative path or dependencyAlias::SchemaId",
          {domain:"schemas",category:"reference"});
      }else if(!files.has(reference)){
        if(completeness==="complete"){
          add(diagnostics,path,source,node,"SCHEMA_DECLARATION_NOT_FOUND",
            label+" is not present in the complete Package snapshot: "+reference,
            {domain:"schemas",category:"linking"});
        }else{
          addNotChecked(diagnostics,path,source,node,"SCHEMA_REFERENCE_NOT_CHECKED",
            "Cannot confirm local Schema reference because the Package snapshot is incomplete: "+reference,
            "schemas");
        }
      }
      return;
    }
    const [,alias,id]=match;
    if(!contractDependencies.has(alias)){
      add(diagnostics,path,source,node,"SCHEMA_DEPENDENCY_UNDECLARED",
        label+" references undeclared dependency alias "+alias,
        {domain:"schemas",category:"linking"});
      return;
    }
    if(!contextAvailable){
      addNotChecked(diagnostics,path,source,node,"SCHEMA_LINK_NOT_CHECKED",
        label+" references "+alias+"::"+id+
          ", but project Dependency Service state is unavailable; export resolution is NOT_CHECKED",
        "schemas");
      return;
    }
    const declaration=declarationById.get(alias);
    const snapshot=snapshotById.get(alias);
    if(!declaration||!snapshot){
      addBlocked(diagnostics,path,source,node,"SCHEMA_DEPENDENCY_UNAVAILABLE",
        label+" cannot resolve "+alias+"::"+id+": "+
          resolverMessage(dependencyDiagnostics,alias),
        "schemas");
      return;
    }
    const candidates=schemas.filter(item=>item.dependencyId===alias);
    if(!candidates.length){
      addNotChecked(diagnostics,path,source,node,"SCHEMA_EXPORT_NOT_CHECKED",
        label+" references "+alias+"::"+id+
          ", but the locked Schema Bundle has no parsed Schema documents available to this Studio linker",
        "schemas");
      return;
    }
    const parsedSchemas=candidates.map(item=>schemaIds(item.text));
    if(parsedSchemas.some(item=>!item.parseable)){
      addBlocked(diagnostics,path,source,node,"SCHEMA_BUNDLE_PARSE_INCOMPLETE",
        "One or more Schema documents in dependency "+alias+" could not be parsed; "+id+" cannot be resolved reliably",
        "schemas");
      return;
    }
    const matches=parsedSchemas.flatMap(item=>item.ids).filter(value=>value===id);
    if(matches.length===0){
      if(parsedSchemas.some(item=>item.ids.length===0)){
        addNotChecked(diagnostics,path,source,node,"SCHEMA_EXPORT_SHAPE_NOT_CHECKED",
          "Schema documents in "+alias+" do not expose a supported top-level SchemaId field; "+id+" remains NOT_CHECKED",
          "schemas");
      }else{
        add(diagnostics,path,source,node,"SCHEMA_DECLARATION_NOT_FOUND",
          label+" has no exact SchemaId declaration in the locked "+alias+" snapshot: "+id,
          {domain:"schemas",category:"linking"});
      }
    }else if(matches.length>1){
      add(diagnostics,path,source,node,"SCHEMA_DECLARATION_AMBIGUOUS",
        label+" resolves to multiple declarations in the locked "+alias+" snapshot: "+id,
        {domain:"schemas",category:"linking"});
    }
  };

  const contextSchema=contract?get(contract.root,"contextSchema"):null;
  if(contextSchema!=null)
    checkSchemaReference(FILES.contract,contract,contextSchema,
      scalar(contextSchema),"Contract contextSchema");

  const predicateRoot=predicates?get(predicates.root,"predicates"):null;
  const predicateIds=new Set(entries(predicateRoot).map(pair=>scalar(pair.key)).filter(Boolean));
  if(isMap(predicateRoot)){
    for(const pair of predicateRoot.items){
      const predicateId=scalar(pair.key),body=pair.value;
      const parameters=get(body,"parameters");
      if(isSeq(parameters))for(const parameter of parameters.items){
        if(!isMap(parameter))continue;
        for(const item of parameter.items){
          const type=scalar(item.value);
          if(type&&QUALIFIED_REF.test(type))
            checkSchemaReference(FILES.predicates,predicates,item.value,type,
              "Predicate "+predicateId+" parameter "+String(scalar(item.key)));
        }
      }
      const evidence=get(body,"evidence");
      const requirements=get(evidence,"requires");
      if(requirements!=null&&!isMap(requirements)){
        add(diagnostics,FILES.predicates,predicates,requirements,
          "EVIDENCE_REQUIREMENTS_INVALID",
          "Predicate "+predicateId+" evidence.requires must be a mapping",
          {domain:"evidence",category:"structure"});
      }
      if(isMap(requirements))for(const requirement of requirements.items){
        if(!isSeq(requirement.value)){
          add(diagnostics,FILES.predicates,predicates,requirement.value,
            "EVIDENCE_REFERENCE_INVALID",
            "Evidence requirements for "+String(scalar(requirement.key))+" must be an ordered list",
            {domain:"evidence",category:"structure"});
          continue;
        }
        for(const item of requirement.value.items){
          const reference=scalar(item);
          const match=reference?QUALIFIED_REF.exec(reference):null;
          if(!match){
            add(diagnostics,FILES.predicates,predicates,item,
              "EVIDENCE_REFERENCE_INVALID",
              "Evidence reference must use dependencyAlias::EvidenceId: "+String(reference??""),
              {domain:"evidence",category:"reference"});
            continue;
          }
          const alias=match[1];
          if(!contract){
            addNotChecked(diagnostics,FILES.predicates,predicates,item,
              "EVIDENCE_DEPENDENCY_NOT_CHECKED",
              "Evidence dependency "+alias+" cannot be resolved because Contract is missing or could not be parsed",
              "dependencies");
          }else if(!contractDependencies.has(alias)){
            add(diagnostics,FILES.predicates,predicates,item,
              "EVIDENCE_DEPENDENCY_UNDECLARED",
              "Evidence reference "+reference+" uses undeclared dependency alias "+alias,
              {domain:"evidence",category:"linking"});
          }else if(!evidenceDeclarations){
            addNotChecked(diagnostics,FILES.predicates,predicates,item,
              "EVIDENCE_GUARANTEE_NOT_CHECKED",
              "Evidence guarantee "+reference+
                " requires a trusted Owner Evidence declaration; the current Studio snapshot cannot verify it",
              "evidence");
          }else{
            const matches=evidenceDeclarations.filter(value=>
              value?.id===reference||value?.id===match[2]);
            const trustedMatches=matches.filter(value=>value?.trusted===true);
            if(trustedMatches.length>1){
              add(diagnostics,FILES.predicates,predicates,item,
                "EVIDENCE_DECLARATION_AMBIGUOUS",
                "Multiple trusted Owner Evidence declarations match "+reference,
                {domain:"evidence",category:"linking"});
            }else if(matches.length>1){
              addNotChecked(diagnostics,FILES.predicates,predicates,item,
                "EVIDENCE_OWNER_NOT_VERIFIED",
                "Multiple candidate Evidence declarations match "+reference+
                  ", but at least one Owner publication is unverified; ambiguity and guarantee remain NOT_CHECKED",
                "evidence");
            }else if(!evidenceDeclarationsComplete){
              addNotChecked(diagnostics,FILES.predicates,predicates,item,
                matches.length===0?"EVIDENCE_DECLARATION_NOT_CHECKED":"EVIDENCE_DECLARATION_SET_INCOMPLETE",
                matches.length===0
                  ?"No match for "+reference+" was found in the partial Owner Evidence snapshot; absence is NOT_CHECKED"
                  :"Evidence "+reference+" has a candidate declaration, but the Owner Evidence snapshot is incomplete; uniqueness and Owner binding are NOT_CHECKED",
                "evidence");
            }else if(matches.length===0){
              add(diagnostics,FILES.predicates,predicates,item,
                "EVIDENCE_DECLARATION_NOT_FOUND",
                "No trusted Owner Evidence declaration matches "+reference,
                {domain:"evidence",category:"linking"});
            }else if(matches[0].trusted!==true){
              addNotChecked(diagnostics,FILES.predicates,predicates,item,
                "EVIDENCE_OWNER_NOT_VERIFIED",
                "Evidence "+reference+" is declared but its Owner publication is not trusted",
                "evidence");
            }
          }
        }
      }
      const evaluator=get(body,"evaluator");
      if(scalar(get(evaluator,"type"))==="script"){
        const script=get(evaluator,"script"),scriptPath=scalar(script);
        if(!scriptPath||!safePath(scriptPath)){
          add(diagnostics,FILES.predicates,predicates,script,
            "PREDICATE_SCRIPT_REFERENCE_INVALID",
            "Predicate "+predicateId+" Script must be a safe Package-relative path",
            {domain:"predicates",category:"reference"});
        }else if(!files.has(scriptPath)){
          if(completeness==="complete"){
            add(diagnostics,FILES.predicates,predicates,script,
              "PREDICATE_SCRIPT_NOT_FOUND",
              "Predicate "+predicateId+" Script is not present in the complete Package snapshot: "+scriptPath,
              {domain:"predicates",category:"linking"});
          }else{
            addNotChecked(diagnostics,FILES.predicates,predicates,script,
              "PREDICATE_SCRIPT_NOT_CHECKED",
              "Cannot confirm Predicate Script existence because the Package snapshot is incomplete: "+scriptPath,
              "predicates");
          }
        }
      }
    }
  }

  const nodes=procedure?get(procedure.root,"nodes"):null;
  const declaredNodes=new Map(entries(nodes).map(pair=>[scalar(pair.key),pair.value]));
  const checkProducer=(path,source,node,value)=>{
    if(typeof value!=="string")return;
    const match=/^([A-Za-z][A-Za-z0-9_-]*)\.(operation|observation|wait)\.output(?:\.|$)/.exec(value);
    if(!match)return;
    const [,producer,stage]=match;
    const body=declaredNodes.get(producer);
    if(!body){
      add(diagnostics,path,source,node,"PRODUCER_NODE_NOT_FOUND",
        "Source reference "+value+" names an undeclared Node: "+producer,
        {domain:"procedure",category:"linking"});
      return;
    }
    if(stage==="wait"?get(body,"wait")==null:get(body,stage)==null){
      add(diagnostics,path,source,node,"PRODUCER_STAGE_NOT_FOUND",
        "Source reference "+value+" names a Node without the declared "+stage+" stage/control",
        {domain:"procedure",category:"linking"});
    }
  };
  const checkTool=(nodeId,path,source,node,value)=>{
    if(value===null)return;
    const match=typeof value==="string"?TOOL_REF.exec(value):null;
    if(!match){
      add(diagnostics,path,source,node,"TOOL_REFERENCE_INVALID",
        "Tool reference must use dependencyAlias::callableId: "+String(value??""),
        {domain:"tools",category:"reference"});
      return;
    }
    const [,alias,callableId]=match;
    if(!contract){
      addNotChecked(diagnostics,path,source,node,"TOOL_DEPENDENCY_NOT_CHECKED",
        "Tool "+value+" cannot resolve dependency alias "+alias+
          " because Contract is missing or could not be parsed",
        "dependencies");
      return;
    }
    if(!contractDependencies.has(alias)){
      add(diagnostics,path,source,node,"TOOL_DEPENDENCY_UNDECLARED",
        "Node "+nodeId+" references Tool "+value+
          " but Contract.dependencies does not declare alias "+alias,
        {domain:"tools",category:"linking"});
      return;
    }
    if(!contextAvailable){
      addNotChecked(diagnostics,path,source,node,"TOOL_LINK_NOT_CHECKED",
        "Tool "+value+" cannot be checked because project Dependency Service state is unavailable",
        "tools");
      return;
    }
    const declaration=declarationById.get(alias);
    const snapshot=snapshotById.get(alias);
    if(!declaration){
      add(diagnostics,path,source,node,"DEPENDENCY_NOT_CONFIGURED",
        "Tool "+value+" uses dependency "+alias+" which is not configured in this project",
        {domain:"tools",category:"linking"});
      return;
    }
    if(!snapshot){
      addBlocked(diagnostics,path,source,node,"TOOL_DEPENDENCY_UNAVAILABLE",
        "Tool "+value+" has no verified locked dependency "+alias+": "+
          resolverMessage(dependencyDiagnostics,alias),
        "tools");
      return;
    }
    if(declaration.kind!=="tool-catalog"){
      add(diagnostics,path,source,node,"TOOL_DEPENDENCY_KIND_MISMATCH",
        "Tool "+value+" requires a Tool Catalog dependency, but "+alias+
          " is declared as "+declaration.kind,
        {domain:"tools",category:"linking"});
      return;
    }
    const catalog=toolCatalogs.find(item=>item.dependencyId===alias);
    if(catalog&&!catalog.available){
      addBlocked(diagnostics,path,source,node,"TOOL_CATALOG_UNAVAILABLE",
        "Locked Tool Catalog "+alias+" cannot be read: "+String(catalog.reason??"unknown catalog error"),
        "tools");
      return;
    }
    if(!catalog){
      addNotChecked(diagnostics,path,source,node,"TOOL_CATALOG_NOT_CHECKED",
        "Locked Tool Catalog "+alias+" has not been parsed by this Studio build; callable "+callableId+" is NOT_CHECKED",
        "tools");
      return;
    }
    const matches=operations.filter(item=>item.dependencyId===alias&&item.id===callableId);
    if(matches.length===0){
      add(diagnostics,path,source,node,"TOOL_DECLARATION_NOT_FOUND",
        "Tool "+value+" has no matching callable declaration in the locked "+alias+" Tool Catalog",
        {domain:"tools",category:"linking"});
    }else if(matches.length>1){
      add(diagnostics,path,source,node,"TOOL_DECLARATION_AMBIGUOUS",
        "Tool "+value+" has multiple callable declarations in the locked "+alias+" Tool Catalog",
        {domain:"tools",category:"linking"});
    }
  };

  for(const nodePair of entries(nodes)){
    const nodeId=scalar(nodePair.key),body=nodePair.value;
    for(const stageName of STAGES){
      const stage=get(body,stageName);
      if(!isMap(stage))continue;
      const tool=get(stage,"tool");
      if(tool!=null)checkTool(nodeId,FILES.procedure,procedure,tool,scalar(tool));
      const script=get(stage,"script"),scriptPath=scalar(script);
      if(script!=null){
        if(!scriptPath||!safePath(scriptPath)){
          add(diagnostics,FILES.procedure,procedure,script,
            "PROCEDURE_SCRIPT_REFERENCE_INVALID",
            "Node "+nodeId+" Script must be a safe Package-relative path",
            {domain:"procedure",category:"reference"});
        }else if(!files.has(scriptPath)){
          if(completeness==="complete"){
            add(diagnostics,FILES.procedure,procedure,script,
              "PROCEDURE_SCRIPT_NOT_FOUND",
              "Node "+nodeId+" Script is not present in the complete Package snapshot: "+scriptPath,
              {domain:"procedure",category:"linking"});
          }else{
            addNotChecked(diagnostics,FILES.procedure,procedure,script,
              "PROCEDURE_SCRIPT_NOT_CHECKED",
              "Cannot confirm Script existence because the Package snapshot is incomplete: "+scriptPath,
              "procedure");
          }
        }
      }
      const argumentsNode=get(stage,"arguments");
      if(isMap(argumentsNode))for(const argument of argumentsNode.items)
        checkProducer(FILES.procedure,procedure,argument.value,scalar(argument.value));
      const calls=get(stage,"predicates");
      if(isSeq(calls))for(const call of calls.items){
        const predicate=get(call,"predicate"),predicateId=scalar(predicate);
        if(predicateId&&!predicates){
          addNotChecked(diagnostics,FILES.procedure,procedure,predicate,
            "PREDICATE_REFERENCE_NOT_CHECKED",
            "Node "+nodeId+" references Predicate "+predicateId+
              ", but PredicateSet is missing or could not be parsed",
            "predicates");
        }else if(predicateId&&!predicateIds.has(predicateId)){
          add(diagnostics,FILES.procedure,procedure,predicate,
            "PREDICATE_REFERENCE_NOT_FOUND",
            "Node "+nodeId+" references an undeclared Predicate: "+predicateId,
            {domain:"predicates",category:"linking"});
        }
        const argumentsList=get(call,"arguments");
        if(isSeq(argumentsList))for(const argument of argumentsList.items)
          checkProducer(FILES.procedure,procedure,argument,scalar(argument));
      }
    }
  }

  return Object.freeze(sortDiagnostics(diagnostics));
}
function sortDiagnostics(items){
  return [...items].sort((a,b)=>
    a.path.localeCompare(b.path)||a.line-b.line||a.column-b.column||
    a.code.localeCompare(b.code)||a.message.localeCompare(b.message));
}

export const PACKAGE_AUDIT_FILES=FILES;
