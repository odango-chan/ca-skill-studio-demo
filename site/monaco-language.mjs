import {languageForPath} from "./highlight.mjs";

// E1 only selects a syntax grammar. No YAML schema / Python type checking
// or implicit Runtime permission is implied by a language identifier.
export function monacoLanguageForPath(path="") {
  const language=languageForPath(path);
  return language==="plain" ? "plaintext" : language;
}
