/**
 * Reconcile the native Problems tree, not the underlying diagnostic streams.
 * Package Audit/LSP and Compiler retain their independent ownership/lifecycle.
 *
 * Two producers may describe the same *confirmed* finding differently. Only
 * identical canonical codes at the same real source URI and 1-based position
 * with the same status are eligible for cross-producer reconciliation. A
 * coincident line, a guessed source path, or a similar English message is not
 * proof that two findings share identity.
 */
function originOf(item){
  if(item.kind==="compiler-diagnostic")return "Compiler";
  if(item.source==="procedure-projection")return "Source";
  if(item.source==="package-audit"||
     item.source==="Skill Studio · Package Audit")return "Package Audit";
  return item.source??item.kind??"Unknown";
}

function locationKey(item){
  const raw=item.uri;
  const uri=typeof raw==="string"?raw:
    typeof raw?.toString==="function"?raw.toString():null;
  if(typeof uri!=="string"||
     !/^[a-z][a-z0-9+.-]*:/i.test(uri)||
     typeof item.code!=="string"||!item.code||
     !Number.isSafeInteger(item.line)||item.line<1||
     !Number.isSafeInteger(item.column)||item.column<1||
     typeof item.status!=="string"||!item.status)
    return null;
  // Use JSON to encode tuple boundaries: URI, code and status can contain
  // punctuation without creating accidental collisions.
  return JSON.stringify([item.code,uri,item.line,item.column,item.status]);
}

function priority(item){
  if(item.kind==="compiler-diagnostic")return 3;
  if(item.kind==="package-diagnostic")return 2;
  return 1;
}

/**
 * @returns {Array<{diagnostic: object, sources: string[]}>}
 * Every merged row retains the preferred authoritative diagnostic and a
 * readable list of contributing producers for the tooltip.
 */
export function reconcileProblemDiagnostics(diagnostics){
  const rows=[],byLocation=new Map();
  for(const item of diagnostics){
    const key=locationKey(item);
    const origin=originOf(item);
    const matches=key===null?[]:(byLocation.get(key)??[]);
    // A producer reporting two different messages at one position may have
    // two distinct findings. Never conflate them within that producer.
    const match=matches.find(index=>{
      const row=rows[index];
      return !row.origins.includes(origin)||
        row.diagnostic.message===item.message;
    });
    if(match!==undefined){
      const row=rows[match];
      if(!row.origins.includes(origin))row.origins.push(origin);
      if(priority(item)>priority(row.diagnostic))row.diagnostic=item;
      continue;
    }
    const index=rows.length;
    rows.push({diagnostic:item,origins:[origin]});
    if(key!==null){
      if(!byLocation.has(key))byLocation.set(key,[]);
      byLocation.get(key).push(index);
    }
  }
  return rows.map(row=>({
    diagnostic:row.diagnostic,sources:[...row.origins]
  }));
}
