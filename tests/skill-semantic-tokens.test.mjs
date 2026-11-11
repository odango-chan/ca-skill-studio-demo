import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,mkdirSync} from "node:fs";
import {mkdtemp,rm} from "node:fs/promises";
import {join,resolve} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {build} from "esbuild";

const entry=fileURLToPath(new URL("../site/skill-semantic-tokens.mjs",import.meta.url));
const scratchRoot=resolve(process.cwd(),".agent-tmp");
mkdirSync(scratchRoot,{recursive:true});
const scratch=await mkdtemp(join(scratchRoot,"skill-semantic-tokens-"));
const bundlePath=join(scratch,"semantic-tokens.mjs");
let semantic;
try{
  await build({
    entryPoints:[entry],
    outfile:bundlePath,
    bundle:true,
    format:"esm",
    platform:"node",
    target:"node24",
    packages:"external",
    loader:{".yaml":"text"},
    logLevel:"silent"
  });
  semantic=await import(pathToFileURL(bundlePath).href);
}finally{
  await rm(scratch,{recursive:true,force:true});
}

const sampleRoot=new URL("../site/samples/packages/establish-pdu-session/",import.meta.url);
const readSample=path=>readFileSync(new URL(path,sampleRoot),"utf8");
function tokenFor(text,spans,needle,tokenId,from=0){
  const start=text.indexOf(needle,from);
  assert.notEqual(start,-1,"fixture contains "+needle);
  const token=spans.find(item=>item.start<=start&&item.end>=start+needle.length);
  assert.ok(token,"semantic token covers "+needle);
  assert.equal(token.tokenId,tokenId,"semantic identity for "+needle);
  return token;
}
function fakeModel(text,path){
  const starts=[0];
  for(let i=0;i<text.length;i++)if(text[i]==="\n")starts.push(i+1);
  const positionAt=offset=>{
    let low=0,high=starts.length-1;
    while(low<=high){
      const mid=(low+high)>>1;
      if(starts[mid]<=offset)low=mid+1;else high=mid-1;
    }
    const line=Math.max(0,high);
    return {lineNumber:line+1,column:offset-starts[line]+1};
  };
  const offsetAt=({lineNumber,column})=>Math.min(
    text.length,(starts[lineNumber-1]??text.length)+column-1
  );
  return {
    uri:{path:"/"+path},
    getValue:()=>text,
    getValueLength:()=>text.length,
    getPositionAt:positionAt,
    getOffsetAt:offsetAt,
    getLineMaxColumn:lineNumber=>{
      const start=starts[lineNumber-1]??text.length;
      const next=starts[lineNumber]??text.length;
      const line=text.slice(start,next).replace(/\r?\n$/,"");
      return line.length+1;
    }
  };
}

test("catalog IDs become a unique stable Monaco semantic-token legend",()=>{
  const types=semantic.SKILL_SEMANTIC_TOKEN_TYPES;
  assert.equal(types.length,28);
  assert.equal(new Set(types).size,types.length);
  assert.ok(types.includes("caKeywordStructure"));
  assert.ok(types.includes("caReferenceOperation"));
  assert.ok(types.includes("caSymbolCapabilityDefinition"));
  assert.deepEqual(semantic.SKILL_SEMANTIC_TOKEN_MODIFIERS,
    ["declaration","reference","userDefined"]);
});

test("SkillContract source positions distinguish document identity and direct Operation grants",()=>{
  const text=readSample("assurance/contract.yaml");
  const spans=semantic.collectSkillSemanticTokenSpans(text,"assurance/contract.yaml");
  tokenFor(text,spans,"SkillContract","ca.document.kind");
  tokenFor(text,spans,"connectionagent.io/v1alpha1","ca.document.version");
  tokenFor(text,spans,"sbi.udm.sm_data.get","ca.reference.capability");
  assert.equal(spans.some(item=>item.tokenId==="ca.reference.operation"&&
    text.slice(item.start,item.end)==="sbi.udm.sm_data.get"),false,
    "allowedResources values are grants, not Procedure call references");
  assert.ok(spans.some(item=>item.tokenId==="ca.keyword.structure"&&
    text.slice(item.start,item.end)==="allowedResources"),
    "Contract structural keys: "+JSON.stringify(spans.filter(item=>item.tokenId.startsWith("ca.keyword")).map(item=>text.slice(item.start,item.end))));
});

