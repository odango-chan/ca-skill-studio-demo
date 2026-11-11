import {
  createConnection,
  BrowserMessageReader,
  BrowserMessageWriter
} from "vscode-languageserver/browser";
import {
  TextDocumentSyncKind,
  CompletionItemKind,
  SymbolKind,
  SemanticTokensBuilder
} from "vscode-languageserver";
import {
  collectSkillSemanticTokenSpans,
  SKILL_SEMANTIC_TOKEN_TYPES,
  SKILL_SEMANTIC_TOKEN_MODIFIERS
} from "../../../../../language/semantic-tokens.mjs";
import { parseDocument, isMap, isScalar } from "yaml";
import { LanguageDiagnosticSession } from "../../../../../language/lsp/session.js";

const PACKAGE_SNAPSHOT_NOTIFICATION = "skillStudio/packageSnapshot";
const PACKAGE_INVALIDATE_NOTIFICATION = "skillStudio/packageInvalidate";
const PACKAGE_CLOSE_NOTIFICATION = "skillStudio/packageClose";
const ANALYSIS_STATUS_NOTIFICATION = "skillStudio/analysisStatus";
const SERVER_ERROR_NOTIFICATION = "skillStudio/serverError";

const connection = createConnection(
  new BrowserMessageReader(self),
  new BrowserMessageWriter(self)
);
const sessions = new Map();
const packageAnalyses = new Map();
const requestedGeneration = new Map();

function reportError(message, rootUri = undefined) {
  connection.sendNotification(SERVER_ERROR_NOTIFICATION, {
    message: String(message),
    ...(typeof rootUri === "string" ? { rootUri } : {})
  });
}

function createSession(rootUri) {
  const published = new Map();
  return new LanguageDiagnosticSession({
    publish(result) {
      // Package Audit remains owned by the existing host audit collection in
      // this integration slice. Avoid publishing the same warnings twice.
      const diagnostics = result.diagnostics.filter(item =>
        item.code !== "PACKAGE_AUDIT_UNAVAILABLE" &&
        item.source !== "Skill Studio · package-audit"
      );
      published.set(result.uri, diagnostics.length);
      connection.sendDiagnostics({
        uri: result.uri,
        diagnostics,
        ...(Number.isSafeInteger(result.version) ? { version: result.version } : {})
      });
    },
    status(result) {
      const publishedDiagnosticCount = [...published.values()]
        .reduce((total, count) => total + count, 0);
      // Observability only: PARTIAL with zero published diagnostics must not
      // look like a successful empty analysis. Expose exact component states
      // of the *same* accepted generation; do not weaken readiness criteria.
      const current = packageAnalyses.get(rootUri);
      const analysis = current?.snapshot.generation === result.generation ?
        current.analysis : null;
      const partialDetail = result.state === "PARTIAL" && analysis ? {
        procedureState: analysis.procedure.state,
        procedureDiagnosticCount: analysis.procedure.diagnostics.length,
        packageAuditState: analysis.packageAudit.state,
        packageAuditReason: analysis.packageAudit.reason ?? null
      } : {};
      connection.sendNotification(ANALYSIS_STATUS_NOTIFICATION, {
        ...result,
        ...partialDetail,
        rootUri,
        publishedDiagnosticCount
      });
    },
    analysis(snapshot, analysis) {
      if (requestedGeneration.get(rootUri) === snapshot.generation)
        packageAnalyses.set(rootUri, { snapshot, analysis });
      refreshSemanticTokens();
    }
  });
}

function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\r") {
      if (text[i + 1] === "\n") i++;
      starts.push(i + 1);
    } else if (text[i] === "\n") {
      starts.push(i + 1);
    }
  }
  return starts;
}

function positionAt(starts, offset) {
  let low = 0, high = starts.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (starts[mid] <= offset) low = mid + 1;
    else high = mid - 1;
  }
  return { line: high, character: offset - starts[high] };
}

