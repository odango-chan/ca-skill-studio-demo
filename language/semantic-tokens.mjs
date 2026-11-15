import {isMap, isScalar, isSeq, parseDocument} from "yaml";
import contract from "./contracts/semantic-tokens.v1.json";

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
  const path = relativePath.startsWith("/") ? relativePath.slice(1) : relativePath;
  const segments = path.split("/");
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

function isV1Alpha4Source(text, relativePath) {
  if (relativePath.endsWith("/procedure.yaml"))
    return /^start:\s*/m.test(text) && /^nodes:\s*/m.test(text);
  if (relativePath.endsWith("/contract.yaml"))
    return /^goal:\s*/m.test(text) && !/^spec:\s*/m.test(text);
  if (relativePath.endsWith("/predicates.yaml"))
    return /^predicates:\s*/m.test(text) && !/^\s{2,}\w[^:]*:\s*\n\s+inputs:/m.test(text);
  return false;
}

function classifyV1Alpha4Tokens(text, relativePath) {
  let doc;
  try {
    doc = parseDocument(text, {
      version:"1.2",strict:true,uniqueKeys:true,
      keepSourceTokens:true,logLevel:"silent"
    });
  } catch { return []; }
  if (doc.errors.length || !isMap(doc.contents)) return [];

  const result = [];
  let visited = 0;
  const root = relativePath.endsWith("/procedure.yaml") ? "procedure"
    : relativePath.endsWith("/contract.yaml") ? "contract" : "predicates";
  function push(value, type, modifiers, path, part) {
    const span=scalarSpan(text,value);
    if (span) result.push({...span,type,modifiers,path,part});
  }
  function visit(value,path,depth) {
    if (++visited>MAX_NODES || depth>MAX_DEPTH || result.length>MAX_TOKENS) throw Error("CA-SL v1alpha4 semantic budget");
    if (isSeq(value)) {
      for (const item of value.items) visit(item,[...path,"*"],depth+1);
      return;
    }
    if (!isMap(value)) {
      if (!isScalar(value) || typeof value.value!=="string") return;
      const last=path.at(-1);
      const parent=path.slice(0,-1);
      if(root==="procedure" && path.length===1 && last==="start")
        push(value,"skillStep",["reference"],path,"value");
      else if(root==="procedure" && last==="tool" && parent[0]==="nodes")
        push(value,parent[2]==="observation"?"skillObservation":"skillOperation",["reference"],path,"value");
      else if(root==="procedure" && last==="script" && parent[0]==="nodes")
        push(value,"skillReference",["reference"],path,"value");
      else if(root==="procedure" && last==="predicate" && parent.includes("predicates"))
        push(value,"skillPredicate",["reference"],path,"value");
      else if(root==="procedure" && parent.includes("routes"))
        push(value,["SUCCEEDED","FAILED","UNRESOLVED","SAFE_STOPPED"].includes(value.value)?"skillOutcome":"skillStep",
          ["SUCCEEDED","FAILED","UNRESOLVED","SAFE_STOPPED"].includes(value.value)?[]:["reference"],path,"value");
      else if(root==="contract" && last==="requestSchema")
        push(value,"skillSchema",["reference"],path,"value");
      else if(root==="contract" && last==="contextSchema")
        push(value,"skillSchema",["reference"],path,"value");
      else if(root==="contract" && path[0]==="capabilities")
        push(value,"skillCapability",["reference"],path,"value");
      else if(root==="predicates" && parent.includes("parameters"))
        push(value,"skillDataType",[],path,"value");
      else if(last==="arguments" || parent.includes("arguments"))
        push(value,"skillBinding",[],path,"value");
      return;
    }
    for(const pair of value.items) {
      if(!isScalar(pair.key) || typeof pair.key.value!=="string")continue;
      const key=pair.key.value,next=[...path,key];
      if(root==="procedure" && path.length===1 && path[0]==="nodes")
        push(pair.key,"skillStep",["declaration"],next,"key");
      else if(root==="procedure" && path.length===2 && path[0]==="nodes" &&
        ["precondition","operation","observation","postcondition"].includes(key))
        push(pair.key,"skillOperator",[],next,"key");
      else if(root==="procedure" && path.includes("routes"))
        push(pair.key,"skillOutcome",[],next,"key");
      else if(root==="predicates" && path.length===1 && path[0]==="predicates")
        push(pair.key,"skillPredicate",["declaration"],next,"key");
      else if(["start","nodes","predicates","arguments","routes","tool","script",
          "goal","precondition","requestSchema","contextSchema","capabilities",
          "dependencies","parameters","evidence","requires","evaluator","type",
          "expression","retryOf","limits","maxActions"].includes(key))
        push(pair.key,"skillKeyword",[],next,"key");
      visit(pair.value,next,depth+1);
    }
  }
  try {visit(doc.contents,[],0);} catch{return [];}
  return result.sort((a,b)=>a.start-b.start||a.end-b.end);
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
  if (typeof text==="string" && typeof relativePath==="string" &&
      text.length<=MAX_SOURCE_LENGTH && isV1Alpha4Source(text,relativePath))
    return classifyV1Alpha4Tokens(text,relativePath);
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
  function add(scalar, type, modifiers = [], path = [], part = "value") {
    const span = scalarSpan(text, scalar);
    if (!span) return;
    result.push({ ...span, type, modifiers: [...modifiers], path: [...path], part });
  }
  function visit(node, path, depth) {
    if (!node || ++counter.nodes > MAX_NODES || depth > MAX_DEPTH ||
        result.length > MAX_TOKENS) throw Error("Skill semantic projection limit");
    if (isScalar(node)) {
      const match = ruleAt(profile, path, "value");
      if (match) add(node, match.type, match.modifiers, path, "value");
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
      if (match) add(pair.key, match.type, match.modifiers, next, "key");
      else if (isKeyword(profile, path, key)) add(pair.key, "skillKeyword", [], next, "key");
      visit(pair.value, next, depth + 1);
    }
  }

  try { visit(doc.contents, [], 0); }
  catch { return []; }
  if (result.length > MAX_TOKENS) return [];
  return result.sort((a, b) => a.start - b.start || a.end - b.end);
}


