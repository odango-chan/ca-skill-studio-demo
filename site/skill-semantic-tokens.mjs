import { parseDocument, isMap, isSeq, isScalar } from "yaml";
import tokenCatalogSource from "../language/spec/skill-language-tokens.yaml";

const catalogDocument = parseDocument(tokenCatalogSource, {
  version: "1.2", schema: "core", strict: true, logLevel: "silent"
});
if (catalogDocument.errors.length) {
  throw new Error("The imported Skill Language Token Catalog is invalid");
}
const catalog = catalogDocument.toJS();
if (catalog?.kind !== "SemanticTokenCatalog" || !Array.isArray(catalog?.spec?.tokens)) {
  throw new Error("The imported Skill Language Token Catalog has an unsupported shape");
}

function toSemanticType(tokenId) {
  const parts = tokenId.split(".");
  return parts[0] + parts.slice(1).map(part =>
    part.split(/[-_]/).map(word => word ? word[0].toUpperCase() + word.slice(1) : "").join("")
  ).join("");
}

const TOKEN_IDS = catalog.spec.tokens.map(token => token.id);
if (new Set(TOKEN_IDS).size !== TOKEN_IDS.length) {
  throw new Error("The imported Skill Language Token Catalog contains duplicate token IDs");
}
export const SKILL_SEMANTIC_TOKEN_TYPES = Object.freeze(TOKEN_IDS.map(toSemanticType));
export const SKILL_SEMANTIC_TOKEN_MODIFIERS = Object.freeze([
  "declaration", "reference", "userDefined"
]);
const TOKEN_INDEX = new Map(SKILL_SEMANTIC_TOKEN_TYPES.map((type, index) => [type, index]));
const MODIFIER_INDEX = new Map(SKILL_SEMANTIC_TOKEN_MODIFIERS.map((name, index) => [name, index]));
const TOKEN_BY_ID = new Map(catalog.spec.tokens.map(token => [token.id, token]));
const GLOB_CACHE = new Map();
const PROVIDER_REGISTRATIONS = new WeakMap();

function globExpression(glob) {
  if (GLOB_CACHE.has(glob)) return GLOB_CACHE.get(glob);
  let source = "^";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") {
        source += "(?:[^/]+/)*";
        i += 2;
      } else {
        source += ".*";
        i++;
      }
    } else if (ch === "*") {
      source += "[^/]*";
    } else {
      source += ch.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  const expression = new RegExp(source + "$");
  GLOB_CACHE.set(glob, expression);
  return expression;
}

