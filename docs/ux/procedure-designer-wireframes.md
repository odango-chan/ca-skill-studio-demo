# Procedure Designer · Screen-level Wireframes & Design Review

**状态：Proposed · Authoring-first Procedure Designer · 待用户评审**

本文件把 Procedure Designer 的语义规范、交互规范和两个源代码级 Graph Blueprint 落到具体编辑工作台线框，并对上一版只读方案进行设计复盘。Visual 与 Source 都是正式编辑入口；Visual 的可编辑范围由 Compatibility Profile 和 Round-trip / Patch 测试逐项决定。

## 1. 设计范围与依据

### 1.1 本轮要解决的问题

- 用户打开 Procedure 后，能在几秒内看清当前处于哪个 Skill / Procedure / Compatibility Profile。
- 根流程的主路径、所有显式路由和终态都能找到；复杂信息不强迫一次性铺满画布。
- 选择节点后，能检查其内部阶段、Operator、Binding、Predicate 和 Source。
- Child Procedure 是独立 Procedure 图，可以进入和返回。
- 静态定义、编辑诊断与真实 Runtime 执行状态不混为一谈。首版不展示 Runtime Trace。
- Source 与 Visual 都可编辑，但共享同一 Working Buffer；Visual 修改必须通过 Typed Source Patch，未取得资格的语法保持 Source-only / Preserve-only。

### 1.2 固定样本来源

- Repository: `odango-chan/ca-agent-demo`
- Commit: `bf445ad777149af5af2dfa0a5bdea18d0451303e`
- [ensure-pdu-session Graph Blueprint](ensure-pdu-session-graph-blueprint.md)
- [establish-pdu-session Graph Blueprint](establish-pdu-session-graph-blueprint.md)
- [Procedure Designer semantic spec](procedure-designer.md)
- [Screen specification](procedure-designer-screen-spec.md)
- [Interaction model](procedure-designer-interaction-model.md)

本文件的源事实以固定 Commit 和两份 Blueprint 为准。若后续 Demo source 更新，必须重新生成 / 核对 Blueprint，不能沿用旧截图或旧布局作为新源事实。

## 2. 设计复盘：上一版线框需要修正的地方

上一版线框适合表达方向，但不应直接作为实现规格。复盘后作以下修正：

### 2.1 节点数、路由数和终态数必须分开

| 样本 | Root Node | 非终态 Node | Terminal Node | 显式 route outcome entries | Child Procedure definitions |
|---|---:|---:|---:|---:|---:|
| ensure-session | 11 | 6 | 5 | 24 | 0 |
| ue-requested-pdu-session-establishment | 17 | 13 | 4 | 65 | 5 |

说明：

- Route outcome entry 是源文件 `on` 映射中的一条 Outcome → Target，不等同于最终绘制出来的物理线条数量。
- 数量不包括隐式的“主 Operator 成功 → Postconditions”阶段转换。
- ensure 有 5 个 Terminal Node，但只有 4 种 terminal value，因为 `strategy-conflict` 和 `failed` 都是 `FAILED`。
- establish 的 5 个 Child Procedure 是独立 Procedure definitions，不计入 17 个 Root Nodes，也不能自动扁平化进 Root Graph。
- establish 的 65 条是 Root Procedure 显式 route outcome entries；5 个 Child Procedure 自己还有独立路由。

### 2.2 上一版 ASCII 图不是完整路由表

上一版 ensure 示意图省略了部分 `FAILED / DENIED` 分支，并把多个终态挤在一行。新设计以 Blueprint 的逐条路由表为准：

- create 的 `NOT_COMMITTED / FAILED / DENIED` → `failed`；
- create 的 `OUTCOME_UNKNOWN` → `reconcile-create`；
- Reconcile 的 `FAILED / DENIED` → `safe-stopped`；
- retry 的 `OUTCOME_UNKNOWN` → `unresolved`，源文件没有第二次 Reconcile；
- `strategy-conflict` 和 `failed` 是两个不同 Node，虽然 terminal value 相同。

establish 也不能只画 happy path：三个 root Reconcile 节点、两个常规 finalization 分支、四个 terminal 都必须在 Root Graph 可定位。

### 2.3 Predicate Inspector 不允许展示泛化 Scope

不能使用诸如 `Current Session / Current Lifecycle` 的概括文字代替真实 Scope。

Predicate Inspector 应显示源文件里的完整 Scope expression（可折叠 / 格式化），并保留 Observation ref、Freshness、Evaluator 和 Source location。某字段未声明就显示“未声明”，不能推断。

### 2.4 三种视图不应平级

上一版的 Graph / Routes / Bindings 三个 Tab 容易让人误以为它们是三份不同图形。

修正为：

- **Control Flow**：默认主画布，展示 Node 和控制流。
- **Route details**：Control Flow 的侧栏 / Inspector 内容，不是独立画布。它解释来源阶段、Outcome、Target 和 Source location。
- **Data Flow**：独立的关系视图 / Lens，展示 Binding 生产者与消费者，不和控制流线同时铺满。

Source / Visual / Split 是工作区模式，与 Control Flow / Data Flow 是两个不同维度，不能混成一个 Tab 组。

### 2.5 固定尺寸只能是设计起点

1440×900 是首个桌面高保真基准，不是最低支持分辨率或不可变面板宽度。上一版的 240px / 360px 面板会随画布可用宽度、用户折叠和窗口大小调整。

