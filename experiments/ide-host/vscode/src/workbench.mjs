import {openNativeSource} from "./native-source.mjs";
import {inspectionSnapshot} from './inspection.mjs';
import {auditPackageWorkspace} from '../../../../site/package-audit.mjs';
import {renderMarkdown} from '../../../../site/markdown-preview.mjs';
import {isProcedurePath,MAX_SOURCE_BYTES} from './bridge.mjs';
import {previewNodeRename,applyNodeRename} from '../../../../site/node-designer.mjs';
import {nodeAttributeState,previewNodeOperatorValue,applyNodeOperatorValue} from '../../../../site/node-attributes.mjs';
import {insertNodeOptions,previewNodeInsert,applyNodeInsert} from '../../../../site/node-create.mjs';
import {deleteNodeOptions,previewNodeDelete,applyNodeDelete} from '../../../../site/node-delete.mjs';
import {phaseStepBindingOptions,previewPhaseInputBinding,applyPhaseInputBinding} from '../../../../site/phase-bindings.mjs';
import {phaseVerifyAddOptions,phaseVerifyDeleteOptions,
  previewAddPhaseVerify,applyAddPhaseVerify,
  previewDeletePhaseVerify,applyDeletePhaseVerify}
  from '../../../../site/phase-step-structural.mjs';
import {adjacentVerifyReorderOptions,previewAdjacentVerifyReorder,
  applyAdjacentVerifyReorder} from '../../../../site/phase-step-order.mjs';
import {namedPhaseStepImpactReport,previewNamedPhaseStepRename,
  applyNamedPhaseStepRename} from '../../../../site/phase-step-rename.mjs';
import {namedVerifyEditOptions,previewNamePlainVerify,applyNamePlainVerify,
  previewDeleteUnreferencedNamedVerify,applyDeleteUnreferencedNamedVerify,
  previewSwapAdjacentNamedVerify,applySwapAdjacentNamedVerify}
  from '../../../../site/phase-named-verify.mjs';
import {buildPackageZip,bytesToBase64} from '../../../../site/package-zip-export.mjs';
import {collectPackageSnapshot,packageRootForProcedure} from "./package-snapshot.mjs";

