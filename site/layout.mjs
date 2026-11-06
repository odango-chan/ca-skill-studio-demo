import ELK from "elkjs/lib/elk.bundled.js";
import {projectPathFocus} from "./path-focus.mjs";

// Visual-only graph extraction. The original Procedure route list and source
// locations remain untouched; grouping never merges distinct Source origins.
const DIMENSION = Object.freeze({ width: 238, height: 80 });
const DIRECTIONS = new Set(["RIGHT", "DOWN"]);
const MAX_NODE_COUNT = 300;
const MAX_ROUTE_COUNT = 1600;
const elk = new ELK();

export function selectGraphScope(procedure, centerId = null, neighborsOnly = false, pathFocus = null) {
  const nodes = procedure.nodes;
  const routes = procedure.routes;
  if (!neighborsOnly || !centerId || !nodes.some(n => n.id === centerId)) {
    return pathFocus ? projectPathFocus(procedure,pathFocus) :
      { nodes, routes, isFiltered: false };
  }
  const ids = new Set([centerId]);
  for (const r of routes) {
    if (r.source === centerId) ids.add(r.target);
    if (r.target === centerId) ids.add(r.source);
  }
  return {
    nodes: nodes.filter(n => ids.has(n.id)),
    routes: routes.filter(r => ids.has(r.source) && ids.has(r.target)),
    isFiltered: true
  };
}

export function groupRouteEntries(routes) {
  const groups = new Map();
  for (const route of routes) {
    // Route Source is part of visual identity. Same source+target from an
    // operator and a postcondition must NEVER become one indistinguishable line.
    const key = JSON.stringify([route.source, route.target, route.routeSource]);
    if (!groups.has(key)) groups.set(key, {
      source: route.source, target: route.target,
      routeSource: route.routeSource, outcomes: [], routes: []
    });
    const g = groups.get(key);
    g.outcomes.push(route.outcome);
    g.routes.push(route);
  }
  return [...groups.values()];
}

function validate(procedure, scope, direction) {
  if (!DIRECTIONS.has(direction)) throw Error("Unsupported graph direction");
  if (!procedure?.nodes || !procedure?.routes ||
    procedure.nodes.length > MAX_NODE_COUNT ||
    procedure.routes.length > MAX_ROUTE_COUNT) throw Error("Graph exceeds preview bounds");
  const ids = new Set(scope.nodes.map(n => n.id));
  if (ids.size !== scope.nodes.length) throw Error("Duplicate graph node");
  for (const route of scope.routes) {
    if (!ids.has(route.source) || !ids.has(route.target)) throw Error("Unresolved route in graph scope");
  }
}
function serializePath(sections, offset = 30) {
  if (!Array.isArray(sections) || !sections.length) return null;
  const all = [];
  for (const section of sections) {
    if (!section.startPoint || !section.endPoint) continue;
    const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];
    all.push(points.map((point, i) => (i ? "L" : "M") +
      (point.x + offset).toFixed(1) + " " + (point.y + offset).toFixed(1)).join(" "));
  }
  return all.length ? all.join(" ") : null;
}
// ELK decides the exact edge attachment point per bundle. React Flow's
// single centered handle cannot represent those points: custom edge SVG paths
// then visibly diverge from their reconnect/preview handles.
// Map the ELK endpoints into source/target node-local handle coordinates.
function portAnchor(point, nodeId, positions, offset, dimensions) {
  if(!point)return null;
  const position=positions.get(nodeId);
  if(!position)return null;
  const x=point.x+offset-position.x,y=point.y+offset-position.y;
  if(!Number.isFinite(x)||!Number.isFinite(y))return null;
  const size=dimensions?.get(nodeId)??DIMENSION;
  const candidates=[
    {side:"top",distance:Math.abs(y),offset:x,length:size.width},
    {side:"bottom",distance:Math.abs(y-size.height),offset:x,length:size.width},
    {side:"left",distance:Math.abs(x),offset:y,length:size.height},
    {side:"right",distance:Math.abs(x-size.width),offset:y,length:size.height}
  ].sort((a,b)=>a.distance-b.distance);
  const chosen=candidates[0];
  if(chosen.distance>3||chosen.offset < -2||chosen.offset>chosen.length+2)
    return null;
  return {side:chosen.side,offset:Math.max(0,Math.min(chosen.length,
    Math.round(chosen.offset*100)/100))};
}
function bundleAnchors(sections, source, target, positions, offset, dimensions) {
  if(!Array.isArray(sections)||!sections.length)return null;
  const first=sections.find(section=>section.startPoint&&section.endPoint);
  const last=[...sections].reverse().find(section=>section.startPoint&&section.endPoint);
  if(!first||!last)return null;
  const from=portAnchor(first.startPoint,source,positions,offset,dimensions);
  const to=portAnchor(last.endPoint,target,positions,offset,dimensions);
  return from&&to?{source:from,target:to}:null;
}
function labelPoint(sections, source, target, positions) {
  const segments = [];
  for (const section of sections || []) {
    const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].filter(Boolean);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      segments.push({length: Math.abs(a.x - b.x) + Math.abs(a.y - b.y),
        x: (a.x + b.x) / 2 + 30, y: (a.y + b.y) / 2 + 30});
    }
  }
  if (segments.length) {
    segments.sort((a, b) => b.length - a.length);
    return {x:segments[0].x,y:segments[0].y-9};
  }
  const a=positions.get(source), b=positions.get(target);
  return {x: ((a?.x || 0) + (b?.x || 0)) / 2 + 70,
    y: ((a?.y || 0) + (b?.y || 0)) / 2 - 9};
}

