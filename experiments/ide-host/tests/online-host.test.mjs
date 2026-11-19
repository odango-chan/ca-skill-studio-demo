import test from "node:test";
import assert from "node:assert/strict";
import {existsSync,readFileSync,statSync} from "node:fs";
import {mkdtemp,readFile,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {isAllowedPackageRelativeLink} from "../vscode/src/markdown-link-policy.mjs";
import {buildSkillStudioBrandCss,buildSkillStudioBrandScript,prepareTheiaBrand}
  from "../scripts/prepare-theia-brand.mjs";
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
  assert.equal(app.scripts["download:plugins"],"theia download:plugins");
  const markdownPlugin="https://open-vsx.org/api/vscode/markdown-language-features/1.95.3/file/vscode.markdown-language-features-1.95.3.vsix";
  assert.equal(app.theiaPlugins["vscode.markdown-language-features"],markdownPlugin);
  const browserApp=JSON.parse(readFileSync(join(root,"../theia-browser/package.json"),"utf8"));
  assert.equal(browserApp.theiaPlugins["vscode.markdown-language-features"],markdownPlugin,
    "Browser-Only and backend Theia must use the same native Markdown language extension");
  assert.equal(app.theia.frontend.config.preferences["markdown.preview.scrollEditorWithPreview"],undefined);
  assert.equal(app.theia.frontend.config.preferences["markdown.preview.scrollPreviewWithEditor"],undefined);
});
test("Theia plugin is the exact Web extension, with native editor + view contributions",()=>{
  const app=JSON.parse(readFileSync(join(root,"package.json"),"utf8"));
  const plugin=JSON.parse(readFileSync(join(root,"plugins/odango-chan.ca-skill-studio-ide-spike/package.json"),"utf8"));
  assert.ok(plugin.browser?.endsWith("extension-theia.js"));
  assert.equal(plugin.contributes["markdown.markdownItPlugins"],undefined,
    "the native Markdown Preview plugin hook is no longer used");
  assert.ok(plugin.contributes.languages?.some(language=>
    language.id==="markdown"&&language.extensions?.includes(".md")),
    "native Markdown language features retain the Markdown language ID in Theia");
  assert.equal(plugin.contributes["markdown.previewStyles"],undefined,
    "Studio Preview owns its stylesheet and rendering lifecycle");
  assert.ok(!plugin.contributes.commands.some(command=>command.command==="skillStudio.previewMarkdown"),
    "Markdown Preview is owned by the native extension, not a duplicate Studio command");
  for(const menu of Object.values(plugin.contributes.menus??{}))
    assert.ok(!menu.some(item=>item.command==="skillStudio.previewMarkdown"),
      "Studio must not contribute a duplicate Markdown Preview menu entry");
  assert.equal(plugin.contributes.customEditors,undefined,
    "visualizers must not create Main Editor CustomEditors");
  const explorerViews=new Set((plugin.contributes.views.explorer??[]).map(x=>x.id));
  const secondaryViews=new Set(plugin.contributes.views.skillStudioInspector.map(x=>x.id));
  const secondaryContainers=plugin.contributes.viewsContainers.secondarySidebar??[];
  assert.deepEqual([...explorerViews],[
    "skillStudio.packages","skillStudio.outline","skillStudio.problems"
  ],"authoring/navigation views are contributed directly below native File Explorer");
  assert.ok(!explorerViews.has("skillStudio.evidence"),"Data Flow belongs to right-side Inspector, not a separate Evidence view");
  assert.ok(!plugin.activationEvents.includes("onView:skillStudio.evidence"));
  assert.ok(secondaryViews.has("skillStudio.preview"),
    "all visualizers use the single right-side Preview WebviewView");
  assert.ok(secondaryViews.has("skillStudio.inspection"),
    "Inspector view must be contributed to the native right-side container");
  assert.ok(secondaryContainers.some(x=>x.id==="skillStudioInspector"),
    "Inspector container must use the host secondarySidebar location");
  assert.equal(plugin.contributes.viewsContainers.activitybar,undefined,
    "no separate Skill Studio Activity Bar container");
  assert.ok(!explorerViews.has("skillStudio.inspection"),
    "Inspector must not be duplicated in Explorer");
  assert.ok(plugin.contributes.views.explorer.some(x=>x.id==="skillStudio.outline"&&
    x.name==="Procedure Outline"),
    "domain Procedure Outline remains distinct from native document-symbol Outline");
  assert.ok(plugin.activationEvents.includes("onCommand:skillStudio.refreshPackages"));
  for(const command of ["checkSkill","buildSkill","inspectCompilerDependencies"]){
    assert.ok(plugin.activationEvents.includes("onCommand:skillStudio."+command),command);
    assert.ok(plugin.contributes.commands.some(item=>item.command==="skillStudio."+command),command);
  }
  assert.ok(plugin.activationEvents.includes("onView:skillStudio.packages"));
  assert.ok(plugin.contributes.menus["view/title"].some(x=>
    x.command==="skillStudio.refreshPackages"&&x.when==="view == skillStudio.packages"));
  assert.equal(plugin.contributes.customEditors,undefined,
    "native Source is the only Main Editor surface; visualizers are hosted in the shared Preview View");
  assert.equal(app.theia.frontend.config.preferences["workbench.editorAssociations"],undefined,
    "Theia must not bypass the native Source-first pairing flow with forced CustomEditor associations");
  assert.ok(plugin.activationEvents.includes("onStartupFinished"),
    "first-run demo discovery must activate on startup");
  const welcome=plugin.contributes.viewsWelcome?.find(x=>
    x.view==="workbench.explorer.fileView");
  assert.equal(welcome?.when,"workspaceFolderCount == 0");
  const locale=JSON.parse(readFileSync(join(root,
    "plugins/odango-chan.ca-skill-studio-ide-spike/package.nls.json"),"utf8"));
  const content=locale[welcome.contents.slice(1,-1)];
  for(const command of ["newProject","openProject","loadExample"])
    assert.ok(content.includes("command:skillStudio."+command),command);
  for(const command of ["openLanguageSpec","openAuthoringGuide"]){
    assert.ok(content.includes("command:skillStudio."+command),command);
    assert.ok(plugin.contributes.commands.some(entry=>
      entry.command==="skillStudio."+command),
      "Documentation must remain a native extension command: "+command);
  }
  assert.ok(!plugin.contributes.menus?.["view/title"]?.some(x=>
    x.command==="skillStudio.loadExample"),
    "Example loading belongs in native File and SKILL Studio Project menus, not Explorer toolbar noise");
  assert.equal(existsSync(join(root,"plugins/odango-chan.ca-skill-studio-ide-spike/samples/skills")),false,
    "the retired v0.2 sample set must not be bundled");
  for(const f of ["dist/extension-web.cjs","dist/extension-theia.js","dist/skill-language-server.js",
    "dist/compiler-worker.js","dist/skillc.wasm","dist/wasm_exec.js","media/procedure.js","media/procedure.css",
    "samples/v1alpha5/files.json","samples/v1alpha5/README.md",
    "samples/v1alpha5/establish-pdu-session/assurance/procedure.yaml",
    "samples/v1alpha5/establish-pdu-session-mas/assurance/procedure.yaml",
    "media/native-markdown-preview.css"])
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
    "icons/json.svg","icons/shell.svg","icons/text.svg",
    "icons/file.svg","icons/folder.svg","icons/folder-open.svg","icons/code.svg"
  ])assert.ok(statSync(join(themeRoot,path)).size>80,path);
});

