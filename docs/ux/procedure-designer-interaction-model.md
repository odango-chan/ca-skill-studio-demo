# Procedure Designer Interaction Model

**状态：Proposed · 第二轮交互规范**

本文件定义 Procedure Designer 的交互行为、同步规则、编辑能力边界和验收场景。屏幕结构见 [Screen Specification](procedure-designer-screen-spec.md)。

## 1. 页面状态模型

Procedure Designer 的状态至少分为四个互相独立的维度。

### 1.1 Source state

| 状态 | 含义 | 行为 |
|---|---|---|
| CLEAN | 当前文件与已保存版本一致 | 正常浏览 |
| DIRTY | 存在未保存修改 | 显示未保存标记 |
| SAVING | 正在保存 | 禁止重复提交同一保存动作 |
| CONFLICT | 文件在外部发生变化 | 保留本地编辑，提供 Diff / Reload / Resolve |
| INVALID | 当前 Source 无法解析 | 保留原文，Graph 标记 STALE |

### 1.2 Projection state

| 状态 | 含义 | 行为 |
|---|---|---|
| READY | 当前 Source 可完整投影 | 正常显示 |
| PARTIAL | 部分语法不支持 | 展示支持部分和 Unsupported 节点 |
| STALE | 图形对应旧 Source | 明确显示旧版本，不得误认为当前状态 |
| UNAVAILABLE | 无法安全生成图 | 仅显示 Source |

### 1.3 Selection state

可选对象：

- Procedure；
- Node；
- Route Edge；
- Phase Block；
- Phase Step；
- Binding；
- Diagnostic。

选择对象后 Inspector、Source 和 Canvas 必须保持同一对象上下文。

### 1.4 Validation state

Validation 状态由真实检查记录驱动：

- PASS；
- FAIL；
- BLOCKED；
- NOT_RUN；
- STALE；
- NOT_AVAILABLE。

Source 改动后，受影响的历史检查标记 STALE。不能因为解析成功就把 Schema / Transitional / Cross-reference 检查自动标为 PASS。

## 2. 选择与导航

### 2.1 选择 Node

单击节点：

- 设置当前 Node；
- 打开 Inspector 的 Overview；
- 高亮该节点的入边和出边；
- 其他节点降噪但仍可见；
- Source 跳转到该节点的 YAML 位置（仅当位置可靠）。

双击 Child Procedure 节点或使用 Open Procedure：

- 进入子图；
- 添加 Breadcrumb；
- 保存父图视图状态。

### 2.2 选择 Route Edge

单击边：

- 设置当前 Route；
- Inspector 显示 Route Source、Outcome、Target、Source Location；
- 高亮来源 Node、目标 Node；
- Source 定位到对应 `on` 路由；
- 显示它是显式源路由还是隐式阶段转移。

若一条边由多个来源产生，必须保留来源列表，不得只展示合并后的 outcome。

### 2.3 选择 Phase / Step

从 Inspector 选择 Preconditions / Main Operation / Postconditions：

- 对应阶段在 Node Card 上突出；
- 只高亮该阶段的路由；
- 显示有序 steps；
- 显示阶段聚合结果域；
- Source 定位到阶段根字段。

选择某个 step：

- 高亮其 Operator 和输入；
- 显示 step name（如有）、source path 和 bindings；
- 不显示虚构的运行结果。

### 2.4 Quick Open / Search

支持按 Skill、Procedure、Node ID、Operator、Capability ID、Predicate ID 和 Case ID 搜索。

结果显示类型、所属 Procedure、路径和上下文。搜索不应执行脚本或外部调用。

## 3. Source / Visual / Split 同步

### Visual → Source

- 选择 Node：定位到 Node 定义；
- 选择 Route：定位到对应 `on` 项；
- 选择 Phase：定位到 `preconditions` / `postconditions`；
- 选择 Step：定位到数组项；
- 选择 Binding：定位到对应 `from` / `value`。

### Source → Visual

- 光标位于可解析 Node：选中 Node；
- 光标位于 `on` 路由：选中 Route；
- 光标位于 Phase：展开对应 Phase；
- 光标位于 Binding：选中 Binding 并显示 Producer / Consumer；
- 光标位于未知字段：显示 Source-only / Unsupported，不强行选中近似节点。

