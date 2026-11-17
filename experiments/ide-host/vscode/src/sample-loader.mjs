// Explicit Sample Package import for VS Code desktop/web or Theia browser-only OPFS.
// Online demo reset replaces the two bundled SKILL packages with their pinned
// source; desktop/user workspaces remain create-only unless reset is explicit.
// The project owns authored skills/ Source. Dependencies and BuildResults are
// managed by their services; the sample importer never creates lib/ or output/.
export const EXAMPLE_PROJECT_NAME="skill-studio-demo";
const SKILLS=Object.freeze(["establish-pdu-session","establish-pdu-session-mas"]);
const decoder=new TextDecoder();
const PREVIOUS_V1ALPHA4_BLOBS=Object.freeze({
  "establish-pdu-session-mas/SKILL.md":"76b7eb8bbcc4a7423ca2c2378618af09fefe0616",
  "establish-pdu-session-mas/assurance/contract.yaml":"1af104ea796d07d5fc917a9ffb42b89e3be328a4",
  "establish-pdu-session-mas/assurance/openamsm-operation-mapping.md":"5c4bfeabd9208d4272ab877807d9ac06efe6537d",
  "establish-pdu-session-mas/assurance/predicates.yaml":"75fd269e935d0571b9390da77cebdf8d9ddebdbd",
  "establish-pdu-session-mas/assurance/procedure.yaml":"ac11b372f8da3d39a7ab4a420bf603b0ee5eff08",
  "establish-pdu-session-mas/schemas/establishment-request.schema.yaml":"e8fc0da17c1ac22cb01633876644b6bc11d12417",
  "establish-pdu-session/SKILL.md":"65d8ec3b1159c2f2fb4a47301143eb18a57ad030",
  "establish-pdu-session/assurance/contract.yaml":"3d94d3ad842472d57f0b57c28a7b54928dc88d10",
  "establish-pdu-session/assurance/predicates.yaml":"2b3031df2a2fdb8fff32701c42b4b32456a9c51f",
  "establish-pdu-session/assurance/procedure.yaml":"0d8e41cc3eb2162731a457241879aeefa3f6361e",
  "establish-pdu-session/schemas/establishment-request.schema.yaml":"e448b7f8f997b2ef0246d309a49362702f41bf3d",
  "establish-pdu-session/scripts/validate-smf-session-context-entry.py":"7b5fab4ada028a2acd76405c6eb2a64d2b39ac15",
  "establish-pdu-session/scripts/validate-smf-session-context.py":"9244f408a7af4c34e69e96b2cda2eb61c4a6b542",
  "establish-pdu-session/scripts/validate-subscription-request.py":"806c9384e827a4a37f394194e9444dce7fc44c5a"
});
const PREVIOUS_EXAMPLE_README_BLOB="3458aebabef840f36b7dc9231aa3a86bb5ef5351";
async function gitBlobSha(bytes){
  try{
    const crypto=globalThis.crypto;
    if(!crypto?.subtle?.digest)return null;
    const prefix=new TextEncoder().encode("blob "+bytes.length+"\0");
    const payload=new Uint8Array(prefix.length+bytes.length);
    payload.set(prefix,0);
    payload.set(bytes,prefix.length);
    const digest=await crypto.subtle.digest("SHA-1",payload);
    return [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,"0")).join("");
  }catch{return null;}
}
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
        sourceSha:"ab189d5dd62763be4cd2f00cc8047a0c5982b6be",
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
    let readmeUpdated=false;
    if(!(await exists(readmeDestination))||resetExisting){
      phase="write-v1alpha4-project-readme";
      const bytes=await readBundledResource(vscode,readmeSource);
      await fs.writeFile(readmeDestination,bytes);
      readmeUpdated=resetExisting;
    }else{
      const currentReadmeSha=await gitBlobSha(await fs.readFile(readmeDestination));
      if(currentReadmeSha===PREVIOUS_EXAMPLE_README_BLOB){
        phase="refresh-v1alpha4-project-readme";
        const bytes=await readBundledResource(vscode,readmeSource);
        await fs.writeFile(readmeDestination,bytes);
        readmeUpdated=true;
      }
    }

    const total=candidate.files.length;
    let created=0,skipped=0,overwritten=0;
    report({phase:"files",completed:0,total});
    for(const file of candidate.files){
      const parts=file.split("/");
      const destination=vscode.Uri.joinPath(skillsRoot,...parts);
      phase="stat-existing:"+file;
      const alreadyExists=await exists(destination);
      let refreshUnmodifiedPrevious=false;
      if(alreadyExists&&!resetExisting){
        const previousBlob=PREVIOUS_V1ALPHA4_BLOBS[file];
        const currentBlob=candidate.blobs[file];
        if(previousBlob&&previousBlob!==currentBlob){
          phase="check-previous-v1alpha4-file:"+file;
          const actualBlob=await gitBlobSha(await fs.readFile(destination));
          refreshUnmodifiedPrevious=actualBlob===previousBlob;
        }
        if(!refreshUnmodifiedPrevious){
          skipped++;
          report({phase:"files",completed:created+skipped+overwritten,total});
          continue;
        }
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
      files:total,created,skipped,overwritten,resetPackages,legacyArchived,
      readmeUpdated,resetExisting
    };
  }catch(error){throw Error(phase+": "+String(error?.message??error));}
}
