import test from "node:test";
import assert from "node:assert/strict";
import {
  isAllowedPackageRelativeLink,
  prepareNativeMarkdownPackagePolicy
} from "../vscode/src/markdown-link-policy.mjs";

const uri=path=>({
  path,
  toString(){return "file://"+path;},
  with(change){return uri(change.path);}
});

test("native Markdown permits only exact inventoried Package-relative targets",()=>{
  const files=new Set([
    "SKILL.md",
    "references/guide.md",
    "references/alternate.markdown",
    "references/3gpp-procedure.md",
    "assurance/procedure.yaml",
    "scripts/select.py"
  ]);
  assert.equal(isAllowedPackageRelativeLink("../SKILL.md","references",files),true);
  assert.equal(isAllowedPackageRelativeLink("references/3gpp-procedure.md","",files),true);
  assert.equal(isAllowedPackageRelativeLink("references/alternate.markdown","",files),true,
    "the alternate registered Markdown extension is inventoried and navigable");
  assert.equal(isAllowedPackageRelativeLink("references/guide.mdx","",files),false,
    "unsupported extensions remain outside the Package link allowlist");
  assert.equal(isAllowedPackageRelativeLink("../assurance/procedure.yaml","references",files),true);
  assert.equal(isAllowedPackageRelativeLink("../scripts/select.py","references",files),true);
  assert.equal(isAllowedPackageRelativeLink("../../outside.md","references",files),false);
  assert.equal(isAllowedPackageRelativeLink("missing.md","references",files),false);
  assert.equal(isAllowedPackageRelativeLink("%2e%2e/%2e%2e/outside.md","references",files),false);
  assert.equal(isAllowedPackageRelativeLink("//example.invalid/pixel.png","references",files),false);
  assert.equal(isAllowedPackageRelativeLink("file:///etc/passwd","references",files),false);
  assert.equal(isAllowedPackageRelativeLink("javascript:alert(1)","references",files),false);
  assert.equal(isAllowedPackageRelativeLink("https://example.invalid/","references",files),true,
    "explicit external hyperlinks remain links; image fetches are separately disabled");
});

test("native Markdown Package inventory fails closed outside exact SKILL.md root",async()=>{
  const source=uri("/workspace/notes/readme.md");
  const vscode={
    FileType:{File:1,Directory:2,SymbolicLink:64},
    RelativePattern:class {constructor(base,pattern){this.base=base;this.pattern=pattern;}},
    workspace:{
      getWorkspaceFolder:()=>({uri:uri("/workspace")}),
      findFiles:async()=>[],
      fs:{stat:async()=>({type:1})}
    }
  };
  assert.equal(await prepareNativeMarkdownPackagePolicy(vscode,source),false);
});

test("native Markdown Package inventory rejects symlinked roots and descendants",async()=>{
  const root="/workspace/skills/demo";
  const source=uri(root+"/references/guide.md");
  const alternateMarkdown=uri(root+"/references/alternate.markdown");
  const files=[
    uri(root+"/SKILL.md"),
    source,
    alternateMarkdown,
    uri(root+"/assurance/procedure.yaml")
  ];
  const directories=new Set([
    "/workspace","/workspace/skills",root,
    root+"/references",root+"/assurance"
  ]);
  const makeVscode=symlinkPath=>({
    FileType:{File:1,Directory:2,SymbolicLink:64},
    RelativePattern:class {constructor(base,pattern){this.base=base;this.pattern=pattern;}},
    workspace:{
      getWorkspaceFolder:()=>({uri:uri("/workspace")}),
      findFiles:async pattern=>typeof pattern==="string"
        ?[uri(root+"/SKILL.md")]:files,
      fs:{stat:async target=>({
        type:target.path===symlinkPath?64:
          (directories.has(target.path)?2:1)
      })}
    }
  });
  assert.equal(await prepareNativeMarkdownPackagePolicy(makeVscode(null),source),true);
  assert.equal(await prepareNativeMarkdownPackagePolicy(makeVscode(null),alternateMarkdown),true,
    ".markdown files are accepted as native Markdown Package sources");
  assert.equal(await prepareNativeMarkdownPackagePolicy(makeVscode(root),source),false,
    "a symlinked Package root is rejected");
  assert.equal(await prepareNativeMarkdownPackagePolicy(
    makeVscode(root+"/references"),source),false,
    "a symlinked descendant directory is rejected");
});