### Split

Split 是同一 Source 的同步视图，不是双文档编辑。

- Source 编辑后重新解析；
- Projection 只有在解析成功且能安全映射时才刷新；
- 解析失败时旧图标记 STALE；
- 不能把旧图留在屏幕上却不提示用户；
- Source 光标和 Visual selection 双向同步。

## 4. Binding 交互

### 查看 Binding

1. 从 Node Inspector 打开 Bindings；
2. 查看 Consumer 字段和原始表达式；
3. 展开 Producer path；
4. 显示类型、来源证据和 Source Location；
5. 点击 Producer / Consumer 跳转。

### 查看依赖关系

- 默认只显示当前 Node 的入向 / 出向数据依赖；
- 不在全局画布显示全部 Binding edge；
- 用户主动选择某条 Binding 后才高亮跨节点依赖；
- 跨 Procedure 依赖使用 Breadcrumb 和 Reference panel，不跨层拉线。

### 编辑边界

第一阶段 Binding Inspector 只读。Source 模式允许编辑原始表达式。

未来结构化 Binding 编辑必须：
- 只提供当前 Compatibility Profile 已支持的来源；
- 展示 Producer、Consumer、Declared Type 和 source path；
- 在类型 / 生产时机不确定时阻止“自动选择”；
- 对 CreatedSession precondition output path 显示 Transitional；
- 保存前展示完整 Diff；
- 保存后执行引用解析和相关 validator。

## 5. 路由交互

- Route label 始终包含 Route Source；
- 点击 Route Source 标签可切换高亮阶段；
- 同一个 target 的多条不同阶段路由仍分别显示；
- 不同状态域采用不同的文字和图形标识；
- 隐式成功进入 Postconditions 用内部阶段连接，不显示成显式 `on`；
- Route Target 不存在时显示 Dangling Route，并定位源字段；
- 当前 Procedure 外的目标不允许被自动接受为合法节点。

## 6. 编辑策略

### Phase 1：Source-first

允许：
- Source 文本编辑；
- 保存与 Diff；
- Undo / Redo；
- Visual 只读投影；
- Inspector 只读；
- 局部 / 完整静态 Validate。

禁止：
- 在图上 Add / Delete / Rename Node；
- 拖动边改变 `on`；
- 结构化修改未知 Operator；
- 结构化修改 CreatedSession Transitional phase，除非对应专用编辑器和 round-trip 测试已完成；
- 执行 Script、Capability 或真实 5GC 操作。

### Phase 2：受控结构化编辑（后续）

每种操作必须生成 Typed Source Patch：

| 操作 | 必须检查 |
|---|---|
| Add Node | Operator capability、Node ID 唯一、必需字段、入口 / 路由完整性 |
| Rename Node | `start`、所有 `on` target、所有 Binding producer path、Child references |
| Connect Route | outcome 对应阶段合法、target 存在、无跨 Procedure 越界 |
| Delete Node | 入边、出边、Binding 引用、start、Case / Trace 引用 |
| Edit Binding | Producer 存在、字段声明、类型、生产时机、Profile 资格 |
| Change Operator | 旧字段与新 Operator 语义差异、未知字段、相关引用 |
| Reorder | 是否允许改变源顺序；CreatedSession 主业务节点顺序校验 |

所有 Patch：预览 → 用户确认 → 应用 → 重新解析 → 重新验证 → 展示 Diff。任一步失败都不得留下半应用状态。

## 7. Diagnostics 行为

- 诊断点击后定位 Node / Phase / Step / Binding；
- 同时在 Source 和 Graph 高亮；
- 显示原始 validator message；
- 可附加 Studio 的中文解释，但不能覆盖原文；
- Suggested Fix 只能是有证据的建议；
- AI / 自动修复只能生成候选 Patch，必须展示 Diff 并由用户确认；
- 诊断位置不精确时退回文件级定位。

## 8. Qualification Overlay 行为

