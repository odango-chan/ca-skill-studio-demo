// D1-A2: call-site navigation is a view of the current, admitted YAML projection.
// A Procedure definition may be invoked by many Nodes; do not assign it an
// invented single parent or materialize additional business Nodes/Routes.
export function resolveProcedureCall(workspace,parentProcedure,callerId,childProcedure){
  const parent=workspace?.procedures?.get(parentProcedure);
  const child=workspace?.procedures?.get(childProcedure);
  const caller=parent?.nodes?.find(node=>node.id===callerId);
  if(!child||!caller||!Array.isArray(caller.children))return null;
  const matches=caller.children.filter(ref=>ref.procedure===childProcedure);
  if(matches.length!==1)return null;
  return {
    parentProcedure,callerId,childProcedure,
    via:matches[0].via,line:matches[0].line
  };
}
export function retainProcedureTrail(workspace,trail,activeProcedure){
  if(!Array.isArray(trail)||!trail.length)return [];
  let previous=null;
  const validated=[];
  for(const item of trail){
    if(!item||typeof item!=="object")break;
    if(previous!==null&&item.parentProcedure!==previous)break;
    const valid=resolveProcedureCall(workspace,
      item.parentProcedure,item.callerId,item.childProcedure);
    if(!valid||valid.via!==item.via)break;
    validated.push(valid);
    previous=item.childProcedure;
  }
  return validated.at(-1)?.childProcedure===activeProcedure?validated:[];
}
export function procedureCallers(workspace,childProcedure){
  const results=[];
  if(!workspace?.procedures?.has(childProcedure))return results;
  for(const [parentName,procedure] of workspace.procedures){
    for(const node of procedure.nodes??[]){
      const match=resolveProcedureCall(workspace,parentName,node.id,childProcedure);
      if(match)results.push(match);
    }
  }
  return results;
}
