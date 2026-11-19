import {auditPackage} from "./package-audit.mjs";

// Studio regression fixtures, NOT CA-SL source syntax or Runtime qualification.
// PASS means an expected diagnostic was detected on a synthetic in-memory
// mutation. It never means the Skill can be compiled, authorized or executed.
export const DIAGNOSTIC_TEST_SUITE_VERSION="skill-studio-diagnostic-regression/v1";

export const DIAGNOSTIC_TEST_CASES=Object.freeze([
  {id:"syntax-invalid-yaml",domain:"source",label:"Malformed Contract YAML is detected",
    code:"PACKAGE_YAML_PARSE_ERROR",status:"confirmed",severity:"error"},
  {id:"missing-request-schema",domain:"schemas",label:"Missing local Request Schema is detected",
    code:"REQUEST_SCHEMA_NOT_FOUND",status:"confirmed",severity:"error"},
  {id:"partial-inventory",domain:"package",label:"Partial inventory does not invent missing Schema",
    code:"REQUEST_SCHEMA_NOT_CHECKED",status:"not_checked",severity:"warning"},
  {id:"project-dependency-unconfigured",domain:"dependencies",label:"Unconfigured project dependency is detected",
    code:"DEPENDENCY_NOT_CONFIGURED",status:"confirmed",severity:"error"},
  {id:"capability-grant-duplicate",domain:"capabilities",label:"Duplicate Capability Grant is detected",
    code:"CAPABILITY_GRANT_DUPLICATE",status:"confirmed",severity:"error"},
  {id:"capability-owner-unavailable",domain:"capabilities",label:"Unavailable trusted CapabilityContracts stays NOT_CHECKED",
    code:"CAPABILITY_GRANT_NOT_CHECKED",status:"not_checked",severity:"warning"},
  {id:"unknown-tool-alias",domain:"tools",label:"Undeclared Tool alias is detected",
    code:"TOOL_DEPENDENCY_UNDECLARED",status:"confirmed",severity:"error"},
  {id:"unknown-predicate",domain:"predicates",label:"Undeclared Predicate reference is detected",
    code:"PREDICATE_REFERENCE_NOT_FOUND",status:"confirmed",severity:"error"},
  {id:"missing-predicate-script",domain:"predicates",label:"Missing Predicate evaluator Script is detected",
    code:"PREDICATE_SCRIPT_NOT_FOUND",status:"confirmed",severity:"error"},
  {id:"missing-producer-node",domain:"procedure",label:"Unknown producer Node is detected",
    code:"PRODUCER_NODE_NOT_FOUND",status:"confirmed",severity:"error"},
  {id:"evidence-owner-unavailable",domain:"evidence",label:"Unavailable trusted Evidence Owner stays NOT_CHECKED",
    code:"EVIDENCE_GUARANTEE_NOT_CHECKED",status:"not_checked",severity:"warning"}
].map(item=>Object.freeze(item)));

const byId=new Map(DIAGNOSTIC_TEST_CASES.map(item=>[item.id,item]));
const CONTRACT="assurance/contract.yaml";
const PROCEDURE="assurance/procedure.yaml";
const PREDICATES="assurance/predicates.yaml";
const REQUIRED=[CONTRACT,PROCEDURE,PREDICATES];

