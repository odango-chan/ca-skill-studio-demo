import test from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { indexV1Alpha4ToolCatalogCallables } from "../../../site/package-audit.mjs";

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

test("Theia host-local semantic token mode avoids a competing LSP provider",async()=>{
  const worker=new Worker(workerEntry,{workerData:{serverUrl:serverBundle}});
  try{
    worker.postMessage({jsonrpc:"2.0",id:5,method:"initialize",
      params:{processId:null,rootUri:"file:///workspace",capabilities:{},
        initializationOptions:{disableSemanticTokens:true}}});
    const initialized=await waitForMessage(worker,message=>message?.id===5);
    assert.equal(initialized.result.capabilities.semanticTokensProvider,undefined);
    assert.equal(initialized.result.capabilities.definitionProvider,true);
    assert.equal(initialized.result.capabilities.referencesProvider,true);
    assert.equal(initialized.result.capabilities.hoverProvider,true);
  }finally{
    await worker.terminate();
  }
});

test("older source is diagnosed by the one current grammar without a version-specific server error",async()=>{
  const worker=new Worker(workerEntry,{workerData:{serverUrl:serverBundle}});
  const rootUri="file:///workspace/persisted-old-example";
  const procedureUri=rootUri+"/assurance/procedure.yaml";
  const contractUri=rootUri+"/assurance/contract.yaml";
  try{
    worker.postMessage({jsonrpc:"2.0",id:43,method:"initialize",
      params:{processId:null,rootUri:"file:///workspace",capabilities:{}}});
    await waitForMessage(worker,message=>message?.id===43);
    worker.postMessage({jsonrpc:"2.0",method:"initialized",params:{}});
    const status=waitForMessage(worker,message=>
      message?.method==="skillStudio/analysisStatus"&&
      message.params?.rootUri===rootUri&&message.params?.generation===1);
    const procedureDiagnostics=waitForMessage(worker,message=>
      message?.method==="textDocument/publishDiagnostics"&&
      message.params?.uri===procedureUri&&
      message.params?.diagnostics?.some(item=>item.code==="SOURCE_ROOT_INVALID"));
    const contractDiagnostics=waitForMessage(worker,message=>
      message?.method==="textDocument/publishDiagnostics"&&
      message.params?.uri===contractUri&&
      message.params?.diagnostics?.some(item=>item.code==="UNKNOWN_FIELD"));
    const duplicateError=expectNoMessage(worker,message=>
      message?.method==="skillStudio/serverError"&&
      message.params?.rootUri===rootUri&&
      String(message.params?.message??"").includes("ANALYSIS_UNAVAILABLE"),300);
    worker.postMessage({jsonrpc:"2.0",method:"skillStudio/packageSnapshot",
      params:packageSnapshot(1,
        "apiVersion: connectionagent.io/v1alpha1\nprocedures: {}\n",rootUri)});
    const [result,procedure,contract]=await Promise.all([
      status,procedureDiagnostics,contractDiagnostics
    ]);
    assert.equal(result.params.state,"PARTIAL");
    assert.equal(result.params.procedureState,"UNAVAILABLE");
    assert.ok(result.params.publishedDiagnosticCount>0);
    assert.ok(procedure.params.diagnostics.some(item=>item.code==="SOURCE_ROOT_INVALID"));
    assert.ok(contract.params.diagnostics.some(item=>item.code==="UNKNOWN_FIELD"));
    const unsupportedRootKey=procedure.params.diagnostics.find(item=>
      item.code==="UNKNOWN_FIELD"&&item.message.includes("procedures")&&
      item.source==="Skill Studio · procedure-projection");
    assert.ok(unsupportedRootKey,"the current grammar must report the old root key");
    assert.deepEqual(unsupportedRootKey.range,{
      start:{line:1,character:0},end:{line:1,character:10}
    },"the LSP marker must cover the entire YAML key, not one character");
    assert.ok(result.params.analysisDiagnostics.some(item=>
      item.relativePath==="assurance/predicates.yaml"&&item.code==="UNKNOWN_FIELD"));
    assert.ok(!result.params.analysisDiagnostics.some(item=>
      item.code==="UNSUPPORTED_CA_SL_VERSION"));
    assert.equal(await duplicateError,null,
      "source defects are ordinary current-grammar diagnostics, not analysis transport failures");
  }finally{
    await worker.terminate();
  }
});

