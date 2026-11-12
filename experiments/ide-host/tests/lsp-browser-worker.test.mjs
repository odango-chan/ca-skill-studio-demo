import test from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { SAMPLE_PACKAGES } from "../../../site/sample-packages.mjs";

const workerEntry = new URL("./lsp-server-worker-thread.mjs", import.meta.url);
const serverBundle = pathToFileURL(resolve(
  "experiments/ide-host/vscode/dist/skill-language-server.js"
)).href;

function waitForMessage(worker, predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.off("message", onMessage);
      reject(new Error("Timed out waiting for LSP Worker message"));
    }, timeoutMs);
    const onMessage = message => {
      if (!predicate(message)) return;
      clearTimeout(timer);
      worker.off("message", onMessage);
      resolve(message);
    };
    worker.on("message", onMessage);
    worker.once("error", error => {
      clearTimeout(timer);
      worker.off("message", onMessage);
      reject(error);
    });
  });
}

function expectNoMessage(worker,predicate,timeoutMs=200) {
  return new Promise(resolve=>{
    const cleanup=()=>{clearTimeout(timer);worker.off("message",onMessage);};
    const onMessage=message=>{if(predicate(message)){cleanup();resolve(message);}};
    const timer=setTimeout(()=>{cleanup();resolve(null);},timeoutMs);
    worker.on("message",onMessage);
  });
}

function packageSnapshot(generation, procedureText, rootUri = "file:///workspace/skill") {
  return {
    rootUri,
    packageName: "skill",
    generation,
    completeness: "complete",
    documents: [
      { uri: rootUri+"/assurance/procedure.yaml",
        relativePath:"assurance/procedure.yaml",languageId:"yaml",version:generation,text:procedureText },
      { uri: rootUri+"/assurance/contract.yaml",
        relativePath:"assurance/contract.yaml",languageId:"yaml",version:0,text:"metadata: {name: skill}\nspec: {entryProcedure: main}\n" },
      { uri: rootUri+"/assurance/predicates.yaml",
        relativePath:"assurance/predicates.yaml",languageId:"yaml",version:0,text:"metadata: {skill: skill}\npredicates: {}\n" }
    ]
  };
}

test("browser LSP Worker initializes, publishes diagnostics and clears a closed Package",async()=>{
  const worker = new Worker(workerEntry,{workerData:{serverUrl:serverBundle}});
  try {
    worker.postMessage({
      jsonrpc:"2.0",id:1,method:"initialize",
      params:{processId:null,rootUri:"file:///workspace",capabilities:{}}
    });
    const initialized = await waitForMessage(worker,message=>message?.id===1);
    assert.equal(initialized.result.serverInfo.name,"Skill Studio Language Service");
    assert.equal(initialized.result.capabilities.textDocumentSync,0);

    worker.postMessage({jsonrpc:"2.0",method:"initialized",params:{}});
    worker.postMessage({
      jsonrpc:"2.0",method:"skillStudio/packageSnapshot",
      params:packageSnapshot(1,"procedures: [\n")
    });
    const published = await waitForMessage(worker,message=>
      message?.method==="textDocument/publishDiagnostics" &&
      message.params?.uri==="file:///workspace/skill/assurance/procedure.yaml"
    );
    assert.ok(published.params.diagnostics.some(item=>item.code==="PROCEDURE_PROJECTION"));

    worker.postMessage({
      jsonrpc:"2.0",method:"skillStudio/packageInvalidate",
      params:{rootUri:"file:///workspace/skill",generation:2}
    });
    const invalidated=await waitForMessage(worker,message=>
      message?.method==="textDocument/publishDiagnostics" &&
      message.params?.uri==="file:///workspace/skill/assurance/procedure.yaml" &&
      message.params?.diagnostics?.length===0
    );
    assert.equal(invalidated.params.version,undefined);
    // A delayed old snapshot must not republish its diagnostic after invalidation.
    worker.postMessage({
      jsonrpc:"2.0",method:"skillStudio/packageSnapshot",
      params:packageSnapshot(1,"procedures: [\n")
    });
    const stalePublication=await expectNoMessage(worker,message=>
      message?.method==="textDocument/publishDiagnostics" &&
      message.params?.uri==="file:///workspace/skill/assurance/procedure.yaml" &&
      message.params?.version===1 &&
      message.params?.diagnostics?.some(item=>item.code==="PROCEDURE_PROJECTION")
    );
    assert.equal(stalePublication,null,"old generation must not republish diagnostics");
    worker.postMessage({
      jsonrpc:"2.0",method:"skillStudio/packageSnapshot",
      params:packageSnapshot(2,"procedures: [\n")
    });
    const latest=await waitForMessage(worker,message=>
      message?.method==="textDocument/publishDiagnostics" &&
      message.params?.uri==="file:///workspace/skill/assurance/procedure.yaml" &&
      message.params?.version===2 &&
      message.params?.diagnostics?.some(item=>item.code==="PROCEDURE_PROJECTION")
    );
    assert.equal(latest.params.version,2);

    worker.postMessage({
      jsonrpc:"2.0",method:"skillStudio/packageClose",
      params:{rootUri:"file:///workspace/skill"}
    });
    const cleared = await waitForMessage(worker,message=>
      message?.method==="textDocument/publishDiagnostics" &&
      message.params?.uri==="file:///workspace/skill/assurance/procedure.yaml" &&
      message.params?.diagnostics?.length===0
    );
    assert.equal(cleared.params.diagnostics.length,0);
  } finally {
    await worker.terminate();
  }
});

