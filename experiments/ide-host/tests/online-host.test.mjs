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