export function registerWorkbench(vscode,context){
  let document=null,selection={},snapshot=null,bindingOptions=[],predicateSnapshot=null,
    predicateGeneration=0,audit=[],auditStatus="Package Audit · not run",generation=0,timer;
  let packageFiles=null,packageFilesUri=null,packageFilesVersion=-1;
  const providers=new Map(),sessions=new Map(),selections=new Map();
  const diagnostics=vscode.languages.createDiagnosticCollection('skill-studio');
  const languagePackages=new Map();
  const languagePackageGenerations=new Map();
  const languagePackageStatuses=new Map();
  let languageRecoveryPromise=null;
  let languageClient=null,languageClientPromise=null,languageClientFailureShown=false,
    languageStatusItem=null,languageTransportFailure=null;
  function updateLanguageStatus(state,detail){
    // A terminal Worker failure must never be overwritten by stale READY or
    // another scheduled ANALYZING refresh. Native Source editing is separate.
    if(languageTransportFailure && state!=="UNAVAILABLE" && state!=="IDLE")return;
    if(typeof Worker!=="function"||typeof globalThis.location==="undefined")return;
    if(!languageStatusItem){
      languageStatusItem=vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left,20);
      languageStatusItem.name="SKILL Studio Language Service";
      context.subscriptions.push(languageStatusItem);
    }
    languageStatusItem.text="SKILL LSP: "+state;
    languageStatusItem.tooltip=detail||"Skill Studio browser Language Service";
    languageStatusItem.command=state==="UNAVAILABLE"?
      "skillStudio.restartLanguageService":undefined;
    languageStatusItem.show();
  }

  function languagePackageContains(root,uri){
    if(!uri||uri.scheme!==root.scheme||uri.authority!==root.authority)return false;
    const base=root.path.replace(/\/$/,"");
    return uri.path.startsWith(base+"/");
  }
  async function ensureLanguageClient(){
    if(typeof Worker!=="function"||typeof globalThis.location==="undefined")return null;
    if(!languageClientPromise){
      languageClientPromise=(async()=>{
        let candidate=null;
        try{
          const {createSkillLanguageClient}=await import("../../lsp-browser/client/src/browserClient.mjs");
          candidate=createSkillLanguageClient(vscode,context,{
            onStatus:status=>{
              const state=languagePackages.get(status?.rootUri);
              // Ignore delayed notifications from an old Package generation.
              if(!state||state.disposed||status.generation!==state.generation)return;
              languagePackageStatuses.set(status.rootUri,status);
              updateLanguageStatus(
                status.state,
                status.reason||(status.state==="PARTIAL" ?
                  ("Package "+status.rootUri+" · generation "+status.generation+
                    " · Procedure "+(status.procedureState??"unknown")+
                    " ("+(status.procedureDiagnosticCount??"?")+" diagnostics)"+
                    " · Audit "+(status.packageAuditState??"unknown")+
                    (status.packageAuditReason?" · "+status.packageAuditReason:"")) :
                  ("Package "+status.rootUri+" · generation "+status.generation+
                    " · "+(status.publishedDiagnosticCount??0)+" diagnostics"))
              );
            },
            onError:error=>{
              console.warn("Skill Studio Language Service",error);
              updateLanguageStatus("ERROR",String(error?.message??error));
            },
            onFatal:error=>{
              if(languageTransportFailure)return;
              languageTransportFailure=String(error?.message??error??"Worker failed");
              updateLanguageStatus("UNAVAILABLE",languageTransportFailure);
              if(!languageClientFailureShown){
                languageClientFailureShown=true;
                void vscode.window.showWarningMessage(
                  "SKILL Studio 语言 Worker 已中断，语言功能暂不可用；YAML/Python 源码仍可继续编辑。"
                );
              }
            }
          });
          updateLanguageStatus("STARTING","Starting browser language Worker");
          await candidate.start();
          languageClient=candidate;
          updateLanguageStatus("STARTED","Browser language Worker initialized");
          return candidate;
        }catch(error){
          if(candidate)await candidate.stop().catch(()=>{});
          languageClient=null;
          languageClientPromise=null;
          throw error;
        }
      })();
    }
    return languageClientPromise;
  }
  async function refreshLanguagePackage(state,ticket,generation,strict=false){
    if(state.disposed||ticket!==state.ticket||languageTransportFailure){
      if(strict)throw Error("Package refresh was superseded or Language Worker is unavailable");
      return null;
    }
    try{
      const snapshot=await collectPackageSnapshot(
        vscode,state.procedureDocument,generation
      );
      if(state.disposed||ticket!==state.ticket){
        if(strict)throw Error("Package refresh was superseded during snapshot collection");
        return null;
      }
      const client=await ensureLanguageClient();
      if(!client||state.disposed||ticket!==state.ticket||languageTransportFailure){
        if(strict)throw Error("Package refresh lost its active Language Worker");
        return null;
      }
      state.lastSentSnapshot={
        generation:snapshot.generation,
        completeness:snapshot.completeness,
        reason:snapshot.reason??null,
        files:snapshot.documents.map(item=>({
          path:item.relativePath,version:item.version,chars:item.text.length
        })).filter(item=>item.path.startsWith("assurance/")||
          item.path.endsWith("select_establishment_configuration.py"))
      };
      updateLanguageStatus("ANALYZING","Analyzing "+snapshot.packageName+
        " · generation "+snapshot.generation);
      client.sendPackageSnapshot(snapshot);
      // Workspace import can briefly enumerate a file before its content is
      // readable. Preserve PARTIAL now, then retry with a NEW generation; never
      // label the incomplete snapshot READY or spin indefinitely on real loss.
      const transientReadFailure=snapshot.completeness==="partial"&&
        /Unable to read file/.test(snapshot.reason??"")&&
        /EntryNotFound|ENOENT: File not found/.test(snapshot.reason??"");
      if(transientReadFailure&&state.transientReadRetries<3){
        const attempt=++state.transientReadRetries;
        const delayMs=100*attempt;
        state.timer=setTimeout(()=>{
          state.timer=null;
          if(!state.disposed&&ticket===state.ticket&&!languageTransportFailure)
            scheduleLanguagePackageRefresh(state,true,true);
        },delayMs);
      }else if(snapshot.completeness==="complete"){
        state.transientReadRetries=0;
      }
      return snapshot;
    }catch(error){
      if(state.disposed||ticket!==state.ticket){
        if(strict)throw error;
        return null;
      }
      console.warn("Skill Studio Package analysis unavailable",error);
      updateLanguageStatus("ERROR",String(error?.message??error));
      if(!languageClientFailureShown){
        languageClientFailureShown=true;
        void vscode.window.showWarningMessage(
          "SKILL Studio 语言服务未能启动；现有编辑器仍可继续使用。详情见 Language Service Output。"
        );
      }
      if(strict)throw error;
      return null;
    }
  }
  function scheduleLanguagePackageRefresh(state,immediate=false,fromReadRetry=false){
    if(state.disposed)return;
    if(!fromReadRetry)state.transientReadRetries=0;
    const ticket=++state.ticket;
    const generation=++state.generation;
    languagePackageGenerations.set(state.key,generation);
    languagePackageStatuses.delete(state.key);
    clearTimeout(state.timer);
    if(languageTransportFailure)return;
    updateLanguageStatus("ANALYZING","Package "+state.key+
      " changed · generation "+generation);
    const invalidate=client=>{
      if(!state.disposed&&ticket===state.ticket)
        client?.invalidatePackage(state.key,generation);
    };
    if(languageClient)invalidate(languageClient);
    else if(languageClientPromise)
      void languageClientPromise.then(invalidate).catch(()=>{});
    if(immediate){
      void refreshLanguagePackage(state,ticket,generation);
      return;
    }
    state.timer=setTimeout(()=>{
      state.timer=null;
      void refreshLanguagePackage(state,ticket,generation);
    },120);
  }
  async function waitForLanguagePackageStatus(state,generation,timeoutMs=20000){
    const started=Date.now();
    while(Date.now()-started<timeoutMs){
      if(state.disposed||languagePackages.get(state.key)!==state)
        throw Error("Package closed while Language Worker recovery was in progress: "+state.key);
      if(languageTransportFailure)
        throw Error("Language Worker failed during recovery: "+languageTransportFailure);
      const status=languagePackageStatuses.get(state.key);
      if(status?.generation===generation){
        if(status.state==="READY"||status.state==="PARTIAL")return status;
        if(status.state==="UNAVAILABLE")
          throw Error("Package analysis unavailable after Worker recovery: "+
            (status.reason??state.key));
      }
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    throw Error("Timed out waiting for recovered Package generation "+
      generation+" at "+state.key);
  }
  async function restartLanguageService(){
    if(languageRecoveryPromise)return languageRecoveryPromise;
    if(!languageTransportFailure)
      return {recovered:false,reason:"Language Worker is not in a terminal failure state"};
    languageRecoveryPromise=(async()=>{
      const active=[...languagePackages.values()].filter(state=>
        !state.disposed&&state.refs>0);
      // A failed startup can still be settling when the user requests recovery.
      if(!languageClient&&languageClientPromise){
        try{await languageClientPromise;}catch{/* failed candidate is cleaned by ensureLanguageClient */}
      }
      const failedClient=languageClient;
      languageClient=null;
      languageClientPromise=null;
      languagePackageStatuses.clear();
      if(failedClient)await failedClient.stop().catch(error=>
        console.warn("Previous LanguageClient cleanup",error));
      languageTransportFailure=null;
      languageClientFailureShown=false;
      updateLanguageStatus("STARTING","User requested Language Worker recovery");
      const nextClient=await ensureLanguageClient();
      if(!nextClient)throw Error("Browser Language Worker is unavailable in this host");
      const targets=active.map(state=>{
        state.ticket++;
        clearTimeout(state.timer);
        state.timer=null;
        state.transientReadRetries=0;
        state.generation=Math.max(state.generation,
          languagePackageGenerations.get(state.key)??0)+1;
        languagePackageGenerations.set(state.key,state.generation);
        languagePackageStatuses.delete(state.key);
        return {state,ticket:state.ticket,generation:state.generation};
      });
      const packages=await Promise.all(targets.map(async target=>{
        const {state,ticket,generation}=target;
        const snapshot=await refreshLanguagePackage(state,ticket,generation,true);
        if(!snapshot)throw Error("No fresh snapshot was sent for "+state.key);
        const status=await waitForLanguagePackageStatus(state,generation);
        return {rootUri:state.key,generation,status:status.state,
          completeness:snapshot.completeness,
          dirtyDocuments:snapshot.documents.filter(item=>item.version>0)
            .map(item=>({path:item.relativePath,version:item.version}))};
      }));
      const partial=packages.some(item=>item.status==="PARTIAL");
      updateLanguageStatus(partial?"PARTIAL":"READY",
        "Language Worker recovered · "+packages.length+" active Package(s) rehydrated");
      return {recovered:true,packages};
    })().catch(async error=>{
      const reason=String(error?.message??error);
      if(!languageTransportFailure)updateLanguageStatus("ERROR",reason);
      console.warn("Skill Studio Language Worker recovery failed",error);
      return {recovered:false,reason};
    }).finally(()=>{
      languageRecoveryPromise=null;
    });
    return languageRecoveryPromise;
  }
  context.subscriptions.push(vscode.commands.registerCommand(
    "skillStudio.restartLanguageService",async()=>{
      const result=await restartLanguageService();
      if(result.recovered){
        void vscode.window.showInformationMessage(
          "SKILL Studio Language Worker 已恢复；活动 Package 已重新分析。"
        );
      }else{
        void vscode.window.showWarningMessage(
          "SKILL Studio Language Worker 恢复失败："+result.reason+
          "。YAML/Python 源码仍可继续编辑。"
        );
      }
      return result;
    }
  ));

  function attachLanguagePackage(doc){
    const rootInfo=packageRootForProcedure(vscode,doc);
    if(!rootInfo||typeof Worker!=="function"||typeof globalThis.location==="undefined")
      return ()=>{};
    const root=rootInfo.uri;
    const key=root.toString();
    let state=languagePackages.get(key);
    if(state){
      state.refs++;
      state.procedureDocument=doc;
      scheduleLanguagePackageRefresh(state);
    }else{
      state={
        root,key,procedureDocument:doc,refs:1,
        generation:languagePackageGenerations.get(key)??0,ticket:0,
        timer:null,disposed:false,subscriptions:[],
        lastSentSnapshot:null,transientReadRetries:0
      };
      languagePackageStatuses.delete(key);
      languagePackages.set(key,state);
      const listen=(event,handler)=>{
        if(typeof event==="function"){
          const disposable=event(handler);
          if(disposable?.dispose)state.subscriptions.push(disposable);
        }
      };
      const refreshIfInside=uri=>{
        if(languagePackageContains(root,uri))scheduleLanguagePackageRefresh(state);
      };
      listen(vscode.workspace.onDidChangeTextDocument,event=>{
        if(languagePackageContains(root,event.document.uri)){
          if(event.document.uri.toString()===doc.uri.toString())
            state.procedureDocument=event.document;
          scheduleLanguagePackageRefresh(state);
        }
      });
      listen(vscode.workspace.onDidOpenTextDocument,document=>{
        refreshIfInside(document.uri);
        if(document.uri.toString()===state.procedureDocument.uri.toString())
          state.procedureDocument=document;
      });
      listen(vscode.workspace.onDidCloseTextDocument,document=>{
        refreshIfInside(document.uri);
      });
      listen(vscode.workspace.onDidCreateFiles,event=>{
        if(event.files?.some(uri=>languagePackageContains(root,uri)))
          scheduleLanguagePackageRefresh(state);
      });
      listen(vscode.workspace.onDidDeleteFiles,event=>{
        if(event.files?.some(uri=>languagePackageContains(root,uri)))
          scheduleLanguagePackageRefresh(state);
      });
      listen(vscode.workspace.onDidRenameFiles,event=>{
        if(event.files?.some(item=>
          languagePackageContains(root,item.oldUri)||
          languagePackageContains(root,item.newUri)))
          scheduleLanguagePackageRefresh(state);
      });
      scheduleLanguagePackageRefresh(state,true);
    }
    let released=false;
    return ()=>{
      if(released)return;
      released=true;
      state.refs--;
      if(state.refs>0)return;
      state.disposed=true;
      state.ticket++;
      clearTimeout(state.timer);
      for(const subscription of state.subscriptions)subscription.dispose();
      state.subscriptions.length=0;
      languagePackages.delete(key);
      languagePackageStatuses.delete(key);
      if(languagePackages.size===0)updateLanguageStatus("IDLE","No open Procedure Package");
      const close=client=>client?.closePackage(key);
      if(languageClientPromise)void languageClientPromise.then(close).catch(()=>{});
      else close(languageClient);
    };
  }
  context.subscriptions.push({dispose(){
    for(const state of languagePackages.values()){
      state.disposed=true;state.ticket++;clearTimeout(state.timer);
      for(const subscription of state.subscriptions)subscription.dispose();
    }
    languagePackages.clear();
    languagePackageStatuses.clear();
    languagePackageGenerations.clear();
    const stop=client=>client?.stop();
    if(languageClientPromise)void languageClientPromise.then(stop).catch(()=>{});
    else void languageClient?.stop();
  }});

  // Internal, non-contributed browser acceptance probe. It opens the real
  // native Source documents before invoking VS Code's public provider commands.
  if(typeof Worker==="function"&&typeof globalThis.location!=="undefined"){
    context.subscriptions.push(vscode.commands.registerCommand(
      "skillStudio.internal.languageProviderAcceptance",
      async procedureUriValue=>{
        const procedureUri=vscode.Uri.parse(String(procedureUriValue??""));
        const procedureDocument=await vscode.workspace.openTextDocument(procedureUri);
        const procedureLines=procedureDocument.getText().split(/\r\n|\n|\r/);
        const scriptPathValue="scripts/select_establishment_configuration.py";
        const procedureLine=procedureLines.findIndex(line=>line.includes("script: "+scriptPathValue));
        if(procedureLine<0)throw Error("Procedure Source does not contain the expected declared script path");
        const procedureCharacter=procedureLines[procedureLine].indexOf(scriptPathValue)+12;
        await openNativeSource(vscode,procedureUri,{preview:true});
        await new Promise(resolve=>setTimeout(resolve,180));
        const procedurePosition=new vscode.Position(procedureLine,procedureCharacter);
        const definitionResult=await vscode.commands.executeCommand(
          "vscode.executeDefinitionProvider",procedureUri,procedurePosition);
        const definitions=Array.isArray(definitionResult)?definitionResult:
          definitionResult?[definitionResult]:[];
        const target=definitions.find(item=>item?.uri||item?.targetUri);
        if(!target)throw Error("Definition provider returned no exact script target (languageId="+
          procedureDocument.languageId+", line="+procedureLine+", position="+procedureCharacter+")");
        const scriptUri=target.uri??target.targetUri;
        const scriptPath=scriptUri.path;
        if(!scriptPath.endsWith("/"+scriptPathValue))
          throw Error("Definition resolved to an unexpected target: "+scriptPath);
        const hoverResult=await vscode.commands.executeCommand(
          "vscode.executeHoverProvider",procedureUri,procedurePosition);
        const hovers=Array.isArray(hoverResult)?hoverResult:
          hoverResult?[hoverResult]:[];
        const hoverText=hovers.flatMap(item=>
          Array.isArray(item?.contents)?item.contents:[item?.contents])
          .map(item=>typeof item==="string"?item:item?.value??String(item??""))
          .join(" ");
        if(!hoverText.includes("Skill Script")||
           !hoverText.includes("select-establishment-configuration"))
          throw Error("Hover provider did not return the declared Skill Script metadata");
        const packageRoot=packageRootForProcedure(vscode,procedureDocument);
        const packageState=packageRoot?languagePackages.get(packageRoot.uri.toString()):null;
        if(!packageState)throw Error("Active Procedure Package has no Language Service state");
        const scriptAlreadyOpen=(vscode.workspace.textDocuments??[]).some(item=>
          item.uri.toString()===scriptUri.toString());
        const generationBeforeScriptOpen=packageState.generation;
        const scriptDocument=await vscode.workspace.openTextDocument(scriptUri);
        const scriptLines=scriptDocument.getText().split(/\r\n|\n|\r/);
        const nameLine=scriptLines.findIndex(line=>line==="# name: select-establishment-configuration");
        const schemaLine=scriptLines.findIndex(line=>line==="# inputSchema: EstablishmentSelectionInput");
        if(nameLine<0||schemaLine<0)
          throw Error("Python Source is missing the declared name or inputSchema metadata");
        await openNativeSource(vscode,scriptUri,{preview:true});
        // Opening a previously closed Package Source must advance the Package
        // generation. Waiting only for READY can accidentally observe the old
        // READY status before onDidOpenTextDocument schedules the new snapshot.
        const expectedGeneration=generationBeforeScriptOpen+(scriptAlreadyOpen?0:1);
        const analysisWaitStarted=Date.now();
        const readyForCurrentGeneration=()=>packageState.generation>=expectedGeneration&&
          languageStatusItem?.text==="SKILL LSP: READY"&&
          String(languageStatusItem?.tooltip??"").includes(
            "generation "+packageState.generation);
        while(!readyForCurrentGeneration()&&Date.now()-analysisWaitStarted<15000){
          if(languageStatusItem?.text==="SKILL LSP: ERROR"||
             languageStatusItem?.text==="SKILL LSP: UNAVAILABLE")
            throw Error("Package re-analysis failed before editor-provider acceptance: "+
              String(languageStatusItem.tooltip??""));
          await new Promise(resolve=>setTimeout(resolve,50));
        }
        if(!readyForCurrentGeneration()){
          // Report the snapshot *actually sent* to the Worker for this
          // generation, not a newly collected snapshot that might now be
          // complete after an earlier transient workspace read failure.
          throw Error("Current Package generation did not reach SKILL LSP: READY: "+
            JSON.stringify({expectedGeneration,actualGeneration:packageState.generation,
              status:languageStatusItem?.text??"missing",
              tooltip:languageStatusItem?.tooltip??"",
              sentSnapshot:packageState.lastSentSnapshot??null
            }));
        }
        const referencePosition=new vscode.Position(nameLine,"# name: ".length);
        const referenceResult=await vscode.commands.executeCommand(
          "vscode.executeReferenceProvider",scriptUri,referencePosition);
        const references=Array.isArray(referenceResult)?referenceResult:[];
        if(!references.some(item=>item?.uri?.toString()===procedureUri.toString()))
          throw Error("References provider did not return the Procedure caller: "+
            JSON.stringify(references.map(item=>item?.uri?.toString?.()??null)));
        const symbolResult=await vscode.commands.executeCommand(
          "vscode.executeDocumentSymbolProvider",scriptUri);
        const symbols=Array.isArray(symbolResult)?symbolResult:[];
        if(!symbols.some(item=>item.name==="main"))
          throw Error("Python Document Symbols did not include main()");
        const schemaPosition=new vscode.Position(schemaLine,scriptLines[schemaLine].length);
        const schemaHoverResult=await vscode.commands.executeCommand(
          "vscode.executeHoverProvider",scriptUri,
          new vscode.Position(schemaLine,"# inputSchema: ".length+4));
        const schemaHoverText=(Array.isArray(schemaHoverResult)?schemaHoverResult:
          schemaHoverResult?[schemaHoverResult]:[]).flatMap(item=>
            Array.isArray(item?.contents)?item.contents:[item?.contents])
          .map(item=>typeof item==="string"?item:item?.value??String(item??""))
          .join(" ");
        const completionResult=await vscode.commands.executeCommand(
          "vscode.executeCompletionItemProvider",scriptUri,schemaPosition);
        // VS Code exposes CompletionList.items; Theia 1.76's native
        // command adapter exposes the same list as suggestions.
        const completions=Array.isArray(completionResult)?completionResult:
          completionResult?.items??completionResult?.suggestions??[];
        const labels=completions.map(item=>
          typeof item.label==="string"?item.label:item.label?.label??"");
        if(!labels.includes("EstablishmentSelectionInput"))
          throw Error("Schema Completion did not return the unique Package title: "+
            JSON.stringify({labels,completionResultType:typeof completionResult,
              completionResultKeys:completionResult&&typeof completionResult==="object"?
                Object.keys(completionResult):[],
              schemaHoverText,scriptLanguage:scriptDocument.languageId,
              schemaLineText:scriptLines[schemaLine],schemaLine,schemaPosition,
              packageGeneration:packageState.generation,
              languageStatus:languageStatusItem?.text??"missing",
              languageTooltip:languageStatusItem?.tooltip??""}));
        // The native provider probe opened a Python editor. Restore the
        // Procedure CustomEditor so subsequent workbench actions (notably
        // native Undo) continue to target the visual editor under test.
        await vscode.commands.executeCommand("skillStudio.openProcedure",procedureUri);
        return {
          definition:scriptPath,
          hover:hovers.length,
          references:references.length,
          symbols:symbols.map(item=>item.name),
          schemaCompletion:"EstablishmentSelectionInput",
          procedureLanguage:procedureDocument.languageId,
          scriptLanguage:scriptDocument.languageId,
          procedureLine,
          nameLine,
          schemaLine
        };
      }
    ));
  }

  // Internal browser acceptance for the native Problems lifecycle. The
  // edit is temporary, Source-owned by TextDocument/WorkspaceEdit, and split
  // into publish/repair phases so Chromium can inspect the actual Problems UI.
  const languageDiagnosticAcceptance=new Map();
  if(typeof Worker==="function"&&typeof globalThis.location!=="undefined"){
    context.subscriptions.push(vscode.commands.registerCommand(
      "skillStudio.internal.languageDiagnosticsAcceptance",
      async(procedureUriValue,phase="publish")=>{
        const procedureUri=vscode.Uri.parse(String(procedureUriValue??""));
        const key=procedureUri.toString();
        const currentDocument=()=>(
          (vscode.workspace.textDocuments??[]).find(item=>
            item.uri.toString()===key)??null
        );
        const lspProcedureDiagnostics=items=>items.filter(item=>
          String(item.code?.value??item.code??"")==="PROCEDURE_PROJECTION"&&
          item.source==="Skill Studio · procedure-projection");
        const waitForGeneration=async(state,afterGeneration,expectedState,predicate,label)=>{
          const started=Date.now();
          let last=null;
          while(Date.now()-started<15000){
            const generation=state.packageState.generation;
            const status=languageStatusItem?.text??"";
            const tooltip=String(languageStatusItem?.tooltip??"");
            const diagnostics=vscode.languages.getDiagnostics(procedureUri);
            last={generation,status,tooltip,
              procedureDiagnostics:lspProcedureDiagnostics(diagnostics).length,
              allDiagnostics:diagnostics.length};
            const currentGenerationReady=generation>afterGeneration&&
              status==="SKILL LSP: "+expectedState&&
              tooltip.includes("generation "+generation);
            if(currentGenerationReady&&predicate(diagnostics))
              return {generation,diagnostics};
            if(status==="SKILL LSP: ERROR"||status==="SKILL LSP: UNAVAILABLE")
              throw Error(label+" failed: "+tooltip);
            await new Promise(resolve=>setTimeout(resolve,50));
          }
          throw Error(label+" timed out waiting for current Package generation: "+
            JSON.stringify(last));
        };
        const replaceSource=async(state,nextText)=>{
          const current=currentDocument();
          if(!current)throw Error("Procedure TextDocument is not open");
          const edit=new vscode.WorkspaceEdit();
          edit.replace(procedureUri,new vscode.Range(
            current.positionAt(0),current.positionAt(current.getText().length)),nextText);
          if(!await vscode.workspace.applyEdit(edit))
            throw Error("Host rejected temporary Procedure diagnostic WorkspaceEdit");
        };

        if(phase==="publish"){
          if(languageDiagnosticAcceptance.has(key))
            throw Error("A live diagnostic acceptance is already active for this Procedure");
          const initialDocument=await vscode.workspace.openTextDocument(procedureUri);
          const persistedInitial=new TextDecoder("utf-8",{fatal:true}).decode(
            await vscode.workspace.fs.readFile(procedureUri));
          if(initialDocument.isDirty||persistedInitial!==initialDocument.getText())
            throw Error("L2-D2 requires a clean Procedure Source baseline");
          const packageRoot=packageRootForProcedure(vscode,initialDocument);
          const packageState=packageRoot?languagePackages.get(packageRoot.uri.toString()):null;
          if(!packageState)throw Error("Procedure Package has no active Language Service state");
          const state={
            original:initialDocument.getText(),
            malformed:"procedures: ["+String.fromCharCode(10),
            packageState,
            temporarySourceApplied:false
          };
          languageDiagnosticAcceptance.set(key,state);
          try{
            const beforeInvalidEdit=packageState.generation;
            await replaceSource(state,state.malformed);
            state.temporarySourceApplied=true;
            const invalid=await waitForGeneration(state,beforeInvalidEdit,"PARTIAL",
              diagnostics=>lspProcedureDiagnostics(diagnostics).length===1,
              "Live Procedure diagnostic publication");
            const procedureDiagnostics=lspProcedureDiagnostics(invalid.diagnostics);
            if(invalid.diagnostics.some(item=>
              item.source==="Skill Studio · package-audit"||
              String(item.code?.value??item.code??"")==="PACKAGE_AUDIT_UNAVAILABLE"))
              throw Error("LSP duplicated Package Audit diagnostics in the native Problems collection");
            const message=procedureDiagnostics[0].message;
            if(!message.includes("YAML 解析失败"))
              throw Error("Native Procedure diagnostic did not identify the malformed YAML: "+message);
            return {
              phase:"publish",appeared:true,code:"PROCEDURE_PROJECTION",
              source:"Skill Studio · procedure-projection",message,
              generation:invalid.generation,packageAuditDuplicates:0
            };
          }catch(error){
            try{
              if(state.temporarySourceApplied){
                const beforeRestore=packageState.generation;
                await replaceSource(state,state.original);
                state.temporarySourceApplied=false;
                await waitForGeneration(state,beforeRestore,"READY",
                  diagnostics=>lspProcedureDiagnostics(diagnostics).length===0,
                  "Emergency Procedure Source restoration");
              }
            }finally{
              languageDiagnosticAcceptance.delete(key);
            }
            throw error;
          }
        }

        if(phase==="repair"){
          const state=languageDiagnosticAcceptance.get(key);
          if(!state)return {phase:"repair",cleared:true,restored:true,skipped:true};
          try{
            const beforeRepair=state.packageState.generation;
            if(currentDocument()?.getText()!==state.original){
              await replaceSource(state,state.original);
              state.temporarySourceApplied=false;
            }
            const repaired=await waitForGeneration(state,beforeRepair,"READY",
              diagnostics=>lspProcedureDiagnostics(diagnostics).length===0,
              "Live Procedure diagnostic clear after repair");
            const restoredDocument=currentDocument();
            if(restoredDocument?.getText()!==state.original)
              throw Error("Procedure Source was not restored byte-for-byte after diagnostic acceptance");
            // Theia can retain a dirty editor backup after a second WorkspaceEdit;
            // opening another native editor then reloading may resurrect stale
            // malformed YAML. Clean ONLY the original restored text, never the
            // diagnostic test mutation, before another editor takes focus.
            const diskBeforeClean=new TextDecoder("utf-8",{fatal:true}).decode(
              await vscode.workspace.fs.readFile(procedureUri));
            const cleanupSaved=restoredDocument.isDirty||diskBeforeClean!==state.original;
            if(cleanupSaved&&!await restoredDocument.save())
              throw Error("Native Procedure cleanup save was rejected");
            const diskAfterClean=new TextDecoder("utf-8",{fatal:true}).decode(
              await vscode.workspace.fs.readFile(procedureUri));
            if(restoredDocument.isDirty||diskAfterClean!==state.original)
              throw Error("Native Procedure persisted Source/dirty state was not restored");
            return {
              phase:"repair",cleared:true,restored:true,
              generation:repaired.generation,packageAuditDuplicates:0,
              originalDiskRestored:true,cleanupSaved,
              persistedDriftObserved:diskBeforeClean!==state.original
            };
          }finally{
            languageDiagnosticAcceptance.delete(key);
            await vscode.commands.executeCommand("skillStudio.openProcedure",procedureUri);
          }
        }
        throw Error("Unknown live diagnostic acceptance phase: "+String(phase));
      }
    ));
  }


  // L2-D3 real-Theia acceptance: authoritative dirty buffers and latest
  // cross-file generation. Test-only commands never authorize Runtime writes.
  if(typeof Worker==="function"&&typeof globalThis.location!=="undefined"){
    context.subscriptions.push(vscode.commands.registerCommand(
      "skillStudio.internal.languageUnsavedAcceptance",
      async procedureUriValue=>{
        const procedureUri=vscode.Uri.parse(String(procedureUriValue??""));
        const procedure=await vscode.workspace.openTextDocument(procedureUri);
        const root=packageRootForProcedure(vscode,procedure);
        const state=root?languagePackages.get(root.uri.toString()):null;
        if(!state)throw Error("L2-D3: active Package state missing");
        const paths=[
          ["contract","assurance/contract.yaml"],
          ["predicates","assurance/predicates.yaml"],
          ["python","scripts/select_establishment_configuration.py"]
        ];
        const entries=[];
        const disk=async uri=>new TextDecoder("utf-8",{fatal:true}).decode(
          await vscode.workspace.fs.readFile(uri));
        const replace=async(doc,value)=>{
          if(doc.getText()===value)return;
          const edit=new vscode.WorkspaceEdit();
          edit.replace(doc.uri,new vscode.Range(doc.positionAt(0),
            doc.positionAt(doc.getText().length)),value);
          if(!await vscode.workspace.applyEdit(edit))
            throw Error("L2-D3: rejected native WorkspaceEdit for "+doc.uri);
        };
        const ready=async(before,phase)=>{
          const start=Date.now();
          while(Date.now()-start<18000){
            const generation=state.generation;
            const status=languageStatusItem?.text??"";
            const tooltip=String(languageStatusItem?.tooltip??"");
            if(generation>before&&status==="SKILL LSP: READY"&&
               tooltip.includes("generation "+generation))return generation;
            if(status==="SKILL LSP: ERROR"||status==="SKILL LSP: UNAVAILABLE")
              throw Error("L2-D3 "+phase+" failed: "+tooltip);
            await new Promise(resolve=>setTimeout(resolve,50));
          }
          throw Error("L2-D3 "+phase+" stale or unready generation "+state.generation+
            " / "+languageStatusItem?.text);
        };
        const getHover=async()=>{
          const lines=procedure.getText().split(/\r\n|\n|\r/);
          const target="scripts/select_establishment_configuration.py";
          const line=lines.findIndex(x=>x.includes("script: "+target));
          if(line<0)throw Error("L2-D3: missing Procedure script declaration");
          const char=lines[line].indexOf(target)+12;
          const result=await vscode.commands.executeCommand(
            "vscode.executeHoverProvider",procedureUri,new vscode.Position(line,char));
          return (Array.isArray(result)?result:result?[result]:[])
            .flatMap(x=>Array.isArray(x?.contents)?x.contents:[x?.contents])
            .map(x=>typeof x==="string"?x:x?.value??String(x??"")).join(" ");
        };
        let evidence=null;
        try{
          for(const [name,path] of paths){
            const uri=vscode.Uri.joinPath(root.uri,...path.split("/"));
            const doc=await vscode.workspace.openTextDocument(uri);
            await openNativeSource(vscode,uri,{preview:true});
            const original=doc.getText();
            if(doc.isDirty||await disk(uri)!==original)
              throw Error("L2-D3: initial "+name+" Source is not clean");
            entries.push({name,path,uri,doc,original});
          }
          const before=state.generation;
          const [contract,predicates,python]=entries;
          const old="# name: select-establishment-configuration";
          const first="# name: select-establishment-configuration-l2d3-first";
          const latest="# name: select-establishment-configuration-l2d3-latest";
          if(!python.original.includes(old))throw Error("L2-D3: script metadata missing");
          await replace(contract.doc,contract.original+"\n# l2d3 unsaved contract probe\n");
          await replace(predicates.doc,predicates.original+"\n# l2d3 unsaved predicate probe\n");
          await replace(python.doc,python.original.replace(old,first));
          await replace(python.doc,python.original.replace(old,latest));
          const generation=await ready(before,"cross-file edits");
          const snapshot=await collectPackageSnapshot(vscode,procedure,generation);
          if(snapshot.completeness!=="complete")
            throw Error("L2-D3: incomplete Package snapshot "+snapshot.reason);
          const covered=[];
          for(const entry of entries){
            const match=snapshot.documents.find(x=>x.relativePath===entry.path);
            if(!entry.doc.isDirty||!match||match.text!==entry.doc.getText()||
               match.version!==entry.doc.version||await disk(entry.uri)!==entry.original)
              throw Error("L2-D3: dirty "+entry.name+" was lost or persisted");
            covered.push({name:entry.name,version:match.version,dirty:true});
          }
          const hover=await getHover();
          if(!hover.includes("-l2d3-latest")||hover.includes("-l2d3-first"))
            throw Error("L2-D3: stale native Hover after rapid Python edit: "+
              hover.slice(0,400));
          evidence={generationBefore:before,generationLatest:generation,covered,
            latestPythonHover:true,originalDiskUnchanged:true};
        }finally{
          const beforeRestore=state.generation,problems=[];
          for(const entry of entries){
            try{await replace(entry.doc,entry.original);}
            catch(error){problems.push(entry.name+": "+String(error?.message??error));}
          }
          if(entries.length===paths.length&&!problems.length){
            try{
              await ready(beforeRestore,"restore");
              for(const entry of entries){
                if(entry.doc.getText()!==entry.original||
                   await disk(entry.uri)!==entry.original)
                  problems.push("restore mismatch: "+entry.name);
              }
              if(evidence){
                const hover=await getHover();
                if(hover.includes("-l2d3-")||
                   !hover.includes("select-establishment-configuration"))
                  problems.push("native Hover retained stale Python name");
              }
            }catch(error){problems.push(String(error?.message??error));}
          }
          // Returning in-memory text to the original bytes is not enough in
          // Theia: a dirty backup can resurrect an older invalid edit on reload.
          // Save ONLY restored bytes identical to disk, never transient content.
          // The Procedure may already be dirty from the earlier L2-D2 probe.
          const cleanup=[...entries,{name:"procedure",uri:procedureUri,doc:procedure}];
          for(const entry of cleanup){
            try{
              const persisted=await disk(entry.uri);
              if(entry.doc.getText()!==persisted)
                throw Error("restored buffer differs from original disk Source: "+
                  JSON.stringify({name:entry.name,dirty:entry.doc.isDirty,
                    bufferLength:entry.doc.getText().length,diskLength:persisted.length,
                    bufferHead:entry.doc.getText().slice(0,72),
                    diskHead:persisted.slice(0,72)}));
              if(entry.doc.isDirty&&!await entry.doc.save())
                throw Error("native TextDocument cleanup save rejected");
              if(entry.doc.isDirty||await disk(entry.uri)!==persisted)
                throw Error("clean Source state was not restored");
            }catch(error){problems.push("clean "+entry.name+": "+String(error?.message??error));}
          }
          try{await vscode.commands.executeCommand("skillStudio.openProcedure",procedureUri);}
          catch(error){problems.push("Procedure focus: "+String(error?.message??error));}
          if(problems.length)throw Error("L2-D3 cleanup: "+problems.join("; "));
        }
        return {...evidence,restored:true};
      }
    ));
  }


  // Local Chromium acceptance only: terminate the exact browser LanguageClient's
  // owned dedicated Worker. The termination does not set UNAVAILABLE itself;
  // real transport signals or the health timeout must detect it.
  if(typeof Worker==="function"&&typeof globalThis.location!=="undefined"&&
     /^(localhost|127(?:\.\d{1,3}){3})$/.test(globalThis.location.hostname)){
    context.subscriptions.push(vscode.commands.registerCommand(
      "skillStudio.internal.languageWorkerTerminationAcceptance",async()=>{
        const client=await ensureLanguageClient();
        return client?.terminateWorkerForAcceptance();
      }
    ));
  }

  // L2-D4 real Chromium fault acceptance: after the browser closes the actual
  // language Worker target, native TextDocument/WorkspaceEdit must still work.
  // This command never terminates a Worker or fabricates a transport failure.
  if(typeof Worker==="function"&&typeof globalThis.location!=="undefined"&&
     /^(localhost|127(?:\.\d{1,3}){3})$/.test(globalThis.location.hostname)){
    context.subscriptions.push(vscode.commands.registerCommand(
      "skillStudio.internal.languageDegradedEditingAcceptance",
      async procedureUriValue=>{
        if(!languageTransportFailure||
           languageStatusItem?.text!=="SKILL LSP: UNAVAILABLE")
          throw Error("L2-D4: terminal browser Worker failure was not observed");
        const procedureUri=vscode.Uri.parse(String(procedureUriValue??""));
        const proc=await vscode.workspace.openTextDocument(procedureUri);
        const root=packageRootForProcedure(vscode,proc);
        if(!root)throw Error("L2-D4: active Procedure Package missing");
        const uri=vscode.Uri.joinPath(root.uri,"scripts",
          "select_establishment_configuration.py");
        const doc=await vscode.workspace.openTextDocument(uri);
        const original=doc.getText();
        const disk=()=>vscode.workspace.fs.readFile(uri).then(bytes=>
          new TextDecoder("utf-8",{fatal:true}).decode(bytes));
        if(doc.isDirty||await disk()!==original)
          throw Error("L2-D4: native Python editor baseline is not clean");
        const edit=async value=>{
          const transaction=new vscode.WorkspaceEdit();
          transaction.replace(uri,new vscode.Range(doc.positionAt(0),
            doc.positionAt(doc.getText().length)),value);
          if(!await vscode.workspace.applyEdit(transaction))
            throw Error("L2-D4: native Source WorkspaceEdit was rejected");
        };
        let edited=false;
        try{
          await openNativeSource(vscode,uri,{preview:true});
          await edit(original+"\n# l2-d4 native editor survives Worker failure\n");
          if(!doc.isDirty||!doc.getText().includes("l2-d4 native editor")||
             await disk()!==original)
            throw Error("L2-D4: native unsaved Python editing failed after Worker exit");
          edited=true;
        }finally{
          const cleanup=[];
          try{
            await edit(original);
            if(doc.getText()!==original||await disk()!==original)
              throw Error("restoration did not recover original Python Source");
            if(doc.isDirty&&!await doc.save())
              throw Error("native clean-buffer save rejected");
            if(doc.isDirty||await disk()!==original)
              throw Error("Python Source remained dirty after restoration");
          }catch(error){cleanup.push(String(error?.message??error));}
          try{await vscode.commands.executeCommand("skillStudio.openProcedure",procedureUri);}
          catch(error){cleanup.push("Procedure focus: "+String(error?.message??error));}
          if(cleanup.length)throw Error("L2-D4 cleanup failed: "+cleanup.join("; "));
        }
        return {workerUnavailable:true,nativePythonEditing:edited,
          originalDiskUnchanged:true,restored:true,
          status:languageStatusItem?.text,
          failureReason:languageTransportFailure};
      }
    ));
  }

  function currentNode(item){
    if(!document||!isProcedurePath(document.uri.path))throw Error("No active Procedure Source");
    const doc=document,source=doc.getText(),version=doc.version;
    const procedureId=item?.procedureId??selection.procedureId;
    const nodeId=item?.nodeId??selection.nodeId;
    if(item?.documentUri&&item.documentUri!==doc.uri.toString())
      throw Error("Inspector selection belongs to another Source document");
    if(Number.isSafeInteger(item?.sourceVersion)&&item.sourceVersion!==version)
      throw Error("Inspector selection is stale; select the Node again");
    if(typeof procedureId!=="string"||typeof nodeId!=="string")
      throw Error("Select a Node in the graph or Inspector first");
    const projected=inspectionSnapshot(source,{procedureId,nodeId});
    const procedure=projected.model.procedures.get(procedureId);
    if(projected.model.state!=="READY"||!procedure?.nodes.some(n=>n.id===nodeId))
      throw Error("Selected Node is not present in the current Source");
    return {doc,source,version,procedureId,nodeId};
  }
  async function predicateContext(doc){
    const suffix="assurance/procedure.yaml";
    if(!doc.uri.path.endsWith(suffix))return {predicateSource:null,skillName:null};
    const base=doc.uri.path.slice(0,-suffix.length);
    const skillName=base.replace(/\/$/,"").split("/").at(-1)||null;
    const uri=doc.uri.with({path:base+"assurance/predicates.yaml"});
    const opened=vscode.workspace.textDocuments?.find(x=>x.uri.toString()===uri.toString());
    try{
      const predicateSource=opened?opened.getText():
        new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
      return {predicateSource,skillName};
    }catch{return {predicateSource:null,skillName};}
  }
  async function refreshPredicateSnapshot(doc){
    const version=doc.version,uri=doc.uri.toString(),ticket=++predicateGeneration;
    const next=await predicateContext(doc);
    if(document!==doc||doc.version!==version||ticket!==predicateGeneration)return;
    predicateSnapshot={uri,version,...next};
    fire();
  }
  function singleSourceChange(preview){
    const {start,end}=preview.sourceSpan;
    const delta=preview.candidateSource.length-preview.baseSource.length;
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||
       start<0||end<start||end>preview.baseSource.length||
       end+delta<start||end+delta>preview.candidateSource.length)
      throw Error("Phase Patch Source span is invalid");
    return [{start,end,
      oldValue:preview.baseSource.slice(start,end),
      newValue:preview.candidateSource.slice(start,end+delta)}];
  }
  async function confirmAndApply({doc,source,version,preview,changes,verify}){
    const message=[preview.summary,preview.diff].filter(Boolean).join("\n\n");
    const choice=await vscode.window.showInformationMessage(
      message||"确认修改当前 Source",
      {modal:true},
      "确认并应用"
    );
    if(choice!=="确认并应用")return false;
    if(document!==doc||doc.version!==version||doc.getText()!==source)
      throw Error("Source changed after Preview; the edit was discarded");
    const candidate=await verify(doc.getText());
    if(candidate!==preview.candidateSource)
      throw Error("Revalidated Patch does not match the reviewed Preview");
    if(document!==doc||doc.version!==version||doc.getText()!==source)
      throw Error("Source changed during Patch revalidation");
    const edit=new vscode.WorkspaceEdit();
    const spans=changes(preview);
    if(!spans.length)throw Error("Patch has no qualified Source spans");
    for(const span of spans){
      const insertion=span.start===span.end&&span.oldValue===""&&
        typeof span.newValue==="string"&&span.newValue.length>0;
      if(!Number.isSafeInteger(span.start)||!Number.isSafeInteger(span.end)||
         span.start<0||span.end<span.start||span.end>source.length||
         (span.end===span.start&&!insertion)||
         typeof span.oldValue!=="string"||typeof span.newValue!=="string"||
         source.slice(span.start,span.end)!==span.oldValue)
        throw Error("Patch Source span no longer matches the current document");
      edit.replace(doc.uri,new vscode.Range(
        doc.positionAt(span.start),doc.positionAt(span.end)),span.newValue);
    }
    const applied=await vscode.workspace.applyEdit(edit);
    if(!applied)throw Error("Host rejected WorkspaceEdit");
    return true;
  }

  async function editPhaseInputBinding(item,bindingKey,newValue){
    if(item?.kind!=="phase-step"||typeof item.phaseName!=="string"||
       !Number.isSafeInteger(item.stepIndex))
      throw Error("Select an eligible Phase Step in the native Inspector");
    const ctx=currentNode(item);
    const options=phaseStepBindingOptions(ctx.source,ctx.procedureId,ctx.nodeId)
      .filter(x=>x.phaseName===item.phaseName&&x.stepIndex===item.stepIndex);
    if(!options.length)throw Error("This Phase Step has no qualified same-type input bindings");
    let key=bindingKey;
    if(typeof key!=="string"){
      const picked=await vscode.window.showQuickPick(options.map(x=>({
        label:x.bindingKey,description:x.value,detail:x.inputType+" · "+x.stepName
      })),{placeHolder:"选择要修改的 Phase Step 输入绑定"});
      key=picked?.label??picked;
    }
    const binding=options.find(x=>x.bindingKey===key);
    if(!binding)throw Error("Selected binding is not part of the current Phase Step");
    let value=newValue;
    if(typeof value!=="string"){
      value=await vscode.window.showQuickPick(binding.choices.filter(x=>x!==binding.value),{
        placeHolder:"选择同类型的 Procedure 输入来源"
      });
    }
    if(typeof value!=="string"||!value.trim())return false;
    if(ctx.doc.version!==ctx.version||ctx.doc.getText()!==ctx.source)
      throw Error("Source changed while choosing the Phase binding");
    const preview=previewPhaseInputBinding(ctx.source,ctx.procedureId,ctx.nodeId,
      item.phaseName,item.stepIndex,key,value);
    return confirmAndApply({
      ...ctx,preview,
      changes:p=>[{
        start:p.sourceSpan.start,end:p.sourceSpan.end,
        oldValue:p.oldValue,newValue:p.newValue
      }],
      verify:text=>applyPhaseInputBinding(text,preview)
    });
  }

  async function addPhaseVerify(item,predicate){
    if(item?.kind!=="phase"||typeof item.phaseName!=="string")
      throw Error("Select an eligible Phase in the native Inspector");
    const ctx=currentNode(item);
    const predicates=await predicateContext(ctx.doc);
    const options=phaseVerifyAddOptions(ctx.source,ctx.procedureId,ctx.nodeId,
      predicates.predicateSource,predicates.skillName);
    const phase=options.find(x=>x.phaseName===item.phaseName);
    if(!phase){
      // Diagnostic-only: preserve the structural editer's fail-closed decision
      // while reporting which source/predicate precondition disqualified it.
      let detail="unknown";
      try{
        previewAddPhaseVerify(ctx.source,ctx.procedureId,ctx.nodeId,
          item.phaseName,typeof predicate==="string"?predicate:"createdsession.n4.initial_resources_ready",
          predicates.predicateSource,predicates.skillName);
        detail="unexpected preview eligible";
      }catch(error){detail=String(error?.message??error);}
      console.warn("STUDIO_PHASE_VERIFY_INELIGIBLE",JSON.stringify({
        documentVersion:ctx.doc.version,isDirty:ctx.doc.isDirty,
        sourceBytes:ctx.source.length,
        predicateBytes:predicates.predicateSource?.length??null,
        skillName:predicates.skillName,phase:item.phaseName,
        procedureId:ctx.procedureId,nodeId:ctx.nodeId,detail
      }));
      throw Error("Selected Phase has no safe Verify append anchor or available PredicateSet entry");
    }
    let value=predicate;
    if(typeof value!=="string"){
      const picked=await vscode.window.showQuickPick(phase.choices,{
        placeHolder:"选择要追加到 Phase 末尾的 Package Predicate"
      });
      value=typeof picked==="string"?picked:picked?.value??picked?.label;
    }
    if(typeof value!=="string"||!value.trim())return false;
    if(ctx.doc.version!==ctx.version||ctx.doc.getText()!==ctx.source)
      throw Error("Source changed while choosing the new Verify Step");
    const preview=previewAddPhaseVerify(ctx.source,ctx.procedureId,ctx.nodeId,
      item.phaseName,value,predicates.predicateSource,predicates.skillName);
    const applied=await confirmAndApply({
      ...ctx,preview,changes:singleSourceChange,
      verify:text=>applyAddPhaseVerify(text,preview,predicates.predicateSource)
    });
    if(applied)update(ctx.doc);
    return applied;
  }

  async function editPhaseVerifyStep(item,requestedAction){
    if(item?.kind!=="phase-step"||item.stepOperator!=="verify"||
       typeof item.phaseName!=="string"||!Number.isSafeInteger(item.stepIndex))
      throw Error("Select an eligible Verify Step in the native Inspector");
    const ctx=currentNode(item);
    const deletions=phaseVerifyDeleteOptions(ctx.source,ctx.procedureId,ctx.nodeId);
    const reorder=adjacentVerifyReorderOptions(ctx.source,ctx.procedureId,ctx.nodeId);
    const named=namedVerifyEditOptions(ctx.source,ctx.procedureId,ctx.nodeId);
    const at=(rows,index)=>rows.some(x=>x.phaseName===item.phaseName&&x.stepIndex===index);
    const canName=!item.stepName&&at(named.names,item.stepIndex);
    const canDelete=at(deletions,item.stepIndex);
    const canMoveUp=at(reorder,item.stepIndex-1);
    const canMoveDown=at(reorder,item.stepIndex);
    const canDeleteNamed=Boolean(item.stepName)&&at(named.deletions,item.stepIndex);
    const canMoveUpNamed=Boolean(item.stepName)&&at(named.swaps,item.stepIndex-1);
    const canMoveDownNamed=Boolean(item.stepName)&&at(named.swaps,item.stepIndex);
    const choices=[
      ...(canName?[{label:"Name Verify Step",value:"name"}]:[]),
      ...(canMoveUp||canMoveUpNamed?[{label:"Move Verify Up",value:"move-up"}]:[]),
      ...(canMoveDown||canMoveDownNamed?[{label:"Move Verify Down",value:"move-down"}]:[]),
      ...(canDelete||canDeleteNamed?[{label:"Delete Verify Step",value:"delete"}]:[])
    ];
    let action=typeof requestedAction==="object"&&requestedAction
      ?requestedAction.action:requestedAction;
    let newName=typeof requestedAction==="object"&&requestedAction
      ?requestedAction.newName:undefined;
    if(typeof action!=="string"){
      const picked=await vscode.window.showQuickPick(choices,{
        placeHolder:"选择此 Verify Step 的安全编辑操作"
      });
      action=typeof picked==="string"?picked:picked?.value;
    }
    if(!choices.some(x=>x.value===action))return false;
    if(action==="name"&&typeof newName!=="string"){
      newName=await vscode.window.showInputBox({
        value:"verify-"+item.stepValue.split(".").at(-1).replace(/[^A-Za-z0-9_-]/g,"-"),
        prompt:"为这个 Verify Step 设置稳定名称",
        placeHolder:"verify-step-name"
      });
    }
    if(action==="name"&&(typeof newName!=="string"||!newName.trim()))return false;
    if(ctx.doc.version!==ctx.version||ctx.doc.getText()!==ctx.source)
      throw Error("Source changed while choosing the Verify Step operation");
    let preview,verify;
    if(action==="name"){
      preview=previewNamePlainVerify(ctx.source,ctx.procedureId,ctx.nodeId,
        item.phaseName,item.stepIndex,newName);
      verify=text=>applyNamePlainVerify(text,preview);
    }else if(action==="delete"&&canDeleteNamed){
      preview=previewDeleteUnreferencedNamedVerify(ctx.source,ctx.procedureId,
        ctx.nodeId,item.phaseName,item.stepIndex);
      verify=text=>applyDeleteUnreferencedNamedVerify(text,preview);
    }else if(action==="move-up"&&canMoveUpNamed||
             action==="move-down"&&canMoveDownNamed){
      const pairIndex=action==="move-up"?item.stepIndex-1:item.stepIndex;
      preview=previewSwapAdjacentNamedVerify(ctx.source,ctx.procedureId,
        ctx.nodeId,item.phaseName,pairIndex);
      verify=text=>applySwapAdjacentNamedVerify(text,preview);
    }else if(action==="delete"){
      preview=previewDeletePhaseVerify(ctx.source,ctx.procedureId,ctx.nodeId,
        item.phaseName,item.stepIndex);
      verify=text=>applyDeletePhaseVerify(text,preview);
    }else{
      const pairIndex=action==="move-up"?item.stepIndex-1:item.stepIndex;
      preview=previewAdjacentVerifyReorder(ctx.source,ctx.procedureId,ctx.nodeId,
        item.phaseName,pairIndex);
      verify=text=>applyAdjacentVerifyReorder(text,preview);
    }
    const applied=await confirmAndApply({
      ...ctx,preview,changes:singleSourceChange,verify
    });
    if(applied)update(ctx.doc);
    return applied;
  }

  async function renameNamedPhaseStep(item,newName){
    if(item?.kind!=="phase-step"||typeof item.phaseName!=="string"||
       !Number.isSafeInteger(item.stepIndex)||typeof item.stepName!=="string"||
       !item.stepName)
      throw Error("Select a named Phase Step in the native Inspector");
    const ctx=currentNode(item);
    const impact=namedPhaseStepImpactReport(ctx.source,ctx.procedureId,ctx.nodeId)
      .find(x=>x.phaseName===item.phaseName&&x.stepIndex===item.stepIndex);
    if(!impact?.editEligible||impact.stepName!==item.stepName)
      throw Error("Named Step references are ambiguous or Source-only");
    let value=newName;
    if(typeof value!=="string")value=await vscode.window.showInputBox({
      value:item.stepName,prompt:"输入新的 Phase Step 名称",
      placeHolder:"new-step-name"
    });
    if(typeof value!=="string"||!value.trim())return false;
    if(ctx.doc.version!==ctx.version||ctx.doc.getText()!==ctx.source)
      throw Error("Source changed while choosing the new Phase Step name");
    const preview=previewNamedPhaseStepRename(ctx.source,ctx.procedureId,
      ctx.nodeId,item.phaseName,item.stepIndex,value);
    const applied=await confirmAndApply({
      ...ctx,preview,
      changes:p=>p.sourceSpans.map(span=>({
        start:span.start,end:span.end,oldValue:span.oldValue,newValue:span.newValue
      })),
      verify:text=>applyNamedPhaseStepRename(text,preview)
    });
    if(applied)update(ctx.doc);
    return applied;
  }

  async function insertNode(item,spec){
    if(item?.kind!=="route"||typeof item.routeId!=="string")
      throw Error("Select an eligible Route in the native Inspector");
    const ctx=currentNode(item);
    const predicates=await predicateContext(ctx.doc);
    const options=insertNodeOptions(ctx.source,ctx.procedureId,item.routeId,
      predicates.predicateSource,predicates.skillName);
    if(!options)throw Error("Selected Route is not eligible for Node insertion");
    let nodeId=spec?.nodeId;
    if(typeof nodeId!=="string")
      nodeId=await vscode.window.showInputBox({
        value:"new-node",prompt:"输入新 Node ID",placeHolder:"new-node-id"
      });
    if(typeof nodeId!=="string"||!nodeId.trim())return false;
    let operator=spec?.operator;
    if(typeof operator!=="string"){
      const choices=[
        ...(options.terminalValues.length?["terminal"]:[]),
        "call",...(options.predicates.length?["verify"]:[])
      ];
      operator=await vscode.window.showQuickPick(choices,{
        placeHolder:"选择要插入的 Node Operator"
      });
    }
    if(typeof operator!=="string")return false;
    let value=spec?.value;
    if(typeof value!=="string"){
      if(operator==="terminal"||operator==="verify"){
        const choices=operator==="terminal"?options.terminalValues:options.predicates;
        value=await vscode.window.showQuickPick(choices,{
          placeHolder:operator==="terminal"?"选择 Terminal 状态":"选择 Package Predicate"
        });
      }else{
        value=await vscode.window.showInputBox({
          value:"sbi.new.operation",prompt:"输入新 Node 的 Call operation"
        });
      }
    }
    if(typeof value!=="string"||!value.trim())return false;
    let outcome=operator==="terminal"?"":spec?.outcome;
    if(operator!=="terminal"&&typeof outcome!=="string")
      outcome=await vscode.window.showInputBox({
        value:operator==="verify"?"PASS":"COMMITTED",
        prompt:"输入新 Node 的 Outcome"
      });
    if(operator!=="terminal"&&typeof outcome!=="string")return false;
    if(ctx.doc.version!==ctx.version||ctx.doc.getText()!==ctx.source)
      throw Error("Source changed while choosing the new Node");
    const preview=previewNodeInsert(ctx.source,ctx.procedureId,item.routeId,
      {nodeId,operator,value,outcome},
      predicates.predicateSource,predicates.skillName);
    const applied=await confirmAndApply({
      ...ctx,preview,
      changes:p=>p.sourceSpans.map(span=>({
        start:span.start,end:span.end,oldValue:span.oldValue,newValue:span.newValue
      })),
      verify:async text=>{
        const current=await predicateContext(ctx.doc);
        return applyNodeInsert(text,preview,current.predicateSource,current.skillName);
      }
    });
    if(applied){
      const nextSelection={procedureId:ctx.procedureId,nodeId:preview.nodeId};
      selections.set(ctx.doc.uri.toString(),nextSelection);
      update(ctx.doc,nextSelection);
    }
    return applied;
  }

  async function deleteNode(item,redirectTarget){
    if(item?.kind!=="node")
      throw Error("Select a Node in the native Inspector");
    const ctx=currentNode(item);
    const options=deleteNodeOptions(ctx.source,ctx.procedureId,ctx.nodeId);
    if(!options)throw Error("Selected Node is not eligible for safe deletion");
    let target=redirectTarget;
    if(typeof target!=="string"){
      target=options.targets.length===1?options.targets[0]:
        await vscode.window.showQuickPick(options.targets,{
          placeHolder:"选择删除 Node 后的 Route 重定向目标"
        });
    }
    if(typeof target!=="string")return false;
    if(!options.targets.includes(target))
      throw Error("Redirect target is not in the qualified deletion choices");
    if(ctx.doc.version!==ctx.version||ctx.doc.getText()!==ctx.source)
      throw Error("Source changed while choosing the redirect target");
    const preview=previewNodeDelete(ctx.source,ctx.procedureId,ctx.nodeId,target);
    const applied=await confirmAndApply({
      ...ctx,preview,
      changes:p=>p.sourceSpans.map(span=>({
        start:span.start,end:span.end,oldValue:span.oldValue,newValue:span.newValue
      })),
      verify:text=>applyNodeDelete(text,preview)
    });
    if(applied){
      const nextSelection={procedureId:ctx.procedureId,nodeId:target};
      selections.set(ctx.doc.uri.toString(),nextSelection);
      update(ctx.doc,nextSelection);
    }
    return applied;
  }

  async function renameNode(item,newId){
    const ctx=currentNode(item);
    let value=newId;
    if(typeof value!=="string")value=await vscode.window.showInputBox({
      value:ctx.nodeId,prompt:"输入新的 Node ID",placeHolder:"new-node-id"
    });
    if(typeof value!=="string"||!value.trim())return false;
    if(ctx.doc.version!==ctx.version||ctx.doc.getText()!==ctx.source)
      throw Error("Source changed while choosing the new Node ID");
    const preview=previewNodeRename(ctx.source,ctx.procedureId,ctx.nodeId,value);
    const applied=await confirmAndApply({
      ...ctx,preview,
      changes:p=>p.sourceSpans.map(span=>({
        start:span.start,end:span.end,oldValue:span.oldValue,newValue:span.newValue
      })),
      verify:text=>applyNodeRename(text,preview)
    });
    if(applied){
      const nextSelection={procedureId:ctx.procedureId,nodeId:value};
      selections.set(ctx.doc.uri.toString(),nextSelection);
      update(ctx.doc,nextSelection);
    }
    return applied;
  }
  async function editNodeOperatorValue(item,newValue){
    const ctx=currentNode(item);
    const predicates=await predicateContext(ctx.doc);
    const state=nodeAttributeState(ctx.source,ctx.procedureId,ctx.nodeId,
      predicates.predicateSource,predicates.skillName);
    if(!state?.operator)
      throw Error("This Operator is Source-only or has no qualified Package choices");
    let value=newValue;
    if(typeof value!=="string"){
      value=state.operator.type==="select"
        ?await vscode.window.showQuickPick(state.operator.values,{
          placeHolder:"选择 "+state.operator.operator+" Operator 值"
        })
        :await vscode.window.showInputBox({
          value:state.operator.value,prompt:"输入新的 "+state.operator.operator+" Operator 值"
        });
    }
    if(typeof value!=="string"||!value.trim())return false;
    if(ctx.doc.version!==ctx.version||ctx.doc.getText()!==ctx.source)
      throw Error("Source changed while choosing the Operator value");
    const preview=previewNodeOperatorValue(ctx.source,ctx.procedureId,ctx.nodeId,
      value,predicates.predicateSource,predicates.skillName);
    return confirmAndApply({
      ...ctx,preview,
      changes:p=>[{
        start:p.sourceSpan.start,end:p.sourceSpan.end,
        oldValue:p.oldValue,newValue:p.newValue
      }],
      verify:async text=>{
        const current=await predicateContext(ctx.doc);
        return applyNodeOperatorValue(text,preview,
          current.predicateSource,current.skillName);
      }
    });
  }

  context.subscriptions.push(diagnostics);
  for(const id of ['inspection','outline','evidence','problems']){
    const emitter=new vscode.EventEmitter();
    const provider={onDidChangeTreeData:emitter.event,
      getChildren:item=>item?.children??(id==='problems'
        ? [{label:auditStatus,children:[]},...([...(snapshot?.problems??[]),...audit].map(d=>({label:d.message,line:d.line,uri:d.uri,description:d.code??'Source projection',children:[]})))]
        :snapshot?.[id]??[{label:'Open assurance/procedure.yaml',children:[]}]),
      getTreeItem(item){
        const tree=new vscode.TreeItem(item.label,item.children?.length?vscode.TreeItemCollapsibleState.Collapsed:vscode.TreeItemCollapsibleState.None);
        tree.description=item.description;tree.tooltip=item.label+(item.line?' · L'+item.line:'');
        tree.kind=item.kind;
        if(item.kind==='node'){
          const deletable=id==='inspection'&&document&&
            deleteNodeOptions(document.getText(),item.procedureId,item.nodeId);
          tree.contextValue=deletable?'skillStudio.deletableNode':'skillStudio.node';
          item.sourceVersion=document?.version;item.documentUri=document?.uri.toString();
          tree.procedureId=item.procedureId;tree.nodeId=item.nodeId;
          tree.sourceVersion=item.sourceVersion;tree.documentUri=item.documentUri;
        }
        if(item.kind==='route'&&id==='inspection'&&document&&
           insertNodeOptions(document.getText(),item.procedureId,item.routeId)){
          tree.contextValue='skillStudio.route';
          item.sourceVersion=document.version;item.documentUri=document.uri.toString();
          tree.procedureId=item.procedureId;tree.nodeId=item.nodeId;
          tree.routeId=item.routeId;tree.sourceVersion=item.sourceVersion;
          tree.documentUri=item.documentUri;
        }
        if(item.kind==='phase'&&id==='inspection'&&document){
          const cached=predicateSnapshot?.uri===document.uri.toString()&&
            predicateSnapshot.version===document.version?predicateSnapshot:null;
          const canAdd=cached&&phaseVerifyAddOptions(document.getText(),
            item.procedureId,item.nodeId,cached.predicateSource,cached.skillName)
            .some(x=>x.phaseName===item.phaseName);
          tree.contextValue=canAdd?'skillStudio.phaseWithVerifyAdd':'skillStudio.phase';
          item.sourceVersion=document.version;item.documentUri=document.uri.toString();
          tree.procedureId=item.procedureId;tree.nodeId=item.nodeId;
          tree.phaseName=item.phaseName;tree.sourceVersion=item.sourceVersion;
          tree.documentUri=item.documentUri;
        }
        if(item.kind==='phase-step'&&id==='inspection'&&document){
          const source=document.getText();
          const hasBinding=bindingOptions.some(x=>
            x.phaseName===item.phaseName&&x.stepIndex===item.stepIndex);
          const deletable=item.stepOperator==='verify'&&
            phaseVerifyDeleteOptions(source,item.procedureId,item.nodeId).some(x=>
              x.phaseName===item.phaseName&&x.stepIndex===item.stepIndex);
          const reorder=item.stepOperator==='verify'
            ?adjacentVerifyReorderOptions(source,item.procedureId,item.nodeId):[];
          const canMoveUp=reorder.some(x=>x.phaseName===item.phaseName&&
            x.stepIndex===item.stepIndex-1);
          const canMoveDown=reorder.some(x=>x.phaseName===item.phaseName&&
            x.stepIndex===item.stepIndex);
          const canEditVerify=deletable||canMoveUp||canMoveDown;
          const namedVerify=namedVerifyEditOptions(source,item.procedureId,item.nodeId);
          const canNameVerify=item.stepOperator==='verify'&&!item.stepName&&
            namedVerify.names.some(x=>x.phaseName===item.phaseName&&x.stepIndex===item.stepIndex);
          const canDeleteNamedVerify=item.stepOperator==='verify'&&Boolean(item.stepName)&&
            namedVerify.deletions.some(x=>x.phaseName===item.phaseName&&x.stepIndex===item.stepIndex);
          const namedReorder=item.stepOperator==='verify'&&Boolean(item.stepName)&&
            namedVerify.swaps.some(x=>x.phaseName===item.phaseName&&
              (x.stepIndex===item.stepIndex||x.stepIndex===item.stepIndex-1));
          const namedStep=item.stepName?namedPhaseStepImpactReport(source,
            item.procedureId,item.nodeId).find(x=>x.phaseName===item.phaseName&&
              x.stepIndex===item.stepIndex&&x.stepName===item.stepName):null;
          const canRenameNamed=Boolean(namedStep?.editEligible);
          if(item.stepOperator==='verify'&&(canDeleteNamedVerify||namedReorder)){
            tree.contextValue=hasBinding?'skillStudio.namedVerifyStepAndBinding':'skillStudio.namedVerifyStep';
          }else if(canRenameNamed){
            tree.contextValue=hasBinding?'skillStudio.namedPhaseStepAndBinding':'skillStudio.namedPhaseStep';
          }else if(item.stepOperator==='verify'&&(canNameVerify||canEditVerify)){
            tree.contextValue=hasBinding?'skillStudio.verifyStepAndBinding':'skillStudio.verifyStep';
          }else{
            tree.contextValue=hasBinding
              ?(canEditVerify?'skillStudio.phaseStepAndVerify':'skillStudio.phaseStep')
              :(canEditVerify?'skillStudio.verifyStep':'skillStudio.phaseStepPlain');
          }
          item.sourceVersion=document.version;item.documentUri=document.uri.toString();
          tree.procedureId=item.procedureId;tree.nodeId=item.nodeId;
          tree.phaseName=item.phaseName;tree.stepIndex=item.stepIndex;
          tree.stepName=item.stepName;tree.stepOperator=item.stepOperator;
          tree.stepValue=item.stepValue;
          tree.sourceVersion=item.sourceVersion;tree.documentUri=item.documentUri;
        }
        if(document&&item.line)tree.command={command:'skillStudio.revealInspection',title:'Reveal Source',arguments:[{...item,uri:item.uri??document.uri,version:document.version,sourceVersion:document.version,documentUri:document.uri.toString(),...(item.uri?{auditGeneration:generation}:{})}]};
        return tree;
      }};
    providers.set(id,emitter);
    context.subscriptions.push(emitter,vscode.window.registerTreeDataProvider('skillStudio.'+id,provider));
  }
  const fire=()=>{for(const p of providers.values())p.fire();};
  function update(doc,choice){
    if(!isProcedurePath(doc?.uri.path))return;
    const key=doc.uri.toString(),same=document?.uri.toString()===key;
    const text=doc.getText(),projected=same&&snapshot?.text===text?snapshot.model:null;
    const next=choice??(same?selection:selections.get(key)??{});
    const evidenceFiles=packageFilesUri===key&&packageFilesVersion===doc.version?packageFiles:null;
    const evidenceStamp=evidenceFiles?doc.version:null;
    const changed=!same||snapshot?.text!==text||next.procedureId!==selection.procedureId||
      next.nodeId!==selection.nodeId||snapshot?.evidenceStamp!==evidenceStamp;
    if(!same){
      generation++;audit=[];diagnostics.clear();
      packageFiles=null;packageFilesUri=null;packageFilesVersion=-1;
      predicateSnapshot=null;predicateGeneration++;
    }
    document=doc;selection=next;selections.set(key,next);
    if(!predicateSnapshot||predicateSnapshot.uri!==key||
       predicateSnapshot.version!==doc.version){
      predicateSnapshot=null;
      void refreshPredicateSnapshot(doc);
    }
    if(changed){
      snapshot={...inspectionSnapshot(text,selection,projected,evidenceFiles),text,evidenceStamp};
      bindingOptions=snapshot.model.state==='READY'&&selection.procedureId&&selection.nodeId
        ?phaseStepBindingOptions(text,selection.procedureId,selection.nodeId):[];
      fire();
    }
  }
  async function auditCurrent(){
    if(!document)return;
    const doc=document,version=doc.version,ticket=++generation;
    auditStatus="Package Audit · running";fire();
    const files=new Map(),uris=new Map();
    try{
      const base=doc.uri.with({path:doc.uri.path.slice(0,-'assurance/procedure.yaml'.length)});
      // Bounded by file count and aggregate bytes; never crawl another Package.
      const found=await vscode.workspace.findFiles(new vscode.RelativePattern(base,'**/*'),'**/node_modules/**',501);
      if(found.length>500)throw Error('Package exceeds 500-file audit limit');
      let bytes=0;
      for(const uri of found){
        if(!uri.path.startsWith(base.path))continue;
        const path=uri.path.slice(base.path.length);uris.set(path,uri);
        if(!/\.(yaml|json|py|md)$/.test(path)){files.set(path,{text:''});continue;}
        const open=vscode.workspace.textDocuments.find(d=>d.uri.toString()===uri.toString());
        const text=open?open.getText():new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
        bytes+=text.length;if(bytes>4*MAX_SOURCE_BYTES)throw Error('Package exceeds 4 MiB audit limit');
        files.set(path,{text});
      }
      const required=['assurance/procedure.yaml','assurance/contract.yaml','assurance/predicates.yaml'];
      const missing=required.filter(p=>!files.has(p));
      const results=missing.length?missing.map(path=>({message:'Audit unavailable: missing '+path,path:'assurance/procedure.yaml',line:1,code:'AUDIT_INCOMPLETE'})):
        auditPackageWorkspace({name:base.path.replace(/\/$/,'').split('/').at(-1),files},doc.getText());
      if(ticket!==generation||document!==doc||doc.version!==version)return;
      audit=results.map(d=>({...d,uri:uris.get(d.path)??doc.uri}));
      auditStatus="Package Audit · "+(missing.length?"unavailable":audit.length+" editor warnings");diagnostics.clear();
      if(!missing.length){
        packageFiles=files;packageFilesUri=doc.uri.toString();packageFilesVersion=version;
        update(doc);
      }else{
        packageFiles=null;packageFilesUri=null;packageFilesVersion=-1;
        update(doc);
      }
      for(const uri of new Set(audit.map(d=>d.uri))){
        diagnostics.set(uri,audit.filter(d=>d.uri===uri).map(d=>{
          const line=Math.max(0,d.line-1),diagnostic=new vscode.Diagnostic(new vscode.Range(line,0,line,1),d.message,vscode.DiagnosticSeverity.Warning);
          diagnostic.source='Skill Studio · editor audit';diagnostic.code=d.code;return diagnostic;
        }));
      }
      fire();
    }catch(error){
      if(ticket!==generation)return;
      packageFiles=null;packageFilesUri=null;packageFilesVersion=-1;
      auditStatus='Package Audit · unavailable';
      audit=[{message:'Audit unavailable: '+error.message,line:1,uri:doc.uri}];
      diagnostics.clear();update(doc);fire();
    }
  }
  function scheduleAudit(){
    generation++;clearTimeout(timer);
    packageFiles=null;packageFilesUri=null;packageFilesVersion=-1;
    auditStatus="Package Audit · pending";audit=[];diagnostics.clear();
    if(document)update(document);
    timer=setTimeout(()=>void auditCurrent(),350);fire();
  }
  async function preparePackageZip(){
    const doc=document,suffix='assurance/procedure.yaml';
    if(!doc||!isProcedurePath(doc.uri.path)||!doc.uri.path.endsWith(suffix))
      throw Error('请先打开当前 Package 的 Procedure 可视化编辑器');
    const basePath=doc.uri.path.slice(0,-suffix.length);
    const base=doc.uri.with({path:basePath});
    const name=basePath.replace(/\/$/,'').split('/').at(-1);
    if(!name)throw Error('无法确定 Package 根目录名称');
    const sourceVersion=doc.version,sourceText=doc.getText();
    const opened=(vscode.workspace.textDocuments??[])
      .filter(item=>item.uri.path.startsWith(basePath))
      .map(item=>({item,path:item.uri.path.slice(basePath.length),
        version:item.version,text:item.getText()}));
    const pattern=new vscode.RelativePattern(base,'**/*');
    const found=await vscode.workspace.findFiles(pattern,'**/node_modules/**',65);
    if(found.length>64)throw Error('Package 超过 ZIP 导出的 64 文件上限');
    const files=[],uris=new Map();
    for(const uri of found){
      if(!uri.path.startsWith(basePath))continue;
      const path=uri.path.slice(basePath.length);
      if(!path)continue;
      const bytes=await vscode.workspace.fs.readFile(uri);
      if(!(bytes instanceof Uint8Array))throw Error('无法读取 Package 文件：'+path);
      files.push({path,bytes:bytes.slice()});uris.set(path,uri);
    }
    files.sort((a,b)=>a.path.localeCompare(b.path));
    const currentTextByPath=new Map(opened.map(entry=>[entry.path,entry.text]));
    currentTextByPath.set('assurance/procedure.yaml',sourceText);
    const built=await buildPackageZip({name,files,currentTextByPath});
    if(document!==doc||doc.version!==sourceVersion||doc.getText()!==sourceText)
      throw Error('Procedure Source 在导出期间发生变化；请重新导出');
    for(const entry of opened){
      if(entry.item.version!==entry.version||entry.item.getText()!==entry.text)
        throw Error('Package Source 在导出期间发生变化：'+entry.path);
    }
    const after=await vscode.workspace.findFiles(pattern,'**/node_modules/**',65);
    const afterPaths=after.filter(uri=>uri.path.startsWith(basePath))
      .map(uri=>uri.path.slice(basePath.length)).filter(Boolean).sort();
    const beforePaths=files.map(file=>file.path).sort();
    if(after.length>64||JSON.stringify(afterPaths)!==JSON.stringify(beforePaths))
      throw Error('Package 文件集合在导出期间发生变化；请重新导出');
    for(const file of files){
      const uri=uris.get(file.path),latest=uri?await vscode.workspace.fs.readFile(uri):null;
      if(!latest||latest.length!==file.bytes.length||
        latest.some((value,index)=>value!==file.bytes[index]))
        throw Error('Package 文件在导出期间发生变化：'+file.path);
    }
    const post=sessions.get(doc.uri.toString());
    if(!post)throw Error('Procedure Visual Webview 不可用；请重新打开可视化编辑器');
    const delivered=await post({
      type:'packageZipReady',filename:built.filename,
      fileCount:built.fileCount,opaqueCount:built.opaqueCount,
      base64:bytesToBase64(built.bytes)
    });
    if(delivered===false)throw Error('无法将 ZIP 交付给 Procedure Visual Webview');
    await vscode.window.showInformationMessage(
      'Package ZIP 已准备好；请在 Procedure 画布上点击“下载 ZIP”。');
    return true;
  }
  context.subscriptions.push({dispose(){clearTimeout(timer);generation++;sessions.clear();selections.clear();}},
    vscode.commands.registerCommand('skillStudio.revealInspection',async item=>{
      if(!document||item.version!==document.version||
         (item.auditGeneration!==undefined&&item.auditGeneration!==generation))return;
      if(item.nodeId){selection={procedureId:item.procedureId,nodeId:item.nodeId};update(document);sessions.get(document.uri.toString())?.({type:'focusNode',...selection,version:document.version});}
      const doc=await vscode.workspace.openTextDocument(item.uri);
      const line=Math.min(Math.max(0,item.line-1),doc.lineCount-1);
      await openNativeSource(vscode,doc.uri,{preview:true,selection:new vscode.Range(line,0,line,0)});
    }),
    vscode.commands.registerCommand('skillStudio.auditPackage',auditCurrent),
    vscode.commands.registerCommand('skillStudio.exportPackageZip',async()=>{
      try{return await preparePackageZip();}
      catch(error){
        await vscode.window.showWarningMessage('Package ZIP 导出未准备好：'+error.message);
        return false;
      }
    }),
    vscode.commands.registerCommand('skillStudio.refreshInspection',()=>{if(document){update(document);scheduleAudit();}}),
    vscode.commands.registerCommand('skillStudio.renameNode',async(item,newId)=>{
      try{return await renameNode(item,newId);}
      catch(error){await vscode.window.showWarningMessage('Node 重命名未执行：'+error.message);return false;}
    }),
    vscode.commands.registerCommand('skillStudio.editNodeOperatorValue',async(item,newValue)=>{
      try{return await editNodeOperatorValue(item,newValue);}
      catch(error){await vscode.window.showWarningMessage('Operator 修改未执行：'+error.message);return false;}
    }),
    vscode.commands.registerCommand('skillStudio.editPhaseInputBinding',async(item,bindingKey,newValue)=>{
      try{return await editPhaseInputBinding(item,bindingKey,newValue);}
      catch(error){await vscode.window.showWarningMessage('Phase Binding 修改未执行：'+error.message);return false;}
    }),
    vscode.commands.registerCommand('skillStudio.addPhaseVerify',async(item,predicate)=>{
      try{return await addPhaseVerify(item,predicate);}
      catch(error){await vscode.window.showWarningMessage('新增 Verify Step 未执行：'+error.message);return false;}
    }),
    vscode.commands.registerCommand('skillStudio.editPhaseVerifyStep',async(item,action)=>{
      try{return await editPhaseVerifyStep(item,action);}
      catch(error){await vscode.window.showWarningMessage('Verify Step 修改未执行：'+error.message);return false;}
    }),
    vscode.commands.registerCommand('skillStudio.renameNamedPhaseStep',async(item,newName)=>{
      try{return await renameNamedPhaseStep(item,newName);}
      catch(error){await vscode.window.showWarningMessage('Phase Step 重命名未执行：'+error.message);return false;}
    }),
    vscode.commands.registerCommand('skillStudio.insertNode',async(item,spec)=>{
      try{return await insertNode(item,spec);}
      catch(error){await vscode.window.showWarningMessage('Node 插入未执行：'+error.message);return false;}
    }),
    vscode.commands.registerCommand('skillStudio.deleteNode',async(item,redirectTarget)=>{
      try{return await deleteNode(item,redirectTarget);}
      catch(error){await vscode.window.showWarningMessage('Node 删除未执行：'+error.message);return false;}
    }),
    vscode.workspace.onDidChangeTextDocument(e=>{
      if(isProcedurePath(e.document.uri.path)&&document?.uri.toString()===e.document.uri.toString())update(e.document);
      if(document){
        const predicatePath=document.uri.path.slice(0,-'procedure.yaml'.length)+'predicates.yaml';
        if(e.document.uri.path===predicatePath){
          predicateSnapshot=null;predicateGeneration++;
          void refreshPredicateSnapshot(document);
        }
        scheduleAudit();
      }
    }),
    vscode.window.onDidChangeActiveTextEditor(editor=>{if(isProcedurePath(editor?.document.uri.path)){update(editor.document);scheduleAudit();}}));
  context.subscriptions.push(vscode.commands.registerCommand('skillStudio.previewMarkdown',async uri=>{
    uri=uri??vscode.window.activeTextEditor?.document.uri;
    if(!uri||!uri.path.toLowerCase().endsWith('.md'))return;
    const doc=await vscode.workspace.openTextDocument(uri);
    const panel=vscode.window.createWebviewPanel('skillStudio.markdown','Preview · '+uri.path.split('/').at(-1),vscode.ViewColumn.Beside,{enableScripts:false});
    const render=()=>{const preview=renderMarkdown(doc.getText());panel.webview.html='<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;none&#39;;"></head><body><article>'+(preview.available?preview.html:'<p>预览不可用，请使用源码编辑器。</p>')+'</article></body></html>';};
    render();const changed=vscode.workspace.onDidChangeTextDocument(e=>{if(e.document.uri.toString()===uri.toString())render();});panel.onDidDispose(()=>changed.dispose());
  }));
  return {attach(doc,post){
    sessions.set(doc.uri.toString(),post);update(doc);scheduleAudit();
    const releaseLanguagePackage=attachLanguagePackage(doc);
    return ()=>{sessions.delete(doc.uri.toString());releaseLanguagePackage();};
  },select(doc,message){
    if(message.version!==doc.version||typeof message.procedureId!=='string')return;
    update(doc,{procedureId:message.procedureId,nodeId:typeof message.nodeId==='string'?message.nodeId:null});
  },activate(doc){
    const changed=document?.uri.toString()!==doc.uri.toString()||snapshot?.text!==doc.getText();
    update(doc);if(changed)scheduleAudit();
    const rootInfo=packageRootForProcedure(vscode,doc);
    const state=rootInfo?languagePackages.get(rootInfo.uri.toString()):null;
    if(state){state.procedureDocument=doc;scheduleLanguagePackageRefresh(state);}
  }};
}