test("built browser Worker is isolated from Node filesystem and process transports",async()=>{
  const {readFile,stat}=await import("node:fs/promises");
  const info=await stat(resolve("experiments/ide-host/vscode/dist/skill-language-server.js"));
  assert.ok(info.size>1000);
  const bundle=await readFile(resolve("experiments/ide-host/vscode/dist/skill-language-server.js"),"utf8");
  assert.match(bundle,/skillStudio\/packageSnapshot/);
  assert.doesNotMatch(bundle,/node:fs|node:worker_threads|process\.stdin|process\.stdout/);
  const extensionBundle=await readFile(resolve("experiments/ide-host/vscode/dist/extension-theia.js"),"utf8");
  assert.match(extensionBundle,/skillStudioLanguageService/);
  assert.match(extensionBundle,/skill-language-server\.js/);
});

function samplePackageSnapshot() {
  const spec=SAMPLE_PACKAGES.establish;
  const rootUri="file:///workspace/"+spec.name;
  return {
    rootUri,packageName:spec.name,generation:1,completeness:"complete",
    documents:spec.files.map(relativePath=>{
      const languageId=relativePath.endsWith(".py")?"python":
        relativePath.endsWith(".yaml")||relativePath.endsWith(".yml")?"yaml":
        relativePath.endsWith(".json")?"json":"plaintext";
      return {
        uri:rootUri+"/"+relativePath,relativePath,languageId,
        version:relativePath==="assurance/procedure.yaml"?1:0,
        text:readFileSync(new URL("../../../site/samples/packages/"+
          spec.name+"/"+relativePath,import.meta.url),"utf8")
      };
    })
  };
}
function positionOf(text,needle,offsetInNeedle=0) {
  const start=text.indexOf(needle);
  assert.ok(start>=0,"missing source token: "+needle);
  const before=text.slice(0,start+offsetInNeedle);
  const lines=before.split(/\r\n|\n|\r/);
  return {line:lines.length-1,character:lines.at(-1).length};
}
async function lspRequest(worker,id,method,params) {
  const response=waitForMessage(worker,message=>message?.id===id);
  worker.postMessage({jsonrpc:"2.0",id,method,params});
  const result=await response;
  if(result.error)throw new Error(method+": "+JSON.stringify(result.error));
  return result.result;
}

