// Current CA-SL v1alpha5 dependency acquisition: immutable ToolCatalog v1alpha4
// source artifacts only. The artifact contract is inherited by v1alpha5 and
// remains current. This adapter never issues Owner/Capability authorization.
// Legacy skillc.tool/v0.1 inputs are invalid, not converted or migrated.
import {indexV1Alpha4ToolCatalogCallables}
  from "../../../../site/package-audit.mjs";
import {sha256,validateSnapshotPath} from "./dependency-snapshot.mjs";

const enc=new TextEncoder(),dec=new TextDecoder("utf-8",{fatal:true});
const fail=message=>{throw Error("ToolCatalog acquisition BLOCKED: "+message);};
const validBytes=bytes=>bytes instanceof Uint8Array&&
  bytes.byteLength>0&&bytes.byteLength<=2097152;
const formatPath=format=>{
  if(format==="yaml"||format==="yml")return "tool-catalog.yaml";
  if(format==="json")return "tool-catalog.json";
  fail("only YAML/JSON ToolCatalog source artifacts are supported");
};

/** Inspect a current ToolCatalog declaration; never assign trust to the Owner. */
export function readToolCatalog(bytes,format,sourcePath=formatPath(format)){
  if(!validBytes(bytes))fail("ToolCatalog source must contain 1–2097152 bytes");
  const path=validateSnapshotPath(sourcePath);
  if(!/\.(?:json|ya?ml)$/i.test(path))
    fail("ToolCatalog source path must be YAML or JSON");
  let text;
  try{text=dec.decode(bytes);}
  catch(error){fail("ToolCatalog is not valid UTF-8: "+String(error?.message??error));}
  const result=indexV1Alpha4ToolCatalogCallables("unqualified-source",[
    {path,text}
  ]);
  if(!result.available)fail(result.reason);
  const identities=new Set();
  for(const operation of result.operations){
    if(identities.has(operation.id))
      fail("duplicate ToolCatalog callable ID: "+operation.id);
    identities.add(operation.id);
  }
  return {path,text,operations:result.operations};
}

/** Preserve exact source bytes and valid file extension in the immutable lock. */
export function snapshotForToolCatalog(bytes,path){
  const checked=validateSnapshotPath(path);
  if(!validBytes(bytes)||!/\.(?:json|ya?ml)$/i.test(checked))
    fail("Invalid immutable ToolCatalog source");
  return [{path:checked,bytes:new Uint8Array(bytes)}];
}
export async function acquireUpload({upload,format,rawBytes}){
  if(typeof upload!=="string"||!upload||upload.length>160)
    fail("upload requires stable project-local alias");
  const path=formatPath(format);
  const catalog=readToolCatalog(rawBytes,format,path);
  return {
    kind:"tool-catalog",
    source:{type:"upload",upload,contentDigest:await sha256(rawBytes)},
    files:snapshotForToolCatalog(rawBytes,path),
    operations:catalog.operations
  };
}

/**
 * MCP tools/list is discovery data. A ToolCatalog requires Owner-declared
 * effect, Schema refs, Outcome guarantees and identity that tools/list lacks.
 * Do not produce a superficially valid ToolCatalog or pin untrusted candidates
 * as Compiler-ready dependency artifacts.
 */
export async function acquireMcp({connectionId}={}){
  if(!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(connectionId??""))
    fail("MCP discovery connectionId is invalid");
  fail("MCP tools/list cannot publish a ToolCatalog or authorize an Owner. "+
    "Import an Owner-published current ToolCatalog YAML/JSON artifact using Upload or pinned Git.");
}
export async function acquireGit({repository,path,ref,readPinnedFile}){
  if(typeof repository!=="string"||!repository.startsWith("https://")||
     typeof path!=="string"||typeof ref!=="string"||!ref)
    fail("Git requires HTTPS repository, path and ref");
  if(typeof readPinnedFile!=="function")
    fail("host Git revision/file adapter is unavailable");
  const checked=validateSnapshotPath(path);
  const format=/\.json$/i.test(checked)?"json":
    /\.ya?ml$/i.test(checked)?"yaml":null;
  if(!format)fail("only YAML/JSON ToolCatalog paths are supported");
  let pinned;
  try{pinned=await readPinnedFile({repository,path:checked,ref});}
  catch(error){fail("Git source unavailable (network/CORS/auth): "+
    String(error?.message??error));}
  if(!/^[a-f0-9]{40}$/.test(pinned?.commit??"")||
     !(pinned.bytes instanceof Uint8Array))
    fail("Git ref is not pinned to a full commit SHA");
  const catalog=readToolCatalog(pinned.bytes,format,checked);
  return {
    kind:"tool-catalog",
    source:{type:"git",repository,path:checked,ref},
    resolvedRevision:pinned.commit,
    files:snapshotForToolCatalog(pinned.bytes,checked),
    operations:catalog.operations
  };
}
// A *new* built-in identity avoids republishing retired example bytes under
// an existing immutable version. This is illustrative declaration source only.
const exampleCatalog=`apiVersion: connectionagent.io/toolcatalog/v1alpha4
kind: ToolCatalog
metadata:
  owner: studio-example-unqualified
spec:
  contracts:
    - id: example.inspect
      kind: observation
      effect: READ
      queryContextSchema: { $ref: "#/schemas/example-query" }
      outputSchema: { $ref: "#/schemas/example-result" }
      ownerOutcomes: [SUCCEEDED, FAILED]
`;
export const BUILTIN_BUNDLES=Object.freeze({
  "studio-example-toolcatalog@1.0.0":Object.freeze({
    format:"yaml",source:exampleCatalog
  })
});
export async function acquireBuiltin({bundleId,version,bundles=BUILTIN_BUNDLES}={}){
  const item=bundles[bundleId+"@"+version];
  if(!item)fail("unknown current ToolCatalog built-in bundle or version");
  const path=formatPath(item.format);
  const bytes=enc.encode(item.source);
  const catalog=readToolCatalog(bytes,item.format,path);
  return {
    kind:"tool-catalog",
    source:{type:"builtin",bundleId,version},
    files:snapshotForToolCatalog(bytes,path),
    operations:catalog.operations
  };
}
