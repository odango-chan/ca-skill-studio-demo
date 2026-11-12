import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync,mkdirSync} from "node:fs";
import {mkdtemp,rm} from "node:fs/promises";
import {join,resolve} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {build} from "esbuild";
import {
  standaloneSemanticTokenRules,
  semanticTokenDecorationClass,
  semanticTokenDecorationCss
} from "../site/semantic-token-theme.mjs";

const contractText=readFileSync(new URL(
  "../language/contracts/semantic-tokens.v1.json",import.meta.url
),"utf8");
const contract=JSON.parse(contractText);
const manifest=JSON.parse(readFileSync(new URL(
  "../extensions/skill-studio-languages/package.json",import.meta.url
),"utf8"));
const theme=JSON.parse(readFileSync(new URL(
  "../extensions/skill-studio-theme/themes/skill-studio-light-color-theme.json",
  import.meta.url
),"utf8"));
const scratchRoot=resolve(process.cwd(),".agent-tmp");
mkdirSync(scratchRoot,{recursive:true});
const scratch=await mkdtemp(join(scratchRoot,"skill-semantic-tokens-v02-"));
let semantic;
try{
  const entry=fileURLToPath(new URL("../language/semantic-tokens.mjs",import.meta.url));
  const bundle=join(scratch,"semantic-tokens.mjs");
  await build({
    entryPoints:[entry],outfile:bundle,bundle:true,format:"esm",
    platform:"node",target:"node24",packages:"external",logLevel:"silent"
  });
  semantic=await import(pathToFileURL(bundle).href);
}finally{
  await rm(scratch,{recursive:true,force:true});
}

function sample(skill,path){
  return readFileSync(new URL(
    "../site/samples/skills/"+skill+"/"+path,import.meta.url
  ),"utf8");
}
function observed(source,path){
  return semantic.classifySkillSemanticTokens(source,path).map(token=>({
    ...token,text:source.slice(token.start,token.end)
  }));
}
function has(items,type,text,modifier){
  return items.some(item=>item.type===type&&item.text===text&&
    (!modifier||item.modifiers.includes(modifier)));
}
function tokenFor(source,items,text,type,modifier,from=0){
  const start=source.indexOf(text,from);
  assert.notEqual(start,-1,"fixture contains "+text);
  const found=items.find(item=>item.start<=start&&item.end>=start+text.length&&
    item.type===type&&(!modifier||item.modifiers.includes(modifier)));
  assert.ok(found,"expected "+type+" token for "+text);
  return found;
}

