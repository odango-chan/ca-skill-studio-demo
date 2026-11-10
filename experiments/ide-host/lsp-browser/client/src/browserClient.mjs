import { LanguageClient, ErrorAction, CloseAction, State } from "vscode-languageclient/browser";

export const PACKAGE_SNAPSHOT_NOTIFICATION = "skillStudio/packageSnapshot";
export const PACKAGE_INVALIDATE_NOTIFICATION = "skillStudio/packageInvalidate";
export const PACKAGE_CLOSE_NOTIFICATION = "skillStudio/packageClose";
export const ANALYSIS_STATUS_NOTIFICATION = "skillStudio/analysisStatus";
export const SERVER_ERROR_NOTIFICATION = "skillStudio/serverError";

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
  function fatal(reason) {
    if (stopped || terminalFailure) return;
    terminalFailure = String(reason?.message ?? reason ?? "Browser Worker connection stopped");
    output.appendLine("Language Worker unavailable: " + terminalFailure);
    handlers.onFatal?.({ message: terminalFailure });
  }
  worker.addEventListener("error", event => {
    fatal(event?.message || "Browser language Worker crashed");
  });
  worker.addEventListener("messageerror", () => {
    fatal("Browser language Worker message could not be decoded");
  });
  const client = new LanguageClient(
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
    async stop() {
      if (stopped) return;
      stopped = true;
      try {
        if (startPromise) {
          await startPromise.catch(() => {});
          if (started) await client.stop();
        }
      } finally {
        worker.terminate();
        output.dispose();
      }
    }
  };
}
