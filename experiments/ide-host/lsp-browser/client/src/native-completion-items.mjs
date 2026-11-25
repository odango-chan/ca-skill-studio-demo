function asRange(value, vscode) {
  if (!value?.start || !value?.end || typeof vscode.Range !== "function") return undefined;
  return new vscode.Range(
    value.start.line, value.start.character,
    value.end.line, value.end.character
  );
}

function asDocumentation(value, vscode) {
  if (typeof value === "string") return value;
  if (value && typeof value.value === "string") {
    return value.kind === "markdown" && typeof vscode.MarkdownString === "function"
      ? new vscode.MarkdownString(value.value)
      : value.value;
  }
  return undefined;
}

/**
 * Convert protocol CompletionItems into host-native CompletionItems.
 *
 * LSP and VS Code share most field names, but Theia's extension-host bridge
 * does not reliably marshal plain LSP TextEdit objects returned from a native
 * CompletionItemProvider. In particular, textEdit.range must be a vscode.Range
 * and its newText must be exposed as CompletionItem.insertText.
 */
export function toNativeCompletionItems(result, vscode) {
  const items = Array.isArray(result) ? result : Array.isArray(result?.items) ? result.items : [];
  if (typeof vscode.CompletionItem !== "function" || typeof vscode.Range !== "function") {
    throw new Error("Native CompletionItem and Range APIs are required by the Theia completion bridge");
  }

  return items.map(item => {
    const label = typeof item?.label === "string"
      ? item.label
      : typeof item?.label?.label === "string" ? item.label.label : "";
    const native = new vscode.CompletionItem(label, item?.kind);

    for (const key of ["detail", "filterText", "sortText", "preselect", "commitCharacters", "tags", "command"]) {
      if (item?.[key] !== undefined) native[key] = item[key];
    }

    const documentation = asDocumentation(item?.documentation, vscode);
    if (documentation !== undefined) native.documentation = documentation;

    const edit = item?.textEdit;
    if (edit && typeof edit.newText === "string") {
      const range = edit.range;
      if (range?.insert && range?.replace) {
        const inserting = asRange(range.insert, vscode);
        const replacing = asRange(range.replace, vscode);
        if (inserting && replacing) native.range = { inserting, replacing };
      } else {
        const converted = asRange(range, vscode);
        if (converted) native.range = converted;
      }
      native.insertText = edit.newText;
    } else if (item?.insertText !== undefined) {
      native.insertText = item.insertTextFormat === 2 &&
        typeof vscode.SnippetString === "function"
        ? new vscode.SnippetString(item.insertText)
        : item.insertText;
    }

    if (item?.label && typeof item.label === "object" && item.label.detail) {
      native.labelDetails = { detail: item.label.detail };
    }
    if (item?.deprecated !== undefined) native.deprecated = item.deprecated;
    return native;
  });
}
