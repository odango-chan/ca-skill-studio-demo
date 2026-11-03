// Exact read-only fixture inventory, pinned to ca-agent-demo@bf445ad.
// This manifest is UI metadata and is not inserted into the exported SKILL Package.
const core=["SKILL.md","assurance/contract.yaml","assurance/procedure.yaml","assurance/predicates.yaml"];
const establishExtras=[
  "schemas/establishment-request.schema.yaml",
  "schemas/predicate-evaluation-result.schema.yaml",
  "schemas/selection-input.schema.yaml",
  "schemas/selection.schema.yaml",
  "schemas/transfer-start-evaluation-input.schema.yaml",
  "schemas/udm-read-evaluation-input.schema.yaml",
  "scripts/evaluate_transfer_start.py",
  "scripts/evaluate_udm_read.py",
  "scripts/select_establishment_configuration.py"
];
export const SAMPLE_PACKAGES=Object.freeze({
  ensure:Object.freeze({name:"ensure-pdu-session",entry:"assurance/procedure.yaml",files:Object.freeze([...core])}),
  establish:Object.freeze({name:"establish-pdu-session",entry:"assurance/procedure.yaml",files:Object.freeze([...core,...establishExtras])})
});

export function packageFilesForSample(key) {
  const spec=SAMPLE_PACKAGES[key];
  if(!spec)throw new Error("Unknown sample package");
  return spec.files.map(path=>({
    path,url:"./samples/packages/"+spec.name+"/"+path
  }));
}

export function createFileWorkspace(name,entries) {
  if(typeof name!=="string" || !/^[a-zA-Z0-9._-]{1,100}$/.test(name))
    throw new Error("Invalid workspace name");
  if(!Array.isArray(entries) || !entries.length || entries.length>32)
    throw new Error("Invalid workspace file count");
  const map=new Map();
  for(const item of entries){
    if(!item||typeof item.path!=="string"||typeof item.text!=="string"||
       item.path.length===0||item.path.length>240||item.path.startsWith("/")||
       item.path.split("/").some(part=>!part||part==="."||part===".."||
         /[\\\u0000-\u001f:<>|?*]/.test(part))||map.has(item.path))
      throw new Error("Invalid or duplicated workspace path");
    if(item.text.length>1024*1024 || item.text.includes("\u0000"))
      throw new Error("Invalid text asset");
    map.set(item.path,{path:item.path,initialText:item.text,text:item.text,history:null});
  }
  return {name,files:map};
}
export function markFileEdited(workspace,path,text,history) {
  const file=workspace?.files.get(path);
  if(!file||typeof text!=="string")throw new Error("Unknown workspace file");
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