test("browser LSP provides exact Definition, References, Hover, Python symbols and Package completions",async()=>{
  const worker=new Worker(workerEntry,{workerData:{serverUrl:serverBundle}});
  try {
    worker.postMessage({
      jsonrpc:"2.0",id:11,method:"initialize",
      params:{processId:null,rootUri:"file:///workspace",capabilities:{}}
    });
    const initialized=await waitForMessage(worker,message=>message?.id===11);
    assert.equal(initialized.result.capabilities.definitionProvider,true);
    assert.equal(initialized.result.capabilities.referencesProvider,true);
    assert.equal(initialized.result.capabilities.hoverProvider,true);
    assert.equal(initialized.result.capabilities.documentSymbolProvider,true);
    assert.equal(initialized.result.capabilities.semanticTokensProvider.full,true);
    const semanticLegend=initialized.result.capabilities.semanticTokensProvider.legend;
    assert.ok(semanticLegend.tokenTypes.includes("skillOperation"));
    assert.ok(semanticLegend.tokenTypes.includes("skillPredicate"));
    assert.ok(semanticLegend.tokenTypes.includes("skillOutcome"));
    assert.ok(semanticLegend.tokenTypes.includes("skillOperator"));
    worker.postMessage({jsonrpc:"2.0",method:"initialized",params:{}});

    const snapshot=samplePackageSnapshot();
    // Register for READY before posting the snapshot. Semantic token requests
    // below are intentionally answered early, so READY can otherwise arrive
    // while the test is still awaiting those responses.
    const readyStatus=waitForMessage(worker,message=>
      message?.method==="skillStudio/analysisStatus" &&
      message.params?.rootUri===snapshot.rootUri &&
      message.params?.state==="READY",15000
    );
    worker.postMessage({
      jsonrpc:"2.0",method:"skillStudio/packageSnapshot",params:snapshot
    });
    const procedureBeforeAnalysis=snapshot.documents.find(item=>
      item.relativePath==="assurance/procedure.yaml");
    assert.ok(procedureBeforeAnalysis);
    // Semantic-token lookup must use the accepted Source snapshot immediately;
    // it must not wait for Python indexing or Package READY diagnostics.
    const earlyTokenDiagnostics=await lspRequest(worker,93,
      "skillStudio/semanticTokenDiagnostics",{uri:procedureBeforeAnalysis.uri});
    assert.equal(earlyTokenDiagnostics.packageFound,true);
    assert.equal(earlyTokenDiagnostics.documentFound,true);
    assert.ok(earlyTokenDiagnostics.spanCount>0);
    const earlySemanticTokens=await lspRequest(worker,94,
      "textDocument/semanticTokens/full",{
        textDocument:{uri:procedureBeforeAnalysis.uri}
      });
    assert.ok(earlySemanticTokens.data.length>0,
      "semantic tokens are available before Package analysis reaches READY");
    const status=await readyStatus;
    assert.equal(status.params.state,"READY");
    // The liveness endpoint must answer on the real Worker JSON-RPC channel
    // without changing the Package analysis generation or Source.
    const health=await lspRequest(worker,91,"skillStudio/health",{});
    assert.deepEqual(health,{alive:true});
    const unchanged=await lspRequest(worker,92,"textDocument/documentSymbol",{
      textDocument:{uri:snapshot.documents.find(x=>
        x.relativePath==="scripts/select_establishment_configuration.py").uri}
    });
    assert.ok(unchanged.some(x=>x.name==="main"));

    const procedure=snapshot.documents.find(x=>x.relativePath==="assurance/procedure.yaml");
    const script=snapshot.documents.find(x=>
      x.relativePath==="scripts/select_establishment_configuration.py");
    const schema=snapshot.documents.find(x=>
      x.relativePath==="schemas/selection-input.schema.yaml");
    assert.ok(procedure&&script&&schema);

    // The native VS Code/Theia path must receive the same catalog-driven
    // semantic identities through the actual LSP Worker, not just Monaco's
    // standalone provider.
    const semanticResult=await lspRequest(worker,23,"textDocument/semanticTokens/full",{
      textDocument:{uri:procedure.uri}
    });
    assert.ok(Array.isArray(semanticResult.data)&&semanticResult.data.length>0);
    assert.equal(semanticResult.data.length%5,0);
    const emittedTypes=new Set();
    for(let i=3;i<semanticResult.data.length;i+=5)emittedTypes.add(semanticResult.data[i]);
    assert.ok(emittedTypes.has(semanticLegend.tokenTypes.indexOf("skillOperation")),
      "Procedure call values are emitted as Operation references");
    assert.ok(emittedTypes.has(semanticLegend.tokenTypes.indexOf("skillOperator")),
      "Procedure control keys are emitted as CA semantic tokens");
    assert.ok(emittedTypes.has(semanticLegend.tokenTypes.indexOf("skillPredicate")),
      "Predicate references are emitted as CA semantic tokens");
    assert.ok(emittedTypes.has(semanticLegend.tokenTypes.indexOf("skillOutcome")),
      "Outcome values are emitted as CA semantic tokens");

    const scriptNeedle="scripts/select_establishment_configuration.py";
    const definition=await lspRequest(worker,12,"textDocument/definition",{
      textDocument:{uri:procedure.uri},position:positionOf(procedure.text,scriptNeedle)
    });
    assert.equal(definition.uri,script.uri);
    assert.ok(definition.range.start.line>=0);

    const hover=await lspRequest(worker,13,"textDocument/hover",{
      textDocument:{uri:procedure.uri},position:positionOf(procedure.text,scriptNeedle)
    });
    assert.match(hover.contents.value,/Skill Script/);
    assert.match(hover.contents.value,/select-establishment-configuration/);

    const nameNeedle="# name: select-establishment-configuration";
    const references=await lspRequest(worker,14,"textDocument/references",{
      textDocument:{uri:script.uri},
      position:positionOf(script.text,nameNeedle,"# name: ".length),
      context:{includeDeclaration:true}
    });
    assert.ok(references.some(item=>item.uri===procedure.uri));
    assert.ok(references.some(item=>item.uri===script.uri));

    // Definition must work in the reverse direction too: from the Python
    // main() entrypoint back to the exact YAML caller. This is the LSP
    // primitive used by native Monaco/Theia Ctrl/Cmd-click and Peek Definition.
    // This fixture uses the legacy metadata entry symbol; the canonical
    // ca-skills form uses main() and is covered by the Theia browser probe.
    const reverseDefinition=await lspRequest(worker,24,"textDocument/definition",{
      textDocument:{uri:script.uri},
      position:positionOf(script.text,nameNeedle,"# name: ".length)
    });
    const reverseDefinitions=Array.isArray(reverseDefinition)
      ?reverseDefinition:reverseDefinition?[reverseDefinition]:[];
    assert.ok(reverseDefinitions.some(item=>item.uri===procedure.uri),
      "Python main() Definition resolves back to its Procedure caller");
    assert.ok(reverseDefinitions.every(item=>item.range?.start&&item.range?.end),
      "reverse Definition returns exact source ranges");

    const schemaNeedle="# inputSchema: EstablishmentSelectionInput";
    const schemaDefinition=await lspRequest(worker,20,"textDocument/definition",{
      textDocument:{uri:script.uri},
      position:positionOf(script.text,schemaNeedle,"# inputSchema: ".length)
    });
    assert.equal(schemaDefinition.uri,schema.uri);
    const schemaHover=await lspRequest(worker,21,"textDocument/hover",{
      textDocument:{uri:script.uri},
      position:positionOf(script.text,schemaNeedle,"# inputSchema: ".length)
    });
    assert.match(schemaHover.contents.value,/Input Schema/);
    assert.match(schemaHover.contents.value,/EstablishmentSelectionInput/);
    const schemaReferences=await lspRequest(worker,22,"textDocument/references",{
      textDocument:{uri:schema.uri},
      position:positionOf(schema.text,"EstablishmentSelectionInput"),
      context:{includeDeclaration:true}
    });
    assert.ok(schemaReferences.some(item=>item.uri===script.uri));
    assert.ok(schemaReferences.some(item=>item.uri===schema.uri));

    const symbols=await lspRequest(worker,15,"textDocument/documentSymbol",{
      textDocument:{uri:script.uri}
    });
    assert.ok(symbols.some(item=>item.name==="main"));

    const scriptCompletion=await lspRequest(worker,16,"textDocument/completion",{
      textDocument:{uri:procedure.uri},
      position:positionOf(procedure.text,scriptNeedle,scriptNeedle.length)
    });
    assert.ok(scriptCompletion.some(item=>item.label===script.relativePath));

    const schemaCompletion=await lspRequest(worker,17,"textDocument/completion",{
      textDocument:{uri:script.uri},
      position:positionOf(script.text,schemaNeedle,schemaNeedle.length)
    });
    assert.ok(schemaCompletion.some(item=>item.label==="EstablishmentSelectionInput"));
    assert.ok(schema.uri.endsWith("selection-input.schema.yaml"));

    // Exact local ranges do not override the Package completeness gate.
    worker.postMessage({
      jsonrpc:"2.0",method:"skillStudio/packageInvalidate",
      params:{rootUri:snapshot.rootUri,generation:2}
    });
    const partial={...snapshot,generation:2,completeness:"partial",
      documents:snapshot.documents.map(document=>document.relativePath==="assurance/procedure.yaml"
        ? {...document,version:2} : document)};
    worker.postMessage({
      jsonrpc:"2.0",method:"skillStudio/packageSnapshot",params:partial
    });
    const partialStatus=await waitForMessage(worker,message=>
      message?.method==="skillStudio/analysisStatus" &&
      message.params?.rootUri===snapshot.rootUri &&
      message.params?.generation===2
    );
    assert.equal(partialStatus.params.state,"PARTIAL");
    const blockedDefinition=await lspRequest(worker,18,"textDocument/definition",{
      textDocument:{uri:procedure.uri},position:positionOf(procedure.text,scriptNeedle)
    });
    assert.equal(blockedDefinition,null);
    const localSymbols=await lspRequest(worker,19,"textDocument/documentSymbol",{
      textDocument:{uri:script.uri}
    });
    assert.ok(localSymbols.some(item=>item.name==="main"),
      "same-document Python outline remains available for partial Packages");
  } finally {
    await worker.terminate();
  }
});


