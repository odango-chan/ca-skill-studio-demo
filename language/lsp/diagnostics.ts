import type {
  LanguageDiagnostic,
  PackageSnapshot,
  SkillLanguageAnalysis
} from "../core/types.js";

/** LSP positions use UTF-16 code units, the same indexing as JavaScript strings. */
export interface LspPosition {
  readonly line: number;
  readonly character: number;
}
export interface LspRange {
  readonly start: LspPosition;
  readonly end: LspPosition;
}
export interface LspDiagnostic {
  readonly range: LspRange;
  readonly severity: 1 | 2 | 3;
  readonly code: string;
  readonly source: string;
  readonly message: string;
}
export interface DocumentDiagnostics {
  readonly uri: string;
  readonly version?: number;
  readonly generation: number;
  readonly diagnostics: readonly LspDiagnostic[];
}
export interface DiagnosticBatch {
  readonly state: SkillLanguageAnalysis["state"];
  readonly generation: number;
  readonly documents: readonly DocumentDiagnostics[];
  /** Missing a reliable location is not permission to invent one. */
  readonly unlocated: readonly LanguageDiagnostic[];
  readonly reason?: string;
}

function lineStarts(text: string): number[] {
  const result = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\r") {
      if (text[i + 1] === "\n") i++;
      result.push(i + 1);
    } else if (text[i] === "\n") {
      result.push(i + 1);
    }
  }
  return result;
}

function positionAt(starts: readonly number[], offset: number): LspPosition {
  let low = 0;
  let high = starts.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (starts[mid] <= offset) low = mid + 1;
    else high = mid - 1;
  }
  return { line: high, character: offset - starts[high] };
}

/** Strict conversion: no guessed token span for line-only editor warnings. */
function diagnosticRange(
  diagnostic: LanguageDiagnostic,
  text: string,
  starts: readonly number[]
): LspRange | null {
  const span = diagnostic.range;
  if (span !== undefined) {
    if (!Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end) ||
        span.start < 0 || span.end < span.start || span.end > text.length)
      return null;
    return { start: positionAt(starts, span.start), end: positionAt(starts, span.end) };
  }
  if (!Number.isSafeInteger(diagnostic.line) ||
      diagnostic.line! < 1 || diagnostic.line! > starts.length) return null;
  // Zero-width at the actual source line start: a line hint, NOT a fake token range.
  const position = { line: diagnostic.line! - 1, character: 0 };
  return { start: position, end: position };
}

function severity(value: LanguageDiagnostic["severity"]): 1 | 2 | 3 {
  return value === "error" ? 1 : value === "warning" ? 2 : 3;
}

/**
 * Convert only diagnostics backed by a validated Package document and matching
 * version into LSP document publications. Never publish a Package-root error
 * as a fabricated source-file location.
 */
export function diagnosticsFromAnalysis(
  snapshot: PackageSnapshot,
  analysis: SkillLanguageAnalysis
): DiagnosticBatch {
  if (analysis.rootUri !== snapshot.rootUri ||
      analysis.generation !== snapshot.generation ||
      analysis.packageName !== snapshot.packageName)
    return { state: "UNAVAILABLE", generation: snapshot.generation,
      documents: [], unlocated: [], reason: "Analysis identity does not match Package snapshot" };

  if (analysis.state === "UNAVAILABLE")
    return { state: "UNAVAILABLE", generation: snapshot.generation,
      documents: [], unlocated: analysis.diagnostics, reason: "Package analysis unavailable" };

  const analyzed = new Map(analysis.documents.map(doc => [doc.uri, doc] as const));
  const documents = snapshot.documents.filter(doc =>
    analyzed.get(doc.uri)?.version === doc.version &&
    analyzed.get(doc.uri)?.relativePath === doc.relativePath);
  // A stale or incomplete analyzer result must not be rendered as READY with
  // an empty Problems panel. Every input document requires a matching result.
  if (documents.length !== snapshot.documents.length ||
      analyzed.size !== snapshot.documents.length)
    return { state: "UNAVAILABLE", generation: snapshot.generation,
      documents: [], unlocated: analysis.diagnostics,
      reason: "Analysis document identities or versions do not match current Source" };
  const byUri = new Map(documents.map(doc => [doc.uri, doc] as const));
  const indexed = new Map(documents.map(doc => [doc.uri, {
    starts: lineStarts(doc.text),
    diagnostics: [] as LspDiagnostic[]
  }] as const));
  const unlocated: LanguageDiagnostic[] = [];
  for (const item of analysis.diagnostics) {
    const source = byUri.get(item.uri);
    const target = indexed.get(item.uri);
    if (!source || !target || item.relativePath !== source.relativePath) {
      unlocated.push(item);
      continue;
    }
    const range = diagnosticRange(item, source.text, target.starts);
    if (!range) {
      unlocated.push(item);
      continue;
    }
    target.diagnostics.push({
      range,
      severity: severity(item.severity),
      code: item.code,
      source: "Skill Studio · " + item.source +
        (item.confidence === "heuristic" ? " (heuristic)" : ""),
      message: item.message
    });
  }

  // A missing/partial Package is not equivalent to a clean audit. Surface it
  // explicitly in the source editor when an actual Procedure document exists.
  if (analysis.packageAudit.state === "UNAVAILABLE") {
    const procedure = documents.find(doc => doc.relativePath === "assurance/procedure.yaml");
    if (procedure) {
      indexed.get(procedure.uri)!.diagnostics.push({
        range: { start: {line: 0, character: 0}, end: {line: 0, character: 0} },
        severity: 2,
        code: "PACKAGE_AUDIT_UNAVAILABLE",
        source: "Skill Studio · package-audit",
        message: "Package Audit unavailable: " + (analysis.packageAudit.reason ?? "incomplete Package")
      });
    }
  }

  return {
    state: analysis.state,
    generation: snapshot.generation,
    documents: documents.map(doc => ({
      uri: doc.uri,
      version: doc.version,
      generation: snapshot.generation,
      diagnostics: indexed.get(doc.uri)!.diagnostics
    })),
    unlocated
  };
}
