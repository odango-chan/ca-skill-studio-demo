import { projectProcedure, layoutProcedure } from "./graph.mjs";

const $ = (id) => document.getElementById(id);
const SVG_NS = "http://www.w3.org/2000/svg";
const source = $("source");
const graphPane = $("graphPane");
const svg = $("canvas");
const world = $("world");
const nodeOutline = $("nodeOutline");
const inspector = $("inspector");
const problems = $("problems");
const filePicker = $("filePicker");
let filename = "ensure-pdu-session.procedure.yaml";
let initialText = "";
let projection = null;
let lastGood = null;
let graph = null;
let selection = null;
let mode = "visual";
let camera = { x: 0, y: 0, scale: 1 };
let dragging = null;
let projectedText = null;

function button(label, handler, className = "") {
  const el = document.createElement("button");
  el.type = "button";
  el.textContent = label;
  if (className) el.className = className;
  el.addEventListener("click", handler);
  return el;
}
function setText(id, text) { $(id).textContent = text; }
function svgEl(name, attrs = {}, text) {
  const element = document.createElementNS(SVG_NS, name);
  Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, String(value)));
  if (text !== undefined) element.textContent = String(text);
  return element;
}
function message(text) { setText("hint", text); }
function onDirtyNavigation(event) {
  if (source.value !== initialText) {
    event.preventDefault();
    event.returnValue = "";
  }
}
window.addEventListener("beforeunload", onDirtyNavigation);

function setMode(next) {
  mode = next;
  $("editorBody").dataset.mode = next;
  for (const id of ["visual", "source", "split"]) {
    const el = $("mode-" + id);
    el.setAttribute("aria-pressed", id === mode ? "true" : "false");
  }
  if (next !== "source" && lastGood) requestAnimationFrame(fit);
}
for (const id of ["visual", "source", "split"]) $("mode-" + id).addEventListener("click", () => setMode(id));

function loadDocument(name, text) {
  filename = name;
  initialText = text;
  source.value = text;
  selection = null;
  lastGood = null;
  projectedText = null;
  setText("fileName", name);
  setText("titleFile", name);
  setText("hint", "本地 Source 工作缓冲区；不会上传或执行");
  refresh(true);
  if (!lastGood) setMode("source");
  else setMode("visual");
}
function refresh(refit = false) {
  const text = source.value;
  setText("dirty", text === initialText ? "初始版本" : "未导出修改");
  setText("stats", text.split("\n").length + " 行 · " + new TextEncoder().encode(text).length + " bytes");
  const parsed = projectProcedure(text);
  projection = parsed;
  if (parsed.state === "READY") {
    lastGood = parsed.procedure;
    projectedText = text;
    graph = layoutProcedure(lastGood);
    if (selection && selection.kind === "node" && !lastGood.nodes.some(n => n.id === selection.id)) selection = null;
    if (selection && selection.kind === "route" && !lastGood.routes.some(r => r.id === selection.id)) selection = null;
    setText("projectionState", "READY · narrow Profile");
  } else {
    setText("projectionState", lastGood ? "STALE · source changed" : "UNAVAILABLE");
    if (!lastGood) graph = null;
  }
  $("graphWarning").hidden = parsed.state === "READY";
  setText("graphWarning", parsed.state === "READY" ? "" : (lastGood ? "Graph 已过期，仅供对照，不能代表当前 Source。" : "当前 Source 无可用的 Procedure 投影。") + " " + (parsed.diagnostics[0]?.message ?? ""));
  renderOutline();
  renderInspector();
  renderProblems();
  renderGraph();
  if (refit && graph) requestAnimationFrame(fit);
}
source.addEventListener("input", () => refresh(false));

function renderOutline() {
  nodeOutline.replaceChildren();
  const search = $("search").value.trim().toLowerCase();
  if (!lastGood) {
    const p = document.createElement("li");
    p.className = "muted";
    p.textContent = "无可用 Node Outline";
    nodeOutline.appendChild(p);
    return;
  }
  lastGood.nodes.forEach((node, index) => {
    if (search && ![node.id, node.value, node.operator].join(" ").toLowerCase().includes(search)) return;
    const li = document.createElement("li");
    const selected = selection?.kind === "node" && selection.id === node.id;
    const prefix = String(index + 1).padStart(2, "0");
    const b = button(prefix + " · " + node.id, () => selectNode(node.id), selected ? "active" : "");
    b.title = node.operator + ": " + node.value;
    b.disabled = projection?.state !== "READY";
    li.appendChild(b);
    nodeOutline.appendChild(li);
  });
}
$("search").addEventListener("input", renderOutline);

