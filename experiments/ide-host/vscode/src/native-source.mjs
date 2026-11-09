// Theia 1.76 maps vscode.openWith(..., 'default') back through the default
// association. Its dedicated text opener is required for explicit Source UI.
// Only the Theia worker build defines this flag; VS Code keeps its public ID.
export function openNativeSource(vscode,uri,options){
  const view=typeof STUDIO_THEIA_HOST!=='undefined'&&STUDIO_THEIA_HOST
    ?'code-editor-opener':'default';
  return vscode.commands.executeCommand('vscode.openWith',uri,view,options);
}