必须在 1280px 左右和窄窗口下复核，不能仅凭 1440px 截图宣布布局成立。

## 3. 工作台总布局

### 3.1 桌面默认状态（候选：1440 × 900）

~~~text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Skill Studio / Workspace / Skill / Procedure breadcrumb                     │
│ Source: <commit> · Profile: <profile> · Projection: READY · Source: CLEAN     │
├───────────────────┬────────────────────────────────────────┬─────────────────┤
│ NAVIGATOR         │ CANVAS HEADER                           │ INSPECTOR       │
│                   │ Procedure: <procedure-id>               │                 │
│ Package           │ [Control Flow] [Data Flow]               │ Overview        │
│  SKILL.md         │ Search · Fit · Zoom · Layout             │ Phases          │
│  assurance        │ Route labels: Auto · All                 │ Bindings        │
│   contract.yaml   ├────────────────────────────────────────┤ References      │
│   procedure.yaml  │                                        │ Source          │
│    Root Procedure │             GRAPH CANVAS               │                 │
│    Child A        │                                        │ Selected object │
│    Child B        │       Nodes / Routes / Terminals        │ details         │
│  references       │                                        │                 │
│  schemas          │                                        │                 │
│  scripts          │                                        │                 │
│  predicates       │                                        │                 │
│                   │                                        │                 │
├───────────────────┴────────────────────────────────────────┴─────────────────┤
│ DIAGNOSTICS (collapsed summary; expands on demand)                           │
└──────────────────────────────────────────────────────────────────────────────┘
~~~

### 3.2 区域职责

| 区域 | 初始宽度建议 | 职责 |
|---|---:|---|
| Header | 56–64px 高 | Workspace / Skill / Procedure / source revision / compatibility / source state |
| Navigator | 220–260px | Runtime Asset Explorer、Procedure tree、Node Outline、Predicates、Scripts / Schemas / References |
| Canvas toolbar | 40–48px 高 | Control Flow / Data Flow、Search、Fit、Zoom、Layout、Route label density |
| Canvas | 剩余宽度 | 当前 Procedure 的图形投影 |
| Inspector | 320–380px | 当前选中 Node / Route / Binding / Predicate 详情 |
| Diagnostics | 默认收起；展开约 180–240px | Parse / Schema / Demo validator / cross-reference / graph integrity |

尺寸是候选值。Navigator 和 Inspector 必须可折叠 / 调整宽度；Diagnostics 可收起。画布优先获得剩余空间，不允许面板把画布挤成不可用的窄条。

### 3.3 顶部 Header

必须显示：

- Workspace / Skill / Procedure Breadcrumb；
- Source ref 或固定 Commit（至少短 SHA，完整值可复制）；
- Compatibility Profile 和证据等级；
- Projection 状态：READY / PARTIAL / STALE / UNAVAILABLE；
- Source 状态：CLEAN / DIRTY / SAVING / CONFLICT / INVALID；
- Visual / Source / Split；
- Problems / Inline Diagnostics（仅显示当前编辑相关的解析、引用与结构问题；完整验证工作台后置）。

首阶段不显示 Run / Execute / Live 5GC 按钮。

### 3.4 Navigator

Navigator 的 Procedure tree 和 Node Outline 是 Source-aware 导航，不是第二份流程图。

- Procedure tree 显示 Root 与 Child Procedure 层级。
- Node Outline 保留源文件 Node 顺序。
- 选择 Outline 项会定位并选中 Canvas Node。
- Child Procedure 项可进入独立子图。
- Predicates / Contract / Script / Schema 通过引用导航进入对应资产。

### 3.5 Inspector

Inspector 根据选中对象切换内容：

| Selection | Inspector |
|---|---|
| 无选中对象 | Procedure Overview |
| Node | Overview / Phases / Bindings / References / Source |
| Route | Route source / outcome / target / source location |
| Phase / Step | 顺序、Operator、输入、聚合路由 |
| Binding | Consumer、表达式、Producer、类型证据、Source |
| Predicate | Observation、精确 Scope、Freshness、Evaluator、Source |
| Diagnostic | 原始消息、解释、位置、validator 来源 |

## 4. 画布模型：Control Flow 与 Data Flow

### 4.1 Control Flow 是默认画布

Control Flow 只表达：

- Node；
- 显式 `on` Outcome → Target；
- Child Procedure 节点及其返回结果；
- Terminal；
- 有阶段节点的内部隐式转换标识。

不显示完整 Binding 数据边。

### 4.2 Route details 是控制流的解释层

Route details 不是另一套 Graph Layout。选中 Node / Edge 后，在 Inspector 显示该 Node 的所有 route groups：

| Route Source | Outcome | Target | Source |
|---|---|---|---|
| Operator | OUTCOME_UNKNOWN | reconcile-create | `nodes.create-session.on` |
| Postconditions | UNKNOWN | finalize-unresolved | `nodes.<id>.postconditions.on` |

具体行以源文件为准。上表仅说明 UI 字段，不是所有 Skill 的固定路由。

画布的 Route label density 提供：

- **Auto**：根据缩放和拥挤程度展示标签；未展示的 route entry 仍可通过 Route details 找到。
- **All**：显示所有 route outcome chips；如无法避免重叠，允许用户展开 Route list，而不是隐藏路由。
- **Selected**：只强调当前 Node / Phase / Edge 的完整标签，其他边降噪但仍可见。

