import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {SAMPLE_PACKAGES,createFileWorkspace} from "../site/sample-packages.mjs";
import {scriptNavigationReport} from "../site/script-navigation.mjs";

const root=new URL("../site/samples/packages/establish-pdu-session/",import.meta.url);
const get=path=>readFileSync(new URL(path,root),"utf8");
const files=()=>createFileWorkspace("establish-pdu-session",
  SAMPLE_PACKAGES.establish.files.map(path=>({path,text:get(path)}))).files;
const select="scripts/select_establishment_configuration.py";
const udm="scripts/evaluate_udm_read.py";
const transfer="scripts/evaluate_transfer_start.py";

test("E3-A1 exact Procedure script caller and declared schemas have source lines",()=>{
  const f=files(),report=scriptNavigationReport(f,select);
  assert.equal(report.status,"READY");
  assert.equal(report.callers.length,1);
  assert.equal(report.callers[0].path,"assurance/procedure.yaml");
  assert.match(f.get(report.callers[0].path).text.split("\n")[report.callers[0].line-1],
    /script: scripts\/select_establishment_configuration\.py/);
  assert.deepEqual(report.schemas.map(s=>s.title),
    ["EstablishmentSelectionInput","EstablishmentSelection"]);
  for(const link of report.schemas)
    assert.match(f.get(link.path).text.split("\n")[link.line-1],/title:/);
  assert.deepEqual(report.warnings,[]);
});
test("E3-A1 Predicate evaluator references use exact declared skill tool name",()=>{
  const f=files();
  for(const path of [udm,transfer]){
    const report=scriptNavigationReport(f,path);
    assert.equal(report.status,"READY");
    assert.equal(report.callers.length,1);
    const link=report.callers[0];
    assert.equal(link.path,"assurance/predicates.yaml");
    assert.match(f.get(link.path).text.split("\n")[link.line-1],
      /ref: skill\.evaluate-/);
    assert.equal(report.schemas.length,2);
    assert.deepEqual(report.warnings,[]);
  }
});
test("E3-A1 missing or ambiguous Schema never creates a guessed link",()=>{
  const f=files();
  f.delete("schemas/selection.schema.yaml");
  let report=scriptNavigationReport(f,select);
  assert.equal(report.schemas.length,1);
  assert.ok(report.warnings.some(s=>s.includes("未在 Package 中找到")));
  f.set("schemas/selection-copy.schema.yaml",
    {text:f.get("schemas/selection-input.schema.yaml").text});
  report=scriptNavigationReport(f,select);
  assert.equal(report.schemas.length,0);
  assert.ok(report.warnings.some(s=>s.includes("多个同名声明")));
});
test("E3-A1 metadata duplicate or name ambiguity fails closed for Predicate",()=>{
  const f=files();
  const script=f.get(udm);
  script.text=script.text.replace("# name: evaluate-udm-read",
    "# name: evaluate-udm-read\n# name: evaluate-udm-read");
  let report=scriptNavigationReport(f,udm);
  assert.equal(report.callers.length,0);
  assert.ok(report.warnings.some(s=>s.includes("缺少唯一")));
  script.text=get(udm);
  f.get(transfer).text=get(transfer).replace(
    "# name: evaluate-transfer-start","# name: evaluate-udm-read");
  report=scriptNavigationReport(f,udm);
  assert.equal(report.callers.length,0);
  assert.ok(report.warnings.some(s=>s.includes("不唯一")));
});
test("E3-A1 malformed YAML cannot fabricate links, and Source remains unchanged",()=>{
  const f=files(),before=[...f].map(([path,file])=>[path,file.text]);
  assert.equal(scriptNavigationReport(f,select).status,"READY");
  assert.deepEqual([...f].map(([path,file])=>[path,file.text]),before);
  f.get("assurance/procedure.yaml").text="procedures: [";
  const report=scriptNavigationReport(f,select);
  assert.equal(report.callers.length,0);
  assert.ok(report.warnings.some(s=>s.includes("YAML 无法解析")));
  assert.equal(scriptNavigationReport(f,"scripts/../bad.py").status,"UNAVAILABLE");
  assert.equal(scriptNavigationReport(null,select).status,"UNAVAILABLE");
});

test("E3-A1 YAML and Python metadata references expose exact UTF-16 source and target ranges",()=>{
  const f=files();
  const procedure=f.get("assurance/procedure.yaml");
  procedure.text="# 注释 😀\\r\\n"+procedure.text.replace(/\\r?\\n/g,"\\r\\n");
  for(const [path,file] of f){
    if(path.endsWith(".schema.yaml"))file.text="# schema 😀\\r\\n"+file.text.replace(/\\r?\\n/g,"\\r\\n");
    else if(path.endsWith(".py"))file.text=file.text.replace(/\\r?\\n/g,"\\r\\n");
  }
  const report=scriptNavigationReport(f,select);
  assert.equal(report.status,"READY");
  const caller=report.callers.find(item=>item.path==="assurance/procedure.yaml");
  assert.ok(caller?.sourceRange&&caller?.targetRange);
  const sourceText=procedure.text.slice(caller.sourceRange.start,caller.sourceRange.end);
  assert.equal(sourceText,"scripts/select_establishment_configuration.py");
  const scriptText=f.get(select).text;
  assert.equal(scriptText.slice(caller.targetRange.start,caller.targetRange.end),
    "select-establishment-configuration");
  for(const schema of report.schemas){
    assert.ok(schema.sourceRange&&schema.targetRange);
    const script=f.get(select).text;
    assert.equal(script.slice(schema.sourceRange.start,schema.sourceRange.end),schema.title);
    const target=f.get(schema.path).text.slice(schema.targetRange.start,schema.targetRange.end);
    assert.equal(target,schema.title);
  }
});
