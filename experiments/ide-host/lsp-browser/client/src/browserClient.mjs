import { LanguageClient, ErrorAction, CloseAction, State } from "vscode-languageclient/browser";
import { CompletionRequest, SemanticTokensRequest } from "vscode-languageserver-protocol";
import { SKILL_SEMANTIC_TOKEN_TYPES, SKILL_SEMANTIC_TOKEN_MODIFIERS } from "../../../../../language/semantic-tokens.mjs";
import studioLightTheme from "../../../../../extensions/skill-studio-theme/themes/skill-studio-light-color-theme.json";
import { createSemanticTokenDecorationRenderer } from "./semantic-token-decorations.mjs";
import { toNativeCompletionItems } from "./native-completion-items.mjs";
import { toLspCompletionContext } from "./completion-context.mjs";

export const PACKAGE_SNAPSHOT_NOTIFICATION = "skillStudio/packageSnapshot";
export const PACKAGE_SNAPSHOT_ACCEPTED_NOTIFICATION = "skillStudio/packageSnapshotAccepted";
export const PACKAGE_INVALIDATE_NOTIFICATION = "skillStudio/packageInvalidate";
export const PACKAGE_CLOSE_NOTIFICATION = "skillStudio/packageClose";
export const ANALYSIS_STATUS_NOTIFICATION = "skillStudio/analysisStatus";
export const SERVER_ERROR_NOTIFICATION = "skillStudio/serverError";
export const HEALTH_REQUEST = "skillStudio/health";

/** Browser-only client. The Theia/VS Code extension host owns all workspace IO. */
function workerResourceUrl(uri) {
  const value = uri.toString(true);
  const path = globalThis.location?.pathname ?? "";
  if (!path.endsWith("/plugin-worker.js") ||
      (uri.scheme !== "http" && uri.scheme !== "https")) return value;
  const base = path.slice(0, -"/plugin-worker.js".length);
  if (!base) return value;
  try {
    const origin = globalThis.location.origin;
    const parsed = new URL(value, origin);
    if (parsed.origin !== origin || !parsed.pathname.startsWith("/hostedPlugin/"))
      return value;
    return base + parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return value;
  }
}

