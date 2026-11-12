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
const sampleRoot="../site/samples/skills/establish-pdu-session/";
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
    document("schemas/establishment-request.schema.yaml",read("schemas/establishment-request.schema.yaml")),
    document("scripts/select_establishment_configuration.py",read("scripts/select_establishment_configuration.py")),
    document("lib/tools/udm.tool.yaml",`apiVersion: connectionagent.io/v1alpha1
kind: ToolCatalog
spec:
  contracts:
    - operation: sbi.udm.sm_data.get
      effect: READ
`)
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

test("Contract entry Procedure resolves to the unique Procedure declaration",()=>{
  const snapshot=packageSnapshot();
  const index=symbols.buildSkillSymbolIndex(snapshot);
  const contract=snapshot.documents.find(x=>x.relativePath==="assurance/contract.yaml");
  const procedure=snapshot.documents.find(x=>x.relativePath==="assurance/procedure.yaml");
  const hit=at(index,contract.uri,contract.text,"ue-requested-pdu-session-establishment");
  const declaration=symbols.uniqueSkillSymbolDeclaration(hit);
  assert.equal(declaration.uri,procedure.uri);
  assert.equal(declaration.type,"skillProcedure");
  assert.ok(declaration.modifiers.includes("declaration"));
  const refs=symbols.skillSymbolOccurrences(hit,true);
  assert.ok(refs.some(x=>x.uri===contract.uri));
  assert.ok(refs.some(x=>x.uri===procedure.uri));
});

test("Procedure Predicate references resolve to PredicateSet declarations",()=>{
  const snapshot=packageSnapshot();
  const index=symbols.buildSkillSymbolIndex(snapshot);
  const procedure=snapshot.documents.find(x=>x.relativePath==="assurance/procedure.yaml");
  const predicates=snapshot.documents.find(x=>x.relativePath==="assurance/predicates.yaml");
  const hit=at(index,procedure.uri,procedure.text,"createdsession.ingress.eligible");
  const declaration=symbols.uniqueSkillSymbolDeclaration(hit);
  assert.equal(declaration.uri,predicates.uri);
  assert.equal(declaration.type,"skillPredicate");
  assert.equal(declaration.name,"createdsession.ingress.eligible");
  const occurrences=symbols.skillSymbolOccurrences(hit,true);
  assert.ok(occurrences.some(x=>x.uri===procedure.uri));
  assert.ok(occurrences.some(x=>x.uri===predicates.uri));
});

test("Procedure start and route references resolve within their owning Procedure scope",()=>{
  const snapshot=packageSnapshot();
  const index=symbols.buildSkillSymbolIndex(snapshot);
  const procedure=snapshot.documents.find(x=>x.relativePath==="assurance/procedure.yaml");
  const start=at(index,procedure.uri,procedure.text,"nudm-sdm-get");
  const declaration=symbols.uniqueSkillSymbolDeclaration(start);
  assert.equal(declaration.type,"skillStep");
  assert.equal(declaration.name,"nudm-sdm-get");
  assert.deepEqual(declaration.path.slice(0,3),["procedures",
    "ue-requested-pdu-session-establishment","nodes"]);
  const occurrences=symbols.skillSymbolOccurrences(start,true);
  assert.ok(occurrences.length>=2);
});

