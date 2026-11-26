import {parseDocument} from "yaml";
import {createCompilerSourceFiles,COMPILER_LANGUAGE_TARGET}
  from "./compiler-request.mjs";
import {calculateSnapshot,calculateCompilerDependencySnapshotDigest,decodeBase64,base64Bytes}
  from "./dependency-snapshot.mjs";

export const COMPILER_DEVELOPMENT_BUILD_REQUEST_API_VERSION=
  "connectionagent.io/compiler-development-build-request/v1alpha1";
export const INTERFACE_DEPENDENCY_LOCK_API_VERSION=
  "connectionagent.io/interface-dependency-lock/v1alpha1";
export const INTERFACE_PACKAGE_API_VERSION=
  "connectionagent.io/interface-package/v1alpha1";

const decoder=new TextDecoder("utf-8",{fatal:true});
const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
const compareText=(a,b)=>a<b?-1:a>b?1:0;
const identity=value=>value.packageId+String.fromCharCode(0)+value.version;

function contractDependencies(documents){
  const document=documents.find(item=>item?.relativePath==="assurance/contract.yaml");
  if(!document||typeof document.text!=="string"||document.readable===false)
    fail("DEVELOPMENT_BUILD_CONTRACT_UNAVAILABLE",
      "A readable assurance/contract.yaml is required to construct Interface Package roots");
  let parsed;
  try{parsed=parseDocument(document.text,{uniqueKeys:true,version:"1.2"});}
  catch(error){fail("DEVELOPMENT_BUILD_CONTRACT_INVALID",
    "Contract YAML could not be parsed: "+String(error?.message??error));}
  if(parsed.errors?.length)
    fail("DEVELOPMENT_BUILD_CONTRACT_INVALID",
      "Contract YAML is invalid: "+parsed.errors.map(error=>error.message).join("; "));
  const contract=parsed.toJS({mapAsMap:false});
  const dependencies=contract?.dependencies??{};
  if(!dependencies||typeof dependencies!=="object"||Array.isArray(dependencies))
    fail("DEVELOPMENT_BUILD_DEPENDENCIES_INVALID",
      "Contract dependencies must be an alias-to-Package-ID mapping");
  const entries=Object.entries(dependencies).sort(([a],[b])=>compareText(a,b));
  if(!entries.length)
    fail("DEVELOPMENT_BUILD_NO_ROOT_DEPENDENCIES",
      "Compiler v2.1.0 Development Build requires at least one exact Interface Package root");
  for(const [alias,packageId] of entries){
    if(typeof alias!=="string"||!alias.trim()||
       typeof packageId!=="string"||!packageId.trim())
      fail("DEVELOPMENT_BUILD_DEPENDENCIES_INVALID",
        "Every Contract dependency must have a non-empty alias and stable Package ID");
  }
  return entries;
}

async function readInterfaceSnapshot(snapshot){
  if(!snapshot||snapshot.kind!=="interface-package")
    fail("DEVELOPMENT_BUILD_DEPENDENCY_KIND_UNSUPPORTED",
      "Only verified immutable Interface Package snapshots can enter Development Build");
  if(typeof snapshot.id!=="string"||!snapshot.id.trim()||
     !Array.isArray(snapshot.files)||!snapshot.files.length)
    fail("DEVELOPMENT_BUILD_SNAPSHOT_INVALID",
      "A locked Interface Package snapshot requires an alias and exact files");
  const files=[];
  const seen=new Set();
  for(const file of snapshot.files){
    if(typeof file?.path!=="string"||typeof file.bytes!=="string"||seen.has(file.path))
      fail("DEVELOPMENT_BUILD_SNAPSHOT_INVALID",
        "Snapshot file paths and base64 bytes must be unique and complete");
    seen.add(file.path);
    files.push({path:file.path,bytes:decodeBase64(file.bytes)});
  }
  files.sort((a,b)=>compareText(a.path,b.path));
  const manifestFile=files.find(file=>file.path==="package.json");
  if(!manifestFile)
    fail("DEVELOPMENT_BUILD_MANIFEST_MISSING",
      "Locked Interface Package is missing its root package.json");
  let manifest;
  try{manifest=JSON.parse(decoder.decode(manifestFile.bytes));}
  catch(error){fail("DEVELOPMENT_BUILD_MANIFEST_INVALID",
    "Locked Interface Package package.json is invalid: "+String(error?.message??error));}
  if(manifest.apiVersion!==INTERFACE_PACKAGE_API_VERSION||
     manifest.languageTarget!==COMPILER_LANGUAGE_TARGET||
     typeof manifest.packageId!=="string"||!manifest.packageId.trim()||
     typeof manifest.version!=="string"||!manifest.version.trim()||
     !Array.isArray(manifest.dependencies))
    fail("DEVELOPMENT_BUILD_MANIFEST_INVALID",
      "Interface Package identity, language target or dependency list is not valid");
  const edgeAliases=new Set();
  for(const dependency of manifest.dependencies){
    if(typeof dependency?.alias!=="string"||!dependency.alias.trim()||
       typeof dependency.packageId!=="string"||!dependency.packageId.trim()||
       typeof dependency.version!=="string"||!dependency.version.trim()||
       edgeAliases.has(dependency.alias))
      fail("DEVELOPMENT_BUILD_MANIFEST_INVALID",
        "Interface Package dependencies require unique aliases and exact Package ID/version pairs");
    edgeAliases.add(dependency.alias);
  }
  // Re-check the resolver's existing Studio lock digest at this boundary.
  // The Compiler v2.1 digest below is a distinct framing over the same exact
  // bytes; neither digest may silently substitute for the other.
  const studioSnapshot=await calculateSnapshot(files);
  if(typeof snapshot.snapshotDigest!=="string"||
     studioSnapshot.snapshotDigest!==snapshot.snapshotDigest)
    fail("DEVELOPMENT_BUILD_SNAPSHOT_DIGEST_MISMATCH",
      "Resolved Interface Package bytes no longer match the current immutable Studio lock");
  const snapshotDigest=await calculateCompilerDependencySnapshotDigest(files);
  const key={packageId:manifest.packageId,version:manifest.version,snapshotDigest};
  return {
    alias:snapshot.id,
    key,
    manifest,
    files:files.map(file=>({path:file.path,bytes:base64Bytes(file.bytes)}))
  };
}

