import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {posix} from "node:path";
import {seedExampleProject,ensureOpenedExampleDependencies,
  recoverExampleReplacement,getExampleReplacementStatus}
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
  staleStatAfterDelete=false,faults=[],staleDirectoryEntries=[],
  missingEntryCode="FileNotFound"
}={}){
  const files=new Map(seedFiles.map(([path,value])=>[path,new Uint8Array(value)]));
  const folders=new Set(["/global-storage",...seedFolders]);
  const staleStats=new Set();
  const symlinks=new Map();
  const renames=[];
  const resolvePath=path=>{
    let resolved=path;
    for(let depth=0;depth<8;depth++){
      const link=[...symlinks.keys()]
        .filter(candidate=>resolved===candidate||resolved.startsWith(candidate+"/"))
        .sort((left,right)=>right.length-left.length)[0];
      if(!link)break;
      resolved=symlinks.get(link)+resolved.slice(link.length);
    }
    return resolved;
  };
  function takeFault(operation,path){
    const rule=faults.find(item=>item.op===operation&&
      (item.path===path||(item.pathPrefix&&path.startsWith(item.pathPrefix)))&&
      (item.remaining??1)>0);
    if(!rule)return null;
    if((rule.skip??0)>0){rule.skip--;return null;}
    rule.remaining=(rule.remaining??1)-1;
    return rule;
  }
  function throwFault(rule,operation,path){
    throw Object.assign(Error(rule.message??("Injected "+operation+" failure at "+path)),
      {code:rule.code??"InjectedFailure"});
  }
  const workspace={workspaceFolders:[],fs:{
    async readFile(target){
      const fault=takeFault("readFile",target.path);
      if(fault)throwFault(fault,"readFile",target.path);
      if(target.path==="/extension/samples/v1alpha5/files.json")
        return new TextEncoder().encode(JSON.stringify(candidateOverride??candidate));
      if(target.path.endsWith("interface-package/ca-client-tools_interface_1.1.0.zip.b64")&&
         bundledZipOverride!==null)return new TextEncoder().encode(bundledZipOverride);
      if(target.path.startsWith("/extension/samples/v1alpha5/"))
        return new Uint8Array(readFileSync(sampleRoot+target.path.slice("/extension/samples/v1alpha5/".length)));
      const value=files.get(resolvePath(target.path));
      if(value)return new Uint8Array(value);
      throw Object.assign(Error("missing"),{code:missingEntryCode});
    },
    async createDirectory(target){
      const fault=takeFault("createDirectory",target.path);
      if(fault)throwFault(fault,"createDirectory",target.path);
      const parts=resolvePath(target.path).split("/").filter(Boolean);
      let current="";
      for(const part of parts){current+="/"+part;folders.add(current);staleStats.delete(current);}
    },
    async stat(target){
      const fault=takeFault("stat",target.path);
      if(fault)throwFault(fault,"stat",target.path);
      if(symlinks.has(target.path))return {type:66};
      const resolved=resolvePath(target.path);
      if(staleStats.has(target.path)||staleStats.has(resolved))return {type:1};
      if(folders.has(resolved)||
         [...files.keys()].some(path=>path.startsWith(resolved+"/"))||
         [...folders].some(path=>path.startsWith(resolved+"/")))
        return {type:2};
      if(files.has(resolved))return {type:1};
      throw Object.assign(Error("missing"),{code:"FileNotFound"});
    },
    async readDirectory(target){
      const fault=takeFault("readDirectory",target.path);
      if(fault)throwFault(fault,"readDirectory",target.path);
      const directory=resolvePath(target.path);
      if(!folders.has(directory))
        throw Object.assign(Error("missing directory"),{code:missingEntryCode});
      const prefix=directory.endsWith("/")?directory:directory+"/";
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
      for(const stale of staleDirectoryEntries){
        if((stale.parent===target.path||stale.parent===directory)&&!entries.has(stale.name))
          entries.set(stale.name,stale.type??1);
      }
      return [...entries.entries()];
    },
    async delete(target){
      const fault=takeFault("delete",target.path);
      if(fault&&!fault.after)throwFault(fault,"delete",target.path);
      if(target.path==="/global-storage/skill-studio-demo")
        throw Object.assign(Error("active workspace root must remain stable"),{code:"NoPermissions"});
      if(symlinks.has(target.path)){
        symlinks.delete(target.path);
        if(fault?.after)throwFault(fault,"delete",target.path);
        return;
      }
      const resolved=resolvePath(target.path);
      const prefix=resolved+"/";
      let found=false;
      for(const path of [...files.keys()]){
        if(path===resolved||path.startsWith(prefix)){
          if(staleStatAfterDelete)staleStats.add(path);
          files.delete(path);found=true;
        }
      }
      for(const path of [...folders]){
        if(path===resolved||path.startsWith(prefix)){
          if(staleStatAfterDelete)staleStats.add(path);
          folders.delete(path);found=true;
        }
      }
      if(staleStatAfterDelete)staleStats.add(resolved);
      if(!found)throw Object.assign(Error("missing"),{code:"FileNotFound"});
      if(fault?.after)throwFault(fault,"delete",target.path);
    },
    async rename(source,destination){
      const from=source.path,to=destination.path,prefix=from+"/";
      renames.push([from,to]);
      const fault=takeFault("rename",to);
      if(fault&&!fault.afterCopy)throwFault(fault,"rename",to);
      const fileEntries=[...files.entries()].filter(([path])=>path===from||path.startsWith(prefix));
      const folderEntries=[...folders].filter(path=>path===from||path.startsWith(prefix));
      if(!fileEntries.length&&!folderEntries.length)
        throw Object.assign(Error("missing"),{code:"FileNotFound"});
      await this.createDirectory(uri(posix.dirname(to)));
      let copied=0;
      for(const folder of folderEntries){
        const suffix=folder===from?"":folder.slice(from.length);
        folders.add(to+suffix);staleStats.delete(to+suffix);
        copied++;
        if(fault?.afterCopy&&copied>=fault.afterCopy)
          throwFault(fault,"rename",to);
      }
      for(const [path,value] of fileEntries){
        const suffix=path===from?"":path.slice(from.length);
        files.set(to+suffix,new Uint8Array(value));staleStats.delete(to+suffix);
        copied++;
        if(fault?.afterCopy&&copied>=fault.afterCopy)
          throwFault(fault,"rename",to);
      }
      staleStats.delete(to);
      for(const [path] of fileEntries)files.delete(path);
      for(const path of folderEntries)folders.delete(path);
    },
    async writeFile(target,bytes){
      const fault=takeFault("writeFile",target.path);
      const parent=posix.dirname(target.path);
      assert.ok(folders.has(parent),"parent directory must exist: "+parent);
      if(fault){
        if(fault.rootDelete){
          const prefix=root+"/";
          for(const path of [...files.keys()])if(path===root||path.startsWith(prefix))files.delete(path);
          for(const path of [...folders])if(path===root||path.startsWith(prefix))folders.delete(path);
        }else if(fault.typeFlip){
          files.delete(target.path);folders.add(target.path);
        }else if(fault.partial){
          files.set(target.path,new Uint8Array(bytes.slice(0,Math.max(0,bytes.length-1))));
        }
        throwFault(fault,"writeFile",target.path);
      }
      const resolved=resolvePath(target.path);
      files.set(resolved,new Uint8Array(bytes));staleStats.delete(resolved);
    }
  }};
  return {vscode:{Uri:{file:uri,joinPath},workspace},files,folders,symlinks,workspace,faults,renames,staleDirectoryEntries};
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

function captureExampleTree(h){
  const prefix=root+"/";
  return {
    directories:[...h.folders].filter(path=>path===root||path.startsWith(prefix)).sort(),
    files:[...h.files.entries()]
      .filter(([path])=>path===root||path.startsWith(prefix))
      .map(([path,bytes])=>[path,Array.from(bytes)])
      .sort(([left],[right])=>left.localeCompare(right))
  };
}
function captureTreeAt(h,treeRoot){
  const prefix=treeRoot+"/";
  return {
    directories:[...h.folders].filter(path=>path===treeRoot||path.startsWith(prefix)).sort(),
    files:[...h.files.entries()]
      .filter(([path])=>path===treeRoot||path.startsWith(prefix))
      .map(([path,bytes])=>[path,Array.from(bytes)])
      .sort(([left],[right])=>left.localeCompare(right))
  };
}
function removeTreeAt(h,treeRoot){
  const prefix=treeRoot+"/";
  for(const path of [...h.files.keys()])
    if(path===treeRoot||path.startsWith(prefix))h.files.delete(path);
  for(const path of [...h.folders])
    if(path===treeRoot||path.startsWith(prefix))h.folders.delete(path);
}
function replaceDirectoryWithSymlink(h,linkPath,targetPath){
  removeTreeAt(h,linkPath);
  h.symlinks.set(linkPath,targetPath);
}
async function existingExampleWithUserData(){
  const h=host();
  await seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage"));
  await h.vscode.workspace.fs.createDirectory(uri(root+"/user-data"));
  await h.vscode.workspace.fs.writeFile(uri(root+"/user-data/local-note.txt"),
    new TextEncoder().encode("preserve this user data"));
  return h;
}
const encode=value=>new TextEncoder().encode(value);
function snapshotExample(h){
  const prefix=root+"/";
  return {
    files:[...h.files.entries()]
      .filter(([path])=>path===root||path.startsWith(prefix))
      .map(([path,bytes])=>[path,[...bytes]])
      .sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0),
    folders:[...h.folders].filter(path=>path===root||path.startsWith(prefix)).sort()
  };
}
async function seedExistingExample(h){
  await seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage"));
  h.files.set(root+"/README.md",encode("previous complete Example README"));
  h.files.set(procedurePath,encode("start: user-preserved-procedure\n"));
  await h.vscode.workspace.fs.createDirectory(uri(root+"/archive"));
  h.files.set(root+"/archive/local.txt",encode("user archive"));
  return snapshotExample(h);
}

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
  assert.equal(replaced.root.path,root,"the active Example root URI must remain stable");
  assert.equal(replaced.procedure.path,procedurePath);
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