test("Contract Schema references resolve to exact Package-owned Schema files",()=>{
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

test("missing Owner Schema and fragment-only refs never produce guessed destinations",()=>{
  const snapshot=packageSnapshot();
  const index=symbols.buildSkillSymbolIndex(snapshot);
  const contract=snapshot.documents.find(x=>x.relativePath==="assurance/contract.yaml");
  const missingPath="lib/host/subject.schema.yaml";
  const missing=at(index,contract.uri,contract.text,missingPath);
  assert.ok(missing);
  assert.equal(symbols.uniqueSkillSymbolDeclaration(missing),null);
  const source="properties:\\n  value:\\n    $ref: '#/$defs/Thing'\\n$defs:\\n  Thing:\\n    type: string\\n";
  const relativePath="schemas/fragment.schema.yaml";
  const uri=rootUri+"/"+relativePath;
  const fragmentSnapshot={...snapshot,documents:[...snapshot.documents,
    document(relativePath,source)]};
  const fragmentIndex=symbols.buildSkillSymbolIndex(fragmentSnapshot);
  const fragment=at(fragmentIndex,uri,source,"#/$defs/Thing");
  assert.equal(fragment,null,"fragment target needs exact AST range support");
});

test("Contract direct Operation grants resolve only when the exact ToolCatalog Operation exists",()=>{
  const snapshot=packageSnapshot();
  const index=symbols.buildSkillSymbolIndex(snapshot);
  const contract=snapshot.documents.find(x=>x.relativePath==="assurance/contract.yaml");
  const operation="sbi.udm.sm_data.get";
  const hit=at(index,contract.uri,contract.text,operation);
  const declaration=symbols.uniqueSkillSymbolDeclaration(hit);
  assert.equal(declaration.relativePath,"lib/tools/udm.tool.yaml");
  assert.ok(declaration.modifiers.includes("imported"));
});

test("Procedure Operation references resolve only to an exact imported ToolCatalog declaration",()=>{
  const snapshot=packageSnapshot();
  const index=symbols.buildSkillSymbolIndex(snapshot);
  const procedure=snapshot.documents.find(x=>x.relativePath==="assurance/procedure.yaml");
  const tools=snapshot.documents.find(x=>x.relativePath==="lib/tools/udm.tool.yaml");
  const hit=at(index,procedure.uri,procedure.text,"sbi.udm.sm_data.get");
  const declaration=symbols.uniqueSkillSymbolDeclaration(hit);
  assert.equal(declaration.uri,tools.uri);
  assert.ok(declaration.modifiers.includes("imported"));
});

test("duplicate imported Operation declarations are ambiguous and never produce a Definition",()=>{
  const duplicate=document("lib/tools/another.tool.yaml",`apiVersion: connectionagent.io/v1alpha1
kind: ToolCatalog
spec:
  contracts:
    - operation: sbi.udm.sm_data.get
      effect: READ
`);
  const snapshot=packageSnapshot([duplicate]);
  const index=symbols.buildSkillSymbolIndex(snapshot);
  const procedure=snapshot.documents.find(x=>x.relativePath==="assurance/procedure.yaml");
  const hit=at(index,procedure.uri,procedure.text,"sbi.udm.sm_data.get");
  assert.equal(hit.declarations.length,2);
  assert.equal(symbols.uniqueSkillSymbolDeclaration(hit),null);
  const completions=symbols.skillSymbolCompletions(index,procedure.uri,
    hit.token.range.start+4);
  assert.ok(!completions.items.some(item=>item.name==="sbi.udm.sm_data.get"),
    "ambiguous Operation declarations are not suggested as a unique completion");
});

test("unresolved Operation and missing Owner Schema never become invented declarations",()=>{
  const snapshot=packageSnapshot();
  const index=symbols.buildSkillSymbolIndex(snapshot);
  const contract=snapshot.documents.find(x=>x.relativePath==="assurance/contract.yaml");
  const grant=at(index,contract.uri,contract.text,"ca.session.operation_context.read");
  assert.ok(grant,"resource grant has an exact source token");
  assert.equal(symbols.uniqueSkillSymbolDeclaration(grant),null,
    "a Capability grant without a matching imported Operation is unresolved");
});

test("Document Symbols expose Procedures, nested nodes and Predicates from exact declarations",()=>{
  const snapshot=packageSnapshot();
  const index=symbols.buildSkillSymbolIndex(snapshot);
  const procedure=snapshot.documents.find(x=>x.relativePath==="assurance/procedure.yaml");
  const predicates=snapshot.documents.find(x=>x.relativePath==="assurance/predicates.yaml");
  const procedureSymbols=symbols.skillSymbolDeclarationsForDocument(index,procedure.uri);
  assert.ok(procedureSymbols.some(x=>x.type==="skillProcedure"&&
    x.name==="ue-requested-pdu-session-establishment"));
  assert.ok(procedureSymbols.some(x=>x.type==="skillStep"&&x.name==="nudm-sdm-get"));
  const predicateSymbols=symbols.skillSymbolDeclarationsForDocument(index,predicates.uri);
  assert.ok(predicateSymbols.some(x=>x.type==="skillPredicate"&&
    x.name==="createdsession.ingress.eligible"));
});

test("PRE/POST local phase-step names are not Procedure node targets",()=>{
  const snapshot=packageSnapshot();
  const index=symbols.buildSkillSymbolIndex(snapshot);
  const procedure=snapshot.documents.find(x=>x.relativePath==="assurance/procedure.yaml");
  const declarations=symbols.skillSymbolDeclarationsForDocument(index,procedure.uri)
    .filter(item=>item.type==="skillStep");
  assert.ok(declarations.length>0);
  assert.ok(declarations.every(item=>item.part==="key"&&
    item.path?.[0]==="procedures"&&item.path?.[2]==="nodes"&&
    item.path.length===4));
  const localPhaseStep=(index.tokensByUri.get(procedure.uri)??[]).find(item=>
    item.type==="skillStep"&&item.modifiers.includes("declaration")&&
    (item.path??[]).includes("preconditions"));
  assert.ok(localPhaseStep,"fixture contains a local PRE phase-step declaration");
  assert.equal(symbols.skillSymbolAt(index,procedure.uri,localPhaseStep.range.start),null,
    "local PRE step is not mistaken for a Procedure node");
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


test("v0.2 completion uses canonical reference token context and exact Package declarations",()=>{
  const snapshot=packageSnapshot();
  const index=symbols.buildSkillSymbolIndex(snapshot);
  const procedure=snapshot.documents.find(x=>x.relativePath==="assurance/procedure.yaml");
  const contract=snapshot.documents.find(x=>x.relativePath==="assurance/contract.yaml");
  const operation="sbi.udm.sm_data.get";
  const operationOffset=offsetOf(procedure.text,operation)+4;
  const operationCompletions=symbols.skillSymbolCompletions(index,procedure.uri,operationOffset);
  assert.equal(operationCompletions.token.type,"skillOperation");
  assert.ok(operationCompletions.items.some(item=>item.name===operation));

  const schemaPath="schemas/establishment-request.schema.yaml";
  const schemaOffset=offsetOf(contract.text,schemaPath)+9;
  const schemaCompletions=symbols.skillSymbolCompletions(index,contract.uri,schemaOffset);
  assert.equal(schemaCompletions.token.type,"skillSchema");
  assert.ok(schemaCompletions.items.some(item=>item.name===schemaPath));

  const scriptPath="scripts/select_establishment_configuration.py";
  const scriptOffset=offsetOf(procedure.text,scriptPath)+9;
  const scriptCompletions=symbols.skillSymbolCompletions(index,procedure.uri,scriptOffset);
  assert.equal(scriptCompletions.token.type,"skillReference");
  assert.ok(scriptCompletions.items.some(item=>item.name===scriptPath),
    JSON.stringify({token:scriptCompletions.token,items:scriptCompletions.items,
      scriptDocuments:snapshot.documents.filter(item=>item.relativePath.startsWith("scripts/"))
        .map(item=>item.relativePath)}));
});

test("v0.2 Procedure, Predicate, node and direct-grant completions stay in their semantic scopes",()=>{
  const snapshot=packageSnapshot();
  const index=symbols.buildSkillSymbolIndex(snapshot);
  const contract=snapshot.documents.find(x=>x.relativePath==="assurance/contract.yaml");
  const procedure=snapshot.documents.find(x=>x.relativePath==="assurance/procedure.yaml");
  const entry="ue-requested-pdu-session-establishment";
  const entryItems=symbols.skillSymbolCompletions(index,contract.uri,
    offsetOf(contract.text,entry)+4);
  assert.equal(entryItems.token.type,"skillProcedure");
  assert.ok(entryItems.items.some(item=>item.name===entry));

  const predicate="createdsession.ingress.eligible";
  const predicateItems=symbols.skillSymbolCompletions(index,procedure.uri,
    offsetOf(procedure.text,predicate)+5);
  assert.equal(predicateItems.token.type,"skillPredicate");
  assert.ok(predicateItems.items.some(item=>item.name===predicate));

  const node="nudm-sdm-get";
  const nodeItems=symbols.skillSymbolCompletions(index,procedure.uri,
    offsetOf(procedure.text,node)+3);
  assert.equal(nodeItems.token.type,"skillStep");
  assert.ok(nodeItems.items.some(item=>item.name===node));
  assert.ok(nodeItems.items.every(item=>item.path?.[2]==="nodes"&&item.path.length===4),
    "node completion excludes locally scoped PRE/POST phase steps");

  const directGrant="sbi.udm.sm_data.get";
  const grantItems=symbols.skillSymbolCompletions(index,contract.uri,
    offsetOf(contract.text,directGrant)+4);
  assert.equal(grantItems.token.type,"skillCapability");
  assert.ok(grantItems.items.some(item=>item.name===directGrant));
});

test("v0.2 link diagnostics report exact unresolved and ambiguous references but not deployment Capabilities",()=>{
  const snapshot=packageSnapshot();
  const index=symbols.buildSkillSymbolIndex(snapshot);
  const diagnostics=symbols.skillSymbolLinkDiagnostics(index,snapshot);
  const contract=snapshot.documents.find(x=>x.relativePath==="assurance/contract.yaml");
  assert.ok(diagnostics.some(item=>item.uri===contract.uri&&
    item.code==="SKILL_LINK_UNRESOLVED"&&
    contract.text.slice(item.range.start,item.range.end)==="lib/host/subject.schema.yaml"));
  assert.ok(!diagnostics.some(item=>item.code==="SKILL_LINK_UNRESOLVED"&&
    /ca\.session\.operation_context\.read/.test(
      snapshot.documents.find(doc=>doc.uri===item.uri)?.text.slice(item.range.start,item.range.end)??"")),
    "unmatched allowedResources Capability IDs remain deployment-owned");

  const duplicate=document("lib/tools/another.tool.yaml",`apiVersion: connectionagent.io/v1alpha1
kind: ToolCatalog
spec:
  contracts:
    - operation: sbi.udm.sm_data.get
      effect: READ
`);
  const duplicateSnapshot=packageSnapshot([duplicate]);
  const duplicateIndex=symbols.buildSkillSymbolIndex(duplicateSnapshot);
  const duplicateDiagnostics=symbols.skillSymbolLinkDiagnostics(duplicateIndex,duplicateSnapshot);
  const procedure=duplicateSnapshot.documents.find(x=>x.relativePath==="assurance/procedure.yaml");
  const duplicateHit=at(duplicateIndex,procedure.uri,procedure.text,"sbi.udm.sm_data.get");
  assert.ok(duplicateDiagnostics.some(item=>item.uri===procedure.uri&&
    item.code==="SKILL_LINK_AMBIGUOUS"&&
    procedure.text.slice(item.range.start,item.range.end)==="sbi.udm.sm_data.get"),
    JSON.stringify({declarations:duplicateIndex.declarations.get(duplicateHit.token.key),
      references:duplicateIndex.references.get(duplicateHit.token.key),
      diagnostics:duplicateDiagnostics}));
});

test("v0.2 link diagnostics are suppressed for incomplete or stale Package snapshots",()=>{
  const snapshot=packageSnapshot();
  const index=symbols.buildSkillSymbolIndex(snapshot);
  assert.deepEqual(symbols.skillSymbolLinkDiagnostics(index,{...snapshot,completeness:"partial"}),[]);
  assert.deepEqual(symbols.skillSymbolLinkDiagnostics(index,{...snapshot,generation:2}),[]);
});
