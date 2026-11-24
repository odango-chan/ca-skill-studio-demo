// Editor-only completion projection from the EXACT verified Interface Package.
// It does not re-issue Owner authorization, validate execution, or alter source.
// The package importer already verified ZIP CRC, immutable manifest and hashes;
// the locked snapshot resolver verifies these bytes again on each load.
import {parseDocument,isMap,isSeq,isScalar} from 'yaml';
import {decodeBase64} from './dependency-snapshot.mjs';
import {indexV1Alpha4ToolCatalogCallables} from '../../../../site/package-audit.mjs';
import {projectSchemaPropertyTree} from "../../../../language/schema-path-projection.mjs";

const DIALECT='https://json-schema.org/draft/2020-12/schema';
const decoder=new TextDecoder('utf-8',{fatal:true});
const scalar=node=>isScalar(node)?node.value:undefined;
const member=(map,key)=>isMap(map)?map.get(key,true):undefined;
const string=(node,max=512)=>{
  const value=scalar(node);
  return typeof value==='string'&&value.length<=max?value:null;
};
function parsed(text){
  if(typeof text!=='string'||text.length>2*1024*1024)return null;
  const doc=parseDocument(text,{version:'1.2',schema:'core',
    strict:true,uniqueKeys:true,stringKeys:true,logLevel:'silent'});
  return doc.errors?.length?null:doc.contents;
}
function schemaProperties(raw,exportId){
  const root=parsed(raw);
  if(!isMap(root)||string(member(root,'$id'),1024)!==exportId||
     string(member(root,'$schema'),128)!==DIALECT||
     string(member(root,'type'))!=='object')return null;
  // A composed root may narrow/override properties. Never offer a partial
  // parameter signature unless the whole surface is statically plain.
  if(['$ref','allOf','oneOf','anyOf','not','if','then','else'].some(k=>
    member(root,k)!==undefined))return null;
  const properties=member(root,'properties');
  // Do not invent an interface from an absent/unknown object shape.
  if(!isMap(properties)||properties.items.length>256)return null;
  const required=member(root,'required');
  const requiredNames=new Set(isSeq(required)?required.items.map(scalar).filter(x=>typeof x==='string'):[]);
  const result=[];
  const seen=new Set();
  for(const entry of properties.items){
    const name=string(entry.key,128);
    if(!name||!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name)||
       seen.has(name)||!isMap(entry.value))return null;
    seen.add(name);
    const prop=entry.value,type=string(member(prop,'type'),64);
    const description=string(member(prop,'description'),1024)??'';
    const title=string(member(prop,'title'),256)??'';
    let choices=[];
    const enumeration=member(prop,'enum');
    const constant=member(prop,'const');
    if(isSeq(enumeration)&&enumeration.items.length<=32)
      choices=enumeration.items.map(scalar).filter(value=>
        typeof value==='string'||typeof value==='boolean'||
        (typeof value==='number'&&Number.isFinite(value)));
    else if(isScalar(constant)) {
      const value=constant.value;
      if(typeof value==='string'||typeof value==='boolean'||
         (typeof value==='number'&&Number.isFinite(value)))choices=[value];
    }
    result.push({name,required:requiredNames.has(name),type:type??'unspecified',
      description,title,choices});
  }
  if([...requiredNames].some(name=>!seen.has(name)))return null;
  return result;
}
export function projectLockedInterfaceCompletionHints(snapshot){
  if(snapshot?.kind!=='interface-package'||typeof snapshot.id!=='string'||
     !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(snapshot.id)||
     !Array.isArray(snapshot.files))return [];
  let fileMap,manifest;
  try{
    fileMap=new Map(snapshot.files.map(file=>[
      file.path,decoder.decode(decodeBase64(file.bytes))
    ]));
    manifest=JSON.parse(fileMap.get('package.json'));
  }catch{return [];}
  if(manifest?.apiVersion!=='connectionagent.io/interface-package/v1alpha1'||
     manifest.languageTarget!=='connectionagent.io/v1alpha5'||
     !Array.isArray(manifest.exports))return [];
  const catalogs=[...new Set(manifest.exports.filter(item=>
    item.kind==='CallableCatalog'&&fileMap.has(item.path)).map(item=>item.path))];
  const schemaById=new Map();
  for(const exportEntry of manifest.exports){
    if(exportEntry.kind!=='Schema')continue;
    if(schemaById.has(exportEntry.id))return [];
    schemaById.set(exportEntry.id,exportEntry.path);
  }
  const declarations=indexV1Alpha4ToolCatalogCallables(snapshot.id,
    catalogs.map(path=>({path,text:fileMap.get(path)})));
  if(!declarations.available)return [];
  const declaredIDs=new Set(manifest.exports.filter(item=>
    item.kind==='CallableCatalog').map(item=>item.id));
  const output=[];
  for(const operation of declarations.operations){
    if(!declaredIDs.has(operation.id))continue;
    const text=fileMap.get(operation.catalogPath);
    const root=parsed(text);
    const contracts=member(member(root,'spec'),'contracts');
    if(!isSeq(contracts))continue;
    const contract=contracts.items.find(item=>string(member(item,'id'))===operation.id);
    if(!isMap(contract))continue;
    const inputKey=operation.kind==='observation'?'queryContextSchema':'inputSchema';
    const schemaId=string(member(member(contract,inputKey),'$ref'),1024);
    if(!schemaId)continue;
    const schemaPath=schemaById.get(schemaId);
    if(!schemaPath||!fileMap.has(schemaPath))continue;
    const properties=schemaProperties(fileMap.get(schemaPath),schemaId);
    if(!properties)continue;
    const outputId=string(member(member(contract,"outputSchema"),"$ref"),1024);
    const outputPath=outputId?schemaById.get(outputId):null;
    const outputProperties=outputPath&&fileMap.has(outputPath)
      ?projectSchemaPropertyTree(fileMap.get(outputPath),{expectedId:outputId})
      :null;
    output.push({
      id:snapshot.id+'::'+operation.id,
      dependencyId:snapshot.id,kind:operation.kind,
      inputSchemaId:schemaId,argumentProperties:properties,
      ...(outputProperties?{outputSchemaId:outputId,outputProperties}:{}),
      trust:'DECLARATION_ONLY'
    });
    if(output.length>=128)break;
  }
  return output;
}
