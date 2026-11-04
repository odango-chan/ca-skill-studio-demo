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
test("WORK / D3 stages distinguish shipped A1/A2 from scoped editor-tier A3",()=>{
  const state=content("docs/WORK.md"),spec=content("docs/design/route-designer.md");
  assert.match(state,/\|\s*D3-A1[^\n]*\|\s*ACCEPTED\s*\|\s*IMPLEMENTED\s*\|\s*PASS/);
  assert.match(state,/\|\s*D3-A2[^\n]*\|\s*ACCEPTED\s*\|\s*IMPLEMENTED\s*\|\s*PASS/);
  assert.match(state,/\|\s*D3-A3[^\n]*\|\s*ACCEPTED[^\n]*\|\s*IMPLEMENTED[^\n]*\|\s*PASS/);
  assert.match(spec,/Status: Accepted for bounded Studio editor scope/);
  assert.match(spec,/A1\/A2 on main/);
  assert.match(spec,/A3 implemented in PR #13/);
  assert.match(spec,/Runtime\/5GC NOT_RUN/);
  const trace=content("docs/TRACEABILITY.md");
  for(const x of ["D3-A1","D3-A2","D3-A3"])assert.ok(trace.includes(x));
  assert.match(content("docs/DOCUMENTATION.md"),/tool-mcp-gw/);
});

test("D4 read-only consumer ABI evidence accepted; cross-producer edits still deferred",()=>{
  const work=content("docs/WORK.md"),spec=content("docs/design/phase-designer.md");
  assert.match(work,/\|\s*D4-A1[^\n]*\|\s*ACCEPTED[^\n]*\|\s*IMPLEMENTED[^\n]*\|\s*PASS/);
  assert.match(work,/\|\s*D4-A2\.1[^\n]*\|\s*ACCEPTED[^\n]*\|\s*IMPLEMENTED[^\n]*\|\s*PASS/);
  assert.match(work,/\|\s*D4-A2\.2a[^\n]*\|\s*ACCEPTED[^\n]*\|\s*IMPLEMENTED[^\n]*\|\s*PASS/);
  assert.match(work,/\|\s*D4-A2\.2b1[^\n]*\|\s*ACCEPTED[^\n]*\|\s*IMPLEMENTED[^\n]*\|\s*PASS/);
  assert.match(work,/\|\s*D4-A3a[^\n]*\|\s*ACCEPTED[^\n]*\|\s*IMPLEMENTED[^\n]*\|\s*PASS/);
  assert.match(work,/\|\s*D4-A3b1[^\n]*\|\s*ACCEPTED[^\n]*\|\s*IMPLEMENTED[^\n]*\|\s*PASS/);
  assert.match(work,/\|\s*D4-A3b2a[^\n]*\|\s*ACCEPTED[^\n]*\|\s*IMPLEMENTED[^\n]*\|\s*PASS/);
  assert.match(work,/\|\s*D4-A3b2b1[^\n]*\|\s*ACCEPTED[^\n]*\|\s*IMPLEMENTED[^\n]*\|\s*PASS/);
  assert.match(work,/\|\s*D4-A3b2b2a[^\n]*\|\s*ACCEPTED[^\n]*\|\s*IMPLEMENTED[^\n]*\|\s*PASS/);
  assert.match(work,/\|\s*D4-A4a[^\n]*\|\s*ACCEPTED[^\n]*\|\s*IMPLEMENTED[^\n]*\|\s*PASS/);
  assert.match(work,/\|\s*D4-A4b1[^\n]*\|\s*ACCEPTED[^\n]*\|\s*IMPLEMENTED[^\n]*\|\s*PASS/);
  assert.match(work,/\|\s*D4-A2\.2b2\/A3b2b2b\/A4b2[^\n]*\|\s*PROPOSED\s*\|\s*NOT_STARTED\s*\|\s*NOT_RUN/);
  assert.match(spec,/Runtime\/5GC NOT_RUN/);
  const trace=content("docs/TRACEABILITY.md");
  assert.match(trace,/D4-A1 Phase Step input rebind/);
  assert.match(trace,/D4-A2\.1 Same-producer output reference normalization/);
  assert.match(trace,/D4-A2\.2a Phase dependency evidence/);
  assert.match(trace,/D4-A2\.2b1 script consumer field/);
  assert.match(spec,/consumer schema/i);
  assert.match(spec,/Runtime\/5GC NOT_RUN/);
});

test("current owner-pinned CreatedSession Reference example is documented without Runtime claims",()=>{
  const work=content("docs/WORK.md"),trace=content("docs/TRACEABILITY.md");
  const docs=content("docs/design/authoring-workbench.md");
  assert.match(work,/7570b309a998580a6952352e2bf4b1c19e5c710d/);
  assert.match(trace,/Refreshed establish-pdu-session optional references/);
  for(const name of ["3gpp-procedure.md","session-selection.md","failure-handling.md"])
    assert.ok(work.includes("references/"+name),name);
  assert.match(docs,/read_reference/);
  assert.match(work,/cases\//);
  assert.match(work,/可选业务参考材料/);
});

test("only owner-named establish-pdu-session is public and loads by default",()=>{
  const html=content("site/index.html"),app=content("site/app.mjs");
  const manifest=content("site/sample-packages.mjs");
  assert.match(html,/id="establishSampleButton"[^>]*>establish-pdu-session<\/button>/);
  assert.doesNotMatch(html,/Ensure Session|CreatedSession|id="sampleButton"/);
  assert.match(app,/async function loadSample\(sample="establish"\)/);
  assert.match(app,/const expandedAssetFolders=new Set\(\[[^\]]*"references"\]\)/);
  assert.match(app,/loadSample\(\);\s*$/);
  assert.match(manifest,/establish:Object\.freeze/);
  assert.doesNotMatch(manifest,/ensure:Object\.freeze/);
});

test("new Phase consumer contract is checked by the Pages syntax gate",()=>{
  const ci=content(".github/workflows/pages.yml");
  assert.match(ci,/node --check site\/phase-consumer-contract\.mjs/);
  assert.match(ci,/node --check tests\/phase-consumer-contract\.test\.mjs/);
});

test("D4-A3a bounded Step authoring retains Source authority and a Pages syntax gate",()=>{
  const docs=content("docs/design/phase-designer.md");
  const app=content("site/app.mjs"),ci=content(".github/workflows/pages.yml");
  assert.match(docs,/D4-A3a/);
  assert.match(docs,/Undo\/Redo/);
  assert.match(app,/applyAdjacentVerifyReorder/);
  assert.match(ci,/node --check site\/phase-step-order\.mjs/);
  assert.match(ci,/node --check tests\/phase-step-order\.test\.mjs/);
});

test("D4-A3b1 Verify creation/deletion stays guarded by Source authority",()=>{
  const ci=content(".github/workflows/pages.yml");
  const work=content("docs/WORK.md"),spec=content("docs/design/phase-designer.md");
  const app=content("site/app.mjs");
  assert.match(work,/D4-A3b1/);
  assert.match(spec,/D4-A3b1/);
  assert.match(spec,/Runtime\/5GC/);
  assert.match(app,/applyAddPhaseVerify/);
  assert.match(app,/applyDeletePhaseVerify/);
  assert.match(ci,/node --check site\/phase-step-structural\.mjs/);
  assert.match(ci,/node --check tests\/phase-step-structural\.test\.mjs/);
});

test("D4-A3b2a names are source-reconciled before Preview and Pages syntax gated",()=>{
  const docs=content("docs/design/phase-designer.md");
  const ci=content(".github/workflows/pages.yml");
  const app=content("site/app.mjs");
  assert.match(docs,/D4-A3b2a/);
  assert.match(docs,/Runtime\/5GC NOT_RUN/);
  assert.match(app,/applyNamedPhaseStepRename/);
  assert.match(ci,/node --check site\/phase-step-rename\.mjs/);
  assert.match(ci,/node --check tests\/phase-step-rename\.test\.mjs/);
});

test("D4-A3b2b1 named Verify changes have Source authority and Pages syntax gate",()=>{
  const spec=content("docs/design/phase-designer.md"),app=content("site/app.mjs");
  const ci=content(".github/workflows/pages.yml");
  assert.match(spec,/D4-A3b2b1/);
  assert.match(spec,/Runtime\/5GC E2E NOT_RUN/);
  assert.match(app,/applyDeleteUnreferencedNamedVerify/);
  assert.match(app,/applySwapAdjacentNamedVerify/);
  assert.match(ci,/node --check site\/phase-named-verify\.mjs/);
  assert.match(ci,/node --check tests\/phase-named-verify\.test\.mjs/);
});

test("D4-A3b2b2a named Step impact remains read-only and syntax-gated",()=>{
  const doc=content("docs/design/phase-designer.md");
  const app=content("site/app.mjs"),ci=content(".github/workflows/pages.yml");
  assert.match(doc,/D4-A3b2b2a/);
  assert.match(doc,/EFFECT_UNPROVEN/);
  assert.match(app,/namedStepMutationImpactReport/);
  assert.match(ci,/node --check site\/phase-step-impact\.mjs/);
  assert.match(ci,/node --check tests\/phase-step-impact\.test\.mjs/);
});

test("D4-A4a Phase Route origin and Source Patch are explicitly gated",()=>{
  const spec=content("docs/design/phase-designer.md");
  const work=content("docs/WORK.md"),ci=content(".github/workflows/pages.yml");
  const app=content("site/app.mjs");
  assert.match(spec,/D4-A4a/);
  assert.match(spec,/Runtime\/5GC E2E NOT_RUN/);
  assert.match(work,/D4-A4a/);
  assert.match(app,/applyPhaseRouteTarget/);
  assert.match(ci,/node --check site\/phase-routes\.mjs/);
  assert.match(ci,/node --check tests\/phase-routes\.test\.mjs/);
});

test("D4-A4b1 protected Phase outcomes are source-backed and syntax-gated",()=>{
  const spec=content("docs/design/phase-designer.md");
  const app=content("site/app.mjs"),ci=content(".github/workflows/pages.yml");
  assert.match(spec,/D4-A4b1/);
  assert.match(spec,/Runtime\/5GC E2E NOT_RUN/);
  assert.match(app,/applyAddObservedPhaseOutcome/);
  assert.match(app,/applyDeleteNoncorePhaseOutcome/);
  assert.match(ci,/node --check site\/phase-outcomes\.mjs/);
  assert.match(ci,/node --check tests\/phase-outcomes\.test\.mjs/);
});

test("E1 Monaco integration retains Source authority and Pages Worker assets",()=>{
  const spec=content("docs/design/source-editor-workstream.md");
  const app=content("site/app.mjs"),ci=content(".github/workflows/pages.yml");
  assert.match(spec,/PR #40/);
  assert.match(app,/createSourceEditorAdapter/);
  assert.match(app,/initializeMonaco/);
  assert.match(ci,/editor\.worker\.js/);
  assert.match(ci,/LICENSE\.monaco\.txt/);
  assert.match(ci,/node --check site\/source-editor-adapter\.mjs/);
  assert.match(ci,/node --check tests\/source-editor-adapter\.test\.mjs/);
});
