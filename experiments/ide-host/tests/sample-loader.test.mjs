import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {seedExampleProject} from "../vscode/src/sample-loader.mjs";
const officialRoot="site/samples/skills/",candidateRoot="site/samples/v1alpha4/";
const official=JSON.parse(readFileSync(officialRoot+"files.json","utf8"));
const candidate=JSON.parse(readFileSync(candidateRoot+"files.json","utf8"));
const uri=path=>({path,toString(){return "file://"+path;}});
const joinPath=(base,...paths)=>uri([base.path,...paths].join("/"));
function host(officialOverride=null,existing=[],candidateOverride=null){
 const files=new Map(),folders=new Set(),workspace={workspaceFolders:[...existing],fs:{
  async readFile(target){
   if(target.path==="/extension/samples/skills/files.json"&&officialOverride)return new TextEncoder().encode(JSON.stringify(officialOverride));
   if(target.path==="/extension/samples/v1alpha4/files.json"&&candidateOverride)return new TextEncoder().encode(JSON.stringify(candidateOverride));
   if(target.path.startsWith("/extension/samples/skills/"))return new Uint8Array(readFileSync(officialRoot+target.path.slice("/extension/samples/skills/".length)));
   if(target.path.startsWith("/extension/samples/v1alpha4/"))return new Uint8Array(readFileSync(candidateRoot+target.path.slice("/extension/samples/v1alpha4/".length)));
   const value=files.get(target.path);if(value)return value;
   throw Object.assign(Error("missing"),{code:"FileNotFound"});
  },
  async createDirectory(target){folders.add(target.path);},
  async stat(target){
   if(files.has(target.path)||folders.has(target.path)||[...files.keys()].some(p=>p.startsWith(target.path+"/"))||[...folders].some(p=>p.startsWith(target.path+"/")))return {type:1};
   throw Object.assign(Error("missing"),{code:"FileNotFound"});
  },
  async delete(target){
   const prefix=target.path+"/";let found=false;
   for(const p of [...files.keys()])if(p===target.path||p.startsWith(prefix)){files.delete(p);found=true;}
   for(const p of [...folders])if(p===target.path||p.startsWith(prefix)){folders.delete(p);found=true;}
   if(!found)throw Object.assign(Error("missing"),{code:"FileNotFound"});
  },
  async writeFile(target,bytes){
   assert.ok(folders.has(target.path.slice(0,target.path.lastIndexOf("/"))));
   files.set(target.path,new Uint8Array(bytes));
  }
 }};
 return {vscode:{Uri:{file:uri,joinPath},workspace},files,folders,workspace};
}
const total=official.files.length+candidate.files.length+1;
test("Example imports official Legacy Skills and separate v1alpha4 candidate sources",async()=>{
 const h=host(),r=await seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage"));
 assert.equal(official.sourceSha,"dfba05071cb33424c475e00a325712f5273a19de");
 assert.equal(official.sourceStatus,"LEGACY_NOT_V1ALPHA4");
 assert.equal(candidate.sourceSha,"33664aec7ebc9bb1764618f839d01b7493425429");
 assert.equal(candidate.sourceStatus,"DRAFT_NOT_QUALIFIED");
 assert.equal(r.officialFiles,18);assert.equal(r.candidateFiles,14);
 assert.equal(r.files,total);assert.equal(r.created,total);assert.equal(r.skipped,0);
 assert.equal(r.root.path,"/global-storage/skill-studio-demo");
 assert.equal(r.skillsRoot.path,r.root.path+"/skills");
 assert.equal(r.examplesRoot.path,r.root.path+"/examples/v1alpha4-candidate");
 assert.equal(r.procedure.path,r.languageProcedures["establish-pdu-session"].path);
 assert.ok(h.files.has(r.procedures["establish-pdu-session"].path));
 assert.ok(h.files.has(r.languageProcedures["establish-pdu-session"].path));
 assert.ok(h.files.has(r.examplesRoot.path+"/README.md"));
 assert.equal(h.files.size,total);
 for(const name of r.skills){
  assert.match(new TextDecoder().decode(h.files.get(r.procedures[name].path)),/procedures:/);
  assert.match(new TextDecoder().decode(h.files.get(r.languageProcedures[name].path)),/start:/);
  assert.ok(h.files.has(r.skillsRoot.path+"/"+name+"/SKILL.md"));
  assert.ok(h.files.has(r.examplesRoot.path+"/"+name+"/SKILL.md"));
 }
 assert.match(new TextDecoder().decode(h.files.get(r.procedure.path)),/start: get-sm-subscription-data/);
 assert.doesNotMatch(new TextDecoder().decode(h.files.get(r.procedure.path)),/ueRef|ue-ref/);
 assert.match(new TextDecoder().decode(h.files.get(r.examplesRoot.path+"/README.md")),/DRAFT \/ NOT_QUALIFIED/);
 assert.deepEqual(h.workspace.workspaceFolders,[],"import never mutates the active workspace");
});
test("Progress covers both snapshots and reimport preserves all existing edits",async()=>{
 const h=host(),events=[];
 const first=await seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage"),{onProgress:e=>events.push({...e})});
 const progress=events.filter(e=>e.phase==="files");
 assert.equal(progress.length,total+1);assert.equal(progress[0].total,total);
 assert.deepEqual(progress.map(e=>e.completed),Array.from({length:total+1},(_,i)=>i));
 assert.equal(events.at(-1).phase,"project-ready");
 const officialEdit=first.procedures["establish-pdu-session-mas"].path,candidateEdit=first.procedure.path;
 h.files.set(officialEdit,new TextEncoder().encode("user official edit"));
 h.files.set(candidateEdit,new TextEncoder().encode("user candidate edit"));
 const second=await seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage"));
 assert.equal(second.skipped,total);assert.equal(second.created,0);
 assert.equal(new TextDecoder().decode(h.files.get(officialEdit)),"user official edit");
 assert.equal(new TextDecoder().decode(h.files.get(candidateEdit)),"user candidate edit");
});
test("Example import does not fabricate lib or output directories",async()=>{
 const h=host(),r=await seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage"));
 for(const name of ["lib","output"])await assert.rejects(h.vscode.workspace.fs.stat(uri(r.root.path+"/"+name)),e=>e.code==="FileNotFound");
});
test("Explicit reset replaces only the bundled package sets and their local extras",async()=>{
 const h=host(),first=await seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage"));
 const edited=first.procedure.path,extra=first.examplesRoot.path+"/establish-pdu-session/notes.local.md";
 h.files.set(edited,new TextEncoder().encode("local edit"));h.files.set(extra,new TextEncoder().encode("extra"));
 const reset=await seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage"),{resetExisting:true});
 assert.equal(reset.resetPackages,2);
 assert.equal(reset.created+reset.overwritten,total);
 assert.equal(reset.overwritten,1,"candidate README is outside package folders and is refreshed");
 assert.equal(h.files.has(extra),false);
 assert.deepEqual(h.files.get(edited),new Uint8Array(readFileSync(candidateRoot+"establish-pdu-session/assurance/procedure.yaml")));
});
test("Malformed or falsely qualified manifests refuse all writes",async()=>{
 for(const data of [
  {...official,files:[...official.files,"../outside"]},
  {...official,files:[...official.files,official.files[0]]},
  {...official,sourceSha:"unknown"},
  {...official,sourceStatus:"QUALIFIED"}
 ]){
  const h=host(data);await assert.rejects(seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage")));assert.equal(h.files.size,0);
 }
 for(const data of [
  {...candidate,files:[...candidate.files,"../outside"]},
  {...candidate,sourceSha:"unknown"},
  {...candidate,sourceStatus:"QUALIFIED"}
 ]){
  const h=host(null,[],data);await assert.rejects(seedExampleProject(h.vscode,uri("/extension"),uri("/global-storage")));assert.equal(h.files.size,0);
 }
});
