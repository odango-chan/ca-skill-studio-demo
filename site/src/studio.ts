/** Browser-only Skill Studio preview. Source is authoritative; no Skill execution. */
type SkillKey = 'ensure' | 'establish';
type Route = { outcome: string; target: string };
type ProcedureNode = { id: string; kind: 'verify' | 'call' | 'terminal' | 'other'; value: string; propertyLine: number; routes: Route[] };
type Projection = { name: string; start: string; nodes: ProcedureNode[]; error?: string };
type Working = { text: string; initial: string; history: string[]; future: string[]; draft: string; imported: boolean };

const samples: Record<SkillKey, Working | null> = { ensure: null, establish: null };
let skill: SkillKey = 'ensure';
let selected = '';
let projection: Projection = { name: '', start: '', nodes: [] };
let pending: { text: string; reason: string } | null = null;
let visualTab = true;
let zoom = 1;
let panX = 24, panY = 22;
let graphWidth = 1000, graphHeight = 600;
const svgNS = 'http://www.w3.org/2000/svg';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const html = (s: string): string => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const linesOf = (s: string) => s.split(/\r?\n/);
const active = (): Working => { const x = samples[skill]; if (!x) throw new Error('Sample source not loaded'); return x; };
function setStatus(message: string) { el('footer-status').textContent = message; }
function toast(message: string) {
  const t = el('toast'); t.textContent = message; t.classList.add('visible');
  window.setTimeout(() => t.classList.remove('visible'), 3300);
}
function indentation(s: string) { return s.length - s.trimStart().length; }
function withoutComment(v: string) { return v.replace(/\s+#.*$/, '').trim().replace(/^(['"])(.*)\1$/, '$2'); }

/** A conservative structural projection; not a YAML 1.2 validator. */
function project(text: string): Projection {
  const lines = linesOf(text), result: Projection = { name: '', start: '', nodes: [] };
  let underRoot = false, inProcedure = false, inNodes = false;
  let current: ProcedureNode | null = null, inRoutes = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const ind = indentation(line), value = line.trim();
    if (ind === 0) {
      underRoot = value === 'procedures:';
      inProcedure = false; inNodes = false; current = null;
      continue;
    }
    if (!underRoot) continue;
    if (ind === 2 && /^([a-zA-Z][\w-]*):\s*$/.test(value)) {
      result.name = value.slice(0, -1); inProcedure = true; inNodes = false; current = null;
      continue;
    }
    if (!inProcedure) continue;
    if (ind === 4) {
      inNodes = value === 'nodes:'; current = null;
      if (value.startsWith('start:')) result.start = withoutComment(value.slice(6));
      continue;
    }
    if (!inNodes) continue;
    if (ind === 6 && /^[a-zA-Z][\w-]*:\s*$/.test(value)) {
      current = { id: value.slice(0, -1), kind: 'other', value: '', propertyLine: -1, routes: [] };
      result.nodes.push(current); inRoutes = false;
      continue;
    }
    if (!current) continue;
    if (ind === 8) {
      const match = /^(verify|call|terminal):\s*(.*?)\s*$/.exec(value);
      if (match) { current.kind = match[1] as ProcedureNode['kind']; current.value = withoutComment(match[2]); current.propertyLine = i; }
      inRoutes = /^(?:on|'on'|"on"):\s*$/.test(value);
      continue;
    }
    if (inRoutes && ind === 10) {
      const match = /^([A-Z_]+):\s*([\w-]+)(?:\s+#.*)?$/.exec(value);
      if (match) current.routes.push({ outcome: match[1], target: match[2] });
    }
  }
  if (!result.name || !result.nodes.length) result.error = '未找到符合当前 Demo 结构的 Procedure / Nodes。仍可在 Source 中编辑与导出。';
  return result;
}

const graph = el<HTMLElement>('graph');
function svg(tag: string, attrs: Record<string, string | number> = {}, value?: string): SVGElement {
  const element = document.createElementNS(svgNS, tag);
  Object.entries(attrs).forEach(([key, val]) => element.setAttribute(key, String(val)));
  if (value !== undefined) element.textContent = value;
  return element;
}

function layoutNodes(nodes: ProcedureNode[], start: string): Map<string, { x: number; y: number }> {
  const lookup = new Map(nodes.map(n => [n.id, n]));
  const depth = new Map<string, number>();
  const todo = [start]; depth.set(start, 0);
  for (let k = 0; k < todo.length; k++) {
    const id = todo[k];
    const n = lookup.get(id);
    if (!n) continue;
    for (const route of n.routes) {
      if (lookup.has(route.target) && !depth.has(route.target)) {
        depth.set(route.target, Math.min(16, (depth.get(id) ?? 0) + 1)); todo.push(route.target);
      }
    }
  }
  const groups = new Map<number, string[]>();
  for (const node of nodes) {
    const d = depth.get(node.id) ?? Math.min(16, (groups.size || 1) + 2);
    const list = groups.get(d) ?? []; list.push(node.id); groups.set(d, list);
  }
  const positions = new Map<string, { x: number; y: number }>();
  for (const [d, ids] of groups) ids.forEach((id, i) => positions.set(id, { x: 44 + d * 260, y: 48 + i * 105 }));
  graphWidth = Math.max(900, (Math.max(...groups.keys(), 1) + 1) * 260 + 260);
  graphHeight = Math.max(500, ...Array.from(groups.values()).map(ids => ids.length * 105 + 90));
  return positions;
}

function drawGraph() {
  const vp = document.getElementById('viewport') as unknown as SVGGElement;
  vp.replaceChildren();
  const positions = layoutNodes(projection.nodes, projection.start);
  vp.setAttribute('transform', `translate(${panX} ${panY}) scale(${zoom})`);
  const refs = new Map(projection.nodes.map(n => [n.id, n]));
  for (const node of projection.nodes) {
    const from = positions.get(node.id)!;
    node.routes.forEach((route, i) => {
      const to = positions.get(route.target);
      if (!to) return;
      const x1 = from.x + 198, y1 = from.y + 35 + (i - Math.max(0, node.routes.length - 1) / 2) * 3;
      const x2 = to.x, y2 = to.y + 35;
      const dx = Math.max(46, Math.abs(x2 - x1) * .5);
      const path = svg('path', { d: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`, class: 'link', 'marker-end': 'url(#arrow)' });
      vp.appendChild(path);
      if (i < 3 && Math.abs(y2 - y1) < 300) vp.appendChild(svg('text', { x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) - 7, class: 'link-label', 'text-anchor': 'middle' }, route.outcome));
    });
  }
  projection.nodes.forEach((node, i) => {
    const p = positions.get(node.id)!;
    const g = svg('g', { transform: `translate(${p.x}, ${p.y})`, class: `graph-node ${node.id === selected ? 'selected' : ''}`, tabindex: '0', role: 'button', 'aria-label': node.id });
    g.appendChild(svg('rect', { x: 3, y: 5, rx: 9, width: 198, height: 70, class: 'node-shadow' }));
    g.appendChild(svg('rect', { x: 0, y: 0, rx: 9, width: 198, height: 70, class: 'node-frame' }));
    g.appendChild(svg('text', { x: 15, y: 24, class: 'node-id' }, node.id.length > 25 ? node.id.slice(0, 23) + '…' : node.id));
    g.appendChild(svg('text', { x: 15, y: 47, class: 'node-sub' }, `${node.kind.toUpperCase()} · ${node.value.length > 20 ? node.value.slice(0, 18) + '…' : node.value}`));
    g.appendChild(svg('text', { x: 185, y: 61, class: 'node-number', 'text-anchor': 'end' }, String(i + 1)));
    g.addEventListener('click', ev => { ev.stopPropagation(); selectNode(node.id); });
    g.addEventListener('keydown', ev => { if ((ev as KeyboardEvent).key === 'Enter') selectNode(node.id); });
    vp.appendChild(g);
  });
  el('graph-meta').textContent = `${refs.size} nodes · ${projection.nodes.reduce((s, n) => s + n.routes.length, 0)} routes`;
}

function selectNode(id: string) { selected = id; drawGraph(); drawInspector(); drawNodeList(); }
function drawNodeList() {
  const list = el('node-list'); list.replaceChildren();
  const filter = el<HTMLInputElement>('node-filter').value.trim().toLowerCase();
  for (const n of projection.nodes) {
    if (filter && !n.id.toLowerCase().includes(filter)) continue;
    const button = document.createElement('button'); button.className = 'node-entry' + (n.id === selected ? ' selected' : '');
    const bullet = document.createElement('span'); bullet.className = 'node-type-indicator ' + n.kind;
    const label = document.createElement('span'); label.className = 'node-entry-text'; label.textContent = n.id;
    button.append(bullet, label); button.onclick = () => selectNode(n.id); list.appendChild(button);
  }
}

function drawInspector() {
  const area = el('inspector-body'); area.replaceChildren();
  const node = projection.nodes.find(n => n.id === selected);
  if (!node) { area.innerHTML = '<p class="inspector-empty">选择流程图中的节点查看其属性。</p>'; return; }
  const editable = skill === 'ensure' && node.propertyLine >= 0 && node.kind !== 'other';
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="property-section"><div class="property-title">NODE</div><div class="property-heading">${html(node.id)}</div><span class="type-tag ${html(node.kind)}">${html(node.kind.toUpperCase())}</span></div><div class="property-section"><label class="property-label" for="node-property">${html(node.kind)} property</label><input id="node-property" class="property-input" value="${html(node.value)}" ${editable ? '' : 'disabled'} /><div class="property-note">${editable ? '修改后先预览精确源码 Diff，再确认应用。' : '当前语法仅提供 Source 编辑。'}</div></div><div class="property-section"><div class="property-title">OUTCOME ROUTES</div></div>`;
  const routes = wrap.lastElementChild!;
  if (!node.routes.length) routes.appendChild(Object.assign(document.createElement('p'), { className: 'property-note', textContent: 'No routes' }));
  for (const route of node.routes) {
    const row = document.createElement('div'); row.className = 'route-row';
    const outcome = document.createElement('span'), target = document.createElement('span');
    outcome.textContent = route.outcome; target.textContent = route.target; row.append(outcome, target); routes.appendChild(row);
  }
  area.appendChild(wrap);
  if (editable) {
    const button = document.createElement('button'); button.className = 'primary-btn inspector-apply'; button.textContent = 'Review Typed Patch';
    button.onclick = () => {
      const next = (el<HTMLInputElement>('node-property').value ?? '').trim();
      if (!/^[a-zA-Z][a-zA-Z0-9_.-]*$/.test(next)) { toast('只允许受限的标识符；复杂文本请用 Source。'); return; }
      if (next === node.value) { toast('属性没有变化。'); return; }
      const original = active().text, rows = linesOf(original);
      if (node.propertyLine < 0 || !rows[node.propertyLine]) { toast('源码位置已过期，请重新加载。'); return; }
      const prefix = new RegExp(`^(\\s*${node.kind}:\\s*)`);
      if (!prefix.test(rows[node.propertyLine])) { toast('目标字段已变化，拒绝提交。'); return; }
      const previous = rows[node.propertyLine];
      const changed = previous.replace(prefix, `$1${next}`);
      if (changed === previous || previous.includes('#') || original.includes('&') && original.includes('*')) { toast('无法安全保留源文本，请切到 Source。'); return; }
      rows[node.propertyLine] = changed;
      previewChange(rows.join(original.includes('\r\n') ? '\r\n' : '\n'), `Typed Patch · ${node.id}.${node.kind}`);
    };
    area.appendChild(button);
  }
}

function diffLines(before: string, after: string): string {
  const a = linesOf(before), b = linesOf(after);
  let prefix = 0; while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0; while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - suffix - 1] === b[b.length - suffix - 1]) suffix++;
  const pre = a.slice(Math.max(0, prefix - 3), prefix).map(x => '  ' + x);
  const removed = a.slice(prefix, a.length - suffix).map(x => '- ' + x);
  const added = b.slice(prefix, b.length - suffix).map(x => '+ ' + x);
  const post = a.slice(a.length - suffix, a.length - suffix + 3).map(x => '  ' + x);
  return [...pre, ...removed, ...added, ...post].join('\n') || 'No text changes';
}
function previewChange(text: string, reason: string) {
  const w = active();
  if (text === w.text) { toast('没有变化。'); return; }
  pending = { text, reason };
  el('diff-preview').textContent = `${reason}\n\n${diffLines(w.text, text)}`;
  el<HTMLDialogElement>('review-dialog').showModal();
}
function applyChange() {
  if (!pending) return;
  const w = active(); w.history.push(w.text); w.future = []; w.text = pending.text; w.draft = w.text;
  pending = null; el<HTMLDialogElement>('review-dialog').close(); selected = selected || '';
  render(); toast('变更已应用到浏览器工作区，可 Undo 或 Export YAML。');
}
function undo() {
  const w = active(); if (!w.history.length) return;
  w.future.push(w.text); w.text = w.history.pop()!; w.draft = w.text; render();
}
function redo() {
  const w = active(); if (!w.future.length) return;
  w.history.push(w.text); w.text = w.future.pop()!; w.draft = w.text; render();
}
function render() {
  const w = active(); projection = project(w.text);
  selected = projection.nodes.some(n => n.id === selected) ? selected : (projection.start || projection.nodes[0]?.id || '');
  el('breadcrumb-skill').textContent = skill === 'ensure' ? 'ensure-pdu-session' : 'establish-pdu-session';
  el('breadcrumb-procedure').textContent = projection.name || '(unknown)';
  el('page-title').textContent = projection.name || 'Source workspace';
  el('node-count').textContent = `${projection.nodes.length} NODES`;
  el('footer-nodes').textContent = `${projection.nodes.length} nodes`;
  el('footer-dirty').textContent = w.text === w.initial ? 'No local changes' : 'Unsaved browser changes';
  el('edit-capability').textContent = skill === 'ensure' ? 'Constrained Visual Patch' : 'Source-only transitional syntax';
  el('edit-capability').classList.toggle('source-only', skill !== 'ensure');
  el('mode-pill').textContent = skill === 'ensure' ? 'EDITABLE DEMO' : 'SOURCE ONLY';
  el('mode-pill').classList.toggle('readonly', skill !== 'ensure');
  el('revision-label').textContent = `${w.imported ? 'IMPORTED' : 'PINNED FIXTURE'} · LOCAL BROWSER`;
  el<HTMLTextAreaElement>('source-editor').value = w.draft;
  el('source-state').textContent = w.draft !== w.text ? '● Unreviewed draft' : '● Working source';
  el('tab-visual').classList.toggle('active', visualTab);
  el('tab-source').classList.toggle('active', !visualTab);
  el('visual-view').hidden = !visualTab;
  el('source-view').hidden = visualTab;
  (el<HTMLButtonElement>('btn-undo')).disabled = !w.history.length;
  (el<HTMLButtonElement>('btn-redo')).disabled = !w.future.length;
  if (projection.error) setStatus(projection.error); else setStatus('Ready · YAML projection only; no runtime validation');
  drawNodeList(); drawGraph(); drawInspector();
}
function zoomTo(value: number) { zoom = Math.max(.18, Math.min(2.6, value)); el('zoom-level').textContent = `${Math.round(zoom * 100)}%`; drawGraph(); }
function fit() { const width = graph.clientWidth || 750, height = graph.clientHeight || 550; zoom = Math.max(.18, Math.min(1.1, (width - 70) / graphWidth, (height - 50) / graphHeight)); panX = 15; panY = 16; zoomTo(zoom); }

async function loadSample(k: SkillKey) {
  skill = k; el<HTMLSelectElement>('skill-select').value = skill;
  if (!samples[k]) {
    const response = await fetch(`./fixtures/${k}.yaml`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Fixture HTTP ${response.status}`);
    const text = await response.text();
    samples[k] = { text, initial: text, history: [], future: [], draft: text, imported: false };
  }
  selected = ''; visualTab = true; render(); window.requestAnimationFrame(fit);
}

function saveExport() {
  const w = active(); const blob = new Blob([w.text], { type: 'text/yaml;charset=utf-8' });
  const href = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = href; anchor.download = `${skill}-procedure.edited.yaml`; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 3000);
  toast('YAML 已导出到浏览器下载；不会自动修改仓库或本地原文件。');
}

el<HTMLSelectElement>('skill-select').addEventListener('change', ev => {
  loadSample((ev.target as HTMLSelectElement).value as SkillKey).catch(err => toast(`无法读取样本：${err}`));
});
el<HTMLInputElement>('node-filter').addEventListener('input', drawNodeList);
el('tab-visual').addEventListener('click', () => { visualTab = true; render(); });
el('tab-source').addEventListener('click', () => { visualTab = false; render(); });
el<HTMLTextAreaElement>('source-editor').addEventListener('input', ev => {
  active().draft = (ev.target as HTMLTextAreaElement).value;
  el('source-state').textContent = '● Unreviewed draft';
});
el('btn-source-preview').addEventListener('click', () => previewChange(active().draft, 'Source edit'));
el('btn-apply').addEventListener('click', applyChange);
for (const id of ['btn-cancel', 'close-dialog']) el(id).addEventListener('click', () => { pending = null; el<HTMLDialogElement>('review-dialog').close(); });
el('btn-undo').addEventListener('click', undo);
el('btn-redo').addEventListener('click', redo);
el('btn-export').addEventListener('click', saveExport);
el('btn-import').addEventListener('click', () => el<HTMLInputElement>('file-input').click());
el<HTMLInputElement>('file-input').addEventListener('change', async ev => {
  const file = (ev.target as HTMLInputElement).files?.[0]; if (!file) return;
  if (file.size > 2 * 1024 * 1024) { toast('Demo 导入上限：2 MiB'); return; }
  const value = await file.text();
  const w = active(); w.history.push(w.text); w.text = value; w.draft = value; w.future = []; w.imported = true;
  render(); toast('仅导入浏览器内存；导出前请在 Source 检查内容。');
  (ev.target as HTMLInputElement).value = '';
});
el('btn-zoom-in').addEventListener('click', () => zoomTo(zoom * 1.23));
el('btn-zoom-out').addEventListener('click', () => zoomTo(zoom / 1.23));
el('btn-fit').addEventListener('click', fit);
graph.addEventListener('wheel', ev => { ev.preventDefault(); zoomTo(zoom * (ev.deltaY < 0 ? 1.09 : .92)); }, { passive: false });
let startPan: { x: number; y: number; px: number; py: number } | null = null;
graph.addEventListener('pointerdown', ev => { if ((ev.target as Element).closest('.graph-node')) return; startPan = { x: ev.clientX, y: ev.clientY, px: panX, py: panY }; graph.setPointerCapture(ev.pointerId); });
graph.addEventListener('pointermove', ev => { if (!startPan) return; panX = startPan.px + ev.clientX - startPan.x; panY = startPan.py + ev.clientY - startPan.y; drawGraph(); });
graph.addEventListener('pointerup', () => { startPan = null; });
graph.addEventListener('pointercancel', () => { startPan = null; });
document.addEventListener('keydown', ev => {
  const focus = ev.target as HTMLElement;
  if (focus.matches('textarea, input, select') || el<HTMLDialogElement>('review-dialog').open) return;
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'z') { ev.preventDefault(); ev.shiftKey ? redo() : undo(); }
});
el('btn-bench').addEventListener('click', () => el<HTMLDialogElement>('benchmark-dialog').showModal());
for (const id of ['close-benchmark', 'btn-benchmark-close']) el(id).addEventListener('click', () => el<HTMLDialogElement>('benchmark-dialog').close());
document.querySelectorAll<HTMLButtonElement>('[data-scale]').forEach(button => button.addEventListener('click', () => {
  const count = Number(button.dataset.scale); const start = performance.now();
  // This measures grouping only, not full X6/ReactFlow rendering performance.
  const blocks = Array.from({ length: count }, (_, i) => Math.floor(i / 40));
  const groups = new Set(blocks);
  const elapsed = Math.round((performance.now() - start) * 100) / 100;
  el('bench-result').textContent = `${count.toLocaleString()} simulated nodes → ${groups.size} collapsed groups in ${elapsed} ms. Not an X6 / React Flow benchmark.`;
}));
loadSample('ensure').catch(err => { setStatus('Fixture unavailable'); toast(`无法读取 GitHub Pages Fixture：${err}`); });
