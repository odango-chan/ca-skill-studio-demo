import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {seedExampleWorkspace} from "../vscode/src/sample-loader.mjs";

const sampleRoot="site/samples/skills/";
const manifest=JSON.parse(readFileSync(sampleRoot+"files.json","utf8"));
const uri=path=>({path,toString(){return "file://"+path;}});
const joinPath=(base,...paths)=>uri([base.path,...paths].join("/"));
function host(manifestOverride=null,existing=[]){
  const files=new Map(),folders=new Set(),opened=[],folderListeners=new Set();
  const workspace={
    workspaceFolders:[...existing],
    onDidChangeWorkspaceFolders(listener){
      folderListeners.add(listener);
      return {dispose(){folderListeners.delete(listener);}};
    },
    fs:{
        async readFile(target){
          if(target.path==="/extension/samples/skills/files.json"&&manifestOverride!==null)
            return new TextEncoder().encode(JSON.stringify(manifestOverride));
          if(target.path.startsWith("/extension/samples/skills/")){
            return new Uint8Array(readFileSync(
              sampleRoot+target.path.slice("/extension/samples/skills/".length)));
          }
          const found=files.get(target.path);
          if(found)return found;
          throw Object.assign(Error("missing"),{code:"FileNotFound"});
        },
        async createDirectory(target){folders.add(target.path);},
        async stat(target){
          if(files.has(target.path)||folders.has(target.path)||
             [...files.keys()].some(path=>path.startsWith(target.path+"/"))||
             [...folders].some(path=>path.startsWith(target.path+"/")))return {type:1};
          throw Object.assign(Error("missing"),{code:"FileNotFound"});
        },
        async delete(target){
          const prefix=target.path+"/";
          let found=false;
          for(const path of [...files.keys()])
            if(path===target.path||path.startsWith(prefix)){files.delete(path);found=true;}
          for(const path of [...folders])
            if(path===target.path||path.startsWith(prefix)){folders.delete(path);found=true;}
          if(!found)throw Object.assign(Error("missing"),{code:"FileNotFound"});
        },
        async writeFile(target,bytes){
          assert.ok(folders.has(target.path.slice(0,target.path.lastIndexOf("/"))));
          files.set(target.path,new Uint8Array(bytes));
        }
      },
    updateWorkspaceFolders(start,count,folder){
      opened.push({start,count,folder});
      // Theia's API returns before the main-side workspace update completes.
      // Model the real asynchronous onDidChangeWorkspaceFolders confirmation.
      setTimeout(()=>{
        workspace.workspaceFolders.splice(start,count,folder);
        for(const listener of folderListeners)
          listener({added:[folder],removed:[],changed:[]});
      },5);
      return true;
    }
  };
  const vscode={Uri:{file:uri,joinPath},workspace};
  return {vscode,files,folders,opened,workspace};
}
test("Sample creates both exact pinned owner SKILL packages in one source-only project root",async()=>{
  const h=host(),result=await seedExampleWorkspace(h.vscode,uri("/extension"),uri("/global-storage"));
  assert.equal(result.files,manifest.files.length);
  assert.equal(result.created,manifest.files.length);
  assert.equal(result.skipped,0);
  assert.equal(manifest.sourceRepo,"odango-chan/ca-skills");
  assert.equal(manifest.sourceSha,"3fce09aca32b6a6faf6ec3e9a204d38cc129ec38");
  assert.equal(result.sourceSha,manifest.sourceSha);
  assert.deepEqual(result.skills,["establish-pdu-session","establish-pdu-session-mas"]);
  assert.ok(result.workspaceUpdated);
  assert.equal(h.opened.length,1);
  assert.equal(h.opened[0].folder.uri.path.split("/").at(-1),"skill-studio-demo");
  assert.equal(result.root.path,"/global-storage/skill-studio-demo");
  assert.equal(result.skillsRoot.path,result.root.path+"/skills");
  assert.ok(h.files.has(result.procedures["establish-pdu-session"].path));
  assert.ok(h.files.has(result.procedures["establish-pdu-session-mas"].path));
  assert.equal(manifest.files.length,18);
  assert.ok(!manifest.files.some(p=>p.includes("/cases/")));
  assert.ok(!manifest.files.some(p=>p.endsWith("n1n2-delivery.schema.yaml")),
    "superseded ca-agent-demo Schemas must not be imported");
  assert.ok(h.opened[0].folder.uri.path===result.root.path);
  assert.deepEqual(h.workspace.workspaceFolders.map(folder=>folder.uri.path),
    [result.root.path],"seed must wait until Theia reports the real project root");
  assert.equal(h.files.size,manifest.files.length,
    "lib/ and output/ must never contain fabricated compiler inputs or outputs");
  for(const name of result.skills){
    const p=result.procedures[name].path;
    const text=new TextDecoder().decode(h.files.get(p));
    assert.match(text,/procedures:/);
    assert.ok(h.files.has(result.skillsRoot.path+"/"+name+"/SKILL.md"));
    assert.ok(h.files.has(result.skillsRoot.path+"/"+name+"/assurance/contract.yaml"));
  }
  assert.ok(h.files.has(result.skillsRoot.path+"/establish-pdu-session/scripts/build_n1n2_delivery.py"));
  assert.equal(result.procedure.path,result.procedures["establish-pdu-session"].path);
});
test("Sample import reports actual file-count progress and workspace activation without overwriting",async()=>{
  const h=host(),events=[],base=uri("/extension"),storage=uri("/global-storage");
  const first=await seedExampleWorkspace(h.vscode,base,storage,{
    onProgress:event=>events.push({...event})
  });
  assert.equal(events[0]?.phase,"manifest");
  const files=events.filter(event=>event.phase==="files");
  assert.equal(files.length,manifest.files.length+1);
  assert.equal(files[0].completed,0);
  assert.equal(files[0].total,manifest.files.length);
  assert.deepEqual(files.map(event=>event.completed),
    Array.from({length:manifest.files.length+1},(_,i)=>i));
  assert.equal(events.at(-1)?.phase,"workspace");
  assert.equal(first.created,manifest.files.length);
  const edited=first.procedures["establish-pdu-session-mas"].path;
  h.files.set(edited,new TextEncoder().encode("user-modified MAS"));
  const repeat=[];
  const second=await seedExampleWorkspace(h.vscode,base,storage,{
    onProgress:event=>repeat.push(event)
  });
  assert.equal(second.skipped,manifest.files.length);
  assert.equal(second.created,0);
  assert.deepEqual(repeat.filter(event=>event.phase==="files").map(event=>event.completed),
    Array.from({length:manifest.files.length+1},(_,i)=>i));
  assert.equal(new TextDecoder().decode(h.files.get(edited)),"user-modified MAS");
});

