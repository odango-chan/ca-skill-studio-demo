import {openNativeSource} from "./native-source.mjs";
import {registerNativeMarkdown} from "./native-markdown.mjs";
import {assertStudioMutation} from "./project-policy.mjs";
import {inspectionSnapshot} from './inspection.mjs';
import {auditPackageWorkspace} from '../../../../site/package-audit.mjs';
import {isProcedurePath,MAX_SOURCE_BYTES} from './bridge.mjs';
import {previewNodeRename,applyNodeRename} from '../../../../site/node-designer.mjs';
import {nodeAttributeState,previewNodeOperatorValue,applyNodeOperatorValue} from '../../../../site/node-attributes.mjs';
import {insertNodeOptions,previewNodeInsert,applyNodeInsert} from '../../../../site/node-create.mjs';
import {deleteNodeOptions,previewNodeDelete,applyNodeDelete} from '../../../../site/node-delete.mjs';
import {phaseStepBindingOptions,previewPhaseInputBinding,applyPhaseInputBinding} from '../../../../site/phase-bindings.mjs';
import {phaseOutputReferenceOptions,previewPhaseOutputReference,
  applyPhaseOutputReference} from '../../../../site/phase-output-refs.mjs';
import {phaseRouteTargetOptions,previewPhaseRouteTarget,applyPhaseRouteTarget}
  from '../../../../site/phase-routes.mjs';
import {phaseOutcomeEditOptions,previewAddObservedPhaseOutcome,
  previewRenameNoncorePhaseOutcome,previewDeleteNoncorePhaseOutcome,
  applyAddObservedPhaseOutcome,applyRenameNoncorePhaseOutcome,
  applyDeleteNoncorePhaseOutcome} from '../../../../site/phase-outcomes.mjs';
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
import {
  collectSkillSemanticTokenSpans,
  SKILL_SEMANTIC_TOKEN_TYPES,
  SKILL_SEMANTIC_TOKEN_MODIFIERS
} from "../../../../language/semantic-tokens.mjs";
import studioLightTheme from "../../../../extensions/skill-studio-theme/themes/skill-studio-light-color-theme.json";
import {createSemanticTokenDecorationRenderer}
  from "../../lsp-browser/client/src/semantic-token-decorations.mjs";

