// Pure projection of authoritative Compiler Diagnostic[] into editor/Problems
// coordinates. This module does not compile, link, qualify Owners or infer
// missing source locations. CA-SL v1alpha5's Compiler v2.0.0 and the historical
// v1alpha4 Compiler share these semantic fields (severity/phase/path/position).
const VALID_SEVERITIES=new Set(["error","warning"]);
const VALID_PHASES=new Set(["C_STATIC","C_WARNING"]);
const PACKAGE_NAME=/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const encoder=new TextEncoder();

function sourceRelativePath(packageName,path){
  const prefix="skills/"+packageName+"/";
  if(!path.startsWith(prefix))return null;
  const relative=path.slice(prefix.length);
  if(!relative||encoder.encode(path).length>240||
     path!==path.normalize("NFC")||relative.includes("\\")||
     /[\u0000-\u001f\u007f:]/.test(relative)||
     relative.split("/").some(segment=>!segment||segment==="."||segment===".."))
    return null;
  return relative;
}

/**
 * Turn the Compiler's JSON diagnostic envelope into immutable, stable
 * source/file/request-level Problems. Only a fully grounded 1-based line and
 * column may create an editor range; missing coordinates never become line 1.
 *
 * requirePhase=true is intended for Compiler v2.0.0 (v1alpha5), whose public
 * Diagnostic envelope requires phase. The existing released v1alpha4 adapter
 * is permitted to omit phase without rewriting its diagnostics.
 */
export function normalizeCompilerDiagnostics(items,{packageName,requirePhase=false}={}){
  if(!PACKAGE_NAME.test(packageName??""))
    throw new Error("Compiler diagnostic projection requires a selected Skill package name");
  if(!Array.isArray(items)||items.length>2048)
    throw new Error("Compiler diagnostics must be a bounded Diagnostic[]");
  const result=[];
  const seen=new Set();
  for(const [index,item] of items.entries()){
    if(!item||typeof item!=="object"||Array.isArray(item)||
       !VALID_SEVERITIES.has(item.severity)||
       typeof item.code!=="string"||!item.code||item.code.length>120||
       typeof item.message!=="string"||!item.message||item.message.length>8192||
       typeof item.path!=="string"||encoder.encode(item.path).length>240)
      throw new Error("Malformed Compiler diagnostic envelope at index "+index);
    if(requirePhase&&item.phase==null)
      throw new Error("Compiler diagnostic phase is required at index "+index);
    if(item.phase!=null){
      if(!VALID_PHASES.has(item.phase)||
         (item.phase==="C_STATIC"&&item.severity!=="error")||
         (item.phase==="C_WARNING"&&item.severity!=="warning"))
        throw new Error("Compiler diagnostic phase/severity mismatch at index "+index);
    }
    for(const key of ["line","column"]){
      if(item[key]!=null&&(!Number.isSafeInteger(item[key])||item[key]<1))
        throw new Error("Invalid Compiler diagnostic "+key+" at index "+index);
    }
    const relative=sourceRelativePath(packageName,item.path);
    const hasRange=relative!==null&&Number.isSafeInteger(item.line)&&
      Number.isSafeInteger(item.column);
    const locationKind=hasRange?"source":relative!==null?"file":"request";
    const problem={
      kind:"compiler-diagnostic",code:item.code,message:item.message,
      severity:item.severity,phase:item.phase??null,status:"confirmed",
      domain:"compiler",category:"static",path:item.path,
      sourcePath:relative,locationKind,
      line:hasRange?item.line:null,column:hasRange?item.column:null
    };
    const key=[problem.code,problem.path,problem.line??0,problem.column??0,
      problem.message].join("\u001f");
    if(seen.has(key))continue;
    seen.add(key);
    result.push(Object.freeze(problem));
  }
  return Object.freeze(result);
}
