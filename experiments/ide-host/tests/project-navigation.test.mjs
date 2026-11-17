import test from "node:test";
import assert from "node:assert/strict";
import {
  PENDING_EXAMPLE_OPEN_KEY,isSingleFolderWorkspace,openProjectFolder,
  restorePendingExampleProject
} from "../vscode/src/project-navigation.mjs";

const uri=value=>({value,toString(){return value;}});
function makeHost({folders=[],workspaceFile=undefined,pending=undefined}={}){
  const calls=[],updates=[];
  const state=new Map();
  if(pending!==undefined)state.set(PENDING_EXAMPLE_OPEN_KEY,pending);
  const vscode={
    Uri:{parse:value=>uri(value)},
    workspace:{workspaceFolders:folders,workspaceFile},
    commands:{async executeCommand(...args){calls.push(args);}},
  };
  const context={globalState:{
    get:key=>state.get(key),
    async update(key,value){updates.push([key,value]);if(value===undefined)state.delete(key);else state.set(key,value);}
  }};
  return {vscode,context,calls,updates,state};
}

test("project folders open through the native same-window folder command",async()=>{
  const root=uri("file:///workspace/my-skill-project");
  const h=makeHost();
  await openProjectFolder(h.vscode,root);
  assert.deepEqual(h.calls,[["vscode.openFolder",root,{forceReuseWindow:true}]]);
});

test("only a single matching folder without a workspace file is a named folder workspace",()=>{
  const root=uri("file:///workspace/skill-studio-demo");
  assert.equal(isSingleFolderWorkspace({workspace:{workspaceFolders:[{uri:root}]}},root),true);
  assert.equal(isSingleFolderWorkspace({workspace:{workspaceFolders:[{uri:root}],workspaceFile:uri("file:///tmp/Untitled.theia-workspace")}},root),false);
  assert.equal(isSingleFolderWorkspace({workspace:{workspaceFolders:[{uri:root},{uri:uri("file:///workspace/other")}]}},root),false);
  assert.equal(isSingleFolderWorkspace({workspace:{workspaceFolders:[]}},root),false);
});

test("pending Example restoration waits for the named folder, then opens Procedure once",async()=>{
  const root="file:///global-storage/skill-studio-demo";
  const procedure=root+"/skills/establish-pdu-session/assurance/procedure.yaml";
  const pending={root,procedure,files:18,skipped:2,skills:["establish-pdu-session","establish-pdu-session-mas"]};
  const h=makeHost({folders:[{uri:uri(root)}],pending});
  let revealed=0,restored=null;
  const result=await restorePendingExampleProject(h.vscode,h.context,{
    async revealPackages(){revealed++;},
    onRestored(value){restored=value;}
  });
  assert.equal(result,true);
  assert.equal(revealed,1);
  assert.deepEqual(h.calls,[["skillStudio.openProcedure",uri(procedure)]]);
  assert.equal(restored,pending);
  assert.equal(h.state.has(PENDING_EXAMPLE_OPEN_KEY),false);
  assert.deepEqual(h.updates,[[PENDING_EXAMPLE_OPEN_KEY,undefined]]);
});

test("pending Example is not consumed by a different or Untitled multi-root workspace",async()=>{
  const root="file:///global-storage/skill-studio-demo";
  const pending={root,procedure:root+"/skills/example/assurance/procedure.yaml"};
  const h=makeHost({
    folders:[{uri:uri("file:///workspace/user-project")}],
    workspaceFile:uri("file:///workspace/Untitled-4.theia-workspace"),
    pending
  });
  const result=await restorePendingExampleProject(h.vscode,h.context);
  assert.equal(result,false);
  assert.equal(h.calls.length,0);
  assert.equal(h.state.get(PENDING_EXAMPLE_OPEN_KEY),pending);
  assert.equal(h.updates.length,0);
});

test("failed pending Example restoration clears stale state and propagates the error",async()=>{
  const root="file:///global-storage/skill-studio-demo";
  const pending={root,procedure:root+"/skills/example/assurance/procedure.yaml"};
  const h=makeHost({folders:[{uri:uri(root)}],pending});
  h.vscode.commands.executeCommand=async(...args)=>{
    h.calls.push(args);
    throw Error("Procedure editor unavailable");
  };
  await assert.rejects(
    restorePendingExampleProject(h.vscode,h.context),
    /Procedure editor unavailable/
  );
  assert.equal(h.state.has(PENDING_EXAMPLE_OPEN_KEY),false);
  assert.deepEqual(h.updates,[[PENDING_EXAMPLE_OPEN_KEY,undefined]]);
});
