// Project navigation is a workspace operation, not a multi-root append.
// Theia 1.76 derives the workbench title from the opened folder or workspace
// file. Opening a directory directly avoids creating an anonymous Untitled
// multi-root workspace when the user asks to open a project.
export const PENDING_EXAMPLE_OPEN_KEY="skillStudio.pendingExampleOpen";

export function isSingleFolderWorkspace(vscode,root){
  const target=root?.toString?.();
  if(!target||vscode?.workspace?.workspaceFile)return false;
  const folders=vscode?.workspace?.workspaceFolders??[];
  return folders.length===1&&folders[0]?.uri?.toString?.()===target;
}

export async function openProjectFolder(vscode,root){
  if(!root?.toString?.())
    throw Error("A project folder URI is required");
  if(typeof vscode?.commands?.executeCommand!=="function")
    throw Error("The host does not expose native project-folder opening");
  // VS Code and Theia both implement this command. forceReuseWindow keeps the
  // existing browser tab/window and replaces its current workspace identity.
  await vscode.commands.executeCommand(
    "vscode.openFolder",root,{forceReuseWindow:true}
  );
}

export async function restorePendingExampleProject(vscode,context,{
  revealPackages,onRestored
}={}){
  const state=context?.globalState;
  const pending=state?.get?.(PENDING_EXAMPLE_OPEN_KEY);
  if(!pending||typeof pending.root!=="string"||
     typeof pending.procedure!=="string")return false;
  if(typeof vscode?.Uri?.parse!=="function")return false;
  const root=vscode.Uri.parse(pending.root);
  if(!isSingleFolderWorkspace(vscode,root))return false;

  try{
    await revealPackages?.();
    await vscode.commands.executeCommand(
      "skillStudio.openProcedure",vscode.Uri.parse(pending.procedure)
    );
    await state.update(PENDING_EXAMPLE_OPEN_KEY,undefined);
    await onRestored?.(pending);
    return true;
  }catch(error){
    await state.update(PENDING_EXAMPLE_OPEN_KEY,undefined);
    throw error;
  }
}
