import {isMap, isScalar, isSeq, parseDocument} from "yaml";
import contract from "../contracts/semantic-tokens.v1.json";

// Single projection of the versioned Skill token contract. This is not a
// second authoring grammar, compiler or Capability resolver.
export const SKILL_SEMANTIC_LEGEND = Object.freeze({
  tokenTypes: Object.freeze(contract.legend.tokenTypes.map(type => type.id)),
  tokenModifiers: Object.freeze(contract.legend.tokenModifiers.map(modifier => modifier.id))
});

const MAX_SOURCE_LENGTH = 4 * 1024 * 1024;
const MAX_NODES = 50000;
const MAX_DEPTH = 64;
const MAX_TOKENS = 20000;

function segmentMatches(pattern, value) {
  if (pattern === "*") return !!value;
  const index = pattern.indexOf("*");
  if (index < 0) return pattern === value;
  if (pattern.indexOf("*", index + 1) >= 0) return false;
  const prefix = pattern.slice(0, index);
  const suffix = pattern.slice(index + 1);
  return value.length > prefix.length + suffix.length &&
    value.startsWith(prefix) && value.endsWith(suffix);
}

function patternMatches(pattern, parts) {
  const segments = pattern ? pattern.split("/") : [];
  return segments.length === parts.length &&
    segments.every((part, index) => segmentMatches(part, parts[index]));
}

function profileFor(relativePath) {
  if (typeof relativePath !== "string" || !relativePath || relativePath.includes("\\"))
    return null;
  const segments = relativePath.split("/");
  if (segments.some(segment => !segment || segment === "." || segment === ".."))
    return null;
  for (const profile of Object.values(contract.profiles)) {
    const suffix = profile.file.split("/");
    if (segments.length < suffix.length) continue;
    if (suffix.every((part, index) =>
      segmentMatches(part, segments[segments.length - suffix.length + index])))
      return profile;
  }
  return null;
}

function ruleAt(profile, path, part) {
  return profile.rules.find(rule =>
    rule.part === part && patternMatches(rule.path, path));
}

function isKeyword(profile, parent, key) {
  for (const [pattern, keywords] of Object.entries(profile.keywords)) {
    if (patternMatches(pattern, parent) && keywords.includes(key)) return true;
  }
  return false;
}

function scalarSpan(text, scalar) {
  if (!isScalar(scalar) || typeof scalar.value !== "string") return null;
  if (!Array.isArray(scalar.range) || scalar.range.length < 2) return null;
  let [start, end] = scalar.range;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
      start < 0 || end <= start || end > text.length) return null;
  const raw = text.slice(start, end);
  if (raw.includes("\n") || raw.includes("\r")) return null;
  // A semantic token colors the identity, not the YAML string delimiters.
  if (raw.length >= 2 && ((raw[0] === "'" && raw.at(-1) === "'") ||
      (raw[0] === '"' && raw.at(-1) === '"'))) {
    ++start;
    --end;
  }
  return end > start ? {start, end} : null;
}

/**
 * Classify an existing YAML document using exact YAML AST scalar spans.
 *
 * Returned offsets are JavaScript UTF-16 offsets in the original source.
 * An unresolved name is still a semantic reference, but coloring never
 * claims that the reference is linked or admitted.
 *
 * @returns {{start:number,end:number,type:string,modifiers:string[]}[]}
 */
export function classifySkillSemanticTokens(text, relativePath) {
  const profile = profileFor(relativePath);
  if (!profile || typeof text !== "string" || !text ||
      text.length > MAX_SOURCE_LENGTH) return [];

  let doc;
  try {
    doc = parseDocument(text, {
      version: "1.2",
      strict: true,
      uniqueKeys: true,
      keepSourceTokens: true,
      logLevel: "silent"
    });
  } catch {
    return [];
  }
  if (doc.errors.length || !doc.contents) return [];

  const result = [];
  const counter = {nodes: 0};
  function add(scalar, type, modifiers = []) {
    const span = scalarSpan(text, scalar);
    if (!span) return;
    result.push({ ...span, type, modifiers: [...modifiers] });
  }
  function visit(node, path, depth) {
    if (!node || ++counter.nodes > MAX_NODES || depth > MAX_DEPTH ||
        result.length > MAX_TOKENS) throw Error("Skill semantic projection limit");
    if (isScalar(node)) {
      const match = ruleAt(profile, path, "value");
      if (match) add(node, match.type, match.modifiers);
      return;
    }
    if (isSeq(node)) {
      for (const item of node.items) visit(item, [...path, "*"], depth + 1);
      return;
    }
    if (!isMap(node)) return;
    for (const pair of node.items) {
      if (!isScalar(pair.key) || typeof pair.key.value !== "string") continue;
      const key = pair.key.value;
      const next = [...path, key];
      const match = ruleAt(profile, next, "key");
      if (match) add(pair.key, match.type, match.modifiers);
      else if (isKeyword(profile, path, key)) add(pair.key, "skillKeyword");
      visit(pair.value, next, depth + 1);
    }
  }

  try { visit(doc.contents, [], 0); }
  catch { return []; }
  if (result.length > MAX_TOKENS) return [];
  return result.sort((a, b) => a.start - b.start || a.end - b.end);
}
