import test from "node:test";
import assert from "node:assert/strict";
import {acquireUpload,acquireMcp,acquireGit,acquireBuiltin,readToolContract}
  from "../vscode/src/contract-acquisition.mjs";
import {calculateSnapshot} from "../vscode/src/dependency-snapshot.mjs";
const enc=new TextEncoder();
const tool={apiVersion:"skillc.tool/v0.1",operations:[
  {id:"ping",inputSchema:{type:"object"},
    effect:{classification:"READ",authority:"OWNER"}}]};
test("Upload YAML and JSON become identical unverified canonical snapshots",async()=>{
  const json=await acquireUpload({upload:"chosen-upload",format:"json",
    rawBytes:enc.encode(JSON.stringify(tool))});
  const yaml=await acquireUpload({upload:"chosen-upload",format:"yaml",
    rawBytes:enc.encode("apiVersion: skillc.tool/v0.1\noperations:\n  - id: ping\n    inputSchema: {type: object}\n    effect: {classification: READ, authority: OWNER}\n")});
  assert.equal(json.operations[0].effect.classification,"UNKNOWN");
  assert.equal(json.operations[0].effect.authority,"UNVERIFIED");
  assert.equal((await calculateSnapshot(json.files)).snapshotDigest,
    (await calculateSnapshot(yaml.files)).snapshotDigest);
  assert.notEqual(json.source.contentDigest,yaml.source.contentDigest,
    "raw import digest must bind original upload bytes");
  assert.equal(readToolContract(json.files[0].bytes,"json").operations[0].effect.classification,
    "UNKNOWN");
});
test("MCP only discovers selected tools and refuses trust in annotations",async()=>{
  let calls=0;
  const discovered=await acquireMcp({connectionId:"demo-mcp",selectedTools:["ping"],
    async toolsList(id){
      calls++;
      assert.equal(id,"demo-mcp");
      return [{name:"ping",description:"Claims to be read-only",
        annotations:{readOnlyHint:true},
        inputSchema:{type:"object"},outputSchema:{type:"object"}},
        {name:"not-selected",inputSchema:{type:"object"}}];
    }});
  assert.equal(calls,1);
  assert.deepEqual(discovered.source.tools,["ping"]);
  assert.equal(discovered.operations.length,1);
  assert.deepEqual(discovered.operations[0].effect,
    {classification:"UNKNOWN",authority:"UNVERIFIED"});
  await assert.rejects(acquireMcp({connectionId:"demo-mcp",
    selectedTools:["missing"],toolsList:async()=>[{name:"ping",inputSchema:{}}]}),
    /inputSchema missing/);
  await assert.rejects(acquireMcp({connectionId:"demo-mcp",
    selectedTools:["ping"],toolsList:async()=>[{name:"ping"}]}),/inputSchema missing/);
});
test("Git source pins full commit, built-in pins version, neither claims Runtime READY",async()=>{
  const sha="a".repeat(40);
  const git=await acquireGit({repository:"https://github.com/example/tools",
    path:"contracts/tools.json",ref:"main",
    readPinnedFile:async request=>{
      assert.equal(request.ref,"main");
      return {commit:sha,bytes:enc.encode(JSON.stringify(tool))};
    }});
  assert.equal(git.resolvedRevision,sha);
  assert.equal(git.operations[0].effect.classification,"UNKNOWN");
  const builtin=await acquireBuiltin({bundleId:"studio-example-tools",version:"1.0.0"});
  assert.equal(builtin.source.version,"1.0.0");
  assert.equal(builtin.operations[0].effect.classification,"UNKNOWN");
  await assert.rejects(acquireGit({repository:"https://github.com/example/tools",
    path:"tools.json",ref:"main",readPinnedFile:async()=>({
      commit:"main",bytes:enc.encode("{}")})}),/full commit SHA/);
  await assert.rejects(acquireBuiltin({bundleId:"missing",version:"1"}),/unknown built-in/);
});
test("no unverified effect can be upgraded by malicious import metadata",async()=>{
  await assert.rejects(acquireUpload({upload:"x",format:"json",
    rawBytes:enc.encode('{"apiVersion":"skillc.tool/v0.1","operations":[{"id":"a","inputSchema":{}},{"id":"a","inputSchema":{}}]}')}),/duplicate|unique/);
  await assert.rejects(acquireUpload({upload:"x",format:"xml",rawBytes:enc.encode("{}")}),
    /only YAML and JSON/);
});
