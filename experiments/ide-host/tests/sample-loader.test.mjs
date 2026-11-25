import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {posix} from "node:path";
import {seedExampleProject,ensureOpenedExampleDependencies}
  from "../vscode/src/sample-loader.mjs";
import {loadVerifiedSnapshot} from "../vscode/src/dependency-service.mjs";
import {projectLockedInterfaceCompletionHints}
  from "../vscode/src/interface-schema-completion.mjs";
import {projectLockedToolCatalog}
  from "../vscode/src/dependency-catalog-projection.mjs";
import {EXAMPLE_INTERFACE_ALIAS,EXAMPLE_INTERFACE_DIGEST}
  from "../vscode/src/example-interface-dependency.mjs";

const sampleRoot="site/samples/v1alpha5/";
const candidate=JSON.parse(readFileSync(sampleRoot+"files.json","utf8"));
const uri=path=>({scheme:"file",path,toString(){return "file://"+path;}});
const joinPath=(base,...paths)=>uri(posix.normalize(posix.join(base.path,...paths)));

function host(candidateOverride=null,{
  files:seedFiles=[],folders:seedFolders=[],bundledZipOverride=null,
  staleStatAfterDelete=false
}={}){
  const files=new Map(seedFiles.map(([path,value])=>[path,new Uint8Array(value)]));
  const folders=new Set(["/global-storage",...seedFolders]);
  const staleStats=new Set();
  const workspace={workspaceFolders:[],fs:{
    async readFile(target){
      if(target.path==="/extension/samples/v1alpha5/files.json")
        return new TextEncoder().encode(JSON.stringify(candidateOverride??candidate));
      if(target.path.endsWith("interface-package/ca-client-tools_interface_1.1.0.zip.b64")&&
         bundledZipOverride!==null)return new TextEncoder().encode(bundledZipOverride);
      if(target.path.startsWith("/extension/samples/v1alpha5/"))
        return new Uint8Array(readFileSync(sampleRoot+target.path.slice("/extension/samples/v1alpha5/".length)));
      const value=files.get(target.path);
      if(value)return new Uint8Array(value);
      throw Object.assign(Error("missing"),{code:"FileNotFound"});
    },
    async createDirectory(target){
      const parts=target.path.split("/").filter(Boolean);
      let current="";
      for(const part of parts){current+="/"+part;folders.add(current);staleStats.delete(current);}
    },
    async stat(target){
      if(staleStats.has(target.path))return {type:1};
      if(files.has(target.path)||folders.has(target.path)||
         [...files.keys()].some(path=>path.startsWith(target.path+"/"))||
         [...folders].some(path=>path.startsWith(target.path+"/")))
        return {type:1};
      throw Object.assign(Error("missing"),{code:"FileNotFound"});
    },
    async readDirectory(target){
      if(!folders.has(target.path))
        throw Object.assign(Error("missing directory"),{code:"FileNotFound"});
      const prefix=target.path.endsWith("/")?target.path:target.path+"/";
      const entries=new Map();
      for(const path of folders){
        if(path.startsWith(prefix)){
          const name=path.slice(prefix.length);
          if(name&&!name.includes("/"))entries.set(name,2);
        }
      }
      for(const path of files.keys()){
        if(path.startsWith(prefix)){
          const name=path.slice(prefix.length);
          if(name&&!name.includes("/"))entries.set(name,1);
        }
      }
      return [...entries.entries()];
    },
    async delete(target){
      if(target.path==="/global-storage/skill-studio-demo")
        throw Object.assign(Error("active workspace root must remain stable"),{code:"NoPermissions"});
      const prefix=target.path+"/";
      let found=false;
      for(const path of [...files.keys()]){
        if(path===target.path||path.startsWith(prefix)){
          if(staleStatAfterDelete)staleStats.add(path);
          files.delete(path);found=true;
        }
      }
      for(const path of [...folders]){
        if(path===target.path||path.startsWith(prefix)){
          if(staleStatAfterDelete)staleStats.add(path);
          folders.delete(path);found=true;
        }
      }
      if(staleStatAfterDelete)staleStats.add(target.path);
      if(!found)throw Object.assign(Error("missing"),{code:"FileNotFound"});
    },
    async rename(source,destination){
      const from=source.path,to=destination.path,prefix=from+"/";
      const fileEntries=[...files.entries()].filter(([path])=>path===from||path.startsWith(prefix));
      const folderEntries=[...folders].filter(path=>path===from||path.startsWith(prefix));
      if(!fileEntries.length&&!folderEntries.length)
        throw Object.assign(Error("missing"),{code:"FileNotFound"});
      await this.createDirectory(uri(posix.dirname(to)));
      for(const folder of folderEntries){
        const suffix=folder===from?"":folder.slice(from.length);
        folders.add(to+suffix);staleStats.delete(to+suffix);
      }
      for(const [path,value] of fileEntries){
        const suffix=path===from?"":path.slice(from.length);
        files.set(to+suffix,new Uint8Array(value));staleStats.delete(to+suffix);
      }
      staleStats.delete(to);
      for(const [path] of fileEntries)files.delete(path);
      for(const path of folderEntries)folders.delete(path);
    },
    async writeFile(target,bytes){
      const parent=posix.dirname(target.path);
      assert.ok(folders.has(parent),"parent directory must exist: "+parent);
      files.set(target.path,new Uint8Array(bytes));staleStats.delete(target.path);
    }
  }};
  return {vscode:{Uri:{file:uri,joinPath},workspace},files,folders,workspace};
}

