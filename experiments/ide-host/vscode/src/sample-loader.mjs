// Explicit Example project import for VS Code desktop/web or Theia browser-only OPFS.
// Replacing an existing Example is a deliberate, user-confirmed operation that
// deletes the Example root and recreates it from the single pinned v1alpha5 source.
// Ordinary projects are never passed to this importer. It never creates lib/ or output/.
import {writeImmutableSnapshot} from "./dependency-service.mjs";
import {EXAMPLE_INTERFACE_ARCHIVE,prepareExampleInterfaceDependency,
  exampleWorkspaceSettingsContent} from "./example-interface-dependency.mjs";

export const EXAMPLE_PROJECT_NAME="skill-studio-demo";
const SKILLS=Object.freeze(["establish-pdu-session","establish-pdu-session-mas","modify-pdu-session-mas","release-pdu-session-mas"]);
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
async function clearDirectoryContents(vscode,fs,root,{preserveVscode=false}={}){
  if(typeof fs.readDirectory!=="function")
    fail("Host file system cannot enumerate the existing Example directory");
  let entries;
  try{entries=await fs.readDirectory(root);}
  catch(error){
    fail("Cannot enumerate the existing Example directory: "+
      JSON.stringify(describeError(error)));
  }
  for(const [name] of entries){
    if(typeof name!=="string"||!name||name==="."||name===".."||
       name.includes("/")||name.includes("\\"))
      fail("Host file system returned an unsafe Example child name");
    // .vscode/settings.json controls the active Theia workspace. Deleting
    // it during an explicit Example replacement can restart the extension
    // host and abort the import halfway through. Replace it at the very end.
    if(preserveVscode&&name===".vscode")continue;
    const child=vscode.Uri.joinPath(root,name);
    await fs.delete(child,{recursive:true,useTrash:false});
  }
  const remaining=await fs.readDirectory(root);
  if(remaining.some(([name])=>!preserveVscode||name!==".vscode")||
     remaining.length>(preserveVscode?1:0))
    fail("Existing Example contents remain after replacement cleanup: "+
      remaining.map(([name])=>name).join(", "));
  return entries.map(([name])=>name);
}
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
function validate(manifest,{sourceSha,sourceStatus,sourceRef,languageVersion,projectReadme}={}){
  if(manifest?.schemaVersion!==1||manifest?.sourceRepo!=="odango-chan/ca-skills"||
     manifest?.sourceSha!==sourceSha||manifest?.sourceStatus!==sourceStatus||
     manifest?.sourceRef!==sourceRef||
     (languageVersion&&manifest?.languageVersion!==languageVersion)||
     (projectReadme&&manifest?.projectReadme!==projectReadme)||
     !Array.isArray(manifest.skills)||
     JSON.stringify(manifest.skills)!==JSON.stringify(SKILLS)||
     !Array.isArray(manifest.files)||manifest.files.length<5||
     manifest.files.length>100||!manifest.blobs||typeof manifest.blobs!=="object")
    fail("Unrecognized or stale pinned sample manifest");
  const seen=new Set();
  for(const item of manifest.files){
    if(typeof item!=="string"||item.length>180||item.startsWith("/")||
       item.includes("\\")||item.split("/").some(part=>!part||part==="."||part==="..")||
       !SKILLS.includes(item.split("/")[0])||seen.has(item)||
       !/^[a-f0-9]{40}$/.test(manifest.blobs[item]??""))
      fail("Unsafe, duplicate or unpinned sample path");
    seen.add(item);
  }
  for(const skill of SKILLS)
    for(const required of ["SKILL.md","assurance/contract.yaml",
      "assurance/procedure.yaml","assurance/predicates.yaml"])
      if(!seen.has(skill+"/"+required))fail("Missing required "+skill+"/"+required);
  return manifest;
}
// Seed only a missing default lock. An existing settings.json is the user's
// explicit configuration and is NEVER rewritten, even if ca-client is absent.
async function persistExampleInterfaceIfAbsent(vscode,root,prepared,
  {replaceSettings=false}={}){
  const fs=vscode.workspace.fs;
  const settingsUri=vscode.Uri.joinPath(root,".vscode","settings.json");
  const exists=async uri=>{
    try{await fs.stat(uri);return true;}
    catch(error){if(error?.code==="FileNotFound")return false;throw error;}
  };
  if(!replaceSettings&&await exists(settingsUri))return false;
  const persisted=await writeImmutableSnapshot(vscode,root,prepared.files);
  if(persisted.snapshotDigest!==prepared.snapshotDigest)
    fail("Example Interface Package snapshot digest mismatch");
  // A second startup/import task may have created user settings meanwhile.
  if(!replaceSettings&&await exists(settingsUri))return false;
  const settingsFolder=vscode.Uri.joinPath(root,".vscode");
  await fs.createDirectory(settingsFolder);
  if(replaceSettings){
    if(typeof fs.readDirectory!=="function")
      fail("Cannot reset old Example workspace settings without directory enumeration");
    for(const [name] of await fs.readDirectory(settingsFolder)){
      if(name==="settings.json")continue;
      if(typeof name!=="string"||!name||name==="."||name===".."||
         name.includes("/")||name.includes("\\"))
        fail("Unsafe Example workspace settings child");
      await fs.delete(vscode.Uri.joinPath(settingsFolder,name),
        {recursive:true,useTrash:false});
    }
  }
  // Replace settings only AFTER every Skill and immutable snapshot exists.
  // Rewriting identical bytes causes a pointless Theia configuration reload
  // during Example reset, which can interrupt its pending navigation.
  const desired=exampleWorkspaceSettingsContent(prepared);
  if(replaceSettings&&await exists(settingsUri)){
    const old=await fs.readFile(settingsUri);
    if(old.length===desired.length&&old.every((value,index)=>value===desired[index]))
      return true;
  }
  await fs.writeFile(settingsUri,desired);
  return true;
}

