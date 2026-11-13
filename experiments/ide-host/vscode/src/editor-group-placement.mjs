// Keep ordinary editable documents in the primary Source editor group.
// The caller supplies the host APIs so this policy can be tested without a
// running VS Code/Theia workbench.
export function createSourceOnlyEditorNormalizer(vscode,{
  sourceViewType=()=>null,
  hasSourceViewPair=()=>false,
  onError=()=>{}
}={}){
  const moving=new Set();
  return editor=>{
    const uri=editor?.document?.uri;
    if(!uri||sourceViewType(uri)||hasSourceViewPair(uri)||
       editor.viewColumn===vscode.ViewColumn.One)return Promise.resolve(false);
    const key=uri.toString();
    if(moving.has(key))return Promise.resolve(false);
    moving.add(key);
    return Promise.resolve()
      .then(()=>vscode.commands.executeCommand("workbench.action.moveEditorToFirstGroup"))
      .then(()=>true,error=>{
        onError(error,uri);
        return false;
      })
      .finally(()=>moving.delete(key));
  };
}