test("Procedure AST selectors distinguish definitions, references, keywords and values",()=>{
  const text=readSample("assurance/procedure.yaml");
  const spans=semantic.collectSkillSemanticTokenSpans(text,"assurance/procedure.yaml");
  tokenFor(text,spans,"ue-requested-pdu-session-establishment","ca.symbol.procedure-definition");
  tokenFor(text,spans,"nudm-sdm-get","ca.reference.node");
  const nodeKey=/^      nudm-sdm-get:/m.exec(text);
  assert.ok(nodeKey);
  tokenFor(text,spans,"nudm-sdm-get","ca.symbol.node-definition",nodeKey.index);
  tokenFor(text,spans,"sbi.udm.sm_data.get","ca.reference.operation");
  tokenFor(text,spans,"call","ca.keyword.control");
  tokenFor(text,spans,"with","ca.keyword.binding");
  tokenFor(text,spans,"from","ca.keyword.binding");
  tokenFor(text,spans,"string","ca.value.type");
  tokenFor(text,spans,"context.subject.ueRef","ca.reference.binding-path");
  tokenFor(text,spans,"createdsession.ingress.eligible","ca.reference.predicate");
  tokenFor(text,spans,"PASS","ca.value.outcome");
  assert.ok(spans.some(item=>item.tokenId==="ca.identifier.user-defined"&&
    text.slice(item.start,item.end)==="ue-ref"));
});

test("PredicateSet selectors classify Predicate definitions and CEL expressions",()=>{
  const text=readSample("assurance/predicates.yaml");
  const spans=semantic.collectSkillSemanticTokenSpans(text,"assurance/predicates.yaml");
  tokenFor(text,spans,"PredicateSet","ca.document.kind");
  tokenFor(text,spans,"createdsession.ingress.eligible","ca.symbol.predicate-definition");
  tokenFor(text,spans,"observations.state.requestType == request.requestType","ca.expression.cel");
});

test("frontmatter and governed Python metadata use the same catalog identities",()=>{
  const markdown=readSample("SKILL.md");
  const markdownSpans=semantic.collectSkillSemanticTokenSpans(markdown,"SKILL.md");
  tokenFor(markdown,markdownSpans,"establish-pdu-session","ca.symbol.skill-definition");
  const python=readSample("scripts/evaluate_transfer_start.py");
  const pythonSpans=semantic.collectSkillSemanticTokenSpans(python,"scripts/evaluate_transfer_start.py");
  tokenFor(python,pythonSpans,"evaluate-transfer-start","ca.symbol.local-tool-definition");
  tokenFor(python,pythonSpans,"local_compute","ca.value.effect");
});

test("optional imported CapabilityContracts and ToolCatalog definitions are navigable",()=>{
  const capability=`apiVersion: ca-agent-host.capability-contracts/v1
kind: CapabilityContracts
spec:
  capabilities:
    - capability: pdu-session-management
      owner: 5gc
      operations:
        - operation: sbi.udm.sm_data.get
          effect: read
`;
  const capSpans=semantic.collectSkillSemanticTokenSpans(
    capability,"lib/capabilities/pdu-session.yaml");
  tokenFor(capability,capSpans,"pdu-session-management","ca.symbol.capability-definition");
  const tools=`apiVersion: connectionagent.io/v1alpha1
kind: ToolCatalog
spec:
  contracts:
    - operation: sbi.udm.sm_data.get
      effect: READ
`;
  const toolSpans=semantic.collectSkillSemanticTokenSpans(tools,"lib/tools/tools.yaml");
  tokenFor(tools,toolSpans,"sbi.udm.sm_data.get","ca.symbol.operation-definition");
  tokenFor(tools,toolSpans,"READ","ca.value.effect");
});

