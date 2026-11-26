import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {decodeBase64,base64Bytes,calculateSnapshot,calculateCompilerDependencySnapshotDigest}
  from "../vscode/src/dependency-snapshot.mjs";
import {createCompilerDevelopmentBuildRequest,
  COMPILER_DEVELOPMENT_BUILD_REQUEST_API_VERSION,
  INTERFACE_DEPENDENCY_LOCK_API_VERSION}
  from "../vscode/src/compiler-development-request.mjs";

const decoder=new TextDecoder("utf-8",{fatal:true});
const fixture=JSON.parse(readFileSync(
  "experiments/ide-host/tests/fixtures/compiler-v2.1-development-request.json","utf8"));

async function fixtureInput(){
  const prefix="skills/"+fixture.targets[0]+"/";
  const documents=fixture.files.map(file=>{
    assert.ok(file.path.startsWith(prefix),"fixture source path belongs to selected Skill");
    return {relativePath:file.path.slice(prefix.length),
      text:decoder.decode(decodeBase64(file.bytes))};
  });
  const rootAliases=new Map(fixture.lock.roots.map(root=>
    [root.key.packageId,root.alias]));
  const snapshots=await Promise.all(fixture.snapshots.map(async snapshot=>{
    const files=snapshot.files.map(file=>({
      path:file.path,bytes:decodeBase64(file.bytes)
    }));
    const studioSnapshot=await calculateSnapshot(files);
    return {
      id:rootAliases.get(snapshot.key.packageId)??"transitive-types",
      kind:"interface-package",
      snapshotDigest:studioSnapshot.snapshotDigest,
      files:snapshot.files.map(file=>({...file}))
    };
  }));
  return {
    packageName:fixture.targets[0],
    documents,
    resolvedDependencies:{status:"READY",snapshots}
  };
}

test("v2.1.0 Development Build request exactly reproduces the official Compiler fixture",async()=>{
  const request=await createCompilerDevelopmentBuildRequest(await fixtureInput());
  assert.equal(request.apiVersion,COMPILER_DEVELOPMENT_BUILD_REQUEST_API_VERSION);
  assert.equal(request.languageTarget,"connectionagent.io/v1alpha5");
  assert.equal(request.profile,"DEVELOPMENT");
  assert.deepEqual(request.targets,fixture.targets);
  assert.deepEqual(request.files,fixture.files);
  assert.deepEqual(request.lock,fixture.lock);
  const byPath=snapshots=>snapshots.map(snapshot=>({...snapshot,
    files:[...snapshot.files].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)
  }));
  assert.deepEqual(byPath(request.snapshots),byPath(fixture.snapshots));
  for(const snapshot of request.snapshots){
    assert.equal(await calculateCompilerDependencySnapshotDigest(
      snapshot.files.map(file=>({path:file.path,bytes:decodeBase64(file.bytes)}))
    ),snapshot.key.snapshotDigest);
  }
});

test("Development Build includes only the exact transitive closure of Contract roots",async()=>{
  const input=await fixtureInput();
  const unused={...input.resolvedDependencies.snapshots[0],id:"unused-extra-root"};
  const request=await createCompilerDevelopmentBuildRequest({
    ...input,
    resolvedDependencies:{status:"READY",snapshots:[...input.resolvedDependencies.snapshots,unused]}
  });
  assert.equal(request.snapshots.length,3);
  assert.equal(request.lock.packages.length,3);
  assert.equal(request.lock.apiVersion,INTERFACE_DEPENDENCY_LOCK_API_VERSION);
});

test("missing root aliases and transitive snapshots fail closed",async()=>{
  const rootMissing=await fixtureInput();
  rootMissing.resolvedDependencies.snapshots=
    rootMissing.resolvedDependencies.snapshots.map(snapshot=>
      snapshot.id==="ca"?{...snapshot,id:"other"}:snapshot);
  await assert.rejects(
    createCompilerDevelopmentBuildRequest(rootMissing),
    error=>error.code==="DEVELOPMENT_BUILD_ROOT_NOT_LOCKED"
  );

  const transitiveMissing=await fixtureInput();
  transitiveMissing.resolvedDependencies.snapshots=
    transitiveMissing.resolvedDependencies.snapshots.filter(snapshot=>
      snapshot.id!=="transitive-types");
  await assert.rejects(
    createCompilerDevelopmentBuildRequest(transitiveMissing),
    error=>error.code==="DEVELOPMENT_BUILD_TRANSITIVE_SNAPSHOT_MISSING"
  );
});