### 4.3 Data Flow 是独立 Lens

Data Flow 只表达 Binding：

- 当前 Consumer 的上游 Producer；
- 当前 Producer 的下游 Consumers；
- 完整表达式与路径 token；
- 跨 Procedure 关系通过 Breadcrumb / Reference list 展示，不跨层强拉线。

默认先展示选中 Node 的直接依赖；“展开全部依赖”是显式动作。Data Flow 模式不叠加 Control Flow edges，避免两种语义混成一张网。

### 4.4 Edge bundling 规则

为了控制复杂图的线条数量，允许视觉上合并同一条物理路径，但必须满足：

- Source Node 相同；
- Route Source / Phase 相同；
- Target Node 相同。

同一 bundle 内的每个 Outcome 仍作为独立 chip / route entry 可查看。不同 Phase 的路由，即使起点和目标相同，也不得合并成无来源的一条边。

物理边数可以少于 route outcome entry 数；UI 和 Diagnostics 应分别显示“Route entries”和“Rendered connectors”，不得把两者混为一谈。

## 5. Node Card 结构与信息密度

### 5.1 默认卡片

~~~text
┌────────────────────────────────────┐
│ 03  nudm-sdm-subscribe              │
│ CALL · sbi.udm.sdm_subscription.create│
│                                    │
│ PRE 5  ·  POST 1                   │
│ 5 input bindings · 1 output ref    │
│                                    │
│ [Demo Transitional] [2 diagnostics]│
└────────────────────────────────────┘
~~~

显示优先级：

1. Node ID（不可省略）；
2. Operator kind + exact identifier；
3. Phase / Child Procedure compact chips；
4. Binding 数量（有可靠解析结果时）；
5. Compatibility / Unsupported 提示；
6. Diagnostics 数量（有真实诊断时）。

不显示：

- 完整 YAML；
- 长参数列表；
- 所有 route label；
- 推断的业务解释；
- 未执行的 PASS / FAIL；
- 伪造的 Runtime 状态。

业务摘要只有在源注释、稳定 metadata 或人工维护说明可追溯时才显示。

### 5.2 不同 Node 类型

- Verify：显示 Predicate ID。
- Call：显示 Capability ID。
- Script：显示 Script ref。
- Child Procedure：显示 Procedure ID 和 Open affordance。
- DSL Reconcile：显示原始目标 Node。
- Terminal：显示确切 terminal value。

`call: ...reconcile` 必须按 Call 展示；不能因为 Capability 名字含 reconcile 就显示成 DSL Reconcile。

### 5.3 Phase chips

有 Preconditions / Postconditions 的 Node 显示阶段数量，例如：

- `PRE 5 · CALL · POST 1`
- `PRE 2 · CALL · POST 1`
- `PRE 3 · CALL · POST 1`

Child Procedure 节点显示 `CHILD`。像 `finalize-success` 这种同时具有 Preconditions Child step 和主 Child Procedure 的节点，应明确显示 `PRE · CHILD`，详细结构进入 Inspector。

## 6. ensure-session：屏幕线框

### 6.1 Root Graph

源事实：11 个 Node、6 个非终态 Node、5 个 Terminal Node、24 条显式 route outcome entries。没有 Child Procedure，也没有 Node-level Preconditions / Postconditions。

建议画布分为三条视觉区域：

1. **Decision lane**：两个 Verify Node；
2. **Mutation / recovery lane**：Create、Reconcile、Retry、Verify；
3. **Terminal shelf**：五个 Terminal Node。

~~~text
┌───────────────────────────────────────────────────────────────────────────┐
│ ensure-session   ·   11 nodes   ·   24 route entries                      │
│ [Control Flow] [Data Flow]                  Route labels: Auto / All      │
├───────────────────────────────────────────────────────────────────────────┤
│ DECISION LANE                                                              │
│                                                                           │
│ [observe-target-session · VERIFY]                                         │
│       ├─ PASS ───────────────────────────────────────────────> [done]     │
│       ├─ FAIL ─> [observe-session-absence · VERIFY]                       │
│       │                 ├─ PASS ─> [create-session · CALL]                 │
│       │                 ├─ FAIL ────────────────────────────> [strategy-  │
│       │                 │                                  conflict]      │
│       │                 └─ UNKNOWN ─────────────────────────> [unresolved]│
│       └─ UNKNOWN ───────────────────────────────────────────> [unresolved]│
│                                                                           │
│ MUTATION / RECOVERY LANE                                                  │
│                                                                           │
│ [create-session · CALL pdu_session.create]                                │
│       ├─ COMMITTED ──────────────────────┐                                 │
│       ├─ NOT_COMMITTED / FAILED / DENIED ─────────────────────> [failed]  │
│       └─ OUTCOME_UNKNOWN ─> [reconcile-create · CALL pdu_session.reconcile]│
│                                      ├─ COMMITTED ────────────┤            │
│                                      ├─ NOT_COMMITTED ─> [retry-create]   │
│                                      ├─ UNRESOLVED ───────────> [unresolved]│
│                                      └─ FAILED / DENIED ─────> [safe-     │
│                                                                 stopped]  │
│ [retry-create-session · CALL pdu_session.create]                          │
│       ├─ COMMITTED ──────────────────────┐                                 │
│       ├─ NOT_COMMITTED / FAILED / DENIED ─────────────────────> [failed]  │
│       └─ OUTCOME_UNKNOWN ─────────────────────────────────────> [unresolved]│
│                                             │                             │
│                              [verify-created-target · VERIFY]             │
│                                   ├─ PASS ────────────────> [done]        │
│                                   ├─ FAIL ────────────────> [failed]      │
│                                   └─ UNKNOWN ─────────────> [unresolved]  │
├───────────────────────────────────────────────────────────────────────────┤
│ TERMINAL SHELF                                                             │
│ [done · SUCCEEDED] [strategy-conflict · FAILED] [failed · FAILED]         │
│ [unresolved · UNRESOLVED] [safe-stopped · SAFE_STOPPED]                    │
└───────────────────────────────────────────────────────────────────────────┘
~~~

