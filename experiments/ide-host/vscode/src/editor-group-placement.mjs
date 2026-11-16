// Keep ordinary editable documents in the primary Source editor group.
// The move command operates on the *currently active* editor, not the editor
// passed by the event. Re-activate the captured document first so a rapid
// CustomEditor/Source transition cannot move the wrong tab into column one.
export function createSourceOnlyEditorNormalizer(vscode,{
  sourceViewType=()=>null,
  hasSourceViewPair=()=>false,
  onError=()=>{}
}={}){
  const moving=new Set();
  return async editor=>{
    const uri=editor?.document?.uri;
    if(!uri||sourceViewType(uri)||hasSourceViewPair(uri)||
       editor.viewColumn===vscode.ViewColumn.One)return false;
    const key=uri.toString();
    if(moving.has(key))return false;
    moving.add(key);
    try{
      let active=vscode.window.activeTextEditor;
      if(active?.document?.uri?.toString()!==key){
        if(typeof vscode.window.showTextDocument!=="function")return false;
        await vscode.window.showTextDocument(editor.document,{
          viewColumn:editor.viewColumn,preserveFocus:false,preview:false
        });
        active=vscode.window.activeTextEditor;
      }
      // Never issue a global active-editor command unless the intended Source
      // document is demonstrably active at the moment the command is invoked.
      if(active?.document?.uri?.toString()!==key||
         active.viewColumn===vscode.ViewColumn.One)return false;
      await vscode.commands.executeCommand("workbench.action.moveEditorToFirstGroup");
      return true;
    }catch(error){
      onError(error,uri);
      return false;
    }finally{
      moving.delete(key);
    }
  };
}
