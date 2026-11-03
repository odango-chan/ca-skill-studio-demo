import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {projectWorkspace} from "../site/workspace.mjs";
import {routeOutcomeEditOptions,previewRenameRouteOutcome,
  previewDeleteRouteOutcome,applyRenameRouteOutcome,applyDeleteRouteOutcome}
  from "../site/route-mutate.mjs";

const source=skill=>readFileSync(new URL("../site/samples/packages/"+
  skill+"/assurance/procedure.yaml",import.meta.url),"utf8");
const ensure=source("ensure-pdu-session");
const created=source("establish-pdu-session");
const id="observe-target-session",proc="ensure-session";
const replaceFirst=(s,a,b)=>{assert.ok(s.includes(a));return s.replace(a,b);};
const extra=(s=ensure)=>replaceFirst(s,"          UNKNOWN: unresolved\n",
  "          UNKNOWN: unresolved\n          EXTRA: unresolved\n");
const renamed=(s=ensure)=>replaceFirst(s,"          UNKNOWN: unresolved\n",
  "          EXTRA: unresolved\n");
const extraId=id+":EXTRA";
test("D3-A2 rename a qualified Outcome key with exact span/diff and stable target",()=>{
  const before=renamed(),p=projectWorkspace(before);
  const choices=routeOutcomeEditOptions(before,proc,extraId);
  assert.ok(choices?.renameChoices.includes("UNKNOWN"));
  assert.equal(choices.routeSource,"operator.on");
  const preview=previewRenameRouteOutcome(before,proc,extraId,"UNKNOWN");
  assert.ok(preview.diff.includes("-          EXTRA: unresolved"));
  assert.ok(preview.diff.includes("+          UNKNOWN: unresolved"));
  assert.equal(before.includes("EXTRA: unresolved"),true);
  const output=applyRenameRouteOutcome(before,preview);
  assert.equal(output,ensure);
  const after=projectWorkspace(output);
  assert.equal(after.state,"READY");
  assert.equal(after.procedure.routes.length,p.procedure.routes.length);
  assert.equal(after.procedure.routes.find(r=>r.id===id+":UNKNOWN").target,"unresolved");
  assert.equal(ensure,source("ensure-pdu-session"));
});
test("D3-A2 allows deleting an optional Route only if reachable graph is preserved",()=>{
  const before=extra(),p=projectWorkspace(before);
  const choices=routeOutcomeEditOptions(before,proc,extraId);
  assert.ok(choices?.canDelete);
  const preview=previewDeleteRouteOutcome(before,proc,extraId);
  assert.match(preview.diff,/^-|^\+|@@/m);
  assert.equal(preview.sourceSpan.end-preview.sourceSpan.start,
    "          EXTRA: unresolved\n".length);
  assert.equal(before.slice(preview.sourceSpan.start,preview.sourceSpan.end),
    "          EXTRA: unresolved\n");
  const after=applyDeleteRouteOutcome(before,preview);
  assert.equal(after,ensure);
  assert.equal(projectWorkspace(after).procedure.routes.length,
    p.procedure.routes.length-1);
});
test("D3-A2 protection: core verdicts, last Route and unreachable targets fail closed",()=>{
  assert.equal(routeOutcomeEditOptions(ensure,proc,id+":UNKNOWN"),null);
  assert.throws(()=>previewDeleteRouteOutcome(ensure,proc,id+":UNKNOWN"),/Core Operator/);
  const minimal=[
    "procedures:","  demo:","    start: begin","    nodes:",
    "      begin:","        call: demo.open","        'on':",
    "          OPTIONAL: finish","      finish:","        terminal: SUCCEEDED",""
  ].join("\n");
  const route="begin:OPTIONAL";
  assert.equal(projectWorkspace(minimal).state,"READY");
  assert.throws(()=>previewDeleteRouteOutcome(minimal,"demo",route),/last operator/);
  const orphan=[
    "procedures:","  demo:","    start: begin","    nodes:",
    "      begin:","        call: demo.open","        'on':",
    "          OK: done","          OPTIONAL: isolated",
    "      done:","        terminal: SUCCEEDED",
    "      isolated:","        terminal: FAILED",""
  ].join("\n");
  assert.equal(projectWorkspace(orphan).state,"READY");
  assert.throws(()=>previewDeleteRouteOutcome(orphan,"demo",route),
    /unreachable/);
});
test("D3-A2 rejects arbitrary renames, existing Outcome collisions and Phase origin confusion",()=>{
  const before=renamed();
  assert.throws(()=>previewRenameRouteOutcome(before,proc,extraId,"INVENTED"));
  assert.throws(()=>previewRenameRouteOutcome(before,proc,extraId,"PASS"));
  assert.throws(()=>previewRenameRouteOutcome(before,proc,id+":PASS","FAIL"));
  assert.throws(()=>previewRenameRouteOutcome(before,proc,"missing:EXTRA","UNKNOWN"));
  const p=projectWorkspace(created);
  const phase=p.procedure.routes.find(r=>r.routeSource==="postconditions.on");
  assert.ok(phase);
  assert.equal(routeOutcomeEditOptions(created,p.procedure.name,phase.id),null);
  assert.throws(()=>previewDeleteRouteOutcome(created,p.procedure.name,phase.id));
});
test("D3-A2 forbids quoted keys/values, aliases, duplicate keys and malformed text",()=>{
  const texts=[
    extra().replace("'on':","on:"),
    extra().replace("EXTRA: unresolved","'EXTRA': unresolved"),
    extra().replace("EXTRA: unresolved","EXTRA: 'unresolved'"),
    extra().replace("EXTRA: unresolved","EXTRA: &x unresolved"),
    extra().replace("          EXTRA: unresolved",
      "          EXTRA: unresolved\n          EXTRA: unresolved"),
    "procedures: ["
  ];
  for(const text of texts){
    assert.equal(routeOutcomeEditOptions(text,proc,extraId),null);
    assert.throws(()=>previewDeleteRouteOutcome(text,proc,extraId));
  }
});
test("D3-A2 preserves comments on rename, rejects attached comments on delete",()=>{
  const base=renamed();
  const inline=base.replace("EXTRA: unresolved","EXTRA: unresolved # owned note");
  const rename=previewRenameRouteOutcome(inline,proc,extraId,"UNKNOWN");
  assert.match(applyRenameRouteOutcome(inline,rename),/UNKNOWN: unresolved # owned note/);
  const withInline=extra().replace("EXTRA: unresolved","EXTRA: unresolved # owned note");
  assert.throws(()=>previewDeleteRouteOutcome(withInline,proc,extraId),/inline comment/);
  const withAttached=extra().replace("          EXTRA: unresolved",
    "          # route-specific note\n          EXTRA: unresolved");
  assert.throws(()=>previewDeleteRouteOutcome(withAttached,proc,extraId),/preceding comment/);
});
test("D3-A2 supports CRLF and rejects mixed EOL; forged/stale edits are never applied",()=>{
  const before=extra(),preview=previewDeleteRouteOutcome(before,proc,extraId);
  assert.throws(()=>applyDeleteRouteOutcome(before+"\n",preview),/Stale/);
  for(const changed of [
    {...preview,diff:"forged"}, {...preview,sourceSpan:{start:0,end:0}},
    {...preview,routeId:"wrong"}, {...preview,candidateSource:before},
    {...preview,profile:"unsafe"}, {...preview,unexpected:true}
  ])assert.throws(()=>applyDeleteRouteOutcome(before,changed));
  const crlf=before.replace(/\n/g,"\r\n"),cr=previewDeleteRouteOutcome(crlf,proc,extraId);
  assert.equal(applyDeleteRouteOutcome(crlf,cr),ensure.replace(/\n/g,"\r\n"));
  assert.throws(()=>previewDeleteRouteOutcome(before.replace("\n","\r\n"),proc,extraId),
    /Mixed newline/);
});
test("D3-A2 CreatedSession child Rename preserves all other Procedures",()=>{
  const p=projectWorkspace(created);
  const procObj=[...p.procedures.values()].find(p=>
    p.nodes.some(n=>n.id==="await-initial-resources"));
  assert.ok(procObj);
  const route=procObj.routes.find(r=>r.source==="await-initial-resources"&&
    r.routeSource==="operator.on"&&r.outcome==="DENIED");
  assert.ok(route);
  const child=created.indexOf("      await-initial-resources:");
  assert.ok(child>0);
  const pos=created.indexOf("          DENIED:",child);
  assert.ok(pos>child);
  const modified=created.slice(0,pos)+
    created.slice(pos).replace("          DENIED:","          EXTRA:");
  const choices=routeOutcomeEditOptions(modified,procObj.name,"await-initial-resources:EXTRA");
  assert.ok(choices?.renameChoices.includes("DENIED"),
    "DENIED must be observed from the same call across CreatedSession child Procedures");
  const preview=previewRenameRouteOutcome(modified,procObj.name,
    "await-initial-resources:EXTRA","DENIED");
  const output=applyRenameRouteOutcome(modified,preview);
  assert.equal(output,created);
  assert.equal(projectWorkspace(output).procedures.size,p.procedures.size);
});