const root="/global-storage/skill-studio-demo";
const skillRoot=root+"/skills";
const procedurePath=skillRoot+"/establish-pdu-session-mas/assurance/procedure.yaml";
const masProcedurePath=procedurePath;
const modifyProcedurePath=skillRoot+"/modify-pdu-session-mas/assurance/procedure.yaml";
const releaseProcedurePath=skillRoot+"/release-pdu-session-mas/assurance/procedure.yaml";
const bundled=file=>new Uint8Array(readFileSync(sampleRoot+file));
const decode=bytes=>new TextDecoder().decode(bytes);
const total=candidate.files.length;

test("Example imports the three real Owner-linked Scheme C Skills and their exact dependency snapshots",async()=>{
  const h=host(),result=await seedExampleProject(
    h.vscode,uri("/extension"),uri("/global-storage"));
  assert.equal(candidate.sourceSha,"b06f72baae3eb3d578c489f950a325e2d63d556f");
  assert.equal(candidate.sourceRef,"refs/heads/main");
  assert.equal(candidate.sourceStatus,"OWNER_LINKED_STATIC_BUILD_PASS_E2E_NOT_RERUN");
  assert.equal(candidate.languageVersion,"connectionagent.io/v1alpha5");
  assert.deepEqual(candidate.skills,[
    "establish-pdu-session-mas","modify-pdu-session-mas","release-pdu-session-mas"
  ]);
  assert.equal(result.candidateFiles,18);
  assert.equal(result.files,total);
  assert.equal(result.created,total);
  assert.equal(result.skipped,0);
  assert.equal(result.root.path,root);
  assert.equal(result.skillsRoot.path,skillRoot);
  assert.equal(result.procedure.path,procedurePath);
  assert.equal(result.procedures["establish-pdu-session-mas"].path,procedurePath);
  assert.equal(result.procedures["modify-pdu-session-mas"].path,modifyProcedurePath);
  assert.equal(result.procedures["release-pdu-session-mas"].path,releaseProcedurePath);
  assert.equal(result.exampleDependencySeeded,true);
  assert.deepEqual(result.exampleDependencyIds,["ca-client","ca-context","mas"]);
  const settingsPath=root+"/.vscode/settings.json";
  const settings=JSON.parse(decode(h.files.get(settingsPath)));
  const deps=settings["connectionAgent.skillStudio.dependencies"];
  const locks=settings["connectionAgent.skillStudio.dependencyLock"].entries;
  assert.equal(deps.length,3);
  assert.equal(locks.length,3);
  const byId=Object.fromEntries(deps.map(item=>[item.id,item]));
  const lockById=Object.fromEntries(locks.map(item=>[item.id,item]));
  assert.equal(byId["ca-client"].kind,"interface-package");
  assert.equal(byId["ca-client"].source.contentDigest,EXAMPLE_INTERFACE_DIGEST);
  assert.equal(byId["ca-client"].source.origin.repository,"odango-chan/ca-client-tools");
  assert.equal(byId["ca-client"].source.origin.tag,"v1.1.0");
  assert.equal(byId["ca-client"].source.bundledExample,true);
  assert.equal(byId.mas.kind,"tool-catalog");
  assert.equal(byId.mas.source.packageId,"urn:openamsm:mas:tool-contracts");
  assert.equal(byId.mas.source.ref,"refs/tags/v1.2.0");
  assert.equal(lockById.mas.resolvedRevision,"fc44c3a745c68443fcfb12054c7eadf0ed7cc3f7");
  assert.equal(byId["ca-context"].kind,"schema-bundle");
  assert.equal(byId["ca-context"].source.packageId,"urn:connectionagent:ca:host-context");
  assert.equal(lockById["ca-context"].resolvedRevision,"57e277ff9094dad93543df46910a12a1dbbaf560");
  assert.deepEqual(result.exampleDependencyIds,Object.keys(result.exampleDependencySnapshotDigests));

  const clientSnapshot=await loadVerifiedSnapshot(h.vscode,uri(root),lockById["ca-client"]);
  assert.equal(clientSnapshot.files.length,7);
  const hints=projectLockedInterfaceCompletionHints(clientSnapshot);
  assert.ok(hints.some(x=>x.id==="ca-client::openamsm.smf.mas.sc.query"&&
    x.argumentProperties.some(p=>p.name==="supi"&&p.required)&&
    x.argumentProperties.some(p=>p.name==="pduSessionId")));

  const ownerSnapshot=await loadVerifiedSnapshot(h.vscode,uri(root),lockById.mas);
  assert.equal(ownerSnapshot.kind,"tool-catalog");
  assert.equal(ownerSnapshot.files.length,59);
  const ownerCatalog=projectLockedToolCatalog(ownerSnapshot);
  assert.equal(ownerCatalog.available,true);
  for(const callable of ["SC.CREATE_SM_CONTEXT","UPN.MODIFY_QOS_DELTA",
    "SC.RELEASE_SM_CONTEXT_C","MAS.RECEIPT_QUERY","MAS.RECONCILE"])
    assert.ok(ownerCatalog.operations.some(item=>item.id===callable),callable);
  const contextSnapshot=await loadVerifiedSnapshot(h.vscode,uri(root),lockById["ca-context"]);
  assert.equal(contextSnapshot.kind,"schema-bundle");
  assert.equal(contextSnapshot.files.length,1);

  assert.ok(h.files.has(procedurePath));
  assert.ok(h.files.has(modifyProcedurePath));
  assert.ok(h.files.has(releaseProcedurePath));
  assert.match(decode(h.files.get(procedurePath)),/start: validate-sm-subscription/);
  assert.match(decode(h.files.get(skillRoot+"/establish-pdu-session-mas/SKILL.md")),/OWNER_LINKED/);
  assert.match(decode(h.files.get(root+"/README.md")),/Scheme C — Create \/ Modify \/ Release/);
  assert.ok(h.files.has(skillRoot+"/establish-pdu-session-mas/references/openamsm-operation-mapping.md"));
  assert.equal(h.files.has(skillRoot+"/establish-pdu-session"),false);
  assert.equal(h.files.has(root+"/lib"),false);
  assert.equal(h.files.has(root+"/output"),false);
  assert.deepEqual((await h.vscode.workspace.fs.readDirectory(uri(skillRoot)))
    .map(([name])=>name).sort(),
    ["establish-pdu-session-mas","modify-pdu-session-mas","release-pdu-session-mas"].sort());
  assert.deepEqual(h.workspace.workspaceFolders,[],"import never mutates the active workspace");
});

