import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,statSync,readdirSync,existsSync} from "node:fs";
import {mkdtemp,readFile,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {buildClassicIconsCss,THEIA_CLASSIC_ICON_MAP} from "../scripts/classic-icons-css.mjs";
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
  assert.equal(app.theiaPlugins["vscode.markdown-language-features"],
    "https://open-vsx.org/api/vscode/markdown-language-features/1.95.3/file/vscode.markdown-language-features-1.95.3.vsix");
  assert.equal(app.scripts["download:plugins"],"theia download:plugins");
  assert.ok(!app.dependencies["@theia/terminal"]);
  assert.equal(app.scripts.build,"theia build --mode production");
});
test("Theia plugin is the exact Web extension, with native editor + view contributions",()=>{
  const app=JSON.parse(readFileSync(join(root,"package.json"),"utf8"));
  const plugin=JSON.parse(readFileSync(join(root,"plugins/odango-chan.ca-skill-studio-ide-spike/package.json"),"utf8"));
  assert.ok(plugin.browser?.endsWith("extension-theia.js"));
  const editorViews=new Set(plugin.contributes.customEditors.map(x=>x.viewType));
  for(const view of ["skillStudio.procedurePreview","skillStudio.contractPreview",
    "skillStudio.predicatePreview","skillStudio.schemaPreview"])assert.ok(editorViews.has(view),view);
  const workbenchViews=new Set(plugin.contributes.views.skillStudio.map(x=>x.id));
  assert.ok(workbenchViews.has("skillStudio.packages"),
    "multi-Package Overview must live in the Skill Studio activity bar");
  assert.ok(plugin.activationEvents.includes("onCommand:skillStudio.refreshPackages"));
  assert.ok(plugin.activationEvents.includes("onView:skillStudio.packages"));
  assert.ok(plugin.contributes.menus["view/title"].some(x=>
    x.command==="skillStudio.refreshPackages"&&x.when==="view == skillStudio.packages"));
  assert.ok(plugin.contributes.customEditors.every(x=>x.priority==="default"));
  const associations=app.theia.frontend.config.preferences["workbench.editorAssociations"];
  assert.equal(associations["procedure.yaml"],"skillStudio.procedurePreview");
  assert.equal(associations["contract.yaml"],"skillStudio.contractPreview");
  assert.equal(associations["predicates.yaml"],"skillStudio.predicatePreview");
  assert.equal(associations["*.schema.yaml"],"skillStudio.schemaPreview");
  assert.ok(plugin.activationEvents.includes("onStartupFinished"),
    "first-run demo discovery must activate on startup");
  assert.ok(plugin.contributes.viewsWelcome?.some(x=>
    x.view==="workbench.explorer.fileView"&&
    x.contents.includes("command:skillStudio.loadExample")),
    "Explorer empty state must offer the demo project");
  assert.ok(plugin.contributes.menus?.["view/title"]?.some(x=>
    x.command==="skillStudio.loadExample"),
    "Explorer title toolbar must expose the demo project");
  for(const f of ["dist/extension-web.cjs","dist/extension-theia.js","dist/skill-language-server.js","media/procedure.js","media/procedure.css",
    "samples/skills/files.json",
    "samples/skills/establish-pdu-session/assurance/procedure.yaml",
    "samples/skills/establish-pdu-session-mas/assurance/procedure.yaml"])
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
  assert.deepEqual(manifest.contributes["markdown.previewStyles"],["./styles/markdown-preview.css"]);
  for(const path of [
    "themes/skill-studio-light-color-theme.json","icons/skill-studio-file-icon-theme.json",
    "styles/markdown-preview.css",
    "icons/skill.svg","icons/yaml.svg","icons/markdown.svg","icons/python.svg",
    "icons/json.svg","icons/shell.svg","icons/text.svg",
    "icons/file.svg","icons/folder.svg","icons/folder-open.svg","icons/code.svg"
  ])assert.ok(statSync(join(themeRoot,path)).size>80,path);
  const markdownCss=readFileSync(join(themeRoot,"styles/markdown-preview.css"),"utf8");
  assert.match(markdownCss,/--vscode-skillstudio-markdownheading/);
  assert.match(markdownCss,/thead th/);
  assert.match(markdownCss,/max-height: 65vh/);
});