test("Theia bundles offline YAML and Python TextMate grammars independently of LSP",()=>{
  const rootSyntax=join(root,"plugins/odango-chan.skill-studio-languages");
  const manifest=JSON.parse(readFileSync(join(rootSyntax,"package.json"),"utf8"));
  assert.equal(manifest.main,undefined);
  assert.equal(manifest.browser,undefined);
  for(const [id,suffix] of [["yaml",".yaml"],["python",".py"]]){
    assert.ok(manifest.contributes.languages.some(x=>
      x.id===id&&x.extensions.includes(suffix)),id+" language id");
    assert.ok(manifest.contributes.grammars.some(x=>x.language===id),id+" grammar");
  }
  for(const grammar of manifest.contributes.grammars){
    const path=join(rootSyntax,grammar.path);
    const syntax=JSON.parse(readFileSync(path,"utf8"));
    assert.equal(syntax.scopeName,grammar.scopeName);
    assert.ok(statSync(path).size>100);
  }
  assert.ok(statSync(join(rootSyntax,"LICENSE.txt")).size>500);
});

test("SKILL Studio adds one native Theia top-level menu with real extension commands",async()=>{
  const css=buildSkillStudioBrandCss();
  const script=buildSkillStudioBrandScript();
  assert.match(css,/\.lm-MenuBar-content/);
  assert.doesNotMatch(css,/lm-MenuBar-item:first-child/,
    "the custom menu must not displace the standard File menu from first position");
  assert.match(css,/\.theia-preload\.theia-hidden\s*\{\s*pointer-events:none;/,
    "An invisible startup preload cannot intercept trusted native menu clicks");
  assert.doesNotMatch(css,/\.skill-studio-brand-label|linear-gradient/);
  assert.match(script,/MenuModelRegistry/);
  assert.match(script,/registerMenuAction/);
  assert.match(script,/registerSubmenu\(TOP,"SKILL Studio"/);
  assert.match(script,/\["menubar","5z_skill_studio"\]/);
  assert.match(script,/registerSubmenu\(groupPath,group\.label/);
  assert.match(script,/menus\.registerMenuAction\(action\.path/);
  assert.ok(script.includes('["menubar","1_file","1_new"]'));
  assert.ok(script.includes('["menubar","1_file","2_open"]'));
  for(const id of [
    "showWelcome","newProject","openProject","loadExample","selectProjectRoot",
    "refreshPackages","checkSkill","buildSkill","inspectCompilerDependencies",
    "auditPackage","exportPackageZip","addDependency","refreshDependencies",
    "openProcedure","openContract","openPredicates","openSchema",
    "refreshInspection","restartLanguageService","openLanguageSpec","openAuthoringGuide"
  ])
    assert.ok(script.includes('"skillStudio.'+id+'"'),"Native menu lacks "+id);
  assert.doesNotMatch(script,/commands\.isVisible\(id\)/,
    "contextual command visibility must not block native menu registration");
  assert.doesNotMatch(script,/createElement\("div"\)|addEventListener\("click"/);
  assert.ok(script.includes('commands.getCommand(id)'),
    "Native menu must wait for real registered extension commands");

  const extension=JSON.parse(readFileSync(join(root,"../vscode/package.json"),"utf8"));
  const commandById=new Map(extension.contributes.commands.map(item=>[item.command,item]));
  const publicCommands=[
    "skillStudio.showWelcome","skillStudio.newProject","skillStudio.openProject",
    "skillStudio.openLanguageSpec","skillStudio.openAuthoringGuide",
    "skillStudio.refreshPackages","skillStudio.openSchema","skillStudio.openProcedure",
    "skillStudio.loadExample","skillStudio.auditPackage","skillStudio.exportPackageZip",
    "skillStudio.refreshInspection","skillStudio.restartLanguageService",
    "skillStudio.openPredicates","skillStudio.openContract","skillStudio.selectProjectRoot",
    "skillStudio.addDependency","skillStudio.refreshDependencies",
    "skillStudio.checkSkill","skillStudio.buildSkill","skillStudio.inspectCompilerDependencies"
  ];
  for(const id of publicCommands){
    assert.equal(commandById.get(id)?.category,"SKILL Studio",id+" must be grouped in Command Palette");
    assert.ok(commandById.get(id)?.title?.startsWith("%"),id+" must use localized short title");
  }
  const hiddenPalette=new Set((extension.contributes.menus.commandPalette??[])
    .filter(item=>item.when==="false").map(item=>item.command));
  for(const id of [
    "skillStudio.renameNode","skillStudio.editNodeOperatorValue",
    "skillStudio.editPhaseInputBinding","skillStudio.editPhaseOutputReference",
    "skillStudio.editPhaseRouteTarget","skillStudio.repairPhaseOutcome",
    "skillStudio.insertNode","skillStudio.deleteNode","skillStudio.addPhaseVerify",
    "skillStudio.editPhaseVerifyStep","skillStudio.renameNamedPhaseStep",
    "skillStudio.refreshDependency","skillStudio.updateDependencyLock",
    "skillStudio.inspectDependencyContract","skillStudio.removeDependency"
  ])assert.ok(hiddenPalette.has(id),id+" must remain contextual, not global palette noise");
  const packageToolbar=extension.contributes.menus["view/title"]
    .filter(item=>item.when==="view == skillStudio.packages")
    .map(item=>item.command);
  assert.deepEqual(packageToolbar,[
    "skillStudio.refreshPackages","skillStudio.addDependency",
    "skillStudio.checkSkill","skillStudio.buildSkill"
  ]);
  const temp=await mkdtemp(join(tmpdir(),"theia-brand-"));
  try{
    await writeFile(join(temp,"index.html"),
      '<!doctype html><html><head></head><body><div class="lm-MenuBar"><ul class="lm-MenuBar-content"></ul></div></body></html>');
    const first=await prepareTheiaBrand(temp);
    const second=await prepareTheiaBrand(temp);
    const html=await readFile(join(temp,"index.html"),"utf8");
    assert.equal((html.match(/id="skill-studio-brand-theme"/g)||[]).length,1);
    assert.equal((html.match(/id="skill-studio-brand-script"/g)||[]).length,1);
    assert.match(html,/href="\.\/skill-studio-brand\.css"/);
    assert.match(html,/src="\.\/skill-studio-brand\.js"/);
    assert.ok(first.cssBytes>150);
    assert.ok(first.scriptBytes>500);
    assert.equal(first.cssBytes,second.cssBytes);
    assert.equal(first.scriptBytes,second.scriptBytes);
    assert.match(await readFile(join(temp,"skill-studio-brand.js"),"utf8"),/SKILL Studio/);
  }finally{
    await rm(temp,{recursive:true,force:true});
  }
});

test("Native Markdown links are constrained to the exact inventoried Skill Package",()=>{
  const allowed=new Set([
    "SKILL.md","references/3gpp-procedure.md",
    "assurance/procedure.yaml","scripts/select.py"
  ]);
  assert.equal(isAllowedPackageRelativeLink("../SKILL.md","references",allowed),true);
  assert.equal(isAllowedPackageRelativeLink("../assurance/procedure.yaml","references",allowed),true);
  assert.equal(isAllowedPackageRelativeLink("../../outside.md","references",allowed),false);
  assert.equal(isAllowedPackageRelativeLink("missing.md","references",allowed),false);
  assert.equal(isAllowedPackageRelativeLink("../../../outside.md","references",allowed),false);
  assert.equal(isAllowedPackageRelativeLink("%2e%2e/%2e%2e/outside.md","references",allowed),false);
  assert.equal(isAllowedPackageRelativeLink("//example.invalid/pixel.png","references",allowed),false);
  assert.equal(isAllowedPackageRelativeLink("https://example.invalid/","references",allowed),true,
    "external navigation is not fetched by the preview; raw images remain blocked");
});