test("Confirmed Example replacement rolls back README, every Skill write, pruning, snapshots, settings and final verification failures",async()=>{
  const failurePoints=[
    {name:"README write",op:"writeFile",path:root+"/README.md",partial:true},
    ...candidate.files.map(file=>({
      name:"Skill write "+file,op:"writeFile",path:root+"/skills/"+file,partial:true
    })),
    {name:"stale-file pruning",op:"delete",path:root+"/archive",after:true},
    {name:"immutable dependency snapshot persistence",op:"writeFile",
      pathPrefix:root+"/.skill-studio/dependencies/",partial:true},
    {name:"settings write",op:"writeFile",path:root+"/.vscode/settings.json",partial:true},
    {name:"final inventory verification",op:"readDirectory",path:root,skip:3}
  ];
  for(const point of failurePoints){
    const h=host();
    const before=await seedExistingExample(h);
    h.faults.push({...point,remaining:1});
    const readyEvents=[];
    await assert.rejects(seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage"),{
      replaceExisting:true,
      onProgress:event=>readyEvents.push(event.phase)
    }),/previous Example was restored/,point.name);
    assert.deepEqual(snapshotExample(h),before,point.name+" must restore the old complete tree");
    assert.equal(getExampleReplacementStatus().state,"READY",point.name+" rollback must clear the readiness block");
    assert.equal(readyEvents.includes("project-ready"),false,
      point.name+" must never publish project-ready for a failed replacement");
  }
});

