import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {selectProjectFolder,readProjectConfiguration,updateProjectConfiguration,
  validateProjectConfiguration,CONFIG_NAMESPACE,watchProjectConfiguration}
  from "../vscode/src/project-configuration.mjs";
const manifest=JSON.parse(readFileSync("experiments/ide-host/vscode/package.json","utf8"));
const path=p=>({path:p,toString(){return "file://"+p;}});
function host(roots=[path("/workspace/a"),path("/workspace/b")]){
  const configs=new Map(),writes=[],listeners=[];
  const defaults={
    skillsRoot:"skills",dependencies:[],
    dependencyLock:{version:"skillc.lock/v0.1",entries:[]},
    defaultBuildTarget:"all"
  };
  const vscode={
    ConfigurationTarget:{WorkspaceFolder:5},
    workspace:{
      workspaceFolders:roots.map(uri=>({uri,name:uri.path.split("/").at(-1)})),
      getConfiguration(section,uri){
        assert.equal(section,CONFIG_NAMESPACE);
        const key=uri?.toString?.()??"user";
        if(!configs.has(key))configs.set(key,{...defaults});
        return {
          get(name,fallback){return configs.get(key)[name]??fallback;},
          async update(name,value,target){
            assert.equal(target,vscode.ConfigurationTarget.WorkspaceFolder);
            assert.ok(uri,"a workspace folder resource is mandatory");
            writes.push({key,name,value,target});
            configs.get(key)[name]=value;
          }
        };
      },
      onDidChangeConfiguration(listener){listeners.push(listener);return {dispose(){}};}
    }
  };
  return {vscode,writes,configs,listeners};
}
test("extension contributes exactly the four native settings with correct scopes",()=>{
  const props=manifest.contributes.configuration.properties;
  assert.deepEqual(Object.keys(props).sort(),[
    "connectionAgent.skillStudio.skillsRoot","connectionAgent.skillStudio.dependencies",
    "connectionAgent.skillStudio.dependencyLock",
    "connectionAgent.skillStudio.defaultBuildTarget"].sort());
  assert.equal(props["connectionAgent.skillStudio.defaultBuildTarget"].scope,"application");
  for(const key of ["skillsRoot","dependencies","dependencyLock"])
    assert.equal(props["connectionAgent.skillStudio."+key].scope,"resource");
});
test("multi-root requires explicit selected project",()=>{
  const h=host();
  assert.throws(()=>selectProjectFolder(h.vscode),/multi-root/);
  assert.throws(()=>readProjectConfiguration(h.vscode,path("/workspace/other")),/not an open/);
  assert.equal(readProjectConfiguration(h.vscode,path("/workspace/a")).settings.skillsRoot,"skills");
});
test("workspace writes do not leak to another root or User settings",async()=>{
  const h=host(),a=path("/workspace/a"),b=path("/workspace/b");
  const dependencies=[{id:"tools-a",kind:"tool-catalog",source:{
    type:"builtin",bundleId:"example-tools",version:"1.0"}}];
  await updateProjectConfiguration(h.vscode,a,"dependencies",dependencies);
  assert.deepEqual(readProjectConfiguration(h.vscode,a).settings.dependencies,dependencies);
  assert.deepEqual(readProjectConfiguration(h.vscode,b).settings.dependencies,[]);
  assert.deepEqual(h.writes.map(w=>w.key),["file:///workspace/a"]);
  assert.equal(h.configs.has("user"),true);
  assert.equal(h.configs.get("user").dependencies.length,0);
});
test("invalid config fails closed, missing WorkspaceFolder API cannot fall back",async()=>{
  const h=host([path("/workspace/a")]);
  const a=path("/workspace/a");
  assert.throws(()=>validateProjectConfiguration({skillsRoot:"lib",dependencies:[],dependencyLock:{
    version:"skillc.lock/v0.1",entries:[]}}),/skillsRoot/);
  await assert.rejects(updateProjectConfiguration(h.vscode,a,"dependencies",[
    {id:"x",kind:"tool-catalog",source:{type:"builtin"}},
    {id:"x",kind:"tool-catalog",source:{type:"builtin"}}
  ]),/duplicated/);
  delete h.vscode.ConfigurationTarget.WorkspaceFolder;
  await assert.rejects(updateProjectConfiguration(h.vscode,a,"dependencyLock",{
    version:"skillc.lock/v0.1",entries:[]
  }),/unavailable/);
  assert.equal(h.writes.length,0);
});
test("native configuration-change listener invalidates registered projections",()=>{
  const h=host([path("/workspace/a")]);
  let calls=0;
  watchProjectConfiguration(h.vscode,()=>calls++);
  const event={affectsConfiguration:key=>key==="connectionAgent.skillStudio.dependencyLock"};
  for(const listener of h.listeners)listener(event);
  assert.equal(calls,1);
});
