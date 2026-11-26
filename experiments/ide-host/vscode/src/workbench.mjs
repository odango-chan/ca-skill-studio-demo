import {openNativeSource} from "./native-source.mjs";
import {diagnosticSourcePosition} from "./diagnostic-navigation.mjs";
import {reconcileProblemDiagnostics} from "./problem-diagnostics.mjs";

import {staticPreviewResourceUrl} from "./webview-resource-url.mjs";
import {assertStudioMutation} from "./project-policy.mjs";
import {inspectionSnapshot} from './inspection.mjs';
import {analyzeCurrentSource} from "../../../../language/core/source.ts";
import {indexV1Alpha4ToolCatalogCallables}
  from '../../../../site/package-audit.mjs';
import {isProcedurePath,MAX_SOURCE_BYTES} from './bridge.mjs';
import {buildPackageZip,bytesToBase64} from '../../../../site/package-zip-export.mjs';
import {resolveLockedDependencies} from "./dependency-service.mjs";
import {readProjectConfiguration} from "./project-configuration.mjs";
import {decodeBase64} from "./dependency-snapshot.mjs";
import {projectLockedInterfaceCompletionHints}
  from "./interface-schema-completion.mjs";
import {collectPackageSnapshot,packageRootForProcedure} from "./package-snapshot.mjs";
import {resolveSemanticTokenSourcePath} from "./semantic-token-path.mjs";
import {
  collectSkillSemanticTokenSpans,
  SKILL_SEMANTIC_TOKEN_TYPES,
  SKILL_SEMANTIC_TOKEN_MODIFIERS
} from "../../../../language/semantic-tokens.mjs";
import studioLightTheme from "../../../../extensions/skill-studio-theme/themes/skill-studio-light-color-theme.json";
import {createSemanticTokenDecorationRenderer}
  from "../../lsp-browser/client/src/semantic-token-decorations.mjs";
import {createPackageLanguageLifecycle}
  from "./package-language-lifecycle.mjs";
import {LanguageDiagnosticSession} from "../../../../language/lsp/session.ts";