function semanticTokensForDocument(document) {
  const spans=collectSkillSemanticTokenSpans(document.text,document.relativePath);
  const starts=lineStarts(document.text);
  const builder=new SemanticTokensBuilder();
  for(const span of spans){
    if(!Number.isSafeInteger(span.start)||!Number.isSafeInteger(span.end)||
       span.start<0||span.end<=span.start||span.end>document.text.length||
       !Number.isSafeInteger(span.tokenType)||!Number.isSafeInteger(span.tokenModifiers))
      continue;
    const first=positionAt(starts,span.start);
    const last=positionAt(starts,span.end);
    for(let line=first.line;line<=last.line;line++){
      const lineStart=starts[line];
      let lineEnd=line+1<starts.length?starts[line+1]:document.text.length;
      if(lineEnd>lineStart&&document.text[lineEnd-1]==="\\n")lineEnd--;
      if(lineEnd>lineStart&&document.text[lineEnd-1]==="\\r")lineEnd--;
      const segmentStart=Math.max(span.start,lineStart);
      const segmentEnd=Math.min(span.end,lineEnd);
      if(segmentEnd<=segmentStart)continue;
      builder.push(line,segmentStart-lineStart,segmentEnd-segmentStart,
        span.tokenType,span.tokenModifiers);
    }
  }
  return builder.build();
}

function refreshSemanticTokens(){
  try{
    const refresh=connection.languages?.semanticTokens?.refresh;
    if(typeof refresh==="function")void refresh().catch(()=>{});
  }catch{/* Older clients may not support workspace semantic-token refresh. */}
}

function offsetAt(text, position) {
  if (!Number.isSafeInteger(position?.line) ||
      !Number.isSafeInteger(position?.character) ||
      position.line < 0 || position.character < 0) return null;
  const starts = lineStarts(text);
  if (position.line >= starts.length) return null;
  const start = starts[position.line];
  let end = position.line + 1 < starts.length ? starts[position.line + 1] : text.length;
  if (end > start && text[end - 1] === "\n") end--;
  if (end > start && text[end - 1] === "\r") end--;
  if (position.character > end - start) return null;
  return start + position.character;
}

function toLspRange(text, range) {
  if (!range || !Number.isSafeInteger(range.start) ||
      !Number.isSafeInteger(range.end) || range.start < 0 ||
      range.end < range.start || range.end > text.length) return null;
  const starts = lineStarts(text);
  return {
    start: positionAt(starts, range.start),
    end: positionAt(starts, range.end)
  };
}

function contains(range, offset) {
  return Boolean(range && Number.isSafeInteger(range.start) &&
    Number.isSafeInteger(range.end) && offset >= range.start && offset <= range.end);
}

function packageForUri(uri) {
  for (const value of packageAnalyses.values()) {
    if (value.snapshot.documents.some(document => document.uri === uri))
      return value;
  }
  return null;
}

function documentFor(value, uri) {
  return value?.snapshot.documents.find(document => document.uri === uri) ?? null;
}

function allReferences(analysis) {
  return [...analysis.scriptReferences, ...analysis.schemaReferences];
}

function referenceAt(value, uri, offset) {
  for (const reference of allReferences(value.analysis)) {
    if (reference.sourceUri === uri && contains(reference.sourceRange, offset))
      return { reference, side: "source" };
    if (reference.targetUri === uri && contains(reference.targetRange, offset))
      return { reference, side: "target" };
  }
  return null;
}

function location(uri, document, range) {
  const converted = document && toLspRange(document.text, range);
  return converted ? { uri, range: converted } : null;
}

function sameTarget(a, b) {
  return a.targetUri === b.targetUri &&
    a.targetRange?.start === b.targetRange?.start &&
    a.targetRange?.end === b.targetRange?.end;
}

function scriptToolName(text) {
  return /^# name: ([A-Za-z][A-Za-z0-9_-]*)$/m.exec(text)?.[1] ?? null;
}

