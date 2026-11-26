import {
  createConnection,
  BrowserMessageReader,
  BrowserMessageWriter
} from "vscode-languageserver/browser";
import {
  TextDocumentSyncKind,
  CompletionItemKind,
  SymbolKind,
  SemanticTokensBuilder
} from "vscode-languageserver";
import {
  collectSkillSemanticTokenSpans,
  SKILL_SEMANTIC_TOKEN_TYPES,
  SKILL_SEMANTIC_TOKEN_MODIFIERS
} from "../../../../../language/semantic-tokens.mjs";
import { parseDocument, isMap, isScalar, isSeq } from "yaml";
import {schemaArgumentCompletions}
  from "../../../../../language/schema-argument-completions.mjs";
import {schemaValuePathCompletions}
  from "../../../../../language/schema-value-path-completions.mjs";
import { LanguageDiagnosticSession } from "../../../../../language/lsp/session.js";
import {
  buildSkillSymbolIndex,
  skillSymbolAt,
  uniqueSkillSymbolDeclaration,
  skillSymbolOccurrences,
  skillSymbolDeclarationsForDocument
} from "../../../../../language/symbol-index.mjs";

const PACKAGE_SNAPSHOT_NOTIFICATION = "skillStudio/packageSnapshot";
const PACKAGE_INVALIDATE_NOTIFICATION = "skillStudio/packageInvalidate";
const PACKAGE_CLOSE_NOTIFICATION = "skillStudio/packageClose";
const PACKAGE_SNAPSHOT_ACCEPTED_NOTIFICATION = "skillStudio/packageSnapshotAccepted";
const ANALYSIS_STATUS_NOTIFICATION = "skillStudio/analysisStatus";
const SERVER_ERROR_NOTIFICATION = "skillStudio/serverError";

const connection = createConnection(
  new BrowserMessageReader(self),
  new BrowserMessageWriter(self)
);
const sessions = new Map();
const packageAnalyses = new Map();
const packageSnapshots = new Map();
const symbolIndexes = new Map();
const requestedGeneration = new Map();

function reportError(message, rootUri = undefined, generation = undefined) {
  connection.sendNotification(SERVER_ERROR_NOTIFICATION, {
    message: String(message),
    ...(typeof rootUri === "string" ? { rootUri } : {}),
    ...(Number.isSafeInteger(generation) ? { generation } : {})
  });
}

function createSession(rootUri) {
  const published = new Map();
  return new LanguageDiagnosticSession({
    publish(result) {
      // The shared Language Service owns the complete diagnostic set,
      // including current Package Audit findings. The host Problems tree
      // consumes the matching generation metadata from analysisStatus.
      published.set(result.uri, result.diagnostics.length);
      connection.sendDiagnostics({
        uri: result.uri,
        diagnostics: result.diagnostics,
        ...(Number.isSafeInteger(result.version) ? { version: result.version } : {})
      });
    },
    status(result) {
      const publishedDiagnosticCount = [...published.values()]
        .reduce((total, count) => total + count, 0);
      // Observability only: PARTIAL with zero published diagnostics must not
      // look like a successful empty analysis. Expose exact component states
      // of the *same* accepted generation; do not weaken readiness criteria.
      const current = packageAnalyses.get(rootUri);
      const analysis = current?.snapshot.generation === result.generation ?
        current.analysis : null;
      // Expose component state for every accepted generation, including
      // READY source projection with an UNAVAILABLE trust/Package qualification.
      // The top-level state is source-analysis readiness, not release qualification.
      const analysisDetail = analysis ? {
        procedureState: analysis.procedure.state,
        procedureDiagnosticCount: analysis.procedure.diagnostics.length,
        packageAuditState: analysis.packageAudit.state,
        packageAuditReason: analysis.packageAudit.reason ?? null,
        packageAuditDiagnosticCount: analysis.packageAudit.diagnostics.length
      } : {};
      connection.sendNotification(ANALYSIS_STATUS_NOTIFICATION, {
        ...result,
        ...analysisDetail,
        rootUri,
        publishedDiagnosticCount,
        analysisDiagnostics: analysis?.diagnostics ?? []
      });
    },
    analysis(snapshot, analysis) {
      if (requestedGeneration.get(rootUri) === snapshot.generation) {
        packageAnalyses.set(rootUri, { snapshot, analysis });
        // Build only from the exact Package generation accepted by the shared
        // language session. This index never outlives that generation.
        symbolIndexes.set(rootUri, buildSkillSymbolIndex(snapshot));
      }
      refreshSemanticTokens();
    }
  });
}

function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\r") {
      if (text[i + 1] === "\n") i++;
      starts.push(i + 1);
    } else if (text[i] === "\n") {
      starts.push(i + 1);
    }
  }
  return starts;
}

function positionAt(starts, offset) {
  let low = 0, high = starts.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (starts[mid] <= offset) low = mid + 1;
    else high = mid - 1;
  }
  return { line: high, character: offset - starts[high] };
}

function semanticTokensForDocument(document) {
  const spans=collectSkillSemanticTokenSpans(document.text,document.relativePath);
  const starts=lineStarts(document.text);
  const builder=new SemanticTokensBuilder({
    tokenTypes:SKILL_SEMANTIC_TOKEN_TYPES,
    tokenModifiers:SKILL_SEMANTIC_TOKEN_MODIFIERS
  });
  for(const span of spans){
    if(!Number.isSafeInteger(span.start)||!Number.isSafeInteger(span.end)||
       span.start<0||span.end<=span.start||span.end>document.text.length||
       !Number.isSafeInteger(span.tokenType)||!Number.isSafeInteger(span.tokenModifiers))
      continue;
    const first=positionAt(starts,span.start);
    const last=positionAt(starts,span.end);
    for(let line=first.line;line<=last.line;line++){
      const lineStart=starts[line];
      let lineEnd=line+1<starts.length?starts[line+1]:document.text.length;
      if(lineEnd>lineStart&&document.text[lineEnd-1]==="\n")lineEnd--;
      if(lineEnd>lineStart&&document.text[lineEnd-1]==="\r")lineEnd--;
      const segmentStart=Math.max(span.start,lineStart);
      const segmentEnd=Math.min(span.end,lineEnd);
      if(segmentEnd<=segmentStart)continue;
      builder.push(line,segmentStart-lineStart,segmentEnd-segmentStart,
        span.tokenType,span.tokenModifiers);
    }
  }
  return builder.build();
}