export function createSkillLanguageClient(vscode, context, handlers = {}) {
  const serverUri = vscode.Uri.joinPath(
    context.extensionUri, "dist", "skill-language-server.js"
  );
  const worker = new Worker(workerResourceUrl(serverUri), {
    name: "skill-studio-language-server"
  });
  const output = vscode.window.createOutputChannel("Skill Studio · Language Service");
  let startPromise = null;
  let started = false;
  let stopped = false;
  let terminalFailure = null;
  let heartbeatTimer = null;
  let clientStopPromise = null;
  let client = null;
  let semanticTokenRegistration = null;
  let completionRegistration = null;
  let semanticTokenChangeEmitter = null;
  let semanticTokenRenderer = null;
  let semanticTokenRefreshQueued = false;
  function refreshTheiaSemanticTokens() {
    if (stopped || terminalFailure || !semanticTokenChangeEmitter ||
        semanticTokenRefreshQueued) return;
    semanticTokenRefreshQueued = true;
    queueMicrotask(() => {
      semanticTokenRefreshQueued = false;
      if (!stopped && !terminalFailure) semanticTokenChangeEmitter?.fire();
    });
  }
  function stopClientAfterFailure() {
    if (!started || !client) return Promise.resolve();
    if (!clientStopPromise) {
      try {
        // LanguageClient.stop() enters SDK cleanup synchronously before its
        // shutdown handshake, so its owned diagnostics disappear immediately.
        clientStopPromise = client.stop().catch(error => {
          output.appendLine("LanguageClient cleanup after Worker failure: " +
            String(error?.message ?? error));
        });
      } catch (error) {
        output.appendLine("LanguageClient cleanup after Worker failure: " +
          String(error?.message ?? error));
        clientStopPromise = Promise.resolve();
      }
    }
    return clientStopPromise;
  }
  function fatal(reason, { stopClient = false } = {}) {
    if (stopped || terminalFailure) return;
    terminalFailure = String(reason?.message ?? reason ?? "Browser Worker connection stopped");
    clearTimeout(heartbeatTimer);
    output.appendLine("Language Worker unavailable: " + terminalFailure);
    handlers.onFatal?.({ message: terminalFailure });
    // A Worker event or watchdog timeout is outside vscode-languageclient's
    // own close/error handlers. Converge it on SDK stop so its OWN diagnostic
    // collection is disposed; never clear host Package Audit diagnostics.
    if (stopClient) void stopClientAfterFailure();
  }
  worker.addEventListener("error", event => {
    fatal(event?.message || "Browser language Worker crashed", { stopClient: true });
  });
  worker.addEventListener("messageerror", () => {
    fatal("Browser language Worker message could not be decoded", { stopClient: true });
  });
  function registerTheiaSemanticTokenProvider(){
    if(!handlers.manualSemanticTokens||semanticTokenRegistration)return;
    if(typeof vscode.languages?.registerDocumentSemanticTokensProvider!=="function"||
       typeof vscode.SemanticTokensLegend!=="function"||
       typeof vscode.SemanticTokens!=="function"){
      output.appendLine("Native semantic-token API unavailable in this host");
      return;
    }
    const legend=new vscode.SemanticTokensLegend(
      [...SKILL_SEMANTIC_TOKEN_TYPES],
      [...SKILL_SEMANTIC_TOKEN_MODIFIERS]
    );
    try{
      semanticTokenRenderer=createSemanticTokenDecorationRenderer(
        vscode,SKILL_SEMANTIC_TOKEN_TYPES,studioLightTheme.semanticTokenColors??{}
      );
      handlers.onSemanticTokenRendererRegistered?.({
        renderer:"theia-text-editor-decoration",
        tokenTypeCount:SKILL_SEMANTIC_TOKEN_TYPES.length
      });
    }catch(error){
      semanticTokenRenderer=null;
      handlers.onSemanticTokenRendererUnavailable?.(String(error?.message??error));
      output.appendLine("Theia semantic decoration adapter unavailable: "+
        String(error?.message??error));
    }
    semanticTokenChangeEmitter=new vscode.EventEmitter();
    const provider={
      onDidChangeSemanticTokens:semanticTokenChangeEmitter.event,
      async provideDocumentSemanticTokens(document,cancellationToken){
        if(stopped||terminalFailure||cancellationToken?.isCancellationRequested)
          return new vscode.SemanticTokens(new Uint32Array());
        const uri=document.uri.toString();
        handlers.onSemanticTokenRequest?.(uri);
        try{
          const requestTokens=()=>client.sendRequest(
            SemanticTokensRequest.type,
            {textDocument:{uri:document.uri.toString()}},
            cancellationToken
          );
          let result=await requestTokens();
          if(cancellationToken?.isCancellationRequested)
            return new vscode.SemanticTokens(new Uint32Array());
          let data=Uint32Array.from(result?.data??[]);
          let serverDiagnostics=null;
          if(data.length===0){
            try{
              serverDiagnostics=await client.sendRequest(
                "skillStudio/semanticTokenDiagnostics",{uri}
              );
              // On first open, the editor can request tokens before the
              // Package snapshot notification has reached the Worker. Wait
              // briefly for that exact snapshot to become queryable, then
              // retry once. Empty tokens for a known Package remain valid.
              for(let attempt=0;!serverDiagnostics?.packageFound&&attempt<40;attempt++){
                if(cancellationToken?.isCancellationRequested)
                  return new vscode.SemanticTokens(new Uint32Array());
                await new Promise(resolve=>setTimeout(resolve,50));
                serverDiagnostics=await client.sendRequest(
                  "skillStudio/semanticTokenDiagnostics",{uri}
                );
              }
              if(serverDiagnostics?.packageFound){
                result=await requestTokens();
                if(cancellationToken?.isCancellationRequested)
                  return new vscode.SemanticTokens(new Uint32Array());
                data=Uint32Array.from(result?.data??[]);
              }
              handlers.onSemanticTokenServerDiagnostics?.(serverDiagnostics);
            }catch{/* Diagnostics are acceptance-only and optional. */}
          }
          handlers.onSemanticTokenResult?.(uri,data.length/5);
          if(semanticTokenRenderer){
            try{
              const rendering=semanticTokenRenderer.render(document,data);
              handlers.onSemanticTokenRendered?.(uri,rendering);
            }catch(error){
              handlers.onSemanticTokenRenderError?.(uri,String(error?.message??error));
              output.appendLine("Semantic token decoration failed: "+
                String(error?.message??error));
            }
          }
          if(data.length!==0)handlers.onSemanticTokenServerDiagnostics?.(null);
          return new vscode.SemanticTokens(data,result?.resultId);
        }catch(error){
          if(!stopped&&!terminalFailure){
            handlers.onSemanticTokenError?.(uri,String(error?.message??error));
            output.appendLine("Semantic token request failed: "+
              String(error?.message??error));
          }
          return new vscode.SemanticTokens(new Uint32Array());
        }
      }
    };
    semanticTokenRegistration=vscode.languages.registerDocumentSemanticTokensProvider(
      [
        {scheme:"file",pattern:"**/*.yaml"},
        {scheme:"file",pattern:"**/*.yml"},
        {scheme:"file",pattern:"**/*.py"},
        {scheme:"file",pattern:"**/SKILL.md"}
      ],
      provider,
      legend
    );
    handlers.onSemanticTokenProviderRegistered?.({
      registered:true,tokenTypeCount:SKILL_SEMANTIC_TOKEN_TYPES.length
    });
    output.appendLine("Registered Theia semantic-token adapter from the canonical Skill Language catalog");
  }

  // Theia 1.76's native LanguageClient adapter does not consistently expose
  // LSP CompletionItems through the public editor provider API. Keep the Worker
  // as the single completion engine and bridge its exact CompletionRequest into
  // Theia's native CompletionItemProvider. VS Code uses its normal LSP adapter.
  function registerTheiaCompletionProvider(){
    if(!handlers.manualCompletionProvider||completionRegistration)return;
    if(typeof vscode.languages?.registerCompletionItemProvider!=="function"){
      output.appendLine("Native CompletionItemProvider API unavailable in this host");
      return;
    }
    const provider={
      async provideCompletionItems(document,position,cancellationToken,context){
        const lspContext=toLspCompletionContext(context);
        const lineText=document.lineAt(position.line).text;
        handlers.onCompletionProviderRequest?.({
          uri:document.uri.toString(),
          languageId:document.languageId,
          version:document.version,
          position:{line:position.line,character:position.character},
          lineText,
          prefix:lineText.slice(0,position.character),
          editorTriggerKind:context?.triggerKind??null,
          lspTriggerKind:lspContext.triggerKind,
          triggerCharacter:context?.triggerCharacter??null
        });
        if(stopped||terminalFailure||!started||cancellationToken?.isCancellationRequested)
          return [];
        try{
          const result=await client.sendRequest(CompletionRequest.type,{
            textDocument:{uri:document.uri.toString()},
            position:{line:position.line,character:position.character},
            context:lspContext
          },cancellationToken);
          if(cancellationToken?.isCancellationRequested)return [];
          const nativeItems=toNativeCompletionItems(result,vscode);
          handlers.onCompletionProviderResult?.({
            uri:document.uri.toString(),
            labels:nativeItems.map(item=>item.label),
            count:nativeItems.length
          });
          return nativeItems;
        }catch(error){
          handlers.onCompletionProviderError?.({
            uri:document.uri.toString(),message:String(error?.message??error)
          });
          if(!stopped&&!terminalFailure)
            output.appendLine("Theia Schema completion request failed: "+
              String(error?.message??error));
          return [];
        }
      }
    };
    completionRegistration=vscode.languages.registerCompletionItemProvider(
      [
        {scheme:"file",pattern:"**/*.yaml"},
        {scheme:"file",pattern:"**/*.yml"}
      ],
      provider,":","/",".",
    );
    handlers.onCompletionProviderRegistered?.({registered:true,transport:"browser-lsp-worker"});
    output.appendLine("Registered Theia native YAML CompletionItemProvider over the shared Skill Language Worker");
  }

  // Register the cross-language Definition adapter before LanguageClient
  // installs its generic providers. For a Python Skill entrypoint, the
  // Package index knows the authoritative YAML caller range; return that
  // location first so native Go to Definition / Ctrl-click / Peek prefers
  // the Skill declaration over a Python provider's same-file symbol result.
  // Returning undefined preserves ordinary Python Definition behavior.
  let crossLanguageDefinitionRegistration = null;
  if (typeof vscode.languages?.registerDefinitionProvider === "function") {
    crossLanguageDefinitionRegistration = vscode.languages.registerDefinitionProvider(
      { scheme: "file", pattern: "**/*.py" },
      {
        async provideDefinition(document, position, cancellationToken) {
          if (stopped || terminalFailure || !started ||
              cancellationToken?.isCancellationRequested) return undefined;
          try {
            const result = await client.sendRequest("textDocument/definition", {
              textDocument: { uri: document.uri.toString() },
              position: { line: position.line, character: position.character }
            }, cancellationToken);
            if (cancellationToken?.isCancellationRequested) return undefined;
            const locations = (Array.isArray(result) ? result : result ? [result] : [])
              .filter(item => typeof item?.uri === "string" &&
                /\.ya?ml$/i.test(item.uri) && item.range?.start && item.range?.end)
              .map(item => new vscode.Location(
                vscode.Uri.parse(item.uri),
                new vscode.Range(
                  item.range.start.line, item.range.start.character,
                  item.range.end.line, item.range.end.character
                )
              ));
            return locations.length ? locations : undefined;
          } catch (error) {
            output.appendLine("Cross-language Definition request failed: " +
              String(error?.message ?? error));
            return undefined;
          }
        }
      }
    );
  }

  client = new LanguageClient(
    "skillStudioLanguageService",
    "Skill Studio Language Service",
    {
      // The Theia browser host can expose Package Source documents as
      // languageId "plaintext" when no standalone YAML/Python language plugin
      // owns that editor. Package snapshots still carry the authoritative
      // languageId for analysis; register providers by the real workspace URI
      // path as well, so native Definition/Hover/References commands reach LSP.
      documentSelector: [
        { scheme: "file", pattern: "**/*.yaml" },
        { scheme: "file", pattern: "**/*.yml" },
        { scheme: "file", pattern: "**/*.py" },
        { language: "yaml" },
        { language: "python" }
      ],
      synchronize: {},
      // Theia uses the native CompletionItemProvider below as the canonical
      // editor bridge. Its LanguageClient adapter would register a second
      // provider for the same Worker and duplicate every Schema candidate.
      // Keep the standard LSP completion provider on VS Code only.
      ...(handlers.manualCompletionProvider===true?{
        middleware:{
          provideCompletionItem(document,position,context,token,next){
            // The manual bridge owns YAML completion in Theia; preserve the
            // standard LanguageClient provider for Python and other documents.
            if(completionRegistration&&/\.ya?ml$/i.test(document.uri.path))return [];
            return next(document,position,context,token);
          }
        }
      }:{}),
      initializationOptions: handlers.localSemanticTokens === true
        ? {disableSemanticTokens:true} : {},
      outputChannel: output,
      errorHandler: {
        error(error) {
          fatal(error);
          return { action: ErrorAction.Shutdown };
        },
        closed() {
          fatal("Browser language Worker connection closed");
          return { action: CloseAction.DoNotRestart };
        }
      }
    },
    worker
  );

  // Browser Worker termination can be silent (no error/close event).
  // A bounded read-only request detects a dead transport without probing
  // Source files, restarting, or making the analysis state artificially READY.
  function scheduleHeartbeat(){
    if(stopped||terminalFailure||!started)return;
    heartbeatTimer=setTimeout(async()=>{
      heartbeatTimer=null;
      if(stopped||terminalFailure)return;
      let timeout=null;
      try{
        await Promise.race([
          client.sendRequest(HEALTH_REQUEST),
          new Promise((_,reject)=>{
            timeout=setTimeout(()=>reject(Error("Browser language Worker health request timed out")),5000);
          })
        ]);
      }catch(error){fatal(error,{stopClient:true});}
      finally{if(timeout!==null)clearTimeout(timeout);}
      if(!stopped&&!terminalFailure)scheduleHeartbeat();
    },2000);
  }

  client.onDidChangeState(event => {
    if (started && !stopped && event.newState === State.Stopped)
      fatal("Browser LanguageClient stopped unexpectedly");
  });
  client.onNotification(PACKAGE_SNAPSHOT_ACCEPTED_NOTIFICATION, accepted => {
    if (!terminalFailure && accepted?.rootUri && Number.isSafeInteger(accepted.generation)) {
      handlers.onPackageSnapshotAccepted?.(accepted);
      refreshTheiaSemanticTokens();
    }
  });
  client.onNotification(ANALYSIS_STATUS_NOTIFICATION, status => {
    if (!terminalFailure) handlers.onStatus?.(status);
    // The manual Theia provider is an adapter over the same LSP endpoint.
    // Refresh it whenever the accepted Package generation changes state.
    refreshTheiaSemanticTokens();
    if (status?.state === "UNAVAILABLE" && status?.reason)
      output.appendLine("Analysis unavailable: " + status.reason);
  });
  client.onNotification(SERVER_ERROR_NOTIFICATION, error => {
    if (!terminalFailure) handlers.onError?.(error);
    output.appendLine("Language server error: " + String(error?.message ?? error));
  });

  return {
    async start() {
      if (stopped) throw new Error("Language client has already stopped");
      if (!startPromise) {
        startPromise = client.start().then(() => {
          started = true;
          registerTheiaSemanticTokenProvider();
          registerTheiaCompletionProvider();
          scheduleHeartbeat();
        });
      }
      await startPromise;
      if (terminalFailure) throw Error("Language Worker unavailable: " + terminalFailure);
    },
    invalidatePackage(rootUri, generation) {
      if (!started || stopped || terminalFailure) return;
      client.sendNotification(PACKAGE_INVALIDATE_NOTIFICATION, { rootUri, generation });
      refreshTheiaSemanticTokens();
    },
    sendPackageSnapshot(snapshot) {
      if (!started || stopped || terminalFailure)
        throw new Error("Language Worker unavailable: " + (terminalFailure ?? "not running"));
      client.sendNotification(PACKAGE_SNAPSHOT_NOTIFICATION, snapshot);
      // The editor may request tokens before the first Package snapshot exists.
      // Refresh after posting the snapshot so the next provider request is
      // ordered behind it on the same Worker message channel; the server stores
      // the snapshot before awaiting its independent analysis session.
      refreshTheiaSemanticTokens();
    },
    provideCompletion(uri,position) {
      if(!started||stopped||terminalFailure)
        throw new Error("Language Worker unavailable: "+(terminalFailure??"not running"));
      return client.sendRequest(CompletionRequest.type,{
        textDocument:{uri},
        position:{line:position.line,character:position.character},
        context:{triggerKind:1}
      });
    },
    closePackage(rootUri) {
      if (!started || stopped || terminalFailure) return;
      client.sendNotification(PACKAGE_CLOSE_NOTIFICATION, { rootUri });
      refreshTheiaSemanticTokens();
    },
    hasDiagnosticCollectionForAcceptance(){
      return Boolean(client.diagnostics);
    },
    diagnosticsForAcceptance(uri){
      const collection=client.diagnostics;
      return collection?.get(vscode.Uri.parse(String(uri)))??null;
    },
    terminateWorkerForAcceptance(){
      // Never expose an arbitrary Worker termination path on deployed Pages.
      const hostname=globalThis.location?.hostname??"";
      if(!/^(localhost|127(?:\.\d{1,3}){3})$/.test(hostname))
        throw Error("L2-D4 Worker termination probe is local-test-only");
      if(!started||stopped||terminalFailure)
        throw Error("L2-D4 language Worker is not running");
      worker.terminate();
      // Deliberately do NOT call fatal(): the real watchdog/transport path
      // must independently observe loss of the actual dedicated Worker.
      return {actualWorkerTerminated:true,
        workerName:"skill-studio-language-server",
        scriptUri:serverUri.toString(true)};
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      clearTimeout(heartbeatTimer);
      try {
        if (startPromise) {
          await startPromise.catch(() => {});
          if (started) {
            if(clientStopPromise)await clientStopPromise;
            else await client.stop();
          }
        }
      } finally {
        crossLanguageDefinitionRegistration?.dispose?.();
        crossLanguageDefinitionRegistration=null;
        completionRegistration?.dispose?.();
        completionRegistration=null;
        semanticTokenRegistration?.dispose?.();
        semanticTokenRegistration=null;
        semanticTokenRenderer?.dispose?.();
        semanticTokenRenderer=null;
        semanticTokenChangeEmitter?.dispose?.();
        semanticTokenChangeEmitter=null;
        worker.terminate();
        output.dispose();
      }
    }
  };
}
