# Procedure Designer Screen Specification

**状态：Proposed · 第二轮屏幕规范**

本文件把 Procedure Designer 的语义原则落实为可供高保真设计和后续实现使用的屏幕结构。尺寸为设计起点，不是固定实现约束。

## 1. 屏幕目标与首屏

用户打开 Procedure 时，首屏应同时回答：

1. 当前正在查看哪个 Skill / Procedure？
2. 这是哪一个兼容性 Profile，哪些语法有过渡或未验证限制？
3. 主业务流程从哪里开始，如何走到终态？
4. 当前节点的内部阶段、输入和引用在哪里查看？
5. 当前有哪些真实诊断？

首屏默认展示 **Business Flow**，而不是 YAML 树、所有 Binding 线或完整的节点内部步骤。

## 2. 桌面工作台结构

~~~text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Workspace / Skill / Procedure breadcrumb       Saved · Visual | Source | Split│
│ Profile: Demo baseline  ·  Procedure: ue-requested-pdu-session  · Validate   │
├──────────────────────┬────────────────────────────────┬──────────────────────┤
│ Package / Procedure  │ Graph Toolbar                  │ Inspector            │
│ Navigator             │ Search · Fit · Zoom · Layout   │ Overview             │
│                      ├────────────────────────────────┤ Phases               │
│ Skill Package        │                                │ Bindings             │
│  SKILL.md            │        Business Flow           │ References           │
│  assurance           │                                │ Source               │
│   contract.yaml      │   [Node A]                     │                      │
│   procedure.yaml     │      │                         │ Selected node        │
│    Procedure list    │   [Node B] ── outcome ──> ... │ details              │
│     root procedure   │      │                         │                      │
│     child procedure  │   [Terminal]                   │                      │
├──────────────────────┴────────────────────────────────┴──────────────────────┤
│ Diagnostics / Problems / Validation Evidence  ·  3 errors · 1 warning        │
└──────────────────────────────────────────────────────────────────────────────┘
~~~

### 2.1 顶部 Header

显示：

- Workspace；
- Skill name；
- Package path；
- Procedure breadcrumb；
- 当前 Source ref / commit（如果是导入 Fixture）；
- Compatibility Profile；
- Saved / Saving / Unsaved / Conflict；
- Visual / Source / Split；
- Validate；
- Diff；
- Save。

不要在第一阶段显示会触发真实副作用的 Run / Execute 主按钮。若未来增加执行能力，必须是独立环境与授权流程，不属于本规范。

### 2.2 左侧 Navigator

左侧是 Package Explorer 的 Procedure 上下文：

- 当前 Skill 的文件树；
- `assurance/procedure.yaml` 下的 Procedure 列表；
- 当前 Procedure 的 Node Outline；
- Child Procedure 关系；
- Search / Quick Open。

Procedure 列表和 Node Outline 是辅助导航，不是另一套流程图。点击 Node Outline 项会定位并选择中央画布节点。

### 2.3 中央 Graph Canvas

默认只展示控制流：

- 入口节点；
- 业务节点；
- 终态；
- 由显式 `on` 或 operator 语义产生的路由；
- Child Procedure 节点；
- 节点是否包含 Preconditions / Postconditions 的轻量提示。

中央画布不默认显示所有 Binding 数据边，也不默认展开所有 phase steps。

画布工具栏：

- Search Node；
- Fit to View；
- Zoom In / Out；
- Reset View；
- Layout Direction（默认纵向）；
- Collapse / Expand Detail；
- Toggle Route Labels；
- Toggle Diagnostics；
- Toggle Qualification Overlay（仅有可靠映射时可用）。

### 2.4 右侧 Inspector

选择节点后显示以下 Tab：

| Tab | 内容 |
|---|---|
| Overview | Node ID、Operator、业务用途（有证据时）、Effect（有元数据时）、源位置、诊断、子步骤数量 |
| Phases | Preconditions、Main Operation、Postconditions 的完整结构和顺序 |
| Bindings | 输入字段、`from` / `value`、生产者、消费者、类型和证据等级 |
| References | Predicate、Capability、Contract、Child Procedure、Case 的可追溯引用 |
| Source | 原始 YAML 片段、准确行号 / YAML path（仅在 Parser 提供时） |

无选中节点时显示 Procedure Overview：`start`、节点数、Child Procedures、终态数、Compatibility Profile 和检查状态。

### 2.5 底部 Diagnostics

按类别分组：

- Parse；
- Schema；
- Demo Transitional Validator；
- Cross-reference；
- Graph Integrity；
- Warnings / Unsupported。

