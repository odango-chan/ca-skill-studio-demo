export type AnalysisState = "READY" | "PARTIAL" | "UNAVAILABLE";
export type PackageCompleteness = "complete" | "partial" | "unavailable";
export type DiagnosticSeverity = "error" | "warning" | "information";
export type DiagnosticConfidence = "exact" | "heuristic" | "unknown";

export interface PackageDocumentSnapshot {
  readonly uri: string;
  readonly relativePath: string;
  readonly languageId?: string;
  readonly version: number;
  readonly text: string;
}

export interface PackageSnapshot {
  readonly rootUri: string;
  readonly packageName: string;
  readonly generation: number;
  readonly completeness: PackageCompleteness;
  readonly documents: readonly PackageDocumentSnapshot[];
  readonly dependencyOperations?: readonly {
    readonly id: string;
    readonly dependencyId: string;
  }[];
  readonly dependencySchemas?: readonly {
    readonly dependencyId: string;
    readonly path: string;
    readonly text: string;
  }[];
  readonly reason?: string;
}

export interface SourceOffsetRange {
  /** JavaScript UTF-16 string offset, not a byte offset or LSP line/character. */
  readonly start: number;
  readonly end: number;
}

export interface LanguageDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly severity: DiagnosticSeverity;
  readonly uri: string;
  readonly relativePath: string;
  readonly source: "snapshot" | "procedure-projection" | "package-audit" |
    "script-navigation" | "python-outline";
  readonly confidence: DiagnosticConfidence;
  readonly line?: number;
  readonly range?: SourceOffsetRange;
}

export interface ProcedureStep {
  readonly index: number;
  readonly line: number;
  readonly name: string;
  readonly operator: string;
  readonly value: string;
}

export interface ProcedurePhase {
  readonly name: "preconditions" | "postconditions";
  readonly line: number;
  readonly steps: readonly ProcedureStep[];
  readonly routeCount: number;
}

export interface ProcedureChildReference {
  readonly procedure: string;
  readonly via: string;
  readonly line: number;
  readonly caller?: string;
}

export interface ProcedureNode {
  readonly id: string;
  readonly operator: string;
  readonly value: string;
  readonly line: number;
  readonly phases: readonly ProcedurePhase[];
  readonly children: readonly ProcedureChildReference[];
}

export interface ProcedureRoute {
  readonly id: string;
  readonly source: string;
  readonly outcome: string;
  readonly target: string;
  readonly routeSource: string;
  readonly line: number;
  readonly sourceSpan: SourceOffsetRange;
  readonly patchable: boolean;
}

export interface ProcedureDefinition {
  readonly name: string;
  readonly start: string;
  readonly nodes: readonly ProcedureNode[];
  readonly routes: readonly ProcedureRoute[];
  readonly children: readonly ProcedureChildReference[];
  readonly line: number;
  readonly profile: string;
}

export interface ProcedureProjection {
  readonly state: "READY" | "UNAVAILABLE";
  readonly entry: string | null;
  readonly procedures: readonly ProcedureDefinition[];
  readonly diagnostics: readonly LanguageDiagnostic[];
}

export interface PackageAuditResult {
  readonly state: "READY" | "UNAVAILABLE";
  readonly reason?: string;
  readonly diagnostics: readonly LanguageDiagnostic[];
}

export interface ScriptReference {
  readonly kind: "procedure-script-caller" | "predicate-evaluator-caller";
  readonly sourceUri: string;
  readonly sourcePath: string;
  readonly targetUri: string;
  readonly targetPath: string;
  readonly line: number;
  /** Exact identity of the observed target, not proof that the Package is complete. */
  readonly targetIdentityExact: true;
  /** False when any required Package evidence is missing, partial, or unparseable. */
  readonly packageContextComplete: boolean;
  readonly sourceRange: SourceOffsetRange | null;
  readonly targetRange: SourceOffsetRange | null;
}

export interface SchemaReference {
  readonly kind: "script-input-schema" | "script-output-schema";
  readonly sourceUri: string;
  readonly sourcePath: string;
  readonly targetUri: string;
  readonly targetPath: string;
  readonly targetLine: number;
  readonly title: string;
  /** Completeness of the containing Package analysis; no inferred Schema ABI. */
  readonly packageContextComplete: boolean;
  readonly sourceRange: SourceOffsetRange | null;
  readonly targetRange: SourceOffsetRange | null;
}

export interface PythonOutlineSymbol {
  readonly uri: string;
  readonly relativePath: string;
  readonly name: string;
  readonly kind: "class" | "function";
  readonly line: number;
  readonly async: boolean;
  /** Exact UTF-16 range of the top-level class/function name token. */
  readonly range: SourceOffsetRange | null;
  readonly navigable: boolean;
}

export interface DocumentAnalysis {
  readonly uri: string;
  readonly relativePath: string;
  readonly version: number;
  readonly languageId: string;
  readonly pythonOutlineState: "READY" | "UNAVAILABLE" | "NOT_APPLICABLE";
  readonly pythonSymbols: readonly PythonOutlineSymbol[];
}

export interface SkillLanguageAnalysis {
  readonly state: AnalysisState;
  readonly rootUri: string;
  readonly packageName: string;
  readonly generation: number;
  readonly procedure: ProcedureProjection;
  readonly packageAudit: PackageAuditResult;
  readonly documents: readonly DocumentAnalysis[];
  readonly scriptReferences: readonly ScriptReference[];
  readonly schemaReferences: readonly SchemaReference[];
  readonly diagnostics: readonly LanguageDiagnostic[];
}
