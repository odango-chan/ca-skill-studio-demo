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
  const decorationStyles = new Map();
  for (const tokenType of tokenTypes) {
    const options = decorationOptions(semanticTokenColors[tokenType]);
    if (options) {
      decorationStyles.set(tokenType, options);
      decorationTypes.set(tokenType, vscode.window.createTextEditorDecorationType(options));
    }
  }

  const documents = new Map();
  const tokenDiagnosticsByUri = new Map();
  const applicationDiagnosticsByUri = new Map();
  const appliedByEditor = new WeakMap();
  const subscriptions = [];
  const diagnostics = {
    lastUri:null,lastDocumentVersion:null,lastTokenCount:0,lastTokenTypeCount:0,
    lastVisibleEditorCount:0,lastCandidateEditorCount:0,lastMatchingEditorCount:0,
    lastVersionMatchedEditorCount:0,lastAppliedEditorCount:0,
    lastAppliedDecorationCount:0,lastAppliedRangeCount:0,
    lastVersionMismatches:[],totalSetDecorationsCalls:0
  };
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

    let calls=0,rangeCount=0;
    for (const tokenType of new Set([...previous, ...current])) {
      const decoration = decorationTypes.get(tokenType);
      if (!decoration) continue;
      const ranges=entry?.ranges.get(tokenType) ?? [];
      editor.setDecorations(decoration,ranges);
      calls++;
      rangeCount+=ranges.length;
    }
    diagnostics.totalSetDecorationsCalls+=calls;
    if (current.size) editorDocuments.set(uri, current);
    else editorDocuments.delete(uri);
    return {decorationCount:current.size,rangeCount,calls};
  }

  function editorCandidates() {
    const visible=[...(vscode.window.visibleTextEditors??[])];
    const candidates=[...visible];
    const active=vscode.window.activeTextEditor;
    if(active&&!candidates.includes(active))candidates.push(active);
    return {visible,candidates};
  }

  function recordApplication(uri,summary) {
    const snapshot={
      lastUri:uri,
      lastVisibleEditorCount:summary.visibleEditorCount,
      lastCandidateEditorCount:summary.candidateEditorCount,
      lastMatchingEditorCount:summary.matchingEditorCount,
      lastVersionMatchedEditorCount:summary.versionMatchedEditorCount,
      lastAppliedEditorCount:summary.appliedEditorCount,
      lastAppliedDecorationCount:summary.appliedDecorationCount,
      lastAppliedRangeCount:summary.appliedRangeCount,
      lastVersionMismatches:summary.versionMismatches
    };
    applicationDiagnosticsByUri.set(uri,snapshot);
    Object.assign(diagnostics,snapshot);
  }

  function applyVisible(uri, entry) {
    const {visible,candidates}=editorCandidates();
    const summary={
      visibleEditorCount:visible.length,candidateEditorCount:candidates.length,
      matchingEditorCount:0,versionMatchedEditorCount:0,appliedEditorCount:0,
      appliedDecorationCount:0,appliedRangeCount:0,versionMismatches:[]
    };
    for (const editor of candidates) {
      if (uriKey(editor.document?.uri) !== uri) continue;
      summary.matchingEditorCount++;
      const versionMatches=!entry||entry.version===editor.document.version;
      if(entry&&!versionMatches){
        summary.versionMismatches.push({
          uri,documentVersion:entry.version,editorVersion:editor.document.version
        });
      }
      const current=entry&&versionMatches?entry:null;
      const applied=setEditorRanges(editor,uri,current);
      if(versionMatches){
        summary.versionMatchedEditorCount++;
        if(current){
          summary.appliedEditorCount++;
          summary.appliedDecorationCount+=applied.decorationCount;
          summary.appliedRangeCount+=applied.rangeCount;
        }
      }
    }
    recordApplication(uri,summary);
    return summary;
  }

  function applyActiveEditor(editor) {
    const uri=uriKey(editor?.document?.uri);
    if(!uri)return;
    const entry=documents.get(uri);
    const summary={
      visibleEditorCount:(vscode.window.visibleTextEditors??[]).length,
      candidateEditorCount:1,matchingEditorCount:1,
      versionMatchedEditorCount:0,appliedEditorCount:0,
      appliedDecorationCount:0,appliedRangeCount:0,versionMismatches:[]
    };
    const versionMatches=!!entry&&entry.version===editor.document.version;
    if(entry&&!versionMatches)summary.versionMismatches.push({
      uri,documentVersion:entry.version,editorVersion:editor.document.version
    });
    const applied=setEditorRanges(editor,uri,versionMatches?entry:null);
    if(versionMatches){
      summary.versionMatchedEditorCount=1;
      summary.appliedEditorCount=1;
      summary.appliedDecorationCount=applied.decorationCount;
      summary.appliedRangeCount=applied.rangeCount;
    }
    recordApplication(uri,summary);
  }

  function clearDocument(uri) {
    if (!uri) return;
    documents.delete(uri);
    tokenDiagnosticsByUri.delete(uri);
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
          !Number.isSafeInteger(deltaCharacter) || deltaCharacter < 0) continue;

      // Delta positions advance for every encoded token, including one whose
      // type or range is later rejected. Never let a malformed entry shift all
      // following tokens to the wrong source positions.
      if (deltaLine === 0) character += deltaCharacter;
      else {
        line += deltaLine;
        character = deltaCharacter;
      }

      if (!Number.isSafeInteger(length) || length <= 0 ||
          !Number.isSafeInteger(tokenTypeIndex) ||
          tokenTypeIndex < 0 || tokenTypeIndex >= tokenTypes.length) continue;

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

    let tokenCount = 0;
    for (const tokenRanges of ranges.values()) tokenCount += tokenRanges.length;
    const tokenSnapshot={
      lastUri:uri,
      lastDocumentVersion:document.version,
      lastTokenCount:tokenCount,
      lastTokenTypeCount:ranges.size
    };
    tokenDiagnosticsByUri.set(uri,tokenSnapshot);
    Object.assign(diagnostics,tokenSnapshot);
    applyVisible(uri, entry);
    return { tokenCount, tokenTypeCount: ranges.size };
  }

  const visibleEditorsChanged = vscode.window.onDidChangeVisibleTextEditors;
  if (typeof visibleEditorsChanged === "function") {
    subscriptions.push(visibleEditorsChanged(editors => {
      for (const editor of editors ?? vscode.window.visibleTextEditors ?? []) {
        applyActiveEditor(editor);
      }
    }));
  }

  // Some Theia CodeEditorOpener transitions update activeTextEditor without
  // publishing a corresponding visible-editors event. Reapply cached ranges
  // on the active-editor event as well; the renderer remains URI/version scoped.
  const activeEditorChanged=vscode.window.onDidChangeActiveTextEditor;
  if(typeof activeEditorChanged==="function"){
    subscriptions.push(activeEditorChanged(editor=>applyActiveEditor(editor)));
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
    diagnostics(uri) {
      const key=typeof uri==="string"?uri:uriKey(uri);
      const tokenSnapshot=key?tokenDiagnosticsByUri.get(key):null;
      const applicationSnapshot=key?applicationDiagnosticsByUri.get(key):null;
      return {
        ...diagnostics,
        ...(tokenSnapshot??{}),
        ...(applicationSnapshot??{}),
        queriedUri:key??null,
        decorationTypeCount:decorationTypes.size,
        decorationStyles:Object.fromEntries(decorationStyles)
      };
    },
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