function findMarkdownManifest(directory){
  if(!existsSync(directory))return null;
  for(const entry of readdirSync(directory,{withFileTypes:true})){
    const target=join(directory,entry.name);
    if(!entry.isDirectory())continue;
    const manifestPath=join(target,"package.json");
    if(existsSync(manifestPath)){
      try{
        const manifest=JSON.parse(readFileSync(manifestPath,"utf8"));
        if(manifest.publisher==="vscode"&&manifest.name==="markdown-language-features")
          return {manifest,path:manifestPath,root:target};
      }catch{/* Continue searching other unpacked plugins. */}
    }
    const nested=findMarkdownManifest(target);
    if(nested)return nested;
  }
  return null;
}
test("Theia unpacks the pinned native Markdown language-features plugin",{
  skip:!findMarkdownManifest(join(root,"plugins"))
},()=>{
  const plugin=findMarkdownManifest(join(root,"plugins"));
  assert.ok(plugin,"Theia CLI must unpack the downloaded Markdown extension");
  assert.ok(plugin.manifest.browser,"browser preview entry is required in browser-only Theia");
  assert.ok(plugin.manifest.contributes.commands.some(x=>x.command==="markdown.showPreviewToSide"),
    "native side-by-side Markdown Preview command must be available");
  assert.ok(plugin.manifest.contributes["markdown.previewStyles"],
    "native extension must support shared Markdown preview styles");
  assert.ok(statSync(plugin.path).size>1000,"unpacked plugin manifest must be complete");
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

test("Theia activity bar and shell toolbars render from the Classic icon registry",()=>{
  const css=buildClassicIconsCss();
  for(const name of ["files","search","source-control","debug-alt","extensions",
    "settings-gear","account","new-file","new-folder","undo","redo","save",
    "refresh","close","menu","chevron-down","collapse-all"]){
    assert.ok(THEIA_CLASSIC_ICON_MAP[name],name+" must map to a Classic icon");
    assert.ok(css.includes(".theia-app-sides .codicon-"+name+"::before")||
      css.includes(".theia-navigator .codicon-"+name+"::before")||
      css.includes(".lm-MenuBar .codicon-"+name+"::before"),name);
  }
  assert.match(css,/mask-image:url\("data:image\/svg\+xml,/);
  assert.match(css,/background-color:currentColor/);
  assert.doesNotMatch(css,/https?:\/\//);
});

test("SKILL Studio wordmark sits beside the native menu list and compacts on narrow screens",async()=>{
  const css=buildSkillStudioBrandCss();
  const script=buildSkillStudioBrandScript();
  assert.match(css,/\.lm-MenuBar\.skill-studio-branded/);
  assert.match(css,/\.lm-MenuBar-content/);
  assert.match(css,/linear-gradient\(145deg,#dcf8ef,#b8e6de\)/);
  assert.match(css,/@media\(max-width:760px\)/);
  assert.match(css,/\.skill-studio-brand-label\{display:none\}/);
  assert.doesNotMatch(css,/\.lm-MenuBar-item/);
  assert.match(script,/document\.querySelectorAll\(BAR_SELECTOR\)/);
  assert.match(script,/\[id="theia:menubar"\]/);
  assert.match(script,/bar\.insertBefore\(brand,content\)/);
  assert.match(script,/label\.textContent = "SKILL Studio"/);
  assert.match(script,/new MutationObserver\(mount\)/);
  assert.doesNotMatch(script,/content\.appendChild|addEventListener\(["']click/);

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
    assert.ok(first.cssBytes>500);
    assert.ok(first.scriptBytes>500);
    assert.equal(first.cssBytes,second.cssBytes);
    assert.equal(first.scriptBytes,second.scriptBytes);
    assert.match(await readFile(join(temp,"skill-studio-brand.js"),"utf8"),/SKILL Studio/);
  }finally{
    await rm(temp,{recursive:true,force:true});
  }
});
