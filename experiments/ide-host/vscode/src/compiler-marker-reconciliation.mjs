/**
 * Display-level projection of Compiler diagnostics against the accepted,
 * current-language LSP markers. Both producers retain independent ownership.
 *
 * Source positions are 1-based here (Compiler) and 0-based in VS Code marker
 * ranges. We never guess a source location or conflate NOT_CHECKED/BLOCKED
 * trust results with a Compiler-confirmed error.
 */
const uriString=value=>typeof value==="string"?value:
  typeof value?.toString==="function"?value.toString():null;
const markerCode=value=>typeof value==="string"?value:
  typeof value?.value==="string"?value.value:null;

export function compilerMarkerShadowed(item,localMarkers=[],acceptedFindings=[]){
  if(item?.locationKind!=="source"||item.status!=="confirmed"||
     !Number.isSafeInteger(item.line)||item.line<1||
     !Number.isSafeInteger(item.column)||item.column<1||
     !item.uri||typeof item.code!=="string"||!item.code)return false;
  const uri=uriString(item.uri);
  if(!uri)return false;
  // Only current-Language-Service findings known to be confirmed may hide
  // a Compiler-owned marker. If the same code/line also has unresolved trust
  // findings, retain both rather than pretending they have one identity.
  const sameLine=acceptedFindings.filter(finding=>
    markerCode(finding.code)===item.code&&
    uriString(finding.uri)===uri&&finding.line===item.line);
  if(!sameLine.length||sameLine.some(finding=>
    finding.status!=="confirmed"&&
    !(finding.status==null&&finding.source==="procedure-projection")))return false;
  if(!sameLine.some(finding=>finding.severity===item.severity))return false;
  return localMarkers.some(marker=>{
    const source=String(marker?.source??"");
    return source.startsWith("Skill Studio · ")&&
      markerCode(marker.code)===item.code&&
      marker.severity===(item.severity==="warning"?1:0)&&
      marker.range?.start?.line===item.line-1&&
      marker.range?.start?.character===item.column-1;
  });
}

/** A stable signature avoids onDidChangeDiagnostics feedback loops. */
export function compilerMarkerSignature(items){
  return JSON.stringify(items.map(item=>[
    item.code,item.message,item.severity,item.line,item.column,item.uri
  ]));
}