function normalizedPath(path) {
  let value = String(path ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
  try { value = decodeURIComponent(value); } catch { /* Keep the literal URI path. */ }
  return value;
}

function sourcePathCandidates(path) {
  const value = normalizedPath(path);
  if (!value) return [];
  const candidates = [value];
  // Studio's selectable sample is a single Skill Package rooted at its own
  // directory. The canonical catalog describes the repository's skills/<id>/
  // layout, so project-relative paths get a virtual package prefix for matching.
  if (!value.startsWith("skills/") &&
      (/^(?:SKILL\.md|assurance\/|cases\/|scripts\/)/.test(value))) {
    candidates.push("skills/_active-package_/" + value);
  }
  return candidates;
}

function selectorMatches(selector, paths) {
  if (typeof selector?.sourceFile !== "string") return false;
  const expression = globExpression(selector.sourceFile);
  return paths.some(path => expression.test(path));
}

function contextForPath(paths) {
  for (const path of paths) {
    if (/^(?:skills\/[^/]+\/)?assurance\/contract\.ya?ml$/i.test(path)) return "SkillContract";
    if (/^(?:skills\/[^/]+\/)?assurance\/procedure\.ya?ml$/i.test(path)) return "Procedure";
    if (/^(?:skills\/[^/]+\/)?assurance\/predicates\.ya?ml$/i.test(path)) return "PredicateSet";
    if (/^skills\/[^/]+\/cases\/[^/]+\/case\.ya?ml$/i.test(path) ||
        /^cases\/[^/]+\/case\.ya?ml$/i.test(path)) return "SkillTestCase";
    if (/^lib\/tools\/.*\.ya?ml$/i.test(path)) return "ToolCatalog";
    if (/^lib\/capabilities\/.*\.ya?ml$/i.test(path)) return "CapabilityContracts";
  }
  return null;
}

function scalarText(node) {
  return isScalar(node) && typeof node.value === "string" ? node.value : null;
}

function selectYamlPath(root, yamlPath, mapKey) {
  if (!root || typeof yamlPath !== "string" || !yamlPath.startsWith("$.")) return [];
  const segments = yamlPath.slice(2).split(".");
  let states = [{ node: root, keyNode: null }];
  for (const segment of segments) {
    const next = [];
    if (segment === "*") {
      for (const state of states) {
        if (!isMap(state.node)) continue;
        for (const pair of state.node.items) {
          next.push({ node: pair.value, keyNode: pair.key });
        }
      }
    } else if (segment.endsWith("[*]")) {
      const field = segment.slice(0, -3);
      for (const state of states) {
        if (!isMap(state.node)) continue;
        for (const pair of state.node.items) {
          if (scalarText(pair.key) !== field || !isSeq(pair.value)) continue;
          for (const item of pair.value.items) next.push({ node: item, keyNode: null });
        }
      }
    } else {
      for (const state of states) {
        if (!isMap(state.node)) continue;
        for (const pair of state.node.items) {
          if (scalarText(pair.key) === segment) {
            next.push({ node: pair.value, keyNode: pair.key });
          }
        }
      }
    }
    states = next;
    if (!states.length) break;
  }
  return states.map(state => mapKey ? state.keyNode : state.node).filter(Boolean);
}

function parseYamlRoot(text) {
  const document = parseDocument(text, {
    version: "1.2",
    schema: "core",
    strict: false,
    uniqueKeys: false,
    keepSourceTokens: true,
    logLevel: "silent"
  });
  return document.contents;
}

function spanPriority(tokenId) {
  if (tokenId.startsWith("ca.symbol.")) return 100;
  if (tokenId.startsWith("ca.reference.")) return 90;
  if (tokenId.startsWith("ca.document.")) return 85;
  if (tokenId.startsWith("ca.expression.")) return 80;
  if (tokenId.startsWith("ca.value.")) return 75;
  if (tokenId.startsWith("ca.keyword.")) return 65;
  if (tokenId === "ca.identifier.user-defined") return 10;
  return 50;
}

function modifiersFor(tokenId) {
  if (tokenId.startsWith("ca.symbol.")) return 1 << MODIFIER_INDEX.get("declaration");
  if (tokenId.startsWith("ca.reference.")) return 1 << MODIFIER_INDEX.get("reference");
  if (tokenId === "ca.identifier.user-defined") return 1 << MODIFIER_INDEX.get("userDefined");
  return 0;
}

function addSpan(spans, node, tokenId, offset = 0) {
  if (!node || !TOKEN_BY_ID.has(tokenId) || !Array.isArray(node.range)) return;
  const start = node.range[0] + offset;
  const end = node.range[1] + offset;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start) return;
  const type = toSemanticType(tokenId);
  const candidate = {
    start, end, tokenId, type,
    tokenType: TOKEN_INDEX.get(type),
    tokenModifiers: modifiersFor(tokenId),
    priority: spanPriority(tokenId)
  };
  const key = start + ":" + end;
  const current = spans.get(key);
  if (!current || candidate.priority > current.priority) spans.set(key, candidate);
}

function currentLexemes(tokenId) {
  const token = TOKEN_BY_ID.get(tokenId);
  return new Set((token?.lexemes ?? [])
    .filter(item => item.status === "current")
    .map(item => item.value));
}

