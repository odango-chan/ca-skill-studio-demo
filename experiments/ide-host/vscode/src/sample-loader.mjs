// Explicit Sample Package import for VS Code desktop/web or Theia browser-only OPFS.
// Online demo reset replaces the two bundled SKILL packages with their pinned
// source; desktop/user workspaces remain create-only unless reset is explicit.
const SRC=["samples","skills"];
// The project owns authored skills/ Source. Dependencies and BuildResults are
// managed by their services; the sample importer never creates lib/ or output/.
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
export async function seedExampleProject(vscode,extensionUri,storageUri,
  {resetExisting=false,onProgress=()=>{}}={}){
  let phase="initial";
  const report=event=>{if(typeof onProgress==="function")onProgress(event);};
  try{
  if(!vscode?.workspace?.fs||!vscode.Uri?.file||!vscode.Uri.joinPath)
    fail("Host file system unavailable");
  const fileSystem=vscode.workspace.fs;
  const manifestUri=vscode.Uri.joinPath(extensionUri,...SRC,"files.json");
  const extensionInfo=describeUri(extensionUri);
  const manifestInfo=describeUri(manifestUri);
  phase="read-bundled-manifest";
  report({phase:"manifest"});
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
  report({phase:"files",completed:0,total:files.length});
  // The actual folder basename must be the project name: Theia 1.76
  // ignores WorkspaceFolder.name passed to updateWorkspaceFolders().
  if(!storageUri)fail("No writable extension storage URI");
  const legacySkillsRoot=vscode.Uri.joinPath(storageUri,"workspaces","skills");
  const root=vscode.Uri.joinPath(storageUri,EXAMPLE_PROJECT_NAME);
  const skillsRoot=vscode.Uri.joinPath(root,"skills");
  let created=0,skipped=0,overwritten=0,resetPackages=0;
  phase="create-project-layout";
  await fileSystem.createDirectory(root);
  await fileSystem.createDirectory(skillsRoot);
  if(resetExisting){
    // Reset only the two known bundled Skill package directories. This clears
    // edited and untracked files inside those packages, but leaves other Skills,
    // lib/, output/, and every unrelated/user-selected workspace untouched.
    for(const skill of SKILLS){
      let found=false;
      for(const packageRoot of [
        vscode.Uri.joinPath(skillsRoot,skill),
        vscode.Uri.joinPath(legacySkillsRoot,skill)
      ]){
        phase="reset-package:"+skill;
        try{
          await fileSystem.stat(packageRoot);
          found=true;
          await fileSystem.delete(packageRoot,{recursive:true,useTrash:false});
        }catch(error){
          if(error?.code!=="FileNotFound")throw error;
        }
      }
      if(found)resetPackages++;
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
    if(exists&&!resetExisting){
      skipped++;
      report({phase:"files",completed:created+skipped+overwritten,total:files.length});
      continue;
    }
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
    report({phase:"files",completed:created+skipped+overwritten,total:files.length});
  }
  phase="project-ready";
  report({phase:"project-ready"});
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
  return {root,skillsRoot,
    procedure:procedures[SKILLS[0]],procedures,skills:[...SKILLS],
    sourceSha:manifest.sourceSha,files:files.length,created,skipped,overwritten,
    resetPackages,resetExisting};
  }catch(error){
    throw Error(phase+": "+String(error?.message??error));
  }
}