function lineJump(line) {
  if (!line || line < 1) return;
  if (mode === "visual") setMode("split");
  const lines = source.value.split("\n");
  const before = lines.slice(0, line - 1);
  const index = before.join("\n").length + (before.length ? 1 : 0);
  source.focus();
  source.setSelectionRange(index, index + (lines[line - 1] || "").length);
  const lineHeight = Number.parseFloat(getComputedStyle(source).lineHeight) || 20;
  source.scrollTop = Math.max(0, (line - 4) * lineHeight);
}
function inspectorLine(label, value) {
  const row = document.createElement("div");
  row.className = "inspector-row";
  const head = document.createElement("span");
  head.className = "muted";
  head.textContent = label;
  const valueEl = document.createElement("span");
  valueEl.className = "code-value";
  valueEl.textContent = String(value);
  row.append(head, valueEl);
  inspector.appendChild(row);
}
function inspectorTitle(text) {
  const el = document.createElement("h3");
  el.textContent = text;
  inspector.appendChild(el);
}
function inspectorRoute(route) {
  const row = document.createElement("div");
  row.className = "route-row";
  const b = button(route.outcome + " → " + route.target, () => selectRoute(route.id), selection?.kind === "route" && route.id === selection.id ? "active" : "");
  b.disabled = projection?.state !== "READY";
  const jump = button("L" + route.line, () => lineJump(route.line), "source-link");
  row.append(b, jump);
  inspector.appendChild(row);
}
function renderInspector() {
  inspector.replaceChildren();
  if (!lastGood) { inspectorTitle("尚未选择对象"); inspectorLine("模式", "Source-only"); return; }
  if (projection?.state !== "READY") {
    inspectorTitle("投影已过期");
    inspectorLine("安全限制", "Source 改动无法被解析，选择和图形编辑已禁用");
    return;
  }
  if (!selection) {
    inspectorTitle(lastGood.name);
    inspectorLine("入口", lastGood.start);
    inspectorLine("Node", lastGood.nodes.length);
    inspectorLine("Route entries", lastGood.routes.length);
    inspectorLine("编辑资格", "Visual read-only");
    inspectorLine("语法范围", "ensure-subset · 非完整 YAML validator");
    return;
  }
  if (selection.kind === "node") {
    const node = lastGood.nodes.find(n => n.id === selection.id);
    if (!node) return;
    inspectorTitle(node.id);
    inspectorLine("Operator", node.operator.toUpperCase());
    inspectorLine("Identifier", node.value);
    inspectorLine("Source", "L" + node.line);
    inspector.appendChild(button("定位 Source 行", () => lineJump(node.line), "source-link"));
    inspectorTitle("显式 Route entries");
    const outgoing = lastGood.routes.filter(r => r.source === node.id);
    if (!outgoing.length) inspectorLine("终态", "没有路由");
    for (const route of outgoing) inspectorRoute(route);
    const incoming = lastGood.routes.filter(r => r.target === node.id);
    inspectorTitle("Incoming · " + incoming.length);
    for (const route of incoming) inspectorRoute(route);
  } else if (selection.kind === "route") {
    const route = lastGood.routes.find(r => r.id === selection.id);
    if (!route) return;
    inspectorTitle("Route · " + route.outcome);
    inspectorLine("Route Source", route.routeSource);
    inspectorLine("Source Node", route.source);
    inspectorLine("Outcome", route.outcome);
    inspectorLine("Target", route.target);
    inspectorLine("Source", "L" + route.line);
    inspector.appendChild(button("定位 Route 源码", () => lineJump(route.line), "source-link"));
  }
  const note = document.createElement("p");
  note.className = "subtle-note";
  note.textContent = "结构化写回未启用：Typed Patch / Round-trip / Validator 尚未在浏览器端接入。";
  inspector.appendChild(note);
}
function renderProblems() {
  problems.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = "Problems · 仅投影解析反馈";
  problems.appendChild(title);
  const items = projection?.diagnostics ?? [];
  if (!items.length) {
    const text = document.createElement("span");
    text.textContent = "当前有限 Profile 可投影；不代表完整 YAML 或 Runtime 验证通过。";
    problems.appendChild(text);
  } else {
    for (const item of items) {
      const b = button("L" + item.line + " · " + item.message, () => lineJump(item.line));
      problems.appendChild(b);
    }
  }
}
function selectNode(id) {
  if (projection?.state !== "READY") return;
  selection = { kind: "node", id };
  renderOutline();
  renderInspector();
  renderGraph();
}
function selectRoute(id) {
  if (projection?.state !== "READY") return;
  selection = { kind: "route", id };
  renderOutline();
  renderInspector();
  renderGraph();
}
function transform() { world.setAttribute("transform", "translate(" + camera.x + "," + camera.y + ") scale(" + camera.scale + ")"); }
function fit() {
  if (!graph) return;
  const rect = graphPane.getBoundingClientRect();
  if (rect.width < 80 || rect.height < 80) return;
  const scale = Math.min(1.1, Math.max(0.14, Math.min((rect.width - 60) / graph.width, (rect.height - 60) / graph.height)));
  camera = { scale, x: (rect.width - graph.width * scale) / 2, y: (rect.height - graph.height * scale) / 2 };
  transform();
}
function zoomTo(scale, x = svg.clientWidth / 2, y = svg.clientHeight / 2) {
  const updated = Math.min(2.2, Math.max(0.13, scale));
  const ratio = updated / camera.scale;
  camera.x = x - (x - camera.x) * ratio;
  camera.y = y - (y - camera.y) * ratio;
  camera.scale = updated;
  transform();
}
$("zoomIn").addEventListener("click", () => zoomTo(camera.scale * 1.18));
$("zoomOut").addEventListener("click", () => zoomTo(camera.scale / 1.18));
$("fit").addEventListener("click", fit);
svg.addEventListener("wheel", event => {
  event.preventDefault();
  const rect = svg.getBoundingClientRect();
  zoomTo(camera.scale * (event.deltaY < 0 ? 1.12 : 0.88), event.clientX - rect.left, event.clientY - rect.top);
}, { passive: false });
svg.addEventListener("pointerdown", event => {
  if (event.button !== 0 || event.target.closest("[data-selectable]")) return;
  dragging = { x: event.clientX, y: event.clientY, startX: camera.x, startY: camera.y };
  svg.setPointerCapture(event.pointerId);
});
svg.addEventListener("pointermove", event => {
  if (!dragging) return;
  camera.x = dragging.startX + event.clientX - dragging.x;
  camera.y = dragging.startY + event.clientY - dragging.y;
  transform();
});
svg.addEventListener("pointerup", () => { dragging = null; });
svg.addEventListener("pointercancel", () => { dragging = null; });
window.addEventListener("resize", () => { if (mode !== "source") fit(); });

