import {collectSkillSemanticTokenSpans} from "./semantic-tokens.mjs";

const SYMBOL_TYPES=new Set([
  "skillProcedure",
  "skillStep",
  "skillPredicate",
  "skillOperation",
  "skillCapability",
  "skillSchema"
]);

function modifier(token,name){
  return Array.isArray(token.modifiers)&&token.modifiers.includes(name);
}

function packageFilePath(value){
  if(typeof value!=="string"||!value||
     value.includes("#")||value.includes("://")||value.startsWith("/")||
     value.includes(String.fromCharCode(92))||value.includes("?")||value.includes("%")||
     /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value))return null;
  // Skill Language paths are rooted in the logical BuildRequest file set.
  // Reject traversal, external URLs and fragments without exact AST ranges.
  const raw=value;
  const schemaPath=raw.startsWith("schemas/")&&/\.ya?ml$/.test(raw);
  const ownerSchemaPath=raw.startsWith("lib/")&&/\.schema\.ya?ml$/.test(raw);
  if(!schemaPath&&!ownerSchemaPath)return null;
  const parts=raw.split("/");
  if(parts.some(part=>!part||part==="."||part===".."||
    /[:<>|?*]/.test(part)||[...part].some(char=>char.charCodeAt(0)<32)))return null;
  return parts.join("/");
}

function symbolKey(token,name){
  switch(token.type){
    case "skillProcedure":
      return "procedure\u0000"+name;
    case "skillStep":{
      const procedure=token.path?.[0]==="procedures"?token.path[1]:null;
      return typeof procedure==="string"&&procedure
        ? "step\u0000"+procedure+"\u0000"+name
        : null;
    }
    case "skillPredicate":
      return "predicate\u0000"+name;
    case "skillOperation":
      return "operation\u0000"+name;
    // allowedResources.capabilities may grant a Capability or a direct
    // Operation. The v0.2 projection has no local Capability declaration
    // profile, so resolve this only when an exact imported Operation exists.
    case "skillCapability":
      return "operation\u0000"+name;
    case "skillSchema":{
      const targetPath=packageFilePath(name);
      return targetPath?"document::"+targetPath:null;
    }
    default:
      return null;
  }
}
function append(map,key,value){
  const values=map.get(key)??[];
  values.push(value);
  map.set(key,values);
}

/**
 * Build a read-only, generation-scoped symbol index from the canonical
 * ca-skills semantic-token projection. Token selectors and AST ranges remain
 * owner-defined; this module only resolves exact declaration/reference pairs.
 *
 * It deliberately does not infer Capability ownership, Observation schemas,
 * Runtime readiness, or unresolved external dependency contents.
 */
export function buildSkillSymbolIndex(snapshot){
  if(!snapshot||typeof snapshot!=="object"||!Array.isArray(snapshot.documents))
    return null;
  const declarations=new Map();
  const references=new Map();
  const documentTargets=new Map();
  const tokensByUri=new Map();
  for(const document of snapshot.documents){
    if(typeof document?.uri==="string"&&typeof document?.relativePath==="string"){
      const key="document::"+document.relativePath;
      if(/^(?:schemas\/.*\.ya?ml|lib\/.*\.schema\.ya?ml|scripts\/.*\.py|references\/.*\.md)$/.test(document.relativePath)){
        const targets=documentTargets.get(key)??[];
        targets.push({
          key,name:document.relativePath,
          type:/\.py$|^references\//.test(document.relativePath)?"skillReference":"skillSchema",
          uri:document.uri,relativePath:document.relativePath,
          range:{start:0,end:0},path:[],part:"document",modifiers:[]
        });
        documentTargets.set(key,targets);
      }
    }
    if(!document||typeof document.uri!=="string"||
       typeof document.relativePath!=="string"||typeof document.text!=="string")
      continue;
    const tokens=[];
    for(const span of collectSkillSemanticTokenSpans(document.text,document.relativePath)){
      if(!Number.isSafeInteger(span.start)||!Number.isSafeInteger(span.end)||
         span.start<0||span.end<=span.start||span.end>document.text.length)
        continue;
      const name=document.text.slice(span.start,span.end);
      if(!name)continue;
      const key=SYMBOL_TYPES.has(span.type)?symbolKey(span,name):null;
      const item={
        key,name,type:span.type,uri:document.uri,
        relativePath:document.relativePath,
        range:{start:span.start,end:span.end},
        path:Array.isArray(span.path)?[...span.path]:[],
        part:span.part??null,
        modifiers:[...(span.modifiers??[])]
      };
      // Keep the complete canonical token projection for context-aware
      // completion, but only the explicit symbol types participate in links.
      tokens.push(item);
      if(!SYMBOL_TYPES.has(span.type)||!key)continue;
      // Skill Language uses skillStep for both Procedure node identities and
      // locally named PRE/POST phase steps. Only node-map keys are Procedure
      // targets for start/on navigation; phase-step declarations stay local.
      const nodeDeclaration=span.type!=="skillStep"||
        (span.part==="key"&&span.path?.[0]==="procedures"&&
         span.path?.[2]==="nodes"&&span.path.length===4);
      if(modifier(span,"declaration")&&nodeDeclaration)
        append(declarations,key,item);
      if(modifier(span,"reference"))append(references,key,item);
    }
    tokensByUri.set(document.uri,tokens);
  }
  return {
    rootUri:snapshot.rootUri,
    generation:snapshot.generation,
    declarations,
    references,
    documentTargets,
    tokensByUri
  };
}