function currentV02PackageSnapshot(generation=1,completeness="complete"){
  const rootUri="file:///workspace/establish-pdu-session";
  const paths=[
    "assurance/contract.yaml",
    "assurance/predicates.yaml",
    "assurance/procedure.yaml",
    "schemas/establishment-request.schema.yaml",
    "scripts/select_establishment_configuration.py"
  ];
  const documents=paths.map(relativePath=>({
    uri:rootUri+"/"+relativePath,relativePath,languageId:"yaml",
    version:relativePath==="assurance/procedure.yaml"?generation:0,
    text:readFileSync(new URL("../../../site/samples/skills/establish-pdu-session/"+
      relativePath,import.meta.url),"utf8")
  }));
  documents.push({
    uri:rootUri+"/lib/tools/udm.tool.yaml",
    relativePath:"lib/tools/udm.tool.yaml",languageId:"yaml",version:0,
    text:`apiVersion: connectionagent.io/v1alpha1
kind: ToolCatalog
spec:
  contracts:
    - operation: sbi.udm.sm_data.get
      effect: READ
`
  });
  return {rootUri,packageName:"establish-pdu-session",generation,completeness,
    libraryInventory:"complete",documents};
}

test("browser LSP resolves v0.2 Contract, Procedure, Predicate and imported ToolCatalog symbols",async()=>{
  const worker=new Worker(workerEntry,{workerData:{serverUrl:serverBundle}});
  try{
    worker.postMessage({
      jsonrpc:"2.0",id:301,method:"initialize",
      params:{processId:null,rootUri:"file:///workspace",capabilities:{}}
    });
    const initialized=await waitForMessage(worker,message=>message?.id===301);
    assert.equal(initialized.result.capabilities.definitionProvider,true);
    assert.equal(initialized.result.capabilities.referencesProvider,true);
    assert.equal(initialized.result.capabilities.hoverProvider,true);
    assert.equal(initialized.result.capabilities.documentSymbolProvider,true);
    assert.equal(initialized.result.capabilities.completionProvider.resolveProvider,false);
    assert.ok(initialized.result.capabilities.completionProvider.triggerCharacters.includes("."));
    worker.postMessage({jsonrpc:"2.0",method:"initialized",params:{}});

    const snapshot=currentV02PackageSnapshot();
    const contract=snapshot.documents.find(x=>x.relativePath==="assurance/contract.yaml");
    const procedure=snapshot.documents.find(x=>x.relativePath==="assurance/procedure.yaml");
    const predicates=snapshot.documents.find(x=>x.relativePath==="assurance/predicates.yaml");
    const linkDiagnostic=waitForMessage(worker,message=>
      message?.method==="textDocument/publishDiagnostics"&&
      message.params?.uri===contract.uri&&
      message.params?.diagnostics?.some(item=>item.code==="SKILL_LINK_UNRESOLVED"),15000);
    const ready=waitForMessage(worker,message=>
      message?.method==="skillStudio/analysisStatus"&&
      message.params?.rootUri===snapshot.rootUri&&
      message.params?.generation===1,15000);
    worker.postMessage({jsonrpc:"2.0",method:"skillStudio/packageSnapshot",params:snapshot});
    const status=await ready;
    assert.equal(status.params.state,"READY",
      "v0.2 completions and link diagnostics require an accepted complete Package");

    const tools=snapshot.documents.find(x=>x.relativePath==="lib/tools/udm.tool.yaml");
    assert.ok(contract&&procedure&&predicates&&tools);

    const entryName="ue-requested-pdu-session-establishment";
    const entryDefinition=await lspRequest(worker,302,"textDocument/definition",{
      textDocument:{uri:contract.uri},position:positionOf(contract.text,entryName)
    });
    assert.equal(entryDefinition.uri,procedure.uri,
      "Contract entryProcedure resolves to the Procedure declaration");

    const schemaPath="schemas/establishment-request.schema.yaml";
    const schema=snapshot.documents.find(x=>x.relativePath===schemaPath);
    assert.ok(schema);
    const schemaDefinition=await lspRequest(worker,311,"textDocument/definition",{
      textDocument:{uri:contract.uri},position:positionOf(contract.text,schemaPath)
    });
    assert.equal(schemaDefinition.uri,schema.uri,
      "Contract requestSchema resolves to the exact Package-owned Schema file");
    assert.deepEqual(schemaDefinition.range.start,{line:0,character:0});

    const predicateName="createdsession.ingress.eligible";
    const predicateDefinition=await lspRequest(worker,303,"textDocument/definition",{
      textDocument:{uri:procedure.uri},position:positionOf(procedure.text,predicateName)
    });
    assert.equal(predicateDefinition.uri,predicates.uri,
      "Procedure applicability/verify references resolve to PredicateSet declarations");

    const nodeName="nudm-sdm-get";
    const nodeDefinition=await lspRequest(worker,304,"textDocument/definition",{
      textDocument:{uri:procedure.uri},position:positionOf(procedure.text,nodeName)
    });
    assert.equal(nodeDefinition.uri,procedure.uri,
      "Procedure start/route references resolve to the scoped node declaration");

    const operationName="sbi.udm.sm_data.get";
    const operationDefinition=await lspRequest(worker,305,"textDocument/definition",{
      textDocument:{uri:procedure.uri},position:positionOf(procedure.text,operationName)
    });
    assert.equal(operationDefinition.uri,tools.uri,
      "Operation references resolve only to an imported ToolCatalog declaration");

    const predicateHover=await lspRequest(worker,306,"textDocument/hover",{
      textDocument:{uri:procedure.uri},position:positionOf(procedure.text,predicateName)
    });
    assert.match(predicateHover.contents.value,/Predicate/);
    assert.ok(predicateHover.contents.value.includes(predicateName));

    const schemaCompletions=await lspRequest(worker,312,"textDocument/completion",{
      textDocument:{uri:contract.uri},
      position:positionOf(contract.text,schemaPath,9)
    });
    assert.ok(schemaCompletions.some(item=>item.label===schemaPath),
      "Contract Schema path completion uses Package-owned Schema files");
    const operationCompletions=await lspRequest(worker,313,"textDocument/completion",{
      textDocument:{uri:procedure.uri},
      position:positionOf(procedure.text,operationName,4)
    });
    assert.ok(operationCompletions.some(item=>item.label===operationName),
      "Procedure Operation completion uses imported ToolCatalog declarations");
    const scriptPath="scripts/select_establishment_configuration.py";
    const scriptCompletions=await lspRequest(worker,314,"textDocument/completion",{
      textDocument:{uri:procedure.uri},
      position:positionOf(procedure.text,scriptPath,9)
    });
    assert.ok(scriptCompletions.some(item=>item.label===scriptPath),
      "Procedure Script completion uses Package-local Script files");

    const unresolvedOwner=await linkDiagnostic;
    const missingOwnerPath="lib/host/subject.schema.yaml";
    const unresolvedSchema=unresolvedOwner.params.diagnostics.find(item=>
      item.code==="SKILL_LINK_UNRESOLVED"&&
      item.range?.start?.line===item.range?.end?.line&&
      contract.text.split(/\r\n|\n|\r/)[item.range.start.line]
        ?.slice(item.range.start.character,item.range.end.character)===missingOwnerPath);
    assert.ok(unresolvedSchema,
      "missing authoritative Owner Schema is published at its exact source token: "+
      JSON.stringify({diagnostics:unresolvedOwner.params.diagnostics,
        expected:missingOwnerPath,contractLine:contract.text.split(/\\r\\n|\\n|\\r/)[
          unresolvedOwner.params.diagnostics[0]?.range?.start?.line??0]}));
    const predicateReferences=await lspRequest(worker,307,"textDocument/references",{
      textDocument:{uri:predicates.uri},
      position:positionOf(predicates.text,predicateName),
      context:{includeDeclaration:true}
    });
    assert.ok(predicateReferences.some(x=>x.uri===predicates.uri));
    assert.ok(predicateReferences.some(x=>x.uri===procedure.uri));

    const procedureSymbols=await lspRequest(worker,308,"textDocument/documentSymbol",{
      textDocument:{uri:procedure.uri}
    });
    const root=procedureSymbols.find(x=>x.name===entryName);
    assert.ok(root,"Procedure declaration appears in native Outline");
    assert.ok(root.children?.some(x=>x.name===nodeName),
      "Procedure nodes appear as nested Outline symbols");
    const predicateSymbols=await lspRequest(worker,309,"textDocument/documentSymbol",{
      textDocument:{uri:predicates.uri}
    });
    assert.ok(predicateSymbols.some(x=>x.name===predicateName),
      "PredicateSet declarations appear in native Outline");

    // Even exact token positions cannot navigate across an incomplete Package.
    worker.postMessage({
      jsonrpc:"2.0",method:"skillStudio/packageInvalidate",
      params:{rootUri:snapshot.rootUri,generation:2}
    });
    const partial=currentV02PackageSnapshot(2,"partial");
    const partialReady=waitForMessage(worker,message=>
      message?.method==="skillStudio/analysisStatus"&&
      message.params?.rootUri===snapshot.rootUri&&
      message.params?.generation===2,15000);
    worker.postMessage({jsonrpc:"2.0",method:"skillStudio/packageSnapshot",params:partial});
    const partialStatus=await partialReady;
    assert.equal(partialStatus.params.state,"PARTIAL");
    const blocked=await lspRequest(worker,310,"textDocument/definition",{
      textDocument:{uri:contract.uri},position:positionOf(contract.text,entryName)
    });
    assert.equal(blocked,null);
    const partialCompletion=await lspRequest(worker,315,"textDocument/completion",{
      textDocument:{uri:contract.uri},
      position:positionOf(contract.text,"schemas/establishment-request.schema.yaml",9)
    });
    assert.deepEqual(partialCompletion,[],
      "partial Package must not offer cross-file completion candidates");
    const partialDiagnostics=await lspRequest(worker,316,"textDocument/documentSymbol",{
      textDocument:{uri:contract.uri}
    });
    assert.deepEqual(partialDiagnostics,[],
      "non-Procedure YAML documents have no fabricated Outline symbols");
  }finally{
    await worker.terminate();
  }
});