// Safe one-time migration for a previously opened CURRENT Example after an
// online Studio upgrade. Never replace sources, settings or ordinary projects.
// Stale legacy Example data is intentionally left for explicit Replace Example.
export async function ensureOpenedExampleInterface(vscode,extensionUri,storageUri){
  const root=vscode.Uri.joinPath(storageUri,EXAMPLE_PROJECT_NAME);
  const folders=vscode.workspace.workspaceFolders??[];
  if(vscode.workspace.workspaceFile||folders.length!==1||
     folders[0]?.uri?.toString?.()!==root.toString())
    return {status:"NOT_EXAMPLE"};
  const fs=vscode.workspace.fs;
  const settingsUri=vscode.Uri.joinPath(root,".vscode","settings.json");
  try{await fs.stat(settingsUri);return {status:"PRESERVED"};}
  catch(error){if(error?.code!=="FileNotFound")throw error;}
  const procedure=vscode.Uri.joinPath(root,"skills","establish-pdu-session",
    "assurance","procedure.yaml");
  const contract=vscode.Uri.joinPath(root,"skills","establish-pdu-session",
    "assurance","contract.yaml");
  const [procedureText,contractText]=await Promise.all([procedure,contract].map(async uri=>{
    try{return decoder.decode(await fs.readFile(uri));}
    catch(error){if(error?.code==="FileNotFound")return "";throw error;}
  }));
  if(!/^\s*start\s*:/m.test(procedureText)||
     !/^\s*nodes\s*:/m.test(procedureText)||
     /^\s*apiVersion\s*:/m.test(procedureText)||
     !/^\s*requestSchema\s*:/m.test(contractText))
    return {status:"LEGACY_OR_UNKNOWN"};
  const prepared=await prepareExampleInterfaceDependency(
    await readBundledResource(vscode,vscode.Uri.joinPath(extensionUri,
      "samples","v1alpha5","interface-package",EXAMPLE_INTERFACE_ARCHIVE+".b64"))
  );
  const seeded=await persistExampleInterfaceIfAbsent(vscode,root,prepared);
  return {status:seeded?"SEEDED":"PRESERVED",
    id:prepared.declaration.id,snapshotDigest:prepared.snapshotDigest};
}

