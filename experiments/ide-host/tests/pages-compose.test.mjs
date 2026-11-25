import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,readFile,rm,writeFile,stat} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {composePagesRelease} from "../scripts/compose-pages-release.mjs";
import {pagesBuildInfo} from "../scripts/write-pages-build-info.mjs";

async function put(root,path,content){
  const target=join(root,path);
  await mkdir(target.slice(0,target.lastIndexOf("/")),{recursive:true});
  await writeFile(target,content);
}

test("Pages publishes only Theia and never stages a Classic or legacy fallback",async()=>{
  const temp=await mkdtemp(join(tmpdir(),"studio-pages-compose-"));
  const theia=join(temp,"theia"),output=join(temp,"dist"),site=join(temp,"site");
  try{
    await put(site,"CNAME","studio.example.com\n");
    await put(theia,"index.html",'<!doctype html><html><body><div id="skill-studio-preview-warning">在线演示 · Webview 使用同源模式</div><div id="theia-app-shell"></div></body></html>');
    await put(theia,"bundle.js","window.theia=true;");
    await put(theia,"hostedPlugin/list.json",'["ca-skill-studio-ide-spike","skill-studio-theme"]');
    await put(theia,"webview/index.html","<html>webview</html>");
    await put(theia,"hostedPlugin/odango_chan_ca_skill_studio_ide_spike/package.json",'{"name":"ca-skill-studio-ide-spike"}');
    await put(theia,"hostedPlugin/odango_chan_ca_skill_studio_ide_spike/dist/extension-theia.js","extension worker");
    await put(theia,"hostedPlugin/odango_chan_ca_skill_studio_ide_spike/dist/skill-language-server.js","language worker");
    await put(theia,"hostedPlugin/odango_chan_ca_skill_studio_ide_spike/dist/compiler-worker.js","compiler worker");
    await put(theia,"hostedPlugin/odango_chan_ca_skill_studio_ide_spike/dist/skillc.wasm","wasm binary");
    await put(theia,"hostedPlugin/odango_chan_ca_skill_studio_ide_spike/dist/wasm_exec.js","go wasm runtime");
    await put(theia,"hostedPlugin/odango_chan_skill_studio_theme/package.json",'{"name":"skill-studio-theme"}');
    await put(theia,"hostedPlugin/odango_chan_skill_studio_theme/themes/skill-studio-light-color-theme.json",'{"name":"SKILL Studio Light"}');
    await put(theia,"hostedPlugin/odango_chan_skill_studio_theme/icons/skill-studio-file-icon-theme.json",'{"iconDefinitions":{}}');
    await put(theia,"hostedPlugin/odango_chan_skill_studio_theme/icons/skill.svg","<svg></svg>");
    await put(theia,"hostedPlugin/odango_chan_ca_skill_studio_ide_spike/dist/grammars/yaml/syntaxes/yaml.tmLanguage.json",'{"scopeName":"source.yaml"}');
    await put(theia,"hostedPlugin/odango_chan_ca_skill_studio_ide_spike/dist/grammars/python/syntaxes/MagicPython.tmLanguage.json",'{"scopeName":"source.python"}');

    const result=await composePagesRelease({theiaFrontend:theia,outputDist:output,siteRoot:site});
    assert.equal(result.defaultHost,"theia-browser-only");
    assert.equal(result.classicPublished,false);
    assert.equal(result.legacyRedirects,false);
    assert.match(await readFile(join(output,"index.html"),"utf8"),/theia-app-shell/);
    assert.equal(await readFile(join(output,"bundle.js"),"utf8"),"window.theia=true;");
    assert.equal(await readFile(join(output,"CNAME"),"utf8"),"studio.example.com\n");
    assert.equal(await readFile(join(output,".nojekyll"),"utf8"),"");
    for(const forbidden of ["classic","app.js","studio.css","light.css","app.css","ide-preview","classic-icons.css"])
      await assert.rejects(stat(join(output,forbidden)),{code:"ENOENT"});
  }finally{await rm(temp,{recursive:true,force:true});}
});

