import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  fileIconKind,fileIconSpec,createFileIcon,createFolderIcon
} from "../site/file-icons.mjs";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");

test("Explorer file suffixes map to distinct, case-insensitive theme icons",()=>{
  const cases={
    "SKILL.md":"markdown",
    "notes.markdown":"markdown",
    "assurance/contract.yaml":"yaml",
    "assurance/procedure.YML":"yaml",
    "assurance/predicates.yaml":"yaml",
    "scripts/evaluate_transfer_start.py":"python",
    "scripts/setup.PYW":"python",
    "settings.json":"json",
    "config.JSONC":"json",
    "hooks/setup.sh":"script",
    "hooks/dev.fish":"script",
    "lyrics.txt":"text",
    "index.tsx":"code",
    "something.unknown":"generic",
    "README":"generic"
  };
  for(const [path,kind] of Object.entries(cases))
    assert.equal(fileIconKind(path),kind,path);
  assert.equal(fileIconKind("windows\\nested\\SKILL.MD"),"markdown");
});
test("file theme provides visually distinct glyphs and colors",()=>{
  const known=["yaml","markdown","python","json","script","text","generic"];
  const icons=known.map(ext=>fileIconSpec("file."+({
    yaml:"yaml",markdown:"md",python:"py",json:"json",
    script:"sh",text:"txt",generic:"bin"
  })[ext]));
  assert.equal(new Set(icons.map(x=>x.ink)).size,known.length);
  assert.equal(new Set(icons.map(x=>x.glyph||x.name)).size,known.length);
  assert.ok(icons.every(x=>/^#[0-9a-f]{6}$/i.test(x.fill)&&x.name));
});
test("icons are real locally-rendered SVG with hidden decorative shapes",()=>{
  class Node {
    constructor(tag){this.tag=tag;this.attributes={};this.children=[];this.textContent="";}
    setAttribute(k,v){this.attributes[k]=String(v);}
    append(...children){this.children.push(...children);}
    appendChild(node){this.children.push(node);return node;}
  }
  const document={createElementNS:(ns,tag)=>{
    assert.equal(ns,"http://www.w3.org/2000/svg");
    return new Node(tag);
  }};
  for(const [filename,kind] of [
    ["assurance/procedure.yaml","yaml"],["SKILL.md","markdown"],
    ["scripts/selector.py","python"],["settings.json","json"],
    ["unknown.ext","generic"]
  ]){
    const svg=createFileIcon(document,filename);
    assert.equal(svg.tag,"svg");
    assert.equal(svg.attributes["data-icon-kind"],kind);
    assert.equal(svg.attributes["aria-hidden"],"true");
    assert.equal(svg.attributes.viewBox,"0 0 20 20");
    assert.ok(svg.children.some(x=>x.tag==="path"));
  }
  const folder=createFolderIcon(document);
  assert.equal(folder.tag,"svg");
  assert.equal(folder.attributes["aria-hidden"],"true");
  assert.ok(folder.children.some(x=>x.attributes.class==="asset-folder-closed"));
  assert.ok(folder.children.some(x=>x.attributes.class==="asset-folder-open"));
});
test("Explorer keeps path/selection/dirty state while replacing uniform ▤ glyph",()=>{
  const app=read("site/app.mjs");
  const css=read("site/light.css");
  assert.match(app,/import \{createFileIcon,createFolderIcon\} from "\.\/file-icons\.mjs"/);
  assert.match(app,/const glyph=createFileIcon\(document,file\.path\)/);
  assert.match(app,/summary\.append\(createFolderIcon\(document\)/);
  assert.match(app,/btn\.append\(glyph,title\)/);
  assert.match(app,/btn\.setAttribute\("aria-label",file\.path/);
  assert.match(app,/fileDirtyState\(activePackage,file\.path\)/);
  assert.match(app,/const row=el\("div","asset-file-row asset-procedure-row"\)/);
  assert.match(css,/\.asset-folder-icon \.asset-folder-open\{display:none\}/);
  assert.match(css,/\.asset-folder-group\[open\]>.asset-folder-title \.asset-folder-open\{display:inline\}/);
  assert.match(css,/\.asset-tree \.asset-file-icon,\s*\.asset-tree \.asset-folder-icon\{/);
  assert.doesNotMatch(app,/asset-file-icon","▤"/);
});
