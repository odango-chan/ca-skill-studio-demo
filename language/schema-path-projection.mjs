// Bounded, source-backed JSON Schema 2020-12 property-tree projection.
// Works on either YAML authoring sources or immutable published JSON.
// Unsupported applicators/$ref cannot be guessed into autocomplete fields.
import {parseDocument,isMap,isSeq,isScalar} from "yaml";
const DIALECT="https://json-schema.org/draft/2020-12/schema";
const NAME=/^[A-Za-z_][A-Za-z0-9_-]*$/;
function field(m,key){return isMap(m)?m.get(key,true):null;}
function scalar(n){return isScalar(n)?n.value:null;}
export function projectSchemaPropertyTree(source,{expectedId}={}){
  if(typeof source!=="string"||source.length>2*1024*1024)return null;
  let doc;
  try{doc=parseDocument(source,{
    version:"1.2",schema:"core",strict:true,uniqueKeys:true,stringKeys:true,
    logLevel:"silent"
  });}catch{return null;}
  if(doc.errors?.length||!isMap(doc.contents))return null;
  const root=doc.contents;
  if(scalar(field(root,"$schema"))!==DIALECT)return null;
  if(expectedId!==undefined&&scalar(field(root,"$id"))!==expectedId)return null;
  const budget={count:0};
  function walk(node,depth){
    if(!isMap(node)||depth>5||scalar(field(node,"type"))!=="object")return null;
    // A compound schema requires full evaluation; never infer flattened fields.
    if(["$ref","allOf","oneOf","anyOf","not","if","then","else"].some(k=>field(node,k)!==null))
      return null;
    const properties=field(node,"properties");
    if(!isMap(properties)||properties.items.length>128)return null;
    const required=field(node,"required");
    if(required!==null&&!isSeq(required))return null;
    const requiredNames=new Set();
    if(isSeq(required))for(const entry of required.items){
      const name=scalar(entry);
      if(typeof name!=="string"||requiredNames.has(name))return null;
      requiredNames.add(name);
    }
    const entries=[],seen=new Set();
    for(const item of properties.items){
      const name=scalar(item.key);
      if(typeof name!=="string"||!NAME.test(name)||seen.has(name)||
         !isMap(item.value)||++budget.count>512)return null;
      seen.add(name);
      const value=item.value;
      const type=scalar(field(value,"type"));
      if(type!==null&&typeof type!=="string")return null;
      const description=scalar(field(value,"description"));
      let children=null;
      if(type==="object")children=walk(value,depth+1);
      // Opaque nested objects are not traversed. Their own names remain known.
      entries.push({name,type:type??"unspecified",required:requiredNames.has(name),
        description:typeof description==="string"?description.slice(0,1024):"",
        children});
    }
    if([...requiredNames].some(name=>!seen.has(name)))return null;
    return entries;
  }
  return walk(root,0);
}
