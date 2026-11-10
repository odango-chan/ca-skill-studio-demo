import { analyzePackageSnapshot } from "../core/index.js";
import type { PackageSnapshot, SkillLanguageAnalysis, LanguageDiagnostic } from "../core/types.js";
import {
  diagnosticsFromAnalysis
} from "./diagnostics.js";
import type { DocumentDiagnostics } from "./diagnostics.js";

export interface SessionStatus {
  readonly state: SkillLanguageAnalysis["state"];
  readonly generation: number;
  readonly reason?: string;
  readonly unlocated: readonly LanguageDiagnostic[];
}
export interface SessionSink {
  publish(result: DocumentDiagnostics): void;
  status(result: SessionStatus): void;
}
export interface SubmitResult {
  readonly accepted: boolean;
  readonly reason?: "DISPOSED" | "WRONG_PACKAGE" | "STALE_GENERATION" |
    "STALE_DOCUMENT" | "INVALID_SNAPSHOT" | "SUPERSEDED" | "ANALYSIS_UNAVAILABLE";
}

type Analyzer = (snapshot: PackageSnapshot) =>
  SkillLanguageAnalysis | Promise<SkillLanguageAnalysis>;

/**
 * L2-A protocol-neutral document/session layer for a future browser Worker.
 * The host supplies a fresh bounded Package snapshot on open/change/close;
 * the service never owns a filesystem or writes Source.
 *
 * The LSP transport is intentionally not implemented here. Keeping this
 * session behind one narrow interface prevents duplicate Theia document
 * authority while the browser Worker transport is being verified.
 */
export class LanguageDiagnosticSession {
  private rootUri: string | null = null;
  private generation = -1;
  private sequence = 0;
  private disposed = false;
  private published = new Set<string>();
  private documents = new Map<string, { version: number; text: string }>();

  constructor(
    private readonly sink: SessionSink,
    private readonly analyze: Analyzer = analyzePackageSnapshot
  ) {}

  /** Clear old Package diagnostics before selecting a different Package. */
  reset(): void {
    if (this.disposed) return;
    this.sequence++;
    for (const uri of this.published.keys())
      this.sink.publish({ uri, generation: this.generation, diagnostics: [] });
    this.published.clear();
    this.documents.clear();
    this.rootUri = null;
    this.generation = -1;
  }

  dispose(): void {
    if (this.disposed) return;
    this.reset();
    this.disposed = true;
  }

  async submit(snapshot: PackageSnapshot): Promise<SubmitResult> {
    if (this.disposed) return { accepted: false, reason: "DISPOSED" };
    if (this.rootUri !== null && snapshot.rootUri !== this.rootUri)
      return { accepted: false, reason: "WRONG_PACKAGE" };
    if (!Number.isSafeInteger(snapshot.generation) ||
        snapshot.generation <= this.generation)
      return { accepted: false, reason: "STALE_GENERATION" };

    // Reject stale open TextDocument results before invalidating diagnostics.
    // The host records a new Package generation for open/change/close. Disk-only
    // snapshots use version zero, including after the editor closes.
    if (!Array.isArray(snapshot.documents))
      return { accepted: false, reason: "INVALID_SNAPSHOT" };
    for (const document of snapshot.documents) {
      if (!document || typeof document.uri !== "string" ||
          !Number.isSafeInteger(document.version) || document.version < 0 ||
          typeof document.text !== "string")
        return { accepted: false, reason: "INVALID_SNAPSHOT" };
      const prior = this.documents.get(document.uri);
      // Version zero is a disk-only snapshot after an editor was closed.
      // A subsequent open may restart at version one; Package generation
      // still advances so older in-flight results remain superseded.
      if (prior && document.version !== 0 &&
          (document.version < prior.version ||
           (document.version === prior.version && document.text !== prior.text)))
        return { accepted: false, reason: "STALE_DOCUMENT" };
    }

    this.rootUri = snapshot.rootUri;
    this.generation = snapshot.generation;
    this.documents = new Map(snapshot.documents.map(document =>
      [document.uri, {version: document.version, text: document.text}]));
    const seq = ++this.sequence;
    let result: SkillLanguageAnalysis;
    try {
      result = await this.analyze(snapshot);
    } catch (error) {
      if (seq !== this.sequence || this.disposed)
        return { accepted: false, reason: "SUPERSEDED" };
      this.clearPublished(snapshot.generation);
      this.sink.status({
        state: "UNAVAILABLE",
        generation: snapshot.generation,
        reason: "Language analysis failed: " + String(error),
        unlocated: []
      });
      return { accepted: false, reason: "ANALYSIS_UNAVAILABLE" };
    }
    if (seq !== this.sequence || this.disposed)
      return { accepted: false, reason: "SUPERSEDED" };
    const batch = diagnosticsFromAnalysis(snapshot, result);
    const current = new Set(batch.documents.map(doc => doc.uri));
    for (const uri of this.published.keys()) {
      if (!current.has(uri))
        this.sink.publish({uri, generation: snapshot.generation, diagnostics: []});
    }
    this.published.clear();
    if (batch.state !== "UNAVAILABLE") {
      for (const document of batch.documents) {
        this.sink.publish(document);
        this.published.add(document.uri);
      }
    }
    this.sink.status({
      state: batch.state,
      generation: snapshot.generation,
      unlocated: batch.unlocated,
      ...(batch.reason ? {reason: batch.reason} : {})
    });
    return batch.state === "UNAVAILABLE"
      ? {accepted: false, reason: "ANALYSIS_UNAVAILABLE"}
      : {accepted: true};
  }

  private clearPublished(generation: number): void {
    for (const uri of this.published.keys())
      this.sink.publish({uri, generation, diagnostics: []});
    this.published.clear();
  }
}
