import { scriptNavigationReport } from "../../site/script-navigation.mjs";
import { pythonTopLevelOutline } from "../../site/python-outline.mjs";
import { analyzeCurrentSource } from "./source.js";
import type {
  AnalysisState,
  DocumentAnalysis,
  LanguageDiagnostic,
  PackageAuditResult,
  PackageDocumentSnapshot,
  PackageSnapshot,
  ProcedureProjection,
  PythonOutlineSymbol,
  SchemaReference,
  ScriptReference,
  SourceOffsetRange,
  SkillLanguageAnalysis
} from "./types.js";

const MAX_PACKAGE_FILES = 500;
const MAX_PACKAGE_TEXT_LENGTH = 4 * 1024 * 1024;
type ScriptNavigationReport = {
  status: "READY" | "UNAVAILABLE";
  callers: Array<{
    path: string; line: number; label: string;
    sourceRange?: SourceOffsetRange; targetRange?: SourceOffsetRange;
  }>;
  schemas: Array<{
    path: string; line: number; role: string; title: string;
    sourceRange?: SourceOffsetRange; targetRange?: SourceOffsetRange;
  }>;
  warnings: string[];
};
type PythonOutlineReport = {
  status: "READY" | "UNAVAILABLE";
  symbols: Array<{
    name: string;
    kind: "class" | "function";
    line: number;
    async: boolean;
    range: SourceOffsetRange;
  }>;
  warnings: string[];
};

function languageIdFor(path: string, declared?: string): string {
  if (declared) return declared;
  const lower = path.toLowerCase();
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "yaml";
  if (lower.endsWith(".py")) return "python";
  if (lower.endsWith(".md")) return "markdown";
  if (lower.endsWith(".json")) return "json";
  return "plaintext";
}

function normalizeRelativePath(input: string): string | null {
  if (!input || input.includes("\u0000")) return null;
  const path = input.replace(/\\/g, "/");
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) return null;
  const segments = path.split("/");
  if (segments.some(part => !part || part === "." || part === ".." ||
      /[\u0000-\u001f:<>|?*]/.test(part))) return null;
  return segments.join("/");
}


/**
 * Parse a hierarchical editor URI without resolving dot segments.
 * Decode exactly once, and reject escaped separators/dot traversal before
 * URI normalization can hide an unsafe path. This is a lexical Package
 * boundary, not an OS symlink or workspace-trust check.
 */
