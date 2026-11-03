import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root=fileURLToPath(new URL("../",import.meta.url));
const pages=[
  "README.md","AGENTS.md","docs/README.md","docs/DOCUMENTATION.md",
  "docs/WORK.md","docs/TRACEABILITY.md",
  "docs/architecture/studio-boundaries.md",
  "docs/design/authoring-workbench.md","docs/design/route-designer.md",
  "docs/decisions/0001-source-first-visual.md",
  "docs/D1-procedure-designer.md","docs/D2-node-designer.md",
  "docs/ux/ux-consolidation.md",
  "docs/reference/README-pre-compact-2026-11-03.md"
];
const content=p=>readFileSync(resolve(root,p),"utf8");
test("canonical source and document navigation paths exist",()=>{
  for(const p of pages)assert.ok(existsSync(resolve(root,p)),p);
  // The preserved README is an exact historical recovery artifact; its old
  // links were authored relative to repository root, not the archive folder.
  // Do not rewrite historical bytes or elevate its links to current authority.
  for(const p of pages.filter(x=>!x.startsWith("docs/reference/README-pre-compact"))){
    // Parse Markdown inline link destinations. External URLs, anchors, and
    // images are not repository relative links. All current links must exist.
    const text=content(p);
    for(const m of text.matchAll(/(?<!!)\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]+")?\)/g)){
      const dest=m[1].split("#")[0];
      if(!dest||/^(?:https?:|mailto:|#|data:)/.test(dest))continue;
      const absolute=resolve(root,dirname(p),decodeURIComponent(dest));
      assert.ok(absolute.startsWith(root),"unsafe local link "+p+" => "+dest);
      assert.ok(existsSync(absolute),"unresolved link "+p+" => "+dest);
    }
  }
});
test("README stays an entrypoint and historical UX has explicit deprecated status",()=>{
  const readme=content("README.md");
  assert.ok(readme.length<5500,"README is a navigation entrypoint, not an append-only journal");
  assert.match(readme,/docs\/WORK\.md/);
  assert.match(readme,/docs\/TRACEABILITY\.md/);
  assert.match(readme,/source-first/i);
  assert.match(content("docs/ux/ux-consolidation.md"),/Status: Deprecated/);
  assert.match(content("docs/reference/README-pre-compact-2026-11-03.md"),
    /Status: Deprecated/);
});
test("AGENTS safety and evidence rules are paired with repository ignore",()=>{
  const agents=content("AGENTS.md"),ignore=content(".gitignore");
  for(const mark of ["docs/WORK.md","docs/TRACEABILITY.md","/tmp","CA_AGENT_TMPDIR",
    "git diff --check","npm test","Runtime","Issue"])
    assert.ok(agents.includes(mark),"Missing mandatory Agent guidance: "+mark);
  assert.match(ignore,/^\.agent-tmp\/\s*$/m);
});
test("WORK / D3 stages distinguish shipped A1 and A2 from unstarted A3",()=>{
  const state=content("docs/WORK.md"),spec=content("docs/design/route-designer.md");
  assert.match(state,/\|\s*D3-A1[^\n]*\|\s*ACCEPTED\s*\|\s*IMPLEMENTED\s*\|\s*PASS/);
  assert.match(state,/\|\s*D3-A2[^\n]*\|\s*ACCEPTED\s*\|\s*IMPLEMENTED\s*\|\s*PASS/);
  assert.match(state,/\|\s*D3-A3[^\n]*\|\s*PROPOSED\s*\|\s*NOT_STARTED\s*\|\s*NOT_RUN/);
  assert.match(spec,/Status: Proposed overall/);
  assert.match(spec,/A1\/A2 IMPLEMENTED/);
  assert.match(spec,/A3 NOT_STARTED/);
  assert.match(spec,/A3 NOT_RUN/);
  const trace=content("docs/TRACEABILITY.md");
  for(const x of ["D3-A1","D3-A2","D3-A3"])assert.ok(trace.includes(x));
  assert.match(content("docs/DOCUMENTATION.md"),/tool-mcp-gw/);
});
