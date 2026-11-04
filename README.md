# ConnectionAgent · Skill Studio Demo

**Source-first 的浏览器端 Skill Package 编辑原型**。D1 React Flow / ELK 与 D2 A1–A5 有界编辑已完成；当前不是 Agent Runtime、5GC 控制台或完整 Runtime Validator。

[在线 Demo](https://odango-chan.github.io/ca-skill-studio-demo/) · [当前实现与验收](docs/WORK.md) · [开发文档地图](docs/README.md)

## 本地运行

需要 Node.js 24。在仓库根目录：

~~~bash
npm ci
npm test
npm run typecheck
npm run build
python3 -m http.server 8080 --directory dist
~~~

浏览器打开 http://localhost:8080。请使用已打包的 `dist/`，不要将 `site/index.html` 直接当成可运行的 TSX 原生页面。

## 现有能力

- 唯一可选示例为 **`establish-pdu-session`**（启动默认加载，`references/` 默认展开），使用原始 SKILL 目录名；支持真实 Runtime 相关文件导航、Source 编辑、Markdown 安全预览、文件下载和 ZIP 打包。示例已对齐 [ca-agent-demo@7570b309](https://github.com/odango-chan/ca-agent-demo/tree/7570b309a998580a6952352e2bf4b1c19e5c710d/skills/establish-pdu-session)：更新 `SKILL.md`，增加可展开的 `references/` 三份 Markdown（共 16 文件）。**Local Open 目前只支持单文件**，不是完整磁盘 Package。
- 多 Procedure 和 Root/Child 下钻、Node / Phase Step / Outcome / Route 投影；React Flow + ELK 默认垂直布局，完整大图支持保守降级。
- D2 有界 Node 重命名、在已有 Route 上插入少数 Node、受限删除、编辑已有 Operator 与 `with.<key>.from`，以及既有 Route Target 有界重连；所有 Visual 修改遵循 Source-backed Patch → Diff → Confirm → Undo/Redo。
- 编辑期 Package 引用提醒、语法失败 Source 恢复，以及一致描边 SVG 图标。**编辑期提示不等于 Runtime qualification。**

浏览器工作副本只存内存。Download/ZIP 是下载，**不是原地 Save**，不修改 `ca-agent-demo` 或 Runtime。

## 技术与边界

React 19 / React Flow 12 / ELK / TypeScript 7 / YAML 2.9.1 / Node 24 / esbuild。原始 YAML/Markdown/Script Source 是唯一业务真源；图、布局、Inspector 和状态均是派生视图。

单测、Chromium 和 Pages PASS 只证明本仓被实际覆盖的行为，不代表完整 Skill Runtime、Case、跨仓联调或 5GC E2E PASS。

开发前先读 [AGENTS.md](AGENTS.md)、[WORK](docs/WORK.md)、[TRACEABILITY](docs/TRACEABILITY.md)。现有架构与编辑约束详见 [Workbench](docs/design/authoring-workbench.md)；[D3 Route Designer](docs/design/route-designer.md) 已完成 A1 有界 Outcome 新增和 [A2 受限重命名/删除](https://github.com/odango-chan/ca-skill-studio-demo/pull/11)，[A3 实际画布拖线](https://github.com/odango-chan/ca-skill-studio-demo/pull/13) 已通过编辑器级验收（仅有界 `operator.on`），统一跟踪 [#7](https://github.com/odango-chan/ca-skill-studio-demo/issues/7)。

早期 [PR #1](https://github.com/odango-chan/ca-skill-studio-demo/pull/1)（初始架构）、[PR #2](https://github.com/odango-chan/ca-skill-studio-demo/pull/2)（Python 编辑 POC）、[PR #3](https://github.com/odango-chan/ca-skill-studio-demo/pull/3)（早期 TypeScript Pages）都还是**未合并的历史候选**，不代表 `main` 的实际实现。文档治理基线完成记录 [#6](https://github.com/odango-chan/ca-skill-studio-demo/issues/6)。

画布缩放提供三个并列按钮：**适配**（完整流程）、**横向**（宽度铺满）、**纵向**（高度铺满）。它们只改变当前流程图的视口，不会修改 Source，更多细节见 [Workbench](docs/design/authoring-workbench.md)。

D4 Phase Designer 的 A1 已实现有界的 Phase Step 编辑；目前只允许在 Inspector 中将已有 `with.<key>.from` 更换为当前 Procedure 中声明、且类型相同的 `input.*`，不增加流程图节点或改变步骤顺序。见 [D4 设计](docs/design/phase-designer.md) 与 [Issue #15](https://github.com/odango-chan/ca-skill-studio-demo/issues/15)。

D4-A2.1 新增受限的 Phase Step 输出引用编辑：仅在当前 Procedure 原文已经使用过两种写法、且指向同一已执行 Step 和相同输出字段时，提供局部与全限定引用切换；仍不涉及跨生产者重连或 Runtime 输出类型推断。详见 [Phase Designer](docs/design/phase-designer.md) 和 [PR #17](https://github.com/odango-chan/ca-skill-studio-demo/pull/17)。

D4-A2.2a 增加了 Phase Step **只读数据依赖审查**：可以检查上游 Step、执行先后、跨 Node 必经关系，以及本地脚本输出 schema 的声明证据；不会自动修改引用或推断消费参数类型。跨生产者重绑定仍不开放。详见 [D4 设计](docs/design/phase-designer.md) 和 [PR #18](https://github.com/odango-chan/ca-skill-studio-demo/pull/18)。

D4-A2.2b1 已补齐当前有界范围内的**消费者输入契约证据**：当前 Package 内本地脚本的 `# inputSchema` 与唯一同名 schema 可用于展示 `with.<key>` 的消费者字段类型，与源输入/脚本输出的声明类型做只读对照；这不会验证 Runtime 数据可用性、`const`/`pattern` 等约束或 `call` ABI，更不授权跨生产者修改。详见 [D4 Phase Designer](docs/design/phase-designer.md)、[PR #19](https://github.com/odango-chan/ca-skill-studio-demo/pull/19)。

D4-A3a 已通过编辑器级测试，提供最小的 Phase Step 顺序编辑：只允许两个物理相邻且未命名、无绑定的单行 Verify 换序；仍走 Source Diff/确认/Undo/Redo。其余 Step 新增、删除及通用重排仍未实现，见 [D4 设计](docs/design/phase-designer.md)。

D4-A3b1（[PR #30](https://github.com/odango-chan/ca-skill-studio-demo/pull/30) 编辑器级验收通过）允许在已存在 Phase 末尾新增来自当前 PredicateSet 的无名 Verify，或删除明确符合资格的单行 Verify；仍走 Source Diff / 确认 / Undo/Redo，未实现命名或带绑定 Step 的增删和通用依赖感知排序。此处会改变业务检查集合，Runtime/5GC 验证未执行。

D4-A3b2a 编辑器级验收通过，提供命名 Phase Step 的 Source 引用影响与同步改名（[PR #32](https://github.com/odango-chan/ca-skill-studio-demo/pull/32)）；未知或歧义引用一律只读。带输出依赖的删除与重排尚未实现，Runtime/5GC NOT_RUN。

D4-A3b2b1（[PR #34](https://github.com/odango-chan/ca-skill-studio-demo/pull/34) 编辑器级验收通过）提供无引用的纯 Verify Step 命名及受限删除/相邻排序。具副作用或带输出依赖的 script/call 仍保持 Source-only，不宣称 Runtime 安全。

D4-A3b2b2a（[PR #36](https://github.com/odango-chan/ca-skill-studio-demo/pull/36) 编辑器级验收通过）在现有命名 Step「引用影响」中只读展示删除与相邻换序的依赖/副作用门禁；不新增 Script/Call 的危险写操作，Runtime/5GC NOT_RUN。

D4-A4a（[PR #37](https://github.com/odango-chan/ca-skill-studio-demo/pull/37) 编辑器级验收通过）在「准备/确认」阶段允许将现有失败/未知 Route 目标改为同 Procedure、同 Phase、同 Outcome 已观察过的目标；走 Source Diff、确认和 Undo/Redo，不影响主执行 Route，也不声明 Runtime/5GC 安全。

D4-A4b1（[PR #39](https://github.com/odango-chan/ca-skill-studio-demo/pull/39) 编辑器级验收通过）支持在现有 Phase `on` map 中补齐已观察的缺失核心 Outcome，以及受限修正/删除无歧义非核心 Outcome；完整的 owner 示例不会添加分支或显示多余按钮。Runtime/5GC NOT_RUN。

E1 Monaco Source Editor 正在 [PR #40](https://github.com/odango-chan/ca-skill-studio-demo/pull/40) 与最新 D4 主分支整合：本地 Monaco/Worker，YAML、Python、Markdown、JSON 的 Source 编辑，保留唯一工作副本及 Source/Visual/Split、Diff/确认/Undo/Redo；初始化失败回退原有文本编辑器。[322/322 + real Chromium 代码 CI PASS](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41796287748)，最终 main/Pages 验收尚待确认，参见 [E 线设计](docs/design/source-editor-workstream.md)。
