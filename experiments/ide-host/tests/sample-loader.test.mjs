import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {seedExampleWorkspace,EXAMPLE_PROJECT_DIRECTORY,
  EXAMPLE_PROJECT_NAME} from "../vscode/src/sample-loader.mjs";

const sampleRoot="site/samples/skills/";
const manifest=JSON.parse(readFileSync(sampleRoot+"files.json","utf8"));
const uri=path=>({path,toString(){return "file://"+path;}});
const joinPath=(base,...paths)=>uri([base.path,...paths].join("/"));
function host(manifestOverride=null,existing=[]){
  const files=new Map(),folders=new Set(),opened=[],writes=[];
  const vscode={
    Uri:{file:uri,joinPath},
    workspace:{
      workspaceFolders:[...existing],
      fs:{
        async readFile(target){
          if(target.path==="/extension/samples/skills/files.json"&&manifestOverride!==null)
            return new TextEncoder().encode(JSON.stringify(manifestOverride));
          if(target.path.startsWith("/extension/samples/skills/"))
            return new Uint8Array(readFileSync(sampleRoot+
              target.path.slice("/extension/samples/skills/".length)));
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
          writes.push(target.path);
        }
      },
      updateWorkspaceFolders(start,count,folder){
        opened.push({start,count,folder});
        vscode.workspace.workspaceFolders.splice(start,count,folder);
        return true;
      }
    }
  };
  return {vscode,files,folders,opened,writes};
}
const exampleRoot="/global-storage/"+EXAMPLE_PROJECT_DIRECTORY;
test("new Example has exactly two pinned formal Skills and only skills/ as initial directory",async()=>{
  const h=host(),result=await seedExampleWorkspace(h.vscode,uri("/extension"),uri("/global-storage"));
  assert.equal(result.files,manifest.files.length);
  assert.equal(result.created,manifest.files.length);
  assert.deepEqual(result.skills,["establish-pdu-session","establish-pdu-session-mas"]);
  assert.equal(result.sourceSha,manifest.sourceSha);
  assert.equal(result.root.path,exampleRoot);
  assert.equal(result.skillsRoot.path,exampleRoot+"/skills");
  assert.equal(h.opened.length,1);
  assert.equal(h.opened[0].folder.name,EXAMPLE_PROJECT_NAME);
  assert.deepEqual([...h.folders].sort(),[exampleRoot,exampleRoot+"/skills",
    ...[...h.folders].filter(x=>x.startsWith(exampleRoot+"/skills/"))].sort());
  assert.ok(![...h.folders].some(x=>x===exampleRoot+"/lib"||x===exampleRoot+"/output"));
  assert.ok([...h.files.keys()].every(x=>x.startsWith(exampleRoot+"/skills/")));
  assert.equal(h.files.size,manifest.files.length);
  for(const name of result.skills){
    const procedure=result.procedures[name].path;
    assert.match(new TextDecoder().decode(h.files.get(procedure)),/procedures:/);
    assert.ok(h.files.has(exampleRoot+"/skills/"+name+"/SKILL.md"));
  }
});
test("repeated import preserves edited Source in both Skills",async()=>{
  const h=host(),base=uri("/extension"),storage=uri("/global-storage");
  const first=await seedExampleWorkspace(h.vscode,base,storage);
  const edits=[first.procedure.path,first.procedures["establish-pdu-session-mas"].path];
  const bytes=new TextEncoder().encode("# edited by user");
  for(const path of edits)h.files.set(path,bytes);
  const result=await seedExampleWorkspace(h.vscode,base,storage);
  assert.equal(result.created,0);
  assert.equal(result.skipped,manifest.files.length);
  assert.equal(result.workspaceUpdated,false);
  for(const path of edits)assert.deepEqual(h.files.get(path),bytes);
});
test("legacy OPFS workspace remains byte-for-byte untouched and mount is replaced",async()=>{
  const oldRoot=uri("/global-storage/workspaces");
  const oldSkills=uri("/global-storage/workspaces/skills");
  for(const legacy of [oldRoot,oldSkills]){
    const h=host(null,[{uri:legacy,name:"Legacy Workspace"}]);
    const oldSource=oldSkills.path+"/establish-pdu-session/SKILL.md";
    const bytes=new TextEncoder().encode("# legacy user data");
    h.files.set(oldSource,bytes);
    const result=await seedExampleWorkspace(h.vscode,uri("/extension"),uri("/global-storage"));
    assert.equal(result.root.path,exampleRoot);
    assert.deepEqual(h.files.get(oldSource),bytes);
    assert.equal(h.writes.some(p=>p.startsWith(oldRoot.path+"/")),false);
    assert.deepEqual(h.opened.map(x=>[x.start,x.count]),[[0,1]]);
    assert.deepEqual(h.vscode.workspace.workspaceFolders.map(x=>x.uri.path),[exampleRoot]);
  }
});
test("an unrelated user workspace is never replaced or written",async()=>{
  const original={name:"skills",uri:uri("/user-project/skills")};
  const h=host(null,[original]);
  await seedExampleWorkspace(h.vscode,uri("/extension"),uri("/global-storage"));
  assert.deepEqual(h.opened.map(x=>[x.start,x.count]),[[1,0]]);
  assert.equal(h.vscode.workspace.workspaceFolders[0],original);
  assert.equal(h.writes.some(p=>p.startsWith("/user-project/")),false);
});
test("unsafe, duplicate and divergent manifests reject before any writes",async()=>{
  for(const override of [
    {...manifest,files:[...manifest.files,"../outside"]},
    {...manifest,files:[...manifest.files,"/absolute"]},
    {...manifest,files:[...manifest.files,manifest.files[0]]},
    {...manifest,files:[...manifest.files,"third-skill/SKILL.md"]},
    {...manifest,skills:["establish-pdu-session"]},
    {...manifest,sourceSha:"unknown"}
  ]){
    const h=host(override);
    await assert.rejects(seedExampleWorkspace(h.vscode,uri("/extension"),uri("/global-storage")));
    assert.equal(h.files.size,0);
    assert.equal(h.writes.length,0);
  }
});
