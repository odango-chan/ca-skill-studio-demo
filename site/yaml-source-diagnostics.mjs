// E2-A1: grammar-only diagnostics. This is NOT Runtime qualification or
// Toolchain procedure-schema validation. The owner procedure-source schema
// pinned in ca-agent-demo@7570b309 does not yet cover Phase pre/postconditions.
// Enabling it for establish-pdu-session/procedure.yaml would reject valid input.
import {LineCounter,parseDocument} from "yaml";

const MAX_BYTES=1024*1024,MAX_ERRORS=20;
export const OWNER_SCHEMA_PIN=Object.freeze({
  skillRepo:"odango-chan/ca-agent-demo",
  skillCommit:"7570b309a998580a6952352e2bf4b1c19e5c710d",
  schemaRepository:"odango-chan/ca-skill-toolchain",
  schemaSnapshot:"03a42764ee2a67e39f57ab550b63c7a5d7966199"
});

export function yamlSchemaCapability(path="") {
  if(!/\.ya?ml$/i.test(path))return "not-yaml";
  // Contract/Predicates are candidates only; do not claim a schema is
  // attached until pinned source and all external refs are verified.
  if(path==="assurance/contract.yaml"||path==="assurance/predicates.yaml")
    return "schema-candidate-not-attached";
  if(path==="assurance/procedure.yaml")return "procedure-schema-incompatible";
  return "syntax-only";
}

function marker(message,start,end,counter){
  const a=counter.linePos(start)||{line:1,col:1};
  const b=counter.linePos(Math.max(start+1,end))||a;
  return {
    severity:"error",source:"Studio YAML syntax",
    message:String(message),
    startLineNumber:a.line,startColumn:a.col,
    endLineNumber:b.line,endColumn:Math.max(1,b.col)
  };
}

// Parsing never reformats, serializes or mutates the supplied Source string.
// YAML 1.2 stringKeys=true is deliberately consistent with Studio projection:
// an unquoted 'on' is a string key, not a YAML 1.1 boolean.
export function diagnoseYamlSyntax(path,text){
  if(typeof text!=="string")throw new TypeError("YAML Source must be text");
  if(!/\.ya?ml$/i.test(path))return [];
  // Match the existing Studio editor cap. Large documents are refused by
  // projection, and we do not run an unbounded parse on the input thread.
  if(text.length>MAX_BYTES||text.split(/\r\n|\n|\r/).length>20000)return [];
  const counter=new LineCounter();
  try{
    const doc=parseDocument(text,{
      version:"1.2",schema:"core",uniqueKeys:true,stringKeys:true,
      strict:true,lineCounter:counter,logLevel:"silent"
    });
    return doc.errors.slice(0,MAX_ERRORS).map(error=>{
      const pos=error.pos||[0,0];
      return marker(error.message,pos[0]??0,pos[1]??pos[0]??0,counter);
    });
  }catch(error){
    return [marker(String(error?.message??error),0,1,counter)];
  }
}
