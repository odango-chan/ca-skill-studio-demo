// Explicit user-triggered Sample Package import for VS Code desktop/web or
// Theia browser-only OPFS. Never overwrite existing workspace files.
const BASE="/skill-studio-examples/establish-pdu-session";
const SRC=["samples","establish-pdu-session"];
const decoder=new TextDecoder();
const fail=reason=>{throw Error(reason);};
function validate(files){
  if(!Array.isArray(files)||files.length<3||files.length>100||
     !files.includes("SKILL.md")||!files.includes("assurance/procedure.yaml"))
    fail("Unrecognized sample manifest");
  const seen=new Set();
  for(const item of files){
    if(typeof item!=="string"||item.length>180||
       item.startsWith("/")||item.includes("\\")||
       item.split("/").some(s=>!s||s==="."||s==="..")||seen.has(item))
      fail("Unsafe sample manifest path");
    seen.add(item);
  }
  return files;
}
export async function seedExampleWorkspace(vscode,extensionUri){
  if(!vscode?.workspace?.fs||!vscode.Uri?.file||!vscode.Uri.joinPath)
    fail("Host file system unavailable");
  const fileSystem=vscode.workspace.fs;
  const manifestUri=vscode.Uri.joinPath(extensionUri,...SRC,"files.json");
  const files=validate(JSON.parse(decoder.decode(await fileSystem.readFile(manifestUri))));
  const root=vscode.Uri.file(BASE);
  let created=0,skipped=0;
  await fileSystem.createDirectory(root);
  for(const file of files){
    const segments=file.split("/");
    const destination=vscode.Uri.joinPath(root,...segments);
    let exists=false;
    try{await fileSystem.stat(destination);exists=true;}
    catch(error){
      if(error?.code!=="FileNotFound")throw error;
    }
    if(exists){skipped++;continue;}
    const source=vscode.Uri.joinPath(extensionUri,...SRC,...segments);
    const bytes=await fileSystem.readFile(source);
    if(!(bytes instanceof Uint8Array))fail("Unrecognized sample file");
    if(segments.length>1)
      await fileSystem.createDirectory(vscode.Uri.joinPath(root,...segments.slice(0,-1)));
    // writeFile with create-only intent; a racing external write is guarded
    // by the second stat. The spike does not claim atomic multi-file import.
    try{await fileSystem.stat(destination);fail("Sample file changed during import");}
    catch(error){if(error?.code!=="FileNotFound")throw error;}
    await fileSystem.writeFile(destination,bytes);
    created++;
  }
  let workspaceUpdated=false;
  const current=vscode.workspace.workspaceFolders??[];
  if(!current.some(f=>f.uri.toString()===root.toString())){
    workspaceUpdated=Boolean(vscode.workspace.updateWorkspaceFolders?.(
      current.length,0,{uri:root,name:"establish-pdu-session"
    }));
  }
  return {root,procedure:vscode.Uri.joinPath(root,"assurance","procedure.yaml"),
    files:files.length,created,skipped,workspaceUpdated};
}
