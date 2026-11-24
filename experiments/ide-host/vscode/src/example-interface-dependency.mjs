// The default Example owns ONE fixed, public, immutable Interface Package.
// It is not an Owner authorization, a Compiler link or an artifact qualification.
// Source asset is the exact published ca-client-tools v1.1.0 ZIP, SHA verified
// at bundling AND again at every Example seed. No runtime GitHub fetch.
import {decodeBase64,sha256,calculateSnapshot} from "./dependency-snapshot.mjs";
import {decodeInterfacePackageZip} from "./interface-package-zip.mjs";
import {validateProjectConfiguration} from "./project-configuration.mjs";

export const EXAMPLE_INTERFACE_ALIAS="ca-client";
export const EXAMPLE_INTERFACE_ARCHIVE="ca-client-tools_interface_1.1.0.zip";
export const EXAMPLE_INTERFACE_DIGEST=
  "sha256:cbd8fad939844cda5474f33f18d3cdc015c69dd8c1dc3908e84bd5273ce6e71b";
export const EXAMPLE_INTERFACE_PACKAGE_ID="urn:wtlab:ca-client-tools:openamsm-sbi-interface";
export const EXAMPLE_INTERFACE_SOURCE=Object.freeze({
  repository:"odango-chan/ca-client-tools",
  tag:"v1.1.0",asset:EXAMPLE_INTERFACE_ARCHIVE
});
const decoder=new TextDecoder("utf-8",{fatal:true});

export async function prepareExampleInterfaceDependency(encodedResource){
  if(!(encodedResource instanceof Uint8Array)||
     encodedResource.byteLength>8192)
    throw Error("Bundled Example Interface Package resource missing or overlong");
  const base64=decoder.decode(encodedResource).trim();
  const archive=decodeBase64(base64);
  if(archive.length!==4289||base64!==btoa(String.fromCharCode(...archive)))
    throw Error("Bundled Example Interface Package encoding differs from the release");
  if(await sha256(archive)!==EXAMPLE_INTERFACE_DIGEST)
    throw Error("Bundled Example Interface Package SHA-256 does not match v1.1.0");
  const decoded=await decodeInterfacePackageZip(archive);
  const m=decoded.manifest;
  if(m.apiVersion!=="connectionagent.io/interface-package/v1alpha1"||
     m.languageTarget!=="connectionagent.io/v1alpha5"||
     m.packageId!==EXAMPLE_INTERFACE_PACKAGE_ID||
     m.version!=="1.1.0"||decoded.files.length!==7||m.exports.length!==17)
    throw Error("Bundled Example Interface Package identity/exports differ from v1.1.0");
  const snap=await calculateSnapshot(decoded.files);
  const declaration={
    id:EXAMPLE_INTERFACE_ALIAS,
    kind:"interface-package",
    source:{
      type:"interface-zip",upload:EXAMPLE_INTERFACE_ARCHIVE,
      contentDigest:EXAMPLE_INTERFACE_DIGEST,
      packageId:m.packageId,version:m.version,publisher:m.publisher,
      origin:{...EXAMPLE_INTERFACE_SOURCE,sha256:EXAMPLE_INTERFACE_DIGEST},
      bundledExample:true
    }
  };
  const lock={
    ...declaration,snapshotDigest:snap.snapshotDigest,files:snap.files
  };
  const settings={
    skillsRoot:"skills",
    dependencies:[declaration],
    dependencyLock:{version:"skillc.lock/v0.1",entries:[lock]}
  };
  validateProjectConfiguration(settings);
  return {declaration,lock,files:decoded.files,settings,snapshotDigest:snap.snapshotDigest};
}

export function exampleWorkspaceSettingsContent(prepared){
  if(!prepared?.settings||!prepared?.lock)
    throw Error("Example Interface Package must be prepared and verified before seeding");
  const config={
    "connectionAgent.skillStudio.skillsRoot":"skills",
    "connectionAgent.skillStudio.dependencies":prepared.settings.dependencies,
    "connectionAgent.skillStudio.dependencyLock":prepared.settings.dependencyLock
  };
  return new TextEncoder().encode(JSON.stringify(config,null,2)+"\n");
}
