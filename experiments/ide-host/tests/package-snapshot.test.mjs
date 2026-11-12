import test from "node:test";
import assert from "node:assert/strict";
import { collectPackageSnapshot, packageRootForProcedure } from "../vscode/src/package-snapshot.mjs";

function makeUri(path, scheme = "file", authority = "") {
  return {
    path, scheme, authority,
    toString() { return scheme + "://" + authority + path; },
    with(change) { return makeUri(change.path ?? path, change.scheme ?? scheme, change.authority ?? authority); }
  };
}
function makeVscode({files,open=[],failReads=new Set(),enumerationError=null,largeFiles=new Set(),
  workspaceFolders=[],libraryFiles=[],libraryEnumerationError=null,libraryStatError=null}={}) {
  const uris=files??[];
  const libUris=libraryFiles??[];
  const reads=new Map([...uris,...libUris].map(uri=>
    [uri.toString(),new TextEncoder().encode("disk:"+uri.path)]));
  return {
    RelativePattern: class RelativePattern {
      constructor(base,pattern){this.base=base;this.pattern=pattern;}
    },
    workspace: {
      textDocuments:open,
      workspaceFolders,
      async findFiles(pattern,exclude,limit){
        assert.equal(pattern.pattern,"**/*");
        assert.ok(pattern.base);
        if(pattern.base.path.endsWith("/lib")){
          if(libraryEnumerationError)throw libraryEnumerationError;
          return libUris.slice(0,limit);
        }
        if(enumerationError)throw enumerationError;
        return uris.slice(0,limit);
      },
      fs:{
        async stat(uri){
          if(uri.path.endsWith("/lib")&&libraryStatError)throw libraryStatError;
          return {type:uri.path.endsWith("/lib")?2:1,
            size:largeFiles.has(uri.toString())?1024*1024+1:(reads.get(uri.toString())?.length??0)};
        },
        async readFile(uri){
          if(failReads.has(uri.toString()))throw new Error("permission denied");
          return reads.get(uri.toString())??new TextEncoder().encode("");
        }
      }
    }
  };
}
const root="/workspace/my-skill";
const procedureUri=makeUri(root+"/assurance/procedure.yaml");
const contractUri=makeUri(root+"/assurance/contract.yaml");
const predicatesUri=makeUri(root+"/assurance/predicates.yaml");
const pythonUri=makeUri(root+"/scripts/prepare.py");
const jsonUri=makeUri(root+"/schemas/request.json");
const unsavedNewUri=makeUri(root+"/scripts/new-unsaved.py");
function openDoc(uri,text,version){return {uri,version,getText:()=>text,isDirty:true};}

test("Package snapshot keeps exact root, required files, language ids and unsaved text",async()=>{
  const openProcedure=openDoc(procedureUri,"procedures: {unsaved: true}\n",9);
  const openPython=openDoc(pythonUri,"def unsaved(): pass\n",3);
  const openNew=openDoc(unsavedNewUri,"def notYetSaved(): pass\n",1);
  const vscode=makeVscode({
    files:[procedureUri,contractUri,predicatesUri,pythonUri,jsonUri],
    open:[openProcedure,openPython,openNew]
  });
  const snapshot=await collectPackageSnapshot(vscode,openProcedure,12);
  assert.equal(snapshot.rootUri,"file://"+root);
  assert.equal(snapshot.packageName,"my-skill");
  assert.equal(snapshot.generation,12);
  assert.equal(snapshot.completeness,"complete");
  assert.equal(snapshot.documents.length,6);
  const byPath=new Map(snapshot.documents.map(x=>[x.relativePath,x]));
  assert.equal(byPath.get("assurance/procedure.yaml").text,"procedures: {unsaved: true}\n");
  assert.equal(byPath.get("assurance/procedure.yaml").version,9);
  assert.equal(byPath.get("scripts/prepare.py").languageId,"python");
  assert.equal(byPath.get("scripts/prepare.py").text,"def unsaved(): pass\n");
  assert.equal(byPath.get("assurance/contract.yaml").version,0);
  assert.equal(byPath.get("schemas/request.json").languageId,"json");
  assert.equal(byPath.get("scripts/new-unsaved.py").text,"def notYetSaved(): pass\n");
  assert.equal(byPath.get("scripts/new-unsaved.py").version,1);
});

test("Package snapshot includes the exact project lib/ inventory as read-only LSP inputs",async()=>{
  const projectRoot=makeUri("/workspace/project");
  const packageRoot="/workspace/project/skills/my-skill";
  const procedure=makeUri(packageRoot+"/assurance/procedure.yaml");
  const contract=makeUri(packageRoot+"/assurance/contract.yaml");
  const predicates=makeUri(packageRoot+"/assurance/predicates.yaml");
  const tool=makeUri("/workspace/project/lib/tools/udm.tool.yaml");
  const ownerSchema=makeUri("/workspace/project/lib/host/subject.schema.yaml");
  const openProcedure=openDoc(procedure,"procedures: {}\\n",2);
  const openTool=openDoc(tool,"kind: ToolCatalog\\n",7);
  const vscode=makeVscode({
    files:[procedure,contract,predicates],
    libraryFiles:[tool,ownerSchema],
    open:[openProcedure,openTool],
    workspaceFolders:[{uri:projectRoot}]
  });
  const snapshot=await collectPackageSnapshot(vscode,openProcedure,5);
  assert.equal(snapshot.completeness,"complete");
  assert.equal(snapshot.libraryInventory,"complete");
  const byPath=new Map(snapshot.documents.map(item=>[item.relativePath,item]));
  assert.equal(byPath.get("lib/tools/udm.tool.yaml").text,"kind: ToolCatalog\\n");
  assert.equal(byPath.get("lib/tools/udm.tool.yaml").version,7);
  assert.equal(byPath.get("lib/host/subject.schema.yaml").text,
    "disk:/workspace/project/lib/host/subject.schema.yaml");
});