/** Return the exact symbol token at a UTF-16 source offset, if any. */
export function skillSymbolAt(index,uri,offset){
  if(!index||typeof uri!=="string"||!Number.isSafeInteger(offset)||offset<0)
    return null;
  const token=(index.tokensByUri.get(uri)??[]).find(item=>
    SYMBOL_TYPES.has(item.type)&&
    (item.type!=="skillStep"||!modifier(item,"declaration")||
      (item.part==="key"&&item.path?.[0]==="procedures"&&
       item.path?.[2]==="nodes"&&item.path.length===4))&&
    offset>=item.range.start&&offset<item.range.end);
  if(!token)return null;
  const declarations=index.declarations.get(token.key)??index.documentTargets.get(token.key)??[];
  const references=index.references.get(token.key)??[];
  return {token,declarations,references};
}

/** A target is safe only when exactly one declaration exists. */
export function uniqueSkillSymbolDeclaration(hit){
  return hit&&hit.declarations?.length===1?hit.declarations[0]:null;
}

/** Return exact source occurrences for a symbol, with an optional declaration. */
export function skillSymbolOccurrences(hit,includeDeclaration=false){
  if(!hit)return [];
  const values=[
    ...(includeDeclaration?hit.declarations:[]),
    ...hit.references
  ];
  const seen=new Set();
  return values.filter(item=>{
    const key=item.uri+"\u0000"+item.range.start+"\u0000"+item.range.end;
    if(seen.has(key))return false;
    seen.add(key);
    return true;
  }).sort((a,b)=>a.uri.localeCompare(b.uri)||a.range.start-b.range.start);
}

/** Declarations in one document, used to populate the native YAML Outline. */
export function skillSymbolDeclarationsForDocument(index,uri){
  if(!index||typeof uri!=="string")return [];
  const result=[];
  for(const values of index.declarations.values())
    for(const item of values)if(item.uri===uri)result.push(item);
  return result.sort((a,b)=>a.range.start-b.range.start);
}

const COMPLETION_TYPES=new Set([
  "skillProcedure","skillStep","skillPredicate","skillOperation",
  "skillCapability","skillSchema","skillReference"
]);

/**
 * Context-limited candidates for a reference token. The token path/type and
 * exact replacement range come from ca-skills' semantic-token projection;
 * candidates come only from declarations/files in this Package snapshot.
 */
