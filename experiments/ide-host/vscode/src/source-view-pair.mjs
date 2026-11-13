import {openNativeSource} from './native-source.mjs';

const SOURCE_VIEW_PAIRS = Object.freeze([
  {test:path=>path.toLowerCase().endsWith('/assurance/procedure.yaml'),viewType:'skillStudio.procedurePreview'},
  {test:path=>path.toLowerCase().endsWith('/assurance/contract.yaml'),viewType:'skillStudio.contractPreview'},
  {test:path=>path.toLowerCase().endsWith('/assurance/predicates.yaml'),viewType:'skillStudio.predicatePreview'},
  {test:path=>{const lower=path.toLowerCase(),index=lower.lastIndexOf('/schemas/');return index>=0&&!lower.slice(index+9).includes('/')&&lower.endsWith('.schema.yaml');},viewType:'skillStudio.schemaPreview'}
]);

const openingPairs=new Set();
const openPairs=new Set();

function keyOf(uri) {
  return typeof uri?.toString==='function'?uri.toString():null;
}

export function sourceViewType(uri) {
  const path=typeof uri?.path==='string'?uri.path:'';
  return SOURCE_VIEW_PAIRS.find(pair=>pair.test(path))?.viewType??null;
}

export function hasSourceViewPair(uri) {
  const key=keyOf(uri);
  return Boolean(key&&(openingPairs.has(key)||openPairs.has(key)));
}

export function forgetSourceViewPair(uri) {
  const key=keyOf(uri);
  if(key) {
    openingPairs.delete(key);
    openPairs.delete(key);
  }
}

// Source-first orchestration avoids opening a duplicate text editor from inside
// resolveCustomTextEditor. The native Source is the default editor; this helper
// opens the visual in column two and keeps the one live Source in column one.
export async function openSourceViewPair(vscode,uri,{line}={}) {
  const viewType=sourceViewType(uri);
  const document=(vscode.workspace.textDocuments??[]).find(item=>item.uri.toString()===uri.toString())??
    await vscode.workspace.openTextDocument(uri);
  const safeLine=Number.isSafeInteger(line)&&line>0&&line<=document.lineCount?line:1;
  const position=new vscode.Position(safeLine-1,0);
  const selection=new vscode.Range(position,position);
  if(!viewType) {
    await openNativeSource(vscode,uri,{
      viewColumn:vscode.ViewColumn.One,preserveFocus:false,preview:false,selection
    });
    return {uri:uri.toString(),viewType:null,sourceColumn:vscode.ViewColumn.One,
      visualColumn:null,line:safeLine};
  }

  const key=keyOf(uri);
  openingPairs.add(key);
  try {
    const active=vscode.window.activeTextEditor;
    if(active?.document?.uri?.toString()===key&&
       active.viewColumn!==vscode.ViewColumn.One) {
      // If the user opened Source from the right group, move that exact tab
      // rather than leaving a duplicate copy behind after creating the Visual.
      try{await vscode.commands.executeCommand('workbench.action.moveEditorToFirstGroup');}
      catch{/* Some compatible hosts do not expose the move command. */}
    }
    await vscode.commands.executeCommand('vscode.openWith',uri,viewType,{
      viewColumn:vscode.ViewColumn.Two,preserveFocus:true,preview:false
    });
    await openNativeSource(vscode,uri,{
      viewColumn:vscode.ViewColumn.One,preserveFocus:false,preview:false,selection
    });
    openPairs.add(key);
    const editor=vscode.window.visibleTextEditors?.find(item=>
      item.document.uri.toString()===key&&item.viewColumn===vscode.ViewColumn.One);
    if(editor) {
      editor.selection=new vscode.Selection(position,position);
      editor.revealRange(selection,vscode.TextEditorRevealType.InCenter);
    }
    return {uri:key,viewType,sourceColumn:vscode.ViewColumn.One,
      visualColumn:vscode.ViewColumn.Two,line:safeLine};
  } finally {
    openingPairs.delete(key);
  }
}
