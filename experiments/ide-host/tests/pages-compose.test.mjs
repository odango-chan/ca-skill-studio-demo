import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,readFile,rm,writeFile,stat} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {composePagesRelease} from "../scripts/compose-pages-release.mjs";

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
    await put(theia,"hostedPlugin/list.json",'["ca-skill-studio-ide-spike","skill-studio-theme","skill-studio-languages"]');
    await put(theia,"webview/index.html","<html>webview</html>");
    await put(theia,"hostedPlugin/odango_chan_ca_skill_studio_ide_spike/package.json",'{"name":"ca-skill-studio-ide-spike"}');
    await put(theia,"hostedPlugin/odango_chan_ca_skill_studio_ide_spike/dist/extension-theia.js","extension worker");
    await put(theia,"hostedPlugin/odango_chan_ca_skill_studio_ide_spike/dist/skill-language-server.js","language worker");
    await put(theia,"hostedPlugin/odango_chan_skill_studio_theme/package.json",'{"name":"skill-studio-theme"}');
    await put(theia,"hostedPlugin/odango_chan_skill_studio_theme/themes/skill-studio-light-color-theme.json",'{"name":"SKILL Studio Light"}');
    await put(theia,"hostedPlugin/odango_chan_skill_studio_theme/icons/skill-studio-file-icon-theme.json",'{"iconDefinitions":{}}');
    await put(theia,"hostedPlugin/odango_chan_skill_studio_theme/icons/skill.svg","<svg></svg>");
    await put(theia,"hostedPlugin/odango_chan_skill_studio_languages/package.json",'{"name":"skill-studio-languages"}');

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
    await put(theia,"hostedPlugin/list.json",'["ca-skill-studio-ide-spike","skill-studio-theme","skill-studio-languages"]');
    await put(theia,"webview/index.html","webview");
    await put(theia,"hostedPlugin/odango_chan_ca_skill_studio_ide_spike/package.json","{}");
    await put(theia,"hostedPlugin/odango_chan_ca_skill_studio_ide_spike/dist/extension-theia.js","extension");
    await put(theia,"hostedPlugin/odango_chan_ca_skill_studio_ide_spike/dist/skill-language-server.js","worker");
    await put(theia,"hostedPlugin/odango_chan_skill_studio_theme/package.json","{}");
    await put(theia,"hostedPlugin/odango_chan_skill_studio_theme/themes/skill-studio-light-color-theme.json","{}");
    await put(theia,"hostedPlugin/odango_chan_skill_studio_theme/icons/skill-studio-file-icon-theme.json","{}");
    await put(theia,"hostedPlugin/odango_chan_skill_studio_theme/icons/skill.svg","<svg></svg>");
    await put(theia,"hostedPlugin/odango_chan_skill_studio_languages/package.json","{}");
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

test("Pages workflow cannot reintroduce the Classic application",async()=>{
  const workflow=await readFile(new URL("../../../.github/workflows/pages.yml",import.meta.url),"utf8");
  assert.doesNotMatch(workflow,/--classic|dist\/classic|classic-icons\.css|preserve Classic/i);
  assert.match(workflow,/test ! -e dist\/classic/);
});