export async function seedExampleProject(vscode,extensionUri,storageUri,
  {replaceExisting=false,onProgress=()=>{}}={}){
  let phase="initial";
  const report=event=>{if(typeof onProgress==="function")onProgress(event);};
  try{
    if(!vscode?.workspace?.fs||!vscode.Uri?.file||!vscode.Uri.joinPath)
      fail("Host file system unavailable");
    if(!storageUri)fail("No writable extension storage URI");
    const fs=vscode.workspace.fs;
    const readManifest=async()=>{
      const uri=vscode.Uri.joinPath(extensionUri,"samples","v1alpha5","files.json");
      phase="read-v1alpha5-manifest";
      report({phase:"manifest"});
      let bytes;
      try{bytes=await readBundledResource(vscode,uri);}
      catch(error){fail("Cannot read CA-SL v1alpha5 manifest: "+JSON.stringify(describeError(error)));}
      return validate(JSON.parse(decoder.decode(bytes)),{
        kind:"CA-SL v1alpha5",
        sourceSha:"a1ed951b1e677f824c644541a26f08be4dc4847f",
        sourceStatus:"RELEASED_NOT_QUALIFIED",
        sourceRef:"refs/heads/main",
        languageVersion:"connectionagent.io/v1alpha5",
        projectReadme:"README.md"
      });
    };
    const candidate=await readManifest();
    // Validate the EXACT bundled release ZIP before touching even an existing
    // Example. A missing/corrupt asset must never partially replace user work.
    phase="verify-pinned-example-interface";
    const exampleInterface=await prepareExampleInterfaceDependency(
      await readBundledResource(vscode,vscode.Uri.joinPath(
        extensionUri,"samples","v1alpha5","interface-package",
        EXAMPLE_INTERFACE_ARCHIVE+".b64"
      ))
    );
    const root=vscode.Uri.joinPath(storageUri,EXAMPLE_PROJECT_NAME);
    const skillsRoot=vscode.Uri.joinPath(root,"skills");
    const exists=async uri=>{
      try{await fs.stat(uri);return true;}
      catch(error){if(error?.code==="FileNotFound")return false;throw error;}
    };
    const hadExisting=await exists(root);
    const replacedExisting=Boolean(replaceExisting&&hadExisting);
    if(replacedExisting){
      phase="replace-existing-example";
      // The Example root is also the active workspace folder in Theia OPFS.
      // Keep that directory handle/path stable and remove only its children;
      // deleting the active workspace root itself is not a portable operation
      // across VS Code and Theia filesystem providers.
      await clearDirectoryContents(vscode,fs,root,{preserveVscode:true});
    }else{
      phase="create-project-layout";
      await fs.createDirectory(root);
    }
    phase="create-project-layout";
    await fs.createDirectory(skillsRoot);

    const readmeSource=vscode.Uri.joinPath(extensionUri,"samples","v1alpha5",candidate.projectReadme);
    const readmeDestination=vscode.Uri.joinPath(root,"README.md");
    let readmeUpdated=false;
    // After an explicit replacement, recursive deletion may leave a stale
    // stat result in some hosted filesystem providers. The user has approved
    // replacing this Example, so write the pinned README unconditionally.
    if(replacedExisting||!(await exists(readmeDestination))){
      phase="write-v1alpha5-project-readme";
      const bytes=await readBundledResource(vscode,readmeSource);
      await fs.writeFile(readmeDestination,bytes);
      readmeUpdated=true;
    }

    const total=candidate.files.length;
    let created=0,skipped=0;
    report({phase:"files",completed:0,total});
    for(const file of candidate.files){
      const parts=file.split("/");
      const destination=vscode.Uri.joinPath(skillsRoot,...parts);
      phase="stat-existing:"+file;
      // Do not trust cached stat results after clearing the Example root.
      // Explicit replacement writes every exact bundled file; writeFile is
      // allowed to replace a stale provider entry.
      if(!replacedExisting&&await exists(destination)){
        skipped++;
        report({phase:"files",completed:created+skipped,total});
        continue;
      }
      phase="read-bundled-file:"+file;
      const bytes=await readBundledResource(vscode,
        vscode.Uri.joinPath(extensionUri,"samples","v1alpha5",...parts));
      if(!(bytes instanceof Uint8Array))fail("Unrecognized v1alpha5 sample file");
      if(parts.length>1)
        await fs.createDirectory(vscode.Uri.joinPath(skillsRoot,...parts.slice(0,-1)));
      try{await fs.stat(destination);fail("v1alpha5 sample file changed during import");}
      catch(error){if(error?.code!=="FileNotFound")throw error;}
      phase="write-v1alpha5-file:"+file;
      await fs.writeFile(destination,bytes);
      created++;
      report({phase:"files",completed:created+skipped,total});
    }

    // Only the built-in Example gets this dependency. A fresh or explicitly
    // replaced Example receives a pinned snapshot + .vscode/settings.json.
    // Existing user settings are never rewritten on a non-replacing reopen;
    // this also respects users who intentionally removed ca-client.
    phase="persist-example-interface-lock";
    const exampleDependencySeeded=await persistExampleInterfaceIfAbsent(
      vscode,root,exampleInterface,{replaceSettings:replacedExisting});

    if(replacedExisting){
      phase="verify-replaced-example";
      if(created!==total||skipped!==0||!readmeUpdated)
        fail("Confirmed Example replacement was incomplete: "+
          JSON.stringify({created,skipped,total,readmeUpdated}));
      const rootNames=(await fs.readDirectory(root)).map(([name])=>name).sort();
      if(JSON.stringify(rootNames)!==
         JSON.stringify([".skill-studio",".vscode","README.md","skills"]))
        fail("Retired Example root contents remain after replacement: "+
          rootNames.join(", "));
      const skillNames=(await fs.readDirectory(skillsRoot))
        .map(([name])=>name).sort();
      if(JSON.stringify(skillNames)!==JSON.stringify([...SKILLS].sort()))
        fail("Replacement did not restore exactly the current Skills: "+
          skillNames.join(", "));
    }
    report({phase:"project-ready"});
    const procedures=Object.fromEntries(SKILLS.map(name=>
      [name,vscode.Uri.joinPath(skillsRoot,name,"assurance","procedure.yaml")]));
    return {
      root,skillsRoot,procedure:procedures[SKILLS[0]],procedures,
      skills:[...SKILLS],
      sourceSha:candidate.sourceSha,
      sourceShas:{v1alpha5:candidate.sourceSha},
      candidateFiles:candidate.files.length,
      files:total,created,skipped,replacedExisting,readmeUpdated,
      exampleDependencySeeded,
      exampleDependencyId:exampleInterface.declaration.id,
      exampleDependencySnapshotDigest:exampleInterface.snapshotDigest
    };
  }catch(error){throw Error(phase+": "+String(error?.message??error));}
}
