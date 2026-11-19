// Current CA-SL Procedure projection adapter for host modules that need a
// minimal Procedure lookup. There is no historical grammar fallback here.
import {analyzeCurrentSource} from "../language/core/source.ts";

export function projectWorkspace(text){
  if(typeof text!=="string"||text.length>1024*1024){
    return {state:"UNAVAILABLE",entry:null,procedures:new Map(),procedure:null,
      diagnostics:[{code:"PROCEDURE_SOURCE_INVALID",
        message:"Procedure Source must be bounded text",line:1}]};
  }
  const documents=new Map([["assurance/procedure.yaml",{
    uri:"file:///current-package/assurance/procedure.yaml",
    relativePath:"assurance/procedure.yaml",version:0,text
  }]]);
  const analysis=analyzeCurrentSource(documents,"skill");
  const projection=analysis.procedure;
  if(projection.state!=="READY"||!projection.procedures.length){
    return {state:"UNAVAILABLE",entry:null,procedures:new Map(),procedure:null,
      diagnostics:analysis.diagnostics};
  }
  const procedure=projection.procedures[0];
  return {
    state:"READY",entry:procedure.name,
    procedures:new Map([[procedure.name,procedure]]),
    procedure,diagnostics:analysis.diagnostics
  };
}