test("Rollback recreates the stable Example root if a failed write removes the active directory",async()=>{
  const h=host();
  const before=await seedExistingExample(h);
  h.faults.push({
    op:"writeFile",path:root+"/README.md",rootDelete:true,remaining:1
  });
  await assert.rejects(seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage"),{
    replaceExisting:true
  }),/previous Example was restored/);
  assert.equal(h.folders.has(root),true);
  assert.deepEqual(snapshotExample(h),before,
    "rollback must recreate the same active root URI and restore its complete prior tree");
});

test("Rollback restores a file when a failed write temporarily changes its path into a directory",async()=>{
  const h=host();
  const before=await seedExistingExample(h);
  h.faults.push({
    op:"writeFile",path:root+"/README.md",typeFlip:true,remaining:1
  });
  await assert.rejects(seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage"),{
    replaceExisting:true
  }),/previous Example was restored/);
  assert.deepEqual(snapshotExample(h),before,
    "rollback must remove the conflicting directory and restore the original README file bytes and type");
  assert.ok(h.files.has(root+"/README.md"));
  assert.equal(h.folders.has(root+"/README.md"),false);
});

test("A partial dependency snapshot directory rename stays inside staging and preserves the active Example",async()=>{
  const seedFiles=[
    [root+"/README.md",encode("old README")],
    [root+"/local.txt",encode("keep until confirmed commit")]
  ];
  const seedFolders=[root];
  const h=host(null,{files:seedFiles,folders:seedFolders,faults:[{
    op:"rename",
    pathPrefix:"/global-storage/.skill-studio-example-replacement/candidate-storage/skill-studio-demo/.skill-studio/dependencies/",
    afterCopy:1,remaining:1
  }]});
  const before=snapshotExample(h);
  await assert.rejects(seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage"),{
    replaceExisting:true
  }),/active Example was left untouched/);
  assert.deepEqual(snapshotExample(h),before,
    "a partial staging rename must not mutate the active Example");
  assert.equal(getExampleReplacementStatus().state,"READY");
});

