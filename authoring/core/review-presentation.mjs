/**
 * Host-owned, display-only review projections for the AI Authoring Editor Tab.
 * These never create source edits, trust model-supplied offsets, or qualify a
 * candidate. Compiler and Patch Engine remain the only authoritative gates.
 */
const DEFAULT_DIFF_LIMIT = 1400;
const MAX_LCS_CELLS = 120000;

function sourceLines(source) {
  if (typeof source !== "string") throw new TypeError("Source must be text");
  return source.split(/\r\n|\n|\r/);
}

/**
 * Produce exact source-line classifications from the Host's base and
 * Patch-Engine-generated candidate, with bounded rendering. For large
 * replacements, conservatively show deletions and insertions rather than
 * claiming matches. The full original and candidate remain separately
 * available in the Editor Tab's source disclosure.
 */
export function createAuthoringLineDiff(before, after, { maxRows = DEFAULT_DIFF_LIMIT } = {}) {
  const a = sourceLines(before), b = sourceLines(after);
  if (!Number.isSafeInteger(maxRows) || maxRows < 20 || maxRows > 5000) {
    throw new RangeError("Diff display limit must be between 20 and 5000 rows");
  }
  const rows = [];
  let leftLine = 1, rightLine = 1, added = 0, removed = 0;
  const keep = text => { rows.push({ kind:"context", beforeLine:leftLine++, afterLine:rightLine++, text }); };
  const del = text => { rows.push({ kind:"removed", beforeLine:leftLine++, text }); removed++; };
  const add = text => { rows.push({ kind:"added", afterLine:rightLine++, text }); added++; };
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < a.length-prefix && suffix < b.length-prefix &&
    a[a.length-suffix-1] === b[b.length-suffix-1]) suffix++;
  for (let i=0;i<prefix;i++) keep(a[i]);
  const left=a.slice(prefix,a.length-suffix), right=b.slice(prefix,b.length-suffix);
  if (left.length*right.length <= MAX_LCS_CELLS) {
    const dp = Array.from({length:left.length+1},()=>new Uint32Array(right.length+1));
    for (let i=left.length-1;i>=0;i--) for (let j=right.length-1;j>=0;j--) {
      dp[i][j] = left[i]===right[j] ? 1+dp[i+1][j+1] : Math.max(dp[i+1][j],dp[i][j+1]);
    }
    let i=0,j=0;
    while(i<left.length||j<right.length) {
      if(i<left.length&&j<right.length&&left[i]===right[j]){keep(left[i]);i++;j++;}
      else if(i<left.length&&(j===right.length||dp[i+1][j]>=dp[i][j+1]))del(left[i++]);
      else add(right[j++]);
    }
  } else {
    for(const text of left)del(text);
    for(const text of right)add(text);
  }
  for(let i=a.length-suffix;i<a.length;i++)keep(a[i]);
  const normalizedEqual = added===0 && removed===0;
  const lineEndingsOnly = before!==after && normalizedEqual;
  const unchangedWindow = 3;
  const collapsed = [];
  for(let i=0;i<rows.length;) {
    if(rows[i].kind!=="context"){collapsed.push(rows[i++]);continue;}
    let j=i;
    while(j<rows.length&&rows[j].kind==="context")j++;
    const count=j-i;
    if(count>unchangedWindow*2+1){
      collapsed.push(...rows.slice(i,i+unchangedWindow));
      collapsed.push({kind:"omitted",count:count-unchangedWindow*2});
      collapsed.push(...rows.slice(j-unchangedWindow,j));
    } else collapsed.push(...rows.slice(i,j));
    i=j;
  }
  const truncated=collapsed.length>maxRows;
  const rendered=truncated
    ? [...collapsed.slice(0,Math.floor(maxRows/2)),
       {kind:"omitted",count:Math.max(0,collapsed.length-maxRows),truncated:true},
       ...collapsed.slice(-Math.ceil(maxRows/2))]
    : collapsed;
  return Object.freeze({
    rows:rendered.map(row=>Object.freeze(row)),
    added,removed,truncated,lineEndingsOnly,
    changed:before!==after,
  });
}

/**
 * Only operations belonging to the Patch Engine's planned atomic groups may
 * appear in the Flow Changes read-only outline. Model references are proposals,
 * not independent evidence or verified Runtime identities.
 */
export function createAuthoringFlowChanges(changeSet, patchPlan) {
  if (!patchPlan?.groups || !Array.isArray(changeSet?.operations)) return [];
  const byId=new Map(changeSet.operations.map(op=>[op.id,op]));
  return patchPlan.groups.map(group=>Object.freeze({
    id:group.id,
    label:group.label,
    operations:(group.operationIds??[]).map(id=>{
      const op=byId.get(id);
      if(!op)throw new Error("Patch group referenced an unknown operation");
      const t=op.target??{},p=op.payload??{};
      return Object.freeze({
        id:op.id,
        type:op.type,
        nodeId:typeof t.nodeId==="string"?t.nodeId:"",
        stage:typeof t.stage==="string"?t.stage:"",
        outcome:typeof t.outcome==="string"?t.outcome:"",
        toNodeId:typeof p.targetNodeId==="string"?p.targetNodeId:
          typeof p.after==="string"?p.after:"",
        rationale:op.rationale??"",
        references:Array.isArray(op.references)?op.references.slice(0,16):[],
      });
    }),
  }));
}

export function createAuthoringValidationView(compilerCheck, candidateDigest) {
  const diagnostics=Array.isArray(compilerCheck?.diagnostics)?compilerCheck.diagnostics:[];
  return Object.freeze({
    state:compilerCheck?.state??"NOT_RUN",
    compilerVersion:compilerCheck?.compilerVersion??"",
    candidateDigest:typeof candidateDigest==="string"?candidateDigest:"",
    errorCount:compilerCheck?.errorCount??diagnostics.filter(x=>x?.severity==="error").length,
    warningCount:compilerCheck?.warningCount??diagnostics.filter(x=>x?.severity==="warning").length,
    diagnostics:diagnostics.slice(0,100).map(x=>Object.freeze({
      severity:typeof x?.severity==="string"?x.severity:"unknown",
      code:typeof x?.code==="string"?x.code:"",
      message:typeof x?.message==="string"?x.message:"",
      path:typeof x?.path==="string"?x.path:"",
      line:Number.isSafeInteger(x?.line)?x.line:null,
    })),
    diagnosticsTruncated:diagnostics.length>100,
  });
}
