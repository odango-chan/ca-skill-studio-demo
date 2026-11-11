// Editor-side mutation preflight for plugin-managed projects. This does not
// replace host filesystem permissions; managed snapshot writes use a separate
// trusted Dependency Service and never go through ordinary Source editing.
export const PROJECT_ROOT_DIRECTORIES=Object.freeze(["skills",".skill-studio"]);
function normalizedPath(uri){
  const path=uri?.path;
  if(typeof path!=="string"||!path.startsWith("/")||
     path.split("/").some(segment=>segment==="."||segment===".."||
       segment.toLowerCase().includes("%2e")))return null;
  return path.length>1&&path.endsWith("/")?path.slice(0,-1):path;
}
function sameAuthority(a,b){
  return (a?.scheme??"")===(b?.scheme??"")&&
    (a?.authority??"")===(b?.authority??"");
}
export function projectRoots(workspaceFolders=[]){
  return (workspaceFolders??[]).flatMap(folder=>{
    const path=normalizedPath(folder?.uri);
    return path?[{path,uri:folder.uri}]:[];
  }).sort((a,b)=>b.path.length-a.path.length);
}
export function classifyProjectResource(uri,workspaceFolders=[]){
  const path=normalizedPath(uri);
  if(!path)return {role:"invalid",readonly:true,protected:true};
  for(const root of projectRoots(workspaceFolders)){
    if(!sameAuthority(uri,root.uri))continue;
    if(path===root.path)
      return {role:"project-root",readonly:true,protected:true,projectRoot:root.path};
    if(!path.startsWith(root.path+"/"))continue;
    const relative=path.slice(root.path.length+1);
    if(relative==="skills")
      return {role:"skills-root",readonly:true,protected:true,projectRoot:root.path};
    if(relative===".skill-studio"||relative===".skill-studio/dependencies")
      return {role:"managed-root",readonly:true,protected:true,projectRoot:root.path};
    if(relative.startsWith(".skill-studio/dependencies/"))
      return {role:"dependency-snapshot",readonly:true,protected:false,projectRoot:root.path};
    return {role:"source-or-other",readonly:false,protected:false,projectRoot:root.path};
  }
  return {role:"outside",readonly:false,protected:false};
}
export function checkStudioMutation(uri,workspaceFolders=[],operation="edit"){
  const entry=classifyProjectResource(uri,workspaceFolders);
  if(entry.role==="invalid")
    return {allowed:false,reason:"Invalid project resource URI",...entry};
  if(entry.protected)
    return {allowed:false,reason:"Project structure is managed by Skill Studio",...entry};
  if(entry.role==="dependency-snapshot")
    return {allowed:operation==="dependency-store-write",
      reason:"Pinned dependency snapshot is immutable managed content",...entry};
  return {allowed:true,reason:null,...entry};
}
export function assertStudioMutation(uri,workspaceFolders=[],operation="edit"){
  const verdict=checkStudioMutation(uri,workspaceFolders,operation);
  if(!verdict.allowed)throw Error(
    "SKILL Studio: "+verdict.reason+" ("+(uri?.path??"unknown")+")");
  return verdict;
}
