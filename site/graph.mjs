import { projectProcedure } from "./semantic.mjs";
export { projectProcedure };

export function layoutProcedure(procedure) {
  const nodes = procedure.nodes;
  const depth = new Map([[procedure.start, 0]]);
  const queue = [procedure.start];
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    const d = depth.get(current) ?? 0;
    for (const r of procedure.routes) {
      if (r.source === current && !depth.has(r.target)) {
        depth.set(r.target, Math.min(d + 1, 20));
        queue.push(r.target);
      }
    }
  }
  let maxOperational = 0;
  for (const node of nodes) if (node.operator !== "terminal") maxOperational = Math.max(maxOperational, depth.get(node.id) ?? 0);
  const byColumn = new Map();
  for (const node of nodes) {
    const column = node.operator === "terminal" ? maxOperational + 1 : (depth.get(node.id) ?? maxOperational + 2);
    if (!byColumn.has(column)) byColumn.set(column, []);
    byColumn.get(column).push(node);
  }
  const positions = new Map();
  let maxColumn = 0;
  let height = 220;
  for (const [column, entries] of byColumn) {
    maxColumn = Math.max(maxColumn, column);
    const totalHeight = entries.length * 106;
    height = Math.max(height, totalHeight + 160);
    entries.forEach((node, i) => positions.set(node.id, { x: 80 + column * 305, y: 80 + i * 106 }));
  }
  const bundled = new Map();
  for (const route of procedure.routes) {
    const key = route.source + "\0" + route.target;
    if (!bundled.has(key)) bundled.set(key, { source: route.source, target: route.target, outcomes: [], routes: [] });
    bundled.get(key).outcomes.push(route.outcome);
    bundled.get(key).routes.push(route);
  }
  return { positions, bundles: [...bundled.values()], width: 80 + (maxColumn + 1) * 305 + 200, height };
}
