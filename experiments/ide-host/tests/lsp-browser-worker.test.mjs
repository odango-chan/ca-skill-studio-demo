import test from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

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
      params:packageSnapshot(1,"procedures: [\\n")
    });
    worker.postMessage({
      jsonrpc:"2.0",method:"skillStudio/packageSnapshot",
      params:packageSnapshot(2,"procedures: [\\n")
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
