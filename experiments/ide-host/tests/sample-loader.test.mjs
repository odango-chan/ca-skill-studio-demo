import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {seedExampleWorkspace} from "../vscode/src/sample-loader.mjs";

const sampleRoot="site/samples/skills/";
const manifest=JSON.parse(readFileSync(sampleRoot+"files.json","utf8"));
const uri=path=>({path,toString(){return "file://"+path;}});
const joinPath=(base,...paths)=>uri((base.path+"/"+paths.join("/")).replace(/\\/+/g,"/"));
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
        vscode.workspace.workspaceFolders.push(folder);
        return true;
      }
    }
  };
  return {vscode,files,opened};
}
test("Sample creates both exact pinned owner SKILL packages beneath one skills root",async()=>{
  const h=host(),result=await seedExampleWorkspace(h.vscode,uri("/extension"),uri("/global-storage"));
  assert.equal(result.files,manifest.files.length);
  assert.equal(result.created,manifest.files.length);
  assert.equal(result.skipped,0);
  assert.equal(result.sourceSha,manifest.sourceSha);
  assert.deepEqual(result.skills,["establish-pdu-session","establish-pdu-session-mas"]);
  assert.ok(result.workspaceUpdated);
  assert.equal(h.opened.length,1);
  assert.equal(h.opened[0].folder.name,"skills");
  assert.equal(result.root.path,"/global-storage/workspaces/skills");
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
  assert.equal(result.root.path,"/global-storage/workspaces/skills");
  assert.equal(h.opened.length,1);
  assert.equal(h.opened[0].start,1);
  assert.equal(h.opened[0].folder.name,"skills");
  assert.equal(h.files.has("/user-project/skills/SKILL.md"),false);
});
test("Malformed, cross-package, traversing or duplicate manifests refuse writes",async()=>{
  const wrong=[
    {...manifest,files:[...manifest.files,"../outside"]},
    {...manifest,files:[...manifest.files,"/absolute"]},
    {...manifest,files:[...manifest.files,manifest.files[0]]},
    {...manifest,files:[...manifest.files,"third-skill/SKILL.md"]},
    {...manifest,skills:["establish-pdu-session"]},
    {...manifest,sourceSha:"unknown"}
  ];
  for(const data of wrong){
    const h=host(data);
    await assert.rejects(seedExampleWorkspace(h.vscode,uri("/extension"),uri("/global-storage")));
    assert.equal(h.files.size,0);
  }
});
