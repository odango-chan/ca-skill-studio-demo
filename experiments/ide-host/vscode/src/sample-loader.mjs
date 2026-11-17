// Explicit Sample Package import for VS Code desktop/web or Theia browser-only OPFS.
// Online demo reset replaces the two bundled SKILL packages with their pinned
// source; desktop/user workspaces remain create-only unless reset is explicit.
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
export async function seedExampleProject(vscode,extensionUri,storageUri,
  {resetExisting=false,onProgress=()=>{}}={}){
  let phase="initial";
  const report=event=>{if(typeof onProgress==="function")onProgress(event);};
  try{
    if(!vscode?.workspace?.fs||!vscode.Uri?.file||!vscode.Uri.joinPath)
      fail("Host file system unavailable");
    if(!storageUri)fail("No writable extension storage URI");
    const fs=vscode.workspace.fs;
    const readManifest=async()=>{
      const uri=vscode.Uri.joinPath(extensionUri,"samples","v1alpha4","files.json");
      phase="read-v1alpha4-manifest";
      report({phase:"manifest"});
      let bytes;
      try{bytes=await readBundledResource(vscode,uri);}
      catch(error){fail("Cannot read CA-SL v1alpha4 manifest: "+JSON.stringify(describeError(error)));}
      return validate(JSON.parse(decoder.decode(bytes)),{
        kind:"CA-SL v1alpha4",
        sourceSha:"33664aec7ebc9bb1764618f839d01b7493425429",
        sourceStatus:"DRAFT_NOT_QUALIFIED",
        sourceRef:"refs/pull/58/head",
        languageVersion:"connectionagent.io/v1alpha4",
        projectReadme:"README.md"
      });
    };
    const candidate=await readManifest();
    const root=vscode.Uri.joinPath(storageUri,EXAMPLE_PROJECT_NAME);
    const skillsRoot=vscode.Uri.joinPath(root,"skills");
    const examplesRoot=vscode.Uri.joinPath(root,"examples","v1alpha4-candidate");
    const archiveRoot=vscode.Uri.joinPath(root,"archive");
    const legacyArchiveRoot=vscode.Uri.joinPath(archiveRoot,"legacy-v0.2");
    const exists=async uri=>{
      try{await fs.stat(uri);return true;}
      catch(error){if(error?.code==="FileNotFound")return false;throw error;}
    };
    const readText=async uri=>decoder.decode(await fs.readFile(uri));
    phase="create-project-layout";
    await fs.createDirectory(root);
    await fs.createDirectory(skillsRoot);
    let resetPackages=0,legacyArchived=0;

    if(resetExisting){
      for(const skill of SKILLS){
        for(const packageRoot of [
          vscode.Uri.joinPath(skillsRoot,skill),
          vscode.Uri.joinPath(examplesRoot,skill)
        ]){
          if(await exists(packageRoot)){
            phase="reset-package:"+skill;
            await fs.delete(packageRoot,{recursive:true,useTrash:false});
            resetPackages++;
          }
        }
      }
    }else{
      // Migrate the previously bundled Example without destroying user edits:
      // old v0.2 packages are moved out of the active skills/ tree, while any
      // already-imported v1alpha4 package is promoted into skills/ in place.
      for(const skill of SKILLS){
        const target=vscode.Uri.joinPath(skillsRoot,skill);
        if(await exists(target)){
          const procedure=vscode.Uri.joinPath(target,"assurance","procedure.yaml");
          let source="";
          try{source=await readText(procedure);}catch{/* incomplete old package is archived too */}
          if(!/^\s*#.*CA-SL v1alpha4/m.test(source)){
            let archiveParent=legacyArchiveRoot;
            let destination=vscode.Uri.joinPath(archiveParent,skill);
            for(let suffix=2;await exists(destination);suffix++){
              archiveParent=vscode.Uri.joinPath(archiveRoot,"legacy-v0.2-"+suffix);
              destination=vscode.Uri.joinPath(archiveParent,skill);
            }
            phase="archive-legacy-package:"+skill;
            await fs.createDirectory(archiveParent);
            await fs.rename(target,destination);
            legacyArchived++;
          }
        }
        const promoted=vscode.Uri.joinPath(examplesRoot,skill);
        if(!(await exists(target))&&await exists(promoted)){
          phase="promote-v1alpha4-package:"+skill;
          await fs.rename(promoted,target);
        }
      }
    }

    const readmeSource=vscode.Uri.joinPath(extensionUri,"samples","v1alpha4",candidate.projectReadme);
    const readmeDestination=vscode.Uri.joinPath(root,"README.md");
    if(!(await exists(readmeDestination))){
      phase="read-v1alpha4-project-readme";
      const bytes=await readBundledResource(vscode,readmeSource);
      await fs.writeFile(readmeDestination,bytes);
    }

    const total=candidate.files.length;
    let created=0,skipped=0,overwritten=0;
    report({phase:"files",completed:0,total});
    for(const file of candidate.files){
      const parts=file.split("/");
      const destination=vscode.Uri.joinPath(skillsRoot,...parts);
      phase="stat-existing:"+file;
      const alreadyExists=await exists(destination);
      if(alreadyExists&&!resetExisting){
        skipped++;
        report({phase:"files",completed:created+skipped+overwritten,total});
        continue;
      }
      phase="read-bundled-file:"+file;
      const bytes=await readBundledResource(vscode,
        vscode.Uri.joinPath(extensionUri,"samples","v1alpha4",...parts));
      if(!(bytes instanceof Uint8Array))fail("Unrecognized v1alpha4 sample file");
      if(parts.length>1)
        await fs.createDirectory(vscode.Uri.joinPath(skillsRoot,...parts.slice(0,-1)));
      if(!alreadyExists){
        try{await fs.stat(destination);fail("v1alpha4 sample file changed during import");}
        catch(error){if(error?.code!=="FileNotFound")throw error;}
      }
      phase="write-v1alpha4-file:"+file;
      await fs.writeFile(destination,bytes);
      if(alreadyExists)overwritten++;else created++;
      report({phase:"files",completed:created+skipped+overwritten,total});
    }

    report({phase:"project-ready"});
    const procedures=Object.fromEntries(SKILLS.map(name=>
      [name,vscode.Uri.joinPath(skillsRoot,name,"assurance","procedure.yaml")]));
    return {
      root,skillsRoot,procedure:procedures[SKILLS[0]],procedures,
      skills:[...SKILLS],
      sourceSha:candidate.sourceSha,
      sourceShas:{v1alpha4:candidate.sourceSha},
      candidateFiles:candidate.files.length,
      files:total,created,skipped,overwritten,resetPackages,legacyArchived,resetExisting
    };
  }catch(error){throw Error(phase+": "+String(error?.message??error));}
}