function packageUriLocation(uri: string): { scheme: string; authority: string; segments: string[] } | null {
  const match = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)(\/[^?#]*)?$/.exec(uri);
  if (!match || match[2].includes("@")) return null;
  const rawSegments = (match[3] ?? "/").split("/").slice(1);
  if (rawSegments.at(-1) === "") rawSegments.pop();
  const segments: string[] = [];
  for (const raw of rawSegments) {
    if (!raw) return null;
    let decoded: string;
    try { decoded = decodeURIComponent(raw); }
    catch { return null; }
    if (!decoded || decoded === "." || decoded === ".." ||
        decoded.includes("/") || decoded.includes("\\") ||
        /[\u0000-\u001f\u007f]/.test(decoded)) return null;
    segments.push(decoded);
  }
  return { scheme: match[1].toLowerCase(), authority: match[2], segments };
}

function belongsToPackage(
  packageRoot: NonNullable<ReturnType<typeof packageUriLocation>>,
  uri: string,
  relativePath: string
): boolean {
  if (uri.endsWith("/")) return false;
  const document = packageUriLocation(uri);
  if (!document || document.scheme !== packageRoot.scheme ||
      document.authority !== packageRoot.authority) return false;
  const expected = [...packageRoot.segments, ...relativePath.split("/")];
  return document.segments.length === expected.length &&
    document.segments.every((part, index) => part === expected[index]);
}

function emptyProcedure(diagnostic?: LanguageDiagnostic): ProcedureProjection {
  return {
    state: "UNAVAILABLE",
    entry: null,
    procedures: [],
    diagnostics: diagnostic ? [diagnostic] : []
  };
}

function unavailable(
  snapshot: Partial<PackageSnapshot>,
  code: string,
  message: string
): SkillLanguageAnalysis {
  const rootUri = typeof snapshot.rootUri === "string" ? snapshot.rootUri : "";
  const packageName = typeof snapshot.packageName === "string" ? snapshot.packageName : "";
  const generation = Number.isSafeInteger(snapshot.generation) ? snapshot.generation as number : 0;
  const diagnostic: LanguageDiagnostic = {
    code,
    message,
    severity: "error",
    uri: rootUri,
    relativePath: "",
    source: "snapshot",
    confidence: "exact"
  };
  const packageAudit: PackageAuditResult = {
    state: "UNAVAILABLE",
    reason: message,
    diagnostics: []
  };
  return {
    state: "UNAVAILABLE",
    rootUri,
    packageName,
    generation,
    procedure: emptyProcedure(),
    packageAudit,
    documents: [],
    scriptReferences: [],
    schemaReferences: [],
    diagnostics: [diagnostic]
  };
}

/**
 * Build a single, JSON-safe editor analysis view from the current Package text.
 *
 * This first extraction deliberately delegates to the already characterized
 * JavaScript analyzers. It does not reimplement their rules or change their
 * accepted syntax. Results are read-only; no Source text is modified.
 */
export function analyzePackageSnapshot(snapshot: PackageSnapshot): SkillLanguageAnalysis {
  if (!snapshot || typeof snapshot !== "object")
    return unavailable({}, "INVALID_PACKAGE_SNAPSHOT", "Package snapshot is missing");
  if (typeof snapshot.rootUri !== "string" || !snapshot.rootUri.trim())
    return unavailable(snapshot, "INVALID_PACKAGE_ROOT", "Package root URI is required");
  const packageRoot = packageUriLocation(snapshot.rootUri);
  if (!packageRoot)
    return unavailable(snapshot, "INVALID_PACKAGE_ROOT_URI", "Package root must be a safe hierarchical URI without traversal");
  if (typeof snapshot.packageName !== "string" || !/^[A-Za-z0-9._-]{1,100}$/.test(snapshot.packageName))
    return unavailable(snapshot, "INVALID_PACKAGE_NAME", "Package name is invalid");
  if (!Number.isSafeInteger(snapshot.generation) || snapshot.generation < 0)
    return unavailable(snapshot, "INVALID_PACKAGE_GENERATION", "Package generation must be a non-negative safe integer");
  if (!Array.isArray(snapshot.documents) || snapshot.documents.length === 0)
    return unavailable(snapshot, "EMPTY_PACKAGE_SNAPSHOT", "Package snapshot has no documents");
  if (!["complete", "partial", "unavailable"].includes(snapshot.completeness))
    return unavailable(snapshot, "INVALID_PACKAGE_COMPLETENESS", "Package completeness state is invalid");
  if (snapshot.documents.length > MAX_PACKAGE_FILES)
    return unavailable(snapshot, "PACKAGE_FILE_LIMIT", "Package exceeds the 500-file analysis limit");

  const normalizedDocuments: Array<PackageDocumentSnapshot & { languageId: string }> = [];
  const paths = new Set<string>();
  const uris = new Set<string>();
  let totalTextLength = 0;

  for (const document of snapshot.documents) {
    if (!document || typeof document !== "object" ||
        typeof document.uri !== "string" || !document.uri.trim() ||
        typeof document.relativePath !== "string" ||
        typeof document.text !== "string" ||
        !Number.isSafeInteger(document.version) || document.version < 0) {
      return unavailable(snapshot, "INVALID_PACKAGE_DOCUMENT", "Package contains an invalid document snapshot");
    }
    const relativePath = normalizeRelativePath(document.relativePath);
    if (!relativePath)
      return unavailable(snapshot, "INVALID_PACKAGE_PATH", "Package contains an unsafe relative path");
    if (paths.has(relativePath) || uris.has(document.uri))
      return unavailable(snapshot, "DUPLICATE_PACKAGE_DOCUMENT", "Package contains a duplicate path or document URI");
    if (!belongsToPackage(packageRoot, document.uri, relativePath))
      return unavailable(snapshot, "PACKAGE_DOCUMENT_URI_MISMATCH", "Document URI does not match its relative path inside Package root");
    if (document.text.includes("\u0000"))
      return unavailable(snapshot, "INVALID_PACKAGE_TEXT", "Package contains text with a NUL character");
    paths.add(relativePath);
    uris.add(document.uri);
    totalTextLength += document.text.length;
    normalizedDocuments.push({
      ...document,
      relativePath,
      languageId: languageIdFor(relativePath, document.languageId)
    });
  }

  // Preserve the existing Package Audit's String.length-based aggregate guard.
  // This is deliberately not described as a UTF-8 byte limit.
  if (totalTextLength > MAX_PACKAGE_TEXT_LENGTH)
    return unavailable(snapshot, "PACKAGE_TEXT_LIMIT", "Package exceeds the 4 MiB cumulative text-length limit");

  const documentsByPath = new Map(normalizedDocuments.map(document => [document.relativePath, document] as const));
  const files = new Map(normalizedDocuments.map(document => [document.relativePath, { text: document.text }] as const));
  const procedureDocument = documentsByPath.get("assurance/procedure.yaml");

  // The current CA-SL grammar is authoritative. Do not run the historical
  // procedures/call/with Package analyzer.
  // Source projection can supply exact editor locations without any claim
  // that trusted ToolCatalog, CapabilityContracts or Host Schema
  // publications have been linked.
  if (procedureDocument) {
    const projected = analyzeCurrentSource(documentsByPath, snapshot.packageName);
    const packageContextComplete = snapshot.completeness === "complete" &&
      projected.procedure.state === "READY";
    const scriptReferences: ScriptReference[] = [];
    const schemaReferences: SchemaReference[] = [];
    const pythonSymbols: PythonOutlineSymbol[] = [];
    const pythonOutlineDiagnostics: LanguageDiagnostic[] = [];
    const scriptNavigationDiagnostics: LanguageDiagnostic[] = [];
    const documentAnalyses: DocumentAnalysis[] = [];

    for (const document of normalizedDocuments) {
      let pythonOutlineState: DocumentAnalysis["pythonOutlineState"] = "NOT_APPLICABLE";
      if (document.languageId === "python" && document.relativePath.startsWith("scripts/")) {
        const outline = pythonTopLevelOutline(document.text) as PythonOutlineReport;
        pythonOutlineState = outline.status;
        if (outline.status === "READY") {
          for (const symbol of outline.symbols) {
            const range = symbol.range ?? null;
            pythonSymbols.push({
              uri: document.uri,
              relativePath: document.relativePath,
              name: symbol.name,
              kind: symbol.kind,
              line: symbol.line,
              async: symbol.async,
              range,
              navigable: Boolean(range)
            });
          }
        }
        for (const warning of outline.warnings ?? []) {
          pythonOutlineDiagnostics.push({
            code: "PYTHON_OUTLINE",
            message: warning,
            severity: "warning",
            uri: document.uri,
            relativePath: document.relativePath,
            source: "python-outline",
            confidence: "unknown"
          });
        }

        const report = scriptNavigationReport(files, document.relativePath) as ScriptNavigationReport;
        if (report.status === "READY") {
          for (const caller of report.callers) {
            const sourceDocument = documentsByPath.get(caller.path);
            if (!sourceDocument) continue;
            scriptReferences.push({
              kind: caller.path === "assurance/procedure.yaml"
                ? "procedure-script-caller"
                : "predicate-evaluator-caller",
              sourceUri: sourceDocument.uri,
              sourcePath: caller.path,
              targetUri: document.uri,
              targetPath: document.relativePath,
              line: caller.line,
              targetIdentityExact: true,
              packageContextComplete,
              sourceRange: caller.sourceRange ?? null,
              targetRange: caller.targetRange ?? null
            });
          }
          for (const schema of report.schemas) {
            const targetDocument = documentsByPath.get(schema.path);
            if (!targetDocument) continue;
            schemaReferences.push({
              kind: schema.role === "输入" ? "script-input-schema" : "script-output-schema",
              sourceUri: document.uri,
              sourcePath: document.relativePath,
              targetUri: targetDocument.uri,
              targetPath: schema.path,
              targetLine: schema.line,
              title: schema.title,
              packageContextComplete,
              sourceRange: schema.sourceRange ?? null,
              targetRange: schema.targetRange ?? null
            });
          }
        }
        for (const warning of report.warnings ?? []) {
          scriptNavigationDiagnostics.push({
            code: "SCRIPT_NAVIGATION",
            message: warning,
            severity: "warning",
            uri: document.uri,
            relativePath: document.relativePath,
            source: "script-navigation",
            confidence: "unknown"
          });
        }
      }
      documentAnalyses.push({
        uri: document.uri,
        relativePath: document.relativePath,
        version: document.version,
        languageId: document.languageId,
        pythonOutlineState,
        pythonSymbols: pythonSymbols.filter(symbol => symbol.uri === document.uri)
      });
    }

    const packageAudit: PackageAuditResult = {
      state: "UNAVAILABLE",
      reason: snapshot.completeness !== "complete"
        ? (snapshot.reason ?? "Partial Package snapshot")
        : "Current CA-SL source parsed; static Package qualification requires the current Compiler and trusted Owner/Capability/Schema linking snapshots",
      diagnostics: []
    };
    const diagnostics = [
      ...projected.diagnostics,
      ...packageAudit.diagnostics,
      ...pythonOutlineDiagnostics,
      ...scriptNavigationDiagnostics
    ];
    return {
      state: "PARTIAL",
      rootUri: snapshot.rootUri,
      packageName: snapshot.packageName,
      generation: snapshot.generation,
      procedure: projected.procedure,
      packageAudit,
      documents: documentAnalyses,
      scriptReferences,
      schemaReferences,
      diagnostics
    };
  }
  // Every Package is analyzed by the current grammar. A missing Procedure is a
  // concrete Package defect, not a language-version selection failure.
  return unavailable(snapshot, "PROCEDURE_FILE_MISSING",
    "Package is missing assurance/procedure.yaml");


}

export type * from "./types.js";