test("Extension-host restart retries rollback from retained backup after rollback itself fails",async()=>{
  const h=host();
  const before=await seedExistingExample(h);
  h.faults.push({
    op:"writeFile",path:root+"/README.md",partial:true,remaining:2
  });
  await assert.rejects(seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage"),{
    replaceExisting:true
  }),/rollback is incomplete/);
  assert.equal(getExampleReplacementStatus().state,"RECOVERY_REQUIRED");
  assert.notDeepEqual(snapshotExample(h),before,
    "the injected second failure leaves a partial tree but must remain blocked");
  h.faults.length=0;
  const recovered=await recoverExampleReplacement(h.vscode,uri("/global-storage"));
  assert.equal(recovered.status,"ROLLED_BACK");
  assert.equal(getExampleReplacementStatus().state,"READY");
  assert.deepEqual(snapshotExample(h),before,
    "startup recovery restores the exact old Example from the retained backup");
});

test("Extension-host restart verifies a committed Example and finishes interrupted transaction cleanup",async()=>{
  const h=host(null,{faults:[{
    op:"delete",
    path:"/global-storage/.skill-studio-example-replacement/candidate-storage",
    remaining:1
  }]});
  await seedExistingExample(h);
  await assert.rejects(seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage"),{
    replaceExisting:true
  }),/committed but cleanup is pending/);
  assert.equal(getExampleReplacementStatus().state,"RECOVERY_REQUIRED");
  assert.match(decode(h.files.get(root+"/README.md")),/Scheme C — Create \/ Modify \/ Release/);
  h.faults.length=0;
  const recovered=await recoverExampleReplacement(h.vscode,uri("/global-storage"));
  assert.equal(recovered.status,"COMMITTED_RECOVERED");
  assert.equal(getExampleReplacementStatus().state,"READY");
  assert.equal(h.files.has(root+"/archive/local.txt"),false);
  assert.ok(h.files.has(procedurePath));
});

test("A host without transaction filesystem capabilities is marked unavailable instead of failing activation",async()=>{
  const h=host();
  delete h.vscode.workspace.fs.readDirectory;
  delete h.vscode.workspace.fs.writeFile;
  delete h.vscode.workspace.fs.createDirectory;
  delete h.vscode.workspace.fs.delete;
  const recovered=await recoverExampleReplacement(h.vscode,uri("/global-storage"));
  assert.equal(recovered.status,"UNSUPPORTED_HOST");
  assert.equal(getExampleReplacementStatus().state,"UNAVAILABLE");
  assert.match(getExampleReplacementStatus().message,/cannot inspect or recover Example transactions/);
});

test("Startup recovery confirms OPFS EntryNotFound markers and transaction directory are absent",async()=>{
  const h=host(null,{missingEntryCode:"EntryNotFound"});
  const recovered=await recoverExampleReplacement(h.vscode,uri("/global-storage"));
  assert.equal(recovered.status,"CLEAN");
  assert.equal(getExampleReplacementStatus().state,"READY");
});

test("Startup recovery fails closed when EntryNotFound cannot be confirmed without stat",async()=>{
  const h=host(null,{missingEntryCode:"EntryNotFound"});
  delete h.vscode.workspace.fs.stat;
  await assert.rejects(recoverExampleReplacement(h.vscode,uri("/global-storage")),/missing/);
  assert.equal(getExampleReplacementStatus().state,"RECOVERY_REQUIRED");
});

test("Startup recovery does not require fs.stat when the host exposes no transaction directory",async()=>{
  const h=host();
  delete h.vscode.workspace.fs.stat;
  const recovered=await recoverExampleReplacement(h.vscode,uri("/global-storage"));
  assert.equal(recovered.status,"CLEAN");
  assert.equal(getExampleReplacementStatus().state,"READY");
});

test("A verified PREPARED journal with no COMMITTING marker is safely aborted before active mutation",async()=>{
  const h=host(null,{folders:[root]});
  const transaction="/global-storage/.skill-studio-example-replacement";
  await h.vscode.workspace.fs.createDirectory(uri(transaction));
  const prepared={
    schemaVersion:1,state:"PREPARED",rootUri:uri(root).toString(),
    backupInventory:[],candidateInventory:[]
  };
  await h.vscode.workspace.fs.writeFile(uri(transaction+"/PREPARED.json"),encode(JSON.stringify(prepared)));
  const recovered=await recoverExampleReplacement(h.vscode,uri("/global-storage"));
  assert.equal(recovered.status,"ABORTED_BEFORE_COMMIT");
  assert.equal(getExampleReplacementStatus().state,"READY");
  assert.equal(h.folders.has(transaction),false);
});

