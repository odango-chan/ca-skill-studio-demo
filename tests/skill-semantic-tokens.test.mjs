import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {mkdir, mkdtemp, rm} from "node:fs/promises";
import {join, resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {build} from "esbuild";

const contractText = readFileSync(
  new URL("../language/contracts/semantic-tokens.v1.json", import.meta.url), "utf8"
);
const contract = JSON.parse(contractText);
const manifest = JSON.parse(readFileSync(
  new URL("../experiments/ide-host/vscode/package.json", import.meta.url), "utf8"
));
const theme = JSON.parse(readFileSync(
  new URL("../extensions/skill-studio-theme/themes/skill-studio-light-color-theme.json", import.meta.url), "utf8"
));
const sourceRoot = resolve(process.cwd(), ".agent-tmp");
await mkdir(sourceRoot, {recursive:true});
const scratch = await mkdtemp(join(sourceRoot, "skill-semantic-colors-"));
let classifySkillSemanticTokens;
let SKILL_SEMANTIC_LEGEND;
let registerSkillSemanticHighlighting;
try {
  await build({
    entryPoints:[fileURLToPath(new URL("../language/core/semantic-tokens.mjs", import.meta.url))],
    outfile:join(scratch, "core.mjs"),
    bundle:true, format:"esm", platform:"node", target:"node24",
    packages:"external", logLevel:"silent"
  });
  await build({
    entryPoints:[fileURLToPath(new URL("../experiments/ide-host/vscode/src/semantic-highlighting.mjs", import.meta.url))],
    outfile:join(scratch, "provider.mjs"),
    bundle:true, format:"esm", platform:"node", target:"node24",
    packages:"external", logLevel:"silent"
  });
  ({classifySkillSemanticTokens, SKILL_SEMANTIC_LEGEND} =
    await import(pathToFileURL(join(scratch, "core.mjs")).href));
  ({registerSkillSemanticHighlighting} =
    await import(pathToFileURL(join(scratch, "provider.mjs")).href));
} finally {
  await rm(scratch, {recursive:true,force:true});
}

function sample(name, file){
  return readFileSync(
    new URL("../site/samples/skills/" + name + "/" + file, import.meta.url),
    "utf8"
  );
}
function observed(source, relativePath) {
  return classifySkillSemanticTokens(source, relativePath)
    .map(token => ({...token, text:source.slice(token.start,token.end)}));
}
function includesToken(items, type, text, modifier) {
  return items.some(t=>t.type===type && t.text===text &&
    (!modifier || t.modifiers.includes(modifier)));
}

test("v0.1 semantic legend is identical to the pinned ca-skills contract",()=>{
  const digest=createHash("sha1")
    .update("blob " + Buffer.byteLength(contractText) + "\0")
    .update(contractText).digest("hex");
  assert.equal(digest,"fe82778cffbcb05c5e9f7eb488e127d4fa171326",
    "update owner contract and Studio pinned snapshot together");
  assert.equal(contract.schemaVersion,1);
  assert.equal(contract.version,"0.1.0");
  const types=contract.legend.tokenTypes.map(t=>t.id);
  const modifiers=contract.legend.tokenModifiers.map(t=>t.id);
  assert.deepEqual(SKILL_SEMANTIC_LEGEND.tokenTypes,types);
  assert.deepEqual(SKILL_SEMANTIC_LEGEND.tokenModifiers,modifiers);
  assert.deepEqual(manifest.contributes.semanticTokenTypes.map(t=>t.id),types);
  assert.deepEqual(
    manifest.contributes.semanticTokenModifiers.map(t=>t.id).sort(),
    modifiers.filter(x=>x!=="declaration").sort()
  );
  assert.equal(theme.semanticHighlighting,true);
  for(const type of types)assert.match(theme.semanticTokenColors[type],/^#[0-9a-f]{6}$/i,type);
  assert.ok(!/#[0-9A-F]{6}/i.test(contractText),
    "color values belong to theme, never to language contract");
});

test("real conventional Procedure distinguishes Operators, Capabilities, Predicates and routes",()=>{
  const text=sample("establish-pdu-session","assurance/procedure.yaml");
  const before=text;
  const items=observed(text,"skills/establish-pdu-session/assurance/procedure.yaml");
  assert.ok(items.length>100);
  assert.ok(includesToken(items,"skillProcedure","ue-requested-pdu-session-establishment","declaration"));
  assert.ok(includesToken(items,"skillStep","nudm-sdm-get","declaration"));
  assert.ok(includesToken(items,"skillOperator","call"));
  assert.ok(includesToken(items,"skillCapability","sbi.udm.sm_data.get","reference"));
  assert.ok(includesToken(items,"skillPredicate","createdsession.udm.subscription_usable","reference"));
  assert.ok(includesToken(items,"skillReference","scripts/select_establishment_configuration.py","reference"));
  assert.ok(includesToken(items,"skillOutcome","PASS"));
  assert.ok(includesToken(items,"skillDataType","string"));
  assert.ok(includesToken(items,"skillBinding","context.request.dnn","reference"));
  assert.equal(text,before,"classification must not edit YAML");
  assert.ok(items.every(t=>t.start>=0&&t.end<=text.length&&t.start<t.end));
});

test("real MAS Procedure colors reconcile by its structural role, not by identifier spelling",()=>{
  const source=sample("establish-pdu-session-mas","assurance/procedure.yaml");
  const items=observed(source,"skills/establish-pdu-session-mas/assurance/procedure.yaml");
  assert.ok(includesToken(items,"skillCapability","ca.pdu_session.subscription.validate","reference"));
  assert.ok(includesToken(items,"skillOperator","reconcile"));
  assert.ok(includesToken(items,"skillStep","validate-subscription","reference"));
  assert.ok(includesToken(items,"skillOutcome","OUTCOME_UNKNOWN"));
});

test("Contract and Predicate documents get only source-backed identities",()=>{
  const name="establish-pdu-session";
  const contractSource=sample(name,"assurance/contract.yaml");
  const c=observed(contractSource,"skills/"+name+"/assurance/contract.yaml");
  assert.ok(includesToken(c,"skillKeyword","entryProcedure"));
  assert.ok(includesToken(c,"skillProcedure","ue-requested-pdu-session-establishment","reference"));
  assert.ok(includesToken(c,"skillSchema","schemas/establishment-request.schema.yaml","reference"));
  assert.ok(includesToken(c,"skillCapability","sbi.udm.sm_data.get","reference"));
  assert.ok(includesToken(c,"skillTool","skill.evaluate-udm-read","reference"));
  assert.ok(includesToken(c,"skillPredicate","createdsession.ran.setup_accepted","reference"));
  assert.ok(includesToken(c,"skillOutcome","PASS"));

  const p=observed(sample(name,"assurance/predicates.yaml"),
    "skills/"+name+"/assurance/predicates.yaml");
  assert.ok(includesToken(p,"skillPredicate","createdsession.ingress.eligible","declaration"));
  assert.ok(includesToken(p,"skillObservation","createdsession.procedure_context","reference"));
});

test("JSON schema data types and imported ToolCatalog operations use distinct tokens",()=>{
  const source=sample("establish-pdu-session","schemas/establishment-request.schema.yaml");
  const schema=observed(source,"skills/establish-pdu-session/schemas/establishment-request.schema.yaml");
  assert.ok(includesToken(schema,"skillDataType","object"));
  const imported=observed(
    "spec:\n  contracts:\n    - operation: sbi.udm.sm_data.get\n",
    "lib/tools/createdsession.tool.yaml");
  assert.ok(includesToken(imported,"skillCapability","sbi.udm.sm_data.get","imported"));
  assert.ok(includesToken(imported,"skillCapability","sbi.udm.sm_data.get","declaration"));
});

test("no speculative coloring in descriptions, user keys, invalid or unrelated YAML",()=>{
  const source="procedures:\n  p:\n    start: n\n    nodes:\n      n:\n        with:\n          call: PASS\n        call: ca.sample.read\n        description: PASS\n        'on':\n          PASS: done\n      done:\n        terminal: SUCCEEDED\n";
  const items=observed(source,"skills/demo/assurance/procedure.yaml");
  assert.ok(includesToken(items,"skillOperator","call"));
  assert.ok(includesToken(items,"skillCapability","ca.sample.read","reference"));
  assert.ok(includesToken(items,"skillOutcome","PASS"));
  assert.ok(includesToken(items,"skillKeyword","on"));
  assert.equal(items.filter(t=>t.text==="call"&&t.type==="skillOperator").length,1);
  assert.equal(items.filter(t=>t.text==="PASS"&&t.type==="skillOutcome").length,1);
  assert.ok(!includesToken(items,"skillCapability","PASS"));
  assert.deepEqual(observed("procedures: [","skills/demo/assurance/procedure.yaml"),[]);
  assert.ok(observed(source,"/workspace/skills/demo/assurance/procedure.yaml").length>5,
    "native editor URI paths start with /");
  assert.deepEqual(observed(source,"unrelated/values.yaml"),[]);
  assert.deepEqual(observed(source,"skills/../demo/assurance/procedure.yaml"),[]);
});

test("native VS Code semantic provider projects UTF-16 spans and remains cancellable",()=>{
  let registered;
  class SemanticTokensLegend{
    constructor(tokenTypes,tokenModifiers){this.tokenTypes=tokenTypes;this.tokenModifiers=tokenModifiers;}
  }
  class SemanticTokensBuilder{
    constructor(legend){this.legend=legend;this.tokens=[];}
    push(range,type,modifiers){this.tokens.push({range,type,modifiers});}
    build(){return this.tokens;}
  }
  class Range{constructor(start,end){this.start=start;this.end=end;}}
  const vscode={
    SemanticTokensLegend,SemanticTokensBuilder,Range,
    languages:{
      registerDocumentSemanticTokensProvider(selector,provider,legend){
        registered={selector,provider,legend};
        return {dispose(){}};
      }
    }
  };
  const disposable=registerSkillSemanticHighlighting(vscode);
  assert.ok(disposable);
  assert.equal(registered.selector.language,"yaml");
  const source=sample("establish-pdu-session-mas","assurance/procedure.yaml");
  const document={
    uri:{path:"/workspace/skills/establish-pdu-session-mas/assurance/procedure.yaml"},
    getText:()=>source,
    positionAt(offset){
      const before=source.slice(0,offset);
      const lines=before.split("\n");
      return {line:lines.length-1,character:lines.at(-1).length};
    }
  };
  const tokens=registered.provider.provideDocumentSemanticTokens(document,{isCancellationRequested:false});
  assert.ok(tokens.length>10);
  assert.ok(tokens.every(t=>t.range.start.line===t.range.end.line));
  assert.deepEqual(
    registered.provider.provideDocumentSemanticTokens(document,{isCancellationRequested:true}),[]);
  assert.equal(registerSkillSemanticHighlighting({languages:{}}),null);
});
