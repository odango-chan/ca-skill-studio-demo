import test from "node:test";
import assert from "node:assert/strict";
import {mkdirSync,readFileSync} from "node:fs";
import {mkdtemp,rm} from "node:fs/promises";
import {join,resolve} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {build} from "esbuild";

const scratchRoot=resolve(process.cwd(),".agent-tmp");
mkdirSync(scratchRoot,{recursive:true});
const scratch=await mkdtemp(join(scratchRoot,"skill-symbol-index-"));
let symbols;
try{
  const entry=fileURLToPath(new URL("../language/symbol-index.mjs",import.meta.url));
  const bundle=join(scratch,"symbol-index.mjs");
  await build({
    entryPoints:[entry],outfile:bundle,bundle:true,format:"esm",
    platform:"node",target:"node24",packages:"external",logLevel:"silent"
  });
  symbols=await import(pathToFileURL(bundle).href);
}finally{
  await rm(scratch,{recursive:true,force:true});
}

const rootUri="file:///workspace/establish-pdu-session";
const sampleRoot="./fixtures/v1alpha5-conventional/establish-pdu-session/";
function read(path){return readFileSync(new URL(sampleRoot+path,import.meta.url),"utf8");}
function document(relativePath,text){
  return {uri:rootUri+"/"+relativePath,relativePath,languageId:"yaml",
    version:relativePath==="assurance/procedure.yaml"?1:0,text};
}
function packageSnapshot(extra=[]){
  const docs=[
    document("assurance/contract.yaml",read("assurance/contract.yaml")),
    document("assurance/predicates.yaml",read("assurance/predicates.yaml")),
    document("assurance/procedure.yaml",read("assurance/procedure.yaml")),
    document("schemas/establishment-request.schema.yaml",
      read("schemas/establishment-request.schema.yaml")),
    document("scripts/validate-subscription-request.py",
      read("scripts/validate-subscription-request.py"))
  ];
  return {rootUri,packageName:"establish-pdu-session",generation:1,
    completeness:"complete",documents:[...docs,...extra]};
}
function offsetOf(text,needle,from=0){
  const value=text.indexOf(needle,from);
  assert.ok(value>=0,"missing "+needle);
  return value;
}
function at(index,uri,text,needle,from=0){
  const offset=offsetOf(text,needle,from);
  return symbols.skillSymbolAt(index,uri,offset);
}

test("Contract precondition resolves to the exact v1alpha5 Procedure Node",()=>{
  const snapshot=packageSnapshot();
  const index=symbols.buildSkillSymbolIndex(snapshot);
  const contract=snapshot.documents.find(x=>x.relativePath==="assurance/contract.yaml");
  const procedure=snapshot.documents.find(x=>x.relativePath==="assurance/procedure.yaml");
  const hit=at(index,contract.uri,contract.text,"get-sm-subscription-data.precondition");
  assert.equal(hit.token.type,"skillStep");
  const declaration=symbols.uniqueSkillSymbolDeclaration(hit);
  assert.equal(declaration.uri,procedure.uri);
  assert.equal(declaration.type,"skillStep");
  assert.equal(declaration.name,"get-sm-subscription-data");
  assert.ok(declaration.modifiers.includes("declaration"));
  const refs=symbols.skillSymbolOccurrences(hit,true);
  assert.ok(refs.some(x=>x.uri===contract.uri));
  assert.ok(refs.some(x=>x.uri===procedure.uri));
});

test("Procedure Predicate references resolve to the v1alpha5 Predicate declarations",()=>{
  const snapshot=packageSnapshot();
  const index=symbols.buildSkillSymbolIndex(snapshot);
  const procedure=snapshot.documents.find(x=>x.relativePath==="assurance/procedure.yaml");
  const predicates=snapshot.documents.find(x=>x.relativePath==="assurance/predicates.yaml");
  const hit=at(index,procedure.uri,procedure.text,"establishment.request.supported");
  assert.equal(hit.token.type,"skillPredicate");
  const declaration=symbols.uniqueSkillSymbolDeclaration(hit);
  assert.equal(declaration.uri,predicates.uri);
  assert.equal(declaration.type,"skillPredicate");
  assert.equal(declaration.name,"establishment.request.supported");
  const occurrences=symbols.skillSymbolOccurrences(hit,true);
  assert.ok(occurrences.some(x=>x.uri===procedure.uri));
  assert.ok(occurrences.some(x=>x.uri===predicates.uri));
});

test("Procedure route references resolve to exact Node declarations in the same graph",()=>{
  const snapshot=packageSnapshot();
  const index=symbols.buildSkillSymbolIndex(snapshot);
  const procedure=snapshot.documents.find(x=>x.relativePath==="assurance/procedure.yaml");
  const route="PASS: subscribe-sm-data";
  const hit=at(index,procedure.uri,procedure.text,"subscribe-sm-data",
    procedure.text.indexOf(route));
  assert.equal(hit.token.type,"skillStep");
  const declaration=symbols.uniqueSkillSymbolDeclaration(hit);
  assert.equal(declaration.type,"skillStep");
  assert.equal(declaration.name,"subscribe-sm-data");
  assert.equal(declaration.uri,procedure.uri);
  const occurrences=symbols.skillSymbolOccurrences(hit,true);
  assert.ok(occurrences.length>=2);
});