test("unready resolver state and source-only Contracts do not synthesize dependencies",async()=>{
  const unready=await fixtureInput();
  unready.resolvedDependencies.status="PARTIAL";
  await assert.rejects(
    createCompilerDevelopmentBuildRequest(unready),
    error=>error.code==="DEVELOPMENT_BUILD_DEPENDENCIES_NOT_READY"
  );

  const sourceOnly=await fixtureInput();
  const contract=sourceOnly.documents.find(item=>
    item.relativePath==="assurance/contract.yaml");
  contract.text="goal: example\nprecondition: ready\ndependencies: {}\n";
  await assert.rejects(
    createCompilerDevelopmentBuildRequest(sourceOnly),
    error=>error.code==="DEVELOPMENT_BUILD_NO_ROOT_DEPENDENCIES"
  );
});

test("root aliases must match the exact stable Package ID from the locked manifest",async()=>{
  const input=await fixtureInput();
  const root=input.resolvedDependencies.snapshots.find(snapshot=>snapshot.id==="ca");
  const manifestFile=root.files.find(file=>file.path==="package.json");
  const manifest=JSON.parse(decoder.decode(decodeBase64(manifestFile.bytes)));
  manifest.packageId="urn:example:wrong-package";
  const bytes=new TextEncoder().encode(JSON.stringify(manifest));
  const files=root.files.map(file=>file.path==="package.json"
    ?{path:file.path,bytes:base64Bytes(bytes)}:file);
  root.files=files;
  root.snapshotDigest=(await calculateSnapshot(root.files.map(file=>({
    path:file.path,bytes:decodeBase64(file.bytes)
  })))).snapshotDigest;
  await assert.rejects(
    createCompilerDevelopmentBuildRequest(input),
    error=>error.code==="DEVELOPMENT_BUILD_ROOT_PACKAGE_ID_MISMATCH"
  );
});


test("tampered resolver bytes and unsupported snapshot kinds fail closed",async()=>{
  const tampered=await fixtureInput();
  const root=tampered.resolvedDependencies.snapshots.find(item=>item.id==="ca");
  const source=root.files.find(item=>item.path==="tool-catalog.yaml");
  source.bytes=base64Bytes(Uint8Array.from(decodeBase64(source.bytes),byte=>byte^1));
  await assert.rejects(
    createCompilerDevelopmentBuildRequest(tampered),
    error=>error.code==="DEVELOPMENT_BUILD_SNAPSHOT_DIGEST_MISMATCH"
  );

  const unsupported=await fixtureInput();
  unsupported.resolvedDependencies.snapshots[0].kind="tool-catalog";
  await assert.rejects(
    createCompilerDevelopmentBuildRequest(unsupported),
    error=>error.code==="DEVELOPMENT_BUILD_DEPENDENCY_KIND_UNSUPPORTED"
  );
});

test("dependency cycles and conflicting package versions fail closed",async()=>{
  const cycle=await fixtureInput();
  const transitive=cycle.resolvedDependencies.snapshots.find(item=>item.id==="transitive-types");
  const manifestFile=transitive.files.find(item=>item.path==="package.json");
  const manifest=JSON.parse(decoder.decode(decodeBase64(manifestFile.bytes)));
  manifest.dependencies=[{alias:"tools",packageId:"urn:example:ca:tools",version:"1.0.0"}];
  manifestFile.bytes=base64Bytes(new TextEncoder().encode(JSON.stringify(manifest)));
  transitive.snapshotDigest=(await calculateSnapshot(transitive.files.map(file=>({
    path:file.path,bytes:decodeBase64(file.bytes)
  })))).snapshotDigest;
  await assert.rejects(
    createCompilerDevelopmentBuildRequest(cycle),
    error=>error.code==="DEVELOPMENT_BUILD_DEPENDENCY_CYCLE"
  );

  const conflict=await fixtureInput();
  const contract=conflict.documents.find(item=>item.relativePath==="assurance/contract.yaml");
  const contractLines=contract.text.split("\n");
  const toolsRootIndex=contractLines.indexOf("  ca: urn:example:ca:tools");
  assert.notEqual(toolsRootIndex,-1,"fixture Contract exposes the tools root");
  contractLines.splice(toolsRootIndex+1,0,"  types-v2: urn:example:ca:types");
  contract.text=contractLines.join("\n");
  const typesV2=(await fixtureInput()).resolvedDependencies.snapshots.find(item=>item.id==="transitive-types");
  const typesManifestFile=typesV2.files.find(item=>item.path==="package.json");
  const typesManifest=JSON.parse(decoder.decode(decodeBase64(typesManifestFile.bytes)));
  typesManifest.version="2.0.0";
  typesManifestFile.bytes=base64Bytes(new TextEncoder().encode(JSON.stringify(typesManifest)));
  typesV2.id="types-v2";
  typesV2.snapshotDigest=(await calculateSnapshot(typesV2.files.map(file=>({
    path:file.path,bytes:decodeBase64(file.bytes)
  })))).snapshotDigest;
  conflict.resolvedDependencies.snapshots.push(typesV2);
  await assert.rejects(
    createCompilerDevelopmentBuildRequest(conflict),
    error=>error.code==="DEVELOPMENT_BUILD_PACKAGE_VERSION_CONFLICT"
  );
});