test("browser LSP isolates concurrent Package roots across close and reopen",async()=>{
  const worker=new Worker(workerEntry,{workerData:{serverUrl:serverBundle}});
  const rootA="file:///workspace/skill-a";
  const rootB="file:///workspace/skill-b";
  const procedureA=rootA+"/assurance/procedure.yaml";
  const procedureB=rootB+"/assurance/procedure.yaml";
  const diagnosticFor=(uri,version)=>message=>
    message?.method==="textDocument/publishDiagnostics"&&
    message.params?.uri===uri&&
    (version===undefined||message.params?.version===version);
  const wait=async(label,predicate,timeoutMs=5000)=>{
    try{return await waitForMessage(worker,predicate,timeoutMs);}
    catch(error){throw Error(label+": "+error.message);}
  };
  try{
    worker.postMessage({
      jsonrpc:"2.0",id:101,method:"initialize",
      params:{processId:null,rootUri:"file:///workspace",capabilities:{}}
    });
    const initialized=await wait("initialize",message=>message?.id===101);
    assert.equal(initialized.result.serverInfo.name,"Skill Studio Language Service");
    worker.postMessage({jsonrpc:"2.0",method:"initialized",params:{}});

    // Register all listeners before sending: LanguageDiagnosticSession publishes
    // document diagnostics before the matching analysisStatus notification.
    const statusAWait=wait("Package A initial status",message=>
      message?.method==="skillStudio/analysisStatus"&&
      message.params?.rootUri===rootA&&message.params?.generation===1);
    const statusBWait=wait("Package B initial status",message=>
      message?.method==="skillStudio/analysisStatus"&&
      message.params?.rootUri===rootB&&message.params?.generation===1);
    const diagnosticAWait=wait("Package A initial diagnostic",diagnosticFor(procedureA,1));
    const diagnosticBWait=wait("Package B initial diagnostic",diagnosticFor(procedureB,1));
    worker.postMessage({
      jsonrpc:"2.0",method:"skillStudio/packageSnapshot",
      params:packageSnapshot(1,"procedures: [\n",rootA)
    });
    worker.postMessage({
      jsonrpc:"2.0",method:"skillStudio/packageSnapshot",
      params:packageSnapshot(1,"procedures: [\n",rootB)
    });
    const [statusA,statusB,publishedA,publishedB]=await Promise.all([
      statusAWait,statusBWait,diagnosticAWait,diagnosticBWait
    ]);
    assert.equal(statusA.params.state,"PARTIAL");
    assert.equal(statusB.params.state,"PARTIAL");
    assert.ok(publishedA.params.diagnostics.some(item=>item.code==="PROCEDURE_PROJECTION"));
    assert.ok(publishedB.params.diagnostics.some(item=>item.code==="PROCEDURE_PROJECTION"));

    const clearAWait=wait("Package A close diagnostic clear",message=>
      diagnosticFor(procedureA)(message)&&message.params.diagnostics.length===0);
    worker.postMessage({
      jsonrpc:"2.0",method:"skillStudio/packageClose",
      params:{rootUri:rootA}
    });
    const clearedA=await clearAWait;
    assert.equal(clearedA.params.diagnostics.length,0);
    const bWasNotCleared=await expectNoMessage(worker,message=>
      diagnosticFor(procedureB)(message)&&message.params.diagnostics.length===0,250);
    assert.equal(bWasNotCleared,null,
      "closing Package A must not clear Package B diagnostics");

    const reopenedStatusWait=wait("Package A reopened status",message=>
      message?.method==="skillStudio/analysisStatus"&&
      message.params?.rootUri===rootA&&message.params?.generation===2);
    const republishedAWait=wait("Package A reopened diagnostic",diagnosticFor(procedureA,2));
    worker.postMessage({
      jsonrpc:"2.0",method:"skillStudio/packageSnapshot",
      params:packageSnapshot(2,"procedures: [\n",rootA)
    });
    const [reopened,republishedA]=await Promise.all([
      reopenedStatusWait,republishedAWait
    ]);
    assert.equal(reopened.params.state,"PARTIAL");
    assert.ok(republishedA.params.diagnostics.some(item=>
      item.code==="PROCEDURE_PROJECTION"));
    const bStillOwned=await expectNoMessage(worker,message=>
      diagnosticFor(procedureB)(message)&&message.params.diagnostics.length===0,250);
    assert.equal(bStillOwned,null,
      "reopening Package A must not invalidate Package B diagnostics");

    const clearBWait=wait("Package B close diagnostic clear",message=>
      diagnosticFor(procedureB)(message)&&message.params.diagnostics.length===0);
    worker.postMessage({
      jsonrpc:"2.0",method:"skillStudio/packageClose",
      params:{rootUri:rootB}
    });
    const clearedB=await clearBWait;
    assert.equal(clearedB.params.diagnostics.length,0);
  }finally{
    await worker.terminate();
  }
});
