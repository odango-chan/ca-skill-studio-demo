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

function packageSnapshot(generation, procedureText) {
  const rootUri = "file:///workspace/skill";
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
    worker.postMessage({jsonrpc:"2.0",method:"initialized",params:{}});

    const snapshot=samplePackageSnapshot();
    worker.postMessage({
      jsonrpc:"2.0",method:"skillStudio/packageSnapshot",params:snapshot
    });
    const status=await waitForMessage(worker,message=>
      message?.method==="skillStudio/analysisStatus" &&
      message.params?.rootUri===snapshot.rootUri
    );
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