test("Studio consumes the exact current ca-skills v0.2.0 semantic projection",()=>{
  const blobSha=createHash("sha1")
    .update("blob "+Buffer.byteLength(contractText)+"\0")
    .update(contractText).digest("hex");
  assert.equal(blobSha,"618c5c671f2c18785ecc10f84b9d549f88b4b138",
    "refresh the pinned snapshot and source metadata together");
  assert.equal(contract.id,"connectionagent.skill.semantic-tokens");
  assert.equal(contract.schemaVersion,1);
  assert.equal(contract.version,"0.2.0");
  assert.equal(contract.status,"current");
  assert.match(contract.authority.semantics,/Skill Language v0\.2/);
  const types=contract.legend.tokenTypes.map(item=>item.id);
  const modifiers=contract.legend.tokenModifiers.map(item=>item.id);
  assert.deepEqual(semantic.SKILL_SEMANTIC_TOKEN_TYPES,types);
  assert.deepEqual(semantic.SKILL_SEMANTIC_TOKEN_MODIFIERS,modifiers);
  assert.deepEqual(manifest.contributes.semanticTokenTypes.map(item=>item.id),types);
  assert.deepEqual(
    manifest.contributes.semanticTokenModifiers.map(item=>item.id).sort(),
    modifiers.filter(item=>item!=="declaration").sort()
  );
  assert.equal(theme.semanticHighlighting,true);
  for(const type of types)
    assert.match(theme.semanticTokenColors[type],/^#[0-9a-f]{6}$/i,type);
  assert.ok(!/#[0-9a-f]{6}/i.test(contractText),
    "colors are theme-owned, not language-contract data");
});

test("5GC Procedure uses exact v0.2 AST selectors for declarations, operators, references and bindings",()=>{
  const source=sample("establish-pdu-session","assurance/procedure.yaml");
  const items=observed(source,"skills/establish-pdu-session/assurance/procedure.yaml");
  assert.ok(items.length>100);
  tokenFor(source,items,"ue-requested-pdu-session-establishment","skillProcedure","declaration");
  tokenFor(source,items,"nudm-sdm-get","skillStep","declaration");
  tokenFor(source,items,"call","skillOperator");
  tokenFor(source,items,"sbi.udm.sm_data.get","skillOperation","reference");
  tokenFor(source,items,"createdsession.ingress.eligible","skillPredicate","reference");
  tokenFor(source,items,"PASS","skillOutcome");
  tokenFor(source,items,"string","skillDataType");
  tokenFor(source,items,"context.subject.ueRef","skillBinding","reference");
  assert.ok(items.every(item=>item.start>=0&&item.end<=source.length&&item.start<item.end));
  assert.ok(!items.some(item=>item.type.startsWith("ca")));
});

test("MAS Procedure receives the same canonical language projection",()=>{
  const source=sample("establish-pdu-session-mas","assurance/procedure.yaml");
  const items=observed(source,"skills/establish-pdu-session-mas/assurance/procedure.yaml");
  tokenFor(source,items,"establish-session","skillProcedure","declaration");
  tokenFor(source,items,"verify-eligible","skillStep","declaration");
  tokenFor(source,items,"verify","skillOperator");
  tokenFor(source,items,"mas.establishment.eligible","skillPredicate","reference");
  tokenFor(source,items,"PASS","skillOutcome");
});

test("Contract and PredicateSet source positions follow their own profiles",()=>{
  const contractSource=sample("establish-pdu-session","assurance/contract.yaml");
  const c=observed(contractSource,"skills/establish-pdu-session/assurance/contract.yaml");
  tokenFor(contractSource,c,"entryProcedure","skillKeyword");
  tokenFor(contractSource,c,"ue-requested-pdu-session-establishment","skillProcedure","reference");
  tokenFor(contractSource,c,"schemas/establishment-request.schema.yaml","skillSchema","reference");
  tokenFor(contractSource,c,"sbi.udm.sm_data.get","skillCapability","reference");

  const predicateSource=sample("establish-pdu-session","assurance/predicates.yaml");
  const p=observed(predicateSource,"skills/establish-pdu-session/assurance/predicates.yaml");
  tokenFor(predicateSource,p,"createdsession.ingress.eligible","skillPredicate","declaration");
  tokenFor(predicateSource,p,"createdsession.procedure_context","skillObservation","reference");
});

test("Skill-owned JSON Schema positions use canonical type and schema references",()=>{
  const source=sample("establish-pdu-session","schemas/establishment-request.schema.yaml");
  const items=observed(source,"skills/establish-pdu-session/schemas/establishment-request.schema.yaml");
  tokenFor(source,items,"object","skillDataType");
});

test("imported ToolCatalog operations are declarations, not fabricated resolved links",()=>{
  const source=`apiVersion: connectionagent.io/v1alpha1
kind: ToolCatalog
spec:
  contracts:
    - operation: sbi.udm.sm_data.get
      effect: READ
`;
  const items=observed(source,"lib/tools/example.tool.yaml");
  tokenFor(source,items,"sbi.udm.sm_data.get","skillOperation","declaration");
  const imported=items.find(item=>item.text==="sbi.udm.sm_data.get");
  assert.ok(imported.modifiers.includes("imported"));
});

test("invalid YAML, unrelated paths and traversal paths produce no speculative tokens",()=>{
  const source="procedures:\n  p:\n    nodes:\n      n:\n        call: ca.sample.read\n        description: PASS\n";
  assert.deepEqual(observed("procedures: [","skills/demo/assurance/procedure.yaml"),[]);
  assert.deepEqual(observed(source,"unrelated/values.yaml"),[]);
  assert.deepEqual(observed(source,"skills/../demo/assurance/procedure.yaml"),[]);
  assert.deepEqual(observed(source,"skills/demo/assurance\\procedure.yaml"),[]);
});

test("Monaco provider encodes the canonical legend and registers only the YAML profile",()=>{
  const registrations=[];
  const monaco={languages:{
    registerDocumentSemanticTokensProvider(language,provider){
      registrations.push({language,provider});
      return {dispose(){}};
    }
  }};
  const first=semantic.registerSkillSemanticTokens(monaco);
  const second=semantic.registerSkillSemanticTokens(monaco);
  assert.equal(first,second,"registration is idempotent");
  assert.deepEqual(registrations.map(item=>item.language),["yaml"]);
  const provider=registrations[0].provider;
  assert.deepEqual(provider.getLegend().tokenTypes,semantic.SKILL_SEMANTIC_TOKEN_TYPES);
  assert.deepEqual(provider.getLegend().tokenModifiers,semantic.SKILL_SEMANTIC_TOKEN_MODIFIERS);
  const source=sample("establish-pdu-session","assurance/contract.yaml");
  const model={
    uri:{path:"/workspace/skills/establish-pdu-session/assurance/contract.yaml"},
    getValue:()=>source,getValueLength:()=>source.length,
    getPositionAt(offset){
      const before=source.slice(0,offset),lines=before.split("\n");
      return {lineNumber:lines.length,column:lines.at(-1).length+1};
    },
    getOffsetAt({lineNumber,column}){
      const lines=source.split("\n");
      let offset=0;for(let i=0;i<lineNumber-1;i++)offset+=lines[i].length+1;
      return offset+column-1;
    },
    getLineMaxColumn(lineNumber){return source.split("\n")[lineNumber-1].length+1;}
  };
  const result=provider.provideDocumentSemanticTokens(model,null,{isCancellationRequested:false});
  assert.ok(result.data instanceof Uint32Array);
  assert.ok(result.data.length>0);
  assert.equal(result.data.length%5,0);
  assert.deepEqual(provider.provideDocumentSemanticTokens(model,null,{isCancellationRequested:true}).data,new Uint32Array());
  first.dispose();
});

test("Studio Light and Monaco decoration adapter render every canonical token identity",()=>{
  assert.equal(theme.semanticHighlighting,true);
  for(const type of semantic.SKILL_SEMANTIC_TOKEN_TYPES)
    assert.ok(theme.semanticTokenColors[type],type+" has a theme color");
  const rules=standaloneSemanticTokenRules(theme.semanticTokenColors);
  assert.equal(rules.find(rule=>rule.token==="skillPredicate")?.foreground,"317DC0");
  assert.equal(rules.find(rule=>rule.token==="skillOutcome")?.foreground,"AD6517");
  assert.equal(semanticTokenDecorationClass("skillPredicate"),
    "ca-semantic-token--skillPredicate");
  const css=semanticTokenDecorationCss(theme.semanticTokenColors);
  assert.match(css,/\.ca-semantic-token--skillPredicate\{color:#317DC0!important\}/);
  assert.match(css,/\.ca-semantic-token--skillOutcome\{color:#AD6517!important\}/);
  assert.doesNotMatch(css,/caReferencePredicate|caValueOutcome/);
});
