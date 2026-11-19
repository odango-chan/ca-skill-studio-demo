import {openNativeSource} from "./native-source.mjs";

const SOURCE_VIEW_PAIRS = Object.freeze([
  {test:path=>path.toLowerCase().endsWith('/assurance/procedure.yaml'),viewType:'skillStudio.procedurePreview'},
  {test:path=>path.toLowerCase().endsWith('/assurance/contract.yaml'),viewType:'skillStudio.contractPreview'},
  {test:path=>path.toLowerCase().endsWith('/assurance/predicates.yaml'),viewType:'skillStudio.predicatePreview'},
  {test:path=>{const lower=path.toLowerCase(),index=lower.lastIndexOf('/schemas/');return index>=0&&!lower.slice(index+9).includes('/')&&lower.endsWith('.schema.yaml');},viewType:'skillStudio.schemaPreview'}
]);

export function sourceViewType(uri) {
  const path=typeof uri?.path==='string'?uri.path:'';
  return SOURCE_VIEW_PAIRS.find(pair=>pair.test(path))?.viewType??null;
}

// Kept as no-op compatibility exports while existing visualizer modules
// finish migrating. A preview is no longer paired with a second editor.
export function hasSourceViewPair() { return false; }
export function forgetSourceViewPair() {}

export async function openSourceViewPair(vscode,uri,{line}={}) {
  const viewType=sourceViewType(uri);
  const document=(vscode.workspace.textDocuments??[]).find(item=>item.uri.toString()===uri.toString())??
    await vscode.workspace.openTextDocument(uri);
  const safeLine=Number.isSafeInteger(line)&&line>0&&line<=document.lineCount?line:1;
  const position=new vscode.Position(safeLine-1,0);
  const selection=new vscode.Range(position,position);
  await openNativeSource(vscode,uri,{
    viewColumn:vscode.ViewColumn.One,
    preserveFocus:false,
    preview:false,
    selection
  });
  return {
    uri:uri.toString(),
    viewType,
    sourceColumn:vscode.ViewColumn.One,
    visualColumn:null,
    line:safeLine
  };
}
