import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {posix} from "node:path";
import {seedExampleProject} from "../vscode/src/sample-loader.mjs";

const sampleRoot="site/samples/v1alpha4/";
const candidate=JSON.parse(readFileSync(sampleRoot+"files.json","utf8"));
const uri=path=>({scheme:"file",path,toString(){return "file://"+path;}});
const joinPath=(base,...paths)=>uri(posix.normalize(posix.join(base.path,...paths)));

function host(candidateOverride=null,{files:seedFiles=[],folders:seedFolders=[]}={}){
  const files=new Map(seedFiles.map(([path,value])=>[path,new Uint8Array(value)]));
  const folders=new Set(["/global-storage",...seedFolders]);
  const workspace={workspaceFolders:[],fs:{
    async readFile(target){
      if(target.path==="/extension/samples/v1alpha4/files.json")
        return new TextEncoder().encode(JSON.stringify(candidateOverride??candidate));
      if(target.path.startsWith("/extension/samples/v1alpha4/"))
        return new Uint8Array(readFileSync(sampleRoot+target.path.slice("/extension/samples/v1alpha4/".length)));
      const value=files.get(target.path);
      if(value)return new Uint8Array(value);
      throw Object.assign(Error("missing"),{code:"FileNotFound"});
    },
    async createDirectory(target){
      const parts=target.path.split("/").filter(Boolean);
      let current="";
      for(const part of parts){current+="/"+part;folders.add(current);}
    },
    async stat(target){
      if(files.has(target.path)||folders.has(target.path)||
         [...files.keys()].some(path=>path.startsWith(target.path+"/"))||
         [...folders].some(path=>path.startsWith(target.path+"/")))
        return {type:1};
      throw Object.assign(Error("missing"),{code:"FileNotFound"});
    },
    async delete(target){
      const prefix=target.path+"/";
      let found=false;
      for(const path of [...files.keys()]){
        if(path===target.path||path.startsWith(prefix)){files.delete(path);found=true;}
      }
      for(const path of [...folders]){
        if(path===target.path||path.startsWith(prefix)){folders.delete(path);found=true;}
      }
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
        folders.add(to+suffix);
      }
      for(const [path,value] of fileEntries){
        const suffix=path===from?"":path.slice(from.length);
        files.set(to+suffix,new Uint8Array(value));
      }
      for(const [path] of fileEntries)files.delete(path);
      for(const path of folderEntries)folders.delete(path);
    },
    async writeFile(target,bytes){
      const parent=posix.dirname(target.path);
      assert.ok(folders.has(parent),"parent directory must exist: "+parent);
      files.set(target.path,new Uint8Array(bytes));
    }
  }};
  return {vscode:{Uri:{file:uri,joinPath},workspace},files,folders,workspace};
}

const root="/global-storage/skill-studio-demo";
const skillRoot=root+"/skills";
const procedurePath=skillRoot+"/establish-pdu-session/assurance/procedure.yaml";
const masProcedurePath=skillRoot+"/establish-pdu-session-mas/assurance/procedure.yaml";
const bundled=file=>new Uint8Array(readFileSync(sampleRoot+file));
const decode=bytes=>new TextDecoder().decode(bytes);
const total=candidate.files.length;