每条诊断显示 Severity、Code、Message、File、准确位置（若可得）、相关 Node / Phase 和 Validator 来源。

点击诊断定位到 Source；若可定位到节点，则同步选择图形节点。不能定位到准确行列时显示文件级位置，不虚构行号。

## 3. Node Card 规范

节点卡片采用紧凑、可扫描结构：

~~~text
┌────────────────────────────────────┐
│ nudm-sdm-subscribe        CALL      │
│ sbi.udm.sdm_subscription.create     │
│ UDM Subscription Create             │
│                                     │
│ PRE  5 steps     POST  1 verify     │
│ Inputs 5 · Outputs 1 · 2 diagnostics│
└────────────────────────────────────┘
~~~

必需字段：

- Node ID；
- Source Operator；
- Operator / Capability / Predicate / Child Procedure 标识；
- 可读摘要（仅可由稳定元数据或人工说明提供，不得凭空生成业务事实）；
- Phase / Binding 数量；
- 诊断数量；
- Unsupported / Transitional 提示。

可选字段：

- Effect 分类；
- 当前选中状态；
- Source Dirty 标记；
- Case obligation 关联数量（只有明确映射时）。

不要在节点卡片上放完整 YAML、长 Binding 列表或所有路由标签。复杂信息进入 Inspector。

## 4. Route Edge 规范

每条边必须保留：

- Source Node；
- Route Source：Operator / Preconditions / Postconditions / Child Procedure / Loop；
- Outcome 原始值；
- Target Node；
- Source Location；
- 是否为显式源路由或由 authoring semantics 导出的内部转移。

推荐标签格式：

- `Operator · OUTCOME_UNKNOWN`
- `Preconditions · FAILED`
- `Postconditions · UNKNOWN`
- `Child Procedure · UNRESOLVED`

### 4.1 多阶段出口

当同一节点存在多个 `on`：

- 边从对应阶段的独立锚点发出；
- 标签始终包含阶段名；
- 同目标边也不能无来源合并；
- 默认可以折叠低优先级标签，但不能隐藏其数量和来源；
- 选中阶段后，只高亮该阶段路由，其他路由降噪但仍可见。

### 4.2 隐式成功进入 Postconditions

若节点声明 Postconditions，成功操作结果进入 Postconditions 是 authoring semantics，不是显式 `on` 路由。

画布用节点内部的虚线 / 阶段连接表达，并标注 `success → postconditions`。不要伪造 `COMMITTED: ...` 源边。

### 4.3 路由布局

- 默认从上到下；
- 成功主路径保持视觉连续；
- 非成功出口向侧边分流；
- terminal 聚合到画布下方 / 右侧的 Terminal Area；
- 避免边穿过节点；
- 不能为了布局改变路由目标；
- 多路由图使用边标签和 Inspector，而不是单纯依赖颜色。

## 5. Node Phase Inspector

选中有阶段结构的节点，Phases Tab 显示：

~~~text
NODE  nudm-sdm-subscribe

┌ 01 · PRECONDITIONS ─────────────────────────────────────┐
│ Ordered steps · stops at first non-success              │
│ 1. select-subscription-configuration  SCRIPT            │
│ 2. resolve-pcf-create-inputs          READ-ONLY CALL     │
│ 3. createdsession.pcf.create_inputs.ready  VERIFY       │
│ 4. createdsession.ingress.eligible    VERIFY            │
│ 5. createdsession.lifecycle.ready     VERIFY            │
│ Aggregate routes: FAILED → finalize-failed              │
│                   UNRESOLVED → finalize-unresolved      │
└─────────────────────────────────────────────────────────┘
                         │ all steps succeeded
                         ▼
┌ 02 · MAIN OPERATION ─────────────────────────────────────┐
│ CALL  sbi.udm.sdm_subscription.create                    │
│ with: pcfCreateInputsRef, selection, ingressRef, ...     │
│ Operator routes: OUTCOME_UNKNOWN → reconcile-...       │
└─────────────────────────────────────────────────────────┘
                         │ successful operation
                         ▼
┌ 03 · POSTCONDITIONS ─────────────────────────────────────┐
│ 1. createdsession.udm.subscription_owned  VERIFY        │
│ PASS → npcf-sm-policy-control-create                    │
│ FAIL → finalize-failed                                   │
│ UNKNOWN → finalize-unresolved                            │
└─────────────────────────────────────────────────────────┘
~~~

规则：

