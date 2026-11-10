import { LanguageClient, ErrorAction, CloseAction, State } from "vscode-languageclient/browser";

export const PACKAGE_SNAPSHOT_NOTIFICATION = "skillStudio/packageSnapshot";
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
      initializationOptions: {},
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
  client.onNotification(ANALYSIS_STATUS_NOTIFICATION, status => {
    if (!terminalFailure) handlers.onStatus?.(status);
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
          scheduleHeartbeat();
        });
      }
      await startPromise;
      if (terminalFailure) throw Error("Language Worker unavailable: " + terminalFailure);
    },
    invalidatePackage(rootUri, generation) {
      if (!started || stopped || terminalFailure) return;
      client.sendNotification(PACKAGE_INVALIDATE_NOTIFICATION, { rootUri, generation });
    },
    sendPackageSnapshot(snapshot) {
      if (!started || stopped || terminalFailure)
        throw new Error("Language Worker unavailable: " + (terminalFailure ?? "not running"));
      client.sendNotification(PACKAGE_SNAPSHOT_NOTIFICATION, snapshot);
    },
    closePackage(rootUri) {
      if (!started || stopped || terminalFailure) return;
      client.sendNotification(PACKAGE_CLOSE_NOTIFICATION, { rootUri });
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
        worker.terminate();
        output.dispose();
      }
    }
  };
}
