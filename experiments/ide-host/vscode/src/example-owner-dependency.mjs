import {calculateSnapshot,sha256,gitBlobSha1} from "./dependency-snapshot.mjs";
import {validateProjectConfiguration} from "./project-configuration.mjs";

const OWNER_API_VERSION="connectionagent.io/toolcatalog/v1alpha4";
const OWNER_BUILD_IDENTITY="sha256:ac834080f31ff0fa91b9eb846fa47c889a94837fc1f37ec2034190e4e83085c0";
const OWNER_REVISION="fc44c3a745c68443fcfb12054c7eadf0ed7cc3f7";
const OWNER_PACKAGE_ID="urn:openamsm:mas:tool-contracts";
const OWNER_NAME="openamsm.smf.mas";
const decoder=new TextDecoder("utf-8",{fatal:true});

function fail(message){throw Error(message);}
function validateEntry(entry){
  if(entry?.id!=="mas"||entry.kind!=="tool-catalog"||
     entry.resolvedRevision!==OWNER_REVISION||
     entry.source?.type!=="git"||
     entry.source.repository!=="odango-chan/ca-client-tools"||
     entry.source.ref!=="refs/tags/v1.2.0"||
     entry.source.path!=="contracts/owner/openamsm-mas/v1alpha4"||
     entry.source.packageId!==OWNER_PACKAGE_ID||
     entry.source.version!=="v1alpha4"||
     entry.source.owner!==OWNER_NAME||
     entry.source.buildIdentity!==OWNER_BUILD_IDENTITY)
    fail("Pinned Owner ToolCatalog source identity mismatch");
  if(!Array.isArray(entry.files)||entry.files.length!==59||
     !entry.blobs||Object.keys(entry.blobs).length!==entry.files.length)
    fail("Pinned Owner ToolCatalog file inventory is incomplete");
}
export async function prepareExampleOwnerDependency(readBundled,entry){
  validateEntry(entry);
  const manifestBytes=await readBundled("owner-package/manifest.json");
  if(await gitBlobSha1(manifestBytes)!==entry.blobs["manifest.json"])
    fail("Owner ToolCatalog manifest Git blob digest mismatch");
  let manifest;
  try{manifest=JSON.parse(decoder.decode(manifestBytes));}
  catch(error){fail("Owner ToolCatalog manifest is invalid: "+String(error?.message??error));}
  if(manifest.apiVersion!==OWNER_API_VERSION||
     manifest.buildIdentity!==OWNER_BUILD_IDENTITY||
     !manifest.artifacts||typeof manifest.artifacts!=="object")
    fail("Owner ToolCatalog manifest identity/build digest mismatch");
  const artifactPaths=Object.keys(manifest.artifacts).sort();
  const listed=entry.files.filter(path=>path!=="manifest.json").slice().sort();
  if(artifactPaths.length!==58||JSON.stringify(artifactPaths)!==JSON.stringify(listed))
    fail("Owner ToolCatalog manifest artifact inventory mismatch");
  const files=[{path:"manifest.json",bytes:manifestBytes}];
  for(const path of artifactPaths){
    const bytes=await readBundled("owner-package/"+path);
    if(await sha256(bytes)!==manifest.artifacts[path])
      fail("Owner ToolCatalog artifact SHA-256 mismatch: "+path);
    if(await gitBlobSha1(bytes)!==entry.blobs[path])
      fail("Owner ToolCatalog Git blob digest mismatch: "+path);
    files.push({path,bytes});
  }
  const catalog=decoder.decode(files.find(file=>file.path==="tool-catalog.yaml").bytes);
  if(!catalog.startsWith("apiVersion: "+OWNER_API_VERSION)||
     !/^metadata:\n  owner: openamsm\.smf\.mas\n/m.test(catalog))
    fail("Owner ToolCatalog does not declare the published OpenAMSM MAS Owner");
  const snapshot=await calculateSnapshot(files);
  const declaration={id:entry.id,kind:entry.kind,source:entry.source};
  const lock={...declaration,resolvedRevision:entry.resolvedRevision,
    snapshotDigest:snapshot.snapshotDigest,files:snapshot.files};
  validateProjectConfiguration({skillsRoot:"skills",dependencies:[declaration],
    dependencyLock:{version:"skillc.lock/v0.1",entries:[lock]}});
  return {declaration,lock,files,snapshotDigest:snapshot.snapshotDigest};
}