function refreshSemanticTokens(){
  try{
    const refresh=connection.languages?.semanticTokens?.refresh;
    if(typeof refresh==="function")void refresh().catch(()=>{});
  }catch{/* Older clients may not support workspace semantic-token refresh. */}
}

function offsetAt(text, position) {
  if (!Number.isSafeInteger(position?.line) ||
      !Number.isSafeInteger(position?.character) ||
      position.line < 0 || position.character < 0) return null;
  const starts = lineStarts(text);
  if (position.line >= starts.length) return null;
  const start = starts[position.line];
  let end = position.line + 1 < starts.length ? starts[position.line + 1] : text.length;
  if (end > start && text[end - 1] === "\n") end--;
  if (end > start && text[end - 1] === "\r") end--;
  if (position.character > end - start) return null;
  return start + position.character;
}

function toLspRange(text, range) {
  if (!range || !Number.isSafeInteger(range.start) ||
      !Number.isSafeInteger(range.end) || range.start < 0 ||
      range.end < range.start || range.end > text.length) return null;
  const starts = lineStarts(text);
  return {
    start: positionAt(starts, range.start),
    end: positionAt(starts, range.end)
  };
}

function contains(range, offset) {
  return Boolean(range && Number.isSafeInteger(range.start) &&
    Number.isSafeInteger(range.end) && offset >= range.start && offset <= range.end);
}

function packageForUri(uri) {
  for (const value of packageAnalyses.values()) {
    if (value.snapshot.documents.some(document => document.uri === uri))
      return value;
  }
  return null;
}

function packageSnapshotForUri(uri) {
  for (const snapshot of packageSnapshots.values()) {
    if (Array.isArray(snapshot.documents) &&
        snapshot.documents.some(document => document?.uri === uri))
      return snapshot;
  }
  return null;
}

function snapshotDocumentFor(snapshot, uri) {
  return snapshot?.documents?.find(document => document?.uri === uri) ?? null;
}

function documentFor(value, uri) {
  return value?.snapshot.documents.find(document => document.uri === uri) ?? null;
}

function allReferences(analysis) {
  return [...analysis.scriptReferences, ...analysis.schemaReferences];
}

function referenceAt(value, uri, offset) {
  for (const reference of allReferences(value.analysis)) {
    if (reference.sourceUri === uri && contains(reference.sourceRange, offset))
      return { reference, side: "source" };
    if (reference.targetUri === uri && contains(reference.targetRange, offset))
      return { reference, side: "target" };
  }
  return null;
}

function location(uri, document, range) {
  const converted = document && toLspRange(document.text, range);
  return converted ? { uri, range: converted } : null;
}

function sameTarget(a, b) {
  return a.targetUri === b.targetUri &&
    a.targetRange?.start === b.targetRange?.start &&
    a.targetRange?.end === b.targetRange?.end;
}

function scriptToolName(text) {
  return /^# name: ([A-Za-z][A-Za-z0-9_-]*)$/m.exec(text)?.[1] ?? null;
}

function projectOperationCatalog(snapshot) {
  const unique = new Map();
  const ambiguous = new Set();
  for (const operation of snapshot.dependencyOperations ?? []) {
    const alias = operation?.dependencyId;
    const id = operation?.id;
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(alias ?? "") ||
        !/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(id ?? "")) continue;
    // A v1alpha5 external Tool reference is identified by BOTH its project
    // Dependency Alias and the package-local Callable ID. Two packages may
    // legitimately export the same Callable ID; they are not ambiguous until
    // the same alias-qualified identity is declared more than once.
    const reference = alias + "::" + id;
    if (unique.has(reference)) ambiguous.add(reference);
    unique.set(reference, { ...operation, reference });
  }
  for (const reference of ambiguous) unique.delete(reference);
  return unique;
}
function schemaTitleCatalog(snapshot) {
  const found = new Map();
  const ambiguous = new Set();
  const schemas = snapshot.documents.filter(document =>
    /^schemas\/[A-Za-z0-9_.-]+\.schema\.ya?ml$/.test(document.relativePath)
  ).map(document => ({ text: document.text, path: document.relativePath }));
  for (const entry of snapshot.dependencySchemas ?? []) {
    if (typeof entry?.text !== "string" || typeof entry.path !== "string" ||
        typeof entry.dependencyId !== "string") continue;
    schemas.push({ text: entry.text, path: entry.dependencyId + "/" + entry.path });
  }
  for (const schema of schemas) {
    const parsed = parseDocument(schema.text, {
      version: "1.2", schema: "core", strict: true,
      uniqueKeys: true, stringKeys: true, logLevel: "silent"
    });
    if (parsed.errors.length || !isMap(parsed.contents)) continue;
    const title = parsed.contents.get("title", true);
    if (!isScalar(title) || typeof title.value !== "string" ||
        !/^[A-Za-z][A-Za-z0-9]*$/.test(title.value)) continue;
    if (found.has(title.value)) ambiguous.add(title.value);
    else found.set(title.value, schema.path);
  }
  return [...found].filter(([title]) => !ambiguous.has(title))
    .map(([title, path]) => ({ title, path }));
}

connection.onInitialize(params => ({
  capabilities: {
    // The extension host sends bounded Package snapshots as a custom
    // notification. Do not establish a second competing TextDocument store.
    textDocumentSync: TextDocumentSyncKind.None,
    definitionProvider: true,
    referencesProvider: true,
    ...(params?.initializationOptions?.disableSemanticTokens === true ? {} : {
      semanticTokensProvider: {
        legend: {
          tokenTypes: [...SKILL_SEMANTIC_TOKEN_TYPES],
          tokenModifiers: [...SKILL_SEMANTIC_TOKEN_MODIFIERS]
        },
        full: true,
        range: false
      }
    }),
    hoverProvider: true,
    documentSymbolProvider: true,
    completionProvider: {
      resolveProvider: false,
      triggerCharacters: [":", "/", "."]
    }
  },
  serverInfo: {
    name: "Skill Studio Language Service",
    version: "0.2.0"
  }
}));

