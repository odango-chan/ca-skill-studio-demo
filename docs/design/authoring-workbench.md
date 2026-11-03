# Current Authoring Workbench · Source-backed Editing

**Status: Accepted · Date: 2026-11-03**  
**Verified implementation baseline: `main@69bd8ef5900c68fff85653619eda770599ac9d3a`**

本文件描述当前浏览器应用行为；早期 [UX Consolidation](../ux/ux-consolidation.md) 的“View 菜单 / CreatedSession 只读 / 单文件视图”为已退役阶段描述。

## UI / Source flow

- 顶部：当前文件名、Dirty、Undo/Redo、导出。内存文件工作副本为唯一可写源。
- Explorer：固定样本 Package 实际文件和路径；`procedure.yaml` 的 Root/Child 是**当前文件内**的导航子树。Root workflow 图标、Child git-branch，不能冒充两个不同文件。
- NODES：可折叠当前 Procedure 顺序导航，按 Operator 图标区分。主画布由 React Flow + ELK 投影。
- Visual / Source / Split 同一工作副本；布局默认 DOWN，可切 RIGHT；邻居视图、Route 标签、定位、适配直接在 toolbar，Zoom 在画布左下。**没有 View dropdown**。
- 单一 Inspector：选中 Node/Route 后按 `preconditions → operator → postconditions → routes` 显示；Phase Step 在 Inspector 内，不创建假业务 Node。
- Problems：语法失败及 editor-only warnings，**不是 Runtime Validator**。

| File / state | Visual | Source | Split |
|---|---|---|---|
| Procedure YAML 当前投影 READY | React Flow | 编辑 | 图和 YAML |
| SKILL.md / Markdown 安全子集 | Markdown 预览 | 编辑 | 预览和文本 |
| Contract / Predicate / Script / Schema / JSON | 无专用图形 | 编辑 | 不适用 |
| Procedure 解析/投影失败 | 清除旧图、无 Graph 修改 | 保留原文和诊断 | 不适用 |

固定样本的多文件切换保留内存文本；本地 Open 仅单文件。Download/ZIP 是浏览器下载，不是原位保存/磁盘 watcher。无本机 Script、Runtime 或 5GC 调用。

## Current implementation invariants

- `yaml@2.9.1` AST/CST/span → `site/workspace.mjs` → `site/graph.mjs`、`site/layout.mjs` → `site/react-flow-projection.mjs`、`site/react-flow-canvas.tsx`。ELK 坐标与选中状态不反写 YAML。
- 1 文件最多 1 MiB；每 Procedure 300 Node/1600 Route entries；32 Procedure。全图超过 90 可见节点或 250 Route 使用基础布局，缩小邻居范围可回 ELK。
- Bundle identity 应区分 `source + target + routeSource`。保留每个 Outcome 的来源、ID、目标与 Source Span，不允许混合 Operator/Phase。
- **当前有限的** Node 编辑：`site/node-designer.mjs` 重命名，`node-create.mjs` 在已有 Route 上插入 terminal/call/verify，`node-delete.mjs` 受限 merge/bypass，`node-attributes.mjs` 修改现有 Operator scalar / `with.<key>.from`。这些不是任意 Node/Binding/Phase 创建。
- 现有 Route Target Patch：`site/visual-route-edit.mjs` 接收被允许的目标，走完整源码 Diff；**不是**创建新的 Route。
- 任何 Visual Patch 都先源文 revision+span+资格、后重新解析/结构比对、预览 Diff、确认、撤销。源已变化或者歧义时拒绝。
- `site/package-audit.mjs` 是保守编辑期提示，可能不完整；绿色 CI 不能代替 Demo/Runtime Validator。
- `site/icons.mjs` 是本地描边 SVG 的唯一图标源，不散落混用字符图标。

## Technology and boundaries

React 19、React Flow 12、ELK 0.12、YAML 2.9、TypeScript 7、esbuild，静态浏览器 Bundle。坚持一个 Inspector、Source-only 降级、负面测试；不重新引入 Node Quick Card、Python POC Server 或 CreatedSession 专用平行 CRUD。

[已完成 D1](../D1-procedure-designer.md) / [D2](../D2-node-designer.md) 是里程碑记录；[D3 Route 设计](route-designer.md) 仅 Proposed。
