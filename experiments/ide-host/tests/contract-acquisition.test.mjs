import test from "node:test";
import assert from "node:assert/strict";
import {acquireUpload,acquireMcp,acquireGit,acquireBuiltin,readToolCatalog}
  from "../vscode/src/contract-acquisition.mjs";
import {calculateSnapshot} from "../vscode/src/dependency-snapshot.mjs";

const enc=new TextEncoder();
const declared={
  apiVersion:"connectionagent.io/toolcatalog/v1alpha4",kind:"ToolCatalog",
  metadata:{owner:"example-owner-unqualified"},
  spec:{contracts:[{
    id:"ping",kind:"operation",effect:"READ",
    inputSchema:{"$ref":"#/schemas/input"},
    outputSchema:{"$ref":"#/schemas/output"},
    ownerOutcomes:["SUCCEEDED","FAILED"]
  }]}
};
const yaml=`apiVersion: connectionagent.io/toolcatalog/v1alpha4
kind: ToolCatalog
metadata:
  owner: example-owner-unqualified
spec:
  contracts:
    - id: ping
      kind: operation
      effect: READ
      inputSchema: { $ref: "#/schemas/input" }
      outputSchema: { $ref: "#/schemas/output" }
      ownerOutcomes: [SUCCEEDED, FAILED]
`;

test("Upload preserves exact current ToolCatalog YAML and JSON bytes without Owner qualification",async()=>{
  const rawJson=enc.encode(JSON.stringify(declared));
  const rawYaml=enc.encode(yaml);
  const json=await acquireUpload({upload:"chosen-upload",format:"json",rawBytes:rawJson});
  const yml=await acquireUpload({upload:"chosen-upload",format:"yaml",rawBytes:rawYaml});
  assert.equal(json.kind,"tool-catalog");
  assert.equal(json.files[0].path,"tool-catalog.json");
  assert.equal(yml.files[0].path,"tool-catalog.yaml");
  assert.deepEqual(json.files[0].bytes,rawJson);
  assert.deepEqual(yml.files[0].bytes,rawYaml);
  assert.notEqual((await calculateSnapshot(json.files)).snapshotDigest,
    (await calculateSnapshot(yml.files)).snapshotDigest,
    "different real Source bytes must not be rewritten into a fake canonical contract");
  assert.notEqual(json.source.contentDigest,yml.source.contentDigest);
  assert.equal(readToolCatalog(rawJson,"json").operations[0].effect,"READ");
  assert.equal(readToolCatalog(rawYaml,"yaml").operations[0].owner,
    "example-owner-unqualified");
  assert.equal(json.operations[0].trusted,undefined);
  assert.equal(yml.operations[0].authorized,undefined);
});

test("MCP tools/list cannot forge Owner ToolCatalog or be pinned as trusted",async()=>{
  let called=0;
  await assert.rejects(acquireMcp({connectionId:"demo-mcp",
    selectedTools:["ping"],toolsList:async()=>{called++;return [];}}),
  /MCP tools\/list cannot publish a ToolCatalog/);
  assert.equal(called,0,"discovery does not generate an Owner publication or effect metadata");
  await assert.rejects(acquireMcp({connectionId:"Bad Alias"}),
    /connectionId is invalid/);
});

test("Git source retains exact pinned file and full commit, never claims Runtime READY",async()=>{
  const sha="a".repeat(40),bytes=enc.encode(yaml);
  const git=await acquireGit({repository:"https://github.com/example/tools",
    path:"contracts/tool-catalog.yaml",ref:"main",
    readPinnedFile:async request=>{
      assert.equal(request.ref,"main");
      assert.equal(request.path,"contracts/tool-catalog.yaml");
      return {commit:sha,bytes};
    }});
  assert.equal(git.resolvedRevision,sha);
  assert.equal(git.files[0].path,"contracts/tool-catalog.yaml");
  assert.deepEqual(git.files[0].bytes,bytes);
  assert.equal(git.operations[0].effect,"READ");
  assert.equal(git.operations[0].trusted,undefined);
  await assert.rejects(acquireGit({repository:"https://github.com/example/tools",
    path:"contracts/tools.yaml",ref:"main",
    readPinnedFile:async()=>({commit:"main",bytes})}),/full commit SHA/);
  await assert.rejects(acquireGit({repository:"https://github.com/example/tools",
    path:"../outside.yaml",ref:"main",
    readPinnedFile:async()=>({commit:sha,bytes})}),/Invalid.*path/);
});

test("new built-in identity is illustrative only and does not republish the retired version",async()=>{
  const built=await acquireBuiltin({
    bundleId:"studio-example-toolcatalog",version:"1.0.0"});
  assert.equal(built.source.bundleId,"studio-example-toolcatalog");
  assert.equal(built.files[0].path,"tool-catalog.yaml");
  assert.equal(built.operations[0].kind,"observation");
  assert.equal(built.operations[0].effect,"READ");
  assert.equal(built.operations[0].owner,"studio-example-unqualified");
  assert.equal(built.operations[0].trusted,undefined);
  await assert.rejects(acquireBuiltin({
    bundleId:"studio-example-tools",version:"1.0.0"}),/unknown current ToolCatalog/);
});

test("old tool contracts, duplicate callable IDs and invented effects fail closed",async()=>{
  const old=enc.encode(JSON.stringify({
    apiVersion:"skillc.tool/v0.1",
    operations:[{id:"ping",inputSchema:{type:"object"}}]
  }));
  await assert.rejects(acquireUpload({upload:"x",format:"json",rawBytes:old}),
    /ToolCatalog|v1alpha4/);
  const duplicate=JSON.parse(JSON.stringify(declared));
  duplicate.spec.contracts.push({...duplicate.spec.contracts[0]});
  await assert.rejects(acquireUpload({upload:"x",format:"json",
    rawBytes:enc.encode(JSON.stringify(duplicate))}),/duplicate ToolCatalog callable ID/);
  const invented=JSON.parse(JSON.stringify(declared));
  invented.spec.contracts[0].effect="UNKNOWN";
  await assert.rejects(acquireUpload({upload:"x",format:"json",
    rawBytes:enc.encode(JSON.stringify(invented))}),/invalid callable/);
  await assert.rejects(acquireUpload({upload:"x",format:"xml",rawBytes:old}),
    /only YAML\/JSON/);
});
