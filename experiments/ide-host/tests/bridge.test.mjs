import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,statSync} from "node:fs";
import {projectWorkspace} from "../../../site/workspace.mjs";
import {routeTargetChoices,previewTargetPatch} from "../vscode/src/route-target.mjs";
import {proposeCanvasRouteConnection,previewCanvasRouteConnection}
  from "../../../site/route-connect.mjs";
import {validateRouteProposal,validateCanvasRouteCreationProposal,isProcedurePath}
  from "../vscode/src/bridge.mjs";

const text=readFileSync("site/samples/packages/establish-pdu-session/assurance/procedure.yaml","utf8");
const model=projectWorkspace(text);
const candidate=()=>{
  assert.equal(model.state,"READY");
  for(const p of model.procedures.values()){
    for(const route of p.routes){
      const targets=routeTargetChoices(p,route.id);
      const to=targets.find(x=>x!==route.target);
      if(!to)continue;
      const preview=previewTargetPatch(text,p.name,route.id,to);
      return {p,route,to,preview,proposal:{
        type:"applyRoute",expectedVersion:17,baseSource:text,
        candidateSource:preview.candidateSource,procedureId:p.name,
        routeId:route.id,newTarget:to
      }};
    }
  }
  throw Error("Pinned CreatedSession has no qualified route patch candidates");
};
test("Host identifies only real assurance/procedure.yaml, not arbitrary YAML",()=>{
  assert.ok(isProcedurePath("/skill/assurance/procedure.yaml"));
  assert.ok(isProcedurePath("assurance/procedure.yaml"));
  assert.ok(!isProcedurePath("assurance/contract.yaml"));
  assert.ok(!isProcedurePath("procedure.yaml"));
  assert.ok(!isProcedurePath("assurance/procedure.yaml.bak"));
});
test("A1: real 5-procedure CreatedSession graph is Source-derived",()=>{
  assert.equal(model.state,"READY");
  assert.equal(model.procedures.size,5);
  assert.equal(model.procedure.nodes.length,17);
  assert.equal(model.procedure.routes.length,63);
});
test("Host independently rechecks one exact Source-backed Route edit",()=>{
  const {route,to,preview,proposal}=candidate();
  const out=validateRouteProposal(text,17,proposal);
  assert.equal(out.start,preview.sourceSpan.start);
  assert.equal(out.end,preview.sourceSpan.end);
  assert.equal(out.newTarget,to);
  assert.equal(out.oldTarget,route.target);
  assert.equal(out.candidateSource,text.slice(0,out.start)+to+text.slice(out.end));
  const after=projectWorkspace(out.candidateSource);
  assert.equal(after.state,"READY");
  assert.equal(after.procedures.get(proposal.procedureId).routes.find(r=>r.id===route.id).target,to);
  assert.notEqual(text,out.candidateSource);
  assert.match(out.diff,/^@@ -/);
});
test("Host rejects stale versions, wrong base, substituted candidate and forged selectors",()=>{
  const {proposal}=candidate();
  const reject=patch=>assert.throws(()=>validateRouteProposal(text,17,patch));
  reject({...proposal,expectedVersion:16});
  reject({...proposal,baseSource:text+"\n"});
  reject({...proposal,candidateSource:proposal.candidateSource+"\n"});
  reject({...proposal,procedureId:"other"});
  reject({...proposal,routeId:"not-a-route"});
  reject({...proposal,newTarget:"not_in_procedure"});
  reject({...proposal,type:"overwriteFile"});
  assert.throws(()=>validateRouteProposal(text+"\n",17,proposal));
});
const ensureSource=readFileSync(
  "site/samples/packages/ensure-pdu-session/assurance/procedure.yaml","utf8");
