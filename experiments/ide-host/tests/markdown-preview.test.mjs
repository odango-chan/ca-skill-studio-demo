import test from "node:test";
import assert from "node:assert/strict";
import {renderStudioMarkdown,markdownLinkCandidate}
  from "../vscode/src/markdown-preview-renderer.mjs";
import {setNativeMarkdownPackagePolicies,resolveNativeMarkdownPackageLink}
  from "../vscode/src/markdown-link-policy.mjs";

const uri=path=>({path,toString(){return "file://"+path;}});

test("Markdown preview renders GFM headings, tables and source-line anchors",()=>{
  const text="# Guide\n\nSome **bold** text.\n\n| Name | Value |\n| ---- | ----- |\n| a | b |\n";
  const result=renderStudioMarkdown(text);
  assert.match(result.html,/<h1>Guide<\/h1>/);
  assert.match(result.html,/<strong>bold<\/strong>/);
  assert.match(result.html,/<table>/);
  assert.match(result.html,/data-source-line="5"/);
  assert.ok(result.blockCount>=3);
});

test("raw HTML and script payloads are escaped, and images never generate DOM fetches",()=>{
  const text=[
    "# <img src=x onerror=alert(1)>",
    "<script>window.pwned=true</script>",
    "<iframe src=\"https://example.invalid\"></iframe>",
    "![pixel](https://example.invalid/pixel.png)",
    "[bad](javascript:alert(1))",
    "[good](references/guide.md)"
  ].join("\n\n");
  const html=renderStudioMarkdown(text).html;
  assert.doesNotMatch(html,/<(?:img|script|iframe)\b/i);
  assert.doesNotMatch(html,/href="(?:javascript|https?):/i);
  assert.doesNotMatch(html,/data-studio-href="javascript:/i);
  assert.match(html,/&lt;script&gt;/);
  assert.match(html,/data-studio-href="references\/guide.md"/);
  assert.match(html,/studio-markdown-image-disabled/);
});

test("unsafe markup and links do not bypass the preview's guarded click routing",()=>{
  for(const href of [
    "javascript:alert(1)","file:///etc/passwd","data:text/html,abc",
    "//example.invalid/a","/etc/passwd","..\\secret.md",
    "references%2Fguide.md","references%5cguide.md","https:\n//invalid"
  ]) assert.equal(markdownLinkCandidate(href),false,href);
  assert.equal(markdownLinkCandidate("references/guide.md"),true);
  assert.equal(markdownLinkCandidate("#heading"),true);
  assert.equal(markdownLinkCandidate("https://example.org"),true);
});

test("right Preview links resolve only against the existing inventoried Package",()=>{
  const source=uri("/workspace/skills/demo/SKILL.md");
  setNativeMarkdownPackagePolicies([source],{
    rootPath:"/workspace/skills/demo",
    allowedFiles:["SKILL.md","references/guide.md","assurance/contract.yaml"],
    denyAll:false
  });
  assert.deepEqual(resolveNativeMarkdownPackageLink(source,"references/guide.md"),{
    kind:"package",relativePath:"references/guide.md",
    path:"/workspace/skills/demo/references/guide.md"
  });
  assert.equal(resolveNativeMarkdownPackageLink(source,"../other/SKILL.md"),null);
  assert.equal(resolveNativeMarkdownPackageLink(source,"missing.md"),null);
  assert.equal(resolveNativeMarkdownPackageLink(source,"references%2fguide.md"),null);
  assert.equal(resolveNativeMarkdownPackageLink(source,"javascript:alert(1)"),null);
  assert.deepEqual(resolveNativeMarkdownPackageLink(source,"#heading"),{
    kind:"fragment",fragment:"heading"
  });
});

test("oversized Markdown fails closed before markup rendering",()=>{
  assert.throws(()=>renderStudioMarkdown("x".repeat(1024*1024+1)),/1 MiB/);
});