test("Existing Example stays untouched unless replacement is explicitly requested",async()=>{
  const seedFiles=[],seedFolders=[root,skillRoot,root+"/archive",
    root+"/archive/legacy-v0.2",root+"/examples",root+"/examples/v1alpha4-candidate"];
  const packageRoot=skillRoot+"/establish-pdu-session-mas";
  seedFolders.push(packageRoot,packageRoot+"/assurance");
  seedFiles.push([packageRoot+"/SKILL.md",new TextEncoder().encode("user-edited Create Skill")]);
  seedFiles.push([packageRoot+"/assurance/procedure.yaml",
    new TextEncoder().encode("start: user-edited-create\n")]);
  seedFiles.push([root+"/README.md",new TextEncoder().encode("old Example README")]);
  seedFiles.push([root+"/archive/legacy-v0.2/old.txt",new TextEncoder().encode("retired archive")]);
  seedFiles.push([root+"/examples/v1alpha4-candidate/README.md",
    new TextEncoder().encode("old candidate staging")]);
  seedFiles.push([root+"/local-note.md",new TextEncoder().encode("local Example note")]);
  const h=host(null,{files:seedFiles,folders:seedFolders});

  const kept=await seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage"));
  assert.equal(kept.replacedExisting,false);
  assert.equal(kept.skipped,2);
  assert.equal(kept.created,total-2);
  assert.equal(kept.exampleDependencySeeded,true,
    "the exact Owner and Host dependency locks are added without overwriting existing Skill sources");
  assert.equal(decode(h.files.get(root+"/README.md")),"old Example README");
  assert.match(decode(h.files.get(procedurePath)),/user-edited-create/);
  assert.ok(h.files.has(root+"/archive/legacy-v0.2/old.txt"));
  assert.ok(h.files.has(root+"/examples/v1alpha4-candidate/README.md"));
  assert.ok(h.files.has(root+"/local-note.md"));

  const replaced=await seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage"),
    {replaceExisting:true});
  assert.equal(replaced.replacedExisting,true);
  assert.equal(replaced.created,total);
  assert.equal(replaced.skipped,0);
  assert.equal(replaced.readmeUpdated,true);
  assert.deepEqual((await h.vscode.workspace.fs.readDirectory(uri(root)))
    .map(([name])=>name).sort(),[".skill-studio",".vscode","README.md","skills"],
    "replacement keeps the active root but removes every retired root entry");
  assert.deepEqual((await h.vscode.workspace.fs.readDirectory(uri(skillRoot)))
    .map(([name])=>name).sort(),
    ["establish-pdu-session-mas","modify-pdu-session-mas","release-pdu-session-mas"].sort(),
    "replacement restores exactly the three real Scheme C Skills");
  assert.match(decode(h.files.get(procedurePath)),/start: validate-sm-subscription/);
  assert.match(decode(h.files.get(root+"/README.md")),/Scheme C — Create \/ Modify \/ Release/);
  for(const retiredPath of [
    root+"/archive/legacy-v0.2/old.txt",
    root+"/examples/v1alpha4-candidate/README.md",
    root+"/local-note.md"
  ])assert.equal(h.files.has(retiredPath),false,"replacement removes "+retiredPath);
  assert.deepEqual(h.files.get(skillRoot+"/establish-pdu-session-mas/SKILL.md"),
    bundled("establish-pdu-session-mas/SKILL.md"));
  for(const retiredFolder of [root+"/archive",root+"/examples"])
    assert.equal(h.folders.has(retiredFolder),false,"replacement removes "+retiredFolder);
});

