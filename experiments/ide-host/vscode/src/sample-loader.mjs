// Explicit user-triggered Sample Package import for VS Code desktop/web or
// Theia browser-only OPFS. Never overwrite existing workspace files.
const SRC=["samples","establish-pdu-session"];
const decoder=new TextDecoder();
const fail=reason=>{throw Error(reason);};
const describeUri=uri=>({
  scheme:uri?.scheme??null,
  authority:uri?.authority??null,
  path:uri?.path??null,
  text:uri?.toString?.()??String(uri)
});
const describeError=error=>({
  name:error?.name??null,
  code:error?.code??null,
  message:String(error?.message??error)
});
// Theia 1.76 browser-only currently supplies an HTTP(S) extensionUri in this
// hosted-plugin worker. Fetch only same-origin extension assets in that case.
// Hosts exposing the documented theia-plugin:/vscode-vfs: schemes continue
// through workspace.fs, which is their registered read-only provider.
async function readBundledResource(vscode,uri){
  if(uri.scheme==="http"||uri.scheme==="https"){
    const url=new URL(uri.toString());
    const origin=globalThis.location?.origin;
    if(!origin||url.origin!==origin)
      fail("Refusing cross-origin extension resource: "+url.origin);
    const response=await fetch(url.href,{credentials:"same-origin"});
    if(!response.ok)
      fail("Extension resource HTTP "+response.status+": "+url.pathname);
    return new Uint8Array(await response.arrayBuffer());
  }
  return vscode.workspace.fs.readFile(uri);
}
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
export async function seedExampleWorkspace(vscode,extensionUri,storageUri){
  let phase="initial";
  try{
  if(!vscode?.workspace?.fs||!vscode.Uri?.file||!vscode.Uri.joinPath)
    fail("Host file system unavailable");
  const fileSystem=vscode.workspace.fs;
  const manifestUri=vscode.Uri.joinPath(extensionUri,...SRC,"files.json");
  const extensionInfo=describeUri(extensionUri);
  const manifestInfo=describeUri(manifestUri);
  phase="read-bundled-manifest";
  let manifestBytes;
  try{
    manifestBytes=await readBundledResource(vscode,manifestUri);
  }catch(error){
    fail("Cannot read bundled manifest; extensionUri="+JSON.stringify(extensionInfo)+
      "; manifestUri="+JSON.stringify(manifestInfo)+
      "; resourceRead="+JSON.stringify(describeError(error)));
  }
  const files=validate(JSON.parse(decoder.decode(manifestBytes)));
  // Do not write at file:/// root: browser-only Theia's OPFS provider grants
  // extension workers access to workspace/storage mounts, not the filesystem
  // root. With no opened workspace, seed into this extension's persistent
  // global storage and then expose that directory as the active workspace.
  const current=vscode.workspace.workspaceFolders??[];
  const parent=current[0]?.uri??storageUri;
  if(!parent)fail("No writable workspace or extension storage URI is available");
  const root=vscode.Uri.joinPath(parent,
    ...(current.length?["skill-studio-examples"]:["workspaces"]),
    "establish-pdu-session");
  let created=0,skipped=0;
  phase="create-workspace-root";
  await fileSystem.createDirectory(root);
  for(const file of files){
    const segments=file.split("/");
    const destination=vscode.Uri.joinPath(root,...segments);
    phase="stat-existing:"+file;
    let exists=false;
    try{await fileSystem.stat(destination);exists=true;}
    catch(error){
      if(error?.code!=="FileNotFound")throw error;
    }
    if(exists){skipped++;continue;}
    const source=vscode.Uri.joinPath(extensionUri,...SRC,...segments);
    phase="read-bundled-file:"+file;
    const bytes=await readBundledResource(vscode,source);
    if(!(bytes instanceof Uint8Array))fail("Unrecognized sample file");
    phase="create-parent:"+file;
    if(segments.length>1)
      await fileSystem.createDirectory(vscode.Uri.joinPath(root,...segments.slice(0,-1)));
    // writeFile with create-only intent; a racing external write is guarded
    // by the second stat. The spike does not claim atomic multi-file import.
    try{await fileSystem.stat(destination);fail("Sample file changed during import");}
    catch(error){if(error?.code!=="FileNotFound")throw error;}
    phase="write-file:"+file;
    await fileSystem.writeFile(destination,bytes);
    created++;
  }
  phase="workspace-update";
  let workspaceUpdated=false;
  if(!current.some(f=>f.uri.toString()===root.toString())&&!current.some(f=>
      f.uri.toString()===parent.toString())){
    workspaceUpdated=Boolean(vscode.workspace.updateWorkspaceFolders?.(
      current.length,0,{uri:root,name:"establish-pdu-session"
    }));
  }
  return {root,procedure:vscode.Uri.joinPath(root,"assurance","procedure.yaml"),
    files:files.length,created,skipped,workspaceUpdated};
  }catch(error){
    throw Error(phase+": "+String(error?.message??error));
  }
}
