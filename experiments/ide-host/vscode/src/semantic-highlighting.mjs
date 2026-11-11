import {
  classifySkillSemanticTokens,
  SKILL_SEMANTIC_LEGEND
} from "../../../../language/core/semantic-tokens.mjs";

/**
 * Local VS Code/Theia semantic-color adapter. It consumes the same versioned
 * token contract as a future Compiler-backed/LSP producer, but does not
 * implement any new LSP request, diagnostic or symbol resolution behavior.
 */
export function registerSkillSemanticHighlighting(vscode) {
  if (typeof vscode.languages?.registerDocumentSemanticTokensProvider !== "function" ||
      typeof vscode.SemanticTokensLegend !== "function" ||
      typeof vscode.SemanticTokensBuilder !== "function" ||
      typeof vscode.Range !== "function") return null;

  const legend = new vscode.SemanticTokensLegend(
    [...SKILL_SEMANTIC_LEGEND.tokenTypes],
    [...SKILL_SEMANTIC_LEGEND.tokenModifiers]
  );
  const provider = {
    provideDocumentSemanticTokens(document, cancellationToken) {
      const builder = new vscode.SemanticTokensBuilder(legend);
      if (cancellationToken?.isCancellationRequested) return builder.build();
      const items = classifySkillSemanticTokens(
        document.getText(), document.uri.path
      );
      for (const item of items) {
        if (cancellationToken?.isCancellationRequested) break;
        const start = document.positionAt(item.start);
        const end = document.positionAt(item.end);
        if (start.line === end.line && end.character > start.character) {
          builder.push(new vscode.Range(start, end), item.type, item.modifiers);
        }
      }
      return builder.build();
    }
  };
  // The normal YAML TextMate grammar remains active under this overlay.
  return vscode.languages.registerDocumentSemanticTokensProvider(
    {language: "yaml"}, provider, legend
  );
}
