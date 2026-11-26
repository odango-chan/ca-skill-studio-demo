// Explicit Example project import for VS Code desktop/web or Theia browser-only OPFS.
// Replacing an existing Example is a deliberate, user-confirmed operation that
// refreshes authored files in the Example root from the single pinned v1alpha5 source.
// Ordinary projects are never passed to this importer. It never creates lib/ or output/.
import {writeImmutableSnapshot,loadVerifiedSnapshot} from "./dependency-service.mjs";
import {EXAMPLE_INTERFACE_ARCHIVE,prepareExampleInterfaceDependency,
  exampleWorkspaceSettingsContent} from "./example-interface-dependency.mjs";
import {prepareExampleOwnerDependency} from "./example-owner-dependency.mjs";
import {prepareExampleHostContextDependency} from "./example-host-context-dependency.mjs";
import {gitBlobSha1,canonicalJson} from "./dependency-snapshot.mjs";

export const EXAMPLE_PROJECT_NAME="skill-studio-demo";
const SKILLS=Object.freeze(["establish-pdu-session-mas","modify-pdu-session-mas","release-pdu-session-mas"]);
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
async function pruneExampleDirectory(vscode,fs,root,allowedPaths){
  for(const [name,type] of await fs.readDirectory(root)){
    if(typeof name!=="string"||!name||name==="."||name===".."||
       name.includes("/")||name.includes("\\"))
      fail("Host file system returned an unsafe Example child name");
    if(allowedPaths.includes(name))continue;
    const child=vscode.Uri.joinPath(root,name);
    const prefix=name+"/";
    const descendants=allowedPaths.filter(file=>file.startsWith(prefix))
      .map(file=>file.slice(prefix.length));
    if(descendants.length&&type===2)await pruneExampleDirectory(vscode,fs,child,descendants);
    else if(!descendants.length)await fs.delete(child,{recursive:true,useTrash:false});
    else fail("Confirmed Example directory is unavailable: "+name);
  }
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
async function prepareExampleDependencies(vscode,extensionUri,candidate){
  const sampleRoot=vscode.Uri.joinPath(extensionUri,"samples","v1alpha5");
  const read=relative=>readBundledResource(vscode,
    vscode.Uri.joinPath(sampleRoot,...relative.split("/")));
  const client=await prepareExampleInterfaceDependency(
    await read("interface-package/"+EXAMPLE_INTERFACE_ARCHIVE+".b64"));
  const ownerEntry=candidate.dependencies.find(item=>item.id==="mas");
  const contextEntry=candidate.dependencies.find(item=>item.id==="ca-context");
  const owner=await prepareExampleOwnerDependency(read,ownerEntry);
  const context=await prepareExampleHostContextDependency(read,contextEntry);
  return [client,context,owner];
}
function validate(manifest,{sourceSha,sourceStatus,sourceRef,languageVersion,projectReadme}={}){
  if(manifest?.schemaVersion!==1||manifest?.sourceRepo!=="odango-chan/ca-skills"||
     manifest?.sourceSha!==sourceSha||manifest?.sourceStatus!==sourceStatus||
     manifest?.sourceRef!==sourceRef||
     (languageVersion&&manifest?.languageVersion!==languageVersion)||
     (projectReadme&&manifest?.projectReadme!==projectReadme)||
     !Array.isArray(manifest.skills)||
     JSON.stringify(manifest.skills)!==JSON.stringify(SKILLS)||
     !Array.isArray(manifest.files)||manifest.files.length!==18||
     !manifest.blobs||typeof manifest.blobs!=="object"||
     Object.keys(manifest.blobs).length!==manifest.files.length||
     !Array.isArray(manifest.dependencies)||manifest.dependencies.length!==2)
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
  const owner=manifest.dependencies.find(item=>item?.id==="mas");
  const hostContext=manifest.dependencies.find(item=>item?.id==="ca-context");
  if(owner?.kind!=="tool-catalog"||
     owner.source?.repository!=="odango-chan/ca-client-tools"||
     owner.source?.ref!=="refs/tags/v1.2.0"||
     owner.source?.path!=="contracts/owner/openamsm-mas/v1alpha4"||
     owner.source?.packageId!=="urn:openamsm:mas:tool-contracts"||
     owner.source?.owner!=="openamsm.smf.mas"||
     owner.resolvedRevision!=="fc44c3a745c68443fcfb12054c7eadf0ed7cc3f7"||
     !Array.isArray(owner.files)||owner.files.length!==59||
     !owner.blobs||Object.keys(owner.blobs).length!==owner.files.length)
    fail("Unrecognized pinned OpenAMSM Owner ToolCatalog dependency");
  if(hostContext?.kind!=="schema-bundle"||
     hostContext.source?.repository!=="odango-chan/ca-agent-demo"||
     hostContext.source?.path!=="tests/fixtures/compiler/mas-v1alpha5-scheme-c/trusted/snapshots/ca-context"||
     hostContext.source?.packageId!=="urn:connectionagent:ca:host-context"||
     hostContext.source?.owner!=="urn:connectionagent:owner:ca-context"||
     hostContext.source?.sourceStatus!=="DEVELOPMENT_FIXTURE"||
     hostContext.resolvedRevision!=="57e277ff9094dad93543df46910a12a1dbbaf560"||
     JSON.stringify(hostContext.files)!==JSON.stringify(["subject.schema.json"])||
     !hostContext.blobs||Object.keys(hostContext.blobs).length!==1)
    fail("Unrecognized pinned Host context Schema dependency");
  for(const dependency of manifest.dependencies){
    for(const path of dependency.files){
      if(typeof path!=="string"||path.length>240||path.startsWith("/")||
         path.includes("\\")||path.split("/").some(part=>!part||part==="."||part==="..")||
         !/^[a-f0-9]{40}$/.test(dependency.blobs[path]??""))
        fail("Unsafe or unpinned dependency snapshot path");
    }
  }
  return manifest;
}
// Seed only a missing default lock. An existing settings.json is the user's
// explicit configuration and is NEVER rewritten, even if ca-client is absent.
async function persistExampleDependenciesIfAbsent(vscode,root,prepared,
  {replaceSettings=false}={}){
  const fs=vscode.workspace.fs;
  const settingsUri=vscode.Uri.joinPath(root,".vscode","settings.json");
  const exists=async uri=>{
    try{await fs.stat(uri);return true;}
    catch(error){if(error?.code==="FileNotFound")return false;throw error;}
  };
  if(!replaceSettings&&await exists(settingsUri))return false;
  for(const dependency of prepared){
    const persisted=await writeImmutableSnapshot(vscode,root,dependency.files);
    if(persisted.snapshotDigest!==dependency.snapshotDigest)
      fail("Example "+dependency.declaration.id+" dependency snapshot digest mismatch");
  }
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
  const desired=exampleWorkspaceSettingsContent(prepared);
  if(replaceSettings&&await exists(settingsUri)){
    const old=await fs.readFile(settingsUri);
    if(old.length===desired.length&&old.every((value,index)=>value===desired[index]))
      return true;
  }
  await fs.writeFile(settingsUri,desired);
  return true;
}


const REPLACEMENT_TRANSACTION_DIRECTORY=".skill-studio-example-replacement";
const replacementEncoder=new TextEncoder();
const replacementMarkerNames=[
  "PREPARING","PREPARED","COMMITTING","RECOVERY_REQUIRED",
  "COMMITTED","ROLLED_BACK","ABORTED"
];
let replacementBusy=false;
let replacementStatus={state:"READY",message:null,phase:null};

export function getExampleReplacementStatus(){
  return {...replacementStatus};
}
function dirtyExampleDocuments(vscode,root){
  const rootPath=root.toString().replace(/\/+$/,"");
  return (vscode.workspace.textDocuments??[]).filter(document=>{
    const uri=document?.uri?.toString?.();
    return document?.isDirty&&uri&&(uri===rootPath||uri.startsWith(rootPath+"/"));
  });
}
async function saveDirtyExampleDocuments(vscode,root){
  const documents=dirtyExampleDocuments(vscode,root);
  for(const document of documents){
    const uri=document.uri.toString();
    if(typeof document.save!=="function")
      fail("Cannot replace Example while a dirty editor cannot be saved: "+uri);
    const saved=await document.save();
    if(saved!==true||document.isDirty)
      fail("Cannot replace Example because a dirty editor did not save successfully: "+uri);
  }
  assertNoDirtyExampleDocuments(vscode,root);
}
function assertNoDirtyExampleDocuments(vscode,root){
  const dirty=dirtyExampleDocuments(vscode,root);
  if(dirty.length)
    fail("Example editor became dirty during replacement staging; save or close it and retry: "+
      dirty.map(document=>document.uri.toString()).join(", "));
}
function setExampleReplacementStatus(state,message=null,phase=null){
  replacementStatus={state,message,phase};
}
function relativeUri(vscode,root,relative){
  return vscode.Uri.joinPath(root,...relative.split("/"));
}
function safeDirectoryEntry(name){
  return typeof name==="string"&&name.length>0&&name!=="."&&name!==".."&&
    !name.includes("/")&&!name.includes("\\")&&!name.includes("\u0000");
}
async function collectTreeManifest(fs,vscode,root){
  const entries=[];
  async function visit(directory,prefix){
    for(const [name,type] of await fs.readDirectory(directory)){
      if(!safeDirectoryEntry(name))
        fail("Host file system returned an unsafe transaction path");
      const relative=prefix?prefix+"/"+name:name;
      if((type&64)===64)
        fail("Symbolic links are not supported in an Example replacement transaction: "+relative);
      const child=vscode.Uri.joinPath(directory,name);
      if((type&2)===2){
        entries.push({path:relative,kind:"directory"});
        await visit(child,relative);
      }else if((type&1)===1){
        const bytes=await fs.readFile(child);
        entries.push({path:relative,kind:"file",size:bytes.length,
          digest:await gitBlobSha1(bytes)});
      }else{
        fail("Unsupported file type in Example transaction: "+relative);
      }
    }
  }
  await visit(root,"");
  return entries.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
}
function sameManifest(left,right){
  return JSON.stringify(left)===JSON.stringify(right);
}
async function verifyTreeManifest(fs,vscode,root,expected,label){
  const actual=await collectTreeManifest(fs,vscode,root);
  if(!sameManifest(actual,expected))
    fail(label+" inventory does not match the verified transaction manifest");
  return actual;
}
async function pruneToManifest(vscode,fs,root,manifest){
  const expected=new Map(manifest.map(entry=>[entry.path,entry.kind]));
  if(typeof fs.stat==="function"){
    try{
      const rootStat=await fs.stat(root);
      if((rootStat.type&64)===64)
        fail("Active Example root became a symbolic link during transaction recovery");
      if((rootStat.type&2)!==2)
        fail("Active Example root is not a directory during transaction recovery");
    }catch(error){if(error?.code!=="FileNotFound")throw error;}
  }
  await fs.createDirectory(root);
  async function visit(directory,prefix){
    for(const [name,type] of await fs.readDirectory(directory)){
      if(!safeDirectoryEntry(name))
        fail("Host file system returned an unsafe transaction path");
      const relative=prefix?prefix+"/"+name:name;
      if((type&64)===64)
        fail("Symbolic links are not supported while reconciling an Example transaction: "+relative);
      const actualKind=(type&2)===2?"directory":(type&1)===1?"file":"unknown";
      if(actualKind==="unknown")
        fail("Unsupported file type while reconciling Example transaction: "+relative);
      const expectedKind=expected.get(relative);
      const child=vscode.Uri.joinPath(directory,name);
      if(!expectedKind||expectedKind!==actualKind){
        await fs.delete(child,{recursive:true,useTrash:false});
        continue;
      }
      if(actualKind==="directory")await visit(child,relative);
    }
  }
  await visit(root,"");
}
async function copyTreeFromSource(fs,vscode,sourceRoot,destinationRoot,entries,
  {skip=()=>false}={}){
  await fs.createDirectory(destinationRoot);
  const selected=entries.filter(entry=>!skip(entry));
  const directories=selected.filter(entry=>entry.kind==="directory")
    .sort((a,b)=>a.path.split("/").length-b.path.split("/").length||
      (a.path<b.path?-1:a.path>b.path?1:0));
  for(const entry of directories)
    await fs.createDirectory(relativeUri(vscode,destinationRoot,entry.path));
  for(const entry of selected.filter(item=>item.kind==="file")){
    const source=relativeUri(vscode,sourceRoot,entry.path);
    const destination=relativeUri(vscode,destinationRoot,entry.path);
    const bytes=await fs.readFile(source);
    if(bytes.length!==entry.size||await gitBlobSha1(bytes)!==entry.digest)
      fail("Transaction source changed while copying: "+entry.path);
    const parts=entry.path.split("/");
    if(parts.length>1)
      await fs.createDirectory(vscode.Uri.joinPath(destinationRoot,...parts.slice(0,-1)));
    await fs.writeFile(destination,bytes);
    const written=await fs.readFile(destination);
    if(written.length!==entry.size||await gitBlobSha1(written)!==entry.digest)
      fail("Transaction copy verification failed: "+entry.path);
  }
}
async function deleteIfPresent(fs,uri){
  try{await fs.delete(uri,{recursive:true,useTrash:false});}
  catch(error){if(error?.code!=="FileNotFound")throw error;}
}
function replacementPaths(vscode,storageUri){
  const transactionRoot=vscode.Uri.joinPath(storageUri,REPLACEMENT_TRANSACTION_DIRECTORY);
  return {
    transactionRoot,
    candidateStorage:vscode.Uri.joinPath(transactionRoot,"candidate-storage"),
    candidateRoot:vscode.Uri.joinPath(transactionRoot,"candidate-storage",EXAMPLE_PROJECT_NAME),
    backupRoot:vscode.Uri.joinPath(transactionRoot,"backup"),
    marker:name=>vscode.Uri.joinPath(transactionRoot,name+".json"),
    activeRoot:vscode.Uri.joinPath(storageUri,EXAMPLE_PROJECT_NAME)
  };
}
async function writeReplacementMarker(fs,vscode,paths,state,details){
  const payload={...(details??{})};
  delete payload.schemaVersion;
  delete payload.state;
  const value={...payload,schemaVersion:1,state};
  const encoded=JSON.stringify(value);
  const uri=paths.marker(state);
  try{
    await fs.writeFile(uri,replacementEncoder.encode(encoded));
    const actual=decoder.decode(await fs.readFile(uri));
    if(actual!==encoded)
      fail("Could not durably verify "+state+" Example replacement marker");
    return value;
  }catch(error){
    // A marker is authoritative only after exact read-back. Remove an
    // unverified partial marker so the previous verified state remains usable.
    try{await fs.delete(uri,{recursive:false,useTrash:false});}
    catch{/* A retained COMMITTING marker still directs recovery fail-closed. */}
    throw error;
  }
}
async function readReplacementMarker(fs,paths,state){
  try{
    const value=JSON.parse(decoder.decode(await fs.readFile(paths.marker(state))));
    if(value?.schemaVersion!==1||value.state!==state)
      fail("Invalid "+state+" Example replacement marker");
    return value;
  }catch(error){
    if(error?.code==="FileNotFound")return null;
    throw error;
  }
}
function validateReplacementMarker(marker,paths){
  if(marker?.schemaVersion!==1||
     marker.rootUri!==paths.activeRoot.toString()||
     !Array.isArray(marker.backupInventory)||
     !Array.isArray(marker.candidateInventory))
    fail("Example replacement marker is incomplete or targets another workspace");
  const validateInventory=(entries,label)=>{
    const byPath=new Map();
    for(const entry of entries){
      if(!entry||typeof entry.path!=="string"||
         entry.path.startsWith("/")||entry.path.includes("\\")||
         entry.path.includes("\u0000")||
         entry.path.split("/").some(part=>!part||part==="."||part==="..")||
         !["file","directory"].includes(entry.kind))
        fail("Invalid "+label+" path in Example replacement marker");
      if(byPath.has(entry.path))
        fail("Duplicate "+label+" path in Example replacement marker");
      if(entry.kind==="file"&&(!Number.isInteger(entry.size)||entry.size<0||
         !/^[a-f0-9]{40}$/.test(entry.digest??"")))
        fail("Invalid "+label+" file metadata in Example replacement marker");
      byPath.set(entry.path,entry.kind);
    }
    for(const [path,kind] of byPath){
      const parts=path.split("/");
      for(let i=1;i<parts.length;i++){
        const parent=parts.slice(0,i).join("/");
        if(byPath.get(parent)!=="directory")
          fail("Missing "+label+" parent directory in Example replacement marker: "+parent);
      }
      if(kind==="file"&&[...byPath.keys()].some(other=>other.startsWith(path+"/")))
        fail("File path shadows a "+label+" directory in Example replacement marker");
    }
  };
  validateInventory(marker.backupInventory,"backup");
  validateInventory(marker.candidateInventory,"candidate");
}
async function cleanupReplacementTransaction(fs,vscode,paths,terminalState){
  // Keep the terminal marker until both recovery trees have been removed.
  await deleteIfPresent(fs,paths.candidateStorage);
  await deleteIfPresent(fs,paths.backupRoot);
  for(const name of replacementMarkerNames){
    if(name===terminalState)continue;
    await deleteIfPresent(fs,paths.marker(name));
  }
  await deleteIfPresent(fs,paths.marker(terminalState));
  await deleteIfPresent(fs,paths.transactionRoot);
}
async function verifyDependencySnapshots(vscode,root){
  const fs=vscode.workspace.fs;
  const settingsUri=vscode.Uri.joinPath(root,".vscode","settings.json");
  const settings=JSON.parse(decoder.decode(await fs.readFile(settingsUri)));
  const dependencies=settings["connectionAgent.skillStudio.dependencies"];
  const lock=settings["connectionAgent.skillStudio.dependencyLock"];
  if(!Array.isArray(dependencies)||!lock||lock.version!=="skillc.lock/v0.1"||
     !Array.isArray(lock.entries))
    fail("Example dependency declarations or lock are missing");
  const expected=["ca-client","ca-context","mas"];
  const ids=dependencies.map(item=>item?.id).sort();
  const lockIds=lock.entries.map(item=>item?.id).sort();
  if(!sameManifest(ids,expected)||!sameManifest(lockIds,expected))
    fail("Example dependency declarations and lock do not contain the exact pinned set");
  for(const entry of lock.entries){
    const declaration=dependencies.find(item=>item.id===entry.id);
    if(!declaration||declaration.kind!==entry.kind||
       canonicalJson(declaration.source)!==canonicalJson(entry.source))
      fail("Example dependency declaration and lock source differ: "+entry.id);
  }
  const snapshots=[];
  for(const entry of lock.entries)
    snapshots.push(await loadVerifiedSnapshot(vscode,root,entry));
  return {settings,lockEntries:lock.entries,snapshots};
}
async function restoreExampleBackup(vscode,paths,marker){
  const fs=vscode.workspace.fs;
  validateReplacementMarker(marker,paths);
  await verifyTreeManifest(fs,vscode,paths.backupRoot,
    marker.backupInventory,"Example backup");
  await pruneToManifest(vscode,fs,paths.activeRoot,marker.backupInventory);
  await copyTreeFromSource(fs,vscode,paths.backupRoot,paths.activeRoot,
    marker.backupInventory);
  await verifyTreeManifest(fs,vscode,paths.activeRoot,
    marker.backupInventory,"Restored Example");
}
async function recoverExampleReplacementInternal(vscode,storageUri){
  if(!vscode?.workspace?.fs||!storageUri||!vscode.Uri?.joinPath)
    fail("Host file system unavailable for Example replacement recovery");
  const fs=vscode.workspace.fs;
  const paths=replacementPaths(vscode,storageUri);
  const required=["readFile","readDirectory","writeFile","createDirectory","delete"];
  const missing=required.filter(name=>typeof fs[name]!=="function");
  if(missing.length)
    return {status:"UNSUPPORTED_HOST",
      message:"Host file system cannot inspect or recover Example transactions; missing: "+missing.join(", ")};
  // Do not require stat() just to establish an empty transaction directory:
  // some Theia host adapters expose readFile/readDirectory before stat.
  const markers={},markerErrors={};
  for(const name of replacementMarkerNames){
    try{markers[name]=await readReplacementMarker(fs,paths,name);}
    catch(error){
      markerErrors[name]=error;
      // COMMITTING is the only authority that permits active-root mutation.
      // If it is unreadable, do not guess whether a commit had started.
      if(name==="COMMITTING")throw error;
    }
  }
  const finishRollback=async marker=>{
    validateReplacementMarker(marker,paths);
    try{
      await verifyTreeManifest(fs,vscode,paths.activeRoot,
        marker.backupInventory,"Rolled-back Example");
    }catch{
      // ROLLED_BACK is written only after a verified restore. If the marker
      // survived but the active tree was later interrupted, retry from backup.
      await restoreExampleBackup(vscode,paths,marker);
    }
    await writeReplacementMarker(fs,vscode,paths,"ROLLED_BACK",marker);
    await cleanupReplacementTransaction(fs,vscode,paths,"ROLLED_BACK");
    return {status:"ROLLED_BACK"};
  };
  if(markers.COMMITTED){
    validateReplacementMarker(markers.COMMITTED,paths);
    try{
      await verifyTreeManifest(fs,vscode,paths.activeRoot,
        markers.COMMITTED.candidateInventory,"Committed Example");
      await verifyDependencySnapshots(vscode,paths.activeRoot);
    }catch(error){
      if(markers.ROLLED_BACK)
        return await finishRollback(markers.ROLLED_BACK);
      if(markers.COMMITTING||markers.RECOVERY_REQUIRED)
        return await finishRollback(markers.COMMITTING??markers.RECOVERY_REQUIRED);
      throw error;
    }
    await cleanupReplacementTransaction(fs,vscode,paths,"COMMITTED");
    return {status:"COMMITTED_RECOVERED"};
  }
  if(markers.ROLLED_BACK)
    return await finishRollback(markers.ROLLED_BACK);
  if(markers.COMMITTING||markers.RECOVERY_REQUIRED)
    return await finishRollback(markers.COMMITTING??markers.RECOVERY_REQUIRED);

  if(markerErrors.COMMITTED||markerErrors.ROLLED_BACK||markerErrors.RECOVERY_REQUIRED)
    fail("Example replacement terminal marker is unreadable and no verified recovery marker remains");
  if(markerErrors.PREPARED)
    fail("Prepared Example transaction marker is unreadable; keep the backup and transaction data intact");
  if(markers.PREPARED){
    validateReplacementMarker(markers.PREPARED,paths);
    // PREPARED is written only after the backup and candidate are verified.
    // Without a verified COMMITTING marker, the active tree must still equal
    // that backup; if it does, discard staging. If it does not, fail closed.
    await verifyTreeManifest(fs,vscode,paths.activeRoot,
      markers.PREPARED.backupInventory,"Active Example before commit");
    await writeReplacementMarker(fs,vscode,paths,"ABORTED",markers.PREPARED);
    await cleanupReplacementTransaction(fs,vscode,paths,"ABORTED");
    return {status:"ABORTED_BEFORE_COMMIT"};
  }
  if(!Object.values(markers).some(Boolean)){
    try{await fs.readDirectory(paths.transactionRoot);}
    catch(error){
      if(error?.code==="FileNotFound")return {status:"CLEAN"};
      throw error;
    }
    await deleteIfPresent(fs,paths.transactionRoot);
    return {status:"ORPHAN_CLEANED"};
  }

  // PREPARING (or an empty transaction directory) means the verified
  // commit-intent marker was never published, so the active Example is intact.
  await writeReplacementMarker(fs,vscode,paths,"ABORTED",{
    rootUri:paths.activeRoot.toString(),
    backupInventory:[],candidateInventory:[],sourceSha:null
  });
  await cleanupReplacementTransaction(fs,vscode,paths,"ABORTED");
  return {status:"ABORTED_BEFORE_COMMIT"};
}
export async function recoverExampleReplacement(vscode,storageUri){
  if(replacementBusy)
    fail("Example replacement is already in progress; wait for it to finish");
  replacementBusy=true;
  setExampleReplacementStatus("IN_PROGRESS","Recovering the built-in Example transaction","startup-recovery");
  try{
    const result=await recoverExampleReplacementInternal(vscode,storageUri);
    if(result.status==="UNSUPPORTED_HOST")
      setExampleReplacementStatus("UNAVAILABLE",result.message,"startup-recovery");
    else
      setExampleReplacementStatus("READY",null,null);
    return result;
  }catch(error){
    const message=String(error?.message??error);
    let recoveryLocation="";
    try{
      const paths=replacementPaths(vscode,storageUri);
      recoveryLocation=" Recovery transaction: "+paths.transactionRoot.toString()+
        "; verified backup: "+paths.backupRoot.toString()+
        ". Keep both intact; do not delete or edit the transaction data.";
    }catch{}
    setExampleReplacementStatus("RECOVERY_REQUIRED",message+recoveryLocation,"startup-recovery");
    throw Error("Example replacement recovery required: "+message+recoveryLocation+
      " Reopen SKILL Studio to retry recovery. The active workspace is blocked from READY.");
  }finally{
    replacementBusy=false;
  }
}
async function seedExampleProjectTransaction(vscode,extensionUri,storageUri,
  {onProgress=()=>{}}={}){
  const fs=vscode.workspace.fs;
  const paths=replacementPaths(vscode,storageUri);
  let phase="create-transaction";
  let transactionCreated=false;
  let commitStarted=false;
  let committed=false;
  let markerDetails=null;
  const report=event=>{try{onProgress?.(event);}catch{}};
  try{
    report({phase:"replacement-started"});
    await fs.createDirectory(paths.transactionRoot);
    transactionCreated=true;
    await writeReplacementMarker(fs,vscode,paths,"PREPARING",{
      rootUri:paths.activeRoot.toString(),
      backupInventory:[],candidateInventory:[],sourceSha:null
    });
    phase="backup-existing-example";
    const backupInventory=await collectTreeManifest(fs,vscode,paths.activeRoot);
    await copyTreeFromSource(fs,vscode,paths.activeRoot,paths.backupRoot,backupInventory);
    await verifyTreeManifest(fs,vscode,paths.backupRoot,backupInventory,"Example backup");

    phase="stage-current-example";
    await fs.createDirectory(paths.candidateStorage);
    const metadataEntries=backupInventory.filter(entry=>
      entry.path===".skill-studio"||entry.path.startsWith(".skill-studio/"));
    if(metadataEntries.length)
      await copyTreeFromSource(fs,vscode,paths.backupRoot,
        paths.candidateRoot,metadataEntries);
    const staged=await seedExampleProjectInPlace(vscode,extensionUri,
      paths.candidateStorage,{
        replaceExisting:false,
        onProgress:event=>{
          if(event?.phase!=="project-ready")report(event);
        }
      });
    phase="verify-staged-example";
    const candidateInventory=await collectTreeManifest(fs,vscode,paths.candidateRoot);
    await verifyTreeManifest(fs,vscode,paths.candidateRoot,
      candidateInventory,"Staged Example");
    await verifyDependencySnapshots(vscode,paths.candidateRoot);
    const expectedRootNames=[".skill-studio",".vscode","README.md","skills"];
    const rootNames=candidateInventory.filter(entry=>!entry.path.includes("/"))
      .map(entry=>entry.path).sort();
    if(!sameManifest(rootNames,expectedRootNames))
      fail("Staged Example root inventory is incomplete: "+rootNames.join(", "));
    const skillNames=candidateInventory.filter(entry=>
      entry.kind==="directory"&&entry.path.startsWith("skills/")&&
      !entry.path.slice("skills/".length).includes("/"))
      .map(entry=>entry.path.slice("skills/".length)).sort();
    if(!sameManifest(skillNames,[...SKILLS].sort()))
      fail("Staged Example does not contain exactly the three current Skills");

    markerDetails={
      schemaVersion:1,
      rootUri:paths.activeRoot.toString(),
      backupInventory,candidateInventory,
      sourceSha:staged.sourceSha,
      dependencySnapshotDigests:staged.exampleDependencySnapshotDigests
    };
    phase="verify-active-example-before-commit";
    await verifyTreeManifest(fs,vscode,paths.activeRoot,
      backupInventory,"Active Example changed while replacement was staged");
    assertNoDirtyExampleDocuments(vscode,paths.activeRoot);
    phase="write-prepared-marker";
    await writeReplacementMarker(fs,vscode,paths,"PREPARED",markerDetails);
    phase="verify-active-before-commit-intent";
    await verifyTreeManifest(fs,vscode,paths.activeRoot,
      backupInventory,"Active Example changed before commit intent");
    assertNoDirtyExampleDocuments(vscode,paths.activeRoot);
    phase="write-commit-intent";
    await writeReplacementMarker(fs,vscode,paths,"COMMITTING",markerDetails);
    commitStarted=true;

    phase="prune-active-example";
    // The active workspace root and its .skill-studio metadata directory stay
    // at the same URI. No whole-root rename is assumed on any provider.
    await pruneToManifest(vscode,fs,paths.activeRoot,candidateInventory);
    phase="copy-staged-example";
    await copyTreeFromSource(fs,vscode,paths.candidateRoot,paths.activeRoot,
      candidateInventory,{skip:entry=>entry.path===".vscode/settings.json"});
    phase="publish-dependency-lock";
    const settingsEntry=candidateInventory.find(entry=>
      entry.path===".vscode/settings.json"&&entry.kind==="file");
    if(!settingsEntry)fail("Staged Example dependency settings are missing");
    const settingsBytes=await fs.readFile(
      relativeUri(vscode,paths.candidateRoot,settingsEntry.path));
    if(await gitBlobSha1(settingsBytes)!==settingsEntry.digest)
      fail("Staged Example dependency settings changed before publication");
    await fs.writeFile(relativeUri(vscode,paths.activeRoot,settingsEntry.path),settingsBytes);
    const writtenSettings=await fs.readFile(
      relativeUri(vscode,paths.activeRoot,settingsEntry.path));
    if(await gitBlobSha1(writtenSettings)!==settingsEntry.digest)
      fail("Published Example dependency settings failed byte verification");

    phase="verify-active-example";
    await verifyTreeManifest(fs,vscode,paths.activeRoot,
      candidateInventory,"Active Example");
    await verifyDependencySnapshots(vscode,paths.activeRoot);
    assertNoDirtyExampleDocuments(vscode,paths.activeRoot);
    phase="write-committed-marker";
    await writeReplacementMarker(fs,vscode,paths,"COMMITTED",markerDetails);
    committed=true;
    phase="cleanup-committed-transaction";
    await cleanupReplacementTransaction(fs,vscode,paths,"COMMITTED");
    setExampleReplacementStatus("READY",null,null);
    report({phase:"project-ready"});
    const procedures=Object.fromEntries(SKILLS.map(name=>
      [name,vscode.Uri.joinPath(paths.activeRoot,"skills",name,"assurance","procedure.yaml")]));
    return {
      ...staged,
      root:paths.activeRoot,
      skillsRoot:vscode.Uri.joinPath(paths.activeRoot,"skills"),
      procedure:procedures[SKILLS[0]],procedures,
      created:staged.files,skipped:0,replacedExisting:true,readmeUpdated:true,
      exampleDependencySeeded:true,
      transactionCleanupPending:false
    };
  }catch(error){
    const message=String(error?.message??error);
    const failedPhase=phase;
    if(!transactionCreated){
      setExampleReplacementStatus("READY",message,phase);
      report({phase:"replacement-aborted"});
      throw Error("Example replacement could not create its transaction workspace: "+message);
    }
    if(committed){
      const recoveryMessage="The replacement is committed and verified, but transaction cleanup failed: "+
        message+"; recovery transaction: "+paths.transactionRoot.toString()+
        "; retained backup: "+paths.backupRoot.toString()+
        ". Keep both intact and reopen SKILL Studio to finish cleanup.";
      setExampleReplacementStatus("RECOVERY_REQUIRED",recoveryMessage,phase);
      report({phase:"replacement-recovery-required"});
      throw Error("Example replacement committed but cleanup is pending at "+
        paths.transactionRoot.toString()+"; retained backup: "+paths.backupRoot.toString()+
        ": "+message+"; keep the transaction data intact and reopen SKILL Studio to finish cleanup before Package Inventory becomes READY");
    }
    if(commitStarted&&markerDetails){
      try{
        phase="rollback-active-example";
        await restoreExampleBackup(vscode,paths,markerDetails);
        await writeReplacementMarker(fs,vscode,paths,"ROLLED_BACK",markerDetails);
        await cleanupReplacementTransaction(fs,vscode,paths,"ROLLED_BACK");
        setExampleReplacementStatus("READY",null,null);
        report({phase:"replacement-rolled-back"});
      }catch(rollbackError){
        const rollbackMessage=String(rollbackError?.message??rollbackError);
        try{
          await writeReplacementMarker(fs,vscode,paths,"RECOVERY_REQUIRED",{
            ...markerDetails,failedPhase,commitError:message,
            rollbackError:rollbackMessage
          });
        }catch{/* COMMITTING remains the durable recovery instruction. */}
        setExampleReplacementStatus("RECOVERY_REQUIRED",
          "Replacement failed at "+failedPhase+"; rollback is incomplete: "+rollbackMessage+
          "; recovery transaction: "+paths.transactionRoot.toString()+
          "; verified backup: "+paths.backupRoot.toString()+
          ". Keep both intact and reopen SKILL Studio to retry recovery.",
          failedPhase);
        report({phase:"replacement-recovery-required"});
        throw Error("Example replacement failed at "+failedPhase+
          "; rollback is incomplete. Recovery transaction: "+paths.transactionRoot.toString()+
          "; verified backup: "+paths.backupRoot.toString()+
          ". Keep both intact and reopen SKILL Studio to retry recovery. Do not use this Example until recovery succeeds. "+
          rollbackMessage);
      }
    }else{
      try{
        await writeReplacementMarker(fs,vscode,paths,"ABORTED",{
          rootUri:paths.activeRoot.toString(),
          backupInventory:markerDetails?.backupInventory??[],
          candidateInventory:markerDetails?.candidateInventory??[],
          sourceSha:markerDetails?.sourceSha??null
        });
        await cleanupReplacementTransaction(fs,vscode,paths,"ABORTED");
        setExampleReplacementStatus("READY",null,null);
        report({phase:"replacement-aborted"});
      }catch(cleanupError){
        const cleanupMessage=String(cleanupError?.message??cleanupError);
        setExampleReplacementStatus("RECOVERY_REQUIRED",
          "Preparation did not mutate the active Example, but staging cleanup failed: "+cleanupMessage+
          "; recovery transaction: "+paths.transactionRoot.toString()+
          ". Keep it intact and reopen SKILL Studio to finish cleanup.",
          phase);
        report({phase:"replacement-recovery-required"});
        throw Error("Example replacement preparation failed at "+phase+
          "; staging cleanup is pending at "+paths.transactionRoot.toString()+
          ": "+cleanupMessage);
      }
    }
    throw Error("Example replacement failed at "+failedPhase+
      (commitStarted?" and the previous Example was restored: ":" before commit; the active Example was left untouched: ")+message);
  }
}

// Safe one-time migration for a previously opened CURRENT Example after an
// online Studio upgrade. Never replace sources, settings or ordinary projects.
// Stale legacy Example data is intentionally left for explicit Replace Example.
export async function ensureOpenedExampleDependencies(vscode,extensionUri,storageUri,
  {recoveryResult=null,recoveryError=null}={}){
  const recovery=recoveryResult??(recoveryError?null:
    await recoverExampleReplacement(vscode,storageUri));
  const root=vscode.Uri.joinPath(storageUri,EXAMPLE_PROJECT_NAME);
  const folders=vscode.workspace.workspaceFolders??[];
  if(vscode.workspace.workspaceFile||folders.length!==1||
     folders[0]?.uri?.toString?.()!==root.toString())
    return {status:"NOT_EXAMPLE"};
  if(recoveryError)
    fail("Example replacement recovery failed: "+String(recoveryError?.message??recoveryError));
  if(recovery?.status==="UNSUPPORTED_HOST")
    fail(recovery.message);
  const fs=vscode.workspace.fs;
  let rootStat;
  try{rootStat=await fs.stat(root);}
  catch(error){if(error?.code==="FileNotFound")return {status:"LEGACY_OR_UNKNOWN"};throw error;}
  if((rootStat.type&64)===64)
    fail("Built-in Example root cannot be a symbolic link");
  if((rootStat.type&2)!==2)
    return {status:"LEGACY_OR_UNKNOWN"};
  const settingsUri=vscode.Uri.joinPath(root,".vscode","settings.json");
  try{await fs.stat(settingsUri);return {status:"PRESERVED"};}
  catch(error){if(error?.code!=="FileNotFound")throw error;}
  const procedure=vscode.Uri.joinPath(root,"skills",SKILLS[0],
    "assurance","procedure.yaml");
  const contract=vscode.Uri.joinPath(root,"skills",SKILLS[0],
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
  const manifestUri=vscode.Uri.joinPath(extensionUri,"samples","v1alpha5","files.json");
  const candidate=validate(JSON.parse(decoder.decode(
    await readBundledResource(vscode,manifestUri))),{
      kind:"CA-SL v1alpha5",
      sourceSha:"b06f72baae3eb3d578c489f950a325e2d63d556f",
      sourceStatus:"OWNER_LINKED_STATIC_BUILD_PASS_E2E_NOT_RERUN",
      sourceRef:"refs/heads/main",
      languageVersion:"connectionagent.io/v1alpha5",
      projectReadme:"README.md"
    });
  const skillsRoot=vscode.Uri.joinPath(root,"skills");
  let names;
  try{names=(await fs.readDirectory(skillsRoot)).map(([name])=>name).sort();}
  catch(error){if(error?.code==="FileNotFound")return {status:"LEGACY_OR_UNKNOWN"};throw error;}
  if(JSON.stringify(names)!==JSON.stringify([...SKILLS].sort()))
    return {status:"LEGACY_OR_UNKNOWN"};
  for(const relativePath of candidate.files){
    let bytes;
    try{bytes=await fs.readFile(vscode.Uri.joinPath(skillsRoot,...relativePath.split("/")));}
    catch(error){if(error?.code==="FileNotFound")return {status:"LEGACY_OR_UNKNOWN"};throw error;}
    if(await gitBlobSha1(bytes)!==candidate.blobs[relativePath])
      return {status:"LEGACY_OR_UNKNOWN"};
  }
  const prepared=await prepareExampleDependencies(vscode,extensionUri,candidate);
  const seeded=await persistExampleDependenciesIfAbsent(vscode,root,prepared);
  return {status:seeded?"SEEDED":"PRESERVED",
    dependencyIds:prepared.map(item=>item.declaration.id),
    snapshotDigests:Object.fromEntries(prepared.map(item=>
      [item.declaration.id,item.snapshotDigest]))};
}

async function seedExampleProjectInPlace(vscode,extensionUri,storageUri,
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
        sourceSha:"b06f72baae3eb3d578c489f950a325e2d63d556f",
        sourceStatus:"OWNER_LINKED_STATIC_BUILD_PASS_E2E_NOT_RERUN",
        sourceRef:"refs/heads/main",
        languageVersion:"connectionagent.io/v1alpha5",
        projectReadme:"README.md"
      });
    };
    const candidate=await readManifest();
    // Validate the EXACT bundled release ZIP before touching even an existing
    // Example. A missing/corrupt asset must never partially replace user work.
    phase="verify-pinned-example-dependencies";
    const exampleDependencies=await prepareExampleDependencies(vscode,extensionUri,candidate);
    const root=vscode.Uri.joinPath(storageUri,EXAMPLE_PROJECT_NAME);
    const skillsRoot=vscode.Uri.joinPath(root,"skills");
    const exists=async uri=>{
      try{await fs.stat(uri);return true;}
      catch(error){if(error?.code==="FileNotFound")return false;throw error;}
    };
    const hadExisting=await exists(root);
    const replacedExisting=Boolean(replaceExisting&&hadExisting);
    phase="verify-pinned-example-source";
    const sourceRoot=vscode.Uri.joinPath(extensionUri,"samples","v1alpha5");
    const readSource=file=>readBundledResource(vscode,
      vscode.Uri.joinPath(sourceRoot,...file.split("/")));
    const readme=await readSource(candidate.projectReadme);
    const sources=new Map();
    for(const file of candidate.files){
      const bytes=await readSource(file);
      if(!(bytes instanceof Uint8Array)||await gitBlobSha1(bytes)!==candidate.blobs[file])
        fail("Bundled Skill source does not match pinned ca-skills blob: "+file);
      sources.set(file,bytes);
    }
    phase="create-project-layout";
    await fs.createDirectory(skillsRoot);

    const readmeDestination=vscode.Uri.joinPath(root,"README.md");
    let readmeUpdated=false;
    // Confirmed replacement always restores the pinned README.
    if(replacedExisting||!(await exists(readmeDestination))){
      phase="write-v1alpha5-project-readme";
      await fs.writeFile(readmeDestination,readme);
      readmeUpdated=true;
    }

    const total=candidate.files.length;
    let created=0,skipped=0;
    report({phase:"files",completed:0,total});
    for(const file of candidate.files){
      const parts=file.split("/");
      const destination=vscode.Uri.joinPath(skillsRoot,...parts);
      phase="stat-existing:"+file;
      // Confirmed replacement always restores the exact bundled bytes.
      if(!replacedExisting&&await exists(destination)){
        skipped++;
        report({phase:"files",completed:created+skipped,total});
        continue;
      }
      const bytes=sources.get(file);
      if(parts.length>1)
        await fs.createDirectory(vscode.Uri.joinPath(skillsRoot,...parts.slice(0,-1)));
      // Protect against a concurrent write on an unconfirmed import.
      if(!replacedExisting){
        try{await fs.stat(destination);fail("v1alpha5 sample file changed during import");}
        catch(error){if(error?.code!=="FileNotFound")throw error;}
      }
      phase="write-v1alpha5-file:"+file;
      await fs.writeFile(destination,bytes);
      created++;
      report({phase:"files",completed:created+skipped,total});
    }

    if(replacedExisting){
      phase="prune-retired-example-files";
      // Keep active directory handles and immutable snapshots in place.
      await pruneExampleDirectory(vscode,fs,root,[
        ".vscode",".skill-studio","README.md",...candidate.files.map(file=>"skills/"+file)
      ]);
    }

    // Only the built-in Example gets this dependency. A fresh or explicitly
    // replaced Example receives a pinned snapshot + .vscode/settings.json.
    // Existing user settings are never rewritten on a non-replacing reopen;
    // this also respects users who intentionally removed ca-client.
    phase="persist-example-interface-lock";
    const exampleDependencySeeded=await persistExampleDependenciesIfAbsent(
      vscode,root,exampleDependencies,{replaceSettings:replacedExisting});

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
      sourceShas:{v1alpha5:candidate.sourceSha,
        ownerToolCatalog:candidate.dependencies.find(item=>item.id==="mas").resolvedRevision,
        hostContext:candidate.dependencies.find(item=>item.id==="ca-context").resolvedRevision},
      candidateFiles:candidate.files.length,
      files:total,created,skipped,replacedExisting,readmeUpdated,
      exampleDependencySeeded,
      exampleDependencyIds:exampleDependencies.map(item=>item.declaration.id),
      exampleDependencySnapshotDigests:Object.fromEntries(exampleDependencies.map(item=>
        [item.declaration.id,item.snapshotDigest])),
      exampleDependencyId:"ca-client",
      exampleDependencySnapshotDigest:exampleDependencies.find(item=>
        item.declaration.id==="ca-client").snapshotDigest
    };
  }catch(error){throw Error(phase+": "+String(error?.message??error));}
}

