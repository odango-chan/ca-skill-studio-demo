// Host-native project configuration. The Compiler v0.1 Project Settings schema
// is the wire authority; this module owns only VS Code resource scoping.
export const CONFIG_NAMESPACE = "connectionAgent.skillStudio";
export const PROJECT_SCHEMA_VERSION = "skillc.project/v0.1";
export const EMPTY_DEPENDENCY_LOCK = Object.freeze({version:"skillc.lock/v0.1",entries:[]});
const identifier=/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const fail=(message)=>{throw Error("Skill Studio project configuration: "+message);};
const isRecord=value=>value!==null&&typeof value==="object"&&!Array.isArray(value);
const sameUri=(a,b)=>a?.toString?.()===b?.toString?.();

export function selectProjectFolder(vscode, selectedUri) {
  const folders=vscode.workspace?.workspaceFolders??[];
  if(!folders.length)fail("open a workspace folder first");
  if(selectedUri){
    const found=folders.find(folder=>sameUri(folder.uri,selectedUri));
    if(!found)fail("selected project root is not an open workspace folder");
    return found;
  }
  if(folders.length!==1)
    fail("multi-root workspace requires explicit project root selection");
  return folders[0];
}

export function validateProjectConfiguration(settings) {
  // Structural host-side guard, not a replacement Compiler parser or schema.
  if(!isRecord(settings)||settings.skillsRoot!=="skills")
    fail("skillsRoot must be skills in compiler v0.1");
  if(!Array.isArray(settings.dependencies)||settings.dependencies.length>256)
    fail("dependencies must be a bounded array");
  if(!isRecord(settings.dependencyLock)||
     settings.dependencyLock.version!=="skillc.lock/v0.1"||
     !Array.isArray(settings.dependencyLock.entries)||
     settings.dependencyLock.entries.length>256)
    fail("dependencyLock must be a skillc.lock/v0.1 object");
  const ids=new Set();
  for(const dep of settings.dependencies){
    if(!isRecord(dep)||typeof dep.id!=="string"||
       dep.id.length>80||!identifier.test(dep.id)||ids.has(dep.id)||
       !["tool-catalog","schema-bundle"].includes(dep.kind)||
       !isRecord(dep.source))
      fail("invalid or duplicated dependency declaration");
    ids.add(dep.id);
  }
  const locked=new Set();
  for(const entry of settings.dependencyLock.entries){
    if(!isRecord(entry)||!ids.has(entry.id)||locked.has(entry.id)||
       !/^sha256:[a-f0-9]{64}$/.test(entry.snapshotDigest??""))
      fail("lock entry must match one declared dependency with a SHA-256 digest");
    const declaration=settings.dependencies.find(dep=>dep.id===entry.id);
    if(entry.kind!==declaration.kind||
       JSON.stringify(entry.source)!==JSON.stringify(declaration.source))
      fail("lock entry source and kind must equal declaration");
    locked.add(entry.id);
  }
  return settings;
}

export function readProjectConfiguration(vscode,selectedUri) {
  const folder=selectProjectFolder(vscode,selectedUri);
  const config=vscode.workspace.getConfiguration(CONFIG_NAMESPACE,folder.uri);
  const settings=validateProjectConfiguration({
    schemaVersion:PROJECT_SCHEMA_VERSION,
    skillsRoot:config.get("skillsRoot","skills"),
    dependencies:config.get("dependencies",[]),
    dependencyLock:config.get("dependencyLock",{version:"skillc.lock/v0.1",entries:[]})
  });
  return {workspaceRoot:folder.uri,folder,settings,
    defaultBuildTarget:vscode.workspace.getConfiguration(CONFIG_NAMESPACE)
      .get("defaultBuildTarget","all")};
}

export async function updateProjectConfiguration(vscode,selectedUri,key,value) {
  if(!["dependencies","dependencyLock"].includes(key))
    fail("only Dependency Service may update managed project configuration");
  const current=readProjectConfiguration(vscode,selectedUri);
  const next={...current.settings,[key]:value};
  validateProjectConfiguration(next);
  if(vscode.ConfigurationTarget?.WorkspaceFolder===undefined)
    fail("workspace-folder configuration writes are unavailable in this host");
  const config=vscode.workspace.getConfiguration(CONFIG_NAMESPACE,current.workspaceRoot);
  await config.update(key,value,vscode.ConfigurationTarget.WorkspaceFolder);
  return readProjectConfiguration(vscode,current.workspaceRoot);
}

export function watchProjectConfiguration(vscode,onChange) {
  return vscode.workspace.onDidChangeConfiguration(event=>{
    if(["skillsRoot","dependencies","dependencyLock"].some(key=>
      event.affectsConfiguration(CONFIG_NAMESPACE+"."+key)))
      onChange();
  });
}


export async function writeDependencySettingsPair(vscode,selectedUri,dependencies,dependencyLock){
  const current=readProjectConfiguration(vscode,selectedUri);
  // Validate the complete desired pair; intermediate host writes are explicitly
  // not interpreted as a validated project during an update.
  validateProjectConfiguration({...current.settings,dependencies,dependencyLock});
  if(vscode.ConfigurationTarget?.WorkspaceFolder===undefined)
    fail("workspace-folder configuration writes are unavailable in this host");
  const config=vscode.workspace.getConfiguration(CONFIG_NAMESPACE,current.workspaceRoot);
  try{
    await config.update("dependencies",dependencies,vscode.ConfigurationTarget.WorkspaceFolder);
    await config.update("dependencyLock",dependencyLock,vscode.ConfigurationTarget.WorkspaceFolder);
  }catch(error){
    fail("UNCERTAIN: multi-setting transaction was not atomic: "+
      String(error?.message??error));
  }
  return readProjectConfiguration(vscode,current.workspaceRoot);
}
