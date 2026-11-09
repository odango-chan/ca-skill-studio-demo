import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,statSync} from "node:fs";
import {join} from "node:path";
const root="experiments/ide-host/theia-online";
test("Theia online target is a real backend-free 1.76 browser-only app",()=>{
  const app=JSON.parse(readFileSync(join(root,"package.json"),"utf8"));
  assert.equal(app.theia.target,"browser-only");
  assert.equal(app.dependencies["@theia/core"],"1.76.0");
  assert.equal(app.dependencies["@theia/plugin-ext-vscode"],"1.76.0");
  assert.equal(app.dependencies["@theia/filesystem"],"1.76.0");
  assert.equal(app.dependencies["@theia/navigator"],"1.76.0");
  assert.equal(app.theiaPluginsDir,"plugins");
  assert.ok(!app.dependencies["@theia/terminal"]);
  assert.equal(app.scripts.build,"theia build --mode production");
});
test("Theia plugin is the exact Web extension, with native editor + view contributions",()=>{
  const plugin=JSON.parse(readFileSync(join(root,"plugins/odango-chan.ca-skill-studio-ide-spike/package.json"),"utf8"));
  assert.ok(plugin.browser?.endsWith("extension-theia.js"));
  assert.equal(plugin.contributes.customEditors[0].viewType,"skillStudio.procedurePreview");
  assert.equal(plugin.contributes.customEditors[0].priority,"option");
  assert.ok(plugin.activationEvents.includes("onStartupFinished"),
    "first-run demo discovery must activate on startup");
  assert.ok(plugin.contributes.viewsWelcome?.some(x=>
    x.view==="workbench.explorer.fileView"&&
    x.contents.includes("command:skillStudio.loadExample")),
    "Explorer empty state must offer the demo project");
  assert.ok(plugin.contributes.menus?.["view/title"]?.some(x=>
    x.command==="skillStudio.loadExample"),
    "Explorer title toolbar must expose the demo project");
  for(const f of ["dist/extension-web.cjs","dist/extension-theia.js","media/procedure.js","media/procedure.css",
    "samples/establish-pdu-session/files.json",
    "samples/establish-pdu-session/assurance/procedure.yaml"])
    assert.ok(statSync(join(root,"plugins/odango-chan.ca-skill-studio-ide-spike",f)).size>(f.endsWith("files.json")?50:1000),f);
});
test("Trial is isolated from existing Pages distribution",()=>{
  const workflow=readFileSync(".github/workflows/theia-online-spike.yml","utf8");
  assert.match(workflow,/if-no-files-found: error/);
  assert.doesNotMatch(workflow,/deploy-pages/);
  assert.doesNotMatch(workflow,/publish-gh-pages/);
  assert.doesNotMatch(workflow,/branches:\s*\[main\]/);
});

test("Theia preloads the shared offline Skill Studio color and file icon theme",()=>{
  const app=JSON.parse(readFileSync(join(root,"package.json"),"utf8"));
  const preferences=app.theia.frontend.config.preferences;
  assert.equal(preferences["workbench.colorTheme"],"SKILL Studio Light");
  assert.equal(preferences["workbench.iconTheme"],"skill-studio-file-icons");
  const themeRoot=join(root,"plugins/odango-chan.skill-studio-theme");
  const manifest=JSON.parse(readFileSync(join(themeRoot,"package.json"),"utf8"));
  assert.equal(manifest.name,"skill-studio-theme");
  assert.equal(manifest.publisher,"odango-chan");
  assert.equal(manifest.contributes.themes[0].label,"SKILL Studio Light");
  assert.equal(manifest.contributes.iconThemes[0].id,"skill-studio-file-icons");
  for(const path of [
    "themes/skill-studio-light-color-theme.json","icons/skill-studio-file-icon-theme.json",
    "icons/skill.svg","icons/yaml.svg","icons/markdown.svg","icons/python.svg",
    "icons/file.svg","icons/folder.svg","icons/folder-open.svg","icons/code.svg"
  ])assert.ok(statSync(join(themeRoot,path)).size>80,path);
});