test("A PREPARED journal whose active tree changed remains blocked without overwriting user data",async()=>{
  const h=host(null,{
    folders:[root],
    files:[[root+"/user.txt",encode("user edit after staging")]]
  });
  const before=snapshotExample(h);
  const transaction="/global-storage/.skill-studio-example-replacement";
  await h.vscode.workspace.fs.createDirectory(uri(transaction));
  const prepared={
    schemaVersion:1,state:"PREPARED",rootUri:uri(root).toString(),
    backupInventory:[],candidateInventory:[]
  };
  await h.vscode.workspace.fs.writeFile(uri(transaction+"/PREPARED.json"),encode(JSON.stringify(prepared)));
  await assert.rejects(recoverExampleReplacement(h.vscode,uri("/global-storage")),
    /recovery required/i);
  assert.equal(getExampleReplacementStatus().state,"RECOVERY_REQUIRED");
  assert.deepEqual(snapshotExample(h),before);
  assert.ok(h.folders.has(transaction),"the transaction journal must remain for manual recovery");
});

test("A corrupt COMMITTED marker falls back to the still-verified COMMITTING backup",async()=>{
  const h=host();
  const before=await seedExistingExample(h);
  h.faults.push({
    op:"delete",
    path:"/global-storage/.skill-studio-example-replacement/candidate-storage",
    remaining:1
  });
  await assert.rejects(seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage"),{
    replaceExisting:true
  }),/committed but cleanup is pending/);
  h.files.set("/global-storage/.skill-studio-example-replacement/COMMITTED.json",
    encode("{truncated"));
  h.faults.length=0;
  const recovered=await recoverExampleReplacement(h.vscode,uri("/global-storage"));
  assert.equal(recovered.status,"ROLLED_BACK");
  assert.equal(getExampleReplacementStatus().state,"READY");
  assert.deepEqual(snapshotExample(h),before,
    "a corrupt terminal marker must not outrank the valid commit-intent backup");
});

test("An unreadable COMMITTING marker blocks recovery without guessing or mutating the active tree",async()=>{
  const h=host();
  await seedExistingExample(h);
  h.faults.push({
    op:"writeFile",path:root+"/README.md",partial:true,remaining:2
  });
  await assert.rejects(seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage"),{
    replaceExisting:true
  }),/rollback is incomplete/);
  assert.equal(getExampleReplacementStatus().state,"RECOVERY_REQUIRED");
  const blockedTree=snapshotExample(h);
  h.files.set("/global-storage/.skill-studio-example-replacement/COMMITTING.json",
    encode("{truncated"));
  h.faults.length=0;
  await assert.rejects(recoverExampleReplacement(h.vscode,uri("/global-storage")),
    /recovery required/i);
  assert.equal(getExampleReplacementStatus().state,"RECOVERY_REQUIRED");
  assert.deepEqual(snapshotExample(h),blockedTree,
    "without a verified commit-intent marker recovery must not guess or mutate");
  assert.ok(h.folders.has("/global-storage/.skill-studio-example-replacement/backup"),
    "the recovery backup must remain available for manual intervention");
});

test("Dirty Example editor buffers are saved before backup and restored if replacement rolls back",async()=>{
  const h=host();
  await seedExistingExample(h);
  let expectedAfterSave;
  const document={
    uri:uri(procedurePath),isDirty:true,
    async save(){
      h.files.set(procedurePath,encode("saved unsaved editor buffer\n"));
      this.isDirty=false;
      expectedAfterSave=snapshotExample(h);
      return true;
    }
  };
  h.workspace.textDocuments=[document];
  h.faults.push({
    op:"writeFile",path:root+"/README.md",partial:true,remaining:1
  });
  await assert.rejects(seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage"),{
    replaceExisting:true
  }),/previous Example was restored/);
  assert.equal(document.isDirty,false);
  assert.deepEqual(snapshotExample(h),expectedAfterSave,
    "rollback must restore the bytes saved from the active editor before backup");
});

test("A newly dirty Example editor during staging aborts before COMMITTING and leaves disk untouched",async()=>{
  const h=host();
  const before=await seedExistingExample(h);
  const document={uri:uri(procedurePath),isDirty:false,async save(){return true;}};
  h.workspace.textDocuments=[document];
  await assert.rejects(seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage"),{
    replaceExisting:true,
    onProgress:event=>{
      if(event.phase==="files"&&event.completed===total)document.isDirty=true;
    }
  }),/became dirty during replacement staging/);
  assert.equal(document.isDirty,true,"the user's new unsaved edit must remain in the editor");
  assert.deepEqual(snapshotExample(h),before,
    "the active disk tree must remain unchanged when an editor becomes dirty mid-stage");
  assert.equal(getExampleReplacementStatus().state,"READY");
});

