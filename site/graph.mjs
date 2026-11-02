// Limited, fail-closed source projection for the pinned ensure-pdu-session fixture.
// Not a general YAML parser or a Demo Runtime validator. Source text stays authoritative.
const NODE_ID = "[A-Za-z0-9_][A-Za-z0-9_.-]*";
const nodePattern = new RegExp("^ {6}(" + NODE_ID + "):\\s*(?:#.*)?$");
const procPattern = new RegExp("^ {2}(" + NODE_ID + "):\\s*(?:#.*)?$");
const routePattern = new RegExp("^ {10}(" + NODE_ID + "):\\s*(" + NODE_ID + ")\\s*(?:#.*)?$");
const allowedOperators = new Set(["call", "verify", "terminal"]);
const allowedNodeFields = new Set(["call", "verify", "terminal", "with", "from", "on"]);
const maxNodes = 120;
const maxRoutes = 600;

export function projectProcedure(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const diagnostic = [];
  const fail = (message, line) => {
    diagnostic.push({ message, line });
    return { state: "UNAVAILABLE", diagnostics: diagnostic, procedure: null };
  };
  if (lines.length > 20000 || text.length > 1024 * 1024) return fail("文件超过图形投影上限", 1);
  let hasRoot = false;
  let procedure = "";
  let inProcedure = false;
  let inNodes = false;
  let current = null;
  let inRoutes = false;
  let start = "";
  let startLine = 0;
  const nodes = [];
  let routes = [];
  const ids = new Set();
  const visitedProcedures = new Set();

  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index];
    if (/^\s*(#.*)?$/.test(raw)) continue;
    if (raw.includes("\t") && /^\s*\t/.test(raw)) return fail("缩进包含 Tab，无法安全投影", index + 1);
    const indent = (raw.match(/^ */) || [""])[0].length;
    const trimmed = raw.trim();
    if (indent === 0) {
      if (trimmed === "procedures:") {
        if (hasRoot) return fail("重复 procedures 根键", index + 1);
        hasRoot = true;
        continue;
      }
      if (hasRoot) return fail("此投影暂不支持额外顶层键", index + 1);
      return fail("不是受支持的 Procedure YAML 根结构", index + 1);
    }
    if (!hasRoot) return fail("缺少 procedures 根键", index + 1);
    if (indent === 2) {
      const match = procPattern.exec(raw);
      if (!match) return fail("不支持的 Procedure 定义", index + 1);
      if (visitedProcedures.has(match[1])) return fail("重复 Procedure ID", index + 1);
      visitedProcedures.add(match[1]);
      if (visitedProcedures.size > 1) return fail("多 Procedure 请先在 Source 中编辑；图形投影尚未支持 Child Drill-in", index + 1);
      procedure = match[1];
      inProcedure = true;
      inNodes = false;
      current = null;
      inRoutes = false;
      continue;
    }
    if (!inProcedure) return fail("Procedure 结构不完整", index + 1);
    if (indent === 4) {
      inNodes = /^ {4}nodes:\s*(?:#.*)?$/.test(raw);
      current = null;
      inRoutes = false;
      if (/^ {4}start:/.test(raw)) {
        const match = new RegExp("^ {4}start:\\s*(" + NODE_ID + ")\\s*(?:#.*)?$").exec(raw);
        if (!match || start) return fail("start 缺失或重复", index + 1);
        start = match[1];
        startLine = index + 1;
      } else if (!inNodes && !/^ {4}(inputs|applicability):\s*(?:#.*)?$/.test(raw)) {
        return fail("此投影暂不支持的 Procedure 字段", index + 1);
      }
      continue;
    }
    if (!inNodes) continue; // inputs/applicability are source-only
    if (indent === 6) {
      const match = nodePattern.exec(raw);
      if (!match) return fail("节点键不属于当前有限 Profile", index + 1);
      if (ids.has(match[1])) return fail("重复 Node ID: " + match[1], index + 1);
      ids.add(match[1]);
      if (nodes.length >= maxNodes) return fail("节点数量超出当前预览上限", index + 1);
      current = { id: match[1], operator: "", value: "", line: index + 1 };
      nodes.push(current);
      inRoutes = false;
      continue;
    }
    if (!current) return fail("nodes 内出现未识别内容", index + 1);
    if (indent === 8) {
      inRoutes = false;
      const key = /^ {8}(['"]?)([a-zA-Z][\w-]*)\1:\s*(.*)$/.exec(raw);
      if (!key) return fail("不支持的节点字段语法", index + 1);
      const field = key[2];
      if (field === "preconditions" || field === "postconditions") return fail("当前不投影 Transitional Phase；请使用 Source", index + 1);
      if (!allowedNodeFields.has(field)) return fail("未知节点字段不能被安全投影: " + field, index + 1);
      if (field === "on") {
        if (!/^(?:#.*)?$/.test(key[3])) return fail("Route 映射格式不支持", index + 1);
        inRoutes = true;
      } else if (allowedOperators.has(field)) {
        if (current.operator) return fail("节点具有多个 Operator", index + 1);
        current.operator = field;
        const match = new RegExp("^(" + NODE_ID + ")\\s*(?:#.*)?$").exec(key[3]);
        if (!match) return fail("Operator 值不属于当前有限 Profile", index + 1);
        current.value = match[1];
      }
      continue;
    }
    if (inRoutes) {
      if (indent !== 10) return fail("Route 内容不符合标量映射格式", index + 1);
      const match = routePattern.exec(raw);
      if (!match) return fail("Route 必须是 outcome → target 标量", index + 1);
      if (routes.some(r => r.source === current.id && r.outcome === match[1])) return fail("重复 Route outcome: " + match[1], index + 1);
      if (routes.length >= maxRoutes) return fail("Route 超出当前预览上限", index + 1);
      routes.push({ id: current.id + ":" + match[1], source: current.id, outcome: match[1], target: match[2], line: index + 1, routeSource: "operator.on" });
    }
  }
  if (!hasRoot || !procedure || !start || !nodes.length) return fail("Procedure 缺少必要字段", startLine || 1);
  if (!ids.has(start)) return fail("start 指向不存在的节点: " + start, startLine);
  for (const node of nodes) {
    if (!node.operator) return fail("缺少受支持 Operator: " + node.id, node.line);
    if (node.operator !== "terminal" && !routes.some(r => r.source === node.id)) return fail("非终态节点没有 Route: " + node.id, node.line);
    if (node.operator === "terminal" && routes.some(r => r.source === node.id)) return fail("Terminal 节点不能定义 Route: " + node.id, node.line);
  }
  for (const route of routes) {
    if (!ids.has(route.target)) return fail("悬空 Route: " + route.source + "." + route.outcome + " → " + route.target, route.line);
  }
  return {
    state: "READY",
    diagnostics: [],
    procedure: { name: procedure, start, nodes, routes, profile: "ensure-subset (source projection only)" }
  };
}

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
