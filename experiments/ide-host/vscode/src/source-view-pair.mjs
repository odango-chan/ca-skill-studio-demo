import {openNativeSource} from './native-source.mjs';

const SOURCE_VIEW_PAIRS = Object.freeze([
  {test:path=>path.toLowerCase().endsWith('/assurance/procedure.yaml'),viewType:'skillStudio.procedurePreview'},
  {test:path=>path.toLowerCase().endsWith('/assurance/contract.yaml'),viewType:'skillStudio.contractPreview'},
  {test:path=>path.toLowerCase().endsWith('/assurance/predicates.yaml'),viewType:'skillStudio.predicatePreview'},
  {test:path=>path.toLowerCase().includes('/schemas/')&&path.toLowerCase().endsWith('.schema.yaml'),viewType:'skillStudio.schemaPreview'}
]);

export function sourceViewType(uri) {
  const path=typeof uri?.path==='string'?uri.path:'';
  return SOURCE_VIEW_PAIRS.find(pair=>pair.test(path))?.viewType??null;
}

// A CustomEditor owns the visual representation; the native text editor remains
// the only editable Source. Both are deliberately pinned to stable columns.
export async function pairCustomEditor(vscode,panel,document) {
  if(typeof panel?.reveal!=='function')
    throw new Error('Host does not support moving the visual editor into the right editor group');
  panel.reveal(vscode.ViewColumn.Two,true);
  await openNativeSource(vscode,document.uri,{
    viewColumn:vscode.ViewColumn.One,preserveFocus:true,preview:false
  });
}

// Cross-file navigation uses the same pairing contract as ordinary Explorer
// opens. A file without a registered Designer remains a normal left-column
// Source editor and never gets an empty placeholder view.
export async function openSourceViewPair(vscode,uri,{line}={}) {
  const viewType=sourceViewType(uri);
  const document=await vscode.workspace.openTextDocument(uri);
  const safeLine=Number.isSafeInteger(line)&&line>0&&line<=document.lineCount?line:1;
  const position=new vscode.Position(safeLine-1,0);
  const selection=new vscode.Range(position,position);
  if(viewType) {
    await vscode.commands.executeCommand('vscode.openWith',uri,viewType,{
      viewColumn:vscode.ViewColumn.Two,preserveFocus:false,preview:false
    });
  }
  await openNativeSource(vscode,uri,{
    viewColumn:vscode.ViewColumn.One,preserveFocus:true,preview:false,selection
  });
  const editor=vscode.window.visibleTextEditors?.find(item=>
    item.document.uri.toString()===uri.toString()&&item.viewColumn===vscode.ViewColumn.One);
  if(editor) {
    editor.selection=new vscode.Selection(position,position);
    editor.revealRange(selection,vscode.TextEditorRevealType.InCenter);
  }
  return {uri:uri.toString(),viewType,sourceColumn:vscode.ViewColumn.One,
    visualColumn:viewType?vscode.ViewColumn.Two:null,line:safeLine};
}
