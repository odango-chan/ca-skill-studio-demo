import { parseDocument, LineCounter, isAlias, isMap, isScalar, isSeq } from "yaml";

// Source-authoritative read-only projection, backed by yaml@2.9.1 AST + CST.
// The AST is an index, never a second editable or serialised source of truth.
const ID = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const OPERATORS = new Set(["call", "verify", "terminal"]);
const NODE_FIELDS = new Set(["call", "verify", "terminal", "with", "from", "on"]);
const PROC_FIELDS = new Set(["start", "nodes", "inputs", "applicability"]);
const OUTCOME = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const MAX_BYTES = 1024 * 1024;
const MAX_LINES = 20000;

class ProjectionError extends Error {
  constructor(message, line = 1) { super(message); this.line = line; }
}
const bad = (message, line = 1) => { throw new ProjectionError(message, line); };
const pos = (node, lines) => lines.linePos(node?.range?.[0] ?? 0).line || 1;
const offset = (node) => node?.range?.[0];
const mustMap = (node, desc, lines) => {
  if (!isMap(node)) bad(desc + " 必须是 YAML mapping", pos(node, lines));
  return node;
};
const scalarString = (node, desc, lines, pattern = ID) => {
  if (!isScalar(node) || typeof node.value !== "string" || !pattern.test(node.value))
    bad(desc + " 必须是受支持的字符串标量", pos(node, lines));
  return node.value;
};
const entries = (map, desc, lines) => {
  const result = new Map();
  for (const pair of mustMap(map, desc, lines).items) {
    const key = scalarString(pair.key, desc + " key", lines);
    if (result.has(key)) bad("重复 YAML 字段: " + key, pos(pair.key, lines));
    result.set(key, pair.value);
  }
  return result;
};
function inspectTree(node, lines, depth = 0, budget = { remaining: 25000 }) {
  if (--budget.remaining < 0 || depth > 32) bad("YAML 深度或元素数量超过预览安全上限", pos(node, lines));
  if (!node) return;
  if (isAlias(node)) bad("Alias / Merge 暂不允许图形投影", pos(node, lines));
  if (node.anchor || node.tag) bad("Anchors / Tags 暂不允许图形投影", pos(node, lines));
  if (isMap(node)) for (const pair of node.items) {
    inspectTree(pair.key, lines, depth + 1, budget);
    inspectTree(pair.value, lines, depth + 1, budget);
  }
  else if (isSeq(node)) for (const item of node.items) inspectTree(item, lines, depth + 1, budget);
}
export function projectProcedure(text) {
  try {
    if (typeof text !== "string" || text.length > MAX_BYTES) bad("文件超过图形投影上限");
    if (text.split(/\r\n|\n|\r/).length > MAX_LINES) bad("行数超过图形投影上限");
    const lc = new LineCounter();
    const doc = parseDocument(text, {
      version: "1.2", schema: "core", uniqueKeys: true, strict: true,
      stringKeys: true, keepSourceTokens: true, lineCounter: lc,
      logLevel: "silent"
    });
    if (doc.errors.length) {
      const issue = doc.errors[0];
      bad("YAML 解析失败: " + issue.message, lc.linePos(issue.pos?.[0] ?? 0).line || 1);
    }
    if (/^\s*(?:%YAML|%TAG|---|\.\.\.)/m.test(text)) bad("多文档/指令不在当前 Visual Profile 内");
    inspectTree(doc.contents, lc);
    const root = entries(doc.contents, "root", lc);
    if (root.size !== 1 || !root.has("procedures")) bad("此 Visual Profile 只支持 procedures 根结构");
    const procedures = entries(root.get("procedures"), "procedures", lc);
    if (procedures.size !== 1) bad("多 Procedure 暂未资格化，请使用 Source");
    const [name, procedureMap] = [...procedures][0];
    const fields = entries(procedureMap, "procedure " + name, lc);
    for (const key of fields.keys()) if (!PROC_FIELDS.has(key)) bad("Procedure 字段尚未资格化: " + key);
    const start = scalarString(fields.get("start"), "start", lc);
    const nodeMap = entries(fields.get("nodes"), "nodes", lc);
    if (nodeMap.size > 120) bad("Node 数量超出当前预览上限");
    const nodes = [], routes = [];
    for (const [id, obj] of nodeMap) {
      const nodeFields = entries(obj, "node " + id, lc);
      for (const key of nodeFields.keys()) {
        if (key === "preconditions" || key === "postconditions") bad("Transitional Phase 尚未资格化，请使用 Source");
        if (!NODE_FIELDS.has(key)) bad("Node 字段尚未资格化: " + key);
      }
      const ops = [...nodeFields.keys()].filter(key => OPERATORS.has(key));
      if (ops.length !== 1) bad("Node 需要恰好一个 Operator: " + id);
      const operator = ops[0];
      const value = scalarString(nodeFields.get(operator), "Operator", lc);
      const keyNode = mustMap(fields.get("nodes"), "nodes", lc).items.find(p => p.key.value === id)?.key;
      nodes.push({ id, operator, value, line: pos(keyNode, lc) });
      if (nodeFields.has("on")) {
        const routeMap = mustMap(nodeFields.get("on"), "on", lc);
        if (operator === "terminal") bad("Terminal 不能定义 on Route");
        for (const pair of routeMap.items) {
          const outcome = scalarString(pair.key, "Outcome", lc, OUTCOME);
          const target = scalarString(pair.value, "Target", lc);
          const range = pair.value.range;
          if (!range || !Number.isSafeInteger(range[0]) || !Number.isSafeInteger(range[1])) bad("Route Source Map 不可用", pos(pair.value, lc));
          routes.push({
            id: id + ":" + outcome, source: id, outcome, target,
            line: pos(pair.key, lc), routeSource: "operator.on",
            sourceSpan: { start: range[0], end: range[1] },
            patchable: text.slice(range[0], range[1]) === target
          });
        }
      } else if (operator !== "terminal") bad("非终态 Node 缺失 on Route: " + id);
    }
    if (routes.length > 600) bad("Route 数量超出预览上限");
    const ids = new Set(nodes.map(n => n.id));
    if (!ids.has(start)) bad("start 不是现有 Node");
    for (const route of routes) if (!ids.has(route.target)) bad("悬空 Route: " + route.id + " → " + route.target, route.line);
    return {
      state: "READY", diagnostics: [],
      procedure: { name, start, nodes, routes, profile: "ensure-cst-v1 (projection only)" }
    };
  } catch (e) {
    if (e instanceof ProjectionError) return { state: "UNAVAILABLE", diagnostics: [{ message: e.message, line: e.line }], procedure: null };
    return { state: "UNAVAILABLE", diagnostics: [{ message: "YAML 源文件无法安全投影: " + String(e.message ?? e), line: 1 }], procedure: null };
  }
}