- 保留原始 step 顺序；
- 每步显示 operator、name（如有）、Predicate / Capability / Script、输入；
- 只有有真实执行 Trace 时才显示每步运行结果；
- 静态视图显示的是定义，不显示虚构的 PASS / FAIL；
- 聚合路由属于 phase block，不属于每个 step；
- 主操作和 Postconditions 的成功关系按语义显示，不伪造源字段。

## 6. Binding Inspector

Binding 默认以表格 / 树展示，不在主画布画出全部数据依赖线。

| Consumer | Value | Source | Producer | Type | Evidence |
|---|---|---|---|---|---|
| `with.pcfCreateInputsRef` | `from` | `...` | Precondition step | Unknown / declared | Demo Transitional |

选择一条 Binding 后：

1. 高亮 Consumer；
2. 高亮 Producer；
3. 显示完整 Source expression；
4. 显示 path token（Procedure / Node / Phase / Step / Field）；
5. 显示声明类型和证据等级；
6. 提供 Go to Source；
7. 如跨 Procedure，显示 Drill-in / Breadcrumb，不在当前图强行连边。

无法解析 producer 或 field 时保留原始表达式并显示 Unresolved。不得自动修复为相似路径。

## 7. Child Procedure 视图

Child Procedure 节点显示：

- Procedure name；
- Input mapping 数量；
- Terminal outcome routes；
- Source / Evidence level；
- Open Procedure 操作。

进入子图时显示 Breadcrumb：`Root Procedure / Child Procedure`。返回父图后恢复：

- zoom；
- pan；
- selected node；
- collapsed / expanded state；
- selected Inspector Tab；
- 搜索条件。

异步等待 Procedure 使用独立子图呈现其 await、verify、terminal 结构，不将其压缩成一个普通 Predicate。

## 8. 两个样本的视觉要求

### ensure-pdu-session

首屏应清楚显示：

- `observe-target-session` → PASS / FAIL / UNKNOWN；
- `observe-session-absence` → PASS / FAIL / UNKNOWN；
- `create-session` → COMMITTED / NOT_COMMITTED / OUTCOME_UNKNOWN / FAILED / DENIED；
- `reconcile-create` → COMMITTED / NOT_COMMITTED / UNRESOLVED / FAILED / DENIED；
- `retry-create-session` 的受控重试；
- verify 与 terminal 分支。

其中 `reconcile-create` 是 Call Operator（`call: pdu_session.reconcile`），不能画成 DSL Reconcile Operator。

### establish-pdu-session

首屏以 3GPP 主业务顺序为主：

1. Nudm_SDM_Get；
2. Nudm_SDM_Subscribe；
3. Npcf_SMPolicyControl_Create；
4. N4 Session Establishment；
5. Namf_Communication_N1N2MessageTransfer；
6. PDU Session Resource Setup；
7. N4 Session Modification / forwarding convergence；
8. completion convergence + resource responsibility finalization。

内部 Preparation、Postcondition、async await 和 reconcile 路径在选中节点或 Drill-in 后查看。Finalization 分支必须保留不同 disposition 和 terminal，不得合并成一个“失败”出口。

## 9. Qualification Overlay

默认关闭。

开启时仅显示真实可追溯的 Case / Trace 映射。对当前 CreatedSession：

- 显示 `36 semantic obligations`；
- 标记 `not executable fixtures`；
- 不显示绿色执行覆盖率；
- 未映射的 obligation 不得自动贴到相似节点；
- 没有 Runtime trace 时 Execution state = NOT_RUN。

## 10. 空状态、错误状态和部分支持

| 状态 | UI 行为 |
|---|---|
| Valid Projection | 正常展示图形 |
| Partial Projection | 展示已理解部分，并显式标记 Unsupported 部分 |
| Parse Error | 保留 Source；上一次图形标记 STALE，不再声称代表当前源 |
| Unknown Operator | 显示 Unknown / Preserve-only 节点，提供 Source 跳转 |
| Unsupported Phase Syntax | 保留原始结构，Inspector 显示 Source-only |
| Missing Reference | 显示 Unresolved，不猜测目标 |
| No Node Selected | Inspector 显示 Procedure Overview |
| No Diagnostics | 显示当前已执行检查范围，不显示“全部通过”除非完整检查确实执行 |

## 11. 尺寸与响应式建议

桌面 1440×900 作为首个高保真设计候选：

- Navigator：220–260 px；
- Inspector：320–380 px；
- Diagnostics：180–240 px，可收起；
- Graph Canvas：剩余空间优先；
- Header：约 56 px；
- Graph toolbar：约 40 px。

窄窗口时 Navigator / Inspector 改为抽屉；Visual 与 Source 默认单视图；Diagnostics 作为独立面板。手机端不承诺完整图形编辑。
