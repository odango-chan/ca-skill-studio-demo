import test from "node:test";
import assert from "node:assert/strict";
import {createPackageLanguageLifecycle} from "../experiments/ide-host/vscode/src/package-language-lifecycle.mjs";

const uri=path=>({path,toString:()=>"file://"+path});
const pkg=(name,procedure=true)=>({name,files:procedure?[
  {path:"SKILL.md",uri:uri("/skills/"+name+"/SKILL.md")},
  {path:"assurance/procedure.yaml",uri:uri("/skills/"+name+"/assurance/procedure.yaml")}
]:[{path:"SKILL.md",uri:uri("/skills/"+name+"/SKILL.md")}]});
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test("discovered Packages attach LSP without opening a Designer",async()=>{
  const opened=[],attached=[];
  const lifecycle=createPackageLanguageLifecycle({
    openTextDocument:async target=>{opened.push(target.toString());return {uri:target};},
    attach:document=>{attached.push(document.uri.toString());return ()=>{};}
  });
  lifecycle.sync([pkg("fivegc"),pkg("mas",false)]);
  await tick();
  assert.deepEqual(opened,["file:///skills/fivegc/assurance/procedure.yaml"]);
  assert.deepEqual(attached,opened);
  assert.deepEqual(lifecycle.snapshot().attached,opened);
  lifecycle.dispose();
});

test("repeated inventory refreshes do not restart an unchanged Package",async()=>{
  let attachCount=0,releaseCount=0;
  const lifecycle=createPackageLanguageLifecycle({
    openTextDocument:async target=>({uri:target}),
    attach:()=>{attachCount++;return ()=>releaseCount++;}
  });
  lifecycle.sync([pkg("fivegc")]);
  await tick();
  lifecycle.sync([pkg("fivegc")]);
  await tick();
  assert.equal(attachCount,1);
  assert.equal(releaseCount,0);
  lifecycle.dispose();
  assert.equal(releaseCount,1);
});

test("removing a Package releases its project-owned analysis reference",async()=>{
  let releaseCount=0;
  const lifecycle=createPackageLanguageLifecycle({
    openTextDocument:async target=>({uri:target}),
    attach:()=>()=>releaseCount++
  });
  lifecycle.sync([pkg("fivegc")]);
  await tick();
  lifecycle.sync([]);
  assert.equal(releaseCount,1);
  assert.deepEqual(lifecycle.snapshot().attached,[]);
  lifecycle.dispose();
  assert.equal(releaseCount,1);
});

test("a stale asynchronous open cannot attach a Package removed from inventory",async()=>{
  let resolveOpen,attachCount=0;
  const lifecycle=createPackageLanguageLifecycle({
    openTextDocument:()=>new Promise(resolve=>{resolveOpen=resolve;}),
    attach:()=>{attachCount++;return ()=>{};}
  });
  lifecycle.sync([pkg("fivegc")]);
  await tick();
  lifecycle.sync([]);
  resolveOpen({uri:uri("/skills/fivegc/assurance/procedure.yaml")});
  await tick();
  assert.equal(attachCount,0);
  assert.deepEqual(lifecycle.snapshot().attached,[]);
  lifecycle.dispose();
});

test("a re-added Package supersedes an earlier pending open",async()=>{
  const resolvers=[];let attachCount=0;
  const lifecycle=createPackageLanguageLifecycle({
    openTextDocument:()=>new Promise(resolve=>resolvers.push(resolve)),
    attach:()=>{attachCount++;return ()=>{};}
  });
  lifecycle.sync([pkg("fivegc")]);
  await tick();
  lifecycle.sync([]);
  lifecycle.sync([pkg("fivegc")]);
  await tick();
  assert.equal(resolvers.length,2);
  resolvers[0]({uri:uri("/skills/fivegc/assurance/procedure.yaml")});
  await tick();
  assert.equal(attachCount,0);
  resolvers[1]({uri:uri("/skills/fivegc/assurance/procedure.yaml")});
  await tick();
  assert.equal(attachCount,1);
  lifecycle.dispose();
});
