import test from "node:test";
import assert from "node:assert/strict";
import {acquireBuiltin,acquireUpload} from "../vscode/src/contract-acquisition.mjs";
import {applyDependency,refreshDependency,removeDependency,resolveLockedDependencies}
  from "../vscode/src/dependency-service.mjs";
import {zipPackage} from "../../../site/zip.mjs";
import {sha256} from "../vscode/src/dependency-snapshot.mjs";
import {decodeInterfacePackageZip} from "../vscode/src/interface-package-zip.mjs";
import {projectLockedInterfaceCompletionHints}
  from "../vscode/src/interface-schema-completion.mjs";
import {schemaArgumentCompletions}
  from "../../../language/schema-argument-completions.mjs";
const uri=path=>({path,toString(){return "file://"+path;}});
function host(){
  const root=uri("/workspace"),files=new Map(),dirs=new Set(["/workspace"]);
  const updates=[],values={
    skillsRoot:"skills",dependencies:[],
    dependencyLock:{version:"skillc.lock/v0.1",entries:[]},
    defaultBuildTarget:"all"
  };
  let failLockWrite=false;
  const joinPath=(root,...parts)=>uri([root.path,...parts].join("/"));
  const vscode={
    Uri:{joinPath},
    ConfigurationTarget:{WorkspaceFolder:6},
    workspace:{
      workspaceFolders:[{uri:root,name:"workspace"}],
      getConfiguration(_section,_resource){
        return {get(name,fallback){return values[name]??fallback;},
          async update(name,value,target){
            assert.equal(target,6);
            if(failLockWrite&&name==="dependencyLock")throw Error("disk full");
            values[name]=value;updates.push(name);
          }};
      },
      fs:{
        async stat(target){
          if(files.has(target.path)||dirs.has(target.path))return {type:1};
          throw Object.assign(Error("missing"),{code:"FileNotFound"});
        },
        async createDirectory(target){dirs.add(target.path);},
        async readFile(target){
          if(!files.has(target.path))
            throw Object.assign(Error("missing"),{code:"FileNotFound"});
          return new Uint8Array(files.get(target.path));
        },
        async writeFile(target,bytes){files.set(target.path,new Uint8Array(bytes));},
        async rename(from,to,{overwrite}={}){
          assert.equal(overwrite,false);
          if([...files.keys()].some(key=>key.startsWith(to.path+"/")))
            throw Error("destination exists");
          for(const [name,bytes] of [...files]){
            if(name.startsWith(from.path+"/")){
              files.delete(name);files.set(to.path+name.slice(from.path.length),bytes);
            }
          }
          for(const name of [...dirs]){
            if(name===from.path||name.startsWith(from.path+"/")){
              dirs.delete(name);dirs.add(to.path+name.slice(from.path.length));
            }
          }
        },
        async delete(target){for(const key of [...files.keys()])
          if(key.startsWith(target.path+"/"))files.delete(key);}
      }
    }
  };
  return {vscode,root,values,updates,files,
    setFailLockWrite(value){failLockWrite=value;}};
}
test("pinned built-in snapshot persists, reloads and is verified byte for byte",async()=>{
  const h=host(),acquired=await acquireBuiltin({
    bundleId:"studio-example-toolcatalog",version:"1.0.0"});
  assert.equal((await resolveLockedDependencies(h.vscode,h.root)).status,"READY");
  await assert.rejects(applyDependency(h.vscode,h.root,"example",acquired,
    {confirm:async()=>false}),/confirmation required/);
  const ready=await applyDependency(h.vscode,h.root,"example",acquired,
    {confirm:async()=>true});
  assert.equal(ready.status,"READY");
  assert.equal(ready.snapshots.length,1);
  assert.equal(h.values.dependencies.length,1);
  assert.equal(h.values.dependencyLock.entries.length,1);
  assert.equal((await resolveLockedDependencies(h.vscode,h.root)).status,"READY");
  const digest=h.values.dependencyLock.entries[0].snapshotDigest.slice(7);
  const file="/workspace/.skill-studio/dependencies/"+digest+"/tool-catalog.yaml";
  assert.ok(h.files.has(file));
  h.files.set(file,new TextEncoder().encode("tampered"));
  const error=await resolveLockedDependencies(h.vscode,h.root);
  assert.equal(error.status,"ERROR");
  assert.equal(error.diagnostics[0].code,"LOCKED_SNAPSHOT_CORRUPT");
  h.files.delete(file);
  const missing=await resolveLockedDependencies(h.vscode,h.root);
  assert.equal(missing.status,"BLOCKED");
  assert.equal(missing.diagnostics[0].code,"LOCKED_SNAPSHOT_MISSING");
});
test("immutable snapshot reads retry transient OPFS missing-entry results when stat confirms the file exists",async()=>{
  for(const code of ["FileNotFound","EntryNotFound"]){
    const h=host(),acquired=await acquireBuiltin({
      bundleId:"studio-example-toolcatalog",version:"1.0.0"});
    const fs=h.vscode.workspace.fs;
    const originalReadFile=fs.readFile.bind(fs);
    let injected=false,injectedPath=null;
    fs.readFile=async target=>{
      if(!injected&&target.path.startsWith("/workspace/.skill-studio/dependencies/")){
        injected=true;injectedPath=target.path;
        throw Object.assign(Error("transient OPFS missing-entry immediately after snapshot publish"),
          {code});
      }
      return originalReadFile(target);
    };
    const ready=await applyDependency(h.vscode,h.root,"example",acquired,
      {confirm:async()=>true});
    assert.equal(injected,true,code+" must be injected during post-rename snapshot verification");
    assert.ok(injectedPath.includes("/.skill-studio/dependencies/"));
    assert.equal(ready.status,"READY",code+" must be retried only after stat confirms the file");
    assert.equal((await resolveLockedDependencies(h.vscode,h.root)).status,"READY");
  }
});