test("Progress covers the v1alpha5 import and a non-replacing reload preserves local edits",async()=>{
  const h=host(),events=[];
  const first=await seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage"),
    {onProgress:event=>events.push({...event})});
  const progress=events.filter(event=>event.phase==="files");
  assert.equal(progress.length,total+1);
  assert.equal(progress[0].total,total);
  assert.deepEqual(progress.map(event=>event.completed),
    Array.from({length:total+1},(_,index)=>index));
  assert.equal(events.at(-1).phase,"project-ready");
  const userProcedure=new TextEncoder().encode("user-authored v1alpha5 edit");
  const userReadme=new TextEncoder().encode("user-authored Example README");
  const extra=skillRoot+"/establish-pdu-session-mas/notes.local.md";
  h.files.set(first.procedure.path,userProcedure);
  h.files.set(root+"/README.md",userReadme);
  h.files.set(extra,new TextEncoder().encode("local note"));
  const second=await seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage"));
  assert.equal(second.skipped,total);
  assert.equal(second.created,0);
  assert.equal(second.replacedExisting,false);
  assert.equal(second.exampleDependencySeeded,false,
    "reopen must never overwrite the existing Example lock/settings");
  assert.deepEqual(h.files.get(first.procedure.path),userProcedure,
    "a non-replacing reload never overwrites a user-edited Procedure");
  assert.deepEqual(h.files.get(root+"/README.md"),userReadme,
    "a non-replacing reload never overwrites the project README");
  assert.ok(h.files.has(extra),"a non-replacing reload keeps local files");
});

