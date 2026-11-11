import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {seedExampleWorkspace} from "../vscode/src/sample-loader.mjs";

const sampleRoot="site/samples/skills/";
const manifest=JSON.parse(readFileSync(sampleRoot+"files.json","utf8"));
const uri=path=>({path,toString(){return "file://"+path;}});
const joinPath=(base,...paths)=>uri([base.path,...paths].join("/"));
function host(manifestOverride=null,existing=[]){
  const files=new Map(),folders=new Set(),opened=[];
  const vscode={
    Uri:{file:uri,joinPath},
    workspace:{
      workspaceFolders:[...existing],
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
          if(files.has(target.path)||folders.has(target.path))return {type:1};
          throw Object.assign(Error("missing"),{code:"FileNotFound"});
        },
        async writeFile(target,bytes){
          assert.ok(folders.has(target.path.slice(0,target.path.lastIndexOf("/"))));
          files.set(target.path,new Uint8Array(bytes));
        }
      },
      updateWorkspaceFolders(start,count,folder){
        opened.push({start,count,folder});
        vscode.workspace.workspaceFolders.splice(start,count,folder);
        return true;
      }
    }
  };
  return {vscode,files,opened};
}
test("Sample creates both exact pinned owner SKILL packages in one Skill Compiler project root",async()=>{
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
  assert.equal(h.opened[0].folder.name,"skill-studio-demo");
  assert.equal(result.root.path,"/global-storage/workspaces");
  assert.equal(result.skillsRoot.path,result.root.path+"/skills");
  assert.equal(result.libraryRoot.path,result.root.path+"/lib");
  assert.equal(result.outputRoot.path,result.root.path+"/output");
  assert.ok(h.files.has(result.procedures["establish-pdu-session"].path));
  assert.ok(h.files.has(result.procedures["establish-pdu-session-mas"].path));
  assert.equal(manifest.files.length,18);
  assert.ok(!manifest.files.some(p=>p.includes("/cases/")));
  assert.ok(!manifest.files.some(p=>p.endsWith("n1n2-delivery.schema.yaml")),
    "superseded ca-agent-demo Schemas must not be imported");
  assert.ok(h.opened[0].folder.uri.path===result.root.path);
  assert.equal(h.files.size,manifest.files.length,
    "lib/ and output/ must never contain fabricated compiler inputs or outputs");
  for(const name of result.skills){
    const p=result.procedures[name].path;
    const text=new TextDecoder().decode(h.files.get(p));
    assert.match(text,/procedures:/);
    assert.ok(h.files.has("/global-storage/workspaces/skills/"+name+"/SKILL.md"));
    assert.ok(h.files.has("/global-storage/workspaces/skills/"+name+"/assurance/contract.yaml"));
  }
  assert.ok(h.files.has("/global-storage/workspaces/skills/establish-pdu-session/scripts/build_n1n2_delivery.py"));
  assert.equal(result.procedure.path,result.procedures["establish-pdu-session"].path);
});
test("New project keeps imported library and generated output empty and isolated",async()=>{
  const h=host(),result=await seedExampleWorkspace(h.vscode,uri("/extension"),uri("/global-storage"));
  for(const folder of [result.root,result.skillsRoot,result.libraryRoot,result.outputRoot])
    assert.ok(await h.vscode.workspace.fs.stat(folder));
  assert.equal([...h.files.keys()].filter(path=>
    path.startsWith(result.libraryRoot.path+"/")||path.startsWith(result.outputRoot.path+"/")).length,0);
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
  assert.equal(result.root.path,"/global-storage/workspaces");
  assert.equal(result.skillsRoot.path,result.root.path+"/skills");
  assert.equal(h.opened.length,1);
  assert.equal(h.opened[0].start,1);
  assert.equal(h.opened[0].folder.name,"skill-studio-demo");
  assert.equal(h.files.has("/user-project/skills/SKILL.md"),false);
});
test("Existing legacy skills Workspace is upgraded in place without losing edited Source",async()=>{
  const oldSkills=uri("/global-storage/workspaces/skills");
  const h=host(null,[{name:"skills",uri:oldSkills}]);
  const edited="/global-storage/workspaces/skills/establish-pdu-session/SKILL.md";
  const custom=new TextEncoder().encode("# keep my edited SKILL content");
  h.files.set(edited,custom);
  const result=await seedExampleWorkspace(h.vscode,uri("/extension"),uri("/global-storage"));
  assert.equal(result.root.path,"/global-storage/workspaces");
  assert.equal(result.skillsRoot.path,oldSkills.path);
  assert.equal(result.created,manifest.files.length-1);
  assert.equal(result.skipped,1);
  assert.equal(result.workspaceUpdated,true);
  assert.deepEqual(h.opened.map(x=>({start:x.start,count:x.count})),[{start:0,count:1}]);
  assert.deepEqual(h.vscode.workspace.workspaceFolders.map(x=>x.uri.path),[result.root.path]);
  assert.deepEqual(h.files.get(edited),custom);
  assert.ok(await h.vscode.workspace.fs.stat(result.libraryRoot));
  assert.ok(await h.vscode.workspace.fs.stat(result.outputRoot));
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
