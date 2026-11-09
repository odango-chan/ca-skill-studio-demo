import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {seedExampleWorkspace} from "../vscode/src/sample-loader.mjs";

const uri=path=>({path,toString(){return "file://"+path;}});
const joinPath=(base,...paths)=>uri((base.path+"/"+paths.join("/")).replace(/\/+/g,"/"));
function host(manifestOverride=null){
  const files=new Map(),folders=new Set(),opened=[];
  const vscode={
    Uri:{file:uri,joinPath},
    workspace:{
      workspaceFolders:[],
      fs:{
        async readFile(target){
          if(target.path==="/extension/samples/establish-pdu-session/files.json"&&manifestOverride!==null)
            return new TextEncoder().encode(JSON.stringify(manifestOverride));
          if(target.path.startsWith("/extension/samples/establish-pdu-session/")){
            return new Uint8Array(readFileSync(
              "experiments/ide-host/vscode"+target.path.slice("/extension".length)));
          }
          const found=files.get(target.path);
          if(found)return found;
          throw Object.assign(Error("missing"),{code:"FileNotFound"});
        },
        async createDirectory(target){folders.add(target.path);},
        async stat(target){
          if(files.has(target.path)||folders.has(target.path))return {type:1};
          if(target.path.startsWith("/extension/samples/establish-pdu-session/")){
            try{
              readFileSync("experiments/ide-host/vscode"+
                target.path.slice("/extension".length));
              return {type:1};
            }catch{}
          }
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
test("Sample command creates exact fixture in host filesystem, not a second buffer",async()=>{
  const h=host(),result=await seedExampleWorkspace(h.vscode,uri("/extension"));
  assert.ok(result.created>=16);
  assert.equal(result.files,result.created);
  assert.equal(result.skipped,0);
  assert.ok(result.workspaceUpdated);
  assert.equal(h.opened.length,1);
  const text=new TextDecoder().decode(h.files.get(result.procedure.path));
  assert.match(text,/procedures:/);
  assert.ok(h.files.has("/skill-studio-examples/establish-pdu-session/scripts/evaluate_udm_read.py"));
  assert.equal(result.root.path,"/skill-studio-examples/establish-pdu-session");
});
test("Repeated import never overwrites edited Source or any other file",async()=>{
  const h=host(),base=uri("/extension");
  const a=await seedExampleWorkspace(h.vscode,base);
  const modified=new TextEncoder().encode("# my new source\n");
  h.files.set(a.procedure.path,modified);
  const b=await seedExampleWorkspace(h.vscode,base);
  assert.equal(b.created,0);
  assert.equal(b.skipped,b.files);
  assert.equal(b.workspaceUpdated,false);
  assert.deepEqual(h.files.get(a.procedure.path),modified);
});
test("Traversal, duplicate and absolute sample manifests are rejected before writes",async()=>{
  for(const manifest of [
    ["SKILL.md","assurance/procedure.yaml","../outside"],
    ["SKILL.md","assurance/procedure.yaml","/absolute"],
    ["SKILL.md","assurance/procedure.yaml","SKILL.md"],
    ["SKILL.md","assurance/procedure.yaml","foo\\bar"]
  ]){
    const h=host(manifest);
    await assert.rejects(seedExampleWorkspace(h.vscode,uri("/extension")));
    assert.equal(h.files.size,0);
  }
});