function clonePackage(files){
  if(!(files instanceof Map))return null;
  const copy=new Map();
  for(const [path,item] of files){
    if(typeof path!=="string"||typeof item?.text!=="string")return null;
    copy.set(path,{text:item.text});
  }
  return copy;
}
function replaceExact(files,path,search,replacement){
  const item=files.get(path);
  if(!item)return false;
  const match=typeof search==="string"?item.text.indexOf(search)>=0:search.test(item.text);
  if(!match)return false;
  item.text=item.text.replace(search,replacement);
  return true;
}
function firstSchemaFile(files){
  const match=/^requestSchema:\s*([^\s#]+)/m.exec(files.get(CONTRACT)?.text??"");
  return match?.[1]??null;
}
function setupCase(id,files){
  let completeness="complete";
  let dependencyContext={available:false,reason:"Synthetic fixture: no trusted Owner input"};
  const contract=files.get(CONTRACT)?.text??"";
  switch(id){
    case "syntax-invalid-yaml":
      files.get(CONTRACT).text="invalid: [unterminated\n"+contract;
      break;
    case "missing-request-schema":{
      const schema=firstSchemaFile(files);
      if(!schema||!files.delete(schema))return null;
      break;
    }
    case "partial-inventory":{
      const schema=firstSchemaFile(files);
      if(!schema||!files.delete(schema))return null;
      completeness="partial";
      break;
    }
    case "project-dependency-unconfigured":
      dependencyContext={available:true,declarations:[],snapshots:[],diagnostics:[]};
      break;
    case "capability-grant-duplicate":{
      const grant=/^([ \t]*-\s+urn:[^\r\n]+)/m.exec(contract)?.[1];
      if(!grant||!replaceExact(files,CONTRACT,grant,grant+"\n"+grant))return null;
      break;
    }
    case "capability-owner-unavailable":
    case "evidence-owner-unavailable":
      break;
    case "unknown-tool-alias":
      if(!replaceExact(files,PROCEDURE,/(tool:\s+)ca::([^\s#]+)/,
        (_all,prefix,id)=>prefix+"nonexistent::"+id))return null;
      break;
    case "unknown-predicate":
      if(!replaceExact(files,PROCEDURE,/(predicate:\s+)([^\s#]+)/,
        (_all,prefix)=>prefix+"unknown.predicate"))return null;
      break;
    case "missing-predicate-script":{
      const scripts=[...files.keys()].filter(path=>path.startsWith("scripts/"));
      const predicateSource=files.get(PREDICATES)?.text??"";
      const referenced=scripts.find(path=>predicateSource.includes(path));
      if(!referenced||!files.delete(referenced))return null;
      break;
    }
    case "missing-producer-node":
      if(!replaceExact(files,PROCEDURE,
        /([a-z][a-z0-9-]*)\.(operation|observation)\.output\.([a-zA-Z][\w.]*)/,
        (_all,_node,stage,field)=>"nonexistent-producer."+stage+".output."+field))
        return null;
      break;
    default:throw new Error("Unknown diagnostic test case: "+id);
  }
  return {dependencyContext,completeness};
}

/**
 * Execute one read-only regression case against a supplied in-memory Package.
 * A case with no suitable source anchor is NOT_RUN, never counted as PASS.
 */
export function runDiagnosticRegressionCase(id,{files}={}){
  const test=byId.get(id);
  if(!test)throw new Error("Unknown Studio diagnostic test: "+String(id));
  const notRun=reason=>Object.freeze({
    id,domain:test.domain,label:test.label,expectedCode:test.code,
    status:"NOT_RUN",reason,diagnostic:null,safety:"IN_MEMORY_STATIC_ONLY"
  });
  const copy=clonePackage(files);
  if(!copy||REQUIRED.some(path=>!copy.has(path)))
    return notRun("Complete current CA-SL Contract/Procedure/PredicateSet source is unavailable");
  let setup;
  try{setup=setupCase(id,copy);}
  catch(error){return notRun("Fixture setup was not applicable: "+String(error?.message??error));}
  if(!setup)return notRun("The current Package has no matching source anchor for this regression fixture");
  const diagnostics=auditPackage({
    files:copy,dependencyContext:setup.dependencyContext,
    completeness:setup.completeness,
    snapshotReason:setup.completeness==="partial"?"Synthetic missing Schema":""
  });
  const matched=diagnostics.find(item=>
    item.code===test.code&&item.status===test.status&&
    item.severity===test.severity&&item.line>0&&item.column>0);
  // A deliberately partial source inventory must NOT make a confirmed
  // nonexistent-file claim; this is a positive assertion about the boundary.
  const falseMissing=id==="partial-inventory"&&
    diagnostics.some(item=>item.code==="REQUEST_SCHEMA_NOT_FOUND");
  const success=Boolean(matched)&&!falseMissing;
  return Object.freeze({
    id,domain:test.domain,label:test.label,expectedCode:test.code,
    status:success?"PASS":"FAIL",
    reason:success?"Expected diagnostic observed in the synthetic fixture":
      "Expected diagnostic absent or a false confirmed missing-file result was emitted",
    diagnostic:matched?Object.freeze({
      code:matched.code,status:matched.status,severity:matched.severity,
      path:matched.path,line:matched.line,column:matched.column
    }):null,
    safety:"IN_MEMORY_STATIC_ONLY"
  });
}

export function runDiagnosticRegressionSuite({files,include}={}){
  const ids=include??DIAGNOSTIC_TEST_CASES.map(item=>item.id);
  if(!Array.isArray(ids)||ids.some(id=>!byId.has(id))||
     new Set(ids).size!==ids.length)
    throw new Error("Invalid diagnostic regression test selection");
  const results=ids.map(id=>runDiagnosticRegressionCase(id,{files}));
  const summary={
    PASS:results.filter(item=>item.status==="PASS").length,
    FAIL:results.filter(item=>item.status==="FAIL").length,
    NOT_RUN:results.filter(item=>item.status==="NOT_RUN").length
  };
  return Object.freeze({
    apiVersion:DIAGNOSTIC_TEST_SUITE_VERSION,
    qualification:"NOT_QUALIFIED",
    scope:"STUDIO_DIAGNOSTIC_REGRESSION_ONLY",
    summary:Object.freeze(summary),
    results:Object.freeze(results)
  });
}