function removeOutcome(source,procedureId,nodeId,outcome){
  const p=projectWorkspace(source).procedures.get(procedureId);
  const route=p?.routes.find(r=>r.id===nodeId+":"+outcome&&r.routeSource==="operator.on");
  assert.ok(route,"fixture must contain the exact existing Route");
  const lineStart=source.lastIndexOf("\n",route.sourceSpan.start-1)+1;
  const lineEnd=source.indexOf("\n",route.sourceSpan.end);
  assert.ok(lineEnd>=0);
  return source.slice(0,lineStart)+source.slice(lineEnd+1);
}
test("D3-A3 host revalidates a dedicated canvas Route proposal and inserts one exact line",()=>{
  const source=removeOutcome(ensureSource,"ensure-session","observe-target-session","UNKNOWN");
  assert.equal(projectWorkspace(source).state,"READY");
  const intent=proposeCanvasRouteConnection({
    source,procedureId:"ensure-session",sourceId:"observe-target-session",
    targetId:"unresolved",sourceHandle:"new-route-out",targetHandle:"in"
  });
  const preview=previewCanvasRouteConnection(source,intent,"UNKNOWN");
  const proposal={
    type:"applyRouteCreation",expectedVersion:18,baseSource:source,
    candidateSource:preview.candidateSource,diff:preview.diff,
    procedureId:"ensure-session",sourceId:"observe-target-session",
    targetId:"unresolved",sourceHandle:"new-route-out",targetHandle:"in",
    outcome:"UNKNOWN"
  };
  const edit=validateCanvasRouteCreationProposal(source,18,proposal);
  assert.equal(edit.start,preview.sourceSpan.start);
  assert.equal(edit.end,edit.start,"Route creation is a zero-length source insertion");
  assert.ok(edit.newText.includes("UNKNOWN: unresolved"));
  assert.equal(source.slice(0,edit.start)+edit.newText+source.slice(edit.end),
    preview.candidateSource);
  assert.equal(projectWorkspace(edit.candidateSource).state,"READY");
  assert.equal(projectWorkspace(edit.candidateSource).procedures
    .get("ensure-session").routes.some(r=>
      r.id==="observe-target-session:UNKNOWN"&&r.target==="unresolved"),true);
});
test("D3-A3 host rejects stale, forged, unsupported-handle and unobserved Route proposals",()=>{
  const source=removeOutcome(ensureSource,"ensure-session","observe-target-session","UNKNOWN");
  const intent=proposeCanvasRouteConnection({
    source,procedureId:"ensure-session",sourceId:"observe-target-session",
    targetId:"unresolved",sourceHandle:"new-route-out",targetHandle:"in"
  });
  const preview=previewCanvasRouteConnection(source,intent,"UNKNOWN");
  const proposal={
    type:"applyRouteCreation",expectedVersion:18,baseSource:source,
    candidateSource:preview.candidateSource,diff:preview.diff,
    procedureId:"ensure-session",sourceId:"observe-target-session",
    targetId:"unresolved",sourceHandle:"new-route-out",targetHandle:"in",
    outcome:"UNKNOWN"
  };
  const reject=value=>assert.throws(()=>validateCanvasRouteCreationProposal(source,18,value));
  reject({...proposal,expectedVersion:17});
  reject({...proposal,baseSource:source+"\n"});
  reject({...proposal,candidateSource:proposal.candidateSource+"\n"});
  reject({...proposal,sourceHandle:"edge-0-out"});
  reject({...proposal,targetId:"missing-node"});
  reject({...proposal,outcome:"INVENTED"});
  reject({...proposal,type:"applyRoute"});
  assert.throws(()=>validateCanvasRouteCreationProposal(source+"\n",18,proposal));
});
test("Build emits a bundled Node extension and a local script/style Webview",()=>{
  for(const path of ["experiments/ide-host/vscode/dist/extension.cjs",
    "experiments/ide-host/vscode/dist/extension-web.cjs",
    "experiments/ide-host/vscode/dist/extension-theia.js",
    "experiments/ide-host/vscode/media/procedure.js",
    "experiments/ide-host/vscode/media/procedure.css",
    "experiments/ide-host/vscode/samples/establish-pdu-session/files.json"])
    assert.ok(statSync(path).size>(path.endsWith("files.json")?50:1000),path);
});

test("Theia worker bridge exports activation module via frontendModuleName",()=>{
  const bundle=readFileSync("experiments/ide-host/vscode/dist/extension-theia.js","utf8");
  assert.match(bundle,/__skillStudioTheiaModule/);
  assert.match(bundle,/editor-preview-widget/,"Theia Source must bypass the default visual association");
  assert.match(bundle,/self\[self\.frontendModuleName\] = __skillStudioTheiaModule/);
  assert.match(bundle,/globalThis\.theia\[globalThis\.frontendModuleName\]/);
});
test("Web host entry is declared and excludes Node-only imports",()=>{
  const manifest=JSON.parse(readFileSync("experiments/ide-host/vscode/package.json","utf8"));
  assert.equal(manifest.browser,"./dist/extension-web.cjs");
  assert.equal(manifest.main,"./dist/extension.cjs");
  const source=readFileSync("experiments/ide-host/vscode/src/extension.mjs","utf8");
  const web=readFileSync("experiments/ide-host/vscode/dist/extension-web.cjs","utf8");
  assert.doesNotMatch(source,/from ["']node:/);
  assert.match(source,/globalThis\.crypto\.getRandomValues/);
  assert.doesNotMatch(web,/require\(["']node:/);
  assert.match(web,/skillStudio\.procedurePreview/);
});