test("A symbolic-link Example root is rejected before backup or mutation",async()=>{
  const h=host();
  const before=await seedExistingExample(h);
  const stat=h.vscode.workspace.fs.stat;
  h.vscode.workspace.fs.stat=async target=>{
    if(target.path===root)return {type:66};
    return stat(target);
  };
  await assert.rejects(seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage"),{
    replaceExisting:true
  }),/cannot be a symbolic link/);
  assert.deepEqual(snapshotExample(h),before);
  assert.equal(getExampleReplacementStatus().state,"READY");
});

test("Committed recovery rejects an active-root symlink to the retained candidate and preserves all transaction data",async()=>{
  const transaction="/global-storage/.skill-studio-example-replacement";
  const candidateStorage=transaction+"/candidate-storage";
  const candidateRoot=candidateStorage+"/skill-studio-demo";
  const backupRoot=transaction+"/backup";
  const committedMarker=transaction+"/COMMITTED.json";
  const h=host(null,{faults:[{op:"delete",path:candidateStorage}]});
  await seedExistingExample(h);
  await assert.rejects(seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage"),{
    replaceExisting:true
  }),/committed but cleanup is pending/);
  const candidateBefore=captureTreeAt(h,candidateRoot);
  const backupBefore=captureTreeAt(h,backupRoot);
  const markerBefore=Array.from(h.files.get(committedMarker));
  replaceDirectoryWithSymlink(h,root,candidateRoot);
  await assert.rejects(recoverExampleReplacement(h.vscode,uri("/global-storage")),
    /recovery required/i);
  assert.equal(getExampleReplacementStatus().state,"RECOVERY_REQUIRED");
  assert.equal(h.symlinks.get(root),candidateRoot);
  assert.deepEqual(captureTreeAt(h,candidateRoot),candidateBefore,
    "the candidate target must not be removed through the active-root symlink");
  assert.deepEqual(captureTreeAt(h,backupRoot),backupBefore,
    "the verified backup must remain available for manual recovery");
  assert.deepEqual(Array.from(h.files.get(committedMarker)),markerBefore,
    "the committed journal must remain intact while recovery is blocked");
  assert.ok(h.files.has(transaction+"/COMMITTING.json"));
});

test("Rollback recovery rejects an active-root symlink to the retained backup and preserves the backup",async()=>{
  const transaction="/global-storage/.skill-studio-example-replacement";
  const backupRoot=transaction+"/backup";
  const h=host();
  await seedExistingExample(h);
  h.faults.push({
    op:"writeFile",path:root+"/README.md",partial:true,remaining:2
  });
  await assert.rejects(seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage"),{
    replaceExisting:true
  }),/rollback is incomplete/);
  const backupBefore=captureTreeAt(h,backupRoot);
  const committingMarker=Array.from(h.files.get(transaction+"/COMMITTING.json"));
  replaceDirectoryWithSymlink(h,root,backupRoot);
  await assert.rejects(recoverExampleReplacement(h.vscode,uri("/global-storage")),
    /recovery required/i);
  assert.equal(getExampleReplacementStatus().state,"RECOVERY_REQUIRED");
  assert.equal(h.symlinks.get(root),backupRoot);
  assert.deepEqual(captureTreeAt(h,backupRoot),backupBefore,
    "recovery must not delete the backup that the active root links to");
  assert.deepEqual(Array.from(h.files.get(transaction+"/COMMITTING.json")),committingMarker,
    "the commit-intent journal must remain intact");
  assert.ok(h.folders.has(transaction));
});

test("Non-empty transaction recovery fails closed when fs.stat is unavailable",async()=>{
  const transaction="/global-storage/.skill-studio-example-replacement";
  const candidateStorage=transaction+"/candidate-storage";
  const backupRoot=transaction+"/backup";
  const h=host(null,{faults:[{op:"delete",path:candidateStorage}]});
  await seedExistingExample(h);
  await assert.rejects(seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage"),{
    replaceExisting:true
  }),/committed but cleanup is pending/);
  const backupBefore=captureTreeAt(h,backupRoot);
  delete h.vscode.workspace.fs.stat;
  await assert.rejects(recoverExampleReplacement(h.vscode,uri("/global-storage")),
    /recovery required/i);
  assert.equal(getExampleReplacementStatus().state,"RECOVERY_REQUIRED");
  assert.deepEqual(captureTreeAt(h,backupRoot),backupBefore,
    "recovery without root-type inspection must retain the verified backup");
  assert.ok(h.files.has(transaction+"/COMMITTED.json"));
});