export async function seedExampleProject(vscode,extensionUri,storageUri,options={}){
  if(replacementBusy)
    fail("Example replacement is already in progress; wait for it to finish");
  replacementBusy=true;
  setExampleReplacementStatus("IN_PROGRESS","Preparing the built-in Example","seed-example");
  let transactionalReplacement=false;
  let transactionStarted=false;
  let recoveryCompleted=false;
  let recoveryUnsupported=false;
  try{
    const recovery=await recoverExampleReplacementInternal(vscode,storageUri);
    if(recovery.status==="UNSUPPORTED_HOST"){
      recoveryUnsupported=true;
      setExampleReplacementStatus("UNAVAILABLE",recovery.message,"startup-recovery");
      throw Error(recovery.message);
    }
    recoveryCompleted=true;
    const root=vscode.Uri.joinPath(storageUri,EXAMPLE_PROJECT_NAME);
    let existing=false;
    try{
      const rootStat=await vscode.workspace.fs.stat(root);
      if((rootStat.type&64)===64)
        fail("Built-in Example root cannot be a symbolic link");
      if((rootStat.type&2)!==2)
        fail("Built-in Example root exists but is not a directory");
      existing=true;
    }catch(error){if(error?.code!=="FileNotFound")throw error;}
    transactionalReplacement=Boolean(options.replaceExisting&&existing);
    if(transactionalReplacement){
      // Save dirty documents before the verified backup is taken. The same
      // URI remains open; if replacement rolls back, the saved user bytes are
      // part of the restored backup instead of being lost in an editor buffer.
      await saveDirtyExampleDocuments(vscode,root);
      transactionStarted=true;
      return await seedExampleProjectTransaction(vscode,extensionUri,storageUri,options);
    }
    const result=await seedExampleProjectInPlace(vscode,extensionUri,storageUri,{
      ...options,replaceExisting:false,
      onProgress:event=>{
        if(event?.phase==="project-ready")setExampleReplacementStatus("READY",null,null);
        options.onProgress?.(event);
      }
    });
    setExampleReplacementStatus("READY",null,null);
    return result;
  }catch(error){
    if(!recoveryCompleted){
      setExampleReplacementStatus(recoveryUnsupported?"UNAVAILABLE":"RECOVERY_REQUIRED",
        String(error?.message??error),"startup-recovery");
    }else if(replacementStatus.state==="IN_PROGRESS"){
      setExampleReplacementStatus(transactionStarted?"RECOVERY_REQUIRED":"READY",
        String(error?.message??error),transactionStarted?"replacement":"save-dirty-documents");
    }
    throw error;
  }finally{
    replacementBusy=false;
  }
}
