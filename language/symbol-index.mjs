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
  if(!(raw.startsWith("schemas/")||raw.startsWith("lib/")||
       raw.startsWith("scripts/")||raw.startsWith("references/")))return null;
  const parts=raw.split("/");
  if(parts.some(part=>!part||part==="."||part===".."||
    /[:<>|?*]/.test(part)||[...part].some(char=>char.charCodeAt(0)<32)))return null;
  return parts.join("/");
}

function symbolKey(token,name,relativePath){
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
      if(/^(?:schemas\/.*\.schema\.ya?ml|lib\/.*\.ya?ml|scripts\/.*\.py|references\/.*\.md)$/.test(document.relativePath)){
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
      if(!SYMBOL_TYPES.has(span.type)||
         !Number.isSafeInteger(span.start)||!Number.isSafeInteger(span.end)||
         span.start<0||span.end<=span.start||span.end>document.text.length)
        continue;
      const name=document.text.slice(span.start,span.end);
      if(!name)continue;
      const key=symbolKey(span,name,document.relativePath);
      if(!key)continue;
      const item={
        key,name,type:span.type,uri:document.uri,
        relativePath:document.relativePath,
        range:{start:span.start,end:span.end},
        path:Array.isArray(span.path)?[...span.path]:[],
        part:span.part??null,
        modifiers:[...(span.modifiers??[])]
      };
      tokens.push(item);
      if(modifier(span,"declaration"))append(declarations,key,item);
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
