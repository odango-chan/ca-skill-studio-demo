// Workspace-owned, portable immutable dependency snapshots. No live resolution
// occurs on read, LSP or Build; a missing/tampered lock stays BLOCKED/ERROR.
import {calculateSnapshot,decodeBase64,base64Bytes,verifyLockedFiles,
  validateSnapshotPath,canonicalJson} from "./dependency-snapshot.mjs";
import {readProjectConfiguration,writeDependencySettingsPair} from "./project-configuration.mjs";
const enc=new TextEncoder(),dec=new TextDecoder("utf-8",{fatal:true});
const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
const pathFor=(vscode,root,...pieces)=>vscode.Uri.joinPath(root,...pieces);
const snapshotDirectory=(vscode,root,digest)=>{
  if(!/^sha256:[a-f0-9]{64}$/.test(digest??""))fail("ERROR","Invalid digest");
  return pathFor(vscode,root,".skill-studio","dependencies",digest.slice(7));
};
const missing=error=>error?.code==="FileNotFound";
const metadataMatches=(a,b)=>canonicalJson(a)===canonicalJson(b);

export async function writeImmutableSnapshot(vscode,workspaceRoot,files){
  const fs=vscode.workspace.fs;
  const snapshot=await calculateSnapshot(files);
  const destination=snapshotDirectory(vscode,workspaceRoot,snapshot.snapshotDigest);
  const manifest={version:"skillc.snapshot-store/v0.1",
    snapshotDigest:snapshot.snapshotDigest,files:snapshot.files};
  try{
    await fs.stat(destination);
    await loadVerifiedSnapshot(vscode,workspaceRoot,{
      id:"existing",kind:"tool-catalog",snapshotDigest:snapshot.snapshotDigest,
      files:snapshot.files
    });
    return snapshot;
  }catch(error){if(!missing(error))throw error;}
  if(!globalThis.crypto?.getRandomValues)
    fail("BLOCKED","Secure staging randomness unavailable");
  const suffix=[...crypto.getRandomValues(new Uint8Array(12))]
    .map(n=>n.toString(16).padStart(2,"0")).join("");
  const base=pathFor(vscode,workspaceRoot,".skill-studio");
  const staging=pathFor(vscode,base,"staging",suffix);
  await fs.createDirectory(staging);
  try{
    for(const file of files){
      validateSnapshotPath(file.path);
      const pieces=file.path.split("/");
      if(pieces.length>1)
        await fs.createDirectory(pathFor(vscode,staging,...pieces.slice(0,-1)));
      await fs.writeFile(pathFor(vscode,staging,...pieces),file.bytes);
    }
    await fs.writeFile(pathFor(vscode,staging,"manifest.json"),
      enc.encode(JSON.stringify(manifest)));
    await fs.createDirectory(pathFor(vscode,base,"dependencies"));
    // No overwrite. A host without safe rename must block this operation,
    // rather than publish a half-written locked snapshot.
    if(typeof fs.rename!=="function")
      fail("BLOCKED","Host lacks atomic snapshot directory rename");
    await fs.rename(staging,destination,{overwrite:false});
    await loadVerifiedSnapshot(vscode,workspaceRoot,{
      id:"written",kind:"tool-catalog",snapshotDigest:snapshot.snapshotDigest,
      files:snapshot.files
    });
    return snapshot;
  }catch(error){
    try{await fs.delete(staging,{recursive:true,useTrash:false});}
    catch{/* Recovery leaves a stage only, never a claimed locked snapshot. */}
    throw error;
  }
}
export async function loadVerifiedSnapshot(vscode,workspaceRoot,lockEntry){
  const fs=vscode.workspace.fs;
  const root=snapshotDirectory(vscode,workspaceRoot,lockEntry.snapshotDigest);
  let manifest;
  try{manifest=JSON.parse(dec.decode(await fs.readFile(pathFor(vscode,root,"manifest.json"))));}
  catch(error){
    fail(missing(error)?"BLOCKED":"ERROR","Pinned dependency manifest unreadable: "+
      String(error?.message??error));
  }
  if(manifest.version!=="skillc.snapshot-store/v0.1"||
     manifest.snapshotDigest!==lockEntry.snapshotDigest||
     !metadataMatches(manifest.files,lockEntry.files))
    fail("ERROR","Pinned dependency manifest does not match dependency lock");
  const wireFiles=[];
  try{
    for(const entry of lockEntry.files){
      validateSnapshotPath(entry.path);
      const bytes=await fs.readFile(pathFor(vscode,root,...entry.path.split("/")));
      wireFiles.push({path:entry.path,bytes:base64Bytes(bytes)});
    }
    return await verifyLockedFiles(lockEntry,wireFiles);
  }catch(error){
    fail(missing(error)?"BLOCKED":"ERROR",
      "Locked dependency file unavailable or corrupt: "+String(error?.message??error));
  }
}
export async function resolveLockedDependencies(vscode,selectedRoot){
  let project;
  try{project=readProjectConfiguration(vscode,selectedRoot);}
  catch(error){return {apiVersion:"skillc.resolver/v0.1",status:"ERROR",
    snapshots:[],diagnostics:[{severity:"error",code:"PROJECT_CONFIG_INVALID",
      message:String(error?.message??error)}]};}
  const snapshots=[],diagnostics=[],lock=project.settings.dependencyLock.entries;
  const used=new Set();
  for(const dep of project.settings.dependencies){
    const entry=lock.find(item=>item.id===dep.id);
    if(!entry){
      diagnostics.push({severity:"error",code:"DEPENDENCY_UNLOCKED",
        message:"Dependency has no pinned snapshot",dependencyId:dep.id});
      continue;
    }
    used.add(dep.id);
    if(entry.kind!==dep.kind||!metadataMatches(entry.source,dep.source)){
      diagnostics.push({severity:"error",code:"LOCK_SOURCE_MISMATCH",
        message:"Lock source differs from declaration",dependencyId:dep.id});
      continue;
    }
    if(dep.source.type==="git"&&!/^[a-f0-9]{40}$/.test(entry.resolvedRevision??"")){
      diagnostics.push({severity:"error",code:"GIT_COMMIT_NOT_PINNED",
        message:"Git source lacks immutable full commit SHA",dependencyId:dep.id});
      continue;
    }
    try{snapshots.push(await loadVerifiedSnapshot(vscode,project.workspaceRoot,entry));}
    catch(error){
      diagnostics.push({severity:"error",
        code:error.code==="BLOCKED"?"LOCKED_SNAPSHOT_MISSING":"LOCKED_SNAPSHOT_CORRUPT",
        message:String(error.message),dependencyId:dep.id});
    }
  }
  for(const entry of lock){
    if(!used.has(entry.id))diagnostics.push({severity:"error",code:"ORPHAN_LOCK",
      message:"Lock has no corresponding declaration",dependencyId:entry.id});
  }
  const status=diagnostics.some(item=>
    ["LOCKED_SNAPSHOT_CORRUPT","LOCK_SOURCE_MISMATCH","ORPHAN_LOCK"].includes(item.code))
    ?"ERROR":diagnostics.length?"BLOCKED":"READY";
  return {apiVersion:"skillc.resolver/v0.1",status,snapshots,diagnostics};
}
export async function lockCandidate(vscode,selectedRoot,id,acquired){
  const project=readProjectConfiguration(vscode,selectedRoot);
  if(!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id??"")||id.length>80)
    fail("ERROR","Invalid dependency alias");
  if(acquired.kind!=="tool-catalog"&&acquired.kind!=="schema-bundle")
    fail("ERROR","Invalid Compiler dependency kind");
  const snapshot=await calculateSnapshot(acquired.files);
  const declaration={id,kind:acquired.kind,source:acquired.source};
  const entry={...declaration,snapshotDigest:snapshot.snapshotDigest,files:snapshot.files,
    ...(acquired.resolvedRevision?{resolvedRevision:acquired.resolvedRevision}:{})};
  return {project,declaration,entry,files:acquired.files};
}
export async function refreshDependency(vscode,selectedRoot,id,acquire){
  const project=readProjectConfiguration(vscode,selectedRoot);
  const old=project.settings.dependencies.find(d=>d.id===id);
  if(!old)fail("ERROR","Unknown dependency alias");
  if(typeof acquire!=="function")fail("BLOCKED","Source acquisition adapter unavailable");
  const candidate=await lockCandidate(vscode,selectedRoot,id,await acquire(old.source));
  const sameSource=metadataMatches(candidate.declaration.source,old.source);
  const uploadReimport=old.source.type==="upload"&&
    candidate.declaration.source.type==="upload"&&
    candidate.declaration.source.upload===old.source.upload;
  if(!sameSource&&!uploadReimport)
    fail("ERROR","Refresh must preserve source identity (Upload may change content digest)");
  const locked=project.settings.dependencyLock.entries.find(x=>x.id===id);
  // Observation only. No FS writes and no settings changes.
  return {status:"READY",changed:!locked||
    !metadataMatches(locked.snapshotDigest,candidate.entry.snapshotDigest)||
    !metadataMatches(locked.files,candidate.entry.files),
    candidateLock:candidate.entry};
}
export async function applyDependency(vscode,selectedRoot,id,acquired,{confirm}={}){
  if(typeof confirm!=="function"||await confirm()!==true)
    fail("BLOCKED","Explicit dependency Add / Update Lock confirmation required");
  const candidate=await lockCandidate(vscode,selectedRoot,id,acquired);
  const {project,declaration,entry,files}=candidate;
  // Durable snapshot before any lock reference. There is no User Settings
  // or workspaceState fallback.
  await writeImmutableSnapshot(vscode,project.workspaceRoot,files);
  const deps=project.settings.dependencies.filter(d=>d.id!==id).concat(declaration);
  const locks=project.settings.dependencyLock.entries.filter(e=>e.id!==id).concat(entry);
  try{
    await writeDependencySettingsPair(vscode,project.workspaceRoot,deps,{
      version:"skillc.lock/v0.1",entries:locks});
  }catch(error){
    // Two host Settings writes cannot be assumed atomic; do not claim READY.
    fail("UNCERTAIN","Workspace configuration write partly failed; inspect dependency and lock: "+
      String(error?.message??error));
  }
  return resolveLockedDependencies(vscode,project.workspaceRoot);
}
export async function removeDependency(vscode,selectedRoot,id,{confirm}={}){
  if(typeof confirm!=="function"||await confirm()!==true)
    fail("BLOCKED","Explicit dependency removal confirmation required");
  const project=readProjectConfiguration(vscode,selectedRoot);
  const dependencies=project.settings.dependencies.filter(dep=>dep.id!==id);
  if(dependencies.length===project.settings.dependencies.length)
    fail("ERROR","Unknown dependency alias");
  const dependencyLock={version:"skillc.lock/v0.1",
    entries:project.settings.dependencyLock.entries.filter(item=>item.id!==id)};
  try{
    await writeDependencySettingsPair(vscode,project.workspaceRoot,dependencies,dependencyLock);
  }catch(error){fail("UNCERTAIN","Dependency removal partly failed: "+String(error?.message??error));}
  // Immutable unreferenced bytes are kept until separate explicit GC. Never
  // delete a snapshot shared by another locked dependency.
  return resolveLockedDependencies(vscode,project.workspaceRoot);
}