这是布局示意，不是要求固定使用 ASCII 中的连线。实际布局可以自动排列，但所有节点、route entry 和目标必须与 Blueprint 一致。

### 6.2 默认标签策略

24 条 route outcome entries 可以作为小样本默认展开全部标签；若画布缩放到 Fit 后仍发生碰撞，则自动降低标签密度并显示 route count badge。用户可切换 All，或在 Inspector 查看完整 Route list。

不得因为空间不足而删除边或丢失 outcome。

### 6.3 选中 `reconcile-create`

Inspector 的 Overview：

~~~text
reconcile-create
Operator: CALL
Capability: pdu_session.reconcile

Inputs
  supi
    ← input.supi
  pduSessionId
    ← input.pdu-session-id
  c6BackendOperationRef
    ← create-session.output.c6BackendOperationRef
  c6OperationSemantic
    ← create-session.output.c6OperationSemantic
  c6ResultCode
    ← create-session.output.c6ResultCode
  protocolTransactionRefs
    ← create-session.output.protocolTransactionRefs
  protocolTransactions
    ← create-session.output.protocolTransactions

Routes
  COMMITTED      → verify-created-target
  NOT_COMMITTED  → retry-create-session
  UNRESOLVED     → unresolved
  FAILED         → safe-stopped
  DENIED         → safe-stopped
~~~

上面仅列出代表性 Binding。实际 Inspector 必须展示 Blueprint 中的全部输入字段，不得截断后仍显示“完整”。

## 7. establish-pdu-session：屏幕线框

### 7.1 Root Graph

源事实：17 个 Root Nodes，其中 13 个非终态 Node、4 个 Terminal Node、65 条显式 Root route outcome entries、21 个 route groups、5 个独立 Child Procedure definitions。

Root Graph 的 17 个 Node 全部可定位。默认布局使用四个 swimlanes：

1. **Main business lane**：8 个业务主线 Node；
2. **Normal finalization lane**：`finalize-failed`、`finalize-unresolved`；
3. **Reconcile lane**：三个针对原始 mutation 的精确 DSL Reconcile Node；
4. **Terminal shelf**：done / failed / unresolved / safe-stopped。

~~~text
┌────────────────────────────────────────────────────────────────────────────┐
│ ue-requested-pdu-session-establishment                                     │
│ 17 root nodes · 65 route entries · 5 child procedures                     │
│ [Control Flow] [Data Flow]             Route labels: Auto / Selected / All│
├────────────────────────────────────────────────────────────────────────────┤
│ MAIN BUSINESS LANE                                                         │
│                                                                            │
│ [nudm-sdm-get · CALL · POST 1]                                              │
│              │ implicit success → Postconditions PASS                     │
│              ▼                                                             │
│ [nudm-sdm-subscribe · PRE 5 · CALL · POST 1]                                │
│              │ implicit success → Postconditions PASS                     │
│              ▼                                                             │
│ [npcf-sm-policy-control-create · PRE 2 · CALL · POST 1]                    │
│              │ implicit success → Postconditions PASS                     │
│              ▼                                                             │
│ [n4-session-establishment · CHILD]                                         │
│              │ SUCCEEDED                                                   │
│              ▼                                                             │
│ [namf-communication-n1n2-message-transfer · PRE 3 · CALL · POST 1]          │
│              │ implicit success → Postconditions PASS                     │
│              ▼                                                             │
│ [pdu-session-resource-setup · CHILD]                                       │
│              │ SUCCEEDED                                                   │
│              ▼                                                             │
│ [n4-session-modification · CHILD]                                          │
│              │ SUCCEEDED                                                   │
│              ▼                                                             │
│ [finalize-success · PRE CHILD · CHILD]                                     │
│                                                                            │
├──────────────────────────┬─────────────────────────────────────────────────┤
│ NORMAL FINALIZATION      │ EXACT MUTATION RECONCILE                         │
│                          │                                                 │
│ [finalize-failed]        │ [reconcile-nudm-sdm-subscribe]                   │
│ [finalize-unresolved]    │ [reconcile-npcf-sm-policy-control-create]        │
│                          │ [reconcile-n1n2-message-transfer]                │
│                          │                                                 │
│                          │ Each explicit Reconcile outcome → safe-stopped  │
├──────────────────────────┴─────────────────────────────────────────────────┤
│ TERMINAL SHELF                                                             │
│ [done · SUCCEEDED] [failed · FAILED] [unresolved · UNRESOLVED]             │
│ [safe-stopped · SAFE_STOPPED]                                              │
└────────────────────────────────────────────────────────────────────────────┘
~~~

