import test from "node:test";
import assert from "node:assert/strict";
import {
  compilerMarkerShadowed,compilerMarkerSignature
} from "../experiments/ide-host/vscode/src/compiler-marker-reconciliation.mjs";

const uri="file:///workspace/skills/example/assurance/contract.yaml";
const compiler=(changes={})=>({
  kind:"compiler-diagnostic",locationKind:"source",
  status:"confirmed",code:"YAML_PARSE_ERROR",message:"Compiler YAML error",
  severity:"error",uri,line:9,column:11,...changes
});
const local=(changes={})=>({
  code:"YAML_PARSE_ERROR",source:"Skill Studio · package-audit",
  severity:0,range:{start:{line:8,character:10},end:{line:8,character:25}},
  ...changes
});
const accepted=(changes={})=>({
  code:"YAML_PARSE_ERROR",source:"package-audit",status:"confirmed",
  severity:"error",uri,line:9,...changes
});

test("confirmed local LSP marker shadows exactly matching Compiler squiggle",()=>{
  assert.equal(compilerMarkerShadowed(compiler(),[local()],[accepted()]),true);
  assert.equal(compilerMarkerShadowed(compiler(),[local({code:{value:"YAML_PARSE_ERROR"}})],[accepted()]),true);
  assert.equal(compilerMarkerShadowed(compiler({uri:{toString:()=>uri}}),[local()],[accepted()]),true);
});

test("never shadow Compiler errors based on wording or untrusted other providers",()=>{
  assert.equal(compilerMarkerShadowed(compiler(),[local({source:"Some other extension"})],[accepted()]),false);
  assert.equal(compilerMarkerShadowed(compiler(),[local({code:"OTHER_CODE"})],[accepted()]),false);
  assert.equal(compilerMarkerShadowed(compiler(),[local({severity:1})],[accepted()]),false);
  assert.equal(compilerMarkerShadowed(compiler(),[local({range:{
    start:{line:8,character:11},end:{line:8,character:26}}})],[accepted()]),false);
});

test("unavailable/stale Language Service findings cannot shadow an authoritative Compiler marker",()=>{
  assert.equal(compilerMarkerShadowed(compiler(),[local()],[]),false);
  assert.equal(compilerMarkerShadowed(compiler(),[],[accepted()]),false);
  assert.equal(compilerMarkerShadowed(compiler(),[local()],[accepted({uri:"file:///elsewhere"})]),false);
  assert.equal(compilerMarkerShadowed(compiler(),[local()],[accepted({status:"not_checked"})]),false);
  assert.equal(compilerMarkerShadowed(compiler(),[local()],[accepted({status:"blocked"})]),false);
  assert.equal(compilerMarkerShadowed(compiler(),[local()],[
    accepted(),accepted({status:"not_checked"})
  ]),false,"an unresolved duplicate at the same code/line cannot be silently hidden");
  assert.equal(compilerMarkerShadowed(compiler({locationKind:"file"}),[local()],[accepted()]),false);
  assert.equal(compilerMarkerShadowed(compiler({line:null}),[local()],[accepted()]),false);
});

test("source-projection syntax failures with absent trust status are still confirmed source facts",()=>{
  assert.equal(compilerMarkerShadowed(compiler(),[
    local({source:"Skill Studio · procedure-projection"})
  ],[accepted({source:"procedure-projection",status:undefined})]),true);
  assert.equal(compilerMarkerShadowed(compiler(),[
    local({source:"Skill Studio · package-audit"})
  ],[accepted({status:undefined})]),false);
});

test("warning and error positions are treated independently",()=>{
  const warning=compiler({severity:"warning"});
  const warningMarker=local({severity:1});
  assert.equal(compilerMarkerShadowed(warning,[warningMarker],
    [accepted({severity:"warning"})]),true);
  assert.equal(compilerMarkerShadowed(warning,[local()],
    [accepted({severity:"warning"})]),false);
});

test("stable compiler marker projection signature changes only for different renderings",()=>{
  const first=compiler();
  const same={...first};
  assert.equal(compilerMarkerSignature([first]),compilerMarkerSignature([same]));
  assert.notEqual(compilerMarkerSignature([first]),
    compilerMarkerSignature([compiler({column:12})]));
  assert.notEqual(compilerMarkerSignature([first]),compilerMarkerSignature([]));
});
