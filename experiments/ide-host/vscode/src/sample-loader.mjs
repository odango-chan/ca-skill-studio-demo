// Explicit Sample Package import for VS Code desktop/web or Theia browser-only OPFS.
// Online demo reset replaces the two bundled SKILL packages with their pinned
// source; desktop/user workspaces remain create-only unless reset is explicit.
const SRC=["samples","skills"];
// A Skill Compiler project has one source workspace with three top-level
// directories. The Studio demo may seed only skills/; it must not invent
// Tool contracts in lib/ or build artifacts in output/.
export const EXAMPLE_PROJECT_NAME="skill-studio-demo";
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

    // In browser-only Theia, extensionUri can already include the GitHub
    // Pages base path. Prefixing it again makes every sample fetch a 404.
    // Some worker URLs instead omit that prefix; handle both exact same-origin
    // paths without assuming a particular deployment directory.
    const workerPath=globalThis.location?.pathname??"";
    const hostedMarker="/hostedPlugin/";
    const markerAt=workerPath.indexOf(hostedMarker);
    const contextMarker="/context/";
    const contextAt=workerPath.indexOf(contextMarker);
    const workerFile="/plugin-worker.js";
    const rootWorkerAt=workerPath.endsWith(workerFile)
      ?workerPath.length-workerFile.length:-1;
    const appPrefix=markerAt>=0?workerPath.slice(0,markerAt)
      :contextAt>=0?workerPath.slice(0,contextAt)
      :rootWorkerAt>=0?workerPath.slice(0,rootWorkerAt):"";
    const resourcePath=url.pathname;
    const alreadyPrefixed=Boolean(appPrefix)&&
      (resourcePath===appPrefix||resourcePath.startsWith(appPrefix+"/"));
    const candidates=alreadyPrefixed||!appPrefix
      ?[resourcePath]
      :[appPrefix+resourcePath,resourcePath];
    const attempts=[];
    for(const candidate of [...new Set(candidates)]){
      const resourceUrl=new URL(candidate+url.search,origin);
      const response=await fetch(resourceUrl.href,{credentials:"same-origin"});
      if(response.ok)return new Uint8Array(await response.arrayBuffer());
      attempts.push(response.status+" "+resourceUrl.pathname);
      // A missing asset may have been published under an unprefixed path;
      // other HTTP failures must not be masked by speculative fallbacks.
      if(response.status!==404)break;
    }
    fail("Extension resource unavailable: "+attempts.join("; ")+
      "; workerPath="+workerPath+"; appPrefix="+appPrefix);
  }
  return vscode.workspace.fs.readFile(uri);
}
function workspaceHasRoot(workspace,root){
  const target=root.toString();
  return (workspace.workspaceFolders??[]).some(folder=>
    folder?.uri?.toString?.()===target);
}
async function exposeWorkspaceRoot(workspace,root,legacyRoots=[]){
  if(workspaceHasRoot(workspace,root))return false;
  if(typeof workspace.updateWorkspaceFolders!=="function"||
     typeof workspace.onDidChangeWorkspaceFolders!=="function")
    fail("Host cannot open a native workspace folder");
  const folders=workspace.workspaceFolders??[];
  const legacySet=new Set(legacyRoots.map(uri=>uri.toString()));
  const legacyIndex=folders.findIndex(folder=>
    legacySet.has(folder?.uri?.toString?.()));
  const start=legacyIndex>=0?legacyIndex:folders.length;
  const deleteCount=legacyIndex>=0?1:0;
  let subscription=null,timer=null,settled=false;
  const waitForRoot=new Promise((resolve,reject)=>{
    const finish=(error)=>{
      if(settled)return;
      settled=true;
      subscription?.dispose?.();
      if(timer!==null)clearTimeout(timer);
      if(error)reject(error);else resolve(true);
    };
    subscription=workspace.onDidChangeWorkspaceFolders(()=>{
      if(workspaceHasRoot(workspace,root))finish();
    });
    timer=setTimeout(()=>{
      const current=(workspace.workspaceFolders??[]).map(folder=>
        folder?.uri?.toString?.()??"<invalid-uri>");
      finish(Error("Timed out waiting for Theia to open project root "+
        root.toString()+"; current workspace folders: "+JSON.stringify(current)));
    },15000);
    let accepted=false;
    try{
      accepted=workspace.updateWorkspaceFolders(start,deleteCount,{uri:root,name});
    }catch(error){
      finish(Error("Workspace update request failed: "+String(error?.message??error)));
      return;
    }
    if(!accepted){
      if(workspaceHasRoot(workspace,root))finish();
      else finish(Error("Theia rejected the project workspace root update"));
      return;
    }
    // Some hosts publish the new folder before returning from the API call;
    // others report it only through onDidChangeWorkspaceFolders.
    if(workspaceHasRoot(workspace,root))finish();
  });
  await waitForRoot;
  if(!workspaceHasRoot(workspace,root))
    fail("Workspace change event arrived without the requested project root");
  return true;
}
function validate(manifest){
  if(manifest?.schemaVersion!==1||
     manifest?.sourceRepo!=="odango-chan/ca-skills"||
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
export async function seedExampleWorkspace(vscode,extensionUri,storageUri,{resetExisting=false}={}){
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
  // The actual folder basename must be the project name: Theia 1.76
  // ignores WorkspaceFolder.name passed to updateWorkspaceFolders().
  if(!storageUri)fail("No writable extension storage URI");
  const legacyRoot=vscode.Uri.joinPath(storageUri,"workspaces");
  const legacySkillsRoot=vscode.Uri.joinPath(legacyRoot,"skills");
  const root=vscode.Uri.joinPath(storageUri,EXAMPLE_PROJECT_NAME);
  const skillsRoot=vscode.Uri.joinPath(root,"skills");
  const libraryRoot=vscode.Uri.joinPath(root,"lib");
  const outputRoot=vscode.Uri.joinPath(root,"output");
  let created=0,skipped=0,overwritten=0;
  phase="create-project-layout";
  await fileSystem.createDirectory(root);
  await fileSystem.createDirectory(skillsRoot);
  await fileSystem.createDirectory(libraryRoot);
  await fileSystem.createDirectory(outputRoot);
  if(resetExisting){
    // Reset only the two known bundled Skill package directories. This clears
    // edited and untracked files inside those packages, but leaves other Skills,
    // lib/, output/, and every unrelated/user-selected workspace untouched.
    for(const skill of SKILLS){
      for(const packageRoot of [
        vscode.Uri.joinPath(skillsRoot,skill),
        vscode.Uri.joinPath(legacySkillsRoot,skill)
      ]){
        phase="reset-package:"+skill;
        try{
          await fileSystem.stat(packageRoot);
          await fileSystem.delete(packageRoot,{recursive:true,useTrash:false});
        }catch(error){
          if(error?.code!=="FileNotFound")throw error;
        }
      }
    }
  }
  for(const file of files){
    const segments=file.split("/");
    const destination=vscode.Uri.joinPath(skillsRoot,...segments);
    phase="stat-existing:"+file;
    let exists=false;
    try{await fileSystem.stat(destination);exists=true;}
    catch(error){
      if(error?.code!=="FileNotFound")throw error;
    }
    if(exists&&!resetExisting){skipped++;continue;}
    const source=vscode.Uri.joinPath(extensionUri,...SRC,...segments);
    phase="read-bundled-file:"+file;
    const bytes=await readBundledResource(vscode,source);
    if(!(bytes instanceof Uint8Array))fail("Unrecognized sample file");
    phase="create-parent:"+file;
    if(segments.length>1)
      await fileSystem.createDirectory(vscode.Uri.joinPath(skillsRoot,...segments.slice(0,-1)));
    // Normal imports remain create-only. The online demo's explicit reset
    // intentionally replaces every pinned manifest file with canonical bytes.
    if(!exists){
      try{await fileSystem.stat(destination);fail("Sample file changed during import");}
      catch(error){if(error?.code!=="FileNotFound")throw error;}
    }
    phase="write-file:"+file;
    await fileSystem.writeFile(destination,bytes);
    if(exists)overwritten++;else created++;
  }
  phase="workspace-update-confirmation";
  const workspaceUpdated=await exposeWorkspaceRoot(vscode.workspace,root,[
    legacyRoot,legacySkillsRoot
  ]);
  if(resetExisting){
    // Remove only the two legacy bundled package directories from the previous
    // extension-owned workspace location. Other Skills and unrelated data stay.
    for(const skill of SKILLS){
      const legacyPackage=vscode.Uri.joinPath(legacySkillsRoot,skill);
      phase="clear-legacy-package:"+skill;
      try{
        await fileSystem.stat(legacyPackage);
        await fileSystem.delete(legacyPackage,{recursive:true,useTrash:false});
      }catch(error){
        if(error?.code!=="FileNotFound")throw error;
      }
    }
  }
  const procedures=Object.fromEntries(SKILLS.map(name=>
    [name,vscode.Uri.joinPath(skillsRoot,name,"assurance","procedure.yaml")]));
  return {root,skillsRoot,libraryRoot,outputRoot,
    procedure:procedures[SKILLS[0]],procedures,skills:[...SKILLS],
    sourceSha:manifest.sourceSha,files:files.length,created,skipped,overwritten,
    resetExisting,workspaceUpdated};
  }catch(error){
    throw Error(phase+": "+String(error?.message??error));
  }
}
