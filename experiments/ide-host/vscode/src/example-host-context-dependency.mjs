import {calculateSnapshot,gitBlobSha1} from "./dependency-snapshot.mjs";
import {validateProjectConfiguration} from "./project-configuration.mjs";

const CONTEXT_REVISION="57e277ff9094dad93543df46910a12a1dbbaf560";
const CONTEXT_PACKAGE_ID="urn:connectionagent:ca:host-context";
const CONTEXT_OWNER="urn:connectionagent:owner:ca-context";
const CONTEXT_SCHEMA_ID="urn:connectionagent:ca:context:subject:v1";
const decoder=new TextDecoder("utf-8",{fatal:true});

export async function prepareExampleHostContextDependency(readBundled,entry){
  if(entry?.id!=="ca-context"||entry.kind!=="schema-bundle"||
     entry.resolvedRevision!==CONTEXT_REVISION||
     entry.source?.type!=="git"||
     entry.source.repository!=="odango-chan/ca-agent-demo"||
     entry.source.ref!=="refs/heads/main"||
     entry.source.path!=="tests/fixtures/compiler/mas-v1alpha5-scheme-c/trusted/snapshots/ca-context"||
     entry.source.packageId!==CONTEXT_PACKAGE_ID||
     entry.source.owner!==CONTEXT_OWNER||
     entry.source.version!=="v1"||
     entry.source.sourceStatus!=="DEVELOPMENT_FIXTURE"||
     JSON.stringify(entry.files)!==JSON.stringify(["subject.schema.json"])||
     !entry.blobs||Object.keys(entry.blobs).length!==1)
    throw Error("Pinned Host subject-context Schema source identity mismatch");
  const bytes=await readBundled("host-context/subject.schema.json");
  if(await gitBlobSha1(bytes)!==entry.blobs["subject.schema.json"])
    throw Error("Host subject-context Schema Git blob digest mismatch");
  let schema;
  try{schema=JSON.parse(decoder.decode(bytes));}
  catch(error){throw Error("Host subject-context Schema is invalid: "+String(error?.message??error));}
  if(schema.$id!==CONTEXT_SCHEMA_ID||
     schema.$schema!=="https://json-schema.org/draft/2020-12/schema"||
     schema.type!=="object"||!Array.isArray(schema.required)||
     !schema.required.includes("supi"))
    throw Error("Host subject-context Schema identity or shape mismatch");
  const files=[{path:"subject.schema.json",bytes}];
  const snapshot=await calculateSnapshot(files);
  const declaration={id:entry.id,kind:entry.kind,source:entry.source};
  const lock={...declaration,resolvedRevision:entry.resolvedRevision,
    snapshotDigest:snapshot.snapshotDigest,files:snapshot.files};
  validateProjectConfiguration({skillsRoot:"skills",dependencies:[declaration],
    dependencyLock:{version:"skillc.lock/v0.1",entries:[lock]}});
  return {declaration,lock,files,snapshotDigest:snapshot.snapshotDigest};
}