- 默认关闭；
- 只有存在明确 mapping / trace 才能显示关联；
- Semantic obligation 显示为 obligation，不显示为 executable / executed；
- 没有实际运行记录时状态为 NOT_RUN；
- Source Digest 变化后旧 Trace / Qualification 标记 STALE；
- 不在 Visual 图上自动把 36 个 CreatedSession obligations 分配给“看起来相似”的节点。

## 9. 键盘与可访问性

建议快捷键：

| 快捷键 | 动作 |
|---|---|
| Ctrl/Cmd + P | Quick Open |
| Ctrl/Cmd + F | 当前 Procedure 搜索 |
| Ctrl/Cmd + Shift + F | Package 全局搜索 |
| Ctrl/Cmd + S | Save |
| Ctrl/Cmd + Z | Undo |
| Ctrl/Cmd + Shift + Z | Redo |
| Ctrl/Cmd + Enter | Validate 当前范围 |
| Escape | 取消选择 / 关闭临时面板 |

可访问性要求：

- Node 和 Edge 可通过键盘导航；
- 提供 Outline 替代纯画布导航；
- 所有状态同时有文字和图形表达；
- 焦点可见；
- 画布缩放不导致文本无法访问；
- Inspector 所有字段具备可读 Label；
- 不能只依赖颜色表达状态。

## 10. 验收场景

1. 打开 `ensure-pdu-session`，从 `start` 看到完整控制流和所有 terminal。
2. 选择 `create-session`，看到 mutation outcome 与 `OUTCOME_UNKNOWN` 到 Reconcile 的路径。
3. 选择 `reconcile-create`，确认它是 Call Operator `pdu_session.reconcile`，而不是 DSL `reconcile:`。
4. 打开 `establish-pdu-session`，主图只显示根 Procedure 的业务节点，不把所有 await 子 Procedure 展平。
5. 选择 `nudm-sdm-subscribe`，按顺序查看五个 Preconditions steps、Main Operation 和 Postcondition。
6. 选择 `namf-communication-n1n2-message-transfer`，看到三个阶段独立的 routes，不把 Operation 和 Postconditions 的 UNKNOWN 合并。
7. 点击一个跨节点 precondition output Binding，能定位到生产者和消费者，并标记 Demo Transitional。
8. 进入 `await-pdu-session-resource-setup` 子图，返回时父图视图状态恢复。
9. 编辑 YAML 使其无法解析，Source 原文保留，旧 Graph 标记 STALE。
10. 查看 CreatedSession Case Overlay，36 个 obligations 明确显示为非可执行、未执行义务。
11. 对未知 Operator，Visual 不做错误的语义猜测，Source 原文可见。
12. 普通 Preview / Validate 不触发 Script、Capability、Runtime 或 Live 5GC。


## 11. 源样本驱动的导航验收

具体节点与路径以两份蓝图为准：

- [ensure-pdu-session Graph Blueprint](ensure-pdu-session-graph-blueprint.md)
- [establish-pdu-session Graph Blueprint](establish-pdu-session-graph-blueprint.md)

至少应能完成以下真实导航：

1. 从 `observe-target-session` 沿 FAIL 选择到 `observe-session-absence`，再沿 PASS 选择到 `create-session`。
2. 从 `create-session.OUTCOME_UNKNOWN` 定位到 `reconcile-create`，并查看其原始 Create output Binding；确认 Call `pdu_session.reconcile` 不被误画成 DSL `reconcile:`。
3. 在 `nudm-sdm-subscribe` 中依次选中 5 个 Preconditions steps，再选 Main Operator 和 Postcondition Verify。
4. 从 `nudm-sdm-subscribe` 的 PCF create inputs producer 跳转到 N4 Child Procedure 使用的 `currentSessionInstanceRef`，并显示两者不是同一个 handle。
5. 从 `namf-communication-n1n2-message-transfer` 的 Postcondition operationRef Binding 跳转到 RAN / N4 / UE Child Procedure 的 `afterOperationRef` 消费者。
6. Drill-in 到 5 个独立 Child Procedure，返回时恢复 root Graph 的视图状态。
7. 打开 Case overlay 时，ensure 的 5 个 fixture-shaped traces 可定位到确切节点；establish 的 36 个 semantic obligations 不生成虚构 node mapping。
