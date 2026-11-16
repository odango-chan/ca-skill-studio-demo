// A5: avoid expensive full-procedure ELK above a bounded graph size.
// Scope is visual only. Never truncate nodes or source Route entries.
export const LARGE_GRAPH_NODE_LIMIT=90;
export const LARGE_GRAPH_ROUTE_LIMIT=250;
export function detailedLayoutAllowed(scope){
  return !!scope&&Array.isArray(scope.nodes)&&Array.isArray(scope.routes)&&
    scope.nodes.length<=LARGE_GRAPH_NODE_LIMIT&&
    scope.routes.length<=LARGE_GRAPH_ROUTE_LIMIT;
}
