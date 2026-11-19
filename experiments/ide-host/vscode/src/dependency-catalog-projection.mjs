// Read-only projections of *already verified* immutable dependency snapshots.
// The caller must obtain snapshots from resolveLockedDependencies. Presence of
// a ToolCatalog or Schema Bundle is NOT trusted Owner publication or runtime
// authorization. The current CA-SL v1alpha5 contract retains the immutable
// ToolCatalog v1alpha4 artifact format; no retired skillc.tool/v0.1 fallback.
import {indexV1Alpha4ToolCatalogCallables}
  from "../../../../site/package-audit.mjs";
import {decodeBase64} from "./dependency-snapshot.mjs";

const errorCodes=new Set([
  "LOCKED_SNAPSHOT_CORRUPT","LOCK_SOURCE_MISMATCH",
  "ORPHAN_LOCK","PROJECT_CONFIG_INVALID"
]);

export function projectDependencyReadiness(dependency,entry,resolution){
  const diagnostic=(resolution?.diagnostics??[]).find(value=>
    value?.dependencyId===dependency.id);
  const verified=(resolution?.snapshots??[]).some(value=>
    value?.id===dependency.id&&
    typeof value.snapshotDigest==="string"&&
    value.snapshotDigest===entry?.snapshotDigest&&
    value.kind===dependency.kind);
  return {
    kind:"dependency",dependency,entry,
    blocked:diagnostic??null,
    state:diagnostic
      ?(errorCodes.has(diagnostic.code)?"ERROR":"BLOCKED")
      :verified?"SNAPSHOT_VERIFIED":"BLOCKED",
    ownerState:"NOT_CHECKED"
  };
}

export function projectLockedToolCatalog(snapshot){
  const unavailable=reason=>({available:false,reason,operations:[]});
  if(snapshot?.kind!=="tool-catalog"||!snapshot?.id||
     !Array.isArray(snapshot.files))
    return unavailable("No verified ToolCatalog file inventory is available");
  const decoded=[];
  try{
    const decoder=new TextDecoder("utf-8",{fatal:true});
    for(const file of snapshot.files){
      if(typeof file.path!=="string"||
         !/\.(?:json|ya?ml)$/i.test(file.path))continue;
      decoded.push({
        path:file.path,
        text:decoder.decode(decodeBase64(file.bytes))
      });
    }
  }catch(error){
    return unavailable("Locked ToolCatalog file could not be decoded: "+
      String(error?.message??error));
  }
  // Only declaration projection. Never infer capability grants, evidence,
  // authorized Owner identity, schemas or Runtime readiness from this result.
  return indexV1Alpha4ToolCatalogCallables(snapshot.id,decoded);
}
