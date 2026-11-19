import test from "node:test";
import assert from "node:assert/strict";
import {
  projectDependencyReadiness,projectLockedToolCatalog
} from "../experiments/ide-host/vscode/src/dependency-catalog-projection.mjs";

const digest="sha256:"+"a".repeat(64);
const dep=id=>({id,kind:"tool-catalog",source:{type:"builtin"}});
const lock=id=>({id,kind:"tool-catalog",snapshotDigest:digest});
const verified=(id,files=[])=>({id,kind:"tool-catalog",snapshotDigest:digest,files});
const file=(path,contents)=>({path,bytes:Buffer.from(contents).toString("base64")});
const goodCatalog=`apiVersion: connectionagent.io/toolcatalog/v1alpha4
kind: ToolCatalog
metadata:
  owner: openamsm-smf
spec:
  contracts:
    - id: context.smf.session.read
      kind: observation
      effect: READ
      queryContextSchema: { $ref: "#/schemas/query" }
      outputSchema: { $ref: "#/schemas/result" }
      ownerOutcomes: [SUCCEEDED, FAILED]
`;

test("a verified lock is not trusted Owner or Runtime readiness",()=>{
  const node=projectDependencyReadiness(dep("ca"),lock("ca"),{
    status:"READY",snapshots:[verified("ca")],diagnostics:[]
  });
  assert.equal(node.state,"SNAPSHOT_VERIFIED");
  assert.equal(node.ownerState,"NOT_CHECKED");
  assert.equal(node.kind,"dependency");
});

test("missing, corrupt and unrelated locks never become READY",()=>{
  const unrelated=projectDependencyReadiness(dep("smf"),lock("smf"),{
    status:"READY",snapshots:[verified("ca")],diagnostics:[]
  });
  assert.equal(unrelated.state,"BLOCKED");
  const missing=projectDependencyReadiness(dep("ca"),lock("ca"),{
    status:"BLOCKED",snapshots:[],
    diagnostics:[{dependencyId:"ca",code:"DEPENDENCY_UNLOCKED",message:"No lock"}]
  });
  assert.equal(missing.state,"BLOCKED");
  const corrupt=projectDependencyReadiness(dep("ca"),lock("ca"),{
    status:"ERROR",snapshots:[],
    diagnostics:[{dependencyId:"ca",code:"LOCKED_SNAPSHOT_CORRUPT",message:"Wrong digest"}]
  });
  assert.equal(corrupt.state,"ERROR");
  assert.equal(corrupt.ownerState,"NOT_CHECKED");
});

test("resolver errors are scoped to the affected alias rather than every dependency",()=>{
  const resolution={
    status:"ERROR",snapshots:[verified("ca")],
    diagnostics:[{dependencyId:"smf",code:"LOCKED_SNAPSHOT_CORRUPT",message:"Corrupt SMF lock"}]
  };
  assert.equal(projectDependencyReadiness(dep("ca"),lock("ca"),resolution).state,
    "SNAPSHOT_VERIFIED");
  assert.equal(projectDependencyReadiness(dep("smf"),lock("smf"),resolution).state,
    "ERROR");
});

test("ToolCatalog v1alpha4 callable declarations are projected without Owner qualification",()=>{
  const catalog=projectLockedToolCatalog(verified("ca",[
    file("catalog.yaml",goodCatalog)
  ]));
  assert.equal(catalog.available,true);
  assert.deepEqual(catalog.operations.map(x=>({
    id:x.id,kind:x.kind,owner:x.owner,effect:x.effect
  })),[{id:"context.smf.session.read",kind:"observation",
    owner:"openamsm-smf",effect:"READ"}]);
  assert.equal(catalog.operations[0].trusted,undefined,
    "the declaration-only index must never manufacture Owner trust");
  assert.equal(catalog.operations[0].catalogPath,"catalog.yaml");
  const span=catalog.operations[0].idRange;
  assert.ok(span&&span.start<span.end);
  assert.equal(goodCatalog.slice(span.start,span.end),"context.smf.session.read",
    "Inspect must target the exact callable ID in the pinned YAML, not legacy JSON");
});

test("old skillc.tool/v0.1 JSON is no longer accepted as a callable declaration",()=>{
  const catalog=projectLockedToolCatalog(verified("ca",[
    file("tool-contract.json",JSON.stringify({
      apiVersion:"skillc.tool/v0.1",
      operations:[{id:"legacy.run",effect:{classification:"UNKNOWN"}}]
    }))
  ]));
  assert.equal(catalog.available,false);
  assert.deepEqual(catalog.operations,[]);
  assert.match(catalog.reason,/No v1alpha4 ToolCatalog/);
});

test("malformed or undecodable pinned ToolCatalog never shows invented operations",()=>{
  const corrupt=projectLockedToolCatalog(verified("ca",[
    file("tool-catalog.yaml","kind: ToolCatalog\napiVersion: wrong\n")
  ]));
  assert.equal(corrupt.available,false);
  assert.deepEqual(corrupt.operations,[]);
  const invalid=projectLockedToolCatalog(verified("ca",[
    {path:"tool-catalog.yaml",bytes:"not^base64"}
  ]));
  assert.equal(invalid.available,false);
  assert.match(invalid.reason,/could not be decoded/);
});

test("Schema Bundle is never interpreted as a ToolCatalog",()=>{
  const schema={...verified("schemas",[file("schema.yaml",goodCatalog)]),
    kind:"schema-bundle"};
  const result=projectLockedToolCatalog(schema);
  assert.equal(result.available,false);
  assert.equal(result.operations.length,0);
});
