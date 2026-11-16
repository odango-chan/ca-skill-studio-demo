// File-aware Visual capability, independent of editor UI state.
export const isMarkdownFile=path=>/\.md$/i.test(String(path??""));
export function viewKindFor({path,projection,previewAvailable=true}={}){
  if(isMarkdownFile(path))return previewAvailable?"markdown":"source";
  return projection?.state==="READY"?"procedure":"source";
}
export function availableModes(kind){
  return kind==="source"?["source"]:["visual","source","split"];
}
export function permittedMode(kind,requested){
  return availableModes(kind).includes(requested)?requested:"source";
}
export const graphControlsAvailable=kind=>kind==="procedure";
