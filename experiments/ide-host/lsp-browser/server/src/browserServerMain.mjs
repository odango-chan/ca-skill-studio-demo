import {
  createConnection,
  BrowserMessageReader,
  BrowserMessageWriter
} from "vscode-languageserver/browser";
import { TextDocumentSyncKind } from "vscode-languageserver";
import { LanguageDiagnosticSession } from "../../../../../language/lsp/session.js";

const PACKAGE_SNAPSHOT_NOTIFICATION = "skillStudio/packageSnapshot";
const PACKAGE_CLOSE_NOTIFICATION = "skillStudio/packageClose";
const ANALYSIS_STATUS_NOTIFICATION = "skillStudio/analysisStatus";
const SERVER_ERROR_NOTIFICATION = "skillStudio/serverError";

const connection = createConnection(
  new BrowserMessageReader(self),
  new BrowserMessageWriter(self)
);
const sessions = new Map();

function reportError(message, rootUri = undefined) {
  connection.sendNotification(SERVER_ERROR_NOTIFICATION, {
    message: String(message),
    ...(typeof rootUri === "string" ? { rootUri } : {})
  });
}

function createSession(rootUri) {
  return new LanguageDiagnosticSession({
    publish(result) {
      // Package Audit remains owned by the existing host audit collection in
      // this integration slice. Avoid publishing the same warnings twice.
      const diagnostics = result.diagnostics.filter(item =>
        item.code !== "PACKAGE_AUDIT_UNAVAILABLE" &&
        item.source !== "Skill Studio · package-audit"
      );
      connection.sendDiagnostics({
        uri: result.uri,
        diagnostics,
        ...(Number.isSafeInteger(result.version) ? { version: result.version } : {})
      });
    },
    status(result) {
      connection.sendNotification(ANALYSIS_STATUS_NOTIFICATION, {
        ...result,
        rootUri
      });
    }
  });
}

connection.onInitialize(() => ({
  capabilities: {
    // The extension host sends bounded, complete Package snapshots as a
    // custom notification. Do not establish a second TextDocument owner.
    textDocumentSync: TextDocumentSyncKind.None
  },
  serverInfo: {
    name: "Skill Studio Language Service",
    version: "0.1.0"
  }
}));

connection.onNotification(PACKAGE_SNAPSHOT_NOTIFICATION, async snapshot => {
  if (!snapshot || typeof snapshot !== "object" ||
      typeof snapshot.rootUri !== "string" || !snapshot.rootUri.trim()) {
    reportError("Rejected Package snapshot without a valid root URI");
    return;
  }
  let session = sessions.get(snapshot.rootUri);
  if (!session) {
    session = createSession(snapshot.rootUri);
    sessions.set(snapshot.rootUri, session);
  }
  try {
    const result = await session.submit(snapshot);
    if (!result.accepted && result.reason !== "SUPERSEDED" &&
        result.reason !== "STALE_GENERATION" &&
        result.reason !== "STALE_DOCUMENT")
      reportError("Package analysis rejected: " + result.reason, snapshot.rootUri);
  } catch (error) {
    reportError(error?.message ?? error, snapshot.rootUri);
  }
});

connection.onNotification(PACKAGE_CLOSE_NOTIFICATION, params => {
  const rootUri = params?.rootUri;
  if (typeof rootUri !== "string") return;
  const session = sessions.get(rootUri);
  if (session) {
    session.dispose();
    sessions.delete(rootUri);
  }
});

connection.onShutdown(() => {
  for (const session of sessions.values()) session.dispose();
  sessions.clear();
});

connection.listen();
