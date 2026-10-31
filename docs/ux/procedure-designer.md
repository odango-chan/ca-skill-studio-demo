# Procedure Designer UX

**状态：Proposed · Authoring-first 编辑规范**

本文件定义 Procedure Designer 的语义模型和编辑原则。屏幕结构见 [Screen Specification](procedure-designer-screen-spec.md)，交互 / 同步见 [Interaction Model](procedure-designer-interaction-model.md)，真实样本与编辑型线框见 [Screen-level Wireframes](procedure-designer-wireframes.md)，底层源文件编辑规则见 [Source-preserving Edit Model](../architecture/source-preserving-edit-model.md)。

## 1. 产品职责

Procedure Designer 是 Skill IDE 的核心编辑器。它不是通用流程图绘制器，也不是只读 YAML Viewer。

它必须支持作者在同一个 Procedure 上完成：

- 理解业务主线和分支；
- 创建、选择、编辑和删除受支持 Node；
- 编辑 Operator、输入和输出；
- 创建和修改 Route；
- 编辑有序 Preconditions / Postconditions Steps；
- 追踪和编辑 Binding；
- 进入 Child Procedure；
- 在 Source 与 Visual 间双向切换；
- 预览 Source Diff，Undo / Redo 并保存。

所有编辑都受当前 Compatibility Profile 和 Source-preserving Patch Engine 约束。

## 2. 权威源与视图

Skill Package Source 是唯一权威定义。Procedure Designer 提供：

1. **Visual**：结构化图形编辑；
2. **Source**：原始 YAML 文本编辑；
3. **Split**：同一 Working Buffer 的双向同步编辑。

Graph、Inspector、Binding Index、Source Map 和 Problems 都是派生对象。Visual 不能独立保存业务语义。

Visual 操作通过 Typed Source Patch 作用于 Round-trip Tree；Source 编辑重新解析并刷新 Visual。保存前显示 Diff；任何 Patch 无法安全 round-trip 时拒绝应用。

## 3. Procedure 与 Graph 的边界

每个命名 Procedure 对应独立图形视图：

- Procedure 的 start 是入口；
- Procedure 的 nodes 是该 Procedure 内的节点集合；
- 显式 on 路由连接节点；
- Operator / Phase 的内部阶段转换单独表达；
- procedure: child-name 是 Child Procedure 调用；
- Child Procedure 有自己的图，进入时 Drill-in，返回时保留父图状态；
- 不把所有 Procedure 扁平化成一张跨层大图。

画布布局与 YAML 节点顺序分开。拖动 Node 只改变 UI layout，不自动重排源映射；只有明确的 Reorder Source 命令才改变语义顺序，并需检查专用 validator 约束。

## 4. 节点模型：Operator 与业务含义分开

| Source operator | Visual 表达 | 编辑原则 |
|---|---|---|
| call | Call / Operation | Capability ID 与输入字段分开；Effect 不从名字猜测 |
| verify | Verify | Predicate 引用和 with 输入分开编辑 |
| script | Script | Script ref / 参数可编辑；不执行 |
| procedure | Child Procedure | 引用现有命名 Procedure；创建 / 删除受组合语义资格限制 |
| reconcile | Reconcile Operator | 保留 DSL 原始目标 |
| terminal | Terminal | 保留准确 terminal value |
| tool / predicate / for | Source-only / Unsupported | Schema-declared 不自动获得 Visual edit |
| unknown | Unknown / Preserve-only | 保留原文，不结构化编辑 |

### 4.1 两种 Reconcile 必须区分

- reconcile: original-node-id：DSL Reconcile Operator；
- call: pdu_session.reconcile：普通 Call Operator，Capability 名称含 reconcile。

例如 ensure 中的 reconcile-create 是 Call；establish 中的 reconcile-nudm-sdm-subscribe 是 DSL Reconcile。

### 4.2 Operator、Effect 和状态是不同维度

- Operator：call / verify / script / procedure 等；
- Effect：只读、local compute、evidence wait、mutation 等，只有可信元数据可确认；
- Outcome：当前 Operator 的结果；
- Procedure terminal：整个 Procedure 的结束状态。

无法确定 Effect 时显示 Unknown，不得推断。

## 5. 节点内部阶段

