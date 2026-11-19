/**
 * Version gate for explicitly requested Compiler Check/Build results.
 *
 * Each Package has an independent monotonically increasing revision. Source
 * changes and newer requests supersede in-flight results. The Compiler cannot
 * push source-invalidated diagnostics back into the Problems tree.
 *
 * This does not qualify a Skill or replace the Language Service generation.
 */
export function createCompilerResultGate(){
  const revisions=new Map();
  function keyOf(root){
    if(typeof root!=="string"||!root)throw Error("Compiler Package identity is required");
    return root;
  }
  const current=root=>revisions.get(keyOf(root))??0;
  const advance=root=>{
    const key=keyOf(root),next=current(key)+1;
    if(!Number.isSafeInteger(next))throw Error("Compiler revision overflow");
    revisions.set(key,next);
    return next;
  };
  const isCurrent=(root,revision)=>
    Number.isSafeInteger(revision)&&revision===current(root);
  const invalidateAll=()=>{
    for(const root of [...revisions.keys()])advance(root);
  };
  return {current,advance,isCurrent,invalidateAll,
    knownRoots:()=>[...revisions.keys()]};
}