export function registerWorkbench(vscode,context){
  let document=null,selection={},snapshot=null,bindingOptions=[],predicateSnapshot=null,
    predicateGeneration=0,audit=[],auditStatus="Package Audit · not run",generation=0,timer,
    lastSelectionMessage=null;
  let packageFiles=null,packageFilesUri=null,packageFilesVersion=-1;
  const providers=new Map(),sessions=new Map(),selections=new Map();
  const diagnostics=vscode.languages.createDiagnosticCollection('skill-studio');
  const languagePackages=new Map();
  const languagePackageGenerations=new Map();
  const languagePackageStatuses=new Map();
  let languageRecoveryPromise=null;
  let languageClientEpoch=0;
  let languageClient=null,languageClientPromise=null,languageClientFailureShown=false,
    languageStatusItem=null,languageTransportFailure=null;
  const semanticTokenDiagnostics={
    registered:false,tokenTypeCount:0,requests:0,lastUri:null,lastTokenCount:0,lastError:null,
    renderer:null,renderedTokenCount:0,renderedTypeCount:0,renderError:null,
    server:null,transport:null
  };
  function encodeNativeSemanticTokens(document,spans){
    const segments=[];
    const text=document.getText();
    for(const span of spans){
      if(!Number.isSafeInteger(span.start)||!Number.isSafeInteger(span.end)||
         span.start<0||span.end<=span.start||span.end>text.length||
         !Number.isSafeInteger(span.tokenType)||span.tokenType<0||
         span.tokenType>=SKILL_SEMANTIC_TOKEN_TYPES.length||
         !Number.isSafeInteger(span.tokenModifiers))continue;
      const first=document.positionAt(span.start);
      const last=document.positionAt(span.end);
      for(let line=first.line;line<=last.line;line++){
        const lineStart=document.offsetAt(new vscode.Position(line,0));
        const lineEnd=lineStart+document.lineAt(line).text.length;
        const start=Math.max(span.start,lineStart);
        const end=Math.min(span.end,lineEnd);
        if(end<=start)continue;
        segments.push({
          line,character:start-lineStart,length:end-start,
          tokenType:span.tokenType,tokenModifiers:span.tokenModifiers
        });
      }
    }
    segments.sort((a,b)=>a.line-b.line||a.character-b.character);
    const data=[];
    let previousLine=0,previousCharacter=0;
    for(const item of segments){
      const deltaLine=item.line-previousLine;
      const deltaCharacter=deltaLine===0
        ?item.character-previousCharacter:item.character;
      data.push(deltaLine,deltaCharacter,item.length,item.tokenType,item.tokenModifiers);
      previousLine=item.line;
      previousCharacter=item.character;
    }
    return new vscode.SemanticTokens(Uint32Array.from(data));
  }
  function registerExtensionHostSemanticTokens(){
    // Browser extension hosts use the LSP-backed adapter in browserClient.mjs.
    // Node extension hosts (VS Code desktop / backend-backed Theia) have no
    // browser Worker transport; they use this adapter over the SAME canonical
    // source classifier, rather than silently losing CA semantic colors.
    if(typeof Worker==="function"&&typeof globalThis.location!=="undefined")return;
    if(typeof vscode.languages?.registerDocumentSemanticTokensProvider!=="function"||
       typeof vscode.SemanticTokensLegend!=="function"||
       typeof vscode.SemanticTokens!=="function"){
      semanticTokenDiagnostics.lastError="Native semantic-token API unavailable";
      return;
    }
    const legend=new vscode.SemanticTokensLegend(
      [...SKILL_SEMANTIC_TOKEN_TYPES],
      [...SKILL_SEMANTIC_TOKEN_MODIFIERS]
    );
    let renderer=null;
    const isTheia=(typeof STUDIO_THEIA_HOST!=="undefined"&&STUDIO_THEIA_HOST)||
      /theia/i.test(String(vscode.env?.appName??""));
    if(isTheia){
      try{
        renderer=createSemanticTokenDecorationRenderer(
          vscode,SKILL_SEMANTIC_TOKEN_TYPES,studioLightTheme.semanticTokenColors??{}
        );
        semanticTokenDiagnostics.renderer="theia-text-editor-decoration";
        context.subscriptions.push({dispose:()=>renderer?.dispose()});
      }catch(error){
        semanticTokenDiagnostics.renderError=String(error?.message??error);
      }
    }
    const provider={
      provideDocumentSemanticTokens(document,cancellationToken){
        if(cancellationToken?.isCancellationRequested)
          return new vscode.SemanticTokens(new Uint32Array());
        const uriPath=document.uri.path.split("/").filter(Boolean).join("/");
        const relativePath=vscode.workspace.asRelativePath?.(document.uri,false)||uriPath;
        const spans=collectSkillSemanticTokenSpans(document.getText(),relativePath);
        semanticTokenDiagnostics.requests++;
        semanticTokenDiagnostics.lastUri=document.uri.toString();
        semanticTokenDiagnostics.transport="extension-host";
        const result=encodeNativeSemanticTokens(document,spans);
        semanticTokenDiagnostics.lastTokenCount=result.data.length/5;
        semanticTokenDiagnostics.lastError=null;
        if(renderer){
          try{
            const rendered=renderer.render(document,result.data);
            semanticTokenDiagnostics.renderer="theia-text-editor-decoration";
            semanticTokenDiagnostics.renderedTokenCount=rendered.tokenCount;
            semanticTokenDiagnostics.renderedTypeCount=rendered.tokenTypeCount;
            semanticTokenDiagnostics.renderError=null;
          }catch(error){
            semanticTokenDiagnostics.renderError=String(error?.message??error);
          }
        }
        return result;
      }
    };
    const registration=vscode.languages.registerDocumentSemanticTokensProvider(
      [
        {scheme:"file",pattern:"**/*.yaml"},
        {scheme:"file",pattern:"**/*.yml"},
        {scheme:"file",pattern:"**/*.py"},
        {scheme:"file",pattern:"**/SKILL.md"}
      ],
      provider,
      legend
    );
    semanticTokenDiagnostics.registered=true;
    semanticTokenDiagnostics.tokenTypeCount=SKILL_SEMANTIC_TOKEN_TYPES.length;
    semanticTokenDiagnostics.transport="extension-host";
    context.subscriptions.push(registration);
  }
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

  // Acceptance-only diagnostics are deliberately not contributed to the
  // Command Palette. The Chromium harness queries this internal command in
  // both browser-Worker and Node extension-host variants.
  context.subscriptions.push(vscode.commands.registerCommand(
    "skillStudio.internal.semanticTokenDiagnostics",()=>({
      ...semanticTokenDiagnostics,
      semanticHighlightingEnabled:vscode.workspace.getConfiguration("editor")
        .get("semanticHighlighting.enabled")
    })
  ));
  registerExtensionHostSemanticTokens();

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
          const epoch=++languageClientEpoch;
          candidate=createSkillLanguageClient(vscode,context,{
            // Theia 1.76's browser plugin host does not consistently register
            // server-advertised semantic tokens. Register the native provider
            // explicitly, but keep VS Code's normal LSP feature path unchanged.
            manualSemanticTokens:typeof STUDIO_THEIA_HOST!=="undefined"&&STUDIO_THEIA_HOST,
            onSemanticTokenProviderRegistered:status=>{
              semanticTokenDiagnostics.registered=status?.registered===true;
              semanticTokenDiagnostics.tokenTypeCount=status?.tokenTypeCount??0;
              semanticTokenDiagnostics.transport="browser-lsp";
            },
            onSemanticTokenRendererRegistered:status=>{
              semanticTokenDiagnostics.renderer=status?.renderer??null;
              semanticTokenDiagnostics.renderError=null;
            },
            onSemanticTokenRendererUnavailable:error=>{
              semanticTokenDiagnostics.renderError=String(error);
            },
            onSemanticTokenRendered:(uri,result)=>{
              semanticTokenDiagnostics.lastUri=uri;
              semanticTokenDiagnostics.renderer="theia-text-editor-decoration";
              semanticTokenDiagnostics.renderedTokenCount=result?.tokenCount??0;
              semanticTokenDiagnostics.renderedTypeCount=result?.tokenTypeCount??0;
              semanticTokenDiagnostics.renderError=null;
            },
            onSemanticTokenRenderError:(uri,error)=>{
              semanticTokenDiagnostics.lastUri=uri;
              semanticTokenDiagnostics.renderError=String(error);
            },
            onSemanticTokenRequest:uri=>{
              semanticTokenDiagnostics.requests++;
              semanticTokenDiagnostics.lastUri=uri;
              semanticTokenDiagnostics.transport="browser-lsp";
            },
            onSemanticTokenResult:(uri,count)=>{
              semanticTokenDiagnostics.lastUri=uri;
              semanticTokenDiagnostics.lastTokenCount=count;
              semanticTokenDiagnostics.lastError=null;
            },
            onSemanticTokenServerDiagnostics:diagnostics=>{
              semanticTokenDiagnostics.server=diagnostics;
            },
            onSemanticTokenError:(uri,error)=>{
              semanticTokenDiagnostics.lastUri=uri;
              semanticTokenDiagnostics.lastError=error;
            },
            onStatus:status=>{
              if(epoch!==languageClientEpoch)return;
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
              if(epoch!==languageClientEpoch)return;
              console.warn("Skill Studio Language Service",error);
              updateLanguageStatus("ERROR",String(error?.message??error));
            },
            onFatal:error=>{
              if(epoch!==languageClientEpoch||languageTransportFailure)return;
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
        /(?:EntryNotFound|ENOENT|EIO)/i.test(snapshot.reason??"")&&
        /(?:FileSystemError|Unable to read file|EntryNotFound|ENOENT|EIO)/i
          .test(snapshot.reason??"");
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
      // Any late notification from the old Worker is invalid once recovery
      // begins, even if the SDK completes its stop handshake afterward.
      ++languageClientEpoch;
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
    })().catch(error=>{
      const reason=String(error?.message??error);
      // A failed manual restart is terminal; no edit/open event may
      // implicitly spin up another Worker until the user requests retry.
      languageTransportFailure="Language Worker recovery failed: "+reason;
      updateLanguageStatus("UNAVAILABLE",languageTransportFailure);
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
        const packagePath=procedureUri.path.replace(/\/assurance\/procedure\.yaml$/,"");
        if(packagePath===procedureUri.path)
          throw Error("Procedure URI does not identify a Package assurance/procedure.yaml");
        const relatedUris={
          contract:procedureUri.with({path:packagePath+"/assurance/contract.yaml"}),
          predicates:procedureUri.with({path:packagePath+"/assurance/predicates.yaml"}),
          schema:procedureUri.with({path:packagePath+"/schemas/establishment-request.schema.yaml"})
        };
        const packageRootForYaml=packageRootForProcedure(vscode,procedureDocument);
        const packageStateForYaml=packageRootForYaml?
          languagePackages.get(packageRootForYaml.uri.toString()):null;
        if(!packageStateForYaml)
          throw Error("Active Procedure Package has no Language Service state");
        const generationBeforeYamlOpen=packageStateForYaml.generation;
        const openBeforeYaml=new Set((vscode.workspace.textDocuments??[])
          .map(item=>item.uri.toString()));
        const [contractDocument,predicatesDocument,schemaDocument]=await Promise.all([
          vscode.workspace.openTextDocument(relatedUris.contract),
          vscode.workspace.openTextDocument(relatedUris.predicates),
          vscode.workspace.openTextDocument(relatedUris.schema)
        ]);
        const openedYamlSources=[contractDocument,predicatesDocument,schemaDocument]
          .filter(item=>!openBeforeYaml.has(item.uri.toString())).length;
        const yamlAnalysisStarted=Date.now();
        while(Date.now()-yamlAnalysisStarted<15000){
          const generation=packageStateForYaml.generation;
          const ready=languageStatusItem?.text==="SKILL LSP: READY"&&
            String(languageStatusItem?.tooltip??"").includes("generation "+generation);
          if(ready&&(!openedYamlSources||generation>generationBeforeYamlOpen))break;
          if(languageStatusItem?.text==="SKILL LSP: ERROR"||
             languageStatusItem?.text==="SKILL LSP: UNAVAILABLE")
            throw Error("Package re-analysis failed before YAML symbol acceptance: "+
              String(languageStatusItem.tooltip??""));
          await new Promise(resolve=>setTimeout(resolve,100));
        }
        if(languageStatusItem?.text!=="SKILL LSP: READY"||
           !String(languageStatusItem?.tooltip??"").includes(
             "generation "+packageStateForYaml.generation))
          throw Error("YAML symbol Package generation did not reach READY");
        const procedureText=procedureDocument.getText();
        const contractText=contractDocument.getText();
        const predicatesText=predicatesDocument.getText();
        const schemaText=schemaDocument.getText();
        const sourcePosition=(document,text,needle)=>{
          const offset=text.indexOf(needle);
          if(offset<0)throw Error("Expected Skill Language symbol is missing: "+needle);
          return document.positionAt(offset);
        };
        const locations=result=>Array.isArray(result)?result:result?[result]:[];
        const entryName="ue-requested-pdu-session-establishment";
        const entryDefinition=locations(await vscode.commands.executeCommand(
          "vscode.executeDefinitionProvider",relatedUris.contract,
          sourcePosition(contractDocument,contractText,entryName)));
        const entryTarget=entryDefinition.find(item=>
          (item?.uri??item?.targetUri)?.toString()===procedureUri.toString());
        if(!entryTarget)
          throw Error("Contract entryProcedure did not resolve to the unique Procedure declaration: "+
            JSON.stringify(entryDefinition.map(item=>(item?.uri??item?.targetUri)?.toString?.()??null)));
        const predicateName="createdsession.ingress.eligible";
        const predicateDefinition=locations(await vscode.commands.executeCommand(
          "vscode.executeDefinitionProvider",procedureUri,
          sourcePosition(procedureDocument,procedureText,predicateName)));
        const predicateTarget=predicateDefinition.find(item=>
          (item?.uri??item?.targetUri)?.toString()===relatedUris.predicates.toString());
        if(!predicateTarget)
          throw Error("Procedure Predicate did not resolve to its PredicateSet declaration");
        const nodeName="nudm-sdm-get";
        const nodeDefinition=locations(await vscode.commands.executeCommand(
          "vscode.executeDefinitionProvider",procedureUri,
          sourcePosition(procedureDocument,procedureText,nodeName)));
        if(!nodeDefinition.some(item=>
          (item?.uri??item?.targetUri)?.toString()===procedureUri.toString()))
          throw Error("Procedure start did not resolve to its exact node declaration");
        const requestSchemaPath="schemas/establishment-request.schema.yaml";
        const schemaDefinition=locations(await vscode.commands.executeCommand(
          "vscode.executeDefinitionProvider",relatedUris.contract,
          sourcePosition(contractDocument,contractText,requestSchemaPath)));
        if(!schemaDefinition.some(item=>
          (item?.uri??item?.targetUri)?.path?.endsWith("/"+requestSchemaPath)))
          throw Error("Contract requestSchema did not resolve to its Package-owned Schema file");
        const predicateHoverResult=await vscode.commands.executeCommand(
          "vscode.executeHoverProvider",procedureUri,
          sourcePosition(procedureDocument,procedureText,predicateName));
        const predicateHoverText=locations(predicateHoverResult).flatMap(item=>
          Array.isArray(item?.contents)?item.contents:[item?.contents])
          .map(item=>typeof item==="string"?item:item?.value??String(item??""))
          .join(" ");
        if(!predicateHoverText.includes("Predicate")||
           !predicateHoverText.includes(predicateName))
          throw Error("Predicate Hover did not expose the canonical symbol identity");
        const predicateReferences=locations(await vscode.commands.executeCommand(
          "vscode.executeReferenceProvider",relatedUris.predicates,
          sourcePosition(predicatesDocument,predicatesText,predicateName),{includeDeclaration:true}));
        if(!predicateReferences.some(item=>
            (item?.uri??item?.targetUri)?.toString()===procedureUri.toString()))
          throw Error("Predicate References did not return the exact Procedure use");
        const yamlProcedureSymbols=await vscode.commands.executeCommand(
          "vscode.executeDocumentSymbolProvider",procedureUri);
        const yamlPredicateSymbols=await vscode.commands.executeCommand(
          "vscode.executeDocumentSymbolProvider",relatedUris.predicates);
        const procedureSymbol=locations(yamlProcedureSymbols).find(item=>item.name===entryName);
        if(!procedureSymbol||!procedureSymbol.children?.some(item=>item.name===nodeName))
          throw Error("Native Outline did not expose Procedure and nested node declarations");
        if(!locations(yamlPredicateSymbols).some(item=>item.name===predicateName))
          throw Error("Native Outline did not expose PredicateSet declarations");
        const procedureLines=procedureText.split(/\r\n|\n|\r/);
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
           !hoverText.includes(scriptPathValue))
          throw Error("Hover provider did not return the exact Skill Script path");
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
        const mainLine=scriptLines.findIndex(line=>/^(?:async )?def main\(/.test(line));
        const legacyMetadata=nameLine>=0&&schemaLine>=0;
        if(!legacyMetadata&&mainLine<0)
          throw Error("Python Source has neither legacy metadata nor a canonical main() entrypoint");
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
        const referencePosition=legacyMetadata
          ?new vscode.Position(nameLine,"# name: ".length)
          :new vscode.Position(mainLine,"def ".length);
        const referenceResult=await vscode.commands.executeCommand(
          "vscode.executeReferenceProvider",scriptUri,referencePosition);
        const references=Array.isArray(referenceResult)?referenceResult:[];
        if(!references.some(item=>item?.uri?.toString()===procedureUri.toString()))
          throw Error("References provider did not return the Procedure caller: "+
            JSON.stringify(references.map(item=>item?.uri?.toString?.()??null)));
        // Exercise the public native Definition provider in the reverse
        // direction. This is what Monaco/Theia's standard Ctrl/Cmd-click,
        // F12 and Peek Definition gestures consume.
        const reverseDefinitionResult=await vscode.commands.executeCommand(
          "vscode.executeDefinitionProvider",scriptUri,referencePosition);
        const reverseDefinitions=Array.isArray(reverseDefinitionResult)
          ?reverseDefinitionResult:reverseDefinitionResult?[reverseDefinitionResult]:[];
        const preferredReverseDefinition=reverseDefinitions[0];
        const expectedScriptStart=procedureLines[procedureLine].indexOf(scriptPathValue);
        if(preferredReverseDefinition?.uri?.toString()!==procedureUri.toString())
          throw Error("Python main() Definition did not prioritize the YAML caller: "+
            JSON.stringify(reverseDefinitions.map(item=>item?.uri?.toString?.()??null)));
        if(preferredReverseDefinition.range?.start?.line!==procedureLine||
           preferredReverseDefinition.range?.start?.character!==expectedScriptStart||
           preferredReverseDefinition.range?.end?.line!==procedureLine||
           preferredReverseDefinition.range?.end?.character!==expectedScriptStart+scriptPathValue.length)
          throw Error("Python main() Definition did not target the exact YAML script: value range: "+
            JSON.stringify(preferredReverseDefinition.range)+", expected line "+
            procedureLine+" columns "+expectedScriptStart+"-"+(expectedScriptStart+scriptPathValue.length));
        const symbolResult=await vscode.commands.executeCommand(
          "vscode.executeDocumentSymbolProvider",scriptUri);
        const symbols=Array.isArray(symbolResult)?symbolResult:[];
        if(!symbols.some(item=>item.name==="main"))
          throw Error("Python Document Symbols did not include main()");
        // ca-skills now owns Python TypedDict/Annotated ABI definitions in
        // source. The historical # inputSchema completion probe applies only
        // to legacy metadata-based scripts; never invent a schema ref for the
        // canonical form when no such file/annotation is declared.
        let schemaCompletion="N/A: Python source annotations";
        if(legacyMetadata){
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
          schemaCompletion="EstablishmentSelectionInput";
        }
        // The native provider probe opened a Python editor. Restore the
        // Procedure CustomEditor so subsequent workbench actions (notably
        // native Undo) continue to target the visual editor under test.
        await vscode.commands.executeCommand("skillStudio.openProcedure",procedureUri);
        return {
          definition:scriptPath,
          yamlDefinitions:{
            entryProcedure:entryTarget.uri?.toString?.()??entryTarget.targetUri?.toString?.()??"",
            predicate:predicateTarget.uri?.toString?.()??predicateTarget.targetUri?.toString?.()??"",
            node:nodeDefinition.length,
            schema:schemaDefinition.length
          },
          yamlHover:predicateHoverText.includes(predicateName),
          yamlReferences:predicateReferences.length,
          yamlProcedureOutline:locations(yamlProcedureSymbols).map(item=>item.name),
          yamlPredicateOutline:locations(yamlPredicateSymbols).map(item=>item.name),
          reverseDefinition:reverseDefinitions.length,
          reverseDefinitionTargets:reverseDefinitions.map(item=>item.uri?.toString?.()??""),
          hover:hovers.length,
          references:references.length,
          symbols:symbols.map(item=>item.name),
          schemaCompletion,
          procedureLanguage:procedureDocument.languageId,
          scriptLanguage:scriptDocument.languageId,
          procedureLine,
          nameLine:legacyMetadata?nameLine:mainLine,
          schemaLine
        };
      }
    ));
  }

  // Internal browser acceptance for the native Problems lifecycle. The
  // edit is temporary, Source-owned by TextDocument/WorkspaceEdit, and split
  // into publish/repair phases so Chromium can inspect the actual Problems UI.
  const languageDiagnosticAcceptance=new Map();
  const languageDiagnosticOwnershipAcceptance=new Map();
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
          assertStudioMutation(procedureUri,vscode.workspace.workspaceFolders??[],"edit");
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

        if(phase==="repair-after-failure"){
          const state=languageDiagnosticAcceptance.get(key);
          if(!state)return {phase,cleared:true,restored:true,skipped:true};
          try{
            const restoredDocument=currentDocument();
            if(!restoredDocument)throw Error("Procedure TextDocument closed during Worker failure");
            if(restoredDocument.getText()!==state.original)
              await replaceSource(state,state.original);
            const diskBeforeClean=new TextDecoder("utf-8",{fatal:true}).decode(
              await vscode.workspace.fs.readFile(procedureUri));
            // Some Theia hosts may auto-save a temporary WorkspaceEdit. Only
            // restore if persisted bytes are either the captured original or
            // the exact malformed probe this command itself wrote.
            if(diskBeforeClean!==state.original&&diskBeforeClean!==state.malformed)
              throw Error("Procedure disk Source changed outside the owned diagnostic probe");
            const cleanupSaved=restoredDocument.isDirty||diskBeforeClean!==state.original;
            if(cleanupSaved&&!await restoredDocument.save())
              throw Error("Native Procedure restoration save was rejected");
            const diskAfterClean=new TextDecoder("utf-8",{fatal:true}).decode(
              await vscode.workspace.fs.readFile(procedureUri));
            if(restoredDocument.isDirty||diskAfterClean!==state.original)
              throw Error("Procedure Source was not restored after Worker failure");
            return {phase,cleared:true,restored:true,originalDiskRestored:true,
              persistedDriftObserved:diskBeforeClean!==state.original,cleanupSaved};
          }finally{
            languageDiagnosticAcceptance.delete(key);
            await vscode.commands.executeCommand("skillStudio.openProcedure",procedureUri);
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


  // Test ownership with an independent host DiagnosticCollection, not a
  // temporary item inside Package Audit (normal audit refresh clears that
  // collection and would create a false SDK-cleanup failure).
  const d4bDiagnosticGuard=new Map();
  if(typeof Worker==="function"&&typeof globalThis.location!=="undefined"&&
     /^(localhost|127(?:\.\d{1,3}){3})$/.test(globalThis.location.hostname)){
    context.subscriptions.push(vscode.commands.registerCommand(
      "skillStudio.internal.languageDiagnosticOwnershipAcceptance",
      async(procedureUriValue,phase="publish")=>{
        const uri=vscode.Uri.parse(String(procedureUriValue??""));
        const key=uri.toString();
        if(phase==="publish"){
          if(d4bDiagnosticGuard.has(key))
            throw Error("L2-D4b diagnostic ownership probe is already active");
          const lsp=languageClient?.diagnosticsForAcceptance(key)??[];
          if(!lsp.some(item=>
            String(item.code?.value??item.code??"")==="PROCEDURE_PROJECTION"))
            throw Error("L2-D4b requires a live LSP Procedure diagnostic");
          const guard=vscode.languages.createDiagnosticCollection(
            "skill-studio-d4b-control");
          const probe=new vscode.Diagnostic(new vscode.Range(0,0,0,1),
            "L2-D4b host-owned diagnostic survives Language Worker termination",
            vscode.DiagnosticSeverity.Warning);
          probe.source="Skill Studio · editor audit";
          probe.code="D4B_HOST_DIAGNOSTIC_OWNERSHIP";
          guard.set(uri,[probe]);
          const hostAudit=diagnostics.get(uri)??[];
          d4bDiagnosticGuard.set(key,{uri,guard,
            auditStatusBefore:auditStatus,auditCountBefore:hostAudit.length});
          return {lspDiagnosticPresent:true,hostProbePresent:true,
            hostDiagnosticCount:guard.get(uri)?.length??0,
            packageAuditStatus:auditStatus,packageAuditCount:hostAudit.length};
        }
        const state=d4bDiagnosticGuard.get(key);
        if(!state)return {phase,skipped:true};
        if(phase==="verify"){
          const controls=state.guard.get(uri)??[];
          const visible=vscode.languages.getDiagnostics(uri);
          const lspCollectionPresent=languageClient?.hasDiagnosticCollectionForAcceptance()??false;
          const lspStillVisible=visible.some(item=>
            String(item.code?.value??item.code??"")==="PROCEDURE_PROJECTION"&&
            item.source==="Skill Studio · procedure-projection");
          const hostProbePresent=controls.some(item=>
            String(item.code?.value??item.code??"")==="D4B_HOST_DIAGNOSTIC_OWNERSHIP");
          const auditAfter=diagnostics.get(uri)??[];
          if(lspCollectionPresent||lspStillVisible||!hostProbePresent)
            throw Error("L2-D4b diagnostic ownership failed: "+JSON.stringify({
              lspCollectionPresent,lspStillVisible,hostProbePresent,
              auditStatus,auditCount:auditAfter.length
            }));
          return {lspCollectionDisposed:true,lspDiagnosticCleared:true,
            independentHostCollectionPreserved:true,
            auditStatusBefore:state.auditStatusBefore,
            auditStatusAfter:auditStatus,
            auditCountBefore:state.auditCountBefore,
            auditCountAfter:auditAfter.length};
        }
        if(phase==="restore"){
          try{state.guard.dispose();}
          finally{d4bDiagnosticGuard.delete(key);}
          return {restored:true};
        }
        throw Error("Unknown diagnostic ownership phase: "+String(phase));
      }
    ));
    context.subscriptions.push({dispose(){
      for(const state of d4bDiagnosticGuard.values())state.guard.dispose();
      d4bDiagnosticGuard.clear();
    }});
  }

  // End-to-end recovery probe: a dirty Python buffer must be rehydrated
  // into the replacement Worker, observed through native LSP Hover, and then
  // restored without persisting the temporary edit.
  const languageRecoveryAcceptance=new Map();
  if(typeof Worker==="function"&&typeof globalThis.location!=="undefined"&&
     /^(localhost|127(?:\.\d{1,3}){3})$/.test(globalThis.location.hostname)){
    context.subscriptions.push(vscode.commands.registerCommand(
      "skillStudio.internal.languageRecoveryAcceptance",
      async(procedureUriValue,phase="prepare")=>{
        const procedureUri=vscode.Uri.parse(String(procedureUriValue??""));
        const procedure=await vscode.workspace.openTextDocument(procedureUri);
        const root=packageRootForProcedure(vscode,procedure);
        const state=root?languagePackages.get(root.uri.toString()):null;
        if(!state||state.disposed)throw Error("L2-D4b active Package state missing");
        const scriptUri=vscode.Uri.joinPath(root.uri,"scripts",
          "select_establishment_configuration.py");
        const disk=async()=>new TextDecoder("utf-8",{fatal:true}).decode(
          await vscode.workspace.fs.readFile(scriptUri));
        const replace=async(doc,value)=>{
          const edit=new vscode.WorkspaceEdit();
          edit.replace(doc.uri,new vscode.Range(doc.positionAt(0),
            doc.positionAt(doc.getText().length)),value);
          assertStudioMutation(doc.uri,vscode.workspace.workspaceFolders??[],"edit");
           if(!await vscode.workspace.applyEdit(edit))
            throw Error("L2-D4b native Python WorkspaceEdit was rejected");
        };
        if(phase==="prepare"){
          if(!languageTransportFailure||
             languageStatusItem?.text!=="SKILL LSP: UNAVAILABLE")
            throw Error("L2-D4b recovery preparation requires terminal Worker failure");
          const doc=await vscode.workspace.openTextDocument(scriptUri);
          const original=doc.getText();
          const persisted=await disk();
          if(doc.isDirty||persisted!==original)
            throw Error("L2-D4b Python recovery baseline is not clean");
          const oldName="# name: select-establishment-configuration";
          const legacyMetadata=original.includes(oldName);
          const newName=legacyMetadata
            ?"# name: select-establishment-configuration-l2d4-recovered"
            :"# l2d4-recovered";
          if(!legacyMetadata&&!/^(?:async )?def main\(/m.test(original))
            throw Error("L2-D4b canonical Python main() is missing");
          if(languageRecoveryAcceptance.has(procedureUri.toString()))
            throw Error("L2-D4b dirty-buffer recovery probe is already active");
          const modified=legacyMetadata?original.replace(oldName,newName)
            :original+"\n"+newName+"\n";
          await replace(doc,modified);
          if(!doc.isDirty||!doc.getText().includes(newName)||await disk()!==original)
            throw Error("L2-D4b failed to prepare an unsaved Python buffer");
          languageRecoveryAcceptance.set(procedureUri.toString(),{
            procedure,doc,state,original,newName,legacyMetadata
          });
          return {dirtyBufferPrepared:true,pythonVersion:doc.version,
            originalDiskUnchanged:true,marker:newName};
        }
        if(phase==="abort-and-restore"){
          const key=procedureUri.toString();
          const prepared=languageRecoveryAcceptance.get(key);
          if(!prepared)return {phase,skipped:true,restored:true};
          try{
            if(prepared.doc.getText()!==prepared.original)
              await replace(prepared.doc,prepared.original);
            if(await disk()!==prepared.original)
              throw Error("Python disk bytes changed before abort restoration");
            if(prepared.doc.isDirty&&!await prepared.doc.save())
              throw Error("Aborted recovery could not save restored Python Source");
            if(prepared.doc.isDirty||await disk()!==prepared.original)
              throw Error("Aborted recovery did not restore clean Python Source");
            return {phase,restored:true,originalDiskUnchanged:true};
          }finally{
            languageRecoveryAcceptance.delete(key);
            await vscode.commands.executeCommand("skillStudio.openProcedure",procedureUri);
          }
        }
        if(phase==="verify-and-restore"){
          const key=procedureUri.toString();
          const prepared=languageRecoveryAcceptance.get(key);
          if(!prepared)throw Error("L2-D4b dirty Python recovery probe is missing");
          let evidence=null;
          try{
            const status=await waitForLanguagePackageStatus(
              prepared.state,prepared.state.generation
            );
            if(status.state!=="READY")
              throw Error("Recovered Package is not READY: "+status.state);
            if(!prepared.doc.isDirty||
               !prepared.doc.getText().includes(prepared.newName)||
               await disk()!==prepared.original)
              throw Error("Recovery changed or discarded the unsaved Python buffer");
            const snapshot=await collectPackageSnapshot(
              vscode,prepared.procedure,prepared.state.generation
            );
            const script=snapshot.documents.find(item=>
              item.relativePath==="scripts/select_establishment_configuration.py");
            if(!script||script.text!==prepared.doc.getText()||
               script.version!==prepared.doc.version)
              throw Error("Recovered Package snapshot did not use the current dirty Python TextDocument");
            const lines=prepared.procedure.getText().split(/\r\n|\n|\r/);
            const target="scripts/select_establishment_configuration.py";
            const line=lines.findIndex(value=>value.includes("script: "+target));
            if(line<0)throw Error("L2-D4b Procedure script reference is missing");
            const character=lines[line].indexOf(target)+12;
            const hover=await vscode.commands.executeCommand(
              "vscode.executeHoverProvider",procedureUri,new vscode.Position(line,character));
            const hoverText=(Array.isArray(hover)?hover:hover?[hover]:[])
              .flatMap(item=>Array.isArray(item?.contents)?item.contents:[item?.contents])
              .map(item=>typeof item==="string"?item:item?.value??String(item??""))
              .join(" ");
            const expectedHover=prepared.legacyMetadata
              ?prepared.newName.slice("# name: ".length)
              :"scripts/select_establishment_configuration.py";
            if(!hoverText.includes(expectedHover))
              throw Error("Replacement Worker Hover did not resolve the current Python script: "+
                hoverText.slice(0,500));
            evidence={
              recovered:true,packageState:status.state,
              generation:status.generation,
              dirtyPythonRehydrated:true,pythonVersion:script.version,
              hoverReflectsUnsavedMetadata:true,originalDiskUnchanged:true
            };
          }finally{
            const cleanup=[];
            try{
              if(prepared.doc.getText()!==prepared.original)
                await replace(prepared.doc,prepared.original);
              if(await disk()!==prepared.original)
                throw Error("Python disk bytes changed before restoration");
              if(prepared.doc.isDirty&&!await prepared.doc.save())
                throw Error("Restored Python Source save was rejected");
              if(prepared.doc.isDirty||await disk()!==prepared.original)
                throw Error("Python Source did not return to its original clean state");
              const before=prepared.state.generation;
              scheduleLanguagePackageRefresh(prepared.state,true);
              const generation=prepared.state.generation;
              await waitForLanguagePackageStatus(prepared.state,generation);
              if(prepared.doc.getText()!==prepared.original||
                 await disk()!==prepared.original)
                throw Error("Python Source changed after post-recovery reanalysis");
              if(generation<=before)throw Error("Post-recovery restoration did not advance Package generation");
            }catch(error){cleanup.push(String(error?.message??error));}
            languageRecoveryAcceptance.delete(key);
            try{await vscode.commands.executeCommand("skillStudio.openProcedure",procedureUri);}
            catch(error){cleanup.push("Procedure focus: "+String(error?.message??error));}
            if(cleanup.length)throw Error("L2-D4b recovery cleanup failed: "+cleanup.join("; "));
          }
          return {...evidence,restored:true};
        }
        throw Error("Unknown L2-D4b recovery phase: "+String(phase));
      }
    ));
  }

  // Real host-registry lifecycle probe with a temporary sibling Package.
  // It creates two references to Package B, verifies first-release retention,
  // final close, and same-root reopen with a strictly newer generation.
  const languagePackageLifecycleAcceptance=new Map();
  if(typeof Worker==="function"&&typeof globalThis.location!=="undefined"&&
     /^(localhost|127(?:\.\d{1,3}){3})$/.test(globalThis.location.hostname)){
    context.subscriptions.push(vscode.commands.registerCommand(
      "skillStudio.internal.languagePackageLifecycleAcceptance",
      async(procedureUriValue,phase="prepare")=>{
        const procedureUri=vscode.Uri.parse(String(procedureUriValue??""));
        const key=procedureUri.toString();
        if(phase==="prepare"){
          if(!languageTransportFailure||
             languageStatusItem?.text!=="SKILL LSP: UNAVAILABLE")
            throw Error("L2-D4b Package lifecycle probe requires terminal Worker failure");
          if(languagePackageLifecycleAcceptance.has(key))
            throw Error("L2-D4b Package lifecycle probe is already active");
          const procedure=await vscode.workspace.openTextDocument(procedureUri);
          const sourceRoot=packageRootForProcedure(vscode,procedure);
          if(!sourceRoot)throw Error("L2-D4b source Package root is missing");
          // Theia's workspace folder can BE the Package A root. Use the
          // parent of that exact root so B is a true sibling, not a nested
          // subdirectory enumerated into A's Package snapshot.
          const sourcePath=sourceRoot.uri.path.replace(/\/$/,"");
          const parentPath=sourcePath.slice(0,sourcePath.lastIndexOf("/"))||"/";
          const parentUri=sourceRoot.uri.with({path:parentPath});
          const suffix=Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,8);
          const packageBContainer=vscode.Uri.joinPath(
            parentUri,"skill-studio-l2d4b-"+suffix);
          // Keep the leaf Package name equal to the copied SKILL/contract name.
          const packageBRoot=vscode.Uri.joinPath(
            packageBContainer,"establish-pdu-session");
          if(languagePackageContains(sourceRoot.uri,packageBRoot)||
             languagePackageContains(packageBRoot,sourceRoot.uri))
            throw Error("L2-D4b requires two non-nested Package roots");
          const fs=vscode.workspace.fs;
          const releases=[];
          try{
            const found=await vscode.workspace.findFiles(
              new vscode.RelativePattern(sourceRoot.uri,"**/*"),
              "**/{node_modules,.git,.venv,__pycache__}/**",501
            );
            if(!found.length||found.length>500)
              throw Error("L2-D4b could not enumerate a bounded source Package");
            await fs.createDirectory(packageBRoot);
            const createdDirectories=new Set([packageBRoot.toString()]);
            for(const uri of found){
              if(!uri.path.startsWith(sourceRoot.uri.path.replace(/\/$/,"")+"/"))continue;
              const relative=uri.path.slice(sourceRoot.uri.path.replace(/\/$/,"").length+1);
              const parts=relative.split("/");
              if(!relative||parts.some(part=>!part||part==="."||part===".."))
                throw Error("L2-D4b source Package contains an unsafe relative path");
              for(let i=1;i<parts.length;i++){
                const directory=vscode.Uri.joinPath(packageBRoot,...parts.slice(0,i));
                if(!createdDirectories.has(directory.toString())){
                  await fs.createDirectory(directory);
                  createdDirectories.add(directory.toString());
                }
              }
              const destination=vscode.Uri.joinPath(packageBRoot,...parts);
              await fs.writeFile(destination,await fs.readFile(uri));
            }
            const procedureBUri=vscode.Uri.joinPath(packageBRoot,
              "assurance","procedure.yaml");
            const procedureB=await vscode.workspace.openTextDocument(procedureBUri);
            const releaseOne=attachLanguagePackage(procedureB);
            releases.push(releaseOne);
            const packageBKey=packageBRoot.toString();
            const packageBState=languagePackages.get(packageBKey);
            if(!packageBState)throw Error("L2-D4b Package B was not registered");
            const releaseTwo=attachLanguagePackage(procedureB);
            releases.push(releaseTwo);
            if(packageBState.refs!==2)
              throw Error("L2-D4b Package B did not acquire two editor references");
            languagePackageLifecycleAcceptance.set(key,{
              packageBRoot,packageBContainer,packageBKey,procedureB,packageBState,releases,
              sourceFileCount:found.length
            });
            return {packageARoot:sourceRoot.uri.toString(),packageBRoot:packageBKey,
              distinctNonNestedRoots:true,sourceFileCount:found.length,
              references:packageBState.refs,created:true};
          }catch(error){
            for(const release of releases.reverse())try{release();}catch{}
            try{await fs.delete(packageBContainer,{recursive:true,useTrash:false});}catch{}
            throw error;
          }
        }
        const prepared=languagePackageLifecycleAcceptance.get(key);
        if(!prepared)throw Error("L2-D4b Package lifecycle fixture is missing");
        if(phase==="abort-and-clean"){
          try{
            for(const release of [...prepared.releases].reverse())try{release();}catch{}
            await vscode.workspace.fs.delete(prepared.packageBContainer,
              {recursive:true,useTrash:false});
            languagePackageGenerations.delete(prepared.packageBKey);
            languagePackageStatuses.delete(prepared.packageBKey);
            return {phase,cleaned:true};
          }finally{languagePackageLifecycleAcceptance.delete(key);}
        }
        if(phase==="verify-and-close"){
          try{
            const status=await waitForLanguagePackageStatus(
              prepared.packageBState,prepared.packageBState.generation
            );
            if(status.state!=="READY")
              throw Error("Recovered Package B is not READY: "+status.state);
            const initialGeneration=prepared.packageBState.generation;
            prepared.releases[0]();
            if(prepared.packageBState.refs!==1||
               languagePackages.get(prepared.packageBKey)!==prepared.packageBState)
              throw Error("Closing the first Package B editor reference closed the active Package");
            prepared.releases[1]();
            if(languagePackages.has(prepared.packageBKey))
              throw Error("Closing the final Package B editor reference retained the Package");
            const generationBeforeReopen=languagePackageGenerations.get(
              prepared.packageBKey
            )??0;
            const releaseReopened=attachLanguagePackage(prepared.procedureB);
            prepared.releases.push(releaseReopened);
            const reopened=languagePackages.get(prepared.packageBKey);
            if(!reopened||reopened.generation<=generationBeforeReopen)
              throw Error("Reopened Package B did not advance its retained generation");
            const reopenedStatus=await waitForLanguagePackageStatus(
              reopened,reopened.generation
            );
            if(reopenedStatus.state!=="READY")
              throw Error("Reopened Package B is not READY: "+reopenedStatus.state);
            releaseReopened();
            return {twoPackageRecovery:true,packageBReady:true,
              firstReferenceRetained:true,finalCloseRemoved:true,
              initialGeneration,reopenGeneration:reopened.generation,
              generationMonotonic:reopened.generation>generationBeforeReopen,
              cleaned:true};
          }finally{
            for(const release of [...prepared.releases].reverse())try{release();}catch{}
            try{await vscode.workspace.fs.delete(prepared.packageBContainer,
              {recursive:true,useTrash:false});}catch{}
            languagePackageGenerations.delete(prepared.packageBKey);
            languagePackageStatuses.delete(prepared.packageBKey);
            languagePackageLifecycleAcceptance.delete(key);
          }
        }
        throw Error("Unknown Package lifecycle acceptance phase: "+String(phase));
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
        const transientRead=error=>/\b(?:EIO|ENOENT|EntryNotFound)\b/i.test(
          String(error?.message??error));
        // OPFS-backed Theia can briefly fail a read or open during Package
        // import/refresh. Retry ONLY the same read, at most three times. A
        // missing or persistently faulty file still fails the real acceptance.
        const readStable=async(operation,label)=>{
          for(let attempt=0;attempt<3;attempt++){
            try{return await operation();}
            catch(error){
              if(!transientRead(error)||attempt===2)
                throw Error("L2-D3 "+label+" failed after "+(attempt+1)+
                  " attempt(s): "+String(error?.message??error));
              await new Promise(resolve=>setTimeout(resolve,100*(attempt+1)));
            }
          }
          throw Error("L2-D3 Source read did not complete: "+label);
        };
        const disk=async uri=>new TextDecoder("utf-8",{fatal:true}).decode(
          await readStable(()=>vscode.workspace.fs.readFile(uri),
            "persistent read "+uri.path));
        const replace=async(doc,value)=>{
          if(doc.getText()===value)return;
          const edit=new vscode.WorkspaceEdit();
          edit.replace(doc.uri,new vscode.Range(doc.positionAt(0),
            doc.positionAt(doc.getText().length)),value);
          assertStudioMutation(doc.uri,vscode.workspace.workspaceFolders??[],"edit");
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
        const collectStableSnapshot=async generation=>{
          for(let attempt=0;attempt<3;attempt++){
            const snapshot=await collectPackageSnapshot(vscode,procedure,generation);
            if(snapshot.completeness==="complete")return snapshot;
            if(!transientRead(snapshot.reason)||attempt===2)
              throw Error("L2-D3: incomplete Package snapshot after "+
                (attempt+1)+" attempt(s): "+snapshot.reason);
            // OPFS may enumerate a just-written reference before its bytes are
            // readable. Retry the same generation only for transient FS errors.
            await new Promise(resolve=>setTimeout(resolve,100*(attempt+1)));
          }
          throw Error("L2-D3: Package snapshot did not become complete");
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
        let evidence=null,legacyMetadata=false;
        try{
          for(const [name,path] of paths){
            const uri=vscode.Uri.joinPath(root.uri,...path.split("/"));
            const doc=await readStable(
              ()=>vscode.workspace.openTextDocument(uri),"open "+path);
            await readStable(
              ()=>openNativeSource(vscode,uri,{preview:true}),"editor "+path);
            const original=doc.getText();
            if(doc.isDirty||await disk(uri)!==original)
              throw Error("L2-D3: initial "+name+" Source is not clean");
            entries.push({name,path,uri,doc,original});
          }
          const before=state.generation;
          const [contract,predicates,python]=entries;
          const old="# name: select-establishment-configuration";
          legacyMetadata=python.original.includes(old);
          const first=legacyMetadata
            ?"# name: select-establishment-configuration-l2d3-first"
            :"# l2d3-first";
          const latest=legacyMetadata
            ?"# name: select-establishment-configuration-l2d3-latest"
            :"# l2d3-latest";
          if(!legacyMetadata&&!/^(?:async )?def main\(/m.test(python.original))
            throw Error("L2-D3: canonical Python main() is missing");
          await replace(contract.doc,contract.original+"\n# l2d3 unsaved contract probe\n");
          await replace(predicates.doc,predicates.original+"\n# l2d3 unsaved predicate probe\n");
          await replace(python.doc,legacyMetadata?python.original.replace(old,first)
            :python.original+"\n"+first+"\n");
          await replace(python.doc,legacyMetadata?python.original.replace(old,latest)
            :python.original+"\n"+latest+"\n");
          const generation=await ready(before,"cross-file edits");
          const snapshot=await collectStableSnapshot(generation);
          const covered=[];
          for(const entry of entries){
            const match=snapshot.documents.find(x=>x.relativePath===entry.path);
            if(!entry.doc.isDirty||!match||match.text!==entry.doc.getText()||
               match.version!==entry.doc.version||await disk(entry.uri)!==entry.original)
              throw Error("L2-D3: dirty "+entry.name+" was lost or persisted");
            covered.push({name:entry.name,version:match.version,dirty:true});
          }
          const hover=await getHover();
          const expectedHover=legacyMetadata
            ?"-l2d3-latest":"scripts/select_establishment_configuration.py";
          if(!hover.includes(expectedHover)||
             (legacyMetadata&&hover.includes("-l2d3-first")))
            throw Error("L2-D3: native Hover lost current Script identity after rapid Python edit: "+
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
                const expectedRestored=legacyMetadata
                  ?"select-establishment-configuration"
                  :"scripts/select_establishment_configuration.py";
                if((legacyMetadata&&hover.includes("-l2d3-"))||
                   !hover.includes(expectedRestored))
                  problems.push("native Hover retained stale Script identity");
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
          assertStudioMutation(uri,vscode.workspace.workspaceFolders??[],"edit");
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
    assertStudioMutation(doc.uri,vscode.workspace.workspaceFolders??[],"edit");
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

  async function editPhaseOutputReference(item,bindingKey,newValue){
    if(item?.kind!=='phase-output-reference'||
       typeof item.phaseName!=='string'||!Number.isSafeInteger(item.stepIndex)||
       !Number.isSafeInteger(item.sourceVersion))
      throw Error("Select a current eligible Phase output reference in the native Inspector");
    const ctx=currentNode(item);
    const options=phaseOutputReferenceOptions(ctx.source,ctx.procedureId,ctx.nodeId)
      .filter(x=>x.phaseName===item.phaseName&&x.stepIndex===item.stepIndex&&
        x.bindingKey===(bindingKey??item.bindingKey));
    if(options.length!==1)throw Error("Output reference is no longer uniquely eligible");
    const reference=options[0];
    let value=newValue;
    if(typeof value!=='string'){
      const picked=await vscode.window.showQuickPick(
        reference.choices.filter(choice=>choice!==reference.value).map(choice=>({
          label:choice,
          description:choice.startsWith(reference.producerPhase+".")
            ?"本地 Phase 引用":"完整 Node + Phase 引用",
          detail:"同一生产 Node / Phase Step / output suffix"
        })),{placeHolder:"选择同一生产 Step 的输出引用写法"});
      value=typeof picked==='string'?picked:picked?.label;
    }
    if(typeof value!=='string'||!value.trim())return false;
    if(ctx.doc.version!==ctx.version||ctx.doc.getText()!==ctx.source)
      throw Error("Source changed while choosing the output reference form");
    const preview=previewPhaseOutputReference(ctx.source,ctx.procedureId,ctx.nodeId,
      item.phaseName,item.stepIndex,reference.bindingKey,value);
    const applied=await confirmAndApply({
      ...ctx,preview,
      changes:p=>[{
        start:p.sourceSpan.start,end:p.sourceSpan.end,
        oldValue:p.oldValue,newValue:p.newValue
      }],
      verify:text=>applyPhaseOutputReference(text,preview)
    });
    if(applied)update(ctx.doc);
    return applied;
  }

  async function editPhaseRouteTarget(item,newTarget){
    if(item?.kind!=='route'||typeof item.routeId!=='string'||
       !Number.isSafeInteger(item.sourceVersion))
      throw Error("Select a current eligible Phase failure/unknown Route");
    const ctx=currentNode(item);
    const option=phaseRouteTargetOptions(ctx.source,ctx.procedureId,ctx.nodeId)
      .find(candidate=>candidate.routeId===item.routeId);
    if(!option?.targets?.length)
      throw Error("Phase Route has no Source-observed eligible target");
    let target=newTarget;
    if(typeof target!=='string'){
      const picked=await vscode.window.showQuickPick(
        option.targets.map(value=>({label:value,
          description:option.phaseName+'.on · '+option.outcome,
          detail:'来自同 Procedure、同 Phase、同 Outcome 的现有 Route'})),
        {placeHolder:"选择已在当前 Source 出现的 Phase Route 目标"});
      target=typeof picked==='string'?picked:picked?.label;
    }
    if(typeof target!=='string'||!target.trim())return false;
    if(ctx.doc.version!==ctx.version||ctx.doc.getText()!==ctx.source)
      throw Error("Source changed while choosing the Phase Route target");
    const preview=previewPhaseRouteTarget(ctx.source,ctx.procedureId,
      item.routeId,target);
    const applied=await confirmAndApply({
      ...ctx,preview,changes:singleSourceChange,
      verify:text=>applyPhaseRouteTarget(text,preview)
    });
    if(applied)update(ctx.doc);
    return applied;
  }

  async function repairPhaseOutcome(item,requestedAction){
    if(item?.kind!=='phase-outcome-repair'||typeof item.phaseName!=='string'||
       !Number.isSafeInteger(item.sourceVersion))
      throw Error('Select a current eligible Phase Outcome repair in native Inspector');
    const ctx=currentNode(item);
    const phase=phaseOutcomeEditOptions(ctx.source,ctx.procedureId,ctx.nodeId)
      .find(option=>option.phaseName===item.phaseName);
    if(!phase)throw Error('Phase Outcome Source is not qualified for repair');
    const actions=[
      ...phase.adds.map(option=>({mode:'add',outcome:option.outcome,target:option.target,
        label:'补齐 '+option.outcome,description:'→ '+option.target})),
      ...phase.renames.map(option=>({mode:'rename',oldOutcome:option.oldOutcome,
        newOutcome:option.newOutcome,target:option.target,
        label:'纠正 '+option.oldOutcome+' → '+option.newOutcome,
        description:'现有目标 '+option.target})),
      ...phase.deletions.map(option=>({mode:'delete',outcome:option.outcome,
        target:option.target,label:'删除非核心 '+option.outcome,
        description:'当前目标 '+option.target}))
    ];
    if(!actions.length)throw Error('No owner-observed Phase Outcome repair is available');
    let choice=requestedAction;
    if(choice===undefined){
      const picked=await vscode.window.showQuickPick(actions.map(action=>({
        label:action.label,description:action.description,
        detail:'仅修复当前 Source 已证明的 Outcome；不代表 Runtime Outcome 完整性',
        spec:action
      })),{placeHolder:'选择可证明的 Phase Outcome 修复'});
      choice=picked?.spec??null;
    }
    if(choice===null)return false;
    const identity=action=>JSON.stringify([
      action?.mode??null,action?.outcome??null,action?.oldOutcome??null,
      action?.newOutcome??null,action?.target??null]);
    const selected=actions.find(action=>identity(action)===identity(choice));
    if(!selected)throw Error('Phase Outcome action is not qualified by current Source');
    if(ctx.doc.version!==ctx.version||ctx.doc.getText()!==ctx.source)
      throw Error('Source changed while selecting Phase Outcome repair');
    const {source,procedureId,nodeId}=ctx,phaseName=item.phaseName;
    let preview,verify;
    if(selected.mode==='add'){
      preview=previewAddObservedPhaseOutcome(source,procedureId,nodeId,phaseName,
        selected.outcome,selected.target);
      verify=text=>applyAddObservedPhaseOutcome(text,preview);
    }else if(selected.mode==='rename'){
      preview=previewRenameNoncorePhaseOutcome(source,procedureId,nodeId,phaseName,
        selected.oldOutcome,selected.newOutcome);
      verify=text=>applyRenameNoncorePhaseOutcome(text,preview);
    }else if(selected.mode==='delete'){
      preview=previewDeleteNoncorePhaseOutcome(source,procedureId,nodeId,phaseName,
        selected.outcome);
      verify=text=>applyDeleteNoncorePhaseOutcome(text,preview);
    }else throw Error('Unsupported Phase Outcome action');
    const applied=await confirmAndApply({
      ...ctx,preview,changes:singleSourceChange,verify
    });
    if(applied)update(ctx.doc);
    return applied;
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
        if(item.kind==='route'&&id==='inspection'&&document){
          const canInsert=Boolean(insertNodeOptions(
            document.getText(),item.procedureId,item.routeId));
          const canRetarget=Array.isArray(item.phaseTargetChoices)&&
            item.phaseTargetChoices.length>0;
          if(canRetarget)
            tree.contextValue=canInsert
              ?'skillStudio.routeAndPhaseTarget':'skillStudio.phaseRouteTarget';
          else if(canInsert)tree.contextValue='skillStudio.route';
          if(canInsert||canRetarget){
            item.sourceVersion=document.version;
            item.documentUri=document.uri.toString();
            for(const key of ['procedureId','nodeId','routeId','phaseName',
              'routeSource','outcome','target','phaseTargetChoices'])
              tree[key]=item[key];
            tree.sourceVersion=item.sourceVersion;
            tree.documentUri=item.documentUri;
          }
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
        if(item.kind==='phase-outcome-repair'&&id==='inspection'&&document){
          tree.contextValue='skillStudio.phaseOutcomeRepair';
          item.sourceVersion=document.version;
          item.documentUri=document.uri.toString();
          tree.procedureId=item.procedureId;tree.nodeId=item.nodeId;
          tree.phaseName=item.phaseName;tree.sourceVersion=item.sourceVersion;
          tree.documentUri=item.documentUri;
        }
        if(item.kind==='phase-output-reference'&&id==='inspection'&&document){
          tree.contextValue='skillStudio.phaseOutputReference';
          item.sourceVersion=document.version;item.documentUri=document.uri.toString();
          for(const key of ['procedureId','nodeId','phaseName','stepIndex',
            'bindingKey','currentValue','choices','producerPhase','producerStep',
            'producerStepIndex','outputSuffix'])
            tree[key]=item[key];
          tree.sourceVersion=item.sourceVersion;tree.documentUri=item.documentUri;
        }
        if(document&&item.line)tree.command={command:'skillStudio.revealInspection',title:'Reveal Source',arguments:[{...item,uri:item.uri??document.uri,version:document.version,sourceVersion:document.version,documentUri:document.uri.toString(),...(item.uri?{auditGeneration:generation}:{})}]};
        return tree;
      }};
    providers.set(id,emitter);
    context.subscriptions.push(emitter,vscode.window.registerTreeDataProvider('skillStudio.'+id,provider));
  }
  const fire=()=>{for(const p of providers.values())p.fire();};
  // Audit status belongs to Problems. Do not refresh every source tree for
  // status-only changes: concurrent root refreshes can invalidate an expanded
  // Evidence node while its lazy children are being resolved.
  const fireProblems=()=>providers.get('problems')?.fire();
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
    // An explicit audit supersedes a pending debounced audit. Letting both
    // run concurrently can race their package snapshots and tree refreshes.
    clearTimeout(timer);timer=undefined;
    const doc=document,version=doc.version,ticket=++generation;
    auditStatus="Package Audit · running";fireProblems();
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
      fireProblems();
    }catch(error){
      if(ticket!==generation)return;
      packageFiles=null;packageFilesUri=null;packageFilesVersion=-1;
      auditStatus='Package Audit · unavailable';
      audit=[{message:'Audit unavailable: '+error.message,line:1,uri:doc.uri}];
      diagnostics.clear();update(doc);fireProblems();
    }
  }
  function scheduleAudit(){
    generation++;clearTimeout(timer);
    packageFiles=null;packageFilesUri=null;packageFilesVersion=-1;
    auditStatus="Package Audit · pending";audit=[];diagnostics.clear();
    if(document)update(document);
    timer=setTimeout(()=>void auditCurrent(),350);fireProblems();
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
    vscode.commands.registerCommand('skillStudio.editPhaseOutputReference',async(item,bindingKey,newValue)=>{
      try{return await editPhaseOutputReference(item,bindingKey,newValue);}
      catch(error){await vscode.window.showWarningMessage('Phase Output Reference 修改未执行：'+error.message);return false;}
    }),
    vscode.commands.registerCommand('skillStudio.editPhaseRouteTarget',async(item,newTarget)=>{
      try{return await editPhaseRouteTarget(item,newTarget);}
      catch(error){await vscode.window.showWarningMessage('Phase Route 修改未执行：'+error.message);return false;}
    }),
    vscode.commands.registerCommand('skillStudio.repairPhaseOutcome',async(item,requestedAction)=>{
      try{return await repairPhaseOutcome(item,requestedAction);}
      catch(error){
        await vscode.window.showWarningMessage('Phase Outcome 修复未执行：'+error.message);
        return false;
      }
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
  registerNativeMarkdown(vscode,context);
  // Internal acceptance probe reports the authoritative VS Code TextDocument
  // version; the custom-editor webview's display revision is not that version.
  context.subscriptions.push(vscode.commands.registerCommand(
    'skillStudio.internal.sourceVersionAcceptance',()=>({
      uri:document?.uri.toString()??null,
      version:document?.version??null
    })));
  context.subscriptions.push(vscode.commands.registerCommand(
    'skillStudio.internal.selectionAcceptance',()=>({
      uri:document?.uri.toString()??null,
      version:document?.version??null,
      procedureId:selection?.procedureId??null,
      nodeId:selection?.nodeId??null,
      snapshotState:snapshot?.model?.state??null,
      lastSelectionMessage
    })));
  // Internal real-browser acceptance opens the owner-pinned conventional guide
  // by exact workspace path; it is not a contributed user command.
  context.subscriptions.push(vscode.commands.registerCommand(
    'skillStudio.internal.markdownNavigationAcceptance',async skillName=>{
      const name=typeof skillName==='string'?skillName:'establish-pdu-session';
      if(!/^[a-z0-9-]+$/.test(name))throw Error('Invalid Skill sample name');
      const matches=await vscode.workspace.findFiles(
        '**/'+name+'/SKILL.md','**/node_modules/**',5);
      const exact=matches.filter(item=>item.path.endsWith('/'+name+'/SKILL.md'));
      if(exact.length!==1)
        throw Error('Expected exactly one '+name+' guide in the active Workspace');
      await vscode.commands.executeCommand('vscode.open',exact[0],{
        viewColumn:vscode.ViewColumn.One,preview:false
      });
      return exact[0].toString();
    }));
  return {attach(doc,post){
    sessions.set(doc.uri.toString(),post);update(doc);scheduleAudit();
    const releaseLanguagePackage=attachLanguagePackage(doc);
    return ()=>{sessions.delete(doc.uri.toString());releaseLanguagePackage();};
  },select(doc,message){
    lastSelectionMessage={
      messageVersion:message.version,documentVersion:doc.version,
      procedureId:message.procedureId??null,nodeId:message.nodeId??null,
      accepted:message.version===doc.version&&typeof message.procedureId==='string'
    };
    if(message.version!==doc.version||typeof message.procedureId!=='string')return;
    update(doc,{procedureId:message.procedureId,nodeId:typeof message.nodeId==='string'?message.nodeId:null});
  },activate(doc){
    const changed=document?.uri.toString()!==doc.uri.toString()||snapshot?.text!==doc.getText();
    update(doc);if(changed)scheduleAudit();
    const rootInfo=packageRootForProcedure(vscode,doc);
    const state=rootInfo?languagePackages.get(rootInfo.uri.toString()):null;
    if(state){state.procedureDocument=doc;scheduleLanguagePackageRefresh(state);}
  },getActiveDocument(){return document;}};
}