export async function layoutProcedureELK(procedure, {
  direction = "DOWN", focus = null, neighborsOnly = false, dimensions = null,
  pathFocus = null
} = {}) {
  const scope = selectGraphScope(procedure, focus, neighborsOnly, pathFocus);
  validate(procedure, scope, direction);
  if(dimensions){
    for(const node of scope.nodes){
      const size=dimensions.get(node.id);
      if(!size||!Number.isFinite(size.width)||!Number.isFinite(size.height)||
         size.width<80||size.height<60||size.width>1000||size.height>1000)
        throw Error("Invalid visual-only node dimensions: "+node.id);
    }
  }
  const bundles = groupRouteEntries(scope.routes);
  const edges = bundles.map((b,i) => ({
    id: "bundle-" + i, sources: [b.source], targets: [b.target]
  }));
  const input = {
    id: "skill-procedure",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction,
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": "70",
      "elk.layered.spacing.nodeNodeBetweenLayers": "125",
      "elk.layered.spacing.edgeNodeBetweenLayers": "35",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.padding": "[left=35, top=35, right=35, bottom=35]"
    },
    children: scope.nodes.map(n => ({id: n.id, ...(dimensions?.get(n.id)??DIMENSION)})),
    edges
  };
  const output = await elk.layout(input);
  if (!output || !Array.isArray(output.children) || output.children.length !== scope.nodes.length)
    throw Error("ELK returned incomplete node positions");
  const offset = 30;
  const positions = new Map();
  for (const node of output.children) {
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) throw Error("ELK returned nonfinite coordinates");
    positions.set(node.id,{x: node.x + offset, y: node.y + offset});
  }
  const edgeMap = new Map((output.edges||[]).map(e=>[e.id,e]));
  for (let i=0;i<bundles.length;i++) {
    const e=edgeMap.get("bundle-"+i);
    bundles[i].path=serializePath(e?.sections, offset);
    bundles[i].anchors=bundleAnchors(e?.sections,bundles[i].source,
      bundles[i].target,positions,offset,dimensions);
    bundles[i].label=labelPoint(e?.sections,bundles[i].source,bundles[i].target,positions);
  }
  if (!bundles.every(b => b.routes.length > 0)) throw Error("ELK empty route bundle");
  if (bundles.reduce((total,b)=>total+b.routes.length,0)!==scope.routes.length)
    throw Error("ELK bundle changed route entry accounting");
  const width=(output.width??100)+2*offset, height=(output.height??100)+2*offset;
  if (!Number.isFinite(width) || !Number.isFinite(height)) throw Error("ELK invalid graph dimensions");
  return { positions, bundles, width, height,
    visibleNodes: scope.nodes, visibleRoutes: scope.routes,
    isFiltered: scope.isFiltered, hiddenByNode:scope.hiddenByNode??new Map(),
    filterReason:scope.reason??null, direction, engine: "ELK layered" };
}