export const SKILL_SEMANTIC_TOKEN_TYPES = SKILL_SEMANTIC_LEGEND.tokenTypes;
export const SKILL_SEMANTIC_TOKEN_MODIFIERS = SKILL_SEMANTIC_LEGEND.tokenModifiers;
const TOKEN_INDEX = new Map(SKILL_SEMANTIC_TOKEN_TYPES.map((type, index) => [type, index]));
const MODIFIER_INDEX = new Map(SKILL_SEMANTIC_TOKEN_MODIFIERS.map((name, index) => [name, index]));

const PROVIDER_REGISTRATIONS = new WeakMap();

/**
 * Compatibility projection consumed by the existing Monaco and browser LSP
 * adapters. All identities, positions and modifiers originate in the
 * ca-skills v0.2 registry; this function only adds protocol numeric indexes.
 */
export function collectSkillSemanticTokenSpans(text, relativePath = "") {
  return classifySkillSemanticTokens(text, relativePath).map(token => {
    let tokenModifiers = 0;
    for (const modifier of token.modifiers) {
      const index = MODIFIER_INDEX.get(modifier);
      if (index !== undefined) tokenModifiers |= 1 << index;
    }
    return {
      ...token,
      tokenId: token.type,
      tokenType: TOKEN_INDEX.get(token.type),
      tokenModifiers,
      priority: 0
    };
  });
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
      const spans = collectSkillSemanticTokenSpans(model.getValue(), model.uri?.path ?? "");
      return { data: encodeSkillSemanticTokens(model, spans) };
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
  // The v0.2 registry defines YAML profiles only. Python and Markdown retain
  // their independent TextMate grammars and Python LSP symbol support.
  const registrations = [monaco.languages.registerDocumentSemanticTokensProvider("yaml", provider)];
  const registration = {
    languages: ["yaml"],
    dispose() {
      for (const item of registrations) item?.dispose?.();
      PROVIDER_REGISTRATIONS.delete(monaco);
    }
  };
  PROVIDER_REGISTRATIONS.set(monaco, registration);
  return registration;
}
