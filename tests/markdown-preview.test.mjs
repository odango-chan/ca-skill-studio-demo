import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {renderMarkdown} from "../site/markdown-preview.mjs";
const fixture=name=>readFileSync(
  new URL("../site/samples/packages/"+name+"/SKILL.md",import.meta.url),"utf8");

test("Markdown preview renders headings, emphasis, inline code, lists and blockquotes",()=>{
  const source="# Demo\n\nA **bold** and *italic* word with \x60code\x60.\n\n- First\n- Second\n\n> A quote\n";
  const html=renderMarkdown(source).html;
  assert.match(html,/<h1(?: id="[^"]+")? data-source-line="\d+">Demo<\/h1>/);
  assert.match(html,/<strong>bold<\/strong>/);
  assert.match(html,/<em>italic<\/em>/);
  assert.match(html,/<code>code<\/code>/);
  assert.match(html,/<ul data-source-line="4"><li data-source-line="4">First<\/li><li data-source-line="5">Second<\/li><\/ul>/);
  assert.match(html,/<blockquote data-source-line="7"><p data-source-line="7">A quote<\/p><\/blockquote>/);
});
test("SKILL.md frontmatter is readable and actual fixture renders as a document",()=>{
  for(const name of ["establish-pdu-session"]){
    const content=fixture(name);
    const result=renderMarkdown(content);
    assert.equal(result.available,true);
    assert.match(result.html,/<details class="md-frontmatter" data-source-line="0">/);
    assert.match(result.html,/<h1(?: id="[^"]+")? data-source-line="\d+">[^<]+<\/h1>/);
    assert.match(result.html,/<h2(?: id="[^"]+")? data-source-line="\d+">Purpose<\/h2>/);
    assert.doesNotMatch(result.html,/<script\b/i);
  }
});
test("fenced code blocks and tables are rendered without interpreting HTML",()=>{
  const source=[
    "# Reference","",
    "\x60\x60\x60yaml","entry: <untrusted>","\x60\x60\x60","",
    "| Field | Status |","| --- | --- |","| root | Ready |"
  ].join("\n");
  const html=renderMarkdown(source).html;
  assert.match(html,/<pre data-source-line="\d+"><code data-language="yaml">/);
  assert.match(html,/&lt;untrusted&gt;/);
  assert.match(html,/<table><thead><tr data-source-line="\d+"><th>Field<\/th><th>Status<\/th><\/tr>/);
  assert.match(html,/<td>root<\/td>/);
});
test("untrusted raw HTML, dangerous links, and Markdown images cannot execute",()=>{
  const source=[
    "# <img src=x onerror=alert(1)>",
    "<script>alert(2)</script>",
    "[run](javascript:alert)",
    "[data](data:text/html;base64,evil)",
    "![screenshot](https://example.com/tracker.png)",
    "[documentation](https://example.com/manual)"
  ].join("\n");
  const html=renderMarkdown(source).html;
  assert.doesNotMatch(html,/<script\b|<img\b|<iframe\b|<svg\b/i);
  assert.doesNotMatch(html,/href="(?:javascript|data):/i);
  assert.doesNotMatch(html,/src="https:\/\/example.com\/tracker.png"/);
  assert.match(html,/&lt;script&gt;/);
  assert.match(html,/图片：screenshot/);
  assert.match(html,/href="https:\/\/example.com\/manual"/);
  assert.match(html,/rel="noopener noreferrer"/);
});
test("unsupported oversized Markdown fails closed to Source only",()=>{
  const result=renderMarkdown("x".repeat(200),{maxChars:100});
  assert.equal(result.available,false);
  assert.equal(result.html,"");
  assert.match(result.reason,/太大/);
  assert.throws(()=>renderMarkdown(null),TypeError);
});


test("all three current CreatedSession business References render safely in Markdown Visual",()=>{
  const paths=["3gpp-procedure.md","session-selection.md","failure-handling.md"];
  for(const name of paths){
    const source=readFileSync(new URL("../site/samples/packages/"+
      "establish-pdu-session/references/"+name,import.meta.url),"utf8");
    const rendered=renderMarkdown(source);
    assert.equal(rendered.available,true,name);
    assert.match(rendered.html,/<h1(?: id="[^"]+")? data-source-line="\d+">[^<]+<\/h1>/,name);
    assert.doesNotMatch(rendered.html,/<script\b|<iframe\b|<img\b/i,name);
    assert.ok(rendered.html.length>1000,name);
  }
  const gpp=renderMarkdown(readFileSync(new URL("../site/samples/packages/"+
    "establish-pdu-session/references/3gpp-procedure.md",import.meta.url),"utf8"));
  assert.match(gpp.html,/md-unresolved-link/);
  assert.doesNotMatch(gpp.html,/href="\.\.\/SKILL.md"/);
});

test("current dual Skill guides render safely and expose only explicit Package-local paths",()=>{
  for(const name of ["establish-pdu-session","establish-pdu-session-mas"]){
    const source=readFileSync(new URL("../site/samples/skills/"+name+"/SKILL.md",import.meta.url),"utf8");
    const preview=renderMarkdown(source);
    assert.equal(preview.available,true,name);
    assert.match(preview.html,/<details class="md-frontmatter" data-source-line="0">/,name);
    assert.match(preview.html,/<h1(?: id="[^"]+")? data-source-line="\d+">[^<]+<\/h1>/,name);
    assert.doesNotMatch(preview.html,/<script\b|<iframe\b|<img\b/i,name);
  }
  const source=readFileSync(new URL(
    "../site/samples/skills/establish-pdu-session/SKILL.md",import.meta.url),"utf8");
  const packageFiles=new Set([
    "SKILL.md","assurance/procedure.yaml",
    "references/3gpp-procedure.md","references/session-selection.md",
    "references/failure-handling.md"
  ]);
  const linked=renderMarkdown(source,{
    localLinks:true,localFiles:packageFiles,relativeDir:""
  }).html;
  assert.match(linked,/data-local-path="assurance\/procedure\.yaml"/);
  assert.match(linked,/data-local-path="references\/3gpp-procedure\.md"/);
  assert.match(linked,/data-local-path="references\/session-selection\.md"/);
  assert.match(linked,/data-local-path="references\/failure-handling\.md"/);
  // Do not couple the canonical guide to an obsolete repository-level link:
  // an updated ca-skills SKILL.md may legitimately contain only local links.
  assert.doesNotMatch(linked,/data-local-path="\.\.\/\.\.\/docs/);
  assert.doesNotMatch(linked,/data-local-path="docs\/design\/llm-skill-execution-baseline\.md"/);
});

test("Reference Markdown can link back to SKILL.md, while local navigation is opt-in",()=>{
  const source=readFileSync(new URL(
    "../site/samples/skills/establish-pdu-session/references/3gpp-procedure.md",
    import.meta.url),"utf8");
  const ordinary=renderMarkdown(source).html;
  assert.doesNotMatch(ordinary,/data-local-path=/);
  const linked=renderMarkdown(source,{
    localLinks:true,localFiles:new Set(["SKILL.md","references/3gpp-procedure.md"]),
    relativeDir:"references"
  }).html;
  assert.match(linked,/data-local-path="\.\.\/SKILL\.md"/);
});

test("Package-local Markdown navigation never promotes unsafe or escaping paths",()=>{
  const source=[
    "`session-selection.md`",
    "[return](../SKILL.md)",
    "[escape](../../docs/design/private.md)",
    "[sibling](../../establish-pdu-session-mas/SKILL.md)",
    "[unsafe](javascript:alert(1))",
    "[remote](https://example.com/manual)"
  ].join("\n");
  const html=renderMarkdown(source,{
    localLinks:true,localFiles:new Set(["SKILL.md","references/session-selection.md"]),
    relativeDir:"references"
  }).html;
  assert.match(html,/data-local-path="session-selection\.md"/);
  assert.match(html,/data-local-path="\.\.\/SKILL\.md"/);
  assert.doesNotMatch(html,/data-local-path="\.\.\/\.\.\//);
  assert.doesNotMatch(html,/data-local-path="\.\.\/establish-pdu-session-mas/);
  assert.doesNotMatch(html,/href="javascript:/i);
  assert.match(html,/href="https:\/\/example\.com\/manual"/);
});
test("Markdown preview adds navigable headings and ignores fenced code",()=>{
  const source=[
    "# Guide","","## Setup","","```md","## Not a heading","```","","## Setup"
  ].join("\n");
  const html=renderMarkdown(source).html;
  assert.match(html,/class="md-toc"/);
  const ids=[...html.matchAll(/<h[1-6] id="(md-heading-\d+)"/g)].map(match=>match[1]);
  assert.equal(ids.length,3);
  assert.equal(new Set(ids).size,3);
  assert.match(html,/href="#md-heading-0"/);
  assert.match(html,/href="#md-heading-2"/);
  assert.match(html,/href="#md-heading-8"/);
  assert.doesNotMatch(html,/href="#md-heading-5"/);
});

test("GFM table alignment is applied to header and body cells without inline styles",()=>{
  const html=renderMarkdown([
    "| Name | Count | Result | Plain |",
    "| :--- | ---: | :---: | --- |",
    "| a\\|b | 12 | <unsafe> | yes |"
  ].join("\n")).html;
  assert.match(html,/<th class="md-align-left">Name<\/th>/);
  assert.match(html,/<th class="md-align-right">Count<\/th>/);
  assert.match(html,/<th class="md-align-center">Result<\/th>/);
  assert.match(html,/<th>Plain<\/th>/);
  assert.match(html,/<td class="md-align-left">a\|b<\/td>/);
  assert.match(html,/<td class="md-align-right">12<\/td>/);
  assert.match(html,/<td class="md-align-center">&lt;unsafe&gt;<\/td>/);
  assert.doesNotMatch(html,/<(?:th|td)[^>]*\sstyle=|<unsafe>/i);
});


test("Markdown blocks carry original source lines through frontmatter, lists, tables and code",()=>{
  const source=[
    "---","name: demo","---","","# Title","","## Section","Text","",
    "- first","- second","","| A | B |","| --- | --- |","| x | y |","",
    "```yaml","key: value","```"
  ].join("\n");
  const html=renderMarkdown(source).html;
  assert.match(html,/<h1 id="md-heading-1" data-source-line="4">Title<\/h1>/);
  assert.match(html,/<h2 id="md-heading-3" data-source-line="6">Section<\/h2>/);
  assert.match(html,/<p data-source-line="7">Text<\/p>/);
  assert.match(html,/<ul data-source-line="9"><li data-source-line="9">first<\/li><li data-source-line="10">second<\/li><\/ul>/);
  assert.match(html,/class="md-table-wrap" data-source-line="12"/);
  assert.match(html,/<tr data-source-line="14"><td>x<\/td>/);
  assert.match(html,/<pre data-source-line="16"><code data-language="yaml">/);
});

test("the shared Markdown theme styles wide tables, sticky headings and host colors",()=>{
  const css=readFileSync(new URL("../site/markdown-preview.css",import.meta.url),"utf8");
  assert.match(css,/--vscode-editor-background/);
  assert.match(css,/--vscode-skillStudio-markdownHeading/);
  assert.match(css,/\.markdown-preview h1,.markdown-preview h2\{color:var\(--md-heading\)\}/);
  assert.match(css,/\.md-table-wrap\s*\{/);
  assert.match(css,/max-height:65vh;overflow:auto/);
  assert.match(css,/position:sticky;top:0/);
  assert.match(css,/\.md-align-right\s*\{/);
  assert.doesNotMatch(css,/@import\b|url\(/);
});
