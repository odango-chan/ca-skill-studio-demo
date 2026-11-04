# Current Authoring Workbench · Source-backed Editing

**Status: Accepted · Date: 2026-11-03**  
**Verified implementation baseline: `main@69bd8ef5900c68fff85653619eda770599ac9d3a`**

本文件描述当前浏览器应用行为；早期 [UX Consolidation](../ux/ux-consolidation.md) 的“View 菜单 / CreatedSession 只读 / 单文件视图”为已退役阶段描述。

## UI / Source flow

- 顶部：当前文件名、Dirty、Undo/Redo、导出。内存文件工作副本为唯一可写源。
- Explorer：固定样本 Package 实际文件和路径；`procedure.yaml` 的 Root/Child 是**当前文件内**的导航子树。Root workflow 图标、Child git-branch，不能冒充两个不同文件。
- NODES：可折叠当前 Procedure 顺序导航，按 Operator 图标区分。主画布由 React Flow + ELK 投影。
- Visual / Source / Split 同一工作副本；布局默认 DOWN，可切 RIGHT；邻居视图、Route 标签、定位、**适配全部 / 横向铺满 / 纵向铺满**直接在 toolbar，Zoom ± 仍在画布左下。**没有 View dropdown**。横向/纵向只缩放并居中当前 Procedure 的可见节点范围，允许另一轴溢出；默认打开仍使用适配全部。当前选择会在布局重算和浏览器调整尺寸后继续应用，切换文件后恢复为适配全部。
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
- 现有 Route Target Patch：`site/visual-route-edit.mjs` 接收被允许的目标，走完整源码 Diff。
- D3-A1 已合入：`site/route-create.mjs` 在现有 `operator.on` 中新增一个源可证明的候选 Outcome。D3-A2 已合入主分支：`site/route-mutate.mjs` 有界重命名或删除一个 Route 条目，保留其他 source identity 和评论。D3-A3 已实现专用画布加号拖线，只创建待确认提案，并通过 Inspector 显式选择 Outcome 后复用 A1 YAML Patch；**不等于**任意 Phase 路由或 Runtime 语义验证。
- 任何 Visual Patch 都先源文 revision+span+资格、后重新解析/结构比对、预览 Diff、确认、撤销。源已变化或者歧义时拒绝。
- `site/package-audit.mjs` 是保守编辑期提示，可能不完整；绿色 CI 不能代替 Demo/Runtime Validator。
- `site/icons.mjs` 是本地描边 SVG 的唯一图标源，不散落混用字符图标。

## Technology and boundaries

React 19、React Flow 12、ELK 0.12、YAML 2.9、TypeScript 7、esbuild，静态浏览器 Bundle。坚持一个 Inspector、Source-only 降级、负面测试；不重新引入 Node Quick Card、Python POC Server 或 CreatedSession 专用平行 CRUD。

[已完成 D1](../D1-procedure-designer.md) / [D2](../D2-node-designer.md) 是里程碑记录；[D3 Route 设计](route-designer.md) 仅 Proposed。

## Axis-fit viewport controls (2026-11-03)

- Three explicit controls adjacent in the existing main graph toolbar: **适配** (fit entire current graph, default), **横向** (fit visible graph width), **纵向** (fit visible graph height). This does **not** change the graph's layout direction selector (垂直 / 水平).
- Width/height modes compute the active graph's visible node bounding box using the same 238 × 80 React Flow node footprint, with 24 px canvas padding and the existing min/max zoom limits (0.05–2.5). The opposite axis stays centered and may overflow; users can pan or zoom afterward.
- Current Procedure, Child Procedure, neighbor-scoped view, ELK layout and large-graph fallback are treated independently. All three are view actions only: **no Source Patch, no YAML change, no extra graph model**.
- The requested mode survives layout recalculation and window resizing. On opening another document it resets to default whole-graph fit.
- Browser acceptance checks actual node bounds and viewport zoom for both ELK orientations, the three controls, resize behavior and Source-byte identity; unit tests verify math and huge graph bounds.

## D4 Phase Designer · A1 bounded candidate

Phase Steps 继续是 Node Inspector 内的有序行，**不是**主业务图中的 Node。D4-A1 只更改已经存在的 Step `with.<key>.from`，且源值和候选值必须均为**当前 Procedure 已声明、且类型完全一致的 `input.*`**。原有 Step Operator、Step name、顺序、Phase 路由和 Node/Child 结构不改变。

必须经过精确 YAML Source span、重新解析与语义对比、Diff/确认、Undo/Redo。虽然 input 的 `type` 相同，也不代表工具参数语义或 Runtime 类型完全相容。任何未资格化 Step/引用都仅支持 Source 编辑。详细约束见 [D4 Phase Designer](phase-designer.md)。

## D4-A2.1 已观察的 Phase 输出引用写法

已有 Step `with.<key>.from` 在本 Procedure Source 中同时出现了局部和自身 Node 全限定的**同一个**先行命名 Step 的输出引用时，Inspector 可以提供两种已观察写法的切换。生产者身份、Step 顺序、输出字段后缀都保持不变。精确 Source Span → Diff → 确认 → Undo/Redo；不支持跨 Node 换生产者、凭字段名猜类型或向未来 Step 取值。**两种写法已出现，不等于 Runtime 确认语义等价。** 完整边界和证据见 [D4 设计](phase-designer.md)。

## D4-A2.2a · 数据依赖审查（只读）

每个带 `with.from` 的 Phase Step 可展开「数据依赖」：展示原始来源、输入/命名 Step/主 Operator 的生产者位置、同 Phase 执行先后及跨 Node 图结构的必经关系，并在本地脚本输出元信息可唯一定位对应 schema 时展示输出字段的**声明类型**。所有项均只读，附源码行定位。来源存在并不等于结果一定可用；声明了输出类型也不等于消费者字段 ABI 匹配。正式跨生产者/字段重绑定仍不开放，详见 [D4 设计](phase-designer.md)。

## CreatedSession 示例同步 · 可选 Reference 文件

示例的最新 owner 基线为 [ca-agent-demo@7570b309](https://github.com/odango-chan/ca-agent-demo/tree/7570b309a998580a6952352e2bf4b1c19e5c710d/skills/establish-pdu-session)。
本仓的 CreatedSession Package 只同步实际运行时相关材料（16 个文件），保留原始目录路径：更新的 `SKILL.md`、
`references/3gpp-procedure.md`、`references/session-selection.md`、`references/failure-handling.md`；
`assurance/`、`schemas/`、`scripts/` 内容与 owner 当前版本 SHA 一致，因此没有修改。
示例不复制验证 Case 或内部设计记录。Ensure Session 仍固定其之前的独立基线。

Explorer 内 `references/` 目录可展开，三个 `.md` 文件使用现有安全 Markdown Visual / Source / Split，
修改仅作用于当前文件的内存工作副本，Undo/Redo 独立保留；导出 Package ZIP 时文件路径与内容原样保存。
Studio 本身**不是** Agent Host 的 `read_reference`，不会替模型自行选择/读取业务参考内容。
引用是可选知识材料，不是新的 Procedure 执行节点、实时 Observation 或 Runtime 成功证据。

验收包含 owner blob SHA 校验、引用路径及安全预览、16 文件 ZIP、真实浏览器的文件夹导航、
三文档预览、编辑/Undo/Redo、返回原 17 Node 的 Procedure。参见 [PR #20](https://github.com/odango-chan/ca-skill-studio-demo/pull/20)。
