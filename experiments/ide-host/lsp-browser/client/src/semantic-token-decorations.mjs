function normalizeColor(value) {
  if (typeof value !== "string") return undefined;
  const color = value.trim();
  return /^#[0-9a-f]{3,4}$|^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(color)
    ? color
    : undefined;
}

function decorationOptions(declaration) {
  const style = typeof declaration === "string"
    ? { foreground: declaration }
    : declaration;
  if (!style || typeof style !== "object" || Array.isArray(style)) return null;

  const options = {};
  const color = normalizeColor(style.foreground);
  const backgroundColor = normalizeColor(style.background);
  if (color) options.color = color;
  if (backgroundColor) options.backgroundColor = backgroundColor;
  if (style.italic === true) options.fontStyle = "italic";
  if (style.bold === true) options.fontWeight = "bold";

  const textDecoration = [
    style.underline === true ? "underline" : "",
    style.strikethrough === true ? "line-through" : ""
  ].filter(Boolean).join(" ");
  if (textDecoration) options.textDecoration = textDecoration;

  return Object.keys(options).length ? options : null;
}

function uriKey(uri) {
  return uri && typeof uri.toString === "function" ? uri.toString() : null;
}

/**
 * Theia 1.76 accepts semantic-token data but its theme registry does not
 * project semanticTokenColors into Monaco's standalone theme. Render the same
 * LSP ranges through the supported TextEditor decoration API instead.
 *
 * Token identities and colors remain inputs from the canonical Skill Language
 * legend and the installed Studio Light theme; this adapter owns no palette.
 */
export function createSemanticTokenDecorationRenderer(vscode, tokenTypes, semanticTokenColors) {
  if (typeof vscode?.window?.createTextEditorDecorationType !== "function" ||
      typeof vscode?.Range !== "function") {
    throw new TypeError("Theia TextEditor decoration API is unavailable");
  }
  if (!Array.isArray(tokenTypes) || !semanticTokenColors ||
      typeof semanticTokenColors !== "object" || Array.isArray(semanticTokenColors)) {
    throw new TypeError("A semantic-token legend and theme color map are required");
  }

  const decorationTypes = new Map();
  for (const tokenType of tokenTypes) {
    const options = decorationOptions(semanticTokenColors[tokenType]);
    if (options) {
      decorationTypes.set(tokenType, vscode.window.createTextEditorDecorationType(options));
    }
  }

  const documents = new Map();
  const appliedByEditor = new WeakMap();
  const subscriptions = [];
  let disposed = false;

  function setEditorRanges(editor, uri, entry) {
    let editorDocuments = appliedByEditor.get(editor);
    if (!editorDocuments) {
      editorDocuments = new Map();
      appliedByEditor.set(editor, editorDocuments);
    }
    const previous = editorDocuments.get(uri) ?? new Set();
    const current = new Set();
    if (entry) {
      for (const [tokenType, ranges] of entry.ranges) {
        if (ranges.length && decorationTypes.has(tokenType)) current.add(tokenType);
      }
    }

    for (const tokenType of new Set([...previous, ...current])) {
      const decoration = decorationTypes.get(tokenType);
      if (!decoration) continue;
      editor.setDecorations(decoration, entry?.ranges.get(tokenType) ?? []);
    }
    if (current.size) editorDocuments.set(uri, current);
    else editorDocuments.delete(uri);
  }

  function applyVisible(uri, entry) {
    for (const editor of vscode.window.visibleTextEditors ?? []) {
      if (uriKey(editor.document?.uri) === uri) setEditorRanges(editor, uri, entry);
    }
  }

  function clearDocument(uri) {
    if (!uri) return;
    documents.delete(uri);
    applyVisible(uri, null);
  }

  function render(document, data) {
    if (disposed) return { tokenCount: 0, tokenTypeCount: 0 };
    const uri = uriKey(document?.uri);
    if (!uri || !Number.isSafeInteger(document.lineCount) ||
        !data || typeof data.length !== "number" || data.length % 5 !== 0) {
      throw new TypeError("Invalid document or semantic-token data");
    }

    const ranges = new Map();
    let line = 0;
    let character = 0;
    for (let index = 0; index < data.length; index += 5) {
      const deltaLine = Number(data[index]);
      const deltaCharacter = Number(data[index + 1]);
      const length = Number(data[index + 2]);
      const tokenTypeIndex = Number(data[index + 3]);

      if (!Number.isSafeInteger(deltaLine) || deltaLine < 0 ||
          !Number.isSafeInteger(deltaCharacter) || deltaCharacter < 0 ||
          !Number.isSafeInteger(length) || length <= 0 ||
          !Number.isSafeInteger(tokenTypeIndex) ||
          tokenTypeIndex < 0 || tokenTypeIndex >= tokenTypes.length) continue;

      if (deltaLine === 0) character += deltaCharacter;
      else {
        line += deltaLine;
        character = deltaCharacter;
      }

      const tokenType = tokenTypes[tokenTypeIndex];
      if (!decorationTypes.has(tokenType) || line < 0 || line >= document.lineCount) continue;
      const lineText = document.lineAt(line).text;
      if (character < 0 || character >= lineText.length) continue;
      const endCharacter = Math.min(lineText.length, character + length);
      if (endCharacter <= character) continue;

      let tokenRanges = ranges.get(tokenType);
      if (!tokenRanges) {
        tokenRanges = [];
        ranges.set(tokenType, tokenRanges);
      }
      tokenRanges.push(new vscode.Range(line, character, line, endCharacter));
    }

    const entry = { version: document.version, ranges };
    documents.set(uri, entry);
    applyVisible(uri, entry);

    let tokenCount = 0;
    for (const tokenRanges of ranges.values()) tokenCount += tokenRanges.length;
    return { tokenCount, tokenTypeCount: ranges.size };
  }

  const visibleEditorsChanged = vscode.window.onDidChangeVisibleTextEditors;
  if (typeof visibleEditorsChanged === "function") {
    subscriptions.push(visibleEditorsChanged(editors => {
      for (const editor of editors ?? vscode.window.visibleTextEditors ?? []) {
        const uri = uriKey(editor.document?.uri);
        if (!uri) continue;
        const entry = documents.get(uri);
        setEditorRanges(editor, uri,
          entry && entry.version === editor.document.version ? entry : null);
      }
    }));
  }

  const documentChanged = vscode.workspace?.onDidChangeTextDocument;
  if (typeof documentChanged === "function") {
    subscriptions.push(documentChanged(event => {
      const uri = uriKey(event?.document?.uri);
      if (!uri) return;
      const entry = documents.get(uri);
      // An event delivered after a provider response for the same document
      // version must not erase the freshly rendered decorations.
      if (entry && entry.version >= event.document.version) return;
      clearDocument(uri);
    }));
  }

  const documentClosed = vscode.workspace?.onDidCloseTextDocument;
  if (typeof documentClosed === "function") {
    subscriptions.push(documentClosed(document => clearDocument(uriKey(document?.uri))));
  }

  return {
    render,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const [uri] of documents) applyVisible(uri, null);
      documents.clear();
      for (const subscription of subscriptions) subscription?.dispose?.();
      subscriptions.length = 0;
      for (const decoration of decorationTypes.values()) decoration.dispose?.();
      decorationTypes.clear();
    }
  };
}
