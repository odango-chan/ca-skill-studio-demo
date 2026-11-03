# Procedure Designer · D1 UI 迁移

范围：**只迁移 Procedure 画布**。不修改 SKILL DSL，不重写 Source / Inspector，不增加后端，也不开发 Case/验证发布工作台。

## 技术决策

- React 19 + React Flow 12 + TypeScript/TSX：节点、连线、选择、拖动端点、平移、缩放、键盘交互。
- ELK layered：继续计算位置及正交 Route，默认垂直 DOWN，可切换 RIGHT。
- 原来的 Source YAML 仍为唯一权威。React Flow 不保存独立业务工作流。
- 现有原生文件树、Source/Visual/Split、Markdown 预览、Inspector、Typed Patch、Undo/Redo 和 ZIP 导出保留。

## 数据流

~~~mermaid
flowchart TD
  A[Source YAML] --> B[Semantic projection]
  B --> C[ELK layout]
  C --> D[React Flow view model]
  D --> E[Interactive canvas]
  E -->|Selection| F[Existing Inspector]
  E -->|Allowed Route target| G[Typed Patch]
  F --> G
  G --> H[Diff Preview]
  H -->|Confirmed Apply| A
~~~

画布只消费当前投影的 Node、Route、坐标与标签。Route bundle 保留原始 source、target、routeSource 和完整 Outcome 列表。不得把多个 Outcome 合并成一次业务修改。

## CreatedSession D1 验收基线

| 场景 | 必要表现 |
| --- | --- |
| Root Procedure | 17 Node、65 个原始 Outcome，投影不丢失 |
| Child Procedure | 左侧导航 / 双击单一 Child 节点可以进入 |
| Layout | 默认 DOWN，手动 RIGHT；ELK 失败仍按选定方向显示 |
| Selection | Node 选中显示 Node Journey；Edge 选中映射原始 Outcome |
| Route edit | 现有 Route 重连先查候选 target，经 Diff 确认后才改 Source |
| Source | YAML 变化后更新视图；无法投影时 fail closed |
| Split / zoom | Source 并排、Fit、滚轮缩放、画布左下 + / - |
| Workspace | SKILL.md Markdown 预览、导入导出、Undo/Redo 不回归 |

## D1 文件责任

- site/react-flow-canvas.tsx：React Flow 的挂载、节点和边 UI、视口控制、受控事件。
- site/react-flow-projection.mjs：无 React/DOM 的纯粹、可单测数据映射。
- site/app.mjs：保留 Source 和业务 Patch；将画布事件接回 Inspector / Diff。
- site/layout.mjs：保留 ELK 与路由 identity。
- site/light.css：组件视觉样式；React Flow 基础 CSS 通过 esbuild 打入静态产物。
- package.json / package-lock.json / tsconfig.json：固定依赖与类型门禁。

## 约束与后续

D1 不是完整可视化编辑器，不允许无 Patch 的 Node/Route 创建、删除、重命名或修改 Operator。节点坐标属于视图，不落盘。不能把内存中的边改变冒充 YAML 已修改。

D2 = Node Designer，D3 = Route Designer，D4 = Phase Designer，D5 = 多 Procedure Designer，D6 = 源码双向一致性和浏览器回归强化。

门禁除了 Node 单测、类型检查、CI Build 和 Pages Deploy，仍需真实浏览器覆盖 CreatedSession Root/Child、选择、重连、Split、滚动/缩放和折叠导航。**未完成真实浏览器 E2E 前不可声称此项 PASS**。

## D1 交互验收补全（2026-11-03）

迁移后的流程图不仅要把 CreatedSession 的 17 Node / 48 ELK Route bundle / 65 Outcome 显示正确，还需要验证**现有编辑闭环**。GitHub Actions 在 `npm test`、TypeScript 类型检查和打包之后使用 Headless Chromium 打开实际生成的 `dist/index.html`，通过真实 DOM 交互验证：

1. 点击 React Flow Node，Inspector 显示对应 Node Journey，详情面板打开。
2. 点击 React Flow Route，Inspector 显示原始 Route 与目标候选，用户选择一个授权的不同 Target。
3. 先预览 YAML Diff：源文本不能改变；取消仍不改变 Source；再次打开并确认修改；Undo 恢复原文，Redo 重做，随后再 Undo 清理验证状态。
4. Visual / Source / Split 切换不丢图；Source 添加注释时重新投影；Undo/Redo 生效；不合法 YAML 时画布应 fail closed，撤销后重建 17 Node。
5. Child Procedure 导航、返回 Root；画布缩放、水平/垂直布局切换；Explorer 折叠/展开；窄屏下仍可发现恢复按钮。
6. 连线 DOM 保留 48 条可见 Path、96 个实际 ELK 边界端点；检查 SVG Path 与 Handle 对齐及箭头样式，不以静态数量断言代替视觉结果。

箭头采用 React Flow **内置的空心 Arrow**，尺寸由 13×13 稍增至 **16×16**，仍比此前 24×24 的 ArrowClosed 克制。ELK 正交路径和多 Handle 对齐不变；箭头与连线始终同色。没有修改任何 Runtime YAML。

**验收界限**：上述项目是 Chromium 浏览器级回归。完整的实际人工交互审查（长链路重连拖动、视觉密度、屏幕阅读器体验）仍需要单独验收；单元测试或纯数据投影不能代替浏览器检查。D2/D3 的新增 Node/Route 也不纳入 D1。