// Health is a read-only transport liveness check. It does not inspect or
// mutate Package Source or claim an analysis generation is READY.
connection.onRequest("skillStudio/health", () => ({alive:true}));

// Acceptance-only semantic-token diagnostics let the Theia adapter distinguish
// "snapshot has not arrived yet" from "this exact source has no token spans".
// Return metadata only; never return source contents or linking/qualification.
connection.onRequest("skillStudio/semanticTokenDiagnostics", params => {
  const uri=typeof params?.uri==="string"?params.uri:"";
  const snapshot=uri?packageSnapshotForUri(uri):null;
  const document=snapshot?snapshotDocumentFor(snapshot,uri):null;
  const spans=document
    ?collectSkillSemanticTokenSpans(document.text,document.relativePath):[];
  return {
    packageFound:Boolean(document),
    rootUri:snapshot?.rootUri??null,
    generation:snapshot?.generation??null,
    relativePath:document?.relativePath??null,
    textLength:document?.text?.length??0,
    tokenCount:spans.length
  };
});

connection.languages.semanticTokens.on(params=>{
  const snapshot=packageSnapshotForUri(params.textDocument.uri);
  if(!snapshot)return {data:[]};
  const document=snapshotDocumentFor(snapshot,params.textDocument.uri);
  if(!document)return {data:[]};
  // Semantic coloring is a source-AST projection. It must not depend on
  // Python symbol analysis, the Package's READY/PARTIAL state, or whether
  // this YAML file produced an analysis document. The latest accepted
  // Package snapshot owns the exact source text/version for this URI.
  return semanticTokensForDocument(document);
});

connection.onDefinition(params => {
  const uri=params.textDocument.uri;
  const snapshot=packageSnapshotForUri(uri);
  const source=snapshot?snapshotDocumentFor(snapshot,uri):null;
  const offset=source?offsetAt(source.text,params.position):null;
  const index=snapshot?symbolIndexes.get(snapshot.rootUri):null;
  const symbolHit=offset===null?null:skillSymbolAt(index,uri,offset);
  if(symbolHit){
    if(snapshot.completeness!=="complete"||index?.generation!==snapshot.generation)
      return null;
    const declaration=uniqueSkillSymbolDeclaration(symbolHit);
    if(!declaration){
      if(symbolHit.declarations.length||
         !["skillOperation","skillCapability"].includes(symbolHit.token.type))return null;
      return projectOperationCatalog(snapshot).get(symbolHit.token.name)?.location??null;
    }
    const target=snapshotDocumentFor(snapshot,declaration.uri);
    return location(declaration.uri,target,declaration.range);
  }
  const value=packageForUri(uri);
  if(!value||value.analysis.state==="UNAVAILABLE"||offset===null)return null;
  const document=documentFor(value,uri);
  if(!document)return null;
  const hit=referenceAt(value,document.uri,offset);
  if(!hit||!hit.reference.packageContextComplete)return null;
  if(hit.side==="source"){
    const target=documentFor(value,hit.reference.targetUri);
    return location(hit.reference.targetUri,target,hit.reference.targetRange);
  }
  // Preserve reverse Definition for Python entrypoints and Schema declarations.
  return allReferences(value.analysis)
    .filter(item=>item.packageContextComplete&&sameTarget(item,hit.reference))
    .map(item=>location(item.sourceUri,documentFor(value,item.sourceUri),item.sourceRange))
    .filter(Boolean);
});

connection.onReferences(params => {
  const uri=params.textDocument.uri;
  const snapshot=packageSnapshotForUri(uri);
  const source=snapshot?snapshotDocumentFor(snapshot,uri):null;
  const offset=source?offsetAt(source.text,params.position):null;
  const value=packageForUri(uri);
  if(!value||value.analysis.state==="UNAVAILABLE"||offset===null)return [];
  const document=documentFor(value,uri);
  if(!document)return [];
  const hit=referenceAt(value,document.uri,offset);
  if(hit&&hit.reference.packageContextComplete){
    const references=allReferences(value.analysis).filter(item=>
      item.packageContextComplete&&sameTarget(item,hit.reference));
    const locations=references.map(item=>
      location(item.sourceUri,documentFor(value,item.sourceUri),item.sourceRange)
    ).filter(Boolean);
    if(params.context?.includeDeclaration){
      const target=location(hit.reference.targetUri,
        documentFor(value,hit.reference.targetUri),hit.reference.targetRange);
      if(target)locations.unshift(target);
    }
    return locations;
  }
  const index=snapshot?symbolIndexes.get(snapshot.rootUri):null;
  const symbolHit=offset===null?null:skillSymbolAt(index,uri,offset);
  if(symbolHit){
    if(snapshot.completeness!=="complete"||index?.generation!==snapshot.generation||
       !uniqueSkillSymbolDeclaration(symbolHit))return [];
    return skillSymbolOccurrences(symbolHit,params.context?.includeDeclaration===true)
      .map(item=>location(item.uri,snapshotDocumentFor(snapshot,item.uri),item.range))
      .filter(Boolean);
  }
  return [];
});

