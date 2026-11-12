// Acquisition adapters; only Compiler v0.1 canonical Tool Contract bytes enter
// the immutable store. No Runtime Provider Binding and no tools/call.
import {parseDocument} from "yaml";
import {canonicalJson,sha256} from "./dependency-snapshot.mjs";
const enc=new TextEncoder(),dec=new TextDecoder("utf-8",{fatal:true});
const isObject=value=>value!==null&&typeof value==="object"&&!Array.isArray(value);
const effect=()=>({classification:"UNKNOWN",authority:"UNVERIFIED"});
const fail=(message)=>{throw Error("Contract acquisition BLOCKED: "+message);};
export function normalizeToolContract(input,{trustedOwner=false}={}){
  if(!isObject(input)||input.apiVersion!=="skillc.tool/v0.1"||
     !Array.isArray(input.operations)||!input.operations.length||
     input.operations.length>512)
    fail("expected Compiler skillc.tool/v0.1 operations");
  const ids=new Set(),operations=[];
  for(const item of input.operations){
    if(!isObject(item)||typeof item.id!=="string"||!item.id||
       item.id.length>160||ids.has(item.id)||!isObject(item.inputSchema))
      fail("operation ID must be unique and inputSchema must be an object");
    ids.add(item.id);
    const normalized={id:item.id};
    if(item.description!==undefined){
      if(typeof item.description!=="string"||item.description.length>8192)
        fail("invalid operation description");
      normalized.description=item.description;
    }
    normalized.inputSchema=item.inputSchema;
    for(const key of ["outputSchema","reconcileOutputSchema"]){
      if(item[key]!==undefined){
        if(!isObject(item[key]))fail("invalid "+key);
        normalized[key]=item[key];
      }
    }
    const original=item.effect;
    normalized.effect=trustedOwner&&isObject(original)&&
       ["READ","MUTATION"].includes(original.classification)&&
       original.authority==="OWNER"?{
        classification:original.classification,authority:"OWNER"
      }:effect();
    operations.push(normalized);
  }
  const normalized={apiVersion:"skillc.tool/v0.1",operations};
  // JCS conversion rejects NaN/undefined/functions/cyclic input before write.
  canonicalJson(normalized);
  return normalized;
}
export function readToolContract(bytes,format){
  if(!(bytes instanceof Uint8Array)||bytes.byteLength>2097152)
    fail("uploaded Tool Contract exceeds 2 MiB or is not bytes");
  let raw;
  try{
    const text=dec.decode(bytes);
    if(format==="json")raw=JSON.parse(text);
    else if(format==="yaml"||format==="yml"){
      const doc=parseDocument(text,{uniqueKeys:true,version:"1.2"});
      if(doc.errors.length)throw doc.errors[0];
      raw=doc.toJS({maxAliasCount:0});
    }else fail("only YAML and JSON contracts are accepted");
  }catch(error){fail("cannot parse contract: "+String(error?.message??error));}
  return normalizeToolContract(raw);
}
export const CANONICAL_CONTRACT_PATH="tool-contract.json";
export function snapshotForToolContract(contract){
  return [{path:CANONICAL_CONTRACT_PATH,bytes:enc.encode(canonicalJson(contract))}];
}
export async function acquireUpload({upload,format,rawBytes}){
  if(typeof upload!=="string"||!upload||upload.length>160)
    fail("upload requires stable project-local alias");
  const contract=readToolContract(rawBytes,format);
  return {kind:"tool-catalog",source:{type:"upload",upload,
      contentDigest:await sha256(rawBytes)},
    files:snapshotForToolContract(contract),operations:contract.operations};
}
export function normalizeMcpTools(list,selected){
  if(!Array.isArray(list)||!Array.isArray(selected)||!selected.length||
     selected.length>128||new Set(selected).size!==selected.length)
    fail("select distinct tools returned by tools/list");
  const byName=new Map();
  for(const tool of list){
    if(typeof tool?.name!=="string"||byName.has(tool.name))
      fail("duplicate or nameless MCP Tool");
    byName.set(tool.name,tool);
  }
  return normalizeToolContract({apiVersion:"skillc.tool/v0.1",
    operations:selected.map(name=>{
      const t=byName.get(name);
      if(!t||!isObject(t.inputSchema))fail("MCP inputSchema missing for "+name);
      return {id:name,...(typeof t.description==="string"?
        {description:t.description}:{}),inputSchema:t.inputSchema,
        ...(isObject(t.outputSchema)?{outputSchema:t.outputSchema}:{}),
        effect:effect()};
    })
  });
}
export async function acquireMcp({connectionId,selectedTools,toolsList}){
  if(!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(connectionId??""))
    fail("MCP discovery connectionId is invalid");
  if(typeof toolsList!=="function")fail("MCP tools/list transport is unavailable");
  // The callback is only capable of tools/list discovery. There is no
  // operation invocation entry point in this acquisition API.
  let discovered;
  try{discovered=await toolsList(connectionId);}
  catch(error){fail("tools/list unavailable (network/CORS/auth): "+String(error?.message??error));}
  const contract=normalizeMcpTools(discovered,selectedTools);
  return {kind:"tool-catalog",source:{type:"mcp",connectionId,tools:[...selectedTools]},
    files:snapshotForToolContract(contract),operations:contract.operations};
}
export async function acquireGit({repository,path,ref,readPinnedFile}){
  if(typeof repository!=="string"||!repository.startsWith("https://")||
     typeof path!=="string"||typeof ref!=="string"||!ref)
    fail("Git requires HTTPS repository, path and ref");
  if(typeof readPinnedFile!=="function")
    fail("host Git revision/file adapter is unavailable");
  let pinned;
  try{pinned=await readPinnedFile({repository,path,ref});}
  catch(error){fail("Git source unavailable (network/CORS/auth): "+
    String(error?.message??error));}
  if(!/^[a-f0-9]{40}$/.test(pinned?.commit??"")||
     !(pinned.bytes instanceof Uint8Array))fail("Git ref is not pinned to a full commit SHA");
  const extension=path.endsWith(".json")?"json":
    /\.ya?ml$/.test(path)?"yaml":null;
  if(!extension)fail("only YAML/JSON Tool Contract paths are supported");
  const contract=readToolContract(pinned.bytes,extension);
  return {kind:"tool-catalog",source:{type:"git",repository,path,ref},
    resolvedRevision:pinned.commit,
    files:snapshotForToolContract(contract),operations:contract.operations};
}
export const BUILTIN_BUNDLES=Object.freeze({
  "studio-example-tools@1.0.0":Object.freeze({
    apiVersion:"skillc.tool/v0.1",
    operations:[{id:"example-inspect",description:"Non-executable example operation",
      inputSchema:{type:"object",properties:{},additionalProperties:false},
      effect:effect()}]
  })
});
export async function acquireBuiltin({bundleId,version,bundles=BUILTIN_BUNDLES}){
  const item=bundles[bundleId+"@"+version];
  if(!item)fail("unknown built-in Tool Contract bundle or version");
  const contract=normalizeToolContract(item);
  return {kind:"tool-catalog",source:{type:"builtin",bundleId,version},
    files:snapshotForToolContract(contract),operations:contract.operations};
}