test("source semantic colors remain available when diagnostic snapshot admission is rejected",async()=>{
  const worker=new Worker(workerEntry,{workerData:{serverUrl:serverBundle}});
  const rootUri="file:///workspace/semantic-rejection";
  const source=[
    "start: check",
    "nodes:",
    "  check:",
    "    operation:",
    "      tool: ca::demo.read",
    "      routes:",
    "        SUCCEEDED: SUCCEEDED",
    ""
  ].join("\n");
  const snapshot=packageSnapshot(1,source,rootUri);
  const procedureUri=snapshot.documents[0].uri;
  // An invalid contract document version triggers the real diagnostic
  // session's INVALID_SNAPSHOT rejection *after* the exact source is admitted.
  snapshot.documents[1].version="invalid";
  try{
    worker.postMessage({jsonrpc:"2.0",id:51,method:"initialize",
      params:{processId:null,rootUri:"file:///workspace",capabilities:{}}});
    const initialized=await waitForMessage(worker,message=>message?.id===51);
    assert.equal(initialized.result.capabilities.semanticTokensProvider.full,true);
    worker.postMessage({jsonrpc:"2.0",method:"initialized",params:{}});
    const admitted=waitForMessage(worker,message=>
      message?.method==="skillStudio/packageSnapshotAccepted"&&
      message.params?.rootUri===rootUri&&message.params?.generation===1);
    const rejected=waitForMessage(worker,message=>
      message?.method==="skillStudio/serverError"&&
      message.params?.rootUri===rootUri&&
      String(message.params?.message??"").includes("INVALID_SNAPSHOT"));
    worker.postMessage({jsonrpc:"2.0",method:"skillStudio/packageSnapshot",params:snapshot});
    await Promise.all([admitted,rejected]);
    const diagnostic=await lspRequest(worker,52,"skillStudio/semanticTokenDiagnostics",
      {uri:procedureUri});
    assert.equal(diagnostic.packageFound,true,
      "rejected analysis must not delete the accepted source snapshot");
    assert.ok(diagnostic.tokenCount>0);
    const tokens=await lspRequest(worker,53,"textDocument/semanticTokens/full",
      {textDocument:{uri:procedureUri}});
    assert.ok(tokens.data.length>0,
      "source-based coloring must survive invalid diagnostic data");
    assert.equal(tokens.data.length%5,0);

    worker.postMessage({jsonrpc:"2.0",method:"skillStudio/packageClose",
      params:{rootUri}});
    const afterClose=await lspRequest(worker,54,"skillStudio/semanticTokenDiagnostics",
      {uri:procedureUri});
    assert.equal(afterClose.packageFound,false,
      "explicit Package close still revokes the source snapshot");
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
      message.params?.diagnostics?.some(item=>item.code==="YAML_PARSE_ERROR")
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
  const fixtureRoot=new URL("../../../tests/fixtures/v1alpha5-conventional/",import.meta.url);
  const manifest=JSON.parse(readFileSync(new URL("files.json",fixtureRoot),"utf8"));
  const [name]=manifest.skills;
  const rootUri="file:///workspace/"+name;
  return {
    rootUri,packageName:name,generation:1,completeness:"complete",
    documents:manifest.files.map(file=>{
      const relativePath=file.slice(name.length+1);
      const languageId=relativePath.endsWith(".py")?"python":
        relativePath.endsWith(".yaml")||relativePath.endsWith(".yml")?"yaml":
        relativePath.endsWith(".json")?"json":"plaintext";
      return {
        uri:rootUri+"/"+relativePath,relativePath,languageId,
        version:relativePath==="assurance/procedure.yaml"?1:0,
        text:readFileSync(new URL(file,fixtureRoot),"utf8")
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

test("browser LSP provides current CA-SL Definition, References, Hover, Python symbols and Package completions",async()=>{
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
      message.params?.generation===snapshot.generation&&
      message.params?.state==="READY"&&
      message.params?.procedureState==="READY",15000);
    worker.postMessage({jsonrpc:"2.0",method:"skillStudio/packageSnapshot",params:snapshot});
    const status=await readyStatus;
    assert.equal(status.params.state,"READY",JSON.stringify(status.params));
    assert.equal(status.params.procedureState,"READY");
    assert.equal(status.params.packageAuditState,"UNAVAILABLE",
      "source projection readiness must not imply Package qualification");

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


test("browser LSP preserves Dependency Alias across the published MAS ToolCatalog",async()=>{
  const worker=new Worker(workerEntry,{workerData:{serverUrl:serverBundle}});
  try{
    worker.postMessage({jsonrpc:"2.0",id:71,method:"initialize",
      params:{processId:null,rootUri:"file:///workspace",capabilities:{}}});
    await waitForMessage(worker,message=>message?.id===71);
    worker.postMessage({jsonrpc:"2.0",method:"initialized",params:{}});

    const snapshot=samplePackageSnapshot();
    const procedure=snapshot.documents.find(item=>
      item.relativePath==="assurance/procedure.yaml");
    assert.ok(procedure);
    procedure.text=procedure.text
      .replace("tool: ca::sbi.udm.sm_data.get",
        "tool: mas::SC.VALIDATE_SUBSCRIPTION")
      .replace("tool: ca::sbi.udm.sdm_subscription.create",
        "tool: mas-shadow::SC.VALIDATE_SUBSCRIPTION");
    assert.ok(procedure.text.includes("tool: mas::SC.VALIDATE_SUBSCRIPTION"));
    assert.ok(procedure.text.includes("tool: mas-shadow::SC.VALIDATE_SUBSCRIPTION"));

    // Use the actual published MAS ToolCatalog and its production projection
    // shape; a second dependency exports the same package-local Callable ID.
    const catalogText=readFileSync(
      "site/samples/v1alpha5/owner-package/tool-catalog.yaml","utf8");
    const masCatalog=indexV1Alpha4ToolCatalogCallables("mas",[
      {path:"tool-catalog.yaml",text:catalogText}
    ]);
    assert.equal(masCatalog.available,true);
    assert.ok(masCatalog.operations.some(item=>item.id==="SC.VALIDATE_SUBSCRIPTION"));
    const duplicate=masCatalog.operations.find(item=>item.id==="SC.CREATE_SM_CONTEXT");
    assert.ok(duplicate);
    snapshot.dependencyOperations=[
      ...masCatalog.operations,
      {...masCatalog.operations.find(item=>item.id==="SC.VALIDATE_SUBSCRIPTION"),
        dependencyId:"mas-shadow"},
      {...duplicate}
    ];
    const ready=waitForMessage(worker,message=>
      message?.method==="skillStudio/analysisStatus"&&
      message.params?.rootUri===snapshot.rootUri&&
      message.params?.generation===snapshot.generation&&
      message.params?.state==="READY",15000);
    worker.postMessage({jsonrpc:"2.0",method:"skillStudio/packageSnapshot",params:snapshot});
    await ready;

    const masHover=await lspRequest(worker,72,"textDocument/hover",{
      textDocument:{uri:procedure.uri},
      position:positionOf(procedure.text,"mas::SC.VALIDATE_SUBSCRIPTION")
    });
    assert.match(masHover.contents.value,/Tool Operation/);
    assert.match(masHover.contents.value,/mas::SC\.VALIDATE_SUBSCRIPTION/);
    assert.match(masHover.contents.value,/Declared in project dependency `mas`/);

    const shadowHover=await lspRequest(worker,73,"textDocument/hover",{
      textDocument:{uri:procedure.uri},
      position:positionOf(procedure.text,"mas-shadow::SC.VALIDATE_SUBSCRIPTION")
    });
    assert.match(shadowHover.contents.value,/mas-shadow::SC\.VALIDATE_SUBSCRIPTION/);
    assert.match(shadowHover.contents.value,/Declared in project dependency `mas-shadow`/);

    const allAliasCompletions=await lspRequest(worker,74,"textDocument/completion",{
      textDocument:{uri:procedure.uri},
      position:positionOf(procedure.text,"tool: mas::SC.VALIDATE_SUBSCRIPTION","tool: ".length)
    });
    assert.ok(allAliasCompletions.some(item=>item.label==="mas::SC.VALIDATE_SUBSCRIPTION"));
    assert.ok(allAliasCompletions.some(item=>item.label==="mas-shadow::SC.VALIDATE_SUBSCRIPTION"));
    assert.ok(!allAliasCompletions.some(item=>item.label==="mas::SC.CREATE_SM_CONTEXT"),
      "duplicate declarations under the same alias must fail closed");

    const narrowedCompletions=await lspRequest(worker,75,"textDocument/completion",{
      textDocument:{uri:procedure.uri},
      position:positionOf(procedure.text,"mas::SC.VALIDATE_SUBSCRIPTION","mas::SC.".length)
    });
    assert.ok(narrowedCompletions.some(item=>item.label==="mas::SC.VALIDATE_SUBSCRIPTION"));
    assert.ok(!narrowedCompletions.some(item=>item.label==="mas-shadow::SC.VALIDATE_SUBSCRIPTION"),
      "a typed Dependency Alias must narrow completion to that exact package");
  }finally{
    await worker.terminate();
  }
});

test("Package Audit Script diagnostics publish the complete YAML scalar range through LSP",async()=>{
  const worker=new Worker(workerEntry,{workerData:{serverUrl:serverBundle}});
  try{
    worker.postMessage({jsonrpc:"2.0",id:61,method:"initialize",
      params:{processId:null,rootUri:"file:///workspace",capabilities:{}}});
    await waitForMessage(worker,message=>message?.id===61);
    worker.postMessage({jsonrpc:"2.0",method:"initialized",params:{}});
    const snapshot=samplePackageSnapshot();
    const predicates=snapshot.documents.find(item=>
      item.relativePath==="assurance/predicates.yaml");
    const missing="scripts/missing-script.py";
    predicates.text=predicates.text.replace(
      "scripts/validate-subscription-request.py",missing);
    const expectedStart=positionOf(predicates.text,missing);
    const published=waitForMessage(worker,message=>
      message?.method==="textDocument/publishDiagnostics"&&
      message.params?.uri===predicates.uri&&
      message.params?.diagnostics?.some(item=>item.code==="PREDICATE_SCRIPT_NOT_FOUND"));
    worker.postMessage({jsonrpc:"2.0",method:"skillStudio/packageSnapshot",params:snapshot});
    const result=await published;
    const diagnostic=result.params.diagnostics.find(item=>
      item.code==="PREDICATE_SCRIPT_NOT_FOUND");
    assert.ok(diagnostic);
    assert.equal(diagnostic.source,"Skill Studio · package-audit");
    assert.deepEqual(diagnostic.range,{
      start:expectedStart,
      end:{line:expectedStart.line,character:expectedStart.character+missing.length}
    },"editor marker must cover the complete Script path scalar");
    assert.ok(!result.params.diagnostics.some(item=>
      item.code==="PREDICATE_SCRIPT_REF_UNDECLARED"),
      "current Script resolution is Package-relative and does not require localTools");
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