有阶段结构的 Node 包含：

1. Preconditions；
2. Main Operation；
3. Postconditions。

这些阶段属于同一业务节点，不是三个独立主流程节点。

- preconditions.steps 按源顺序执行；
- postconditions.steps 按源顺序执行；
- Phase 聚合路由与每个 Step Operator 的 Outcome 分开；
- 成功进入 Postconditions 是隐式阶段转换，不伪造成显式 on；
- CreatedSession node-level phases 属于 Demo Transitional syntax，结构化编辑需要专用 Profile 资格。

## 6. Route 与状态域

Route 必须保留 Route Source、原始 Outcome、Target 和 Source Location。

| 状态域 | 值 | 含义 |
|---|---|---|
| Predicate truth | PASS / FAIL / UNKNOWN | 事实判定 |
| Mutation certainty | COMMITTED / NOT_COMMITTED / OUTCOME_UNKNOWN | 副作用提交确定性 |
| Procedure terminal | SUCCEEDED / FAILED / UNRESOLVED / SAFE_STOPPED | 整个 Procedure 终态 |
| Validation / diagnostics | PASS / FAIL / BLOCKED / NOT_RUN / STALE | 编辑器辅助检查 |

不得把不同阶段同名 Outcome 合并成无来源的出口。

## 7. Binding 与数据流

Binding 表达数据依赖；Route 表达控制流。两者分开呈现。

Binding Inspector 显示 Consumer Node / Phase / Step / Field、原始 from / value 表达式、Producer Procedure / Node / Phase / Step / Field、Declared Type、Source Location、Evidence Level 和编辑资格。

Producer Picker 只列出能解析、来源明确、类型 / 生产时机有证据的候选。未知类型或跨 Procedure 语义不明时不自动选择。

当前 CreatedSession 的 preconditions.<step>.output.* 和跨节点 precondition output path 必须标记 Demo Transitional，不得宣称为通用 Schema / Runtime 能力。

## 8. Child Procedure

- 每个命名 Procedure 独立成图；
- 进入 Child 时显示 Breadcrumb；
- 返回时恢复父图 zoom / pan / selection / Inspector；
- 编辑 Child 内部不自动扁平化 Root；
- 新建 / 重命名 / 删除 Procedure definition 前检查所有调用点和引用；
- 当前组合语义尚未建立编辑资格的部分保持 Source-only。

## 9. 编辑操作与安全约束

| 操作 | 必须检查 |
|---|---|
| Add Node | Operator 资格、Node ID 唯一、必需字段 |
| Rename Node | start、所有 Route target、Binding producer path、Child reference |
| Delete Node | 入边、出边、Binding / 跨资产引用 |
| Add / Update Route | Route Source、Outcome、Target、当前 Profile |
| Edit Binding | Producer、字段、类型、生产时机和 Profile |
| Reorder Step | Sequence 语义与源顺序约束 |
| Change Operator | 旧 / 新字段语义、未知字段和引用 |
| Add / Delete Procedure | 调用点、Entry Procedure 和跨 Procedure 引用 |

每个操作生成 Typed Source Patch；破坏性操作先显示 Impact Preview；Patch 应用后重新解析、比较语义并显示 Diff。

## 10. 两个真实样本

- [ensure-pdu-session Graph Blueprint](ensure-pdu-session-graph-blueprint.md)：首个可编辑样本，逐项开放经过 Round-trip 测试的 Call / Verify / Terminal / Route / Binding 操作。
- [establish-pdu-session Graph Blueprint](establish-pdu-session-graph-blueprint.md)：复杂兼容性样本；先确保完整读取和无损 round-trip，CreatedSession Transitional phases 在专用编辑资格通过前保持 Source-only。

蓝图绑定固定 ca-agent-demo commit，是实现验收基准，不是第二份 Skill 定义。

## 11. 编辑资格与降级

- editable：Parser、Patch、Round-trip 和测试全部通过；
- source-only：原文可编辑，但没有结构化控件；
- preserve-only：语义不理解，但必须无损保留；
- unavailable：无法安全解析或保留，明确阻止修改并提供恢复路径。

能力以 Manifest 为准。出现未知语法时，不静默删除、不猜测、不自动重写。