**注意：**上图的成功 lane 仅用于表达 3GPP 主业务顺序和 Node 结构，不是完整 Route map。65 条显式 route outcome entries 全部保留在图形模型和 Route details 中。图中标注的 implicit success 是阶段内转换，不是源文件 `on` route。

### 7.2 Route detail 展开

选中 `namf-communication-n1n2-message-transfer` 时，Inspector 按三个来源分组，不合并：

- Preconditions：`FAILED → finalize-failed`、`UNRESOLVED → finalize-unresolved`；
- Node Operator：`NOT_COMMITTED → finalize-failed`、`OUTCOME_UNKNOWN → reconcile-n1n2-message-transfer`、`FAILED / DENIED → finalize-failed`；
- Postconditions：`PASS → pdu-session-resource-setup`、`FAIL → finalize-failed`、`UNKNOWN → finalize-unresolved`。

主 Operator 成功进入 Postconditions 是隐式阶段转换；不生成虚构的 `COMMITTED → pdu-session-resource-setup` 边。

### 7.3 选中 `nudm-sdm-subscribe`

Inspector 的 Phases Tab：

~~~text
nudm-sdm-subscribe

PRECONDITIONS · 5 ordered steps
  1. select-subscription-configuration
     SCRIPT · scripts/select_establishment_configuration.py

  2. resolve-pcf-create-inputs
     CALL · ca.session.pcf_create_inputs.read

  3. VERIFY · createdsession.pcf.create_inputs.ready

  4. VERIFY · createdsession.ingress.eligible

  5. VERIFY · createdsession.lifecycle.ready

  Aggregate:
    FAILED     → failed
    UNRESOLVED → unresolved

MAIN OPERATOR
  CALL · sbi.udm.sdm_subscription.create

  Input highlights:
    pcfCreateInputsRef
    pcfCreateInputsInvocationRef
    selection
    ingressRef
    lifecycleRef

POSTCONDITIONS · 1 ordered step
  VERIFY · createdsession.udm.subscription_owned

  PASS    → npcf-sm-policy-control-create
  FAIL    → finalize-failed
  UNKNOWN → finalize-unresolved
~~~

步骤顺序必须保留。Precondition steps 不是主画布中的额外业务 Node。只有真实 Runtime trace 存在时，才显示 step-level execution result；静态视图只显示定义。

### 7.4 PCF Create 的源级阻塞说明

选中 `npcf-sm-policy-control-create`：

- Preconditions 显示 `createdsession.pcf.create_governed` 和 `createdsession.lifecycle.ready`。
- Predicate Inspector 显示精确 Observation / Scope / Freshness / CEL 条件。
- 源文件注释指出当前没有 admitted owner 提供 clean lifecycle isolation 与 competing-create governance evidence。
- UI 把它呈现为 **Source-defined blocking condition / runtime evaluation NOT_RUN**，而不是当前网络的动态 UNKNOWN 读数。
- `pcfCreateInputsRef` 的 readiness 与 create authorization 是两个不同事实，不可合并成一个 Gate。

### 7.5 Child Procedure Drill-in

从 Root Node `pdu-session-resource-setup` 进入：

~~~text
Root / pdu-session-resource-setup
    / await-pdu-session-resource-setup

┌──────────────────────────────────────────────────────────┐
│ await-pdu-session-resource-setup                         │
│                                                          │
│ [await-ran-result · CALL ca.session.evidence.await]      │
│          │                                               │
│          │ Postconditions:                               │
│          │ createdsession.ran.setup_accepted             │
│          │                                               │
│          ├─ PASS    → done                               │
│          ├─ FAIL    → failed                             │
│          └─ UNKNOWN → unresolved                         │
│                                                          │
│ Operator routes:                                         │
│   FAILED / UNKNOWN → unresolved                          │
│   DENIED           → failed                              │
│                                                          │
│ Terminals: SUCCEEDED / FAILED / UNRESOLVED               │
└──────────────────────────────────────────────────────────┘
~~~

五个 Child Procedure 分别打开独立图：

1. `await-initial-n4-session-establishment`
2. `await-pdu-session-resource-setup`
3. `await-n4-forwarding-convergence`
4. `await-ue-session-configuration`
5. `finalize-resource-responsibility`

最后一个 Child Procedure 的终态集合是 `SUCCEEDED / UNRESOLVED / SAFE_STOPPED`，没有 `FAILED` terminal。不能用统一模板凭空添加。

返回 Root 时恢复 pan、zoom、selection、Inspector tab、折叠状态和当前 route filter。

### 7.6 三个 Root Reconcile 节点

Root 的三个 DSL Reconcile 节点分别指向：

- `nudm-sdm-subscribe`
- `npcf-sm-policy-control-create`
- `namf-communication-n1n2-message-transfer`

每个节点的 `COMMITTED / NOT_COMMITTED / UNRESOLVED` 都路由到 `safe-stopped`。当前 source 没有从这些 Root Reconcile 节点直接恢复主业务流程或 retry 的边。

`finalize-resource-responsibility` Child Procedure 内部还有自己的 `reconcile: transfer`。它属于 Child Graph，不能与三个 Root Reconcile 节点合并。

### 7.7 Finalization route details

Root Graph 的两个常规 finalization 节点和一个成功 finalization 节点不能只作为“失败分支”图标展示。选中后，Route details 必须分别显示 Preconditions 与 Child Procedure 的来源：