function manifestIdentityCandidate(snapshot){
  if(!Array.isArray(snapshot?.files))return null;
  const file=snapshot.files.find(item=>item?.path==="package.json");
  if(typeof file?.bytes!=="string")return null;
  try{
    const manifest=JSON.parse(decoder.decode(decodeBase64(file.bytes)));
    if(typeof manifest.packageId!=="string"||!manifest.packageId.trim()||
       typeof manifest.version!=="string"||!manifest.version.trim())return null;
    return {packageId:manifest.packageId,version:manifest.version};
  }catch{return null;}
}

/**
 * Assemble the released Compiler v2.1.0 Development BuildRequest from the
 * exact project-locked snapshots. Contract.dependencies owns root aliases;
 * package.json dependencies own transitive edges. No network resolution,
 * inferred aliases, trust grants or Studio-specific linker semantics exist.
 */
export async function createCompilerDevelopmentBuildRequest({
  packageName,documents,resolvedDependencies
}={}){
  const files=createCompilerSourceFiles({packageName,documents});
  if(resolvedDependencies?.status!=="READY"||
     !Array.isArray(resolvedDependencies.snapshots))
    fail("DEVELOPMENT_BUILD_DEPENDENCIES_NOT_READY",
      "Exact locked Interface Package snapshots are not READY; Compiler Development Build is blocked");
  const rootsFromContract=contractDependencies(documents);

  // Index the resolver's already-verified snapshots without validating every
  // project dependency as an Interface Package. Only Contract roots and the
  // transitive closure selected from their manifests are Compiler inputs.
  const rawByAlias=new Map();
  for(const raw of resolvedDependencies.snapshots){
    if(typeof raw?.id!=="string"||!raw.id.trim())continue;
    const list=rawByAlias.get(raw.id)??[];
    list.push(raw);
    rawByAlias.set(raw.id,list);
  }
  const identityCandidates=new Map();
  for(const raw of resolvedDependencies.snapshots){
    if(raw?.kind!=="interface-package")continue;
    const candidate=manifestIdentityCandidate(raw);
    if(!candidate)continue; // An unrelated package must not block this Skill.
    const key=identity(candidate);
    const list=identityCandidates.get(key)??[];
    list.push(raw);
    identityCandidates.set(key,list);
  }
  const parsedByRaw=new Map();
  const readSelected=async raw=>{
    if(!parsedByRaw.has(raw))parsedByRaw.set(raw,readInterfaceSnapshot(raw));
    return parsedByRaw.get(raw);
  };
  const unsupportedKind=(alias,kind)=>fail("DEVELOPMENT_BUILD_DEPENDENCY_KIND_UNSUPPORTED",
    "Contract or transitive dependency "+alias+" resolves to "+String(kind)+
    "; Compiler v2.1.0 requires a formal Interface Package");

  const roots=[];
  const rootSnapshots=new Map();
  for(const [alias,packageId] of rootsFromContract){
    const candidates=rawByAlias.get(alias)??[];
    if(!candidates.length)
      fail("DEVELOPMENT_BUILD_ROOT_NOT_LOCKED",
        "Contract dependency alias "+alias+" has no exact locked Interface Package snapshot");
    if(candidates.length!==1)
      fail("DEVELOPMENT_BUILD_DEPENDENCY_ALIAS_DUPLICATE",
        "More than one locked snapshot uses Contract dependency alias "+alias);
    const raw=candidates[0];
    if(raw.kind!=="interface-package")unsupportedKind(alias,raw.kind);
    const snapshot=await readSelected(raw);
    if(snapshot.key.packageId!==packageId)
      fail("DEVELOPMENT_BUILD_ROOT_PACKAGE_ID_MISMATCH",
        "Contract dependency "+alias+" declares "+packageId+
        " but the locked snapshot is "+snapshot.key.packageId);
    roots.push({alias,key:snapshot.key});
    rootSnapshots.set(alias,snapshot);
  }

  const resolveTransitive=async dependency=>{
    const keyId=identity(dependency);
    const candidates=identityCandidates.get(keyId)??[];
    if(candidates.length){
      const digests=new Set(candidates.map(item=>item.snapshotDigest));
      if(digests.size>1)
        fail("DEVELOPMENT_BUILD_PACKAGE_IDENTITY_AMBIGUOUS",
          "One Package ID/version resolves to multiple immutable snapshot digests: "+
          dependency.packageId+"@"+dependency.version);
      return readSelected(candidates[0]);
    }
    const aliasCandidates=rawByAlias.get(dependency.alias)??[];
    if(aliasCandidates.length>1)
      fail("DEVELOPMENT_BUILD_DEPENDENCY_ALIAS_DUPLICATE",
        "More than one locked snapshot uses transitive dependency alias "+dependency.alias);
    if(aliasCandidates.length===1){
      const raw=aliasCandidates[0];
      if(raw.kind!=="interface-package")unsupportedKind(dependency.alias,raw.kind);
      const snapshot=await readSelected(raw);
      if(identity(snapshot.key)!==keyId)
        fail("DEVELOPMENT_BUILD_TRANSITIVE_PACKAGE_IDENTITY_MISMATCH",
          "Transitive dependency "+dependency.alias+" requires "+
          dependency.packageId+"@"+dependency.version+" but the locked alias resolves to "+
          snapshot.key.packageId+"@"+snapshot.key.version);
      return snapshot;
    }
    fail("DEVELOPMENT_BUILD_TRANSITIVE_SNAPSHOT_MISSING",
      "Package dependency "+dependency.alias+" = "+dependency.packageId+"@"+
      dependency.version+" has no exact locked Interface Package snapshot");
  };

  const visited=new Set(),visiting=new Set(),packages=[],snapshots=[];
  const versionByPackageId=new Map();
  const visit=async snapshot=>{
    const previousVersion=versionByPackageId.get(snapshot.key.packageId);
    if(previousVersion&&previousVersion!==snapshot.key.version)
      fail("DEVELOPMENT_BUILD_PACKAGE_VERSION_CONFLICT",
        "One Development Build closure contains multiple versions of Package "+
        snapshot.key.packageId+": "+previousVersion+" and "+snapshot.key.version);
    versionByPackageId.set(snapshot.key.packageId,snapshot.key.version);
    const keyId=identity(snapshot.key);
    if(visited.has(keyId))return;
    if(visiting.has(keyId))
      fail("DEVELOPMENT_BUILD_DEPENDENCY_CYCLE",
        "Interface Package dependency cycle reaches "+snapshot.key.packageId);
    visiting.add(keyId);
    const edges=[];
    for(const dependency of snapshot.manifest.dependencies){
      const target=await resolveTransitive(dependency);
      edges.push({alias:dependency.alias,key:target.key});
      await visit(target);
    }
    edges.sort((a,b)=>compareText(a.alias,b.alias));
    packages.push({key:snapshot.key,dependencies:edges});
    snapshots.push({key:snapshot.key,files:snapshot.files});
    visiting.delete(keyId);
    visited.add(keyId);
  };
  for(const root of roots){
    const snapshot=rootSnapshots.get(root.alias);
    await visit(snapshot);
  }
  packages.sort((a,b)=>compareText(a.key.packageId,b.key.packageId)||
    compareText(a.key.version,b.key.version));
  snapshots.sort((a,b)=>compareText(a.key.packageId,b.key.packageId)||
    compareText(a.key.version,b.key.version));
  roots.sort((a,b)=>compareText(a.alias,b.alias));

  return {
    apiVersion:COMPILER_DEVELOPMENT_BUILD_REQUEST_API_VERSION,
    languageTarget:COMPILER_LANGUAGE_TARGET,
    profile:"DEVELOPMENT",
    files,
    targets:[packageName],
    lock:{
      apiVersion:INTERFACE_DEPENDENCY_LOCK_API_VERSION,
      roots,
      packages
    },
    snapshots
  };
}