function addContextKeywords(root, context, spans) {
  if (!context || !root) return;
  const structural = new Set(String(TOKEN_BY_ID.get("ca.keyword.structure")?.contexts?.[context] ?? "")
    .split(",").map(value => value.trim()).filter(Boolean));
  const control = currentLexemes("ca.keyword.control");
  const condition = currentLexemes("ca.keyword.condition");
  const binding = currentLexemes("ca.keyword.binding");

  function visit(node, path = []) {
    if (isMap(node)) {
      for (const pair of node.items) {
        const key = scalarText(pair.key);
        if (key !== null) {
          let tokenId = null;
          if (context === "Procedure" && path[0] === "procedures") {
            if (control.has(key) && (path.includes("nodes") || path.includes("steps"))) {
              tokenId = "ca.keyword.control";
            } else if (condition.has(key)) {
              tokenId = "ca.keyword.condition";
            } else if (binding.has(key) &&
                (path.includes("inputs") || path.includes("with") ||
                 path.includes("nodes") || path.includes("steps"))) {
              tokenId = "ca.keyword.binding";
            }
          }
          if (!tokenId && structural.has(key)) tokenId = "ca.keyword.structure";
          if (tokenId) addSpan(spans, pair.key, tokenId);
          visit(pair.value, [...path, key]);
        } else {
          visit(pair.value, path);
        }
      }
    } else if (isSeq(node)) {
      for (const item of node.items) visit(item, [...path, "[*]"]);
    }
  }
  visit(root);
}

function addUserDefinedFallback(root, context, spans) {
  if (context !== "Procedure" || !root) return;
  const existing = new Set([...spans.values()].map(span => span.start + ":" + span.end));
  function visit(node, path = []) {
    if (isMap(node)) {
      for (const pair of node.items) {
        const key = scalarText(pair.key);
        const parentIsInputMap = path[0] === "procedures" &&
          path.length === 3 && path[2] === "inputs";
        const parentIsWithMap = path[0] === "procedures" &&
          path.includes("with") &&
          (path.includes("nodes") || path.includes("steps"));
        if (key !== null && (parentIsInputMap || parentIsWithMap) &&
            !existing.has(pair.key.range?.[0] + ":" + pair.key.range?.[1])) {
          addSpan(spans, pair.key, "ca.identifier.user-defined");
        }
        if (key !== null) visit(pair.value, [...path, key]);
        else visit(pair.value, path);
      }
    } else if (isSeq(node)) {
      for (const item of node.items) visit(item, [...path, "[*]"]);
    }
  }
  visit(root);
}

function frontmatterFieldRanges(text, field) {
  const match = /^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match) return [];
  const body = match[1];
  const root = parseYamlRoot(body);
  const base = match[0].indexOf(body);
  return selectYamlPath(root, "$." + field, false)
    .filter(isScalar)
    .map(node => ({ node, offset: base }));
}

function pythonMetadataFieldRanges(text, field) {
  const result = [];
  let offset = 0;
  let inside = false;
  const lines = text.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g) ?? [];
  for (const raw of lines) {
    if (!raw) continue;
    const line = raw.replace(/[\r\n]+$/, "");
    if (/^\s*#\s*\/\/\/\s*connectionagent-tool\s*$/.test(line)) {
      inside = true;
    } else if (inside && /^\s*#\s*\/\/\/\s*$/.test(line)) {
      break;
    } else if (inside) {
      const match = /^(\s*#\s*)([A-Za-z_][\w-]*)(\s*:\s*)(.*?)\s*$/.exec(line);
      if (match && match[2] === field && match[4].length) {
        const start = offset + match[1].length + match[2].length + match[3].length;
        result.push({ start, end: start + match[4].length });
      }
    }
    offset += raw.length;
  }
  return result;
}

function addSpecialSelectors(text, paths, spans) {
  for (const token of catalog.spec.tokens) {
    for (const selector of token.selectors ?? []) {
      if (!selectorMatches(selector, paths)) continue;
      if (selector.frontmatterField) {
        for (const item of frontmatterFieldRanges(text, selector.frontmatterField)) {
          addSpan(spans, item.node, token.id, item.offset);
        }
      } else if (selector.metadataField) {
        for (const item of pythonMetadataFieldRanges(text, selector.metadataField)) {
          if (!Number.isSafeInteger(item.start) || item.end <= item.start) continue;
          const fakeNode = { range: [item.start, item.end] };
          addSpan(spans, fakeNode, token.id);
        }
      }
    }
  }
}

function addYamlSelectors(root, paths, spans) {
  if (!root) return;
  for (const token of catalog.spec.tokens) {
    for (const selector of token.selectors ?? []) {
      if (!selector.yamlPath || !selectorMatches(selector, paths) ||
          (selector.supportStatus && selector.supportStatus !== "current")) continue;
      const selected = selectYamlPath(root, selector.yamlPath, selector.mapKey === true);
      for (const node of selected) {
        if (selector.scalarValue === true && !isScalar(node)) continue;
        addSpan(spans, node, token.id);
      }
    }
  }
}

