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

test("Theia host-local semantic token mode avoids registering a competing LSP provider",async()=>{
  const worker=new Worker(workerEntry,{workerData:{serverUrl:serverBundle}});
  try{
    worker.postMessage({jsonrpc:"2.0",id:5,method:"initialize",
      params:{processId:null,rootUri:"file:///workspace",capabilities:{},
        initializationOptions:{disableSemanticTokens:true}}});
    const initialized=await waitForMessage(worker,message=>message?.id===5);
    assert.equal(initialized.result.capabilities.semanticTokensProvider,undefined);
    assert.equal(initialized.result.capabilities.definitionProvider,true);
    assert.equal(initialized.result.capabilities.referencesProvider,true);
  }finally{
    await worker.terminate();
  }
});

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
      params:packageSnapshot(1,"start: check\nnodes:\n  check:\n    operation: [\n")
    });
    const published = await waitForMessage(worker,message=>
      message?.method==="textDocument/publishDiagnostics" &&
      message.params?.uri==="file:///workspace/skill/assurance/procedure.yaml"
    );
    assert.ok(published.params.diagnostics.length>0);

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
      params:packageSnapshot(1,"start: check\nnodes:\n  check:\n    operation: [\n")
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
      params:packageSnapshot(2,"start: check\nnodes:\n  check:\n    operation: [\n")
    });
    const latest=await waitForMessage(worker,message=>
      message?.method==="textDocument/publishDiagnostics" &&
      message.params?.uri==="file:///workspace/skill/assurance/procedure.yaml" &&
      message.params?.version===2 &&
      message.params?.diagnostics?.length>0
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
        text:readFileSync(new URL("../../../site/samples/v1alpha5/"+
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

test("semantic tokens retain the latest accepted source when Package analysis is unavailable",async()=>{
  const worker=new Worker(workerEntry,{workerData:{serverUrl:serverBundle}});
  try{
    worker.postMessage({jsonrpc:"2.0",id:201,method:"initialize",
      params:{processId:null,rootUri:"file:///workspace",capabilities:{}}});
    const initialized=await waitForMessage(worker,message=>message?.id===201);
    assert.equal(initialized.result.capabilities.semanticTokensProvider.full,true);
    worker.postMessage({jsonrpc:"2.0",method:"initialized",params:{}});

    const snapshot=samplePackageSnapshot();
    // Force the diagnostic analyzer to reject this otherwise valid source
    // snapshot. The semantic-token provider must still use the accepted bytes.
    snapshot.packageName="";
    const unavailable=waitForMessage(worker,message=>
      message?.method==="skillStudio/analysisStatus"&&
      message.params?.rootUri===snapshot.rootUri&&
      message.params?.generation===snapshot.generation&&
      message.params?.state==="UNAVAILABLE",15000);
    worker.postMessage({jsonrpc:"2.0",method:"skillStudio/packageSnapshot",params:snapshot});
    const status=await unavailable;
    assert.match(status.params.reason,/Package name is invalid/);

    const procedure=snapshot.documents.find(item=>
      item.relativePath==="assurance/procedure.yaml");
    const semantic=await lspRequest(worker,202,"textDocument/semanticTokens/full",{
      textDocument:{uri:procedure.uri}
    });
    assert.ok(Array.isArray(semantic.data)&&semantic.data.length>0,
      "analysis rejection must not evict the source snapshot used for coloring");
    assert.equal(semantic.data.length%5,0);
  }finally{
    await worker.terminate();
  }
});

test("browser LSP provides v1alpha5 Definition, References, Hover, Python symbols and Package completions",async()=>{
  const worker=new Worker(workerEntry,{workerData:{serverUrl:serverBundle}});
  try{
    worker.postMessage({jsonrpc:"2.0",id:11,method:"initialize",
      params:{processId:null,rootUri:"file:///workspace",capabilities:{}}});
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
    worker.postMessage({jsonrpc:"2.0",method:"initialized",params:{}});

    const snapshot=samplePackageSnapshot();
    const readyStatus=waitForMessage(worker,message=>
      message?.method==="skillStudio/analysisStatus"&&
      message.params?.rootUri===snapshot.rootUri&&
      message.params?.state==="PARTIAL"&&
      message.params?.procedureState==="READY",15000);
    worker.postMessage({jsonrpc:"2.0",method:"skillStudio/packageSnapshot",params:snapshot});
    const status=await readyStatus;
    assert.equal(status.params.state,"PARTIAL");

    const procedure=snapshot.documents.find(x=>x.relativePath==="assurance/procedure.yaml");
    const contract=snapshot.documents.find(x=>x.relativePath==="assurance/contract.yaml");
    const predicates=snapshot.documents.find(x=>x.relativePath==="assurance/predicates.yaml");
    const script=snapshot.documents.find(x=>x.relativePath==="scripts/validate-subscription-request.py");
    const schema=snapshot.documents.find(x=>x.relativePath==="schemas/establishment-request.schema.yaml");
    assert.ok(procedure&&contract&&predicates&&script&&schema);

    const semanticResult=await lspRequest(worker,23,"textDocument/semanticTokens/full",{
      textDocument:{uri:procedure.uri}});
    assert.ok(Array.isArray(semanticResult.data)&&semanticResult.data.length>0);
    assert.equal(semanticResult.data.length%5,0);
    const emittedTypes=new Set();
    for(let i=3;i<semanticResult.data.length;i+=5)emittedTypes.add(semanticResult.data[i]);
    assert.ok(emittedTypes.has(semanticLegend.tokenTypes.indexOf("skillOperation")));
    assert.ok(emittedTypes.has(semanticLegend.tokenTypes.indexOf("skillOperator")));
    assert.ok(emittedTypes.has(semanticLegend.tokenTypes.indexOf("skillPredicate")));
    assert.ok(emittedTypes.has(semanticLegend.tokenTypes.indexOf("skillOutcome")));

    const scriptNeedle="scripts/validate-subscription-request.py";
    const scriptDefinition=await lspRequest(worker,12,"textDocument/definition",{
      textDocument:{uri:predicates.uri},position:positionOf(predicates.text,scriptNeedle)});
    assert.equal(scriptDefinition.uri,script.uri);
    assert.ok(scriptDefinition.range.start.line>=0);

    const scriptHover=await lspRequest(worker,13,"textDocument/hover",{
      textDocument:{uri:predicates.uri},position:positionOf(predicates.text,scriptNeedle)});
    assert.match(scriptHover.contents.value,/Skill Script/);

    const references=await lspRequest(worker,14,"textDocument/references",{
      textDocument:{uri:script.uri},position:positionOf(script.text,"main("),context:{includeDeclaration:true}});
    assert.ok(references.some(item=>item.uri===predicates.uri));
    assert.ok(references.some(item=>item.uri===script.uri));

    const symbols=await lspRequest(worker,15,"textDocument/documentSymbol",{
      textDocument:{uri:script.uri}});
    assert.ok(symbols.some(item=>item.name==="main"));

    const scriptCompletion=await lspRequest(worker,16,"textDocument/completion",{
      textDocument:{uri:predicates.uri},position:positionOf(predicates.text,scriptNeedle,scriptNeedle.length)});
    assert.ok(scriptCompletion.some(item=>item.label===script.relativePath));

    const schemaPath="schemas/establishment-request.schema.yaml";
    const schemaDefinition=await lspRequest(worker,20,"textDocument/definition",{
      textDocument:{uri:contract.uri},position:positionOf(contract.text,schemaPath)});
    assert.equal(schemaDefinition.uri,schema.uri);
    assert.deepEqual(schemaDefinition.range.start,{line:0,character:0});

    const procedureSymbols=await lspRequest(worker,30,"textDocument/documentSymbol",{
      textDocument:{uri:procedure.uri}});
    assert.ok(procedureSymbols.some(item=>item.name==="get-sm-subscription-data"));
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
      params:packageSnapshot(1,"start: check\nnodes:\n  check:\n    operation: [\n",rootA)
    });
    worker.postMessage({
      jsonrpc:"2.0",method:"skillStudio/packageSnapshot",
      params:packageSnapshot(1,"start: check\nnodes:\n  check:\n    operation: [\n",rootB)
    });
    const [statusA,statusB,publishedA,publishedB]=await Promise.all([
      statusAWait,statusBWait,diagnosticAWait,diagnosticBWait
    ]);
    assert.equal(statusA.params.state,"PARTIAL");
    assert.equal(statusB.params.state,"PARTIAL");
    assert.ok(publishedA.params.diagnostics.length>0);
    assert.ok(publishedB.params.diagnostics.length>0);

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
      params:packageSnapshot(2,"start: check\nnodes:\n  check:\n    operation: [\n",rootA)
    });
    const [reopened,republishedA]=await Promise.all([
      reopenedStatusWait,republishedAWait
    ]);
    assert.equal(reopened.params.state,"PARTIAL");
    assert.ok(republishedA.params.diagnostics.length>0);
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