test("New project does not create legacy lib/ or output/ directories",async()=>{
  const h=host(),result=await seedExampleWorkspace(h.vscode,uri("/extension"),uri("/global-storage"));
  for(const name of ["lib","output"]){
    await assert.rejects(h.vscode.workspace.fs.stat(uri(result.root.path+"/"+name)),
      error=>error.code==="FileNotFound");
  }
  assert.ok(await h.vscode.workspace.fs.stat(result.skillsRoot));
  assert.ok([...h.files.keys()].every(path=>path.startsWith(result.skillsRoot.path+"/")));
});

test("Repeated dual-SKILL import never overwrites user edits, including MAS",async()=>{
  const h=host(),base=uri("/extension"),storage=uri("/global-storage");
  const a=await seedExampleWorkspace(h.vscode,base,storage);
  const originalMas=a.procedures["establish-pdu-session-mas"].path;
  const originalMain=a.procedure.path;
  const one=new TextEncoder().encode("# custom MAS source\\n");
  const two=new TextEncoder().encode("# custom conventional source\\n");
  h.files.set(originalMas,one);h.files.set(originalMain,two);
  const b=await seedExampleWorkspace(h.vscode,base,storage);
  assert.equal(b.created,0);
  assert.equal(b.skipped,b.files);
  assert.equal(b.workspaceUpdated,false);
  assert.deepEqual(h.files.get(originalMas),one);
  assert.deepEqual(h.files.get(originalMain),two);
});
test("A user workspace named skills is not repurposed for the demo",async()=>{
  const userRoot={name:"skills",uri:uri("/user-project/skills")};
  const h=host(null,[userRoot]);
  const result=await seedExampleWorkspace(h.vscode,uri("/extension"),uri("/global-storage"));
  assert.equal(result.root.path,"/global-storage/skill-studio-demo");
  assert.equal(result.skillsRoot.path,result.root.path+"/skills");
  assert.equal(h.opened.length,1);
  assert.equal(h.opened[0].start,1);
  assert.equal(h.opened[0].folder.uri.path.split("/").at(-1),"skill-studio-demo");
  assert.equal(h.files.has("/user-project/skills/SKILL.md"),false);
});
test("Reset replaces the legacy Skills workspace with the canonical named project",async()=>{
  const oldSkills=uri("/global-storage/workspaces/skills");
  const h=host(null,[{name:"skills",uri:oldSkills}]);
  h.folders.add(oldSkills.path);
  h.folders.add(oldSkills.path+"/establish-pdu-session");
  const edited=oldSkills.path+"/establish-pdu-session/SKILL.md";
  const custom=new TextEncoder().encode("# user edits must be cleared");
  h.files.set(edited,custom);
  const result=await seedExampleWorkspace(h.vscode,uri("/extension"),uri("/global-storage"),{
    resetExisting:true
  });
  assert.equal(result.root.path,"/global-storage/skill-studio-demo");
  assert.equal(result.skillsRoot.path,result.root.path+"/skills");
  assert.equal(result.created,manifest.files.length);
  assert.equal(result.skipped,0);
  assert.equal(result.resetExisting,true);
  assert.equal(result.resetPackages,1);
  assert.equal(result.workspaceUpdated,true);
  assert.deepEqual(h.opened.map(x=>({start:x.start,count:x.count})),[{start:0,count:1}]);
  assert.deepEqual(h.vscode.workspace.workspaceFolders.map(x=>x.uri.path),[result.root.path]);
  assert.equal(h.files.has(edited),false,"legacy edited package must be removed from the old location");
  assert.ok(h.files.has(result.skillsRoot.path+"/establish-pdu-session/SKILL.md"));
});
test("Explicit online-demo reset overwrites both bundled Skills and removes package-local extras",async()=>{
  const h=host(),base=uri("/extension"),storage=uri("/global-storage");
  const first=await seedExampleWorkspace(h.vscode,base,storage);
  const editedMain=first.procedure.path;
  const editedMas=first.procedures["establish-pdu-session-mas"].path;
  h.files.set(editedMain,new TextEncoder().encode("# modified procedure"));
  h.files.set(editedMas,new TextEncoder().encode("# modified MAS"));
  const extra=first.skillsRoot.path+"/establish-pdu-session/notes.local.md";
  h.files.set(extra,new TextEncoder().encode("local extra"));
  const reset=await seedExampleWorkspace(h.vscode,base,storage,{resetExisting:true});
  assert.equal(reset.resetPackages,2);
  assert.equal(reset.created,manifest.files.length);
  assert.equal(reset.skipped,0);
  assert.equal(h.files.has(extra),false);
  assert.deepEqual(h.files.get(editedMain),new Uint8Array(readFileSync(
    sampleRoot+"establish-pdu-session/assurance/procedure.yaml")));
  assert.deepEqual(h.files.get(editedMas),new Uint8Array(readFileSync(
    sampleRoot+"establish-pdu-session-mas/assurance/procedure.yaml")));
});

test("Malformed, cross-package, traversing or duplicate manifests refuse writes",async()=>{
  const wrong=[
    {...manifest,files:[...manifest.files,"../outside"]},
    {...manifest,files:[...manifest.files,"/absolute"]},
    {...manifest,files:[...manifest.files,manifest.files[0]]},
    {...manifest,files:[...manifest.files,"third-skill/SKILL.md"]},
    {...manifest,skills:["establish-pdu-session"]},
    {...manifest,sourceSha:"unknown"},
    {...manifest,sourceRepo:"odango-chan/ca-agent-demo"}
  ];
  for(const data of wrong){
    const h=host(data);
    await assert.rejects(seedExampleWorkspace(h.vscode,uri("/extension"),uri("/global-storage")));
    assert.equal(h.files.size,0);
  }
});