export function collectSkillSemanticTokenSpans(text, path = "") {
  if (typeof text !== "string" || !text.length || text.length > 4 * 1024 * 1024) return [];
  const paths = sourcePathCandidates(path);
  if (!paths.length) return [];
  const context = contextForPath(paths);
  const spans = new Map();
  addSpecialSelectors(text, paths, spans);
  if (/\.ya?ml$/i.test(paths[0]) || context) {
    const root = parseYamlRoot(text);
    addContextKeywords(root, context, spans);
    addYamlSelectors(root, paths, spans);
    addUserDefinedFallback(root, context, spans);
  }
  const accepted = [];
  for (const candidate of [...spans.values()]
    .sort((a, b) => b.priority - a.priority || a.start - b.start || a.end - b.end)) {
    if (accepted.some(item => candidate.start < item.end && item.start < candidate.end)) continue;
    accepted.push(candidate);
  }
  return accepted.sort((a, b) => a.start - b.start || a.end - b.end);
}

export function encodeSkillSemanticTokens(model, spans) {
  const segments = [];
  for (const span of spans) {
    const start = Math.max(0, span.start);
    const end = Math.min(model.getValueLength(), span.end);
    if (end <= start) continue;
    const first = model.getPositionAt(start);
    const last = model.getPositionAt(end);
    for (let lineNumber = first.lineNumber; lineNumber <= last.lineNumber; lineNumber++) {
      const lineStart = model.getOffsetAt({ lineNumber, column: 1 });
      const lineEnd = model.getOffsetAt({
        lineNumber,
        column: model.getLineMaxColumn(lineNumber)
      });
      const segmentStart = Math.max(start, lineStart);
      const segmentEnd = Math.min(end, lineEnd);
      if (segmentEnd <= segmentStart) continue;
      const position = model.getPositionAt(segmentStart);
      segments.push({
        line: position.lineNumber - 1,
        character: position.column - 1,
        length: segmentEnd - segmentStart,
        tokenType: span.tokenType,
        tokenModifiers: span.tokenModifiers
      });
    }
  }
  segments.sort((a, b) => a.line - b.line || a.character - b.character);
  const data = [];
  let previousLine = 0;
  let previousCharacter = 0;
  for (const item of segments) {
    const deltaLine = item.line - previousLine;
    const deltaCharacter = deltaLine === 0
      ? item.character - previousCharacter
      : item.character;
    data.push(deltaLine, deltaCharacter, item.length, item.tokenType, item.tokenModifiers);
    previousLine = item.line;
    previousCharacter = item.character;
  }
  return Uint32Array.from(data);
}

export function createSkillSemanticTokensProvider() {
  return {
    getLegend() {
      return {
        tokenTypes: [...SKILL_SEMANTIC_TOKEN_TYPES],
        tokenModifiers: [...SKILL_SEMANTIC_TOKEN_MODIFIERS]
      };
    },
    provideDocumentSemanticTokens(model, _lastResultId, cancellationToken) {
      if (cancellationToken?.isCancellationRequested) return { data: new Uint32Array() };
      const path = model.uri?.path ?? "";
      const spans = collectSkillSemanticTokenSpans(
        model.getValue(),
        path
      );
      return {
        data: encodeSkillSemanticTokens(model, spans)
      };
    },
    releaseDocumentSemanticTokens() {}
  };
}

export function registerSkillSemanticTokens(monaco) {
  if (!monaco || typeof monaco.languages?.registerDocumentSemanticTokensProvider !== "function") {
    throw new TypeError("Monaco Document Semantic Tokens API is unavailable");
  }
  const existing = PROVIDER_REGISTRATIONS.get(monaco);
  if (existing) return existing;
  const provider = createSkillSemanticTokensProvider();
  const registrations = ["yaml", "markdown", "python"].map(language =>
    monaco.languages.registerDocumentSemanticTokensProvider(language, provider)
  );
  const registration = {
    languages: ["yaml", "markdown", "python"],
    dispose() {
      for (const item of registrations) item?.dispose?.();
      PROVIDER_REGISTRATIONS.delete(monaco);
    }
  };
  PROVIDER_REGISTRATIONS.set(monaco, registration);
  return registration;
}
