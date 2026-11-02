import { projectProcedure } from "./graph.mjs";

// Exact pinned ensure topology. The two admitted route edits are intentionally
// failure-only; all remaining route targets are frozen to the original sample.
const EDITABLE_ROUTE_IDS = new Set(["verify-created-target:FAIL", "observe-session-absence:FAIL"]);
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
const FIXED_ROUTES = new Map([
  ["observe-target-session:PASS", "done"],
  ["observe-target-session:FAIL", "observe-session-absence"],
  ["observe-target-session:UNKNOWN", "unresolved"],
  ["observe-session-absence:PASS", "create-session"],
  ["observe-session-absence:FAIL", "strategy-conflict"],
  ["observe-session-absence:UNKNOWN", "unresolved"],
  ["create-session:COMMITTED", "verify-created-target"],
  ["create-session:NOT_COMMITTED", "failed"],
  ["create-session:OUTCOME_UNKNOWN", "reconcile-create"],
  ["create-session:FAILED", "failed"],
  ["create-session:DENIED", "failed"],
  ["reconcile-create:COMMITTED", "verify-created-target"],
  ["reconcile-create:NOT_COMMITTED", "retry-create-session"],
  ["reconcile-create:UNRESOLVED", "unresolved"],
  ["reconcile-create:FAILED", "safe-stopped"],
  ["reconcile-create:DENIED", "safe-stopped"],
  ["retry-create-session:COMMITTED", "verify-created-target"],
  ["retry-create-session:NOT_COMMITTED", "failed"],
  ["retry-create-session:OUTCOME_UNKNOWN", "unresolved"],
  ["retry-create-session:FAILED", "failed"],
  ["retry-create-session:DENIED", "failed"],
  ["verify-created-target:PASS", "done"],
  ["verify-created-target:FAIL", "failed"],
  ["verify-created-target:UNKNOWN", "unresolved"]
]);
const ALLOWED_TERMINALS = ["strategy-conflict", "failed", "unresolved", "safe-stopped"];

export class PatchConflict extends Error {
  constructor(reason) { super(reason); this.name = "PatchConflict"; }
}
const reject = reason => { throw new PatchConflict(reason); };

export function routeEditTargets(procedure, routeId) {
  if (!procedure || procedure.name !== "ensure-session" ||
      procedure.start !== "observe-target-session" ||
      procedure.nodes.length !== FIXED_NODES.size ||
      procedure.routes.length !== FIXED_ROUTES.size ||
      !EDITABLE_ROUTE_IDS.has(routeId)) return [];
  const seenNodes = new Set(), seenRoutes = new Set();
  for (const node of procedure.nodes) {
    if (seenNodes.has(node.id) || FIXED_NODES.get(node.id) !== node.operator + ":" + node.value) return [];
    seenNodes.add(node.id);
  }
  for (const route of procedure.routes) {
    if (seenRoutes.has(route.id) || !FIXED_ROUTES.has(route.id)) return [];
    seenRoutes.add(route.id);
    if (EDITABLE_ROUTE_IDS.has(route.id)) {
      if (!ALLOWED_TERMINALS.includes(route.target)) return [];
    } else if (route.target !== FIXED_ROUTES.get(route.id)) return [];
  }
  const route = procedure.routes.find(r => r.id === routeId);
  if (!route || !route.patchable || !route.sourceSpan ||
      !Number.isSafeInteger(route.sourceSpan.start) ||
      !Number.isSafeInteger(route.sourceSpan.end)) return [];
  return ALLOWED_TERMINALS.filter(id => seenNodes.has(id));
}

export function previewRouteTargetPatch(baseSource, routeId, newTarget) {
  if (typeof baseSource !== "string" || typeof routeId !== "string" || typeof newTarget !== "string")
    reject("Patch 输入类型不合法");
  const before = projectProcedure(baseSource);
  if (before.state !== "READY") reject("Source 无有效 YAML AST 投影，禁止 Visual 修改");
  const choices = routeEditTargets(before.procedure, routeId);
  if (!choices.includes(newTarget)) reject("当前拓扑、Route Source Map 或终态目标未取得编辑资格");
  const route = before.procedure.routes.find(r => r.id === routeId);
  if (route.target === newTarget) reject("没有实际变化");
  const { start, end } = route.sourceSpan;
  if (start < 0 || end <= start || end > baseSource.length ||
      baseSource.slice(start, end) !== route.target) reject("Source Span 与目标标量不匹配");

  // The parsed Scalar.range is authoritative for the source patch.
  // Do not stringify the document or transform any unrelated source bytes.
  const candidateSource = baseSource.slice(0, start) + newTarget + baseSource.slice(end);
  const after = projectProcedure(candidateSource);
  if (after.state !== "READY") reject("Patch 后 YAML 重解析失败");
  if (after.procedure.nodes.length !== before.procedure.nodes.length ||
      after.procedure.routes.length !== before.procedure.routes.length) reject("结构数量发生变化");
  for (let i = 0; i < before.procedure.nodes.length; i++) {
    const a = before.procedure.nodes[i], b = after.procedure.nodes[i];
    if (!b || a.id !== b.id || a.operator !== b.operator ||
        a.value !== b.value || a.line !== b.line) reject("非目标 Node 语义被修改");
  }
  for (let i = 0; i < before.procedure.routes.length; i++) {
    const a = before.procedure.routes[i], b = after.procedure.routes[i];
    if (!b || a.id !== b.id || a.source !== b.source ||
        a.outcome !== b.outcome || a.line !== b.line ||
        b.target !== (a.id === routeId ? newTarget : a.target))
      reject("Patch 修改了非目标 Route");
  }
  if (!routeEditTargets(after.procedure, routeId).includes(newTarget)) reject("修改后的拓扑丢失编辑资格");
  const lineStart = baseSource.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const lineEnd = baseSource.indexOf("\n", end);
  const lineRaw = baseSource.slice(lineStart, lineEnd < 0 ? baseSource.length : lineEnd);
  const oldLine = lineRaw.replace(/\r$/, "");
  const newLine = oldLine.slice(0, start - lineStart) + newTarget + oldLine.slice(end - lineStart);
  return Object.freeze({
    type: "SetRouteTarget", profile: "ensure-cst-failure-terminal-v2",
    routeId, source: route.source, outcome: route.outcome,
    oldTarget: route.target, newTarget, line: route.line,
    sourceSpan: Object.freeze({ start, end }),
    baseSource, candidateSource,
    diff: "@@ -" + route.line + ",1 +" + route.line + ",1 @@\n-" + oldLine + "\n+" + newLine
  });
}

export function applyRouteTargetPatch(currentSource, preview) {
  if (!preview || preview.type !== "SetRouteTarget") reject("不是受支持的 Patch Preview");
  if (currentSource !== preview.baseSource) reject("Source Revision 已变化，请重新 Preview");
  // Recalculate all source offsets and the candidate from trusted text.
  const expected = previewRouteTargetPatch(currentSource, preview.routeId, preview.newTarget);
  const fields = ["profile", "source", "outcome", "oldTarget",
    "newTarget", "line", "baseSource", "candidateSource", "diff"];
  for (const field of fields) if (preview[field] !== expected[field]) reject("Preview 被篡改或已失效");
  if (!preview.sourceSpan || preview.sourceSpan.start !== expected.sourceSpan.start ||
      preview.sourceSpan.end !== expected.sourceSpan.end) reject("Preview Source Span 不匹配");
  return expected.candidateSource;
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
