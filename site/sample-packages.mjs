// Built-in Example manifest for the active CA-SL v1alpha5 authoring target.
// The source assets are mirrored from ca-skills/main and are not a qualification claim.
const core=["SKILL.md","assurance/contract.yaml","assurance/procedure.yaml","assurance/predicates.yaml"];
const schemeCPackage=(name,schema)=>Object.freeze({
  name,entry:"assurance/procedure.yaml",sourceDir:"v1alpha5",
  files:Object.freeze([...core,"schemas/"+schema+".schema.yaml",
    "references/openamsm-operation-mapping.md"])
});
export const SAMPLE_PACKAGES=Object.freeze({
  mas:schemeCPackage("establish-pdu-session-mas","establishment-request"),
  modify:schemeCPackage("modify-pdu-session-mas","modify-request"),
  release:schemeCPackage("release-pdu-session-mas","release-request")
});

export function packageFilesForSample(key) {
  const spec=SAMPLE_PACKAGES[key];
  if(!spec)throw new Error("Unknown sample package");
  return spec.files.map(path=>({
    path,url:"./samples/"+spec.sourceDir+"/"+spec.name+"/"+path
  }));
}

export function createFileWorkspace(name,entries) {
  if(typeof name!=="string" || !/^[a-zA-Z0-9._-]{1,100}$/.test(name))
    throw new Error("Invalid workspace name");
  if(!Array.isArray(entries) || !entries.length || entries.length>64)
    throw new Error("Invalid workspace file count");
  const map=new Map();
  for(const item of entries){
    if(!item||typeof item.path!=="string"||
       item.path.length===0||item.path.length>240||item.path.startsWith("/")||
       item.path.split("/").some(part=>!part||part==="."||part===".."||
         /[\\\u0000-\u001f:<>|?*]/.test(part))||map.has(item.path))
      throw new Error("Invalid or duplicated workspace path");
    const text=typeof item.text==="string"?item.text:null;
    const raw=item.bytes instanceof Uint8Array?item.bytes:null;
    if(text===null&&!raw)throw new Error("Missing file content");
    if(text!==null&&(text.length>1024*1024||text.includes("\u0000")))
      throw new Error("Invalid text asset");
    if(raw&&raw.length>1024*1024)throw new Error("Raw asset too large");
    map.set(item.path,{
      path:item.path,initialText:text,text,
      originalBytes:raw?raw.slice():null,
      editable:text!==null,history:null
    });
  }
  return {name,files:map};
}
export function markFileEdited(workspace,path,text,history) {
  const file=workspace?.files.get(path);
  if(!file||!file.editable||typeof text!=="string")throw new Error("Unknown or opaque workspace file");
  file.text=text;
  if(history)file.history=history;
}
export function hasUnsavedEdits(workspace){
  return Boolean(workspace && [...workspace.files.values()].some(f=>f.text!==f.initialText));
}
export function fileDirtyState(workspace,path) {
  const file=workspace?.files.get(path);
  return Boolean(file && file.text!==file.initialText);
}