| Root Node | Route Source | Outcome → Target |
|---|---|---|
| `finalize-success` | Preconditions | `FAILED → finalize-failed`；`UNRESOLVED → finalize-unresolved` |
| `finalize-success` | Child Procedure | `SUCCEEDED → done`；`FAILED → safe-stopped`；`UNRESOLVED → unresolved`；`SAFE_STOPPED → safe-stopped` |
| `finalize-failed` | Child Procedure | `SUCCEEDED → failed`；`FAILED → safe-stopped`；`UNRESOLVED → unresolved`；`SAFE_STOPPED → safe-stopped` |
| `finalize-unresolved` | Child Procedure | `SUCCEEDED → unresolved`；`FAILED → safe-stopped`；`UNRESOLVED → unresolved`；`SAFE_STOPPED → safe-stopped` |

另外，`nudm-sdm-get` 在 Operator 级 `FAILED / DENIED` 时直接到 `failed`，`UNKNOWN` 到 `unresolved`；这发生在 UDM Subscribe 资源创建之前，不应绕经 `finalize-failed` / `finalize-unresolved`。

这张表与 Root Reconcile 表共同定义了画布右侧的恢复与终态区域。不要把“资源 finalization 成功”与“原业务成功”混为一谈：例如 `finalize-failed` 的 Child Procedure 返回 SUCCEEDED，Root terminal 仍然是 FAILED。

## 8. Binding Inspector

### 8.1 双向数据导航

~~~text
BINDING
Consumer
  reconcile-create.with.c6BackendOperationRef

Expression
  create-session.output.c6BackendOperationRef

Producer
  Node: create-session
  Field: output.c6BackendOperationRef

[Go to Producer] [Go to Consumer] [Open Source]
~~~

每条 Binding 显示：

- Consumer Node / Phase / Step / Field；
- 原始表达式；
- Producer Procedure / Node / Phase / Step / Field（可解析时）；
- Declared type（有声明时）；
- Source location；
- Compatibility / Evidence level；
- Resolution state。

如果 Producer 无法解析，保留表达式并标记 UNRESOLVED；不能猜测最相似的节点。

### 8.2 CreatedSession 三种 Handle 对照

Inspector 必须能区分：

| Handle | Source | Meaning |
|---|---|---|
| `pcfCreateInputsRef` | `ca.session.pcf_create_inputs.read` | PCF Create input-readiness evidence |
| `currentSessionInstanceRef` | 同一 inputs read 的另一个输出字段 | 精确 SMF / UPF session-instance correlation |
| `contextRef` | `ca.session.operation_context.read` | Effective Session Configuration operation context |

三者即使在代码里都是 string / opaque reference，也不能被 UI 归一化成可互换的“Context Handle”。

### 8.3 Transitional Binding

对以下 CreatedSession path：

- `preconditions.<step>.output.*`
- `<node>.preconditions.<step>.output.*`

显示 `Demo Transitional` evidence label，并提示当前由 ca-agent-demo 的专用 validator 检查；不标记为通用 Schema 或 Runtime-compatible。

## 9. Predicate Inspector

### 9.1 字段

Predicate Inspector 显示：

- Predicate ID；
- Observation key / ref；
- 原始 Scope expression（可格式化，但保留 raw source）；
- Freshness；
- Evaluator type；
- CEL expression 或 Script ref；
- 引用该 Predicate 的 Procedure / Contract；
- Source file / line；
- Static source note（如果存在）。

没有 Runtime observation / evaluation 时，状态显示 `NOT_EVALUATED`，不能显示 PASS / FAIL / UNKNOWN。

### 9.2 真实样本：`createdsession.pcf.create_governed`

Source-defined detail：

- Observation ref：`createdsession.pcf_create_governance`
- Scope：`{"ueRef": subject.ueRef, "lifecycleRef": facts.createdsession_lifecycle, "ingressRef": facts.createdsession_ingress}`
- Freshness：`5s`
- Evaluator：CEL
- 条件：Lifecycle isolation state 为 CLEAN 且有 evidence ref；competing create state 为 NOT_FORWARDED 且有 governance ref。

UI 应同时显示源注释中的治理证据缺口。这是 Source-level design note，不是本地 UI 对真实网络做出的动态判断。

## 10. Source / Visual / Split 与双向编辑边界

Source / Visual / Split 是工作区模式：

- **Visual**：受支持语法的结构化编辑；
- **Source**：原始 YAML 文本编辑；
- **Split**：同一 Working Buffer 的双向同步编辑，不是两个独立文档。

Control Flow / Data Flow 是 Visual 内部的 Canvas lens，不改变 Source / Visual / Split 的状态。

### 10.1 Source → Visual

- Source 修改后增量解析；
- 成功时刷新 Semantic Model、Graph、Inspector 和引用索引；
- 解析失败时保留 Source 原文，旧图标记 STALE；
- 不自动修复或覆盖用户输入；
- 诊断绑定当前 Working Revision。

### 10.2 Visual → Source

- 所有结构化编辑生成 Typed Source Patch；
- Patch 绑定 Source revision、目标语义路径、预期旧值 / 结构指纹和 Compatibility Profile；
- 在临时 Round-trip Tree 中应用，只序列化目标区域；
- 重新解析并核对语义结果；
- 检查未修改区域没有发生意外重写；
- 显示真实 Source Diff；
- Apply 后更新 Working Buffer；Save 才写入本地文件。

### 10.3 首版编辑资格

