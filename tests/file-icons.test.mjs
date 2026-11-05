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
test("file types share one stroke-only geometry vocabulary, without emoji/badges",()=>{
  const known=["yaml","markdown","python","json","script","text","generic"];
  const specs=known.map(ext=>fileIconSpec("file."+({
    yaml:"yaml",markdown:"md",python:"py",json:"json",
    script:"sh",text:"txt",generic:"bin"
  })[ext]));
  assert.ok(specs.every(x=>x.icon.startsWith("file")&&x.name&&x.tone));
  assert.ok(new Set(specs.map(x=>x.icon)).size>=4);
  assert.ok(specs.every(x=>!Object.hasOwn(x,"fill")&&!Object.hasOwn(x,"glyph")));
});
test("icons are real locally-rendered SVG with hidden decorative shapes",()=>{
  class Node {
    constructor(tag){this.tag=tag;this.attributes={};this.children=[];this.textContent="";}
    setAttribute(k,v){this.attributes[k]=String(v);}
    append(...children){this.children.push(...children);}
    appendChild(node){this.children.push(node);return node;}
    get firstChild(){return this.children[0]??null;}
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
    assert.equal(svg.attributes.viewBox,"0 0 24 24");
    assert.equal(svg.attributes.fill,"none");
    assert.equal(svg.attributes.stroke,"currentColor");
    assert.ok(svg.children.some(x=>x.tag==="path"));
  }
  const folder=createFolderIcon(document);
  assert.equal(folder.tag,"svg");
  assert.equal(folder.attributes.stroke,"currentColor");
  assert.equal(folder.attributes["aria-hidden"],"true");
  assert.ok(folder.children.some(x=>x.attributes.class==="asset-folder-closed"));
  assert.ok(folder.children.some(x=>x.attributes.class==="asset-folder-open"));
});
test("Explorer keeps path/selection/dirty state while replacing uniform ▤ glyph",()=>{
  const app=read("site/app.mjs");
  const css=read("site/light.css");
  assert.match(app,/import \{createFileIcon,createFolderIcon\} from "\.\/file-icons\.mjs"/);
  assert.match(app,/const glyph=createFileIcon\(document,file\.path\)/);
  assert.match(app,/summary\.append\(/);
  assert.match(app,/createIcon\(document,"chevron-right",\{size:13,className:"disclosure-chevron"\}\)/);
  assert.match(app,/createFolderIcon\(document\)/);
  assert.match(app,/btn\.append\(glyph,title\)/);
  assert.match(app,/btn\.setAttribute\("aria-label",file\.path/);
  assert.match(app,/fileDirtyState\(activePackage,file\.path\)/);
  assert.match(app,/const row=el\("div","asset-file-row asset-procedure-row"\)/);
  assert.match(css,/\.asset-folder-icon \.asset-folder-open\{display:none\}/);
  assert.match(css,/\.asset-folder-group\[open\]>.asset-folder-title \.asset-folder-open\{display:inline\}/);
  assert.match(css,/\.asset-tree \.asset-file-icon,\s*\.asset-tree \.asset-folder-icon\{/);
  assert.doesNotMatch(app,/asset-file-icon","▤"/);
});

test("shared icon registry uses deterministic, stroke-only and accessible SVG",async()=>{
  const {createIcon,iconShapes,operatorIcon}=await import("../site/icons.mjs");
  const made=[];
  const document={createElementNS:(ns,tag)=>{
    assert.equal(ns,"http://www.w3.org/2000/svg");
    const node={tag,attributes:{},children:[],
      setAttribute(key,v){this.attributes[key]=String(v);},
      appendChild(child){this.children.push(child);return child;}};
    made.push(node);return node;
  }};
  for(const name of ["workflow","git-branch","undo-2","redo-2","zoom-in","zoom-out",
    "panel-left-close","panel-left-open","network","columns-2","code-2",
    "file-code","file-text","folder","shield-check","plug-zap"]){
    const svg=createIcon(document,name,{size:16});
    assert.equal(svg.attributes["data-icon"],name);
    assert.equal(svg.attributes["aria-hidden"],"true");
    assert.equal(svg.attributes.fill,"none");
    assert.equal(svg.attributes.stroke,"currentColor");
    assert.equal(svg.attributes["stroke-linejoin"],"round");
    assert.ok(svg.children.length>0);
    assert.equal(svg.children.length,iconShapes(name).length);
    assert.ok(svg.children.every(x=>["path","rect","line","circle","polyline"].includes(x.tag)));
  }
  assert.equal(operatorIcon("procedure"),"workflow");
  assert.equal(operatorIcon("verify"),"shield-check");
  assert.throws(()=>iconShapes("not-a-real-icon"),/Unknown Studio icon/);
});

test("every named toolbar icon exists; directory import never breaks startup",async()=>{
  const {iconShapes}=await import("../site/icons.mjs");
  const app=read("site/app.mjs"),html=read("site/index.html");
  const start=app.indexOf("function decorateToolbar()");
  const end=app.indexOf("\ndecorateToolbar();",start);
  assert.ok(start>=0&&end>start);
  const block=app.slice(start,end);
  const icons=[...block.matchAll(/\["[^"]+","([^"]+)","[^"]+"\]/g)]
    .map(match=>match[1]);
  assert.ok(icons.includes("folder-open"));
  assert.ok(icons.includes("folder-plus"));
  for(const icon of icons)assert.doesNotThrow(()=>iconShapes(icon),icon);
  assert.match(html,/id="openDirectoryButton"/);
  assert.match(html,/id="directoryPicker"[^>]*webkitdirectory/);
});
