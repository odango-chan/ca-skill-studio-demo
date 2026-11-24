// BuildRequest adapter for the released CA Skill Compiler v2.0.2 / CA-SL v1alpha5.
// This module only serializes authored Skill bytes. It never translates legacy
// syntax or manufactures Dependency / Owner / Capability trust metadata.
export const COMPILER_VERSION = "v2.0.2";
export const COMPILER_API_VERSION = "connectionagent.io/compiler-build-request/v1alpha5";
export const COMPILER_LANGUAGE_TARGET = "connectionagent.io/v1alpha5";
export const COMPILER_BUILD_RESULT_VERSION = "connectionagent.io/compiler-build-result/v1alpha5";
export const COMPILER_INSPECTION_VERSION = "connectionagent.io/compiler-dependency-inspection/v1alpha5";

/** Refuse a language target that the pinned Compiler release does not own. */
export function assertCompilerLanguageTarget(languageTarget) {
  if(languageTarget!==COMPILER_LANGUAGE_TARGET){
    throw new Error("Compiler "+COMPILER_VERSION+" supports only "+COMPILER_LANGUAGE_TARGET+
      "; refusing language target "+String(languageTarget));
  }
  return languageTarget;
}

const TEXT_SOURCE = /\.(?:ya?ml|json|py|md|txt|sh|toml|xml|csv|jsonl|ini|cfg|js|ts|mjs|cjs)$/i;
const PACKAGE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const encoder = new TextEncoder();

export function isCompilerTextSource(path) {
  return typeof path === "string" && TEXT_SOURCE.test(path);
}

function encodeBase64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

function compareUtf8(left, right) {
  const a = encoder.encode(left), b = encoder.encode(right);
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

function validateRelativePath(path) {
  if (typeof path !== "string" || !path || encoder.encode(path).byteLength > 200 ||
      path !== path.normalize("NFC") || path.includes("\\") ||
      path.includes(":") || path.includes(String.fromCharCode(0)) ||
      path.startsWith("/") ||
      path.split("/").some(part => !part || part === "." || part === "..")) {
    throw new Error("Invalid or unsafe Skill-relative source path: " + String(path));
  }
  return path;
}

/**
 * Construct the exact v1alpha5 transport envelope from a complete Package.
 * Compiler Source includes authored Skill files only; Package-local Studio
 * scenario tests are editor-only sidecars and MUST NOT enter BuildRequest.
 * The caller must provide independently authenticated dependency/Owner inputs;
 * this adapter never manufactures trust from local source or lock metadata.
 */
/**
 * Create the shared, bounded Skill source-file projection. Both frozen
 * v1alpha5 BuildRequest and v2.1.0 Development Build use the same exact
 * source paths and UTF-8 bytes; only their dependency/link contracts differ.
 */
export function createCompilerSourceFiles({packageName,documents}={}){
  if(typeof packageName!=="string"||!PACKAGE_NAME.test(packageName))
    throw new Error("Skill Package name is not a valid v1alpha5 target");
  if(!Array.isArray(documents)||!documents.length)
    throw new Error("A complete Skill source snapshot is required");
  const seen=new Set(),files=[];
  let totalBytes=0;
  for(const document of documents){
    if(typeof document?.relativePath==="string"&&
       /^tests\/[^/]+\.route-scenario\.json$/i.test(document.relativePath))continue;
    if(!isCompilerTextSource(document?.relativePath))continue;
    const relativePath=validateRelativePath(document.relativePath);
    if(typeof document.text!=="string")
      throw new Error("Skill source is not valid UTF-8 text: "+relativePath);
    const path="skills/"+packageName+"/"+relativePath;
    if(encoder.encode(path).byteLength>240||seen.has(path))
      throw new Error("Duplicate or overlong Compiler source path: "+path);
    seen.add(path);
    const bytes=encoder.encode(document.text);
    if(bytes.byteLength>1024*1024)
      throw new Error("Skill source exceeds the Studio 1 MiB file limit: "+relativePath);
    totalBytes+=bytes.byteLength;
    if(totalBytes>4*1024*1024||files.length>=512)
      throw new Error("Skill source exceeds the bounded Studio Compiler snapshot limit");
    files.push({path,bytes:encodeBase64(bytes)});
  }
  if(!files.length)throw new Error("No supported text source files were found in this Skill");
  files.sort((a,b)=>compareUtf8(a.path,b.path));
  return files;
}

export function createCompilerBuildRequest({
  packageName,
  documents,
  resolvedDependencies=[],
  trustedBuildContext
}={}){
  if(!Array.isArray(resolvedDependencies))
    throw new Error("resolvedDependencies must be an array");
  const files=createCompilerSourceFiles({packageName,documents});
  return {
    apiVersion:COMPILER_API_VERSION,
    languageTarget:COMPILER_LANGUAGE_TARGET,
    files,
    resolvedDependencies:[...resolvedDependencies],
    targets:[packageName],
    ...(trustedBuildContext===undefined?{}:{trustedBuildContext})
  };
}

/**
 * Compiler v2 artifact projection: one root manifest and only the selected
 * Skill's compiled output directory. These paths remain read-only and are
 * not re-admitted as source on a later BuildRequest.
 */
export function compilerArtifactRelativePath(packageName,path){
  const prefix="skills/"+packageName+"/compiled/";
  if(!PACKAGE_NAME.test(packageName??"")||
     typeof path!=="string"||encoder.encode(path).length>240||
     path!==path.normalize("NFC")||
     path.includes("\\")||path.includes(":")||
     /[\u0000-\u001f\u007f]/.test(path))
    throw new Error("Invalid Compiler v2 Artifact path");
  if(path==="manifest.json")return "manifest.json";
  if(!path.startsWith(prefix))throw new Error("Compiler Artifact is outside the selected compiled Skill");
  const relative=path.slice(("skills/"+packageName+"/").length);
  if(!relative||relative.split("/").some(segment=>!segment||segment==="."||segment===".."))
    throw new Error("Unsafe Compiler v2 Artifact path");
  return relative;
}

export function isCompilerBuildResult(value) {
  return value !== null && typeof value === "object" &&
    value.apiVersion === COMPILER_BUILD_RESULT_VERSION &&
    typeof value.success === "boolean" &&
    Array.isArray(value.diagnostics) &&
    Array.isArray(value.dependencyClosure) &&
    Array.isArray(value.outputFiles);
}

export function isCompilerInspection(value) {
  return value !== null && typeof value === "object" &&
    value.apiVersion === COMPILER_INSPECTION_VERSION &&
    Array.isArray(value.diagnostics) &&
    Array.isArray(value.callables) &&
    Array.isArray(value.schemas);
}