export function skillSymbolCompletions(index,uri,offset){
  if(!index||typeof uri!=="string"||!Number.isSafeInteger(offset)||offset<0)
    return null;
  const token=(index.tokensByUri.get(uri)??[]).find(item=>
    COMPLETION_TYPES.has(item.type)&&modifier(item,"reference")&&
    offset>=item.range.start&&offset<=item.range.end);
  if(!token)return null;
  let candidates=[];
  if(token.type==="skillSchema"){
    for(const values of index.documentTargets.values())
      for(const item of values)
        if(item.type==="skillSchema"&&/^(?:schemas\/.+\.ya?ml|lib\/.+\.schema\.ya?ml)$/.test(item.relativePath))
          candidates.push(item);
  }else if(token.type==="skillReference"){
    for(const values of index.documentTargets.values())
      for(const item of values)
        if(item.type==="skillReference"&&/^scripts\/.+\.py$/.test(item.relativePath))
          candidates.push(item);
  }else if(token.type==="skillStep"){
    const procedure=token.path?.[0]==="procedures"?token.path[1]:null;
    for(const values of index.declarations.values())
      for(const item of values)
        if(item.type==="skillStep"&&item.path?.[1]===procedure)candidates.push(item);
  }else{
    const candidateType=token.type==="skillCapability"?"skillOperation":token.type;
    for(const values of index.declarations.values())
      for(const item of values)
        if(item.type===candidateType)candidates.push(item);
  }
  const prefix=token.name.slice(0,Math.max(0,Math.min(
    token.name.length,offset-token.range.start)));
  const groups=new Map();
  for(const item of candidates){
    if(!item.name.startsWith(prefix))continue;
    const scope=item.type==="skillStep"?item.path?.[1]??"": "";
    const identity=item.type+"\\u0000"+scope+"\\u0000"+item.name;
    const values=groups.get(identity)??[];
    values.push(item);
    groups.set(identity,values);
  }
  // Duplicate declarations are deliberately omitted from completion rather
  // than offered as multiple indistinguishable destinations.
  const items=[...groups.values()].filter(values=>values.length===1)
    .map(values=>values[0])
    .sort((a,b)=>a.name.localeCompare(b.name)||a.relativePath.localeCompare(b.relativePath));
  return {token,prefix,items};
}

/**
 * Exact unresolved/ambiguous links for editor Problems. These are advisory
 * source diagnostics only: Compiler Build remains authoritative. Unknown
 * deployment Capability IDs are intentionally not diagnosed as missing.
 */
export function skillSymbolLinkDiagnostics(index,snapshot){
  if(!index||!snapshot||snapshot.completeness!=="complete"||
     index.rootUri!==snapshot.rootUri||index.generation!==snapshot.generation)
    return [];
  const result=[];
  const labels={
    skillProcedure:"Procedure",
    skillStep:"Procedure node",
    skillPredicate:"Predicate",
    skillOperation:"Tool Operation",
    skillCapability:"Operation grant",
    skillSchema:"Schema"
  };
  const push=(item,code,message)=>result.push({
    uri:item.uri,range:{...item.range},severity:1,code,message
  });
  for(const [key,items] of index.declarations){
    if(items.length>1){
      for(const item of items)
        push(item,"SKILL_LINK_DUPLICATE_DECLARATION",
          "Ambiguous "+(labels[item.type]??"Skill symbol")+
          ' declaration "'+item.name+'": '+items.length+" declarations share this identity.");
    }
  }
  for(const [key,items] of index.references){
    const token=items[0];
    const declarations=index.declarations.get(key)??index.documentTargets.get(key)??[];
    if(declarations.length===0){
      // Tool Operations can be supplied by Built-in or MCP integrations that
      // are not represented as ToolCatalog files. Absence from the file
      // snapshot is not proof that an Operation does not exist.
      if(token.type==="skillCapability"||token.type==="skillOperation")continue;
      // lib/ belongs to the project dependency inventory, not the Skill
      // Package. Diagnose a missing Owner Schema only when that inventory was
      // captured completely; otherwise its absence is unknown, not an error.
      if(token.type==="skillSchema"&&token.name.startsWith("lib/")&&
         snapshot.libraryInventory!=="complete")continue;
      for(const item of items)
        push(item,"SKILL_LINK_UNRESOLVED",
          "Unresolved "+(labels[item.type]??"Skill reference")+
          ' "'+item.name+'": no matching declaration or Package file exists.');
    }else if(declarations.length>1){
      for(const item of items)
        push(item,"SKILL_LINK_AMBIGUOUS",
          "Ambiguous "+(labels[item.type]??"Skill reference")+
          ' "'+item.name+'": '+declarations.length+" matching declarations exist.");
    }
  }
  return result.sort((a,b)=>a.uri.localeCompare(b.uri)||
    a.range.start-b.range.start||a.range.end-b.range.end);
}
