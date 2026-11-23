/**
 * Source-backed, presentation-only terminal endpoints shared by Procedure
 * Preview and AI Flow Changes. Terminal dispositions are Route targets, NOT
 * extra author-defined CA-SL Nodes. They never grant edit authority.
 */
const TERMINAL_IDS=new Set(["SUCCEEDED","FAILED","UNRESOLVED","SAFE_STOPPED"]);

export function withProcedureTerminalViews(sourceProcedure) {
  if (!sourceProcedure || !Array.isArray(sourceProcedure.nodes) ||
      !Array.isArray(sourceProcedure.routes)) {
    throw new TypeError("A valid CA-SL source projection is required");
  }
  const declared=new Set(sourceProcedure.nodes.map(node=>node.id));
  if(sourceProcedure.nodes.some(node=>node.viewOnly)||sourceProcedure.nodes.some(node=>TERMINAL_IDS.has(node.id)))
    throw new Error("Terminal endpoints must not be supplied as authored business Nodes");
  const terminalIds=[...new Set(sourceProcedure.routes
    .map(route=>route.target).filter(id=>TERMINAL_IDS.has(id)))];
  const dangling=sourceProcedure.routes.filter(route=>
    !declared.has(route.target)&&!TERMINAL_IDS.has(route.target));
  if(dangling.length)throw new Error("Source projection contains unresolved Route targets");
  const terminalNodes=terminalIds.map(id=>({
    id,operator:"terminal",value:id,line:0,phases:[],children:[],viewOnly:true
  }));
  return {...sourceProcedure,nodes:[...sourceProcedure.nodes,...terminalNodes]};
}