function renderGraph() {
  world.replaceChildren();
  if (!graph || !lastGood) return;
  const edgesGroup = svgEl("g", { class: "edges" });
  for (const bundle of graph.bundles) {
    const a = graph.positions.get(bundle.source);
    const b = graph.positions.get(bundle.target);
    if (!a || !b) continue;
    const selected = selection?.kind === "route" && bundle.routes.some(r => r.id === selection.id);
    const reverse = b.x <= a.x;
    const sx = a.x + 222, sy = a.y + 37, tx = reverse ? b.x + 111 : b.x, ty = b.y + 37;
    const bend = reverse ? Math.max(110, Math.abs(tx - sx) * .5) : Math.max(50, (tx - sx) * .52);
    const d = "M " + sx + " " + sy + " C " + (sx + bend) + " " + sy + ", " + (tx - bend) + " " + ty + ", " + tx + " " + ty;
    const group = svgEl("g", { class: selected ? "edge selected" : "edge", "data-selectable": "route", tabindex: "0", role: "button", "aria-label": bundle.source + " to " + bundle.target + ": " + bundle.outcomes.join(", ") });
    group.appendChild(svgEl("path", { d, class: "edge-path", "marker-end": "url(#arrowhead)" }));
    group.appendChild(svgEl("path", { d, class: "edge-hit" }));
    const cx = (sx + tx) / 2, cy = (sy + ty) / 2 - 8;
    const text = bundle.outcomes.join(" / ");
    const short = text.length > 34 ? text.slice(0, 31) + "…" : text;
    group.appendChild(svgEl("rect", { x: cx - Math.max(33, short.length * 3.2 + 12), y: cy - 14, rx: 8, width: Math.max(66, short.length * 6.4 + 24), height: 23, class: "edge-label-bg" }));
    group.appendChild(svgEl("text", { x: cx, y: cy + 2, "text-anchor": "middle", class: "edge-label" }, short));
    group.addEventListener("click", () => selectRoute(bundle.routes[0].id));
    group.addEventListener("keydown", event => { if (event.key === "Enter") selectRoute(bundle.routes[0].id); });
    edgesGroup.appendChild(group);
  }
  const nodesGroup = svgEl("g", { class: "nodes" });
  for (const node of lastGood.nodes) {
    const p = graph.positions.get(node.id);
    const selected = selection?.kind === "node" && selection.id === node.id;
    const classes = "node " + (node.operator === "terminal" ? "terminal " : "") + (selected ? "selected" : "");
    const group = svgEl("g", { transform: "translate(" + p.x + "," + p.y + ")", class: classes, "data-selectable": "node", tabindex: "0", role: "button", "aria-label": node.id + ", " + node.operator + " " + node.value });
    group.appendChild(svgEl("rect", { width: 222, height: 74, rx: 13, class: "node-body" }));
    group.appendChild(svgEl("text", { x: 13, y: 19, class: "node-kind" }, node.operator.toUpperCase() + (node.id === lastGood.start ? " · START" : "")));
    group.appendChild(svgEl("text", { x: 13, y: 40, class: "node-title" }, node.id.length > 28 ? node.id.slice(0, 27) + "…" : node.id));
    group.appendChild(svgEl("text", { x: 13, y: 59, class: "node-meta" }, node.value.length > 30 ? node.value.slice(0, 29) + "…" : node.value));
    group.addEventListener("click", () => selectNode(node.id));
    group.addEventListener("keydown", event => { if (event.key === "Enter") selectNode(node.id); });
    nodesGroup.appendChild(group);
  }
  world.append(edgesGroup, nodesGroup);
  transform();
}
$("openButton").addEventListener("click", () => filePicker.click());
filePicker.addEventListener("change", async () => {
  const file = filePicker.files?.[0];
  if (!file) return;
  filePicker.value = "";
  if (file.size > 1024 * 1024) { message("只支持 1 MiB 以内的本地文本文件"); return; }
  if (source.value !== initialText && !confirm("尚有未导出的修改。确定载入其他文件？")) return;
  try {
    const text = await file.text();
    if (text.includes("\u0000")) throw new Error("检测到二进制内容");
    loadDocument(file.name, text);
  } catch (error) { message("本地读取失败：" + String(error?.message ?? error)); }
});
$("sampleButton").addEventListener("click", async () => {
  if (source.value !== initialText && !confirm("尚有未导出的修改。确定重载样本？")) return;
  await loadSample();
});
async function loadSample() {
  try {
    const response = await fetch("./samples/ensure-pdu-session.procedure.yaml", { cache: "no-cache" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    loadDocument("ensure-pdu-session.procedure.yaml", await response.text());
  } catch (error) {
    message("样本加载失败，请从本地打开 YAML：" + String(error?.message ?? error));
    setMode("source");
  }
}
$("downloadButton").addEventListener("click", () => {
  const data = new Blob([source.value], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  message("已请求浏览器导出；请确认下载完成。工作区文件未被直接覆盖。");
});
$("resetButton").addEventListener("click", () => {
  if (source.value !== initialText && !confirm("丢弃全部本地修改？")) return;
  source.value = initialText;
  refresh(true);
});
document.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    $("downloadButton").click();
  }
});
loadSample();
