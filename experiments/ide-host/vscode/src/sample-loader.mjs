// Explicit Example project import for VS Code desktop/web or Theia browser-only OPFS.
// Replacing an existing Example is a deliberate, user-confirmed operation that
// refreshes authored files in the Example root from the single pinned v1alpha5 source.
// Ordinary projects are never passed to this importer. It never creates lib/ or output/.
import {writeImmutableSnapshot} from "./dependency-service.mjs";
import {EXAMPLE_INTERFACE_ARCHIVE,prepareExampleInterfaceDependency,
  exampleWorkspaceSettingsContent} from "./example-interface-dependency.mjs";
import {prepareExampleOwnerDependency} from "./example-owner-dependency.mjs";
import {prepareExampleHostContextDependency} from "./example-host-context-dependency.mjs";
import {gitBlobSha1} from "./dependency-snapshot.mjs";

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

// Safe one-time migration for a previously opened CURRENT Example after an
// online Studio upgrade. Never replace sources, settings or ordinary projects.
// Stale legacy Example data is intentionally left for explicit Replace Example.
export async function ensureOpenedExampleDependencies(vscode,extensionUri,storageUri){
  const root=vscode.Uri.joinPath(storageUri,EXAMPLE_PROJECT_NAME);
  const folders=vscode.workspace.workspaceFolders??[];
  if(vscode.workspace.workspaceFile||folders.length!==1||
     folders[0]?.uri?.toString?.()!==root.toString())
    return {status:"NOT_EXAMPLE"};
  const fs=vscode.workspace.fs;
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