test("Pages refuses a frontend containing a Classic navigation link or missing a required plugin",async()=>{
  const temp=await mkdtemp(join(tmpdir(),"studio-pages-guard-"));
  const theia=join(temp,"theia"),output=join(temp,"dist");
  try{
    await put(theia,"index.html",'<!doctype html><html><body><div id="skill-studio-preview-warning">在线演示</div><a href="/classic/">old</a></body></html>');
    await put(theia,"bundle.js","bundle");
    await put(theia,"hostedPlugin/list.json",'["ca-skill-studio-ide-spike","skill-studio-theme"]');
    await put(theia,"webview/index.html","webview");
    await put(theia,"hostedPlugin/odango_chan_ca_skill_studio_ide_spike/package.json","{}");
    await put(theia,"hostedPlugin/odango_chan_ca_skill_studio_ide_spike/dist/extension-theia.js","extension");
    await put(theia,"hostedPlugin/odango_chan_ca_skill_studio_ide_spike/dist/skill-language-server.js","worker");
    await put(theia,"hostedPlugin/odango_chan_ca_skill_studio_ide_spike/dist/compiler-worker.js","compiler worker");
    await put(theia,"hostedPlugin/odango_chan_ca_skill_studio_ide_spike/dist/skillc.wasm","wasm binary");
    await put(theia,"hostedPlugin/odango_chan_ca_skill_studio_ide_spike/dist/wasm_exec.js","go wasm runtime");
    await put(theia,"hostedPlugin/odango_chan_skill_studio_theme/package.json","{}");
    await put(theia,"hostedPlugin/odango_chan_skill_studio_theme/themes/skill-studio-light-color-theme.json","{}");
    await put(theia,"hostedPlugin/odango_chan_skill_studio_theme/icons/skill-studio-file-icon-theme.json","{}");
    await put(theia,"hostedPlugin/odango_chan_skill_studio_theme/icons/skill.svg","<svg></svg>");
    await put(theia,"hostedPlugin/odango_chan_ca_skill_studio_ide_spike/dist/grammars/yaml/syntaxes/yaml.tmLanguage.json","syntax");
    await put(theia,"hostedPlugin/odango_chan_ca_skill_studio_ide_spike/dist/grammars/python/syntaxes/MagicPython.tmLanguage.json","syntax");
    await assert.rejects(composePagesRelease({theiaFrontend:theia,outputDist:output}),/Classic navigation/);
    await assert.rejects(stat(output),{code:"ENOENT"});
  }finally{await rm(temp,{recursive:true,force:true});}
});

test("Pages installs pinned browser LSP dependencies before bundling the Web extension",async()=>{
  const workflow=await readFile(new URL("../../../.github/workflows/pages.yml",import.meta.url),"utf8");
  const marker="- name: Build Theia Web extension for default online workbench";
  const start=workflow.indexOf(marker);
  const end=workflow.indexOf("- name: Build Theia browser-only static workbench",start);
  assert.ok(start>=0&&end>start);
  const step=workflow.slice(start,end);
  const client=step.indexOf("npm ci --prefix experiments/ide-host/lsp-browser/client ");
  const server=step.indexOf("npm ci --prefix experiments/ide-host/lsp-browser/server ");
  const bundle=step.indexOf("node experiments/ide-host/scripts/build-ide-spike.mjs");
  assert.ok(client>=0&&server>client&&bundle>server);
});

