import { projectProcedure } from "./graph.mjs";

// First qualified *demonstration* operation only. No general source-preserving
// YAML mutation is claimed. These two failure routes may only target a
// terminal in the exact fixed ensure topology; no create authorization routes.
const EDITABLE_ROUTE_IDS = new Set([
  "verify-created-target:FAIL",
  "observe-session-absence:FAIL"
]);
const FIXED_NODES = new Map([
  ["observe-target-session", "verify:pdu_session.target.satisfied"],
  ["observe-session-absence", "verify:pdu_session.absent"],
  ["create-session", "call:pdu_session.create"],
  ["reconcile-create", "call:pdu_session.reconcile"],
  ["retry-create-session", "call:pdu_session.create"],
  ["verify-created-target", "verify:pdu_session.target.satisfied"],
  ["done", "terminal:SUCCEEDED"],
  ["strategy-conflict", "terminal:FAILED"],
  ["failed", "terminal:FAILED"],
  ["unresolved", "terminal:UNRESOLVED"],
  ["safe-stopped", "terminal:SAFE_STOPPED"]
]);

export class PatchConflict extends Error {
  constructor(reason) {
    super(reason);
    this.name = "PatchConflict";
  }
}
const reject = (reason) => { throw new PatchConflict(reason); };

export function routeEditTargets(procedure, routeId) {
  if (!procedure || procedure.name !== "ensure-session" ||
      procedure.start !== "observe-target-session" ||
      procedure.nodes.length !== FIXED_NODES.size ||
      procedure.routes.length !== 24 ||
      !EDITABLE_ROUTE_IDS.has(routeId)) return [];
  for (const node of procedure.nodes) {
    if (FIXED_NODES.get(node.id) !== node.operator + ":" + node.value) return [];
  }
  const route = procedure.routes.find(r => r.id === routeId);
  if (!route || !FIXED_NODES.has(route.source)) return [];
  if (!procedure.nodes.some(n => n.id === route.target && n.operator === "terminal")) return [];
  return procedure.nodes.filter(n => n.operator === "terminal" && n.value !== "SUCCEEDED").map(n => n.id);
}

export function previewRouteTargetPatch(baseSource, routeId, newTarget) {
  if (typeof baseSource !== "string" || typeof newTarget !== "string" || typeof routeId !== "string") reject("Patch 输入类型不合法");
  const before = projectProcedure(baseSource);
  if (before.state !== "READY") reject("当前 Source 无有效投影，禁止 Visual 修改");
  const choices = routeEditTargets(before.procedure, routeId);
  if (!choices.includes(newTarget)) reject("目标不存在或未取得终态 Route 编辑资格");
  const route = before.procedure.routes.find(r => r.id === routeId);
  if (!route) reject("找不到原始 Route");
  if (route.target === newTarget) reject("没有实际变化");

  // Exact line-local scalar mutation. Preserve every other byte, comment,
  // indentation, quote style on unrelated keys, BOM, and line ending.
  const lines = baseSource.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g)?.filter(Boolean) ?? [];
  const oldPhysicalLine = lines[route.line - 1];
  if (oldPhysicalLine === undefined) reject("Route source line no longer exists");
  const lineEnding = oldPhysicalLine.endsWith("\r\n") ? "\r\n" : oldPhysicalLine.endsWith("\n") ? "\n" : oldPhysicalLine.endsWith("\r") ? "\r" : "";
  const text = oldPhysicalLine.slice(0, oldPhysicalLine.length - lineEnding.length);
  const m = /^([ ]{10})([A-Za-z_][\w.-]*)([ ]*:[ ]*)([A-Za-z_][\w.-]*)([ ]*(?:#.*)?)$/.exec(text);
  if (!m || m[2] !== route.outcome || m[4] !== route.target) reject("Route 文本锚点不匹配：拒绝 Patch");

  const newPhysicalLine = m[1] + m[2] + m[3] + newTarget + m[5] + lineEnding;
  const startOffset = lines.slice(0, route.line - 1).reduce((sum, item) => sum + item.length, 0);
  if (baseSource.slice(startOffset, startOffset + oldPhysicalLine.length) !== oldPhysicalLine) reject("Source span 变化");
  const afterSource = baseSource.slice(0, startOffset) + newPhysicalLine + baseSource.slice(startOffset + oldPhysicalLine.length);
  const after = projectProcedure(afterSource);
  if (after.state !== "READY") reject("Patch 后重解析失败：" + (after.diagnostics[0]?.message ?? ""));
  const expectedRoutes = before.procedure.routes;
  if (after.procedure.routes.length !== expectedRoutes.length ||
      after.procedure.nodes.length !== before.procedure.nodes.length) reject("修改改变了非目标结构");
  for (let i = 0; i < expectedRoutes.length; i++) {
    const oldRoute = expectedRoutes[i];
    const newRoute = after.procedure.routes[i];
    if (!newRoute || oldRoute.id !== newRoute.id || oldRoute.source !== newRoute.source ||
        oldRoute.outcome !== newRoute.outcome || oldRoute.line !== newRoute.line ||
        newRoute.target !== (oldRoute.id === routeId ? newTarget : oldRoute.target)) reject("修改超出目标 Route");
  }
  for (let i = 0; i < before.procedure.nodes.length; i++) {
    const a = before.procedure.nodes[i], b = after.procedure.nodes[i];
    if (a.id !== b.id || a.operator !== b.operator || a.value !== b.value || a.line !== b.line) reject("Node 语义发生非目标修改");
  }
  return Object.freeze({
    type: "SetRouteTarget",
    profile: "ensure-failure-terminal-route-v1",
    routeId,
    source: route.source,
    outcome: route.outcome,
    oldTarget: route.target,
    newTarget,
    line: route.line,
    baseSource,
    candidateSource: afterSource,
    diff: "@@ -" + route.line + ",1 +" + route.line + ",1 @@\n-" + text + "\n+" + newPhysicalLine.slice(0, newPhysicalLine.length - lineEnding.length)
  });
}

export function applyRouteTargetPatch(currentSource, preview) {
  if (!preview || preview.type !== "SetRouteTarget") reject("不是受支持的 Patch Preview");
  if (currentSource !== preview.baseSource) reject("源文件 Revision 已变化，请重新生成 Preview");
  // Re-derive on each apply; never trust a caller-provided candidateSource.
  const recomputed = previewRouteTargetPatch(currentSource, preview.routeId, preview.newTarget);
  const fields = ["profile", "source", "outcome", "oldTarget", "newTarget", "line", "candidateSource", "diff"];
  for (const field of fields) if (preview[field] !== recomputed[field]) reject("Preview 被篡改或已失效");
  return recomputed.candidateSource;
}

export function createEditorHistory(initialSource, limit = 80) {
  if (typeof initialSource !== "string" || !Number.isInteger(limit) || limit < 2) reject("History 参数不合法");
  let entries = [initialSource], position = 0;
  return {
    record(text) {
      if (typeof text !== "string") reject("History 仅记录 Source 文本");
      if (entries[position] === text) return false;
      entries = entries.slice(0, position + 1);
      entries.push(text);
      if (entries.length > limit) entries.shift();
      position = entries.length - 1;
      return true;
    },
    undo() {
      if (position === 0) return null;
      position -= 1;
      return entries[position];
    },
    redo() {
      if (position >= entries.length - 1) return null;
      position += 1;
      return entries[position];
    },
    canUndo() { return position > 0; },
    canRedo() { return position < entries.length - 1; },
    current() { return entries[position]; }
  };
}
