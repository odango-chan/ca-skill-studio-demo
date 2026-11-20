// Theia's browser OPFS can transiently return EIO while a just-written
// workspace file is being reopened. Retry only that filesystem condition;
// never hide parse, permission, or editor-registration failures.
async function retryTransientFileSystemEio(operation,label,attempts=4){
  let lastError;
  for(let attempt=0;attempt<attempts;attempt++){
    try{return await operation();}
    catch(error){
      lastError=error;
      const message=String(error?.message??error);
      if(!(message.includes("EIO")||message.includes("I/O error"))||attempt===attempts-1)throw error;
      console.warn("SKILL_STUDIO_TRANSIENT_FS_RETRY",JSON.stringify({
        operation:label,attempt:attempt+1,attempts,message
      }));
      await new Promise(resolve=>setTimeout(resolve,80*(attempt+1)));
    }
  }
  throw lastError;
}

export async function openTextDocumentWithRetry(vscode,uri){
  return retryTransientFileSystemEio(
    ()=>vscode.workspace.openTextDocument(uri),"openTextDocument");
}

// Theia maps 'default' back through the visual association. Browser-only uses
// a build flag; backend-backed Theia may select this extension's Node entry.
export async function openNativeSource(vscode,uri,options){
  const theia=(typeof STUDIO_THEIA_HOST!=='undefined'&&STUDIO_THEIA_HOST)||vscode.env?.uriScheme==='theia';
  const views=theia?['editor-preview-widget','code-editor-opener']:['default'];
  for(let index=0;index<views.length;index++){
    try{
      return await retryTransientFileSystemEio(
        ()=>vscode.commands.executeCommand('vscode.openWith',uri,views[index],options),
        'openNativeSource');
    }catch(error){
      if(index+1<views.length&&/Could not find an editor/.test(String(error?.message)))continue;
      await vscode.window.showErrorMessage('Source editor failed: '+String(error?.message??error));
      throw error;
    }
  }
}

/**
 * Open a Source line without invoking a Designer CustomEditor. Used by the
 * independent right-side Preview View to keep navigation in the one Source
 * editor group. Do not create a second editor group from Preview links.
 */
export async function revealNativeSourceLine(vscode,uri,line=1){
  const document=await openTextDocumentWithRetry(vscode,uri);
  const safeLine=Number.isSafeInteger(line)&&line>0&&line<=document.lineCount?line:1;
  const position=new vscode.Position(safeLine-1,0);
  const selection=new vscode.Range(position,position);
  return openNativeSource(vscode,uri,{
    viewColumn:vscode.ViewColumn.One,
    preserveFocus:false,
    preview:false,
    selection
  });
}