test("Pages stages and smoke-tests the exact Compiler v2.1.0 Development Worker release",async()=>{
  const workflow=await readFile(new URL("../../../.github/workflows/pages.yml",import.meta.url),"utf8");
  const compilerCommit="b67fbb56c34d15b8d5a0903c8a7ca93d608f8f65";
  assert.ok(workflow.includes("repository: odango-chan/ca-skill-compiler"));\n  assert.ok(workflow.includes("ref: "+compilerCommit));
  assert.ok(workflow.includes("Verify pinned CA Skill Compiler v2.1.0 source identity"));\n  assert.ok(workflow.includes("git rev-parse HEAD"));
  assert.ok(workflow.includes(compilerCommit));
  assert.ok(workflow.includes("Download and verify official Compiler v2.1.0 Worker bundle"));
  assert.ok(workflow.includes("skillc-v2.1.0-web-worker.tar.gz"));
  assert.match(workflow,/SHA256SUMS/);
  const extensionBuild=workflow.indexOf("node experiments/ide-host/scripts/build-ide-spike.mjs");
  const stage=workflow.indexOf("node experiments/ide-host/scripts/prepare-theia-online.mjs");
  assert.ok(extensionBuild>=0&&stage>extensionBuild,
    "verified Compiler Worker assets must be staged after the extension build");
  assert.match(workflow,/THEIA_REQUIRE_COMPILER_WORKER: "1"/);
});

test("all Compiler host workflows pin the same released v2.1.0 source commit",async()=>{
  const compilerCommit="b67fbb56c34d15b8d5a0903c8a7ca93d608f8f65";
  const workflows=[
    "pages.yml",
    "theia-browser-host-spike.yml",
    "theia-online-spike.yml",
    "ide-host-spike.yml",
    "pr-verify.yml"
  ];
  for(const name of workflows){
    const workflow=await readFile(new URL("../../../.github/workflows/"+name,import.meta.url),"utf8");
    assert.ok(workflow.includes("repository: odango-chan/ca-skill-compiler") && workflow.includes("ref: "+compilerCommit),
      name+" must check out the exact v2.1.0 commit");
    assert.ok(workflow.includes("Verify pinned CA Skill Compiler v2.1.0 source identity") && workflow.includes("git rev-parse HEAD"),
      name+" must verify the staged Compiler source identity");
    assert.ok(workflow.includes(compilerCommit),name+" must retain the exact immutable source SHA");
  }
});

test("Pages workflow cannot reintroduce the Classic application",async()=>{
  const workflow=await readFile(new URL("../../../.github/workflows/pages.yml",import.meta.url),"utf8");
  assert.doesNotMatch(workflow,/--classic|preserve Classic/i);
  assert.match(workflow,/test ! -e dist\/classic/);
});


test("Pages preview builds the exact PR head without deploying it",async()=>{
  const workflow=await readFile(new URL("../../../.github/workflows/pages.yml",import.meta.url),"utf8");
  assert.match(workflow,/^  pull_request:/m);
  assert.match(workflow,/ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| 'main' \}\}/);
  assert.match(workflow,/ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.ref_name \}\}/);
  assert.match(workflow,/github\.event_name == 'pull_request' \|\| github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow,/if: github\.event_name != 'pull_request' && github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow,/THEIA_REQUIRE_WEBVIEW: "1"/);
  assert.match(workflow,/THEIA_REQUIRE_BROWSER_LSP: "1"/);
  assert.match(workflow,/THEIA_REQUIRE_COMPILER_WORKER: "1"/);
  assert.match(workflow,/Verify deployed Pages build identity/);
  assert.match(workflow,/curl --fail --silent --show-error[\s\S]*build-info\.json/);
  assert.doesNotMatch(workflow,/CA_SKILL_COMPILER_READ_TOKEN/,
    "the Compiler repository is public; Pages preview must not depend on a private secret");
});

test("Pages build identity binds the exact candidate head rather than a PR merge ref",()=>{
  const head="a".repeat(40);
  const info=pagesBuildInfo({
    sourceSha:head,expectedSha:head,
    ref:"refs/pull/248/merge",runId:"123456"
  });
  assert.equal(info.sourceSha,head);
  assert.equal(info.workflowSha,head);
  assert.equal(info.workflowRunId,"123456");
  assert.throws(()=>pagesBuildInfo({
    sourceSha:head,expectedSha:"b".repeat(40),
    ref:"refs/pull/248/merge",runId:"123456"
  }),/refusing to publish a different source SHA/);
});
