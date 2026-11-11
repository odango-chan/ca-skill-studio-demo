const COLOR=/^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function normalizeColor(value) {
  if (typeof value !== "string") return undefined;
  const match = COLOR.exec(value.trim());
  return match?.[1].toUpperCase();
}

/**
 * Monaco Standalone's IStandaloneThemeData does not consume VS Code's
 * semanticTokenColors property. Its semantic token styling resolves through
 * the standalone TokenTheme, which is built from theme rules.
 *
 * Keep the VS Code theme JSON as the single source of colors, and adapt those
 * same rules for Monaco Standalone instead of maintaining a second palette.
 */
export function standaloneSemanticTokenRules(semanticTokenColors = {}) {
  if (!semanticTokenColors || typeof semanticTokenColors !== "object" ||
      Array.isArray(semanticTokenColors)) {
    throw new TypeError("Semantic token colors must be an object");
  }
  const rules = [];
  for (const [token, declaration] of Object.entries(semanticTokenColors)) {
    if (!/^[A-Za-z][A-Za-z0-9.]*$/.test(token)) {
      throw new TypeError("Invalid semantic token selector: " + token);
    }
    const style = typeof declaration === "string"
      ? { foreground: declaration }
      : declaration;
    if (!style || typeof style !== "object" || Array.isArray(style)) continue;
    const rule = { token };
    const foreground = normalizeColor(style.foreground);
    const background = normalizeColor(style.background);
    if (foreground) rule.foreground = foreground;
    if (background) rule.background = background;
    const fontStyle = [
      style.italic === true ? "italic" : "",
      style.bold === true ? "bold" : "",
      style.underline === true ? "underline" : "",
      style.strikethrough === true ? "strikethrough" : ""
    ].filter(Boolean).join(" ");
    if (fontStyle) rule.fontStyle = fontStyle;
    if (rule.foreground || rule.background || fontStyle) rules.push(rule);
  }
  return rules;
}

export function semanticTokenDecorationClass(type) {
  if (typeof type !== "string" || !/^[A-Za-z][A-Za-z0-9.]*$/.test(type)) {
    throw new TypeError("Invalid semantic token type");
  }
  return "ca-semantic-token--" + type.replace(/\./g, "-");
}

export function semanticTokenDecorationCss(semanticTokenColors = {}) {
  const rules = standaloneSemanticTokenRules(semanticTokenColors);
  return rules.filter(rule => rule.token.startsWith("ca")).map(rule => {
    const declarations = [];
    if (rule.foreground) declarations.push("color:#" + rule.foreground + "!important");
    if (rule.background) declarations.push("background-color:#" + rule.background + "!important");
    if (rule.fontStyle?.includes("italic")) declarations.push("font-style:italic!important");
    if (rule.fontStyle?.includes("bold")) declarations.push("font-weight:700!important");
    const decorations = [];
    if (rule.fontStyle?.includes("underline")) decorations.push("underline");
    if (rule.fontStyle?.includes("strikethrough")) decorations.push("line-through");
    if (decorations.length) declarations.push("text-decoration:" + decorations.join(" ") + "!important");
    if (!declarations.length) return "";
    return ".monaco-editor ." + semanticTokenDecorationClass(rule.token) +
      "{" + declarations.join(";") + "}";
  }).filter(Boolean).join("\n");
}