test("A dirty Example editor that cannot save aborts before transaction mutation",async()=>{
  const h=host();
  const before=await seedExistingExample(h);
  const document={
    uri:uri(procedurePath),isDirty:true,
    async save(){return false;}
  };
  h.workspace.textDocuments=[document];
  await assert.rejects(seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage"),{
    replaceExisting:true
  }),/did not save successfully/);
  assert.deepEqual(snapshotExample(h),before);
  assert.equal(getExampleReplacementStatus().state,"READY");
});

test("Confirmed Example replacement leaves ordinary user projects untouched and reports READY only after commit verification",async()=>{
  const userRoot="/global-storage/projects/my-user-project";
  const h=host(null,{
    folders:[userRoot,userRoot+"/skills"],
    files:[[userRoot+"/skills/SKILL.md",encode("ordinary user Skill")]]
  });
  const beforeUser={
    files:[...h.files.entries()].filter(([path])=>path===userRoot||path.startsWith(userRoot+"/"))
      .map(([path,bytes])=>[path,[...bytes]]),
    folders:[...h.folders].filter(path=>path===userRoot||path.startsWith(userRoot+"/")).sort()
  };
  await seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage"));
  const before=[];
  const replaced=await seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage"),{
    replaceExisting:true,
    onProgress:event=>before.push({phase:event.phase,state:getExampleReplacementStatus().state})
  });
  assert.equal(replaced.replacedExisting,true);
  assert.equal(replaced.created,total);
  assert.equal(replaced.skipped,0);
  assert.equal(getExampleReplacementStatus().state,"READY");
  assert.equal(before.at(-1).phase,"project-ready");
  assert.equal(before.at(-1).state,"READY");
  assert.deepEqual({
    files:[...h.files.entries()].filter(([path])=>path===userRoot||path.startsWith(userRoot+"/"))
      .map(([path,bytes])=>[path,[...bytes]]),
    folders:[...h.folders].filter(path=>path===userRoot||path.startsWith(userRoot+"/")).sort()
  },beforeUser);
});



test("Confirmed replacement reconciles stale OPFS directory entries without treating missing files as backup data",async()=>{
  const h=host();
  const before=await seedExistingExample(h);
  const preservedMetadataPath=root+"/.skill-studio/user-metadata.json";
  const preservedMetadata=encode('{"workspaceLabel":"my Example notes"}\n');
  h.files.set(preservedMetadataPath,preservedMetadata);
  const settings=JSON.parse(decode(h.files.get(root+"/.vscode/settings.json")));
  const owner=settings["connectionAgent.skillStudio.dependencyLock"].entries
    .find(entry=>entry.id==="mas");
  const staleName="ssm-release_confirm_n1.output.schema.json";
  const staleParent=root+"/.skill-studio/dependencies/"+owner.snapshotDigest.slice(7)+"/schemas";
  assert.ok(h.folders.has(staleParent),"the stale file parent must be a real directory");
  h.files.delete(staleParent+"/"+staleName);
  assert.equal(h.files.has(staleParent+"/"+staleName),false,
    "the injected directory entry must have no backing file");
  h.staleDirectoryEntries.push({parent:staleParent,name:staleName,type:1});
  const result=await seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage"),{
    replaceExisting:true
  });
  assert.equal(result.replacedExisting,true);
  assert.equal(result.created,total);
  assert.equal(getExampleReplacementStatus().state,"READY");
  assert.ok(h.files.has(procedurePath));
  assert.ok(before.files.some(([path])=>path===procedurePath));
  const rebuiltLock=JSON.parse(decode(h.files.get(root+"/.vscode/settings.json")))
    ["connectionAgent.skillStudio.dependencyLock"];
  const rebuiltOwner=rebuiltLock.entries.find(entry=>entry.id==="mas");
  assert.ok(h.files.has(root+"/.skill-studio/dependencies/"+
    rebuiltOwner.snapshotDigest.slice(7)+"/schemas/"+staleName),
    "the new pinned dependency snapshot must be complete, not reuse the stale cache");
  assert.deepEqual(h.files.get(preservedMetadataPath),preservedMetadata,
    "authored .skill-studio metadata must survive dependency-cache regeneration");
});