connection.onHover(params => {
  const uri=params.textDocument.uri;
  const snapshot=packageSnapshotForUri(uri);
  const source=snapshot?snapshotDocumentFor(snapshot,uri):null;
  const offset=source?offsetAt(source.text,params.position):null;
  const index=snapshot?symbolIndexes.get(snapshot.rootUri):null;
  const symbolHit=offset===null?null:skillSymbolAt(index,uri,offset);
  if(symbolHit){
    const declaration=uniqueSkillSymbolDeclaration(symbolHit);
    const scriptDocument=declaration&&symbolHit.token.type==="skillReference"
      ?snapshot.documents.find(item=>item.relativePath===declaration.relativePath):null;
    const scriptName=scriptDocument?scriptToolName(scriptDocument.text):null;
    const kind=({
      skillProcedure:"Procedure",
      skillStep:"Procedure node",
      skillPredicate:"Predicate",
      skillOperation:"Tool Operation",
      skillObservation:"Observation Tool",
      skillCapability:"Capability grant",
      skillSchema:"Schema",
      skillReference:symbolHit.token.name.startsWith("scripts/")?"Skill Script":"Reference"
    })[symbolHit.token.type]??"Skill symbol";
    const resolved=Boolean(declaration&&snapshot.completeness==="complete"&&
      index?.generation===snapshot.generation);
    const operation=!symbolHit.declarations.length&&snapshot.completeness==="complete"&&
      index?.generation===snapshot.generation&&
      ["skillOperation","skillCapability"].includes(symbolHit.token.type)
      ? projectOperationCatalog(snapshot).get(symbolHit.token.name) : null;
    let predicateSignature=null;
    if(resolved&&symbolHit.token.type==="skillPredicate"){
      const source=snapshot.documents.find(item=>
        item.relativePath==="assurance/predicates.yaml");
      if(source){
        try{
          const parsed=parseDocument(source.text,{version:"1.2",strict:true,
            uniqueKeys:true,logLevel:"silent"});
          const set=isMap(parsed.contents)?parsed.contents.get("predicates",true):null;
          const predicate=isMap(set)?set.get(symbolHit.token.name,true):null;
          const parameters=isMap(predicate)?predicate.get("parameters",true):null;
          if(!parsed.errors.length&&isSeq(parameters)){
            const signature=parameters.items.map(item=>{
              if(!isMap(item)||item.items.length!==1)return null;
              const pair=item.items[0];
              const name=isScalar(pair.key)?String(pair.key.value):"";
              const type=isScalar(pair.value)?String(pair.value.value):"";
              return name&&type?name+": "+type:null;
            });
            if(signature.every(Boolean))
              predicateSignature=symbolHit.token.name+"("+signature.join(", ")+")";
          }
        }catch{/* An incomplete PredicateSet must not fabricate a signature. */}
      }
    }
    const body=operation
      ? "**Tool Operation** `"+operation.reference+"`\n\nDeclared in project dependency `"+
        operation.dependencyId+"`."
      : resolved
      ? "**"+kind+"** `"+(scriptName??predicateSignature??symbolHit.token.name)+"`\n\nDeclared in `"+declaration.relativePath+"`"
      : "**"+kind+" reference** `"+symbolHit.token.name+"`\n\nNo unique declaration is available in the current complete Package snapshot.";
    return {contents:{kind:"markdown",value:body},
      range:toLspRange(source.text,symbolHit.token.range)};
  }
  const value=packageForUri(uri);
  if(!value||value.analysis.state==="UNAVAILABLE"||offset===null)return null;
  const document=documentFor(value,uri);
  if(!document)return null;
  const hit=referenceAt(value,document.uri,offset);
  if (hit && hit.reference.packageContextComplete) {
    const reference = hit.reference;
    const target = documentFor(value, reference.targetUri);
    if (reference.kind === "procedure-script-caller" ||
        reference.kind === "predicate-evaluator-caller") {
      const name = target ? scriptToolName(target.text) : null;
      return {
        contents: {
          kind: "markdown",
          value: [
            "**Skill Script**",
            "",
            "`" + reference.targetPath + "`",
            name ? "Tool name: `" + name + "`" : ""
          ].filter(Boolean).join("\n")
        },
        range: toLspRange(document.text,
          hit.side === "source" ? reference.sourceRange : reference.targetRange)
      };
    }
    return {
      contents: {
        kind: "markdown",
        value: [
          "**" + (reference.kind === "script-input-schema" ? "Input Schema" : "Output Schema") + "**",
          "",
          "`" + reference.title + "`",
          reference.targetPath
        ].join("\n")
      },
      range: toLspRange(document.text,
        hit.side === "source" ? reference.sourceRange : reference.targetRange)
    };
  }

  const documentAnalysis = value.analysis.documents.find(item => item.uri === document.uri);
  const symbol = documentAnalysis?.pythonSymbols.find(item =>
    contains(item.range, offset));
  if (symbol?.range) {
    return {
      contents: {
        kind: "markdown",
        value: "**" + (symbol.kind === "class" ? "Class" : "Function") +
          "** `" + symbol.name + "`" +
          (symbol.async ? " (async)" : "")
      },
      range: toLspRange(document.text, symbol.range)
    };
  }
  return null;
});

connection.onDocumentSymbol(params => {
  const uri=params.textDocument.uri;
  const snapshot=packageSnapshotForUri(uri);
  const source=snapshot?snapshotDocumentFor(snapshot,uri):null;
  const index=snapshot?symbolIndexes.get(snapshot.rootUri):null;
  if(source&&index?.generation===snapshot.generation){
    const declarations=skillSymbolDeclarationsForDocument(index,uri);
    const procedures=declarations.filter(item=>item.type==="skillProcedure");
    const steps=declarations.filter(item=>item.type==="skillStep");
    const symbols=[];
    for(const procedure of procedures){
      const children=steps.filter(item=>item.path?.[1]===procedure.name)
        .map(item=>{
          const range=toLspRange(source.text,item.range);
          return range?{name:item.name,kind:SymbolKind.Method,range,selectionRange:range}:null;
        }).filter(Boolean);
      const range=toLspRange(source.text,procedure.range);
      if(range)symbols.push({name:procedure.name,kind:SymbolKind.Function,
        range,selectionRange:range,children});
    }
    for(const item of declarations.filter(item=>
      item.type==="skillPredicate"||item.type==="skillOperation")){
      const range=toLspRange(source.text,item.range);
      if(range)symbols.push({name:item.name,kind:SymbolKind.Function,
        range,selectionRange:range});
    }
    // The current CA-SL grammar has one root Node graph and no named Procedure declaration.
    // Show those Nodes in native Outline rather than returning an empty list.
    if(!procedures.length && source.relativePath==="assurance/procedure.yaml"){
      for(const item of steps.filter(item=>item.path?.[0]==="nodes")){
        const range=toLspRange(source.text,item.range);
        if(range)symbols.push({name:item.name,kind:SymbolKind.Method,
          range,selectionRange:range});
      }
    }
    if(symbols.length)return symbols;
  }
  const value = packageForUri(uri);
  if (!value || value.analysis.state === "UNAVAILABLE") return [];
  const document = documentFor(value, params.textDocument.uri);
  if (!document) return [];
  const documentAnalysis = value.analysis.documents.find(item => item.uri === document.uri);
  return (documentAnalysis?.pythonSymbols ?? []).filter(symbol => symbol.range)
    .map(symbol => ({
      name: symbol.name,
      kind: symbol.kind === "class" ? SymbolKind.Class : SymbolKind.Function,
      location: location(document.uri, document, symbol.range)
    })).filter(symbol => symbol.location);
});

