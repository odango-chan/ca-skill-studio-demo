import test from "node:test";
import assert from "node:assert/strict";
import {existsSync,readFileSync} from "node:fs";
import {join} from "node:path";
const root="extensions/skill-studio-theme";
const read=path=>readFileSync(join(root,path),"utf8");
const manifest=JSON.parse(read("package.json"));
const theme=JSON.parse(read("themes/skill-studio-light-color-theme.json"));
const icons=JSON.parse(read("icons/skill-studio-file-icon-theme.json"));
test("SKILL Studio theme is a standalone offline VS Code extension",()=>{
  assert.equal(manifest.name,"skill-studio-theme");
  assert.equal(manifest.publisher,"odango-chan");
  assert.ok(manifest.engines.vscode);
  assert.equal(manifest.contributes.themes[0].label,"SKILL Studio Light");
  assert.equal(manifest.contributes.themes[0].uiTheme,"vs");
  assert.equal(manifest.contributes.iconThemes[0].id,"skill-studio-file-icons");
  assert.equal(manifest.main,undefined);
  assert.equal(manifest.browser,undefined);
  assert.equal(manifest.activationEvents,undefined);
  assert.equal(Object.keys(manifest.dependencies??{}).length,0);
});
test("host colors reuse established Studio Light design tokens",()=>{
  assert.equal(theme.name,"SKILL Studio Light");
  assert.equal(theme.type,"light");
  assert.equal(theme.semanticHighlighting,true);
  const css=readFileSync("site/light.css","utf8").toLowerCase();
  const expected={"--bg":"#f5f7fb","--panel":"#ffffff","--border":"#e1e7ef","--text":"#20314a",
    "--muted":"#697e97","--accent":"#0c8e7b","--blue":"#317dc0","--warning":"#ad6517"};
  for(const [token,color] of Object.entries(expected))assert.ok(css.includes(token+":"+color),token);
  assert.equal(theme.colors["editor.background"],"#FFFFFF");
  assert.equal(theme.colors["sideBar.background"],"#FFFFFF");
  assert.equal(theme.colors["activityBar.activeBorder"],"#0C8E7B");
  assert.equal(theme.colors["icon.foreground"],"#57728B");
  assert.ok(theme.tokenColors.length>=12&&theme.semanticTokenColors.function);
});
test("file icon theme maps SKILL assets and local SVGs",()=>{
  assert.equal(icons.fileNames["SKILL.md"],"_skill");
  assert.equal(icons.fileNames["procedure.yaml"],"_yaml");
  assert.equal(icons.fileExtensions.py,"_python");
  assert.equal(icons.fileExtensions.md,"_markdown");
  for(const [id,definition] of Object.entries(icons.iconDefinitions)){
    const path=definition.iconPath,asset=join(root,"icons",path.slice(2));
    assert.ok(path.startsWith("./"),id);
    assert.ok(existsSync(asset),id+": "+path);
    const svg=readFileSync(asset,"utf8");
    assert.match(svg,/<svg\b/);
    assert.match(svg,/stroke-linecap="round"/);
    assert.match(svg,/stroke-linejoin="round"/);
    // SVG's mandatory xmlns URI is an identifier, not a network request.
    // Only actual external resource references are forbidden.
    assert.doesNotMatch(svg,/(?:href|src)\s*=\s*["']https?:\/\//i);
    assert.doesNotMatch(svg,/url\(\s*["']?https?:\/\//i);
    assert.doesNotMatch(svg,/<(?:image|script)\b/i);
  }
});
test("native Codicons remain the single product-icon family",()=>{
  assert.match(read("README.md"),/Native Codicons remain intact/);
  assert.equal(manifest.contributes.productIconThemes,undefined);
});