export function registerWorkbench(vscode,context,{prepareToolContract,compilerProblemsProvider}={}){
  const isTheiaHost=(typeof STUDIO_THEIA_HOST!=="undefined"&&STUDIO_THEIA_HOST)||
    /theia/i.test(String(vscode.env?.appName??""));
  const browserLanguageWorkerAvailable=typeof Worker==="function"&&
    typeof globalThis.location!=="undefined";
  const useInProcessLanguageService=isTheiaHost&&!browserLanguageWorkerAvailable;
  let document=null,selection={},snapshot=null,predicateSnapshot=null,
    predicateGeneration=0,audit=[],auditStatus="Package Audit · not run",generation=0,
    lastSelectionMessage=null;
  const localDiagnosticCollection=useInProcessLanguageService&&
    typeof vscode.languages?.createDiagnosticCollection==="function"
      ?vscode.languages.createDiagnosticCollection("skillStudioLanguageService"):null;
  if(localDiagnosticCollection)context.subscriptions.push(localDiagnosticCollection);
  let packageFiles=null,packageFilesUri=null,packageFilesVersion=-1;
  const providers=new Map(),treeProviders=new Map(),sessions=new Map(),selections=new Map();
  const markdownPreviewAcceptanceOriginals=new Map();
  const languagePackages=new Map();
  const languagePackageGenerations=new Map();
  const languagePackageStatuses=new Map();
  let languageRecoveryPromise=null;
  let languageClientEpoch=0;
  let languageClient=null,languageClientPromise=null,languageClientFailureShown=false,
    languageStatusItem=null,languageTransportFailure=null,languagePackageFailure=null;
  let semanticTokenRenderer=null;
  const semanticTokenDiagnostics={
    registered:false,tokenTypeCount:0,requests:0,lastUri:null,lastRelativePath:null,
    lastSourceLength:0,lastLanguageId:null,lastTokenCount:0,lastError:null,
    registrationError:null,
    renderer:null,renderedTokenCount:0,renderedTypeCount:0,renderError:null,
    server:null,transport:null,packageAttachAttempts:0,lastPackageRoot:null,
    lastPackageAttachReason:null
  };
  const nativeCompletionDiagnostics={
    registered:false,transport:null,requests:0,lastUri:null,lastLabels:[],
    lastCount:0,lastError:null,lastLanguageId:null,lastVersion:null,lastPosition:null,
    lastLineText:null,lastPrefix:null,lastEditorTriggerKind:null,lastLspTriggerKind:null,
    lastTriggerCharacter:null
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
    // Every Theia host uses the same source-local CA-SL classifier.
    // Semantic colors must not depend on an LSP Worker, Package diagnostics,
    // trust linking or Compiler. VS Code Web hosts retain LSP-provided tokens.
    if(browserLanguageWorkerAvailable&&!isTheiaHost)return;
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
    if(isTheiaHost){
      try{
        renderer=createSemanticTokenDecorationRenderer(
          vscode,SKILL_SEMANTIC_TOKEN_TYPES,studioLightTheme.semanticTokenColors??{}
        );
        semanticTokenDiagnostics.renderer="theia-text-editor-decoration";
        semanticTokenRenderer=renderer;
        context.subscriptions.push({dispose:()=>renderer?.dispose()});
      }catch(error){
        semanticTokenDiagnostics.renderError=String(error?.message??error);
      }
    }
    const provider={
      provideDocumentSemanticTokens(document,cancellationToken){
        if(cancellationToken?.isCancellationRequested)
          return new vscode.SemanticTokens(new Uint32Array());
        const sourceText=document.getText();
        const workspaceRelativePath=vscode.workspace.asRelativePath?.(document.uri,false)??"";
        const relativePath=resolveSemanticTokenSourcePath(
          document.uri.path,workspaceRelativePath
        );
        const spans=collectSkillSemanticTokenSpans(sourceText,relativePath);
        semanticTokenDiagnostics.requests++;
        semanticTokenDiagnostics.lastUri=document.uri.toString();
        semanticTokenDiagnostics.lastRelativePath=relativePath;
        semanticTokenDiagnostics.lastSourceLength=sourceText.length;
        semanticTokenDiagnostics.lastLanguageId=document.languageId??null;
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
    if(!browserLanguageWorkerAvailable&&!useInProcessLanguageService)return;
    // The status bar describes the whole workspace, not whichever Package
    // happened to publish last. A READY result from one Skill must never hide
    // another active Skill whose current-source analysis is PARTIAL/UNAVAILABLE.
    const incompletePackages=[...languagePackageStatuses.values()].filter(status=>
      status.state==="PARTIAL"||status.state==="UNAVAILABLE");
    if(incompletePackages.length&&!["UNAVAILABLE","ERROR","IDLE"].includes(state)){
      state="PARTIAL";
      detail=incompletePackages.map(status=>{
        const packageName=String(status.rootUri??"").split("/").filter(Boolean).at(-1)||
          "unknown Package";
        const procedureState=status.procedureState??"UNAVAILABLE";
        const diagnosticCount=status.procedureDiagnosticCount??"?";
        const auditReason=status.packageAuditReason??status.reason??"";
        return packageName+": Procedure "+procedureState+" ("+diagnosticCount+
          " diagnostics)"+(auditReason?" · "+auditReason:"");
      }).join("; ");
    }
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

  // Verify that historical source is diagnosed by the one current grammar.
  // This is an in-memory negative test, not a compatibility analyzer.
  context.subscriptions.push(vscode.commands.registerCommand(
    "skillStudio.internal.currentGrammarRejectionAcceptance",()=>{
      const root="file:///current-grammar-acceptance";
      const documents=new Map([
        ["assurance/contract.yaml",{
          uri:root+"/assurance/contract.yaml",relativePath:"assurance/contract.yaml",
          version:1,text:"apiVersion: connectionagent.io/v1alpha1\nkind: SkillContract\nmetadata: {}\nspec: {}\n"
        }],
        ["assurance/predicates.yaml",{
          uri:root+"/assurance/predicates.yaml",relativePath:"assurance/predicates.yaml",
          version:1,text:"apiVersion: connectionagent.io/v1alpha1\nkind: PredicateSet\nmetadata: {}\npredicates: {}\n"
        }],
        ["assurance/procedure.yaml",{
          uri:root+"/assurance/procedure.yaml",relativePath:"assurance/procedure.yaml",
          version:1,text:"procedures:\n  entry:\n    nodes:\n      start:\n        call: operation.missing\n"
        }]
      ]);
      const result=analyzeCurrentSource(documents,"current-grammar-acceptance");
      const codes=new Set(result.diagnostics.map(item=>item.code));
      const required=["UNKNOWN_FIELD","SOURCE_ROOT_INVALID"];
      const missing=required.filter(code=>!codes.has(code));
      if(missing.length)
        throw Error("Current grammar did not report concrete source errors: "+
          JSON.stringify({missing,diagnostics:result.diagnostics}));
      return {
        status:"PASS",analysis:"CURRENT_GRAMMAR_ONLY",
        diagnosticCount:result.diagnostics.length,codes:[...codes].sort(),
        compatibilityFallback:false,sourceMutation:"NONE"
      };
    }));
  context.subscriptions.push(vscode.commands.registerCommand(
    "skillStudio.internal.revealSemanticColorAcceptance",()=>{
      const editor=vscode.window.activeTextEditor;
      const doc=editor?.document;
      if(!doc||! /\/assurance\/procedure\.ya?ml$/i.test(doc.uri.path))
        throw Error("Semantic color acceptance requires the active native Procedure Source");
      const lines=doc.getText().split(/\r?\n/);
      const line=lines.findIndex(value=>value.includes("PASS: subscribe-sm-data"));
      if(line<0)throw Error("Semantic color acceptance route marker is absent from the current Procedure");
      editor.revealRange(new vscode.Range(line,0,line,lines[line].length),
        vscode.TextEditorRevealType.InCenter);
      return {uri:doc.uri.toString(),line:line+1,text:lines[line]};
    }
  ));
  context.subscriptions.push(vscode.commands.registerCommand(
    "skillStudio.internal.semanticTokenDiagnostics",()=>({
      ...semanticTokenDiagnostics,
      rendererDiagnostics:semanticTokenDiagnostics.renderer==="theia-text-editor-decoration"
        ?semanticTokenRenderer?.diagnostics?.(document?.uri?.toString?.())??null:null,
      activeDocumentUri:document?.uri?.toString?.()??null,
      activePackageRootUri:document
        ?packageRootForProcedure(vscode,document)?.uri?.toString?.()??null:null,
      activePackageAuditStatus:auditStatus,
      activePackageAuditDiagnosticCount:audit.length,
      languagePackages:[...languagePackages.values()].map(state=>({
        rootUri:state.key,refs:state.refs,generation:state.generation,
        ticket:state.ticket,disposed:state.disposed,
        lastSentSnapshot:state.lastSentSnapshot
      })),
      packageLifecycle:packageLanguageLifecycle.snapshot(),
      packageStatuses:[...languagePackageStatuses.entries()].map(([rootUri,status])=>({rootUri,...status})),
      packageAudit:(()=>{
        const root=document?packageRootForProcedure(vscode,document):null;
        const contractUri=root?vscode.Uri.joinPath(root.uri,"assurance","contract.yaml"):null;
        const editorMarkers=contractUri&&vscode.languages.getDiagnostics
          ?vscode.languages.getDiagnostics(contractUri).map(item=>({
            code:item.code,message:item.message,severity:item.severity,source:item.source,
            line:(item.range?.start?.line??0)+1,
            column:(item.range?.start?.character??0)+1,
            endLine:(item.range?.end?.line??0)+1,
            endColumn:(item.range?.end?.character??0)+1
          })): [];
        const problemItems=(treeProviders.get("problems")?.getChildren?.()??[])
          .flatMap(item=>item.kind==="problem-group"?(item.children??[]):[item]);
        return {
          status:auditStatus,
          diagnostics:audit.map(item=>({
            code:item.code,message:item.message,severity:item.severity,status:item.status,
            domain:item.domain,path:item.path,line:item.line,column:item.column
          })),
          problems:problemItems.filter(item=>item.kind==="package-diagnostic").map(item=>({
            code:item.code,message:item.message,severity:item.severity,status:item.status,
            domain:item.domain,path:item.path,line:item.line,column:item.column,
            description:item.description
          })),
          editorMarkers
        };
      })(),
      languageServiceMode:useInProcessLanguageService?"shared-session-in-process":
        browserLanguageWorkerAvailable?"shared-session-browser-worker":"unavailable",
      languageClientStarted:Boolean(languageClient),
      languageClientPending:Boolean(languageClientPromise),
      languageTransportFailure,
      languagePackageFailure,
      languageStatus:languageStatusItem?.text??null,
      semanticHighlightingEnabled:vscode.workspace.getConfiguration("editor")
        .get("semanticHighlighting.enabled")
    })
  ));
  // Semantic highlighting is an enhancement, not an activation prerequisite.
  // A host-specific API failure must not prevent Package Explorer, Outline,
  // Problems, Welcome or the remaining workbench providers from registering.
  try{
    registerExtensionHostSemanticTokens();
  }catch(error){
    const reason=String(error?.message??error);
    semanticTokenDiagnostics.registrationError=reason;
    semanticTokenDiagnostics.lastError=reason;
    console.error("SKILL Studio semantic-token registration failed; continuing activation:",reason);
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
          const epoch=++languageClientEpoch;
          candidate=createSkillLanguageClient(vscode,context,{
            // The primary extension owns semantic tokens in Theia.
            // Keep the LSP Worker responsible for diagnostics and navigation.
            localSemanticTokens:(typeof STUDIO_THEIA_HOST!=="undefined"&&STUDIO_THEIA_HOST)||
              /theia/i.test(String(vscode.env?.appName??"")),
            manualCompletionProvider:isTheiaHost,
            onCompletionProviderRegistered:status=>{
              nativeCompletionDiagnostics.registered=status?.registered===true;
              nativeCompletionDiagnostics.transport=status?.transport??null;
            },
            onCompletionProviderRequest:request=>{
              nativeCompletionDiagnostics.requests++;
              nativeCompletionDiagnostics.lastUri=request?.uri??null;
              nativeCompletionDiagnostics.lastLanguageId=request?.languageId??null;
              nativeCompletionDiagnostics.lastVersion=request?.version??null;
              nativeCompletionDiagnostics.lastPosition=request?.position??null;
              nativeCompletionDiagnostics.lastLineText=request?.lineText??null;
              nativeCompletionDiagnostics.lastPrefix=request?.prefix??null;
              nativeCompletionDiagnostics.lastEditorTriggerKind=request?.editorTriggerKind??null;
              nativeCompletionDiagnostics.lastLspTriggerKind=request?.lspTriggerKind??null;
              nativeCompletionDiagnostics.lastTriggerCharacter=request?.triggerCharacter??null;
            },
            onCompletionProviderResult:result=>{
              nativeCompletionDiagnostics.lastLabels=result?.labels??[];
              nativeCompletionDiagnostics.lastCount=result?.count??0;
            },
            onCompletionProviderError:error=>{
              nativeCompletionDiagnostics.lastError=error?.message??String(error);
            },
            onStatus:status=>{
              if(epoch!==languageClientEpoch)return;
              const state=languagePackages.get(status?.rootUri);
              // Ignore delayed notifications from an old Package generation.
              if(!state||state.disposed||status.generation!==state.generation)return;
              languagePackageStatuses.set(status.rootUri,status);
              applyLanguageAnalysisStatus(status);
              // "UNAVAILABLE" here is Package analysis, not a dead language
              // Worker. Keep the service state distinct from Package health.
              updateLanguageStatus(
                status.state==="UNAVAILABLE"?"PARTIAL":status.state,
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
              const reason=String(error?.message??error);
              if(typeof error?.rootUri==="string"){
                const state=languagePackages.get(error.rootUri);
                // A delayed failure from a superseded Package generation must
                // not downgrade the currently selected Source or Worker.
                if(!state||state.disposed||
                   (Number.isSafeInteger(error.generation)&&
                    error.generation!==state.generation))return;
                languagePackageFailure={
                  rootUri:error.rootUri,generation:state.generation,
                  reason
                };
                updateLanguageStatus("PARTIAL",
                  "Package analysis failed; source coloring remains available: "+reason);
                return;
              }
              updateLanguageStatus("ERROR",reason);
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
      const folder=vscode.workspace.getWorkspaceFolder?.(state.procedureDocument.uri);
      let dependencyContext={
        available:false,
        reason:"The Package is not inside an open project workspace"
      };
      if(folder){
        try{
          const project=readProjectConfiguration(vscode,folder.uri);
          const resolved=await resolveLockedDependencies(vscode,folder.uri);
          const operations=[],schemas=[],toolCatalogs=[],schemaCompletionHints=[];
          const decoder=new TextDecoder("utf-8",{fatal:true});
          for(const dependency of resolved.snapshots??[]){
            const decoded=(dependency.files??[])
              .filter(file=>/\.(?:json|ya?ml)$/i.test(file.path))
              .map(file=>({
                path:file.path,text:decoder.decode(decodeBase64(file.bytes))
              }));
            if(dependency.kind==="tool-catalog"){
              const catalog=indexV1Alpha4ToolCatalogCallables(dependency.id,decoded);
              toolCatalogs.push({
                dependencyId:dependency.id,
                available:catalog.available,reason:catalog.reason
              });
              operations.push(...catalog.operations);
            }
            if(dependency.kind==="interface-package"){
              // Keep each Callable's unqualified identity for Package Audit.
              // Completion constructs alias::callable from this one declaration.
              const catalog=indexV1Alpha4ToolCatalogCallables(dependency.id,decoded);
              toolCatalogs.push({dependencyId:dependency.id,
                available:catalog.available,reason:catalog.reason});
              operations.push(...catalog.operations);
              const hints=projectLockedInterfaceCompletionHints(dependency);
              schemaCompletionHints.push(...hints);
            }
            for(const file of decoded){
              const schemaFile=dependency.kind==="schema-bundle"
                ?/\.(?:json|ya?ml)$/i.test(file.path)
                :/(?:^|\/)schemas\/.*\.(?:json|ya?ml)$/i.test(file.path);
              if(!schemaFile)continue;
              schemas.push({dependencyId:dependency.id,path:file.path,text:file.text});
            }
          }
          dependencyContext={
            available:true,
            declarations:project.settings.dependencies,
            snapshots:(resolved.snapshots??[]).map(item=>({id:item.id,kind:item.kind})),
            diagnostics:resolved.diagnostics??[],
            operations,toolCatalogs,schemas,schemaCompletionHints
          };
          snapshot.dependencyOperations=operations;
          snapshot.dependencySchemas=schemas;
          snapshot.schemaCompletionHints=schemaCompletionHints;
        }catch(error){
          dependencyContext={
            available:false,reason:String(error?.message??error)
          };
        }
      }
      snapshot.dependencyContext=dependencyContext;
      const activeRoot=document?packageRootForProcedure(vscode,document):null;
      if(activeRoot?.uri.toString()===state.key){
        if(snapshot.completeness==="complete"){
          packageFiles=new Map(snapshot.documents.map(item=>
            [item.relativePath,{text:item.text}]));
          packageFilesUri=state.procedureDocument.uri.toString();
          packageFilesVersion=state.procedureDocument.version;
        }else{
          packageFiles=null;packageFilesUri=null;packageFilesVersion=-1;
        }
        update(state.procedureDocument);
      }
      if(state.disposed||ticket!==state.ticket){
        if(strict)throw Error("Package refresh was superseded during dependency resolution");
        return null;
      }
      state.lastSentSnapshot={
        generation:snapshot.generation,
        completeness:snapshot.completeness,
        reason:snapshot.reason??null,
        files:snapshot.documents.map(item=>({
          path:item.relativePath,version:item.version,chars:item.text.length
        })).filter(item=>item.path.startsWith("assurance/")||
          item.path.endsWith("select_establishment_configuration.py")),
        dependencyContextAvailable:dependencyContext.available===true,
        resolvedDependencyIds:(dependencyContext.snapshots??[]).map(item=>item.id),
        schemaCompletionHintIds:(dependencyContext.schemaCompletionHints??[])
          .map(item=>item.id)
      };
      updateLanguageStatus("ANALYZING","Analyzing "+snapshot.packageName+
        " · generation "+snapshot.generation);
      if(useInProcessLanguageService){
        if(!state.localSession){
          state.localSession=new LanguageDiagnosticSession({
            publish(result){
              if(state.disposed||languagePackages.get(state.key)!==state)return;
              const diagnostics=(result.diagnostics??[]).map(item=>{
                const severity=item.severity===1?vscode.DiagnosticSeverity.Error:
                  item.severity===2?vscode.DiagnosticSeverity.Warning:
                  (vscode.DiagnosticSeverity.Information??vscode.DiagnosticSeverity.Warning);
                const range=new vscode.Range(
                  item.range.start.line,item.range.start.character,
                  item.range.end.line,item.range.end.character);
                const diagnostic=new vscode.Diagnostic(range,item.message,severity);
                diagnostic.code=item.code;
                diagnostic.source=item.source;
                return diagnostic;
              });
              state.localPublishedCounts.set(result.uri,diagnostics.length);
              localDiagnosticCollection?.set(vscode.Uri.parse(result.uri),diagnostics);
            },
            analysis(_acceptedSnapshot,analysis){
              state.localAnalysis=analysis;
            },
            status(result){
              if(state.disposed||languagePackages.get(state.key)!==state||
                 result.generation!==state.generation)return;
              const analysis=state.localAnalysis?.generation===result.generation
                ?state.localAnalysis:null;
              const status={
                ...result,rootUri:state.key,
                publishedDiagnosticCount:[...state.localPublishedCounts.values()]
                  .reduce((total,count)=>total+count,0),
                procedureState:analysis?.procedure.state??"UNAVAILABLE",
                procedureDiagnosticCount:analysis?.procedure.diagnostics.length??0,
                packageAuditState:analysis?.packageAudit.state??"UNAVAILABLE",
                packageAuditReason:analysis?.packageAudit.reason??null,
                packageAuditDiagnosticCount:analysis?.packageAudit.diagnostics.length??0,
                analysisDiagnostics:analysis?.diagnostics??[]
              };
              languagePackageStatuses.set(state.key,status);
              applyLanguageAnalysisStatus(status);
              updateLanguageStatus(
                status.state==="UNAVAILABLE"?"PARTIAL":status.state,
                status.reason??("Package "+state.key+" · generation "+status.generation+
                  " · "+status.publishedDiagnosticCount+" diagnostics"+
                  " · Audit "+status.packageAuditState)
              );
            }
          });
        }
        const submitted=await state.localSession.submit(snapshot);
        if(!submitted.accepted&&submitted.reason!=="ANALYSIS_UNAVAILABLE"){
          if(submitted.reason==="SUPERSEDED"||submitted.reason==="STALE_GENERATION"||
             submitted.reason==="STALE_DOCUMENT")return null;
          throw Error("Shared Language Service rejected Package snapshot: "+
            String(submitted.reason??"unknown reason"));
        }
        languagePackageFailure=null;
        if(snapshot.completeness==="complete")state.transientReadRetries=0;
        return snapshot;
      }
      const client=await ensureLanguageClient();
      if(!client||state.disposed||ticket!==state.ticket||languageTransportFailure){
        if(strict)throw Error("Package refresh lost its active Language Worker");
        return null;
      }
      client.sendPackageSnapshot(snapshot);
      languagePackageFailure=null;
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
      languagePackageFailure={rootUri:state.key,generation,ticket,
        reason:String(error?.message??error)};
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
      return {ticket,generation};
    }
    state.timer=setTimeout(()=>{
      state.timer=null;
      void refreshLanguagePackage(state,ticket,generation);
    },120);
    return {ticket,generation};
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
    semanticTokenDiagnostics.packageAttachAttempts++;
    const rootInfo=packageRootForProcedure(vscode,doc);
    semanticTokenDiagnostics.lastPackageRoot=rootInfo?.uri?.toString?.()??null;
    if(!rootInfo){
      semanticTokenDiagnostics.lastPackageAttachReason="document is not a supported assurance/procedure.yaml";
      return ()=>{};
    }
    if(!browserLanguageWorkerAvailable&&!useInProcessLanguageService){
      semanticTokenDiagnostics.lastPackageAttachReason="no supported Language Service runtime is available";
      return ()=>{};
    }
    semanticTokenDiagnostics.lastPackageAttachReason=null;
    const root=rootInfo.uri;
    const key=root.toString();
    let state=languagePackages.get(key);
    if(state){
      state.refs++;
      if(state.procedureDocument!==doc){
        state.procedureDocument=doc;
        scheduleLanguagePackageRefresh(state);
      }
    }else{
      state={
        root,key,procedureDocument:doc,refs:1,
        generation:languagePackageGenerations.get(key)??0,ticket:0,
        timer:null,disposed:false,subscriptions:[],
        lastSentSnapshot:null,transientReadRetries:0,
        localSession:null,localAnalysis:null,localPublishedCounts:new Map()
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
      state.localSession?.dispose();
      state.localSession=null;
      languagePackages.delete(key);
      languagePackageStatuses.delete(key);
      if(languagePackages.size===0)updateLanguageStatus("IDLE","No open Procedure Package");
      const close=client=>client?.closePackage(key);
      if(languageClientPromise)void languageClientPromise.then(close).catch(()=>{});
      else close(languageClient);
    };
  }
  const packageLanguageLifecycle=createPackageLanguageLifecycle({
    openTextDocument:uri=>vscode.workspace.openTextDocument(uri),
    attach:attachLanguagePackage,
    onError:(key,error)=>console.warn(
      "Skill Studio could not open discovered Package Procedure:",key,
      String(error?.message??error))
  });
  context.subscriptions.push({dispose:()=>packageLanguageLifecycle.dispose()});

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
        // authoritative Procedure Source; the right Preview follows it.
        await openNativeSource(vscode,procedureUri,{viewColumn:vscode.ViewColumn.One,preserveFocus:false,preview:false});
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

  // Open the exact Procedure as native Source before inspecting semantic
  // highlighting. The broader acceptance flow may finish on a Python editor,
  // whose source-local CA-SL semantic token count is correctly zero.
  context.subscriptions.push(vscode.commands.registerCommand(
    "skillStudio.internal.openProcedureSourceForHighlightDiagnostics",
    async procedureUriValue=>{
      const procedureUri=vscode.Uri.parse(String(procedureUriValue??""));
      if(!/\/assurance\/procedure\.ya?ml$/i.test(procedureUri.path))
        throw Error("Highlight diagnostics require an exact assurance/procedure.yaml URI");
      const document=await vscode.workspace.openTextDocument(procedureUri);
      await openNativeSource(vscode,procedureUri,{
        viewColumn:vscode.ViewColumn.One,preserveFocus:false,preview:false
      });
      // A completion-provider acceptance probe may leave the Output channel
      // as the active editor in the browser-only host. Reassert the exact
      // Source document through the public text-editor API before inspecting
      // decoration application; this is acceptance setup, not editor logic.
      let editor=vscode.window.activeTextEditor;
      if(editor?.document?.uri?.toString()!==document.uri.toString()){
        editor=await vscode.window.showTextDocument(document,{
          viewColumn:vscode.ViewColumn.One,preserveFocus:false,preview:false
        });
      }
      return {
        uri:document.uri.toString(),
        languageId:document.languageId,
        viewColumn:editor?.document?.uri?.toString()===document.uri.toString()
          ?editor.viewColumn:null,
        textLength:document.getText().length
      };
    }
  ));

  // Exercise candidate v1alpha5 providers through the public VS Code commands
  // in real Theia. A uniquely named sibling Package is created inside the
  // selected workspace and always removed; user-authored files are untouched.
  if(typeof Worker==="function"&&typeof globalThis.location!=="undefined"){
    context.subscriptions.push(vscode.commands.registerCommand(
      "skillStudio.internal.currentLanguageProviderAcceptance",
      async procedureUriValue=>{
        const sourceUri=vscode.Uri.parse(String(procedureUriValue??""));
        const sourceDocument=await vscode.workspace.openTextDocument(sourceUri);
        const sourceRoot=packageRootForProcedure(vscode,sourceDocument);
        if(!sourceRoot)throw Error("current-language acceptance requires an active Skill Package");
        const sourcePath=sourceRoot.uri.path.replace(/\/$/,"");
        const workspaceFolder=(vscode.workspace.workspaceFolders??[]).find(folder=>{
          const path=folder.uri.path.replace(/\/$/,"");
          return sourcePath===path||sourcePath.startsWith(path+"/");
        });
        if(!workspaceFolder)throw Error("current-language acceptance requires the selected workspace root");
        const suffix=Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,8);
        const packageRoot=vscode.Uri.joinPath(
          workspaceFolder.uri,"skill-studio-current-lsp-"+suffix);
        const fs=vscode.workspace.fs;
        const contract=[
          "goal: pdu_session.initial_request_fulfilled",
          "precondition: check.precondition",
          "requestSchema: schemas/request.schema.yaml",
          "contextSchema: ca-context::urn:example:host:v1",
          "dependencies:",
          "  ca-context: urn:example:host",
          "  ca: urn:example:tools",
          "  ca-client: urn:wtlab:ca-client-tools:openamsm-sbi-interface",
          "capabilities: [session-read]",
          ""
        ].join("\n");
        const procedure=[
          "start: check",
          "nodes:",
          "  check:",
          "    ",
          "    precondition:",
          "      ",
          "      predicates:",
          "        - predicate: demo.ready",
          "          arguments: [context.ueRef]",
          "      routes:",
          "        ",
          "        PASS: read",
          "        FAIL: FAILED",
          "        UNKNOWN: UNRESOLVED",
          "  read:",
          "    observation:",
          "      ",
          "      tool: ca::session.read",
          "      arguments:",
          "        ueRef: context.ueRef",
          "        schemaProbe: context.request.sNssai.",
          "        schemaRootProbe: context.",
          "        schemaStartProbe: context",
          "      routes:",
          "        SUCCEEDED: client-query",
          "        FAILED: SAFE_STOPPED",
          "        UNKNOWN: UNRESOLVED",
          // A connected, read-only query node keeps the Procedure graph valid
          // while exercising the workspace's exact pinned Interface Schema.
          "  client-query:",
          "    observation:",
          "      tool: ca-client::openamsm.smf.mas.sc.query",
          "      arguments: {}",
          "        ",
          "      routes:",
          "        SUCCEEDED: mutate",
          "        FAILED: SAFE_STOPPED",
          "  mutate:",
          "    operation:",
          "      tool: ca::session.mutate",
          "      arguments: {}",
          "      routes:",
          "        SUCCEEDED: await-event",
          "        FAILED: SAFE_STOPPED",
          "        OUTCOME_UNKNOWN: SAFE_STOPPED",
          "  await-event:",
          "    wait:",
          "      event:",
          "        source: AMF",
          "        service: Nsmf_PDUSession",
          "        operation: UpdateSMContext",
          "      timeout: PT30S",
          "      response:",
          "        after: final",
          "      routes:",
          "        TIMEOUT: timeout-handler",
          "    operation:",
          "      tool: ca::session.resume",
          "      arguments:",
          "        request: await-event.wait.output",
          "      routes:",
          "        SUCCEEDED: run-script",
          "        FAILED: SAFE_STOPPED",
          "        OUTCOME_UNKNOWN: SAFE_STOPPED",
          "  timeout-handler:",
          "    observation:",
          "      tool: ca::session.read",
          "      arguments:",
          "        ueRef: context.ueRef",
          "      routes:",
          "        SUCCEEDED: SAFE_STOPPED",
          "        FAILED: SAFE_STOPPED",
          "        UNKNOWN: SAFE_STOPPED",
          "  run-script:",
          "    operation:",
          "      ",
          "      script: scripts/runner.py",
          "      arguments: {}",
          "      routes:",
          "        ",
          "        SUCCEEDED: final",
          "        FAILED: SAFE_STOPPED",
          "  final:",
          "    postcondition:",
          "      predicates:",
          "        - predicate: demo.done",
          "          arguments: [read.observation.output]",
          "      routes:",
          "        PASS: SUCCEEDED",
          "        FAIL: FAILED",
          "        UNKNOWN: UNRESOLVED",
          ""
        ].join("\n");
        const predicates=[
          "predicates:",
          "  demo.ready:",
          "    parameters: [{ue: string}]",
          "    evaluator:",
          "      type: cel",
          "      expression: ue != \"\"",
          "  demo.done:",
          "    parameters: [{data: string}]",
          "    evaluator:",
          "      type: cel",
          "      expression: data.ready == true",
          ""
        ].join("\n");
        const files={
          "assurance/contract.yaml":contract,
          "assurance/procedure.yaml":procedure,
          "assurance/predicates.yaml":predicates,
          "schemas/request.schema.yaml":
            "$schema: https://json-schema.org/draft/2020-12/schema\ntype: object\nproperties:\n  sNssai:\n    type: object\n    properties:\n      sst: {type: integer, description: Slice/Service Type}\n      sd: {type: string}\n",
          "scripts/runner.py":"def main():\n    return {}\n"
        };
        let release=null;
        let state=null;
        try{
          await fs.createDirectory(packageRoot);
          for(const [relativePath,text] of Object.entries(files)){
            const parts=relativePath.split("/");
            await fs.createDirectory(vscode.Uri.joinPath(
              packageRoot,...parts.slice(0,-1)));
            await fs.writeFile(vscode.Uri.joinPath(packageRoot,...parts),
              new TextEncoder().encode(text));
          }
          const uriFor=path=>vscode.Uri.joinPath(packageRoot,...path.split("/"));
          const [contractDocument,procedureDocument,predicateDocument,scriptDocument]=await Promise.all([
            vscode.workspace.openTextDocument(uriFor("assurance/contract.yaml")),
            vscode.workspace.openTextDocument(uriFor("assurance/procedure.yaml")),
            vscode.workspace.openTextDocument(uriFor("assurance/predicates.yaml")),
            vscode.workspace.openTextDocument(uriFor("scripts/runner.py"))
          ]);
          release=attachLanguagePackage(procedureDocument);
          state=languagePackages.get(packageRoot.toString());
          if(!state||state.disposed)throw Error("current Package did not attach to Language Service");
          const status=await waitForLanguagePackageStatus(state,state.generation,20000);
          if(status.state!=="READY"||status.packageAuditState!=="UNAVAILABLE")
            throw Error("Current source analysis must be READY while Package qualification remains separate: "+
              JSON.stringify({state:status.state,packageAuditState:status.packageAuditState,
                packageAuditReason:status.packageAuditReason}));
          if(state.lastSentSnapshot?.completeness!=="complete")
            throw Error("current-language acceptance snapshot is incomplete: "+
              JSON.stringify(state.lastSentSnapshot));
          const labels=result=>(Array.isArray(result)?result:
            result?.items??result?.suggestions??[]).map(item=>
              typeof item.label==="string"?item.label:item.label?.label??"");
          const complete=async(document,needle,offsetInNeedle)=>{
            const source=document.getText();
            const start=source.indexOf(needle);
            if(start<0)throw Error("v1alpha5 completion probe anchor missing: "+needle);
            const position=document.positionAt(start+
              (offsetInNeedle??needle.length));
            try{
              const result=await languageClient.provideCompletion(
                document.uri.toString(),position);
              return labels(result);
            }catch(error){
              throw Error("LSP completion probe failed at "+JSON.stringify(needle)+": "+
                String(error?.message??error));
            }
          };
          const contractGate=await complete(contractDocument,"check.precondition",6);
          const schemaPath=await complete(contractDocument,"schemas/request.schema.yaml",8);
          const entry=await complete(procedureDocument,"start: check",7);
          const predicate=await complete(procedureDocument,"demo.ready",5);
          const preconditionFields=await complete(procedureDocument,
            "    precondition:\n      ");
          const observationFields=await complete(procedureDocument,
            "    observation:\n      ");
          const operationFields=await complete(procedureDocument,
            "    operation:\n      ");
          const routeKeys=await complete(procedureDocument,
            "  run-script:\n    operation:\n      \n      script: scripts/runner.py\n      arguments: {}\n      routes:\n        ");
          const mutationRouteKeys=await complete(procedureDocument,
            "  mutate:\n    operation:\n      tool: ca::session.mutate\n      arguments: {}\n      routes:\n        ");
          const scriptPath=await complete(procedureDocument,"scripts/runner.py",8);
          const waitNodeFields=await complete(procedureDocument,"  await-event:\n    ");
          const waitFields=await complete(procedureDocument,"    wait:\n      ");
          const waitEventFields=await complete(procedureDocument,"      event:\n        ");
          const waitResponseFields=await complete(procedureDocument,"      response:\n        ");
          const waitRouteKeys=await complete(procedureDocument,"  await-event:\n    wait:\n      event:\n        source: AMF\n        service: Nsmf_PDUSession\n        operation: UpdateSMContext\n      timeout: PT30S\n      response:\n        after: final\n      routes:\n        ");
          const waitResponseAfter=await complete(procedureDocument,"        after: ");
          const waitTimeoutTarget=await complete(procedureDocument,"        TIMEOUT: ");
          const waitOutput=await complete(procedureDocument,
            "        request: await-event.wait.output");
          const contextRequestFields=await complete(procedureDocument,
            "        schemaProbe: context.request.sNssai.");
          const contextRoot=await complete(procedureDocument,
            "        schemaRootProbe: context.");
          const contextStart=await complete(procedureDocument,
            "        schemaStartProbe: context");
          const unknownTarget=await complete(procedureDocument,
            "OUTCOME_UNKNOWN: ");

          // The temporary Package inherits the Example's exact .vscode lock.
          // Assert the immutable Schema hint reached this Package generation,
          // then query the real browser Worker and native Theia Completion API.
          const queryToolId="ca-client::openamsm.smf.mas.sc.query";
          const dependencyHintIds=state.lastSentSnapshot?.schemaCompletionHintIds??[];
          if(state.lastSentSnapshot?.dependencyContextAvailable!==true||
             !state.lastSentSnapshot?.resolvedDependencyIds?.includes("ca-client")||
             dependencyHintIds.filter(id=>id===queryToolId).length!==1)
            throw Error("Pinned ca-client Schema hint was not projected into the accepted LSP Package snapshot: "+
              JSON.stringify(state.lastSentSnapshot));
          const queryToolNeedle="tool: ca-client::openamsm.smf.mas.sc.q";
          const queryToolCompletion=await complete(procedureDocument,queryToolNeedle);
          const querySource=procedureDocument.getText();
          const queryToolStart=querySource.indexOf(queryToolNeedle);
          if(queryToolStart<0)throw Error("Pinned ca-client Tool completion probe anchor is missing");
          const queryToolPosition=procedureDocument.positionAt(
            queryToolStart+queryToolNeedle.length);
          // Theia 1.76.0's public executeCompletionItemProvider bridge passes
          // the zero-based PluginPosition directly as Monaco's one-based
          // {lineNumber,column}. Compensate only at this acceptance-command
          // boundary; real editor providers continue to receive zero-based
          // positions and must not apply this offset.
          const nativeCompletionCommandPosition=position=>isTheiaHost
            ?new vscode.Position(position.line+1,position.character+1)
            :position;
          const nativeQueryToolResult=await vscode.commands.executeCommand(
            "vscode.executeCompletionItemProvider",procedureDocument.uri,
            nativeCompletionCommandPosition(queryToolPosition));
          const nativeQueryToolItems=Array.isArray(nativeQueryToolResult)
            ?nativeQueryToolResult
            :nativeQueryToolResult?.items??nativeQueryToolResult?.suggestions??[];
          const nativeQueryToolLabels=nativeQueryToolItems.map(item=>
            typeof item.label==="string"?item.label:item.label?.label??"");
          const queryArgumentsAnchor="      arguments: {}\n        ";
          const queryArgumentsStart=querySource.lastIndexOf(queryArgumentsAnchor);
          if(queryArgumentsStart<0)
            throw Error("Pinned ca-client query arguments probe anchor is missing");
          const queryArgumentsPosition=procedureDocument.positionAt(
            queryArgumentsStart+queryArgumentsAnchor.length);
          const queryArgumentsResult=await languageClient.provideCompletion(
            procedureDocument.uri.toString(),queryArgumentsPosition);
          const queryArgumentItems=Array.isArray(queryArgumentsResult)
            ?queryArgumentsResult:queryArgumentsResult?.items??[];
          const nativeQueryArgumentsResult=await vscode.commands.executeCommand(
            "vscode.executeCompletionItemProvider",procedureDocument.uri,
            nativeCompletionCommandPosition(queryArgumentsPosition));
          const nativeQueryArgumentItems=Array.isArray(nativeQueryArgumentsResult)
            ?nativeQueryArgumentsResult
            :nativeQueryArgumentsResult?.items??nativeQueryArgumentsResult?.suggestions??[];
          const queryArgumentLabels=queryArgumentItems.map(item=>
            typeof item.label==="string"?item.label:item.label?.label??"");
          const nativeQueryArgumentLabels=nativeQueryArgumentItems.map(item=>
            typeof item.label==="string"?item.label:item.label?.label??"");
          const requiredQueryArguments=queryArgumentItems.filter(item=>
            ["supi","pduSessionId"].includes(
              typeof item.label==="string"?item.label:item.label?.label));
          const nativeRequiredQueryArguments=nativeQueryArgumentItems.filter(item=>
            ["supi","pduSessionId"].includes(
              typeof item.label==="string"?item.label:item.label?.label));
          if(!nativeQueryToolLabels.includes(queryToolId)||
             queryArgumentLabels.length!==2||
             !queryArgumentLabels.includes("supi")||
             !queryArgumentLabels.includes("pduSessionId")||
             !nativeQueryArgumentLabels.includes("supi")||
             !nativeQueryArgumentLabels.includes("pduSessionId")||
             requiredQueryArguments.length!==2||
             requiredQueryArguments.some(item=>
               !String(item.detail??"").includes("required")||
               !String(item.detail??"").includes("AUTH_NOT_CHECKED"))||
             nativeRequiredQueryArguments.length!==2||
             nativeRequiredQueryArguments.some(item=>
               !String(item.detail??"").includes("required")||
               !String(item.detail??"").includes("AUTH_NOT_CHECKED")))
            throw Error("Pinned Interface Schema completion did not reach the actual Theia editor: "+
              JSON.stringify({queryToolCompletion,nativeQueryToolLabels,queryArgumentLabels,
                nativeQueryArgumentLabels,requiredQueryArguments,
                nativeRequiredQueryArguments,nativeCompletionDiagnostics,isTheiaHost}));
          if(!queryToolCompletion.includes(queryToolId))
            throw Error("Pinned Interface Tool completion omitted its exact exported callable: "+
              JSON.stringify(queryToolCompletion));
          if(procedureDocument.getText()!==querySource)
            throw Error("Read-only Schema completion mutated Procedure Source");

          const require=(items,label,description)=>{
            if(!items.includes(label))
              throw Error("Native Theia "+description+" completion omitted "+
                label+": "+JSON.stringify(items));
          };
          if(!contractGate.includes("check.precondition"))
            throw Error("Native Theia Contract Precondition completion omitted check.precondition: "+
              JSON.stringify(contractGate));
          require(schemaPath,"schemas/request.schema.yaml","Request Schema");
          require(entry,"check","Procedure start Node");
          require(predicate,"demo.ready","Predicate");
          require(preconditionFields,"predicates:","Precondition field");
          require(preconditionFields,"routes:","Precondition field");
          if(preconditionFields.includes("tool:")||preconditionFields.includes("script:"))
            throw Error("Precondition offered an Operation/Observation-only field");
          require(observationFields,"tool:","Observation field");
          require(observationFields,"arguments:","Observation field");
          if(observationFields.includes("script:")||observationFields.includes("retryOf:"))
            throw Error("Observation offered an Operation-only field");
          require(operationFields,"tool:","Operation field");
          require(operationFields,"script:","Operation field");
          require(operationFields,"arguments:","Operation field");
          require(routeKeys,"SUCCEEDED:","final Script route key");
          require(routeKeys,"FAILED:","Script failure route key");
          if(routeKeys.includes("OUTCOME_UNKNOWN:")||routeKeys.includes("NOT_COMMITTED:"))
            throw Error("Procedure Script offered Tool/Mutation-only outcomes: "+
              JSON.stringify(routeKeys));
          require(mutationRouteKeys,"OUTCOME_UNKNOWN:","Mutation unresolved route key");
          require(scriptPath,"scripts/runner.py","Package Script path");
          require(waitNodeFields,"wait:","Node-entry Wait field");
          for(const field of ["event:","timeout:","response:","routes:"])
            require(waitFields,field,"Wait control field");
          for(const field of ["source:","service:","operation:"])
            require(waitEventFields,field,"Wait event selector");
          require(waitResponseFields,"after:","Wait response boundary");
          require(waitRouteKeys,"TIMEOUT:","Wait timeout route key");
          require(waitResponseAfter,"final","Wait response boundary Node");
          require(waitTimeoutTarget,"timeout-handler","Wait timeout target Node");
          require(waitOutput,"await-event.wait.output","typed Wait output binding");
          require(contextRequestFields,"sst","Schema-driven context.request nested field");
          require(contextRequestFields,"sd","Schema-driven context.request nested field");
          require(contextRoot,"request","Schema-driven context root");
          require(contextStart,"context.request","Schema-driven request path stem");
          require(unknownTarget,"SAFE_STOPPED","OUTCOME_UNKNOWN terminal");
          if(unknownTarget.some(item=>["check","read","mutate","await-event","timeout-handler","run-script","final"].includes(item)))
            throw Error("OUTCOME_UNKNOWN offered a business Node target: "+
              JSON.stringify(unknownTarget));

          const at=(document,needle,offset=0)=>{
            const source=document.getText(),start=source.indexOf(needle);
            if(start<0)throw Error("v1alpha5 navigation probe anchor missing: "+needle);
            return document.positionAt(start+offset);
          };
          const definitionItems=result=>Array.isArray(result)?result:
            result?[result]:[];
          const gateDefinition=definitionItems(await vscode.commands.executeCommand(
            "vscode.executeDefinitionProvider",contractDocument.uri,
            at(contractDocument,"check.precondition",2)));
          if(!gateDefinition.some(item=>
            (item?.uri??item?.targetUri)?.toString()===procedureDocument.uri.toString()))
            throw Error("Native Theia Contract Precondition Definition did not reach the Node");
          const predicateDefinition=definitionItems(await vscode.commands.executeCommand(
            "vscode.executeDefinitionProvider",procedureDocument.uri,
            at(procedureDocument,"demo.ready",3)));
          if(!predicateDefinition.some(item=>
            (item?.uri??item?.targetUri)?.toString()===predicateDocument.uri.toString()))
            throw Error("Native Theia Predicate Definition did not reach PredicateSet");
          const predicateHover=definitionItems(await vscode.commands.executeCommand(
            "vscode.executeHoverProvider",procedureDocument.uri,
            at(procedureDocument,"demo.ready",3))).flatMap(item=>
              Array.isArray(item?.contents)?item.contents:[item?.contents])
            .map(item=>typeof item==="string"?item:item?.value??String(item??""))
            .join(" ");
          if(!predicateHover.includes("demo.ready(ue: string)"))
            throw Error("Native Theia Predicate Hover omitted its declared parameter signature: "+
              predicateHover);
          const references=definitionItems(await vscode.commands.executeCommand(
            "vscode.executeReferenceProvider",predicateDocument.uri,
            at(predicateDocument,"demo.ready",3),{includeDeclaration:true}));
          if(!references.some(item=>
            (item?.uri??item?.targetUri)?.toString()===procedureDocument.uri.toString()))
            throw Error("Native Theia Predicate References omitted the Procedure use");
          const scriptDefinition=definitionItems(await vscode.commands.executeCommand(
            "vscode.executeDefinitionProvider",procedureDocument.uri,
            at(procedureDocument,"scripts/runner.py",5)));
          if(!scriptDefinition.some(item=>
            (item?.uri??item?.targetUri)?.toString()===scriptDocument.uri.toString()))
            throw Error("Native Theia current Script Definition did not reach its Package-owned file");
          const symbols=definitionItems(await vscode.commands.executeCommand(
            "vscode.executeDocumentSymbolProvider",procedureDocument.uri));
          if(!symbols.some(item=>item.name==="check")||
             !symbols.some(item=>item.name==="mutate")||
             !symbols.some(item=>item.name==="await-event")||
             !symbols.some(item=>item.name==="timeout-handler")||
             !symbols.some(item=>item.name==="run-script")||
             !symbols.some(item=>item.name==="final"))
            throw Error("Native Theia Outline did not expose current Node declarations");
          return {
            status:status.state,packageAuditState:status.packageAuditState,
            snapshotCompleteness:state.lastSentSnapshot.completeness,
            contractPreconditionCompletion:contractGate,
            requestSchemaCompletion:schemaPath,startNodeCompletion:entry,
            predicateCompletion:predicate,
            preconditionFields,observationFields,operationFields,
            operationRouteKeys:routeKeys,mutationRouteKeys,scriptPathCompletion:scriptPath,
            waitNodeFields,waitFields,waitEventFields,waitResponseFields,
            waitRouteKeys,waitResponseAfter,waitTimeoutTarget,waitOutput,
            contextRequestFields,contextRoot,contextStart,
            interfaceToolCompletion:queryToolCompletion,
            interfaceNativeToolCompletion:nativeQueryToolLabels,
            interfaceArgumentCompletion:queryArgumentLabels,
            interfaceNativeArgumentCompletion:nativeQueryArgumentLabels,
            interfaceArgumentCompletionDetails:requiredQueryArguments.map(item=>({
              label:typeof item.label==="string"?item.label:item.label?.label,
              detail:item.detail,
              insertText:typeof item.insertText==="string"?item.insertText:
                item.insertText?.value??item.textEdit?.newText??null
            })),
            interfaceNativeArgumentCompletionDetails:nativeRequiredQueryArguments.map(item=>({
              label:typeof item.label==="string"?item.label:item.label?.label,
              detail:item.detail,
              insertText:typeof item.insertText==="string"?item.insertText:
                item.insertText?.value??item.textEdit?.newText??null
            })),
            interfaceNativeProviderDiagnostics:{...nativeCompletionDiagnostics},
            outcomeUnknownTargets:unknownTarget,
            contractDefinition:gateDefinition.length,
            predicateDefinition:predicateDefinition.length,
            predicateHoverSignature:predicateHover.includes("demo.ready(ue: string)"),
            predicateReferences:references.length,
            scriptDefinition:scriptDefinition.length,
            procedureOutline:symbols.map(item=>item.name),
            ownerQualification:"NOT_QUALIFIED"
          };
        }finally{
          release?.();
          try{await fs.delete(packageRoot,{recursive:true,useTrash:false});}catch{}
          if(state){
            languagePackageGenerations.delete(state.key);
            languagePackageStatuses.delete(state.key);
          }
        }
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
          String(item.code?.value??item.code??"")==="YAML_PARSE_ERROR"&&
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
            const packageAuditDiagnostics=invalid.diagnostics.filter(item=>
              item.source==="Skill Studio · package-audit");
            if(packageAuditDiagnostics.filter(item=>
              String(item.code?.value??item.code??"")==="PACKAGE_YAML_PARSE_ERROR").length!==1)
              throw Error("Current Package Audit must publish exactly one matching YAML parse finding");
            const message=procedureDiagnostics[0].message;
            if(!/YAML/i.test(message))
              throw Error("Current Procedure diagnostic did not identify malformed YAML: "+message);
            return {
              phase:"publish",appeared:true,code:"YAML_PARSE_ERROR",
              source:"Skill Studio · procedure-projection",message,
              generation:invalid.generation,
              packageAuditDiagnostics:packageAuditDiagnostics.length
            };
          }catch(error){
            try{
              if(state.temporarySourceApplied){
                const beforeRestore=packageState.generation;
                await replaceSource(state,state.original);
                state.temporarySourceApplied=false;
                await waitForGeneration(state,beforeRestore,"PARTIAL",
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
            // This phase runs only after the acceptance test has deliberately
            // terminated the Language Worker. Keep the restored native Source
            // editor active: reopening the CustomEditor here is unrelated to
            // source restoration and can fail while Theia is disposing the
            // editor/provider state for the terminated worker.
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
            const repaired=await waitForGeneration(state,beforeRepair,"PARTIAL",
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
            await openNativeSource(vscode,procedureUri,{viewColumn:vscode.ViewColumn.One,preserveFocus:false,preview:false});
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
            String(item.code?.value??item.code??"")==="YAML_PARSE_ERROR"))
            throw Error("L2-D4b requires a live LSP Procedure diagnostic");
          const guard=vscode.languages.createDiagnosticCollection(
            "skill-studio-d4b-control");
          const probe=new vscode.Diagnostic(new vscode.Range(0,0,0,1),
            "L2-D4b host-owned diagnostic survives Language Worker termination",
            vscode.DiagnosticSeverity.Warning);
          probe.source="Skill Studio · editor audit";
          probe.code="D4B_HOST_DIAGNOSTIC_OWNERSHIP";
          guard.set(uri,[probe]);
          const hostAudit=vscode.languages.getDiagnostics(uri).filter(item=>item.source==="Skill Studio · package-audit");
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
            String(item.code?.value??item.code??"")==="YAML_PARSE_ERROR"&&
            item.source==="Skill Studio · procedure-projection");
          const hostProbePresent=controls.some(item=>
            String(item.code?.value??item.code??"")==="D4B_HOST_DIAGNOSTIC_OWNERSHIP");
          const auditAfter=vscode.languages.getDiagnostics(uri).filter(item=>item.source==="Skill Studio · package-audit");
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
            await openNativeSource(vscode,procedureUri,{viewColumn:vscode.ViewColumn.One,preserveFocus:false,preview:false});
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
            try{await openNativeSource(vscode,procedureUri,{viewColumn:vscode.ViewColumn.One,preserveFocus:false,preview:false});}
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
          const workspaceFolder=(vscode.workspace.workspaceFolders??[]).find(folder=>{
            const path=folder.uri.path.replace(/\/$/,"");
            return sourcePath===path||sourcePath.startsWith(path+"/");
          });
          const workspacePath=workspaceFolder?.uri?.path?.replace(/\/$/,"")||
            sourcePath.slice(0,sourcePath.lastIndexOf("/"))||"/";
          const parentPath=workspacePath.slice(0,workspacePath.lastIndexOf("/"))||"/";
          // Keep this lifecycle fixture outside every open Workspace so it is
          // explicitly attached here, not also retained by Package discovery.
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
          try{await openNativeSource(vscode,procedureUri,{viewColumn:vscode.ViewColumn.One,preserveFocus:false,preview:false});}
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
          // The Language Worker is deliberately terminated for this probe.
          // Restoring the native Python Source is sufficient; reopening the
          // Procedure CustomEditor while its provider is degraded is unrelated
          // to the edit cleanup and can fail in Theia's editor lifecycle.
          if(cleanup.length)throw Error("L2-D4 cleanup failed: "+cleanup.join("; "));
        }
        return {workerUnavailable:true,nativePythonEditing:edited,
          originalDiskUnchanged:true,restored:true,
          status:languageStatusItem?.text,
          failureReason:languageTransportFailure};
      }
    ));
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
  const problemDomainLabels={
    source:"Source",package:"Package",dependencies:"Dependencies",tools:"Tools",
    capabilities:"Capabilities",schemas:"Schemas",predicates:"Predicates",
    evidence:"Evidence",compiler:"Compiler",runtime:"Runtime"
  };
  function problemTreeChildren(){
    const groups=new Map();
    const diagnostics=[...audit,...(compilerProblemsProvider?.getProblems?.()??[])];
    for(const {diagnostic,sources} of reconcileProblemDiagnostics(diagnostics)){
      const kind=diagnostic.kind??"problem";
      const domain=diagnostic.domain??(kind==="compiler-diagnostic"?"compiler":"source");
      if(!groups.has(domain)){
        groups.set(domain,{
          kind:"problem-group",domain,
          label:problemDomainLabels[domain]??domain,
          description:"",
          children:[]
        });
      }
      // Display owning Package-relative locations even for Compiler records
      // whose raw Diagnostic.path is prefixed with skills/<package>/.
      const sourcePath=diagnostic.sourcePath??diagnostic.relativePath??diagnostic.path;
      const description=[sourcePath,diagnostic.line?("L"+diagnostic.line):null]
        .filter(Boolean).join(" · ");
      groups.get(domain).children.push({
        kind,label:diagnostic.message,message:diagnostic.message,description,
        line:diagnostic.line,column:diagnostic.column,uri:diagnostic.uri,
        code:diagnostic.code,severity:diagnostic.severity,
        status:diagnostic.status,domain,category:diagnostic.category,
        path:sourcePath,sourcePath:diagnostic.sourcePath,
        range:diagnostic.range,analysisGeneration:diagnostic.analysisGeneration,
        locationKind:diagnostic.locationKind,phase:diagnostic.phase,
        source:diagnostic.source,contributors:sources,children:[]
      });
    }
    for(const group of groups.values()){
      const errors=group.children.filter(item=>item.severity==="error").length;
      const warnings=group.children.filter(item=>item.severity==="warning").length;
      const notChecked=group.children.filter(item=>item.status==="not_checked").length;
      const affectedFiles=new Set(group.children.map(item=>
        item.path??item.uri?.toString?.()).filter(Boolean)).size;
      group.description=errors+" errors · "+warnings+" warnings · "+
        affectedFiles+" files"+(notChecked?" · "+notChecked+" NOT_CHECKED":"");
    }
    return [{kind:"problem-status",label:auditStatus,children:[]},...groups.values()];
  }
  for(const id of ['inspection','outline','problems']){
    const emitter=new vscode.EventEmitter();
    const provider={onDidChangeTreeData:emitter.event,
      getChildren:item=>item?.children??(id==='problems'
        ?problemTreeChildren()
        :snapshot?.[id]??[{label:'Open assurance/procedure.yaml',children:[]}]),
      getTreeItem(item){
        const tree=new vscode.TreeItem(item.label,item.children?.length?vscode.TreeItemCollapsibleState.Collapsed:vscode.TreeItemCollapsibleState.None);
        tree.description=item.description;tree.tooltip=item.label+(item.line?' · L'+item.line:'');
        tree.kind=item.kind;
        if(item.kind==='problem-group'){
          tree.contextValue='skillStudio.problemGroup';
          tree.iconPath=new vscode.ThemeIcon('folder');
          tree.tooltip=item.label+'\n'+item.description;
        }
        if(item.kind==='compiler-diagnostic'){
          tree.contextValue='skillStudio.compilerDiagnostic';
          tree.iconPath=new vscode.ThemeIcon(item.severity==='warning'?'warning':'error');
          tree.tooltip=[
            item.message,
            item.code?'Code: '+item.code:null,
            item.path?'Compiler path: '+item.path:null,
            item.locationKind?'Location: '+item.locationKind:null,
            item.contributors?.length>1
              ?'Also reported by: '+item.contributors.filter(x=>x!=='Compiler').join(', ')
              :null
          ].filter(Boolean).join('\n');
          if(item.uri){
            tree.command={command:'skillStudio.revealCompilerDiagnostic',
              title:'Reveal Compiler Diagnostic',arguments:[item]};
          }
        }
        if(item.kind==='package-diagnostic'){
          tree.contextValue='skillStudio.packageDiagnostic';
          tree.iconPath=new vscode.ThemeIcon(item.severity==='error'?'error':
            item.severity==='warning'?'warning':'info');
          tree.tooltip=[
            item.message,
            item.domain?'Domain: '+item.domain:null,
            item.status?'Status: '+item.status:null,
            item.code?'Code: '+item.code:null,
            item.source??'Skill Studio · Package Audit',
            item.contributors?.length>1
              ?'Sources: '+item.contributors.join(', '):null
          ].filter(Boolean).join('\n');
        }
        if(item.kind==='current-node'&&document){
          tree.contextValue='skillStudio.currentNode';
          item.sourceVersion=document.version;item.documentUri=document.uri.toString();
          tree.procedureId=item.procedureId;tree.nodeId=item.nodeId;
          tree.sourceVersion=item.sourceVersion;tree.documentUri=item.documentUri;
        }
        if(document&&(item.line||item.range)&&item.kind!=='compiler-diagnostic'&&
           (item.kind!=='package-diagnostic'||item.uri)){
          const rootInfo=packageRootForProcedure(vscode,document);
          const uri=item.uri
            ?(typeof item.uri==="string"?vscode.Uri.parse(item.uri):item.uri)
            :item.sourcePath&&rootInfo?.uri
              ?vscode.Uri.joinPath(rootInfo.uri,...item.sourcePath.split("/"))
              :document.uri;
          tree.command={command:'skillStudio.revealInspection',title:'Reveal Source',
            arguments:[{...item,uri,version:document.version,
              sourceVersion:document.version,documentUri:document.uri.toString(),
              ...(item.uri?{auditGeneration:generation}:{})}]};
        }
        return tree;
      }};
    providers.set(id,emitter);treeProviders.set(id,provider);
    context.subscriptions.push(emitter,vscode.window.registerTreeDataProvider('skillStudio.'+id,provider));
  }
  const fire=()=>{for(const p of providers.values())p.fire();};
  // Audit status belongs to Problems. Do not refresh Inspector/Outline for
  // status-only changes: their Source-backed selection must remain stable.
  const fireProblems=()=>providers.get('problems')?.fire();
  function applyLanguageAnalysisStatus(status){
    const rootInfo=document?packageRootForProcedure(vscode,document):null;
    if(!rootInfo||status?.rootUri!==rootInfo.uri.toString())return;
    const sourceDiagnostics=Array.isArray(status.analysisDiagnostics)
      ?status.analysisDiagnostics:[];
    // The LSP may report a Package-level availability problem without any
    // source location. Keep it visible in Problems but never link it to line 1.
    const unlocatedAudit=Array.isArray(status.unlocated)
      ?status.unlocated.filter(item=>item.code==="PACKAGE_AUDIT_UNAVAILABLE"&&
        !sourceDiagnostics.some(source=>source.code===item.code)):[];
    audit=[...sourceDiagnostics,...unlocatedAudit].map(item=>{
      const relativePath=item.relativePath??"";
      const segments=relativePath.split("/");
      const candidate=relativePath&&!relativePath.startsWith("/")&&
        segments.every(part=>part&&part!=="."&&part!=="..")
          ?vscode.Uri.joinPath(rootInfo.uri,...segments):null;
      // Missing files and Package-level findings have a Package-root URI.
      // Never manufacture a clickable Source path for those findings.
      const sourceUri=candidate&&item.uri===candidate.toString()&&
        (item.source!=="package-audit"||
         (item.confidence==="exact"&&item.range))?candidate:null;
      return {
        kind:"package-diagnostic",code:item.code,message:item.message,
        severity:item.severity,status:item.status,domain:item.domain??"source",
        category:item.category,path:relativePath,relativePath,
        sourcePath:relativePath,
        line:sourceUri?item.line:undefined,column:sourceUri?item.column:undefined,
        range:sourceUri?item.range:undefined,uri:sourceUri,
        analysisGeneration:status.generation,source:item.source
      };
    });
    const errors=audit.filter(item=>item.severity==="error").length;
    const warnings=audit.filter(item=>item.severity==="warning").length;
    const notChecked=audit.filter(item=>item.status==="not_checked").length;
    const blocked=audit.filter(item=>item.status==="blocked").length;
    const affectedFiles=new Set(audit.map(item=>item.path).filter(Boolean)).size;
    auditStatus="Package Audit · "+errors+" errors / "+warnings+" warnings / "+
      affectedFiles+" files / "+notChecked+" NOT_CHECKED"+
      (blocked?" / "+blocked+" blocked":"")+
      " · Compiler / Owner qualification pending";
    fireProblems();
    // The accepted generation is now available to the Compiler marker
    // projector; never modify Compiler source evidence or LSP publications.
    compilerProblemsProvider?.refreshMarkers?.(status.rootUri);
  }
  const compilerProblemsChanged=compilerProblemsProvider?.onDidChange?.(()=>fireProblems());
  if(compilerProblemsChanged)context.subscriptions.push(compilerProblemsChanged);
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
      generation++;audit=[];
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
      const rootInfo=packageRootForProcedure(vscode,doc);
      snapshot={...inspectionSnapshot(text,selection,projected,evidenceFiles,
        rootInfo?.name??"skill",rootInfo?.uri?.toString?.()??"file:///skill"),
        text,evidenceStamp};
      fire();
    }
    const activeRoot=packageRootForProcedure(vscode,doc);
    const activeStatus=activeRoot&&languagePackageStatuses.get(activeRoot.uri.toString());
    if(activeStatus)applyLanguageAnalysisStatus(activeStatus);
  }
  async function auditCurrent(){
    const doc=document;
    if(!doc)throw Error("Open a current Skill Package before running Package Audit");
    const rootInfo=packageRootForProcedure(vscode,doc);
    if(!rootInfo)throw Error("Current document is not assurance/procedure.yaml");
    const state=languagePackages.get(rootInfo.uri.toString());
    if(!state)throw Error("Package is not attached to the current Language Service: "+
      JSON.stringify({activeDocument:doc.uri.toString(),activeRoot:rootInfo.uri.toString(),
        attachedPackages:[...languagePackages.keys()]}));
    audit=[];auditStatus="Package Audit · pending";fireProblems();
    const request=scheduleLanguagePackageRefresh(state,true);
    const status=await waitForLanguagePackageStatus(state,request.generation);
    applyLanguageAnalysisStatus(status);
    return {requested:true,rootUri:state.key,generation:request.generation,status:status.state,
      packageAuditState:status.packageAuditState};
  }
  function scheduleAudit(){
    generation++;
    const rootInfo=document?packageRootForProcedure(vscode,document):null;
    const state=rootInfo?languagePackages.get(rootInfo.uri.toString()):null;
    const accepted=state&&languagePackageStatuses.get(state.key);
    if(accepted&&accepted.generation===state.generation){
      applyLanguageAnalysisStatus(accepted);
      return;
    }
    audit=[];auditStatus=state?"Package Audit · pending":"Package Audit · not attached";
    fireProblems();
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
  context.subscriptions.push({dispose(){generation++;sessions.clear();selections.clear();}},
    vscode.commands.registerCommand('skillStudio.revealInspection',async item=>{
      if(!document||item.version!==document.version||
         (item.auditGeneration!==undefined&&item.auditGeneration!==generation))return;
      if(item.kind==='package-diagnostic'){
        const root=packageRootForProcedure(vscode,document);
        const state=root&&languagePackages.get(root.uri.toString());
        const accepted=root&&languagePackageStatuses.get(root.uri.toString());
        if(!item.uri||!state||!accepted||
           item.analysisGeneration!==state.generation||
           accepted.generation!==state.generation)return;
      }
      if(item.nodeId){selection={procedureId:item.procedureId,nodeId:item.nodeId};update(document);sessions.get(document.uri.toString())?.({type:'focusNode',...selection,version:document.version});}
      const doc=await vscode.workspace.openTextDocument(item.uri);
      const position=diagnosticSourcePosition(doc,item);
      if(!position)return;
      // Edits during the async Source open invalidate the selection.
      if(item.kind==='package-diagnostic'){
        const root=packageRootForProcedure(vscode,document);
        const state=root&&languagePackages.get(root.uri.toString());
        if(!state||item.analysisGeneration!==state.generation)return;
      }
      await openNativeSource(vscode,doc.uri,{
        preview:true,selection:new vscode.Range(
          position.line,position.character,position.line,position.character)
      });
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
    vscode.workspace.onDidChangeTextDocument(e=>{
      if(!document||!insideCurrentPackage(e.document?.uri))return;
      if(isProcedurePath(e.document.uri.path)&&document.uri.toString()===e.document.uri.toString())
        update(e.document);
      const predicatePath=document.uri.path.slice(0,-'procedure.yaml'.length)+'predicates.yaml';
      if(e.document.uri.path===predicatePath){
        predicateSnapshot=null;predicateGeneration++;
        void refreshPredicateSnapshot(document);
      }
      scheduleAudit();
    }),
    vscode.window.onDidChangeActiveTextEditor(editor=>{if(isProcedurePath(editor?.document.uri.path)){update(editor.document);scheduleAudit();}}));
  // Package Audit owns source/lock lifecycle independently from LSP and Compiler.
  // A missing or changed file in the current Package must invalidate accepted
  // markers immediately; a change in another Package must not.
  function insideCurrentPackage(uri){
    const root=document&&packageRootForProcedure(vscode,document)?.uri;
    if(!root||!uri||typeof uri.path!=="string")return false;
    if(root.scheme!==undefined&&uri.scheme!==undefined&&root.scheme!==uri.scheme)return false;
    if(root.authority!==undefined&&uri.authority!==undefined&&root.authority!==uri.authority)return false;
    return uri.path.startsWith(root.path.replace(/\/$/,"")+"/");
  }
  function watchWorkspace(event,callback){
    if(typeof event!=="function")return;
    const disposable=event(callback);
    if(disposable?.dispose)context.subscriptions.push(disposable);
  }
  watchWorkspace(vscode.workspace.onDidCreateFiles,event=>{
    if(event.files?.some(insideCurrentPackage))scheduleAudit();
  });
  watchWorkspace(vscode.workspace.onDidDeleteFiles,event=>{
    if(event.files?.some(insideCurrentPackage))scheduleAudit();
  });
  watchWorkspace(vscode.workspace.onDidRenameFiles,event=>{
    if(event.files?.some(item=>insideCurrentPackage(item.oldUri)||insideCurrentPackage(item.newUri)))
      scheduleAudit();
  });
  watchWorkspace(vscode.workspace.onDidChangeConfiguration,event=>{
    if(!document)return;
    const workspace=vscode.workspace.getWorkspaceFolder?.(document.uri)?.uri;
    if(!event?.affectsConfiguration||
       event.affectsConfiguration("connectionAgent.skillStudio",workspace)){
      const rootInfo=packageRootForProcedure(vscode,document);
      const state=rootInfo?languagePackages.get(rootInfo.uri.toString()):null;
      if(state)scheduleLanguagePackageRefresh(state,true);
      else scheduleAudit();
    }
  });
  // The pinned Markdown language extension is separate from the right-side
  // Studio Preview. Activation should be verified explicitly, not inferred
  // from whether it eagerly starts an optional Markdown preview Worker.
  context.subscriptions.push(vscode.commands.registerCommand(
    "skillStudio.internal.nativeMarkdownLanguageActivationAcceptance",async()=>{
      const extension=vscode.extensions?.getExtension?.(
        "vscode.markdown-language-features");
      if(!extension)throw Error("Pinned native Markdown language extension is missing");
      const activated=await Promise.race([
        Promise.resolve(extension.activate()).then(()=>true),
        new Promise((_,reject)=>setTimeout(()=>reject(
          Error("Native Markdown language extension activation timed out")),8000))
      ]);
      if(!activated||!extension.isActive)
        throw Error("Pinned Markdown language extension did not become active");
      const commands=await vscode.commands.getCommands(true);
      return {id:extension.id,isActive:extension.isActive,
        languageId:"markdown",
        commands:commands.filter(id=>id.startsWith("markdown.")).slice(0,40),
        workerStartup:"lazy-not-required-for-studio-preview"};
    }));
  async function findMarkdownAcceptanceDocument(skillName,relativePath){
    const name=typeof skillName==="string"?skillName:"establish-pdu-session";
    const target=typeof relativePath==="string"?relativePath:"SKILL.md";
    if(!/^[a-z0-9-]+$/.test(name))throw Error("Invalid Skill sample name");
    if(!/^(?:SKILL\.md|references\/[a-z0-9-]+\.md)$/i.test(target))
      throw Error("Markdown acceptance target must be a known Package-local Markdown path");
    const matches=await vscode.workspace.findFiles(
      "**/"+name+"/"+target,"**/node_modules/**",5);
    const suffix="/"+name+"/"+target;
    const exact=matches.filter(item=>item.path.endsWith(suffix));
    if(exact.length!==1)
      throw Error("Expected exactly one "+name+"/"+target+" in the active Workspace");
    const doc=await vscode.workspace.openTextDocument(exact[0]);
    if(doc.languageId!=="markdown")
      throw Error("Markdown Source language service was not selected: "+doc.languageId);
    return doc;
  }
  async function showMarkdownSource(doc){
    await vscode.window.showTextDocument(doc,{
      viewColumn:vscode.ViewColumn.One,preview:false,preserveFocus:false
    });
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  context.subscriptions.push(vscode.commands.registerCommand(
    "skillStudio.internal.markdownPreviewOpenAcceptance",async(skillName,relativePath)=>{
      const doc=await findMarkdownAcceptanceDocument(skillName,relativePath);
      await showMarkdownSource(doc);
      return doc.uri.toString();
    }));
  context.subscriptions.push(vscode.commands.registerCommand(
    "skillStudio.internal.markdownPreviewAcceptance",async skillName=>{
      const doc=await findMarkdownAcceptanceDocument(skillName,"SKILL.md");
      const key=doc.uri.toString();
      if(markdownPreviewAcceptanceOriginals.has(key))
        throw Error("Markdown Preview acceptance fixture is already active");
      const original=doc.getText();
      markdownPreviewAcceptanceOriginals.set(key,original);
      await showMarkdownSource(doc);
      const sections=Array.from({length:90},(_,index)=>
        "## Studio Scroll Section "+(index+1)+"\n\n"+
        "This paragraph provides stable source lines and preview height for real bidirectional scroll synchronization.\n"
      );
      const fixture=[
        "# Studio Markdown Preview Acceptance",
        "",
        "The **INITIAL** source-backed Markdown preview is live.",
        "",
        "| Field | Value |",
        "| --- | --- |",
        "| Renderer | Marked GFM |",
        "| Owner | Skill Studio |",
        "",
        "[Safe package reference](assurance/contract.yaml)",
        "[Traversal package reference](../../outside.md)",
        "[Missing package reference](missing.md)",
        "[External reference](https://example.com)",
        "![Remote image](https://example.invalid/markdown-pixel.png)",
        "",
        "<script>window.skillStudioMarkdownXss = true;</script>",
        "",
        ...sections
      ].join("\n");
      const edit=new vscode.WorkspaceEdit();
      edit.replace(doc.uri,new vscode.Range(doc.positionAt(0),doc.positionAt(original.length)),fixture);
      const applied=await vscode.workspace.applyEdit(edit);
      if(!applied){
        markdownPreviewAcceptanceOriginals.delete(key);
        throw Error("Could not apply the temporary Markdown Preview fixture");
      }
      return {uri:key,version:doc.version,lineCount:doc.lineCount};
    }));
  context.subscriptions.push(vscode.commands.registerCommand(
    "skillStudio.internal.markdownPreviewLiveUpdateAcceptance",async rawUri=>{
      const target=vscode.Uri.parse(String(rawUri??""));
      const key=target.toString(),doc=await vscode.workspace.openTextDocument(target);
      if(!markdownPreviewAcceptanceOriginals.has(key))
        throw Error("No original Markdown fixture is recorded for live-update acceptance");
      const original=doc.getText();
      if(!original.includes("**INITIAL**"))
        throw Error("Markdown Preview fixture marker is missing");
      const updated=original.replace("**INITIAL**","**UPDATED**");
      const edit=new vscode.WorkspaceEdit();
      edit.replace(target,new vscode.Range(doc.positionAt(0),doc.positionAt(original.length)),updated);
      if(!await vscode.workspace.applyEdit(edit))
        throw Error("Could not apply the Markdown Preview live update");
      return {uri:key,version:doc.version};
    }));
  context.subscriptions.push(vscode.commands.registerCommand(
    "skillStudio.internal.markdownPreviewSourceStateAcceptance",async rawUri=>{
      const key=String(rawUri??"");
      const editor=(vscode.window.visibleTextEditors??[]).find(item=>
        item.document.uri.toString()===key);
      if(!editor)throw Error("Markdown Source editor is not visible: "+key);
      return {uri:key,version:editor.document.version,
        visibleRanges:editor.visibleRanges.map(range=>({
          start:range.start.line+1,end:range.end.line+1
        }))};
    }));
  context.subscriptions.push(vscode.commands.registerCommand(
    "skillStudio.internal.markdownPreviewRevealSourceAcceptance",async(rawUri,line)=>{
      const key=String(rawUri??"");
      const editor=(vscode.window.visibleTextEditors??[]).find(item=>
        item.document.uri.toString()===key);
      if(!editor)throw Error("Markdown Source editor is not visible: "+key);
      if(!Number.isSafeInteger(line)||line<1||line>editor.document.lineCount)
        throw Error("Markdown Source scroll line is outside the current document");
      const position=new vscode.Position(line-1,0);
      editor.revealRange(new vscode.Range(position,position),
        vscode.TextEditorRevealType.AtTop);
      return {uri:key,line,version:editor.document.version};
    }));
  context.subscriptions.push(vscode.commands.registerCommand(
    "skillStudio.internal.restoreMarkdownPreviewAcceptance",async rawUri=>{
      const target=vscode.Uri.parse(String(rawUri??""));
      const key=target.toString(),original=markdownPreviewAcceptanceOriginals.get(key);
      if(typeof original!=="string")
        throw Error("No original Markdown Source content is recorded for restoration");
      const doc=await vscode.workspace.openTextDocument(target),current=doc.getText();
      const edit=new vscode.WorkspaceEdit();
      edit.replace(target,new vscode.Range(doc.positionAt(0),doc.positionAt(current.length)),original);
      if(!await vscode.workspace.applyEdit(edit))
        throw Error("Could not restore the original Markdown Source");
      markdownPreviewAcceptanceOriginals.delete(key);
      return {uri:key,version:doc.version};
    }));
  // Markdown Source activation is now observed by skillStudio.preview.
  // The native Markdown language extension remains installed for language
  // features; do not auto-create its CustomEditor Preview or editor groups.
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
  return {syncPackages:packages=>packageLanguageLifecycle.sync(packages),
    getAcceptedPackageDiagnostics(rootUri){
      const state=languagePackages.get(rootUri);
      const accepted=languagePackageStatuses.get(rootUri);
      return state&&!state.disposed&&accepted?.generation===state.generation&&
        accepted.state!=="UNAVAILABLE"&&Array.isArray(accepted.analysisDiagnostics)
        ?accepted.analysisDiagnostics:[];
    },
    attach(doc,post){
    sessions.set(doc.uri.toString(),post);update(doc);scheduleAudit();
    const releaseLanguagePackage=attachLanguagePackage(doc);
    return ()=>{if(sessions.get(doc.uri.toString())===post)
      sessions.delete(doc.uri.toString());releaseLanguagePackage();};
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
  },invalidateDependencyAnalysis(){
    // Dependency Lock changes invalidate dependency-derived editor analysis.
    // This remains editor-only analysis; it does not claim Compiler qualification.
    languagePackageStatuses.clear();
    for(const state of languagePackages.values()){
      if(!state.disposed)scheduleLanguagePackageRefresh(state,true);
    }
    updateLanguageStatus("ANALYZING",
      "Dependency configuration changed; editor analysis invalidated");
  },getActiveDocument(){return document;}};
}