function schemaTitleCatalog(snapshot) {
  const found = new Map();
  const ambiguous = new Set();
  for (const document of snapshot.documents) {
    if (!/^schemas\/[A-Za-z0-9_.-]+\.schema\.ya?ml$/.test(document.relativePath))
      continue;
    const parsed = parseDocument(document.text, {
      version: "1.2", schema: "core", strict: true,
      uniqueKeys: true, stringKeys: true, logLevel: "silent"
    });
    if (parsed.errors.length || !isMap(parsed.contents)) continue;
    const title = parsed.contents.get("title", true);
    if (!isScalar(title) || typeof title.value !== "string" ||
        !/^[A-Za-z][A-Za-z0-9]*$/.test(title.value)) continue;
    if (found.has(title.value)) ambiguous.add(title.value);
    else found.set(title.value, document.relativePath);
  }
  return [...found].filter(([title]) => !ambiguous.has(title))
    .map(([title, path]) => ({ title, path }));
}

connection.onInitialize(() => ({
  capabilities: {
    // The extension host sends bounded Package snapshots as a custom
    // notification. Do not establish a second competing TextDocument store.
    textDocumentSync: TextDocumentSyncKind.None,
    definitionProvider: true,
    referencesProvider: true,
    semanticTokensProvider: {
      legend: {
        tokenTypes: [...SKILL_SEMANTIC_TOKEN_TYPES],
        tokenModifiers: [...SKILL_SEMANTIC_TOKEN_MODIFIERS]
      },
      full: true,
      range: false
    },
    hoverProvider: true,
    documentSymbolProvider: true,
    completionProvider: {
      resolveProvider: false,
      triggerCharacters: [":", "/"]
    }
  },
  serverInfo: {
    name: "Skill Studio Language Service",
    version: "0.2.0"
  }
}));

// Health is a read-only transport liveness check. It does not inspect or
// mutate Package Source or claim an analysis generation is READY.
connection.onRequest("skillStudio/health", () => ({alive:true}));

connection.languages.semanticTokens.on(params=>{
  const value=packageForUri(params.textDocument.uri);
  if(!value||value.analysis.state==="UNAVAILABLE")return {data:[]};
  const document=documentFor(value,params.textDocument.uri);
  if(!document)return {data:[]};
  const analyzed=value.analysis.documents.find(item=>
    item.uri===document.uri&&item.relativePath===document.relativePath&&
    item.version===document.version);
  if(!analyzed)return {data:[]};
  return semanticTokensForDocument(document);
});

connection.onDefinition(params => {
  const value = packageForUri(params.textDocument.uri);
  if (!value || value.analysis.state === "UNAVAILABLE") return null;
  const document = documentFor(value, params.textDocument.uri);
  if (!document) return null;
  const offset = offsetAt(document.text, params.position);
  if (offset === null) return null;
  const hit = referenceAt(value, document.uri, offset);
  if (!hit || !hit.reference.packageContextComplete) return null;
  if (hit.side !== "source") return null;
  const target = documentFor(value, hit.reference.targetUri);
  return location(hit.reference.targetUri, target, hit.reference.targetRange);
});

connection.onReferences(params => {
  const value = packageForUri(params.textDocument.uri);
  if (!value || value.analysis.state === "UNAVAILABLE") return [];
  const document = documentFor(value, params.textDocument.uri);
  if (!document) return [];
  const offset = offsetAt(document.text, params.position);
  if (offset === null) return [];
  const hit = referenceAt(value, document.uri, offset);
  if (!hit || !hit.reference.packageContextComplete) return [];
  const references = allReferences(value.analysis).filter(item =>
    item.packageContextComplete && sameTarget(item, hit.reference));
  const locations = references.map(item =>
    location(item.sourceUri, documentFor(value, item.sourceUri), item.sourceRange)
  ).filter(Boolean);
  if (params.context?.includeDeclaration) {
    const target = location(hit.reference.targetUri,
      documentFor(value, hit.reference.targetUri), hit.reference.targetRange);
    if (target) locations.unshift(target);
  }
  return locations;
});

