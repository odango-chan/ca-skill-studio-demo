import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root=fileURLToPath(new URL("../",import.meta.url));
const pages=[
  "README.md","AGENTS.md","docs/README.md","docs/DOCUMENTATION.md",
  "docs/WORK.md","docs/WORK-history.md","docs/TRACEABILITY.md",
  "docs/architecture/studio-boundaries.md",
  "docs/architecture/dependency-and-interface-package.md","docs/architecture/studio-boundaries.md",
  "docs/architecture/plugin-managed-configuration-v0.1.md",
  "docs/architecture/skill-project-layout.md",
  "docs/architecture/theia-workbench.md",
  "docs/DOCUMENTATION.md",
  "docs/decisions/0003-native-workbench-and-markdown.md",
  "docs/decisions/0004-package-first-workspace.md",
  "docs/decisions/0005-fixed-source-preview-workbench.md",
  "docs/design/authoring-workbench.md","docs/design/source-editor-workstream.md",
  "docs/design/ai-procedure-authoring.md","docs/design/skill-lsp-l2d-editor-acceptance.md",
  "docs/design/skill-lsp-l2d2-live-problems.md","docs/design/route-designer.md",
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
test("current dependency architecture is canonical and old project proposals are historical",()=>{
  const map=content("docs/README.md"),agents=content("AGENTS.md");
  const current=content("docs/architecture/dependency-and-interface-package.md");
  const old=content("docs/architecture/plugin-managed-configuration-v0.1.md");
  const layout=content("docs/architecture/skill-project-layout.md");
  const boundary=content("docs/architecture/studio-boundaries.md");
  assert.match(map,/dependency-and-interface-package\.md/);
  assert.match(agents,/dependency-and-interface-package\.md/);
  for(const term of ["skillc.lock/v0.1","interface-dependency-lock/v1alpha1",
    "establish-pdu-session-mas","modify-pdu-session-mas","release-pdu-session-mas",
    "ca-context","ca-client","NOT_QUALIFIED","Compiler v2.0.2","Compiler v2.1.0"])
    assert.ok(current.includes(term),"Current dependency architecture missing "+term);
  assert.match(old,/Historical v0\.1 design proposal/);
  assert.match(layout,/Historical proposal/);
  assert.match(boundary,/Theia 1\.76 browser-only/);
  assert.match(boundary,/Classic.*retired/);
});

test("WORK is a compact current snapshot and preserves dated history separately",()=>{
  const work=content("docs/WORK.md"),history=content("docs/WORK-history.md");
  const map=content("docs/README.md"),governance=content("docs/DOCUMENTATION.md");
  const lines=work.trim().split(/\r?\n/).length;
  assert.ok(lines>=40&&lines<=120,"WORK must remain a 40–120 line current-state panel; got "+lines);
  assert.match(work,/WORK-history\.md/);
  assert.match(history,/Historical snapshots/);
  assert.match(history,/eaadf9488ec3b5d6d6f60eb7090a2dee715d440b/);
  assert.match(history,/NOT_RUN/);
  assert.match(map,/WORK-history\.md/);
  assert.match(governance,/WORK-history\.md/);
});

test("TRACEABILITY stays current and archives dated evidence",()=>{
  const trace=content("docs/TRACEABILITY.md"),history=content("docs/WORK-history.md");
  const lines=trace.trim().split(/\r?\n/).length;
  assert.ok(lines<=60,"TRACEABILITY should remain a compact current matrix; got "+lines);
  assert.match(trace,/Current checkpoint/);
  assert.match(trace,/#280/);
  assert.match(trace,/#288/);
  assert.doesNotMatch(trace,/Historical evidence matrix/);
  assert.match(history,/Historical evidence matrix/);
  assert.match(history,/Refreshed establish-pdu-session optional references/);
});

test("documentation governance identifies the current dependency architecture and WORK compaction follow-up",()=>{
  const governance=content("docs/DOCUMENTATION.md");
  assert.match(governance,/Updated: 2026-11-26/);
  assert.match(governance,/dependency-and-interface-package\.md/);
  assert.match(governance,/#285/);
  assert.match(governance,/WORK-history\.md/);
});

test("current workbench and Package Explorer ADRs no longer claim implementation is pending",()=>{
  const a3=content("docs/decisions/0003-native-workbench-and-markdown.md");
  const a4=content("docs/decisions/0004-package-first-workspace.md");
  const a5=content("docs/decisions/0005-fixed-source-preview-workbench.md");
  assert.match(a3,/host acceptance closeout completed in #176/);
  assert.match(a4,/Interface Package import and Schema IntelliSense merged in #267/);
  assert.match(a4,/default `ca-client` preload merged in #270/);
  assert.match(a4,/Dependency Architecture/);
  assert.match(a5,/fixed Source \+ Preview host integration is implemented on main and deployed/);
  assert.match(a5,/Issue #220 remains open/);
});

test("AI Authoring and Source Editor docs distinguish current implementation from historical plans",()=>{
  const ai=content("docs/design/ai-procedure-authoring.md");
  const source=content("docs/design/source-editor-workstream.md");
  const map=content("docs/README.md");
  assert.match(ai,/Current status: F1–F4 IMPLEMENTED \/ MERGED \/ DEPLOYED/);
  assert.match(ai,/Issue #200 CLOSED/);
  assert.match(ai,/Compiler v2\.0\.2/);
  assert.match(ai,/Compiler v2\.1\.0/);
  assert.match(ai,/Historical design and implementation planning record/);
  assert.match(source,/Historical workstream record/);
  assert.match(map,/当前 F1–F4 实现状态/);
  assert.match(map,/standalone Monaco Source Editor.*历史/i);
});

test("AGENTS safety and evidence rules are paired with repository ignore",()=>{
  const agents=content("AGENTS.md"),ignore=content(".gitignore");
  for(const mark of ["docs/WORK.md","docs/TRACEABILITY.md","/tmp","CA_AGENT_TMPDIR",
    "git diff --check","npm test","Runtime","Issue"])
    assert.ok(agents.includes(mark),"Missing mandatory Agent guidance: "+mark);
  assert.match(ignore,/^\.agent-tmp\/\s*$/m);
});
test("Studio ownership document defines the current product and authority boundary",()=>{
  const doc=content("docs/architecture/studio-boundaries.md");
  assert.match(doc,/Status: Current product architecture baseline/);
  assert.match(doc,/Theia 1\\.76 browser-only/);
  assert.match(doc,/Preview is a projection/);
  assert.match(doc,/ca-client/);
  assert.match(doc,/#280/);
  assert.match(doc,/#225/);
  assert.match(doc,/Compiler v2\\.1\\.0/);
  assert.doesNotMatch(doc,/superseded as a target design/);
});

test("current Theia Preview is read-only and legacy Designer docs are historical",()=>{
  const work=content("docs/WORK.md"),map=content("docs/README.md"),agents=content("AGENTS.md");
  const route=content("docs/design/route-designer.md");
  const phase=content("docs/design/phase-designer.md");
  const d1=content("docs/D1-procedure-designer.md");
  const d2=content("docs/D2-node-designer.md");
  assert.match(work,/Procedure \/ Contract \/ Predicate \/ Schema Preview is read-only/);
  assert.match(map,/Historical D3 Route Designer/);
  assert.match(map,/Historical D4 Phase Designer/);
  for(const doc of [route,phase,d1,d2])assert.match(doc,/HISTORICAL/);
  assert.match(agents,/ADR-0005/);
  assert.match(agents,/当前 Theia Preview 不提供 Visual mutation/);
  assert.doesNotMatch(agents,/Route \/ Phase 改动读 docs\/design\/route-designer\.md/);
  assert.match(content("docs/DOCUMENTATION.md"),/tool-mcp-gw/);
});

test("historical conventional CreatedSession fixture is separate from the default OpenAMSM Example",()=>{
  const work=content("docs/WORK.md"),history=content("docs/WORK-history.md"),trace=content("docs/TRACEABILITY.md");
  const docs=content("docs/design/authoring-workbench.md");
  assert.match(work,/The conventional `establish-pdu-session` 5GC Skill is a separate NOT_QUALIFIED fixture, not the default Example/);
  assert.match(history,/eaadf9488ec3b5d6d6f60eb7090a2dee715d440b/);
  assert.match(history,/Refreshed establish-pdu-session optional references/);
  for(const name of ["3gpp-procedure.md","session-selection.md","failure-handling.md"])
    assert.ok(history.includes("references/"+name),name);
  assert.match(docs,/Historical UI and Editing Design/);
  assert.match(docs,/read_reference/);
  assert.match(history,/cases\//);
});

test("Theia is the only published host and Classic has no runtime entrypoint",()=>{
  const workflow=content(".github/workflows/pages.yml");
  const composer=content("experiments/ide-host/scripts/compose-pages-release.mjs");
  const manifest=JSON.parse(content("experiments/ide-host/vscode/package.json"));
  assert.doesNotMatch(workflow,/--classic|preserve Classic/i);
  assert.match(workflow,/test ! -e dist\/classic/);
  assert.match(composer,/classicPublished:false/);
  assert.doesNotMatch(composer,/classicPath|classic\/index/);
  assert.ok(!existsSync(resolve(root,"site/index.html")));
  assert.ok(!existsSync(resolve(root,"site/app.mjs")));
  assert.ok(!existsSync(resolve(root,"scripts/build.mjs")));
  assert.equal(manifest.contributes.customEditors,undefined,
    "visualizers are not registered as Main Editor CustomEditors");
  assert.deepEqual(manifest.contributes.views.skillStudioPreview.map(x=>x.id),
    ["skillStudio.preview"],"the only visualizer is in its own right Preview container");
  assert.deepEqual(manifest.contributes.views.skillStudioInspector.map(x=>x.id),
    ["skillStudio.inspection"],"Inspector must not contain a Preview Webview");
  assert.ok(manifest.contributes.views.explorer.some(x=>x.id==="skillStudio.packages"));
});

test("Pages provenance records one source identity without a Classic source",()=>{
  const provenance=content("experiments/ide-host/scripts/write-pages-build-info.mjs");
  assert.match(provenance,/schemaVersion:2/);
  assert.match(provenance,/defaultHost:"theia-browser-only"/);
  assert.match(provenance,/classicPublished:false/);
  assert.doesNotMatch(provenance,/classicSourceSha|classicPath/);
});