- ensure-pdu-session：作为首个有限可编辑样本，逐项开放通过 Round-trip 测试的 Node / Route / Binding 操作；
- establish-pdu-session：先作为复杂读取与无损 round-trip 样本；
- CreatedSession node-level Preconditions / Postconditions 在专用 Profile 的 Parser、Patch 和 Round-trip 测试通过前保持 Source-only；
- Unknown / Preserve-only 语法不开放结构化修改；
- Save 不自动 Git commit / push、创建 PR 或发布。

### 10.4 Undo / Redo / Conflict

- Source 与 Visual 共用事务历史；
- 一次 Visual 命令是一个 Undo transaction；
- Patch 失败时回滚，不留下半应用状态；
- 外部文件变化时进入 CONFLICT，保留本地 Buffer，提供 Compare / Reload / Resolve；
- 未解决冲突不得覆盖磁盘版本。

## 11. 响应式、可访问性与键盘

### 11.1 响应式候选

| 窗口条件 | 建议行为 |
|---|---|
| 宽桌面（约 1440px 及以上） | Navigator + Canvas + Inspector 三栏 |
| 中等桌面（约 1100–1439px） | Navigator 可折叠；Inspector 可收为 Drawer；Canvas 优先 |
| 窄窗口（低于约 1100px） | 单主工作区；Navigator / Inspector 使用 Drawer；不强制 Split |
| 手机宽度 | 提供 Procedure Outline、Node / Route / Binding 详情列表；不承诺完整 Graph editing |

这些断点是待高保真验证的候选，不是已确认的产品支持矩阵。

### 11.2 键盘与可访问性

- Node、Route、Outline、Inspector 控件均可键盘访问。
- Canvas 必须有 Node Outline / Route list 的线性替代导航。
- 方向键在当前图的节点 / 路由列表中移动；Enter 选择；Escape 返回父上下文或关闭临时面板。
- 焦点样式清楚；不能只靠颜色区分 Operator、Outcome、Terminal 或 Compatibility。
- 状态必须有文字 / 图形双重表达。
- 支持浏览器缩放与系统 reduced-motion 设置。
- 交互控件目标尺寸以至少 32×32 CSS px 为设计目标；最终按实际控件与可访问性测试校正。
- 屏幕阅读器应能读取 Node ID、Operator、Phase、Route Source、Outcome、Target；图形布局不能成为唯一信息通道。

快捷键候选沿用 Interaction Model；实现前检查浏览器 / OS 冲突，允许后续配置。

## 12. 空状态、错误状态与部分支持

| 状态 | 画布 / Inspector 行为 |
|---|---|
| READY | 当前 Source revision 的完整投影 |
| PARTIAL | 已支持节点正常展示；未知结构 Source-only / Unsupported |
| STALE | 明确标记图对应旧 Source revision；不显示为当前图 |
| UNAVAILABLE | 只显示 Source 与诊断，不构造近似 Graph |
| Unknown Operator | Preserve-only 节点；不推断类型和效果 |
| Dangling Route | 显示目标缺失、源位置和原始 Outcome |
| Unresolved Binding | 保留原始表达式；不猜测 Producer |
| No Selection | Procedure Overview |
| No Runtime Trace | 不显示执行路径或执行态叠加；当前版本不提供 Runtime Trace UI |
| No Diagnostics | 显示当前编辑没有已知 Problems；不据此宣称完整验证通过 |

## 13. 首版验收标准

### Shared Workbench

- [ ] 1440×900 桌面布局可用；Navigator / Inspector 可折叠，Diagnostics 可收起。
- [ ] 窄窗口下不把三栏硬挤在一起。
- [ ] Source / Visual / Split 与 Control Flow / Data Flow 是两个独立维度。
- [ ] Node / Edge / Binding / Predicate 都有键盘可达的线性导航替代。
- [ ] 状态不只依赖颜色。
- [ ] Source revision、Compatibility Profile、Projection state 清晰可见。
- [ ] 未知语法、缺失引用、解析失败均不静默丢失或猜测。

### ensure-session

- [ ] 11 个 Node、24 个显式 route outcome entries 全部可访问。
- [ ] 5 个 Terminal Node 保留；`strategy-conflict` 与 `failed` 不合并。
- [ ] Create / Reconcile / Retry 的所有 outcome 和 target 正确。
- [ ] Route details 保留原始来源和 Outcome。

### establish-pdu-session

- [ ] 17 个 Root Node、65 个显式 route outcome entries 全部可访问。
- [ ] 5 个 Child Procedure 独立 Drill-in。
- [ ] 所有 3 个 Root Reconcile 节点与 Child finalizer 内的 Reconcile 保持分离。
- [ ] Preconditions / Operator / Postconditions 路由来源独立。
- [ ] 隐式成功进入 Postconditions 不被伪造成显式 route。
- [ ] PCF create governance 的 Source-level blocker note 与 Runtime NOT_RUN 分开。
- [ ] 三种重要 Handle 不混淆。

## 14. 待确认设计决策

