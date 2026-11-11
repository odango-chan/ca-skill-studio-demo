// Compiler v0.1 Host Adapter: assemble exact BuildRequest/ProjectContext.
// No parser, linker, schema generator, Python or Tool execution lives here.
import {base64Bytes,canonicalJson,sha256,validateSnapshotPath}
  from "./dependency-snapshot.mjs";
import {readProjectConfiguration} from "./project-configuration.mjs";
import {resolveLockedDependencies} from "./dependency-service.mjs";
const enc=new TextEncoder();
function compareUtf8(a,b){
  const x=enc.encode(a),y=enc.encode(b);
  for(let i=0;i<Math.min(x.length,y.length);i++)
    if(x[i]!==y[i])return x[i]-y[i];
  return x.length-y.length;
}
function sortPayload(files,deps){
  const sourceFiles=[...files].sort((a,b)=>compareUtf8(a.path,b.path));
  const resolvedDependencies=[...deps].sort((a,b)=>compareUtf8(a.id,b.id))
    .map(dep=>({...dep,files:[...dep.files].sort((a,b)=>compareUtf8(a.path,b.path))}));
  return {sourceFiles,resolvedDependencies};
}
export async function collectProjectSource(vscode,root){
  const base=vscode.Uri.joinPath(root,"skills");
  const uris=await vscode.workspace.findFiles(
    new vscode.RelativePattern(base,"**/*"),"**/{node_modules,.git}/**",513);
  if(uris.length>512)throw Error("Compiler v0.1 source limit exceeded (512 files)");
  const open=new Map((vscode.workspace.textDocuments??[]).map(doc=>
    [doc.uri.toString(),doc]));
  const records=new Map();
  let total=0;
  for(const uri of uris){
    if(uri.scheme!==root.scheme||uri.authority!==root.authority||
       !uri.path.startsWith(base.path.replace(/\/$/,"")+"/"))
      throw Error("Project source escaped selected root");
    const path="skills/"+uri.path.slice(base.path.length).replace(/^\//,"");
    validateSnapshotPath(path);
    if(records.has(path))throw Error("Duplicate Skill source path");
    const doc=open.get(uri.toString());
    const bytes=doc?enc.encode(doc.getText()):await vscode.workspace.fs.readFile(uri);
    if(bytes.length>2097152)throw Error("Compiler v0.1 source file exceeds 2 MiB");
    total+=bytes.length;
    if(total>16777216)throw Error("Compiler v0.1 source exceeds 16 MiB");
    records.set(path,{path,bytes:base64Bytes(bytes)});
  }
  // Unsaved new documents still contribute to the source snapshot.
  for(const doc of open.values()){
    const uri=doc.uri;
    if(uri.scheme!==base.scheme||uri.authority!==base.authority||
       !uri.path.startsWith(base.path.replace(/\/$/,"")+"/"))continue;
    const path="skills/"+uri.path.slice(base.path.length).replace(/^\//,"");
    if(records.has(path))continue;
    validateSnapshotPath(path);
    const bytes=enc.encode(doc.getText());
    if(bytes.length>2097152)throw Error("Open Source exceeds Compiler file limit");
    total+=bytes.length;
    if(total>16777216||records.size>=512)throw Error("Compiler source limit exceeded");
    records.set(path,{path,bytes:base64Bytes(bytes)});
  }
  if(!records.size)throw Error("No authored files under selected skills/ directory");
  return [...records.values()].sort((a,b)=>compareUtf8(a.path,b.path));
}
export async function assembleProjectContext(vscode,selectedRoot,revision){
  const project=readProjectConfiguration(vscode,selectedRoot);
  const resolved=await resolveLockedDependencies(vscode,project.workspaceRoot);
  if(resolved.status!=="READY")
    throw Error("Compiler BLOCKED: locked dependencies "+resolved.status+
      " · "+resolved.diagnostics.map(x=>x.code).join(", "));
  const sourceFiles=await collectProjectSource(vscode,project.workspaceRoot);
  const payload=sortPayload(sourceFiles,resolved.snapshots);
  const framed=new Uint8Array([
    ...enc.encode("skillc/context/v1"),0,...enc.encode(canonicalJson(payload))
  ]);
  const snapshotIdentity=await sha256(framed);
  return {apiVersion:"skillc.project-context/v0.1",
    workspaceRoot:project.workspaceRoot.toString(),
    configurationRevision:String(revision),
    snapshotIdentity,...payload};
}
export function buildRequestFromContext(context,targets=[]){
  if(context?.apiVersion!=="skillc.project-context/v0.1")
    throw Error("Only Compiler v0.1 ProjectContext is accepted");
  if(!Array.isArray(targets)||targets.some(t=>
    !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(t)))
    throw Error("Invalid Compiler targets");
  return {apiVersion:"skillc.build/v0.1",
    sourceFiles:context.sourceFiles,
    resolvedDependencies:context.resolvedDependencies,
    ...(targets.length?{targets}:{})};
}
export function createCompilerAdapter({invoke}={}){
  const available=typeof invoke==="function";
  return {
    available,
    async check(context,targets=[]){
      if(!available)return {status:"UNAVAILABLE",
        reason:"Compiler skillc.build/v0.1 Go/WASM ABI is not installed"};
      return invoke("check",buildRequestFromContext(context,targets));
    },
    async build(context,targets=[]){
      if(!available)return {status:"UNAVAILABLE",
        reason:"Compiler skillc.build/v0.1 Go/WASM ABI is not installed"};
      return invoke("build",buildRequestFromContext(context,targets));
    }
  };
}
