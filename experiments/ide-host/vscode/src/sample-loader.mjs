// Explicit user-triggered Sample Package import for VS Code desktop/web or
// Theia browser-only OPFS. Never overwrite existing workspace files.
const SRC=["samples","skills"];
// The v0.1 Example has its own stable root. Never reuse the legacy OPFS
// workspaces/ directory, which may contain user-edited or unrelated files.
export const EXAMPLE_PROJECT_NAME="Skill Studio Example";
export const EXAMPLE_PROJECT_DIRECTORY="skill-studio-example-v01";
const SKILLS=Object.freeze(["establish-pdu-session","establish-pdu-session-mas"]);
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
    // Browser-only Theia may expose extensionUri without the deployment
    // subpath even though the worker bundle itself was loaded beneath it.
    // Recover only that same-origin app prefix from the worker's own URL.
    const workerPath=globalThis.location?.pathname??"";
    const hostedMarker="/hostedPlugin/";
    const markerAt=workerPath.indexOf(hostedMarker);
    // Some Theia workers load from /context/plugin-vscode-init-fe.js,
    // while extensionUri itself is root-relative. The context URL is still
    // app-prefixed and provides the same trusted base without hardcoding it.
    const contextMarker="/context/";
    const contextAt=workerPath.indexOf(contextMarker);
    const workerFile="/plugin-worker.js";
    const rootWorkerAt=workerPath.endsWith(workerFile)
      ?workerPath.length-workerFile.length:-1;
    const appPrefix=markerAt>=0?workerPath.slice(0,markerAt)
      :contextAt>=0?workerPath.slice(0,contextAt)
      :rootWorkerAt>=0?workerPath.slice(0,rootWorkerAt):"";
    const resourcePath=appPrefix+url.pathname;
    const resourceUrl=new URL(resourcePath+url.search,origin);
    const response=await fetch(resourceUrl.href,{credentials:"same-origin"});
    if(!response.ok)
      fail("Extension resource HTTP "+response.status+": "+resourceUrl.pathname+
        "; workerPath="+workerPath+"; appPrefix="+appPrefix);
    return new Uint8Array(await response.arrayBuffer());
  }
  return vscode.workspace.fs.readFile(uri);
}
function validate(manifest){
  if(manifest?.schemaVersion!==1||
     manifest?.sourceRepo!=="odango-chan/ca-agent-demo"||
     !/^[a-f0-9]{40}$/.test(manifest?.sourceSha??"")||
     !Array.isArray(manifest.skills)||
     JSON.stringify(manifest.skills)!==JSON.stringify(SKILLS)||
     !Array.isArray(manifest.files)||manifest.files.length<6||
     manifest.files.length>100)
    fail("Unrecognized two-SKILL sample manifest");
  const seen=new Set();
  for(const item of manifest.files){
    if(typeof item!=="string"||item.length>180||
       item.startsWith("/")||item.includes("\\")||
       item.split("/").some(p=>!p||p==="."||p==="..")||
       !SKILLS.includes(item.split("/")[0])||seen.has(item))
      fail("Unsafe or unexpected sample path");
    seen.add(item);
  }
  for(const skill of SKILLS)
    if(!seen.has(skill+"/SKILL.md")||
       !seen.has(skill+"/assurance/procedure.yaml")||
       !seen.has(skill+"/assurance/contract.yaml")||
       !seen.has(skill+"/assurance/predicates.yaml"))
      fail("Missing required "+skill+" package files");
  return manifest;
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
  const manifest=validate(JSON.parse(decoder.decode(manifestBytes)));
  const files=manifest.files;
  // A fresh, isolated namespace: legacy workspaces/ is never written to.
  if(!storageUri)fail("No writable extension storage URI");
  const root=vscode.Uri.joinPath(storageUri,EXAMPLE_PROJECT_DIRECTORY);
  const skillsRoot=vscode.Uri.joinPath(root,"skills");
  const legacyRoot=vscode.Uri.joinPath(storageUri,"workspaces");
  const legacySkillsRoot=vscode.Uri.joinPath(legacyRoot,"skills");
  const current=vscode.workspace.workspaceFolders??[];
  let created=0,skipped=0;
  phase="create-project-layout";
  await fileSystem.createDirectory(root);
  await fileSystem.createDirectory(skillsRoot);
  for(const file of files){
    const segments=file.split("/");
    const destination=vscode.Uri.joinPath(skillsRoot,...segments);
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
      await fileSystem.createDirectory(vscode.Uri.joinPath(skillsRoot,...segments.slice(0,-1)));
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
  if(!current.some(f=>f.uri.toString()===root.toString())){
    // Replace only the exact extension-owned legacy mount. Its OPFS contents
    // remain untouched; never remove or repurpose a user-selected folder.
    const legacyIndex=current.findIndex(folder=>
      [legacyRoot.toString(),legacySkillsRoot.toString()].includes(folder.uri.toString()));
    workspaceUpdated=Boolean(vscode.workspace.updateWorkspaceFolders?.(
      legacyIndex>=0?legacyIndex:current.length,legacyIndex>=0?1:0,
      {uri:root,name:EXAMPLE_PROJECT_NAME}));
    if(!workspaceUpdated)
      fail("Cannot expose bundled SKILL project in the native Explorer");
  }
  const procedures=Object.fromEntries(SKILLS.map(name=>
    [name,vscode.Uri.joinPath(skillsRoot,name,"assurance","procedure.yaml")]));
  return {root,skillsRoot,
    procedure:procedures[SKILLS[0]],procedures,skills:[...SKILLS],
    sourceSha:manifest.sourceSha,files:files.length,created,skipped,workspaceUpdated};
  }catch(error){
    throw Error(phase+": "+String(error?.message??error));
  }
}