test("Refresh is observation-only; Update Lock requires confirmation",async()=>{
  const h=host(),initial=await acquireBuiltin({
    bundleId:"studio-example-toolcatalog",version:"1.0.0"});
  await applyDependency(h.vscode,h.root,"example",initial,{confirm:async()=>true});
  const old=JSON.stringify(h.values.dependencyLock);
  const before=h.updates.length;
  const probe=await refreshDependency(h.vscode,h.root,"example",async()=>initial);
  assert.equal(probe.status,"READY");assert.equal(probe.changed,false);
  assert.equal(h.updates.length,before);
  assert.equal(JSON.stringify(h.values.dependencyLock),old);
  assert.equal((await removeDependency(h.vscode,h.root,"example",
    {confirm:async()=>false}).catch(()=>({status:"refused"}))).status,"refused");
  assert.equal(h.values.dependencies.length,1);
  const cleaned=await removeDependency(h.vscode,h.root,"example",
    {confirm:async()=>true});
  assert.equal(cleaned.status,"READY");
  assert.equal(h.values.dependencies.length,0);
  assert.equal(h.values.dependencyLock.entries.length,0);
});
test("config pair failure is UNCERTAIN, never READY",async()=>{
  const h=host(),initial=await acquireBuiltin({
    bundleId:"studio-example-toolcatalog",version:"1.0.0"});
  h.setFailLockWrite(true);
  await assert.rejects(applyDependency(h.vscode,h.root,"example",initial,
    {confirm:async()=>true}),/UNCERTAIN/);
  assert.equal((await resolveLockedDependencies(h.vscode,h.root)).status,"BLOCKED");
});

test("Upload Refresh observes drift but never mutates existing Lock",async()=>{
  const h=host(),encoder=new TextEncoder();
  const input=a=>encoder.encode(JSON.stringify({
    apiVersion:"connectionagent.io/toolcatalog/v1alpha4",
    kind:"ToolCatalog",
    metadata:{owner:"example-unqualified-owner"},
    spec:{contracts:[{
      id:a,kind:"operation",effect:"READ",
      inputSchema:{"$ref":"#/schemas/input"},
      outputSchema:{"$ref":"#/schemas/output"},
      ownerOutcomes:["SUCCEEDED","FAILED"]
    }]}
  }));
  const initial=await acquireUpload({upload:"uploaded-tools",format:"json",
    rawBytes:input("alpha")});
  const changed=await acquireUpload({upload:"uploaded-tools",format:"json",
    rawBytes:input("beta")});
  await applyDependency(h.vscode,h.root,"uploaded",initial,{confirm:async()=>true});
  const previous=JSON.stringify(h.values.dependencyLock),count=h.updates.length;
  const inspected=await refreshDependency(h.vscode,h.root,"uploaded",async()=>changed);
  assert.equal(inspected.status,"READY");
  assert.equal(inspected.changed,true);
  assert.notEqual(inspected.candidateLock.snapshotDigest,
    h.values.dependencyLock.entries[0].snapshotDigest);
  assert.equal(JSON.stringify(h.values.dependencyLock),previous);
  assert.equal(h.updates.length,count);
  await applyDependency(h.vscode,h.root,"uploaded",changed,{confirm:async()=>true});
  assert.equal((await resolveLockedDependencies(h.vscode,h.root)).status,"READY");
  assert.notEqual(JSON.stringify(h.values.dependencyLock),previous);
});


