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
    "assurance/procedure.yaml",
    "scripts/select.py"
  ]);
  assert.equal(isAllowedPackageRelativeLink("../SKILL.md","references",files),true);
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
  const files=[
    uri(root+"/SKILL.md"),
    source,
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
  assert.equal(await prepareNativeMarkdownPackagePolicy(
    makeVscode(root+"/references"),source),false);
});
