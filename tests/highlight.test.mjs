import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {highlightSource,languageForPath} from "../site/highlight.mjs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");

test("syntax language is chosen from real Package extension",()=>{
  const modes=[
    ["assurance/procedure.yaml","yaml"],["contract.yml","yaml"],
    ["SKILL.md","markdown"],["scripts/evaluate_udm_read.py","python"],
    ["request.json","json"],["README.txt","plain"]
  ];
  for(const [file,expected] of modes)assert.equal(languageForPath(file),expected,file);
});
test("YAML highlighting colors source keys, comments, scalars and values",()=>{
  const src="procedures:\n  on:\n    'on': PASS\n  ok: true # note\n";
  const result=highlightSource(src,"procedure.yaml");
  assert.equal(result.language,"yaml");
  assert.equal(result.enabled,true);
  assert.match(result.html,/class="tok-key">procedures/);
  assert.match(result.html,/class="tok-key">on/);
  assert.match(result.html,/class="tok-literal">true/);
  assert.match(result.html,/class="tok-comment"># note/);
  assert.equal(src.endsWith("\n"),true);
});
test("Markdown, Python and JSON tokenize without changing authoritative Source",()=>{
  assert.match(highlightSource("# Hello\n- **bold**","SKILL.md").html,/tok-heading/);
  assert.match(highlightSource("def apply():\n    return True # note","script.py").html,/tok-keyword/);
  assert.match(highlightSource('{"maxActions": 6, "enabled": false}',"x.json").html,/tok-number/);
  assert.match(highlightSource('{"maxActions": 6}',"x.json").html,/tok-key/);
});
test("highlighted HTML escapes dangerous text, including code and quote content",()=>{
  const text="key: '<img src=x onerror=alert(1)>'\ncomment: \"&<>\"\n# </pre><script>run()</script>\n";
  const highlighted=highlightSource(text,"source.yaml").html;
  assert.doesNotMatch(highlighted,/<img|<script>|<\/pre>/);
  assert.match(highlighted,/&lt;img/);
  assert.match(highlighted,/&lt;script&gt;/);
  assert.match(highlighted,/&amp;/);
});
test("over-budget text and unknown file types safely fall back to normal textarea",()=>{
  const data="a".repeat(100);
  assert.equal(highlightSource(data,"procedure.yaml",50).enabled,false);
  assert.equal(highlightSource(data,"text.txt").enabled,false);
  assert.equal(highlightSource(data,"procedure.yaml",500).enabled,true);
});
test("Source editor mirrors typing and scrolling with an escaped highlight layer",()=>{
  const html=read("site/index.html"),app=read("site/app.mjs");
  const css=read("site/light.css");
  assert.match(html,/id="sourceHighlight"/);
  assert.match(html,/id="sourceEditor"[^>]*data-highlight/);
  assert.match(html,/id="source" wrap="off"/);
  assert.match(app,/sourceHighlight\.innerHTML=highlighted\.html/);
  assert.match(app,/sourceHighlight\.scrollTop=source\.scrollTop/);
  assert.match(app,/sourceHighlight\.scrollLeft=source\.scrollLeft/);
  assert.match(app,/refreshHighlight\(\)/);
  assert.match(css,/white-space:nowrap!important/);
  assert.match(css,/text-overflow:ellipsis!important/);
  assert.match(css,/caret-color:#107c70/);
});