test("Example import does not fabricate lib or output directories",async()=>{
  const h=host(),result=await seedExampleProject(
    h.vscode,uri("/extension"),uri("/global-storage"));
  for(const name of ["lib","output"])
    await assert.rejects(h.vscode.workspace.fs.stat(uri(result.root.path+"/"+name)),
      error=>error.code==="FileNotFound");
});

test("Malformed or falsely qualified v1alpha5 manifests refuse all writes",async()=>{
  for(const data of [
    {...candidate,files:[...candidate.files,"../outside"]},
    {...candidate,files:[...candidate.files,candidate.files[0]]},
    {...candidate,sourceSha:"unknown"},
    {...candidate,sourceStatus:"QUALIFIED"},
    {...candidate,languageVersion:"connectionagent.io/v1alpha3"}
  ]){
    const h=host(data);
    await assert.rejects(seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage")));
    assert.equal(h.files.size,0);
    assert.equal([...h.folders].some(path=>path.startsWith(root)),false);
  }
});

test("Corrupted bundled release fails before any Example write, including replacement",async()=>{
  const h=host(null,{bundledZipOverride:"invalid-base64"});
  await assert.rejects(seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage")),
    /verify-pinned-example-dependencies/);
  assert.equal(h.files.size,0);
  assert.ok(!h.folders.has(root));
  const existing=host(null,{
    files:[[root+"/notes.txt",new TextEncoder().encode("keep me")]],
    folders:[root],
    bundledZipOverride:"invalid-base64"
  });
  await assert.rejects(seedExampleProject(existing.vscode,uri("/extension"),uri("/global-storage"),
    {replaceExisting:true}),/verify-pinned-example-dependencies/);
  assert.equal(decode(existing.files.get(root+"/notes.txt")),"keep me");
});

test("User Example settings/dependency removal are preserved on non-replacing import",async()=>{
  const h=host();
  await seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage"));
  const path=root+"/.vscode/settings.json";
  const custom=new TextEncoder().encode(JSON.stringify({
    "connectionAgent.skillStudio.dependencies":[],
    "connectionAgent.skillStudio.dependencyLock":{version:"skillc.lock/v0.1",entries:[]},
    "editor.fontSize":17
  }));
  h.files.set(path,custom);
  const reopened=await seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage"));
  assert.equal(reopened.exampleDependencySeeded,false);
  assert.deepEqual(h.files.get(path),custom);
});

test("Already opened exact current Example seeds its missing dependency locks without replacing Source",async()=>{
  const h=host();
  await seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage"));
  const originalProcedure=new Uint8Array(h.files.get(procedurePath));
  h.files.delete(root+"/.vscode/settings.json");
  h.workspace.workspaceFolders=[{uri:uri(root)}];
  const migrated=await ensureOpenedExampleDependencies(
    h.vscode,uri("/extension"),uri("/global-storage"));
  assert.equal(migrated.status,"SEEDED");
  assert.deepEqual(h.files.get(procedurePath),originalProcedure);
  const settings=JSON.parse(decode(h.files.get(root+"/.vscode/settings.json")));
  assert.deepEqual(settings["connectionAgent.skillStudio.dependencies"].map(item=>item.id),
    ["ca-client","ca-context","mas"]);
  const locks=settings["connectionAgent.skillStudio.dependencyLock"].entries;
  assert.equal(locks.find(item=>item.id==="mas").snapshotDigest,migrated.snapshotDigests.mas);
  assert.equal(locks.find(item=>item.id==="ca-context").snapshotDigest,
    migrated.snapshotDigests["ca-context"]);
  const reopened=await ensureOpenedExampleDependencies(
    h.vscode,uri("/extension"),uri("/global-storage"));
  assert.equal(reopened.status,"PRESERVED");
});

test("Example-only migration refuses unrelated workspaces, legacy sources and user configuration",async()=>{
  const h=host();
  await seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage"));
  h.files.delete(root+"/.vscode/settings.json");
  h.workspace.workspaceFolders=[{uri:uri("/other-user-project")}];
  assert.equal((await ensureOpenedExampleDependencies(h.vscode,
    uri("/extension"),uri("/global-storage"))).status,"NOT_EXAMPLE");
  assert.equal(h.files.has(root+"/.vscode/settings.json"),false);
  h.workspace.workspaceFolders=[{uri:uri(root)}];
  h.files.set(procedurePath,new TextEncoder().encode(
    "apiVersion: connectionagent.io/v1alpha1\nkind: Procedure\n"));
  assert.equal((await ensureOpenedExampleDependencies(h.vscode,
    uri("/extension"),uri("/global-storage"))).status,"LEGACY_OR_UNKNOWN");
  assert.equal(h.files.has(root+"/.vscode/settings.json"),false);
  h.files.set(root+"/.vscode/settings.json",new TextEncoder().encode('{"editor.fontSize":18}'));
  assert.equal((await ensureOpenedExampleDependencies(h.vscode,
    uri("/extension"),uri("/global-storage"))).status,"PRESERVED");
  assert.equal(decode(h.files.get(root+"/.vscode/settings.json")),'{"editor.fontSize":18}');
});

test("Explicit replacement rewrites deleted files when the host retains stale stat results",async()=>{
  const h=host(null,{staleStatAfterDelete:true});
  const first=await seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage"));
  const projectRoot=first.root.path;
  await h.vscode.workspace.fs.createDirectory(uri(projectRoot+"/lib"));
  await h.vscode.workspace.fs.createDirectory(uri(projectRoot+"/output"));
  h.files.set(projectRoot+"/local-note.md",new TextEncoder().encode("retired"));
  const replaced=await seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage"),
    {replaceExisting:true});
  assert.equal(replaced.replacedExisting,true);
  assert.equal(replaced.created,total);
  assert.equal(replaced.skipped,0);
  assert.equal(replaced.readmeUpdated,true);
  assert.ok(h.files.has(procedurePath));
  assert.ok(h.files.has(masProcedurePath));
  assert.ok(h.files.has(modifyProcedurePath));
  assert.ok(h.files.has(releaseProcedurePath));
  assert.match(decode(h.files.get(procedurePath)),/^start:/m);
  assert.equal(h.files.has(projectRoot+"/local-note.md"),false);
  assert.equal(h.folders.has(projectRoot+"/lib"),false);
  assert.equal(h.folders.has(projectRoot+"/output"),false);
});

test("Explicit replacement resets .vscode user settings only after rebuilding the Example",async()=>{
  const h=host();
  await seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage"));
  const settings=root+"/.vscode/settings.json";
  h.files.set(settings,new TextEncoder().encode('{"editor.fontSize":33}'));
  h.files.set(root+"/.vscode/obsolete.json",new TextEncoder().encode("retired"));
  const r=await seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage"),
    {replaceExisting:true});
  assert.equal(r.replacedExisting,true);
  assert.equal(r.exampleDependencySeeded,true);
  const values=JSON.parse(decode(h.files.get(settings)));
  assert.deepEqual(values["connectionAgent.skillStudio.dependencies"].map(item=>item.id),
    ["ca-client","ca-context","mas"]);
  assert.equal(values["editor.fontSize"],undefined);
  assert.equal(h.files.has(root+"/.vscode/obsolete.json"),false);
  assert.deepEqual((await h.vscode.workspace.fs.readDirectory(uri(root)))
    .map(([name])=>name).sort(),[".skill-studio",".vscode","README.md","skills"]);
});
