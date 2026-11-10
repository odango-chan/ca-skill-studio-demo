import { LanguageClient } from "vscode-languageclient/browser";

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
  const client = new LanguageClient(
    "skillStudioLanguageService",
    "Skill Studio Language Service",
    {
      documentSelector: [
        { language: "yaml" },
        { language: "python" }
      ],
      synchronize: {},
      initializationOptions: {},
      outputChannel: output
    },
    worker
  );

  let startPromise = null;
  let started = false;
  let stopped = false;
  client.onNotification(ANALYSIS_STATUS_NOTIFICATION, status => {
    handlers.onStatus?.(status);
    if (status?.state === "UNAVAILABLE" && status?.reason)
      output.appendLine("Analysis unavailable: " + status.reason);
  });
  client.onNotification(SERVER_ERROR_NOTIFICATION, error => {
    handlers.onError?.(error);
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
    },
    invalidatePackage(rootUri, generation) {
      if (!started || stopped) return;
      client.sendNotification(PACKAGE_INVALIDATE_NOTIFICATION, { rootUri, generation });
    },
    sendPackageSnapshot(snapshot) {
      if (!started || stopped) throw new Error("Language client is not running");
      client.sendNotification(PACKAGE_SNAPSHOT_NOTIFICATION, snapshot);
    },
    closePackage(rootUri) {
      if (!started || stopped) return;
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