test("incomplete project lib/ inventory does not downgrade Package completeness or prove missing dependencies",async()=>{
  const projectRoot=makeUri("/workspace/project");
  const packageRoot="/workspace/project/skills/my-skill";
  const procedure=makeUri(packageRoot+"/assurance/procedure.yaml");
  const contract=makeUri(packageRoot+"/assurance/contract.yaml");
  const predicates=makeUri(packageRoot+"/assurance/predicates.yaml");
  const tool=makeUri("/workspace/project/lib/tools/udm.tool.yaml");
  const openProcedure=openDoc(procedure,"procedures: {}\\n",2);
  const vscode=makeVscode({
    files:[procedure,contract,predicates],libraryFiles:[tool],
    failReads:new Set([tool.toString()]),open:[openProcedure],
    workspaceFolders:[{uri:projectRoot}]
  });
  const snapshot=await collectPackageSnapshot(vscode,openProcedure,6);
  assert.equal(snapshot.completeness,"complete");
  assert.equal(snapshot.libraryInventory,"partial");
  assert.match(snapshot.libraryReason,/permission denied/);
});

test("Package file enumeration over limit is partial and prioritizes required assurance files",async()=>{
  const extras=Array.from({length:501},(_,i)=>makeUri(root+"/docs/file-"+String(i).padStart(3,"0")+".md"));
  const procedure=openDoc(procedureUri,"procedures: {}\n",1);
  const vscode=makeVscode({files:[procedureUri,contractUri,predicatesUri,pythonUri,...extras]});
  const snapshot=await collectPackageSnapshot(vscode,procedure,1);
  assert.equal(snapshot.completeness,"partial");
  assert.match(snapshot.reason,/500-file/);
  assert.ok(snapshot.documents.length<=500);
  const paths=new Set(snapshot.documents.map(x=>x.relativePath));
  assert.ok(paths.has("assurance/procedure.yaml"));
  assert.ok(paths.has("assurance/contract.yaml"));
  assert.ok(paths.has("assurance/predicates.yaml"));
});

test("read errors and oversized files mark the snapshot partial instead of clean",async()=>{
  const procedure=openDoc(procedureUri,"procedures: {}\n",1);
  const vscode=makeVscode({
    files:[procedureUri,contractUri,predicatesUri,jsonUri],
    failReads:new Set([contractUri.toString()]),
    largeFiles:new Set([predicatesUri.toString()])
  });
  const snapshot=await collectPackageSnapshot(vscode,procedure,2);
  assert.equal(snapshot.completeness,"partial");
  assert.match(snapshot.reason,/permission denied/);
  assert.match(snapshot.reason,/exceeds 1 MiB/);
  assert.equal(snapshot.documents.find(x=>x.relativePath==="assurance/contract.yaml").text,"");
});

test("enumeration failure yields unavailable snapshot with current Procedure text",async()=>{
  const procedure=openDoc(procedureUri,"procedures: {}\n",1);
  const vscode=makeVscode({enumerationError:new Error("workspace unavailable")});
  const snapshot=await collectPackageSnapshot(vscode,procedure,3);
  assert.equal(snapshot.completeness,"unavailable");
  assert.equal(snapshot.documents.length,1);
  assert.equal(snapshot.documents[0].text,"procedures: {}\n");
  assert.match(snapshot.reason,/workspace unavailable/);
});

test("foreign URIs are ignored and cannot escape the selected Package",async()=>{
  const procedure=openDoc(procedureUri,"procedures: {}\n",1);
  const foreign=makeUri("/workspace/my-skill-evil/assurance/contract.yaml");
  const vscode=makeVscode({files:[procedureUri,foreign]});
  const snapshot=await collectPackageSnapshot(vscode,procedure,4);
  assert.equal(snapshot.completeness,"partial");
  assert.equal(snapshot.documents.length,1);
  assert.match(snapshot.reason,/outside the selected Package root/);
});

test("invalid Procedure locations and generations fail before filesystem access",async()=>{
  const vscode=makeVscode();
  assert.equal(packageRootForProcedure(vscode,{uri:makeUri("/workspace/skill/procedure.yaml")}),null);
  await assert.rejects(()=>collectPackageSnapshot(vscode,
    openDoc(makeUri("/workspace/skill/procedure.yaml"),"",1),1),/not a supported/);
  await assert.rejects(()=>collectPackageSnapshot(vscode,
    openDoc(procedureUri,"",1),-1),/generation/);
});