test("Example imports only the pinned CA-SL v1alpha4 Skills into skills/",async()=>{
  const h=host(),result=await seedExampleProject(
    h.vscode,uri("/extension"),uri("/global-storage"));
  assert.equal(candidate.sourceSha,"ab189d5dd62763be4cd2f00cc8047a0c5982b6be");
  assert.equal(candidate.sourceStatus,"DRAFT_NOT_QUALIFIED");
  assert.equal(candidate.languageVersion,"connectionagent.io/v1alpha4");
  assert.equal(result.candidateFiles,14);
  assert.equal(result.files,total);
  assert.equal(result.created,total);
  assert.equal(result.skipped,0);
  assert.equal(result.overwritten,0);
  assert.equal(result.legacyArchived,0);
  assert.equal(result.root.path,root);
  assert.equal(result.skillsRoot.path,skillRoot);
  assert.equal(result.procedure.path,procedurePath);
  assert.equal(result.procedures["establish-pdu-session-mas"].path,masProcedurePath);
  assert.equal(h.files.size,total+1,"14 Skill files plus the Example README are imported");
  assert.ok(h.files.has(procedurePath));
  assert.ok(h.files.has(masProcedurePath));
  assert.match(decode(h.files.get(procedurePath)),/^# Illustrative CA-SL v1alpha4/m);
  assert.match(decode(h.files.get(procedurePath)),/start: get-sm-subscription-data/);
  assert.doesNotMatch(decode(h.files.get(procedurePath)),/ueRef|ue-ref/);
  assert.match(decode(h.files.get(masProcedurePath)),/start: validate-sm-subscription/);
  assert.match(decode(h.files.get(root+"/README.md")),/CA-SL v1alpha4 Example Skills/);
  assert.match(decode(h.files.get(root+"/README.md")),/ab189d5dd62763be4cd2f00cc8047a0c5982b6be/);
  assert.ok(h.files.has(skillRoot+"/establish-pdu-session/scripts/validate-subscription-request.py"));
  assert.ok(h.files.has(skillRoot+"/establish-pdu-session-mas/assurance/openamsm-operation-mapping.md"));
  assert.deepEqual(h.workspace.workspaceFolders,[],"import never mutates the active workspace");
});

test("Example migration archives retired v0.2 packages and promotes existing v1alpha4 packages",async()=>{
  const seedFiles=[],seedFolders=[];
  const legacyNames=["establish-pdu-session","establish-pdu-session-mas"];
  for(const name of legacyNames){
    const packageRoot=skillRoot+"/"+name;
    seedFolders.push(packageRoot,packageRoot+"/assurance");
    seedFiles.push([packageRoot+"/SKILL.md",new TextEncoder().encode("legacy user content")]);
    seedFiles.push([packageRoot+"/assurance/procedure.yaml",
      new TextEncoder().encode("start: ue-requested-pdu-session-establishment\n")]);
  }
  for(const file of candidate.files){
    const source=sampleRoot+file;
    const bytes=new Uint8Array(readFileSync(source));
    const destination=root+"/examples/v1alpha4-candidate/"+file;
    seedFolders.push(posix.dirname(destination));
    seedFiles.push([destination,bytes]);
  }
  seedFolders.push(root+"/examples/v1alpha4-candidate");
  seedFiles.push([root+"/examples/v1alpha4-candidate/README.md",
    new TextEncoder().encode("old candidate readme")]);
  const h=host(null,{files:seedFiles,folders:seedFolders});
  const result=await seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage"));
  assert.equal(result.legacyArchived,2);
  assert.equal(result.created,0);
  assert.equal(result.skipped,total);
  assert.equal(result.overwritten,0);
  for(const name of legacyNames){
    assert.ok(h.files.has(root+"/archive/legacy-v0.2/"+name+"/SKILL.md"));
    assert.match(decode(h.files.get(root+"/archive/legacy-v0.2/"+name+"/assurance/procedure.yaml")),
      /ue-requested-pdu-session-establishment/);
    assert.match(decode(h.files.get(skillRoot+"/"+name+"/assurance/procedure.yaml")),
      /CA-SL v1alpha4/);
  }
  assert.equal(decode(h.files.get(procedurePath)).includes("ue-requested-pdu-session-establishment"),false);
  assert.ok(h.files.has(skillRoot+"/establish-pdu-session-mas/assurance/openamsm-operation-mapping.md"));
  assert.ok(h.files.has(root+"/README.md"));
  assert.ok(h.files.has(root+"/examples/v1alpha4-candidate/README.md"),
    "the migration preserves the previous candidate README rather than deleting it");
});

test("Progress covers the v1alpha4 import and reimport preserves user edits",async()=>{
  const h=host(),events=[];
  const first=await seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage"),
    {onProgress:event=>events.push({...event})});
  const progress=events.filter(event=>event.phase==="files");
  assert.equal(progress.length,total+1);
  assert.equal(progress[0].total,total);
  assert.deepEqual(progress.map(event=>event.completed),
    Array.from({length:total+1},(_,index)=>index));
  assert.equal(events.at(-1).phase,"project-ready");
  const userProcedure=new TextEncoder().encode("user-authored v1alpha4 edit");
  h.files.set(first.procedure.path,userProcedure);
  const second=await seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage"));
  assert.equal(second.skipped,total);
  assert.equal(second.created,0);
  assert.equal(second.overwritten,0);
  assert.deepEqual(h.files.get(first.procedure.path),userProcedure,
    "a user-edited Skill Source is never overwritten");
});

test("Example import does not fabricate lib or output directories",async()=>{
  const h=host(),result=await seedExampleProject(
    h.vscode,uri("/extension"),uri("/global-storage"));
  for(const name of ["lib","output"])
    await assert.rejects(h.vscode.workspace.fs.stat(uri(result.root.path+"/"+name)),
      error=>error.code==="FileNotFound");
});

test("Explicit reset replaces active v1alpha4 packages and refreshes the Example README",async()=>{
  const h=host(),first=await seedExampleProject(
    h.vscode,uri("/extension"),uri("/global-storage"));
  const extra=skillRoot+"/establish-pdu-session/notes.local.md";
  h.files.set(first.procedure.path,new TextEncoder().encode("local edit"));
  h.files.set(extra,new TextEncoder().encode("local extra"));
  const reset=await seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage"),
    {resetExisting:true});
  assert.equal(reset.resetPackages,2);
  assert.equal(reset.created,total);
  assert.equal(reset.overwritten,0);
  assert.equal(reset.skipped,0);
  assert.equal(reset.readmeUpdated,true);
  assert.equal(h.files.has(extra),false);
  assert.deepEqual(h.files.get(first.procedure.path),bundled(
    "establish-pdu-session/assurance/procedure.yaml"));
});

test("Malformed or falsely qualified v1alpha4 manifests refuse all writes",async()=>{
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
