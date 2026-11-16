// Theia maps 'default' back through the visual association. Browser-only uses
// a build flag; backend-backed Theia may select this extension's Node entry.
export async function openNativeSource(vscode,uri,options){
  const theia=(typeof STUDIO_THEIA_HOST!=='undefined'&&STUDIO_THEIA_HOST)||vscode.env?.uriScheme==='theia';
  const views=theia?['editor-preview-widget','code-editor-opener']:['default'];
  for(let index=0;index<views.length;index++){
    try{return await vscode.commands.executeCommand('vscode.openWith',uri,views[index],options);}
    catch(error){
      if(index+1<views.length&&/Could not find an editor/.test(String(error?.message)))continue;
      await vscode.window.showErrorMessage('Source editor failed: '+String(error?.message??error));
      throw error;
    }
  }
}