connection.onHover(params => {
  const value = packageForUri(params.textDocument.uri);
  if (!value || value.analysis.state === "UNAVAILABLE") return null;
  const document = documentFor(value, params.textDocument.uri);
  if (!document) return null;
  const offset = offsetAt(document.text, params.position);
  if (offset === null) return null;
  const hit = referenceAt(value, document.uri, offset);
  if (hit && hit.reference.packageContextComplete) {
    const reference = hit.reference;
    const target = documentFor(value, reference.targetUri);
    if (reference.kind === "procedure-script-caller" ||
        reference.kind === "predicate-evaluator-caller") {
      const name = target ? scriptToolName(target.text) : null;
      return {
        contents: {
          kind: "markdown",
          value: [
            "**Skill Script**",
            "",
            "`" + reference.targetPath + "`",
            name ? "Tool name: `" + name + "`" : ""
          ].filter(Boolean).join("\n")
        },
        range: toLspRange(document.text,
          hit.side === "source" ? reference.sourceRange : reference.targetRange)
      };
    }
    return {
      contents: {
        kind: "markdown",
        value: [
          "**" + (reference.kind === "script-input-schema" ? "Input Schema" : "Output Schema") + "**",
          "",
          "`" + reference.title + "`",
          reference.targetPath
        ].join("\n")
      },
      range: toLspRange(document.text,
        hit.side === "source" ? reference.sourceRange : reference.targetRange)
    };
  }

  const documentAnalysis = value.analysis.documents.find(item => item.uri === document.uri);
  const symbol = documentAnalysis?.pythonSymbols.find(item =>
    contains(item.range, offset));
  if (symbol?.range) {
    return {
      contents: {
        kind: "markdown",
        value: "**" + (symbol.kind === "class" ? "Class" : "Function") +
          "** `" + symbol.name + "`" +
          (symbol.async ? " (async)" : "")
      },
      range: toLspRange(document.text, symbol.range)
    };
  }
  return null;
});

connection.onDocumentSymbol(params => {
  const value = packageForUri(params.textDocument.uri);
  if (!value || value.analysis.state === "UNAVAILABLE") return [];
  const document = documentFor(value, params.textDocument.uri);
  if (!document) return [];
  const documentAnalysis = value.analysis.documents.find(item => item.uri === document.uri);
  return (documentAnalysis?.pythonSymbols ?? []).filter(symbol => symbol.range)
    .map(symbol => ({
      name: symbol.name,
      kind: symbol.kind === "class" ? SymbolKind.Class : SymbolKind.Function,
      location: location(document.uri, document, symbol.range)
    })).filter(symbol => symbol.location);
});