test("v1alpha5 wait.output and response.after resolve to exact Node declarations",()=>{
  const snapshot=packageSnapshot();
  const index=symbols.buildSkillSymbolIndex(snapshot);
  const procedure=snapshot.documents.find(x=>x.relativePath==="assurance/procedure.yaml");

  const waitOutput="update-sm-context.wait.output";
  const waitHit=at(index,procedure.uri,procedure.text,waitOutput,
    procedure.text.indexOf("request: "+waitOutput));
  assert.equal(waitHit.token.type,"skillStep");
  const waitDeclaration=symbols.uniqueSkillSymbolDeclaration(waitHit);
  assert.equal(waitDeclaration.name,"update-sm-context");
  assert.equal(waitDeclaration.uri,procedure.uri);

  const responseAfter="prepare-step17-response";
  const responseHit=at(index,procedure.uri,procedure.text,responseAfter,
    procedure.text.indexOf("after: "+responseAfter));
  assert.equal(responseHit.token.type,"skillStep");
  const responseDeclaration=symbols.uniqueSkillSymbolDeclaration(responseHit);
  assert.equal(responseDeclaration.name,responseAfter);
  assert.equal(responseDeclaration.uri,procedure.uri);
});

test("Contract request Schema reference resolves to the exact Package-owned Schema file",()=>{
  const snapshot=packageSnapshot();
  const index=symbols.buildSkillSymbolIndex(snapshot);
  const contract=snapshot.documents.find(x=>x.relativePath==="assurance/contract.yaml");
  const schema=snapshot.documents.find(x=>x.relativePath==="schemas/establishment-request.schema.yaml");
  const path="schemas/establishment-request.schema.yaml";
  const hit=at(index,contract.uri,contract.text,path);
  const declaration=symbols.uniqueSkillSymbolDeclaration(hit);
  assert.equal(hit.token.type,"skillSchema");
  assert.equal(declaration.uri,schema.uri);
  assert.deepEqual(declaration.range,{start:0,end:0},
    "file-path navigation lands at the exact target document start");
});

test("Predicate script references resolve only to exact Package-owned script files",()=>{
  const snapshot=packageSnapshot();
  const index=symbols.buildSkillSymbolIndex(snapshot);
  const predicates=snapshot.documents.find(x=>x.relativePath==="assurance/predicates.yaml");
  const script=snapshot.documents.find(x=>x.relativePath==="scripts/validate-subscription-request.py");
  const path="scripts/validate-subscription-request.py";
  const hit=at(index,predicates.uri,predicates.text,path);
  assert.equal(hit.token.type,"skillReference");
  const declaration=symbols.uniqueSkillSymbolDeclaration(hit);
  assert.equal(declaration.uri,script.uri);
  assert.equal(declaration.relativePath,path);
  assert.deepEqual(declaration.range,{start:0,end:0});
});

test("External context schemas and unpublished Capability/Operation grants never invent declarations",()=>{
  const snapshot=packageSnapshot();
  const index=symbols.buildSkillSymbolIndex(snapshot);
  const contract=snapshot.documents.find(x=>x.relativePath==="assurance/contract.yaml");
  const procedure=snapshot.documents.find(x=>x.relativePath==="assurance/procedure.yaml");

  const contextSchema="ca-context::urn:connectionagent:ca:context:subject:v1";
  assert.equal(symbols.skillSymbolAt(index,contract.uri,
    offsetOf(contract.text,contextSchema)),null,
    "an external Schema identity is not a Package-relative file path");

  const capability="urn:example:connectionagent:capability:3gpp:nudm-sdm-get:v1";
  const grant=at(index,contract.uri,contract.text,capability);
  assert.equal(grant.token.type,"skillCapability");
  assert.equal(symbols.uniqueSkillSymbolDeclaration(grant),null,
    "an illustrative Capability without a trusted publication is unresolved");

  const operation="ca::sbi.udm.sm_data.get";
  const operationRef=at(index,procedure.uri,procedure.text,operation);
  assert.equal(operationRef.token.type,"skillOperation");
  assert.equal(symbols.uniqueSkillSymbolDeclaration(operationRef),null,
    "a callable reference without an imported Owner ToolCatalog remains unresolved");

  const observation="ca-session-context::context.smf.session.read";
  const observationRef=at(index,procedure.uri,procedure.text,observation);
  assert.equal(observationRef.token.type,"skillObservation");
  assert.equal(symbols.uniqueSkillSymbolDeclaration(observationRef),null,
    "an Observation is not conflated with an Operation export");
});

test("Document Symbols expose v1alpha5 Procedure Nodes and Predicate declarations",()=>{
  const snapshot=packageSnapshot();
  const index=symbols.buildSkillSymbolIndex(snapshot);
  const procedure=snapshot.documents.find(x=>x.relativePath==="assurance/procedure.yaml");
  const predicates=snapshot.documents.find(x=>x.relativePath==="assurance/predicates.yaml");
  const procedureSymbols=symbols.skillSymbolDeclarationsForDocument(index,procedure.uri);
  assert.ok(procedureSymbols.some(x=>x.type==="skillStep"&&
    x.name==="get-sm-subscription-data"));
  assert.ok(procedureSymbols.some(x=>x.type==="skillStep"&&x.name==="update-sm-context"));
  assert.ok(!procedureSymbols.some(x=>x.type==="skillProcedure"),
    "v1alpha5 has one Package-level Procedure graph");
  const predicateSymbols=symbols.skillSymbolDeclarationsForDocument(index,predicates.uri);
  assert.ok(predicateSymbols.some(x=>x.type==="skillPredicate"&&
    x.name==="establishment.request.supported"));
});

test("symbol index remains package- and generation-scoped",()=>{
  const first=packageSnapshot();
  const second={...first,generation:2,rootUri:"file:///workspace/other"};
  const a=symbols.buildSkillSymbolIndex(first);
  const b=symbols.buildSkillSymbolIndex(second);
  assert.equal(a.rootUri,rootUri);
  assert.equal(a.generation,1);
  assert.equal(b.rootUri,second.rootUri);
  assert.equal(b.generation,2);
  assert.notEqual(a.tokensByUri,b.tokensByUri);
});