test("documented-but-unverified forms are not promoted to current semantic keywords",()=>{
  const text=`procedures:
  example:
    nodes:
      action:
        tool: skill.some-tool
        procedure: child-procedure
        for: item in items
        when: request.enabled
`;
  const spans=semantic.collectSkillSemanticTokenSpans(text,"assurance/procedure.yaml");
  for(const needle of ["tool","procedure","for","when"]){
    const start=text.indexOf(needle+":");
    const token=spans.find(item=>item.start<=start&&item.end>=start+needle.length);
    assert.equal(token,undefined,
      needle+" remains outside the current keyword contract");
  }
});

test("semantic-token encoding follows Monaco's five-integer delta format",()=>{
  const text=readSample("assurance/contract.yaml");
  const model=fakeModel(text,"skills/establish-pdu-session/assurance/contract.yaml");
  const spans=semantic.collectSkillSemanticTokenSpans(text,model.uri.path);
  const data=semantic.encodeSkillSemanticTokens(model,spans);
  assert.ok(data instanceof Uint32Array);
  assert.equal(data.length%5,0);
  assert.ok(data.length>0);
  let line=0,character=0;
  for(let i=0;i<data.length;i+=5){
    const deltaLine=data[i],deltaCharacter=data[i+1];
    line+=deltaLine;
    character=deltaLine===0?character+deltaCharacter:deltaCharacter;
    assert.ok(data[i+2]>0,"token length must be positive");
    assert.ok(data[i+3]<semantic.SKILL_SEMANTIC_TOKEN_TYPES.length,"token type index is in legend");
    assert.ok(line<text.split("\n").length,"token line is in document");
  }
});

test("Monaco registers one shared provider for YAML, Markdown and Python",()=>{
  const registrations=[];
  const monaco={
    languages:{
      registerDocumentSemanticTokensProvider(language,provider){
        registrations.push({language,provider});
        return {dispose(){}};
      }
    }
  };
  const first=semantic.registerSkillSemanticTokens(monaco);
  const second=semantic.registerSkillSemanticTokens(monaco);
  assert.equal(first,second,"registration is idempotent");
  assert.deepEqual(registrations.map(item=>item.language),["yaml","markdown","python"]);
  const legend=registrations[0].provider.getLegend();
  assert.deepEqual(legend.tokenTypes,semantic.SKILL_SEMANTIC_TOKEN_TYPES);
  assert.deepEqual(legend.tokenModifiers,semantic.SKILL_SEMANTIC_TOKEN_MODIFIERS);
  const text=readSample("assurance/contract.yaml");
  const response=registrations[0].provider.provideDocumentSemanticTokens(
    fakeModel(text,"skills/establish-pdu-session/assurance/contract.yaml"),
    null,{isCancellationRequested:false});
  assert.ok(response.data.length>0,"registered provider emits semantic token data");
  first.dispose();
});

test("online and installed Studio Light themes expose every CA semantic token color",()=>{
  const theme=JSON.parse(readFileSync(new URL(
    "../extensions/skill-studio-theme/themes/skill-studio-light-color-theme.json",
    import.meta.url
  ),"utf8"));
  assert.equal(theme.semanticHighlighting,true);
  for(const type of semantic.SKILL_SEMANTIC_TOKEN_TYPES){
    assert.ok(theme.semanticTokenColors[type],type+" has a Studio Light color");
  }
  const backend=readFileSync(new URL("../site/monaco-source-backend.mjs",import.meta.url),"utf8");
  assert.match(backend,/registerSkillSemanticTokens\(monaco\)/);
  assert.match(backend,/semanticHighlighting:studioLightTheme\.semanticHighlighting===true/);
  assert.match(backend,/"semanticHighlighting\.enabled":true/,
    "Monaco standalone must explicitly enable semantic highlighting");
});