test("published-style ZIP → explicit lock → reload → live Tool Schema argument hints",async()=>{
  const h=host(),enc=new TextEncoder();
  const inputId="urn:wtlab:locked:query:v1",outputId="urn:wtlab:locked:result:v1";
  const input=JSON.stringify({
    $schema:"https://json-schema.org/draft/2020-12/schema",
    $id:inputId,type:"object",required:["supi","pduSessionId"],
    properties:{
      supi:{type:"string",description:"3GPP subscriber identity"},
      pduSessionId:{type:"integer",description:"PDU Session identifier"},
      view:{type:"string",enum:["SUMMARY","FULL"]}
    }
  });
  const result=JSON.stringify({
    $schema:"https://json-schema.org/draft/2020-12/schema",
    $id:outputId,type:"object",properties:{status:{type:"string"}}
  });
  const catalog=[
    "apiVersion: connectionagent.io/toolcatalog/v1alpha4",
    "kind: ToolCatalog",
    "metadata:",
    "  owner: wtlab",
    "spec:",
    "  contracts:",
    "    - id: context.smf.session.read",
    "      kind: observation",
    "      effect: READ",
    "      queryContextSchema:",
    "        $ref: "+inputId,
    "      outputSchema:",
    "        $ref: "+outputId,
    "      ownerOutcomes: [SUCCEEDED, FAILED]",
    ""
  ].join("\n");
  const entries=[
    {path:"schemas/input.schema.json",text:input},
    {path:"schemas/result.schema.json",text:result},
    {path:"tool-catalog.yaml",text:catalog}
  ];
  const files=await Promise.all(entries.map(async f=>({
    path:f.path,sha256:await sha256(enc.encode(f.text))
  })));
  const manifest={
    apiVersion:"connectionagent.io/interface-package/v1alpha1",
    packageId:"urn:wtlab:interface:read",version:"1.0.0",
    publisher:"wtlab",languageTarget:"connectionagent.io/v1alpha5",
    dependencies:[],files,exports:[
      {kind:"Schema",id:inputId,path:"schemas/input.schema.json"},
      {kind:"Schema",id:outputId,path:"schemas/result.schema.json"},
      {kind:"CallableCatalog",id:"context.smf.session.read",path:"tool-catalog.yaml"}
    ]
  };
  const archive=zipPackage([{path:"package.json",text:JSON.stringify(manifest)},...entries]);
  const imported=await decodeInterfacePackageZip(archive);
  const acquired={
    kind:"interface-package",
    source:{type:"interface-zip",upload:"read-interface.zip",
      contentDigest:await sha256(archive),packageId:manifest.packageId,
      version:manifest.version,publisher:manifest.publisher},
    files:imported.files
  };
  await assert.rejects(()=>applyDependency(h.vscode,h.root,"ca-client",acquired,
    {confirm:async()=>false}),/confirmation required/);
  assert.equal(h.values.dependencies.length,0);
  assert.equal(h.files.size,0);
  const pinned=await applyDependency(h.vscode,h.root,"ca-client",acquired,
    {confirm:async()=>true});
  assert.equal(pinned.status,"READY");
  assert.equal(h.values.dependencies[0].kind,"interface-package");
  assert.equal(h.values.dependencyLock.entries.length,1);
  const reloaded=await resolveLockedDependencies(h.vscode,h.root);
  assert.equal(reloaded.status,"READY");
  assert.equal(reloaded.snapshots.length,1);
  const hints=projectLockedInterfaceCompletionHints(reloaded.snapshots[0]);
  assert.equal(hints.length,1);
  assert.equal(hints[0].id,"ca-client::context.smf.session.read");
  const source=[
    "start: read","nodes:","  read:","    observation:",
    "      tool: ca-client::context.smf.session.read",
    "      arguments:","        ","      routes:","        FAILED: FAILED",""
  ].join("\n");
  const offset=source.indexOf("      arguments:\n")+"      arguments:\n        ".length;
  const lineStart=source.lastIndexOf("\n",offset-1)+1;
  const options=schemaArgumentCompletions(
    {completeness:"complete",schemaCompletionHints:hints},
    {relativePath:"assurance/procedure.yaml",text:source},
    "        ",offset,lineStart,6
  );
  assert.deepEqual(options.map(x=>x.label),["pduSessionId","supi","view"]);
  assert.ok(options[0].detail.includes("AUTH_NOT_CHECKED"));
  const oldLock=JSON.stringify(h.values.dependencyLock);
  const before=h.updates.length;
  const refresh=await refreshDependency(h.vscode,h.root,"ca-client",
    async()=>acquired);
  assert.equal(refresh.changed,false);
  assert.equal(JSON.stringify(h.values.dependencyLock),oldLock);
  assert.equal(h.updates.length,before);
  // Tampering changes the locked file bytes, never silently reopens the
  // original release or turns its old completion hints into qualified truth.
  const digest=h.values.dependencyLock.entries[0].snapshotDigest.slice(7);
  const schemaPath="/workspace/.skill-studio/dependencies/"+digest+
    "/schemas/input.schema.json";
  assert.ok(h.files.has(schemaPath));
  h.files.set(schemaPath,enc.encode('{"type":"string"}'));
  const corrupt=await resolveLockedDependencies(h.vscode,h.root);
  assert.equal(corrupt.status,"ERROR");
  assert.equal(corrupt.snapshots.length,0);
  assert.equal(corrupt.diagnostics[0].code,"LOCKED_SNAPSHOT_CORRUPT");
});