test("Confirmed replacement recreates a same-digest dependency directory missing from a stale OPFS listing",async()=>{
  const h=host();
  await seedExistingExample(h);
  const settings=JSON.parse(decode(h.files.get(root+"/.vscode/settings.json")));
  const owner=settings["connectionAgent.skillStudio.dependencyLock"].entries
    .find(entry=>entry.id==="mas");
  const digest=owner.snapshotDigest;
  const dependencyRoot=root+"/.skill-studio/dependencies/"+digest.slice(7);
  const staleDirectory=dependencyRoot+"/schemas";
  const staleName="ssm-release_confirm_n1.output.schema.json";
  assert.ok(h.folders.has(dependencyRoot),"the dependency snapshot root must exist");
  assert.ok(h.folders.has(staleDirectory),"the schemas directory must exist before fault injection");
  for(const file of [...h.files.keys()])
    if(file.startsWith(staleDirectory+"/"))h.files.delete(file);
  for(const folder of [...h.folders])
    if(folder===staleDirectory||folder.startsWith(staleDirectory+"/"))h.folders.delete(folder);
  assert.equal(h.folders.has(staleDirectory),false,
    "the injected directory entry must have no backing directory");
  h.staleDirectoryEntries.push({parent:dependencyRoot,name:"schemas",type:2});
  const result=await seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage"),{
    replaceExisting:true
  });
  assert.equal(result.replacedExisting,true);
  assert.equal(result.created,total);
  assert.equal(getExampleReplacementStatus().state,"READY");
  const rebuiltLock=JSON.parse(decode(h.files.get(root+"/.vscode/settings.json")))
    ["connectionAgent.skillStudio.dependencyLock"];
  const rebuiltOwner=rebuiltLock.entries.find(entry=>entry.id==="mas");
  assert.equal(rebuiltOwner.snapshotDigest,digest,
    "regeneration must preserve the pinned snapshot digest");
  assert.ok(h.folders.has(staleDirectory),
    "the staged same-digest snapshot must recreate the missing dependency directory");
  assert.ok(h.files.has(staleDirectory+"/"+staleName),
    "the regenerated cache must restore the schema file beneath the recreated directory");
});

test("Transaction backup retries a transient EntryNotFound when stat confirms the file still exists",async()=>{
  const h=await existingExampleWithUserData();
  h.faults.push({
    op:"readFile",path:procedurePath,code:"EntryNotFound",remaining:1
  });
  const result=await seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage"),{
    replaceExisting:true
  });
  assert.equal(result.replacedExisting,true);
  assert.equal(result.created,total);
  assert.equal(getExampleReplacementStatus().state,"READY");
  assert.match(decode(h.files.get(procedurePath)),/^start:/m);
});

test("A failure while backing up the old Example leaves the active tree untouched",async()=>{
  const h=await existingExampleWithUserData();
  const before=captureExampleTree(h);
  h.faults.push({op:"readFile",path:procedurePath});
  await assert.rejects(seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage"),
    {replaceExisting:true}),/replacement failed at backup-existing-example/);
  assert.deepEqual(captureExampleTree(h),before);
  assert.equal(getExampleReplacementStatus().state,"READY");
});

test("A committed Example remains verifiable when post-commit cleanup must be retried",async()=>{
  const h=await existingExampleWithUserData();
  h.renames.length=0;
  const transactionRoot="/global-storage/.skill-studio-example-replacement";
  h.faults.push({op:"delete",path:transactionRoot+"/backup",after:true});
  await assert.rejects(seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage"),
    {replaceExisting:true}),/cleanup is pending/);
  assert.equal(getExampleReplacementStatus().state,"RECOVERY_REQUIRED");
  assert.match(decode(h.files.get(procedurePath)),/^start:/m);
  assert.equal(h.files.has(root+"/user-data/local-note.txt"),false);
  assert.equal(h.folders.has(transactionRoot),true);
  const recovered=await recoverExampleReplacement(h.vscode,uri("/global-storage"));
  assert.equal(recovered.status,"COMMITTED_RECOVERED");
  assert.equal(getExampleReplacementStatus().state,"READY");
  assert.equal(h.folders.has(transactionRoot),false);
});

test("Recovery prefers a verified rollback when an unverified COMMITTED marker survived cleanup failure",async()=>{
  const h=await existingExampleWithUserData();
  const before=captureExampleTree(h);
  const transactionRoot="/global-storage/.skill-studio-example-replacement";
  // Skip the preflight lookup before the transaction directory exists.
  h.faults.push({op:"readFile",path:transactionRoot+"/COMMITTED.json",skip:1});
  h.faults.push({op:"delete",path:transactionRoot+"/COMMITTED.json",remaining:2});
  await assert.rejects(seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage"),
    {replaceExisting:true}),/rollback is incomplete/);
  assert.equal(getExampleReplacementStatus().state,"RECOVERY_REQUIRED");
  const recovered=await recoverExampleReplacement(h.vscode,uri("/global-storage"));
  assert.equal(recovered.status,"ROLLED_BACK");
  assert.deepEqual(captureExampleTree(h),before);
  assert.equal(getExampleReplacementStatus().state,"READY");
});