| 决策 | 推荐基线 | 状态 |
|---|---|---|
| 默认 Canvas | Control Flow | Proposed |
| Routes | Route details 面板 + 标签密度控制，不独立成图 | Proposed |
| Bindings | 独立 Data Flow Lens | Proposed |
| Route bundling | 仅同 Node + 同 Phase / Source + 同 Target 可 bundle | Proposed |
| ensure 标签密度 | Auto 默认；Fit 后尽可能显示全部 | Proposed |
| establish 标签密度 | Auto 默认；选中 Node 时展开该 Node 的全部 route labels | Proposed |
| Inspector 默认 | 桌面默认展开；窄窗口 Drawer | Proposed |
| 1440×900 | 首个高保真基准，不是最低分辨率 | Proposed |
| 响应式断点 | 约 1100px 候选，需原型验证 | Open |
| 移动端 | 线性导航与详情，不承诺完整 Graph | Proposed |
| 业务摘要来源 | 仅稳定 metadata / 源注释 / 人工说明 | Proposed |
| Layout engine | 确定性自动布局；具体库待 POC | Open |

## 15. 设计复盘结论

推荐采用：

**一个主画布 + 两种关系 Lens + 一个上下文 Inspector。**

- Control Flow 是默认画布，负责业务控制流。
- Route details 是 Control Flow 的解释层，完整列出所有 route outcome entries。
- Data Flow 是独立 Lens，负责 Binding 生产者 / 消费者。
- Inspector 是统一详情入口，避免为了每个语义对象建立独立页面。
- Source / Visual / Split 负责编辑工作区，不与 Canvas Lens 混合。

这比三个平级 Graph / Routes / Bindings Tab 更容易理解，也能直接承载 Typed Source Patch 驱动的结构化编辑。

实现顺序建议：

1. 先完成 Round-trip YAML / Typed Patch POC；
2. 建立 Package Explorer、Source Buffer、Diff 和 Undo / Redo；
3. 在 ensure 上实现 Node / Route 的首批 Visual 编辑操作；
4. 加入 Binding / Data Flow 编辑与引用影响预览；
5. 加入 Phase / Step 和 Child Procedure 编辑；
6. 用 establish 验证复杂结构读取与 Transitional Source-only 降级；
7. 最后扩展 Contract / Predicate / Script / Schema / Reference 等运行时资产编辑器。

不要先实现 65 条边的“漂亮大图”，先证明一次真实编辑能安全、可逆地写回源文件。


## 16. Authoring-first 编辑线框

### 16.1 编辑器顶栏

~~~text
┌─────────────────────────────────────────────────────────────────────────────┐
│ procedure.yaml · Root Procedure    [Visual] [Source] [Split]                │
│ + Node   + Route   Fit   Zoom   Undo   Redo   Diff   Save     DIRTY          │
└─────────────────────────────────────────────────────────────────────────────┘
~~~

- + Node 只列出当前 Profile 已具备结构化编辑资格的 Operator；
- + Route 必须选择来源阶段和 Outcome，不能只凭拖线推断；
- Undo / Redo 与 Source Editor 共用历史；
- Diff 显示真实 YAML 文本变化；
- Save 写本地 Working Copy。

### 16.2 选中 Node 的可编辑 Inspector

~~~text
NODE · create-session                         [Source] [Reset]

Identity
  Node ID             [ create-session          ]

Operator
  Kind                [ call                    ]
  Capability          [ pdu_session.create      ]

Inputs
  supi                [ input.supi              ]
  pduSessionId        [ input.pdu-session-id    ]

Outputs
  c6BackendOperationRef
  protocolTransactionRefs

Routes · Operator
  COMMITTED           → [ verify-created-target ]
  NOT_COMMITTED       → [ failed                ]
  OUTCOME_UNKNOWN     → [ reconcile-create      ]
  FAILED              → [ failed                ]
  DENIED              → [ failed                ]

[Add Input] [Add Route] [Preview Source Diff]
~~~

这是字段结构示意，不代表每个 Node 都拥有相同字段。Inspector 必须从真实 Source / Profile 生成，不得把样例字段套用到其他 Operator。

### 16.3 新建 Route 的显式语义步骤

~~~text
Connect from: create-session
Route Source:  Operator
Outcome:       OUTCOME_UNKNOWN
Target:        reconcile-create

Source Patch:
  nodes.create-session.on.OUTCOME_UNKNOWN = reconcile-create

[Cancel] [Apply Patch]
~~~

如果 Node 有多个 Route Source，必须先选择阶段锚点。不同阶段即使 Outcome 文本相同，也属于不同 Route entry。

### 16.4 Phase / Step 编辑

Inspector 展示有序列表，支持拖动重排、插入、删除和编辑。拖动 Step 改变源 Sequence 顺序；拖动 Node 只改变画布布局，两者不能混淆。

CreatedSession Transitional Phase 在专用 Profile 资格通过前显示 Source-only，并提供 Open in Source。

### 16.5 Binding 编辑

Binding Inspector 同时显示 Consumer、原始表达式、Producer、Field、Declared Type 和 Evidence Level。

Producer Picker 只提供能确定来源和类型的候选；不确定时允许 Source 手动编辑，但不显示猜测式自动补全。

### 16.6 删除与重命名的影响预览

删除 Node / 重命名 Node 前显示：

- Incoming / Outgoing Routes；
- Binding Producer / Consumer；
- start / Entry references；
- Child Procedure / cross-file references；
- 是否需要多文件原子事务。

不能安全处理的引用会阻止结构化删除 / 重命名，而不是留下静默断链。

### 16.7 Source / Split

Source 与 Visual 两侧都能编辑同一 Working Buffer。Source 编辑后 Graph 更新；Visual Patch 应用后 Source Diff 更新。解析失败时保留原文并标记 Graph STALE，不用旧图覆盖新文本。