/** Current CA-SL authoring completions are syntax suggestions, not Owner grants. */
function currentGrammarCompletions(value, document, prefix, offset, lineStart) {
  const isProcedure=document.relativePath==="assurance/procedure.yaml";
  const isContract=document.relativePath==="assurance/contract.yaml";
  const isPredicateSet=document.relativePath==="assurance/predicates.yaml";
  if(!isProcedure&&!isContract&&!isPredicateSet)return null;

  // Track the current YAML indentation scope. Looking for the last stage
  // alone leaks stale completion candidates across Nodes and into arguments.
  const lines=document.text.slice(0,lineStart).split(/\r?\n/);
  let inNodes=false,inNode=false,nodeId=null,stage=null,section=null,inWait=false,waitSection=null;
  for(const line of lines){
    if(/^nodes:\s*$/.test(line)){
      inNodes=true;inNode=false;nodeId=null;stage=null;section=null;inWait=false;waitSection=null;continue;
    }
    if(/^[^\s#]/.test(line)){
      inNodes=false;inNode=false;nodeId=null;stage=null;section=null;inWait=false;waitSection=null;continue;
    }
    if(!inNodes)continue;
    const node=/^ {2}([A-Za-z][A-Za-z0-9_-]*):\s*$/.exec(line);
    if(node){
      inNode=true;nodeId=node[1];stage=null;section=null;inWait=false;waitSection=null;continue;
    }
    if(!inNode)continue;
    const nextWait=/^ {4}wait:\s*$/.test(line);
    if(nextWait){stage=null;section=null;inWait=true;waitSection=null;continue;}
    const nextStage=/^ {4}(precondition|operation|observation|postcondition):\s*$/.exec(line);
    if(nextStage){stage=nextStage[1];section=null;inWait=false;waitSection=null;continue;}
    const waitProperty=/^ {6}([A-Za-z][A-Za-z0-9_-]*):\s*$/.exec(line);
    if(inWait&&waitProperty){
      waitSection=["event","response","routes"].includes(waitProperty[1])?waitProperty[1]:null;
      section=waitSection;continue;
    }
    const nextSection=/^ {6}(predicates|arguments|routes):\s*$/.exec(line);
    if(nextSection)section=nextSection[1];
  }
  let parsed;
  try {
    parsed=parseDocument(document.text,{version:"1.2",strict:true,
      uniqueKeys:true,logLevel:"silent"});
  }catch{return [];}
  if(parsed.errors.length)return [];
  const nodes=isProcedure&&isMap(parsed.contents) ? parsed.contents.get("nodes",true) : null;
  const localNodes=isMap(nodes)?nodes.items
    .filter(item=>isScalar(item.key)&&typeof item.key.value==="string")
    .map(item=>item.key.value):[];
  const currentNode=isMap(nodes)&&nodeId?nodes.get(nodeId,true):null;
  const currentStages=["precondition","operation","observation","postcondition"]
    .filter(name=>isMap(currentNode)&&currentNode.has(name));
  // Response-boundary completion must follow the event-accepted business path.
  // In particular, do not suggest a Node that is reachable only through this
  // Wait's TIMEOUT edge. Wait-control routes are intentionally not traversed.
  const waitResponseTargets=()=>{
    const reachable=new Set(),queue=[];
    let globalGate="";
    const contractDocument=value.snapshot.documents.find(item=>
      item.relativePath==="assurance/contract.yaml");
    if(contractDocument){
      try{
        const contractTree=parseDocument(contractDocument.text,{version:"1.2",strict:true,
          uniqueKeys:true,logLevel:"silent"});
        if(!contractTree.errors.length&&isMap(contractTree.contents))
          globalGate=String(contractTree.contents.get("precondition",true)?.value??"");
      }catch{}
    }
    const enqueueBusinessRoutes=(id)=>{
      const body=isMap(nodes)?nodes.get(id,true):null;
      if(!isMap(body))return;
      for(const stage of ["precondition","operation","observation","postcondition"]){
        if(id===nodeId&&globalGate===id+".precondition"&&stage==="precondition")continue;
        const stageNode=body.get(stage,true);
        const routes=isMap(stageNode)?stageNode.get("routes",true):null;
        if(!isMap(routes))continue;
        for(const route of routes.items){
          const target=isScalar(route.value)?String(route.value.value):"";
          if(localNodes.includes(target)&&target!==nodeId&&!reachable.has(target))
            queue.push(target);
        }
      }
    };
    enqueueBusinessRoutes(nodeId);
    while(queue.length){
      const id=queue.shift();
      if(reachable.has(id))continue;
      reachable.add(id);
      enqueueBusinessRoutes(id);
    }
    return [...reachable];
  };
  const finalStage=currentStages.at(-1)===stage;
  const make=(labels,typed,start,kind=CompletionItemKind.Keyword,detail="Current CA-SL source syntax")=>
    labels.filter(name=>name.startsWith(typed)).map(name=>({
      label:name,kind,detail,
      textEdit:{range:{
        start:positionAt(lineStarts(document.text),start),
        end:positionAt(lineStarts(document.text),offset)
      },newText:name}
    }));

  if(isPredicateSet){
    // Current PredicateSet script evaluators reference Package-local
    // Python scripts directly through evaluator.script.
    const script=/^ {6}script:[ \t]*([A-Za-z0-9_./-]*)$/.exec(prefix);
    if(script&&value.snapshot.completeness==="complete"){
      const names=value.snapshot.documents
        .filter(item=>/^scripts\/[A-Za-z0-9_.-]+\.py$/.test(item.relativePath))
        .map(item=>item.relativePath);
      return make(names,script[1],offset-script[1].length,
        CompletionItemKind.File,"Package-local Predicate Script");
    }
    return null;
  }
  if(isContract){
    // Only suggest actual, locally declared Precondition stages from this
    // Package. An unresolved or partial Procedure is not a declaration source.
    const gate=/^precondition:[ \t]*([A-Za-z0-9_.-]*)$/.exec(prefix);
    if(gate && value.snapshot.completeness==="complete"){
      const procedure=value.snapshot.documents.find(item=>
        item.relativePath==="assurance/procedure.yaml");
      if(!procedure)return [];
      try {
        const doc=parseDocument(procedure.text,{version:"1.2",strict:true,
          uniqueKeys:true,logLevel:"silent"});
        const sourceNodes=isMap(doc.contents)?doc.contents.get("nodes",true):null;
        if(doc.errors.length||!isMap(sourceNodes))return [];
        const choices=sourceNodes.items.filter(item=>
          isScalar(item.key)&&typeof item.key.value==="string"&&
          isMap(item.value)&&isMap(item.value.get("precondition",true)))
          .map(item=>item.key.value+".precondition");
        return make(choices,gate[1],offset-gate[1].length,
          CompletionItemKind.Reference,"Declared Package Precondition stage");
      }catch{return [];}
    }
    const request=/^requestSchema:[ \t]*([A-Za-z0-9_./-]*)$/.exec(prefix);
    if(request && value.snapshot.completeness==="complete"){
      return make(value.snapshot.documents
        .filter(item=>/^schemas\/[A-Za-z0-9_.-]+\.schema\.ya?ml$/.test(item.relativePath))
        .map(item=>item.relativePath),request[1],offset-request[1].length,
        CompletionItemKind.File,"Skill-owned request Schema");
    }
    return null;
  }

  const entry=/^start:[ \t]*([A-Za-z0-9_-]*)$/.exec(prefix);
  if(entry && value.snapshot.completeness==="complete")
    return make(localNodes,entry[1],offset-entry[1].length,
      CompletionItemKind.Reference,"Declared Package Node");

  const predicate=/^ {8}-[ \t]+predicate:[ \t]*([A-Za-z0-9_.-]*)$/.exec(prefix);
  if(predicate && section==="predicates" &&
     (stage==="precondition"||stage==="postcondition") &&
     value.snapshot.completeness==="complete"){
    const definition=value.snapshot.documents.find(item=>
      item.relativePath==="assurance/predicates.yaml");
    if(!definition)return [];
    try {
      const doc=parseDocument(definition.text,{version:"1.2",strict:true,
        uniqueKeys:true,logLevel:"silent"});
      const predicates=isMap(doc.contents)?doc.contents.get("predicates",true):null;
      if(doc.errors.length||!isMap(predicates))return [];
      const ids=predicates.items.filter(item=>
        isScalar(item.key)&&typeof item.key.value==="string"&&isMap(item.value))
        .map(item=>item.key.value);
      return make(ids,predicate[1],offset-predicate[1].length,
        CompletionItemKind.Reference,"Package-local Predicate declaration");
    }catch{return [];}
  }

  const stageField=/^( {4})([a-z]*)$/.exec(prefix);
  if(stageField && inNode)return make(["wait:","precondition:","operation:","observation:","postcondition:"],
    stageField[2],lineStart+4);

  // Node-entry Wait is a control field, not a fifth business stage.
  const waitTopField=/^( {6})([a-z]*)$/.exec(prefix);
  if(waitTopField&&inWait)return make(["event:","timeout:","response:","routes:"],
    waitTopField[2],lineStart+6,CompletionItemKind.Keyword,"Node-entry Wait control fields");

  const waitMemberField=/^( {8})([a-zA-Z]*)$/.exec(prefix);
  if(waitMemberField&&inWait&&waitSection==="event")
    return make(["source:","service:","operation:"],waitMemberField[2],lineStart+8,
      CompletionItemKind.Keyword,"Exact Ingress event selector fields");
  if(waitMemberField&&inWait&&waitSection==="response")
    return make(["after:"],waitMemberField[2],lineStart+8,
      CompletionItemKind.Keyword,"Paired response boundary Node reference");
  if(waitMemberField&&inWait&&waitSection==="routes")
    return make(["TIMEOUT:"],waitMemberField[2],lineStart+8,
      CompletionItemKind.EnumMember,"Wait-control timeout edge; event acceptance is implicit");

  const waitResponseTarget=/^ {8}after:[ \\t]*([A-Za-z0-9_-]*)$/.exec(prefix);
  if(waitResponseTarget&&inWait&&waitSection==="response"&&
     value.snapshot.completeness==="complete")
    return make(waitResponseTargets(),waitResponseTarget[1],
      offset-waitResponseTarget[1].length,CompletionItemKind.Reference,
      "Declared response-boundary Node on the accepted-event path");

  const waitTimeoutTarget=/^ {8}TIMEOUT:[ \\t]+([A-Za-z0-9_-]*)$/.exec(prefix);
  if(waitTimeoutTarget&&inWait&&waitSection==="routes"&&
     value.snapshot.completeness==="complete")
    return make([...localNodes.filter(id=>id!==nodeId),"FAILED","UNRESOLVED","SAFE_STOPPED"],
      waitTimeoutTarget[1],offset-waitTimeoutTarget[1].length,
      CompletionItemKind.Reference,"Wait timeout target; success terminals are forbidden");

  const waitOutputValue=/^ {8}[A-Za-z][A-Za-z0-9_-]*:[ \\t]*([A-Za-z0-9_.-]*)$/.exec(prefix);
  if(waitOutputValue&&section==="arguments"&&isMap(currentNode)&&
     isMap(currentNode.get("wait",true))){
    const candidate=nodeId+".wait.output";
    return make([candidate],waitOutputValue[1],offset-waitOutputValue[1].length,
      CompletionItemKind.Reference,
      "Normalized request input available only after this Wait occurrence is accepted");
  }

  const memberField=/^ {6}([a-zA-Z]*)$/.exec(prefix);
  if(memberField && inNode && stage){
    const fields=stage==="precondition"||stage==="postcondition"
      ?["predicates:","routes:"]:
      stage==="observation"?["tool:","arguments:","routes:"]:
      ["tool:","script:","arguments:","retryOf:","routes:"];
    return make(fields,memberField[1],lineStart+6,
      CompletionItemKind.Keyword,"Current CA-SL "+stage+" stage fields");
  }

  const routeKey=/^( {8})([A-Z_]*)$/.exec(prefix);
  if(routeKey && inNode && section==="routes" && stage){
    let keys;
    if(stage==="precondition"||stage==="postcondition"){
      keys=["FAIL:","UNKNOWN:"];
      if(finalStage)keys.push("PASS:");
    }else if(stage==="observation"){
      keys=["FAILED:","DENIED:","UNKNOWN:"];
      if(finalStage)keys.push("SUCCEEDED:");
    }else{
      const operation=isMap(currentNode)?currentNode.get("operation",true):null;
      const scriptOperation=isMap(operation)&&operation.has("script");
      keys=scriptOperation?["FAILED:"]:
        ["FAILED:","DENIED:","UNKNOWN:","OUTCOME_UNKNOWN:"];
      if(finalStage)keys.push("SUCCEEDED:");
    }
    return make(keys,routeKey[2],lineStart+8,CompletionItemKind.EnumMember,
      "Outcome key; Tool Owner Effect-specific outcomes require trusted Compiler linking");
  }

  const routeTarget=/^( {8}(PASS|FAIL|UNKNOWN|SUCCEEDED|FAILED|DENIED|NOT_COMMITTED|OUTCOME_UNKNOWN|COMMITTED):\s*)([A-Za-z0-9_-]*)$/.exec(prefix);
  if(routeTarget && inNode && section==="routes" && stage){
    const outcome=routeTarget[2],typed=routeTarget[3];
    const terminals=["SUCCEEDED","FAILED","UNRESOLVED","SAFE_STOPPED"]
      .filter(value=>value!=="SUCCEEDED"||
        (stage==="postcondition"&&outcome==="PASS"&&finalStage));
    // An unresolved Mutation may only stop. Never offer a Node as the
    // target of OUTCOME_UNKNOWN: it would violate frozen §12.7/§22.
    const choices=outcome==="OUTCOME_UNKNOWN"
      ?["UNRESOLVED","SAFE_STOPPED"]:[...localNodes,...terminals];
    return make(choices,typed,offset-typed.length,CompletionItemKind.Reference,
      "Local Node / four terminal statuses; SUCCEEDED only from final Postcondition PASS");
  }

  const script=/^ {6}script:[ \t]*([A-Za-z0-9_./-]*)$/.exec(prefix);
  if(script && inNode && stage==="operation" &&
     value.snapshot.completeness==="complete"){
    const names=value.snapshot.documents
      .filter(item=>/^scripts\/[A-Za-z0-9_.-]+\.py$/.test(item.relativePath))
      .map(item=>item.relativePath);
    return make(names,script[1],offset-script[1].length,
      CompletionItemKind.File,"Package-local Procedure Script");
  }

  const tool=/^ {6}tool:[ \t]*([A-Za-z0-9_:.-]*)$/.exec(prefix);
  if(tool && inNode && (stage==="operation"||stage==="observation")){
    // Only list exact IDs explicitly supplied with the accepted snapshot.
    // These are source hints; membership, Scope and Effect are not inferred.
    const ids=[...new Set((value.snapshot.dependencyOperations??[])
      .filter(item=>typeof item?.dependencyId==="string"&&
        /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(item.dependencyId)&&
        typeof item.id==="string"&&/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(item.id))
      .map(item=>item.dependencyId+"::"+item.id))];
    return make(ids,tool[1],offset-tool[1].length,CompletionItemKind.Reference,
      "Unverified imported reference; Compiler must check exact Owner/Capability");
  }

  return null;
}

connection.onCompletion(params => {
  const uri=params.textDocument.uri;
  const value = packageForUri(uri);
  if (!value || value.analysis.state === "UNAVAILABLE" ||
      !value.analysis.documents.length) return [];
  const document = documentFor(value, uri);
  if (!document || !value.analysis.documents.some(item =>
      item.uri === document.uri && item.version === document.version)) return [];
  const offset = offsetAt(document.text, params.position);
  if (offset === null) return [];
  const starts = lineStarts(document.text);
  const lineStart = starts[params.position.line];
  const prefix = document.text.slice(lineStart, offset);
  const schemaCompletions=schemaArgumentCompletions(
    value.snapshot,document,prefix,offset,lineStart,params.position.line
  );
  if(schemaCompletions!==null)return schemaCompletions;
  const pathCompletions=schemaValuePathCompletions(
    value.snapshot,document,prefix,offset,lineStart,params.position.line
  );
  if(pathCompletions!==null)return pathCompletions;
  const currentCompletions = currentGrammarCompletions(value,document,prefix,offset,lineStart);
  if(currentCompletions!==null)return currentCompletions;

  if (document.relativePath === "assurance/procedure.yaml" &&
      value.analysis.state === "READY" && value.snapshot.completeness === "complete") {
    const index = symbolIndexes.get(value.snapshot.rootUri);
    const hit = skillSymbolAt(index,document.uri,offset) ??
      skillSymbolAt(index,document.uri,offset-1);
    if (hit?.token.type === "skillOperation") {
      const range = hit.token.range;
      const typed = document.text.slice(range.start,offset);
      const editRange = toLspRange(document.text,range);
      return [...projectOperationCatalog(value.snapshot).values()]
        .filter(item => item.reference.startsWith(typed))
        .map(item => ({
          label: item.reference,
          kind: CompletionItemKind.Reference,
          detail: "Tool dependency · " + item.dependencyId,
          ...(editRange ? { textEdit: { range: editRange, newText: item.reference } } : {})
        }));
    }
  }

  if (document.relativePath === "assurance/procedure.yaml" &&
      /^\s*script:\s*[^#]*$/.test(prefix) &&
      value.analysis.state === "READY" &&
      value.snapshot.completeness === "complete") {
    const colon = prefix.indexOf(":");
    const rawValue = prefix.slice(colon + 1);
    const leading = rawValue.length - rawValue.trimStart().length;
    const typed = rawValue.trim();
    const start = lineStart + colon + 1 + leading;
    const editRange = toLspRange(document.text, { start, end: offset });
    return value.snapshot.documents
      .filter(item => /^scripts\/[A-Za-z0-9_.-]+\.py$/.test(item.relativePath) &&
        item.relativePath.startsWith(typed))
      .map(item => ({
        label: item.relativePath,
        kind: CompletionItemKind.File,
        insertText: item.relativePath,
        filterText: item.relativePath,
        ...(editRange ? { textEdit: { range: editRange, newText: item.relativePath } } : {}),
        detail: "Package-local Python script"
      }));
  }

  if (document.languageId === "python" &&
      /^\s*# (?:inputSchema|outputSchema):\s*[^#]*$/.test(prefix) &&
      value.analysis.state === "READY" &&
      value.snapshot.completeness === "complete") {
    const colon = prefix.indexOf(":");
    const rawValue = prefix.slice(colon + 1);
    const leading = rawValue.length - rawValue.trimStart().length;
    const typed = rawValue.trim();
    const start = lineStart + colon + 1 + leading;
    const editRange = toLspRange(document.text, { start, end: offset });
    return schemaTitleCatalog(value.snapshot)
      .filter(item => item.title.startsWith(typed))
      .map(item => ({
        label: item.title,
        kind: CompletionItemKind.Reference,
        insertText: item.title,
        filterText: item.title,
        ...(editRange ? { textEdit: { range: editRange, newText: item.title } } : {}),
        detail: "Schema · " + item.path
      }));
  }
  return [];
});

connection.onNotification(PACKAGE_INVALIDATE_NOTIFICATION, params => {
  const rootUri = params?.rootUri;
  const generation = params?.generation;
  if (typeof rootUri !== "string" || !rootUri.trim() ||
      !Number.isSafeInteger(generation) || generation < 0) return;
  const knownGeneration = requestedGeneration.get(rootUri) ?? -1;
  if (generation > knownGeneration) {
    requestedGeneration.set(rootUri, generation);
    packageAnalyses.delete(rootUri);
    packageSnapshots.delete(rootUri);
    symbolIndexes.delete(rootUri);
    sessions.get(rootUri)?.reset();
    refreshSemanticTokens();
  }
});

connection.onNotification(PACKAGE_SNAPSHOT_NOTIFICATION, async snapshot => {
  if (!snapshot || typeof snapshot !== "object" ||
      typeof snapshot.rootUri !== "string" || !snapshot.rootUri.trim() ||
      !Number.isSafeInteger(snapshot.generation) || snapshot.generation < 0 ||
      !Array.isArray(snapshot.documents)) {
    reportError("Rejected Package snapshot without a valid root URI or generation");
    return;
  }
  const rootUri = snapshot.rootUri;
  const knownGeneration = requestedGeneration.get(rootUri) ?? -1;
  if (snapshot.generation < knownGeneration) return;
  if (snapshot.generation > knownGeneration) {
    requestedGeneration.set(rootUri, snapshot.generation);
    packageAnalyses.delete(rootUri);
    packageSnapshots.delete(rootUri);
    symbolIndexes.delete(rootUri);
  }
  // Publish the exact source snapshot to semantic-token requests immediately.
  // LanguageDiagnosticSession analysis may still be pending or PARTIAL; color
  // projection must not wait for Python indexing or diagnostics completion.
  packageSnapshots.set(rootUri, snapshot);
  // Acknowledge only after the exact source snapshot is queryable. The client
  // uses this signal to refresh Theia semantic tokens; firing the provider as
  // soon as sendNotification() returns can race the Worker message delivery.
  connection.sendNotification(PACKAGE_SNAPSHOT_ACCEPTED_NOTIFICATION, {
    rootUri, generation: snapshot.generation
  });
  let session = sessions.get(rootUri);
  if (!session) {
    session = createSession(rootUri);
    sessions.set(rootUri, session);
  }
  try {
    const result = await session.submit(snapshot);
    if (!result.accepted && result.reason !== "SUPERSEDED" &&
        result.reason !== "STALE_GENERATION" &&
        result.reason !== "STALE_DOCUMENT") {
      // Analysis failure invalidates navigation/diagnostics, not the admitted
      // source snapshot. Semantic coloring is an independent AST projection
      // and must continue to work for an invalid or unqualified Package.
      if(packageSnapshots.get(rootUri)===snapshot){
        packageAnalyses.delete(rootUri);
        symbolIndexes.delete(rootUri);
        refreshSemanticTokens();
      }
      // The session already publishes a generation-scoped UNAVAILABLE
      // status with the exact diagnostic code and reason. Reporting the
      // generic ANALYSIS_UNAVAILABLE as a separate transport error hid that
      // actionable cause and produced a misleading "analysis failed" banner.
      if (result.reason !== "ANALYSIS_UNAVAILABLE")
        reportError("Package analysis rejected: " + result.reason, rootUri, snapshot.generation);
    }
  } catch (error) {
    // An analyzer exception must never remove the current source used by
    // semantic tokens. Also protect a newer generation from a stale failure.
    if(packageSnapshots.get(rootUri)===snapshot){
      packageAnalyses.delete(rootUri);
      symbolIndexes.delete(rootUri);
      refreshSemanticTokens();
    }
    reportError(error?.message ?? error, rootUri, snapshot.generation);
  }
});

connection.onNotification(PACKAGE_CLOSE_NOTIFICATION, params => {
  const rootUri = params?.rootUri;
  if (typeof rootUri !== "string") return;
  const session = sessions.get(rootUri);
  if (session) {
    session.dispose();
    sessions.delete(rootUri);
  }
  packageAnalyses.delete(rootUri);
  packageSnapshots.delete(rootUri);
  symbolIndexes.delete(rootUri);
  requestedGeneration.delete(rootUri);
  refreshSemanticTokens();
});

connection.onShutdown(() => {
  for (const session of sessions.values()) session.dispose();
  sessions.clear();
  packageAnalyses.clear();
  packageSnapshots.clear();
  symbolIndexes.clear();
  requestedGeneration.clear();
});

connection.listen();
