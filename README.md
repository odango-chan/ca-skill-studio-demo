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

- 固定 **Ensure Session / CreatedSession** 示例 Package 的真实 Runtime 相关文件导航、Source 编辑；Markdown 安全预览、文件下载与 ZIP 打包。**Local Open 目前只支持单文件**，不是完整磁盘 Package。
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
