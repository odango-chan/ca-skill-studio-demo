import {isMap, isScalar, isSeq, parseDocument} from "yaml";
// CA-SL v1alpha5 has no normative upstream semantic-token selector registry.
// These names are Studio presentation metadata only and never grant grammar or linking authority.
export const V1_ALPHA5_SEMANTIC_TOKEN_TYPES = Object.freeze([
  "skillKeyword","skillOperator","skillStep","skillCapability","skillPredicate",
  "skillObservation","skillOutcome","skillDataType","skillSchema",
  "skillReference","skillBinding","skillOperation","skillWait"
]);
export const V1_ALPHA5_SEMANTIC_TOKEN_MODIFIERS = Object.freeze([
  "declaration","reference","imported"
]);
export const SKILL_SEMANTIC_LEGEND = Object.freeze({
  tokenTypes:Object.freeze([...V1_ALPHA5_SEMANTIC_TOKEN_TYPES]),
  tokenModifiers:Object.freeze([...V1_ALPHA5_SEMANTIC_TOKEN_MODIFIERS])
});

const MAX_SOURCE_LENGTH = 4 * 1024 * 1024;
const MAX_NODES = 50000;
const MAX_DEPTH = 64;
const MAX_TOKENS = 20000;

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

function isV1Alpha5Source(text, relativePath) {
  if (relativePath.endsWith("/procedure.yaml"))
    return /^(?:start|nodes):[ \t]*/m.test(text);
  if (relativePath.endsWith("/contract.yaml"))
    return /^goal:\s*/m.test(text) && !/^spec:\s*/m.test(text);
  if (relativePath.endsWith("/predicates.yaml"))
    return /^predicates:\s*/m.test(text) && !/^apiVersion:\s*/m.test(text) && /^\s+parameters:\s*/m.test(text);
  return false;
}

function classifyV1Alpha5Tokens(text, relativePath) {
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
    if (++visited>MAX_NODES || depth>MAX_DEPTH || result.length>MAX_TOKENS) throw Error("CA-SL v1alpha5 semantic budget");
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
      else if(root==="predicates" && last==="script")
        push(value,"skillReference",["reference"],path,"value");
      else if(root==="procedure" && last==="predicate" && parent.includes("predicates"))
        push(value,"skillPredicate",["reference"],path,"value");
      else if(root==="procedure" && parent[0]==="nodes" && parent[2]==="wait" && last==="after")
        push(value,"skillStep",["reference"],path,"value");
      else if(root==="procedure" && parent.includes("arguments") &&
        /^([A-Za-z][A-Za-z0-9_-]*)\.wait\.output(?:\.[A-Za-z][A-Za-z0-9_-]*)*$/.test(value.value))
        push(value,"skillStep",["reference"],path,"value");
      else if(root==="procedure" && parent.includes("routes"))
        push(value,["SUCCEEDED","FAILED","UNRESOLVED","SAFE_STOPPED"].includes(value.value)?"skillOutcome":"skillStep",
          ["SUCCEEDED","FAILED","UNRESOLVED","SAFE_STOPPED"].includes(value.value)?[]:["reference"],path,"value");
      else if(root==="contract" && last==="precondition")
        push(value,"skillStep",["reference"],path,"value");
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
      else if(root==="procedure" && path.length===2 && path[0]==="nodes" && key==="wait")
        push(pair.key,"skillWait",[],next,"key");
      else if(root==="procedure" && path.length===2 && path[0]==="nodes" &&
        ["precondition","operation","observation","postcondition"].includes(key))
        push(pair.key,"skillOperator",[],next,"key");
      else if(root==="procedure" && path.includes("wait") && path.includes("routes"))
        push(pair.key,"skillWait",[],next,"key");
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


function classifyImportedLibraryTokens(text, relativePath) {
  if (!relativePath.startsWith("lib/") || !/^kind:\s*ToolCatalog\s*$/m.test(text)) return [];
  let doc;
  try {
    doc = parseDocument(text, {
      version:"1.2",strict:true,uniqueKeys:true,
      keepSourceTokens:true,logLevel:"silent"
    });
  } catch { return []; }
  if (doc.errors.length || !isMap(doc.contents)) return [];
  const result=[];
  function push(value,type,modifiers,path,part){
    const span=scalarSpan(text,value);
    if (span) result.push({...span,type,modifiers,path,part});
  }
  function visit(value,path,depth){
    if (depth>MAX_DEPTH) return;
    if (isSeq(value)) {
      for (const item of value.items) visit(item,[...path,"*"],depth+1);
      return;
    }
    if (!isMap(value)) return;
    for (const pair of value.items) {
      if (!isScalar(pair.key) || typeof pair.key.value!=="string") continue;
      const key=pair.key.value,next=[...path,key];
      if (key==="operation" && path.includes("contracts"))
        push(pair.value,"skillOperation",["declaration","imported"],next,"value");
      else if (["apiVersion","kind","contracts","operation","effect"].includes(key))
        push(pair.key,"skillKeyword",[],next,"key");
      visit(pair.value,next,depth+1);
    }
  }
  try {visit(doc.contents,[],0);} catch {return [];}
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
  if (typeof text !== "string" || typeof relativePath !== "string" || text.length > MAX_SOURCE_LENGTH) return [];
  if (isV1Alpha5Source(text, relativePath)) return classifyV1Alpha5Tokens(text, relativePath);
  return classifyImportedLibraryTokens(text, relativePath);
}

export const SKILL_SEMANTIC_TOKEN_TYPES = SKILL_SEMANTIC_LEGEND.tokenTypes;
export const SKILL_SEMANTIC_TOKEN_MODIFIERS = SKILL_SEMANTIC_LEGEND.tokenModifiers;
const TOKEN_INDEX = new Map(SKILL_SEMANTIC_TOKEN_TYPES.map((type, index) => [type, index]));
const MODIFIER_INDEX = new Map(SKILL_SEMANTIC_TOKEN_MODIFIERS.map((name, index) => [name, index]));

const PROVIDER_REGISTRATIONS = new WeakMap();

/**
 * Protocol projection consumed by Monaco and browser LSP adapters.
 * v1alpha5 identities are local editor-only AST projections; imported Library
 * declarations are presentation-only and never grant grammar or linking authority.
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