connection.onCompletion(params => {
  const value = packageForUri(params.textDocument.uri);
  if (!value || value.analysis.state === "UNAVAILABLE" ||
      !value.analysis.documents.length) return [];
  const document = documentFor(value, params.textDocument.uri);
  if (!document || !value.analysis.documents.some(item =>
      item.uri === document.uri && item.version === document.version)) return [];
  const offset = offsetAt(document.text, params.position);
  if (offset === null) return [];
  const starts = lineStarts(document.text);
  const lineStart = starts[params.position.line];
  const prefix = document.text.slice(lineStart, offset);

  if (document.relativePath === "assurance/procedure.yaml" &&
      /^\s*script:\s*[^#]*$/.test(prefix) &&
      value.analysis.state === "READY" &&
      value.snapshot.completeness === "complete") {
    const colon = prefix.indexOf(":");
    const rawValue = prefix.slice(colon + 1);
    const leading = rawValue.length - rawValue.trimStart().length;
    const typed = rawValue.trim();
    const start = lineStart + colon + 1 + leading;
    const editRange = toLspRange(document.text, { start, end: offset });
    return value.snapshot.documents
      .filter(item => /^scripts\/[A-Za-z0-9_.-]+\.py$/.test(item.relativePath) &&
        item.relativePath.startsWith(typed))
      .map(item => ({
        label: item.relativePath,
        kind: CompletionItemKind.File,
        insertText: item.relativePath,
        filterText: item.relativePath,
        ...(editRange ? { textEdit: { range: editRange, newText: item.relativePath } } : {}),
        detail: "Package-local Python script"
      }));
  }

  if (document.languageId === "python" &&
      /^\s*# (?:inputSchema|outputSchema):\s*[^#]*$/.test(prefix) &&
      value.analysis.state === "READY" &&
      value.snapshot.completeness === "complete") {
    const colon = prefix.indexOf(":");
    const rawValue = prefix.slice(colon + 1);
    const leading = rawValue.length - rawValue.trimStart().length;
    const typed = rawValue.trim();
    const start = lineStart + colon + 1 + leading;
    const editRange = toLspRange(document.text, { start, end: offset });
    return schemaTitleCatalog(value.snapshot)
      .filter(item => item.title.startsWith(typed))
      .map(item => ({
        label: item.title,
        kind: CompletionItemKind.Reference,
        insertText: item.title,
        filterText: item.title,
        ...(editRange ? { textEdit: { range: editRange, newText: item.title } } : {}),
        detail: "Package Schema · " + item.path
      }));
  }
  return [];
});

connection.onNotification(PACKAGE_INVALIDATE_NOTIFICATION, params => {
  const rootUri = params?.rootUri;
  const generation = params?.generation;
  if (typeof rootUri !== "string" || !rootUri.trim() ||
      !Number.isSafeInteger(generation) || generation < 0) return;
  const knownGeneration = requestedGeneration.get(rootUri) ?? -1;
  if (generation > knownGeneration) {
    requestedGeneration.set(rootUri, generation);
    packageAnalyses.delete(rootUri);
    sessions.get(rootUri)?.reset();
    refreshSemanticTokens();
  }
});

connection.onNotification(PACKAGE_SNAPSHOT_NOTIFICATION, async snapshot => {
  if (!snapshot || typeof snapshot !== "object" ||
      typeof snapshot.rootUri !== "string" || !snapshot.rootUri.trim() ||
      !Number.isSafeInteger(snapshot.generation) || snapshot.generation < 0) {
    reportError("Rejected Package snapshot without a valid root URI or generation");
    return;
  }
  const rootUri = snapshot.rootUri;
  const knownGeneration = requestedGeneration.get(rootUri) ?? -1;
  if (snapshot.generation < knownGeneration) return;
  if (snapshot.generation > knownGeneration) {
    requestedGeneration.set(rootUri, snapshot.generation);
    packageAnalyses.delete(rootUri);
  }
  let session = sessions.get(rootUri);
  if (!session) {
    session = createSession(rootUri);
    sessions.set(rootUri, session);
  }
  try {
    const result = await session.submit(snapshot);
    if (!result.accepted && result.reason !== "SUPERSEDED" &&
        result.reason !== "STALE_GENERATION" &&
        result.reason !== "STALE_DOCUMENT") {
      packageAnalyses.delete(rootUri);
      refreshSemanticTokens();
      reportError("Package analysis rejected: " + result.reason, rootUri);
    }
  } catch (error) {
    packageAnalyses.delete(rootUri);
    refreshSemanticTokens();
    reportError(error?.message ?? error, rootUri);
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
  packageAnalyses.delete(rootUri);
  requestedGeneration.delete(rootUri);
  refreshSemanticTokens();
});

connection.onShutdown(() => {
  for (const session of sessions.values()) session.dispose();
  sessions.clear();
  packageAnalyses.clear();
  requestedGeneration.clear();
});

connection.listen();
