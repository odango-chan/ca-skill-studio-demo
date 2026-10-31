# Procedure Designer UX

**状态：Proposed · 第二轮设计基线，待用户评审**

本文件定义 Procedure Designer 的语义呈现原则。具体屏幕分区见 [Screen Specification](procedure-designer-screen-spec.md)，交互、同步和状态行为见 [Interaction Model](procedure-designer-interaction-model.md)。

## 1. 产品职责

Procedure Designer 负责让作者理解和编辑一个 Skill Package 中的 Procedure。它不是通用流程图绘制器，也不是把 YAML 节点逐项翻译成方框的可视化器。

它必须同时表达：

- 从 `start` 开始、由显式路由连接起来的业务过程；
- 每个节点实际使用的 operator 和输入输出；
- 节点内部有序的 Preconditions、Main Operation、Postconditions；
- 不同阶段各自拥有的失败 / 未知 / 成功路由；
- 子 Procedure、异步等待和恢复边界；
- Binding 的数据生产者、消费者和来源路径；
- 当前语法的证据等级、校验结果和源文件位置。

**首要原则：业务主流程清晰，节点内部细节可展开，源文件语义不能被图形简化掉。**

## 2. 权威源与视图

Skill Package 源文件是唯一权威定义。Procedure Designer 提供三个互相同步的视图：

1. **Visual**：从源文件派生的 Procedure 图形投影；
2. **Source**：原始 YAML 编辑器；
3. **Split**：图形和源文件并排，选择与定位双向同步。

Graph、Inspector、Binding Index 和 Diagnostics 均为派生视图，不得单独保存业务定义。

首个实现阶段采用 **Visual read-only + Source editable**。只有 Round-trip AST / CST、未知字段保留、注释保留和双向一致性测试通过后，才开放图形结构编辑。Visual 不能安全解释的语法必须显示 Unsupported / Partial，不得猜测或静默丢弃。

## 3. Procedure 与 Graph 的边界

每个命名 Procedure 对应独立的图形视图：

- Procedure 的 `start` 是入口；
- Procedure 的 `nodes` 是该 Procedure 内的节点集合；
- 节点之间的业务转移来自显式 `on` 路由或相应 operator 的语义；
- `procedure: child-name` 是一个子 Procedure 调用节点；
- 子 Procedure 有自己的图，进入时 Drill-in，返回时保留父图状态；
- 不把所有 Procedure 扁平化成一张跨层大图。

布局由图结构生成，而不是按 YAML 文本顺序连线。与此同时，源文件节点顺序和注释必须原样保留；当前 CreatedSession 专用 validator 还检查了根 Procedure 的主业务节点顺序，因此自动布局绝不能重排源文件映射。

## 4. 节点模型：Operator 与业务含义分开

一个节点的核心 Operator 决定其源语义。节点名或 Capability 名称不能替代 Operator。

| Source operator | Visual 表达 | 说明 |
|---|---|---|
| `call` | Call / Operation | 调用 Capability；可能是只读、计算、等待或 mutation，不能仅凭 `call` 判断副作用 |
| `verify` | Verify | 对 Predicate / 事实进行判定 |
| `script` | Script | Skill-local 确定性计算；预览和静态校验不得执行 |
| `procedure` | Child Procedure | 调用另一个 Procedure，进入独立子图 |
| `reconcile` | Reconcile Operator | 对指定原操作进行协调 / 对账 |
| `terminal` | Terminal | Procedure 终态 |
| `tool` | Skill Tool | 当前仅为 Schema-declared，按 Source-only / Unsupported 处理 |
| `predicate` | Predicate Operator | 当前仅为 Schema-declared，按 Source-only / Unsupported 处理 |
| `for` + `do` | Loop Container | 当前仅为 Schema-declared，未在首批样本中建立编辑资格 |
| unknown | Unknown / Unsupported | 保留源文本和位置，不做语义转换 |

### 4.1 特别区分两种 Reconcile 写法

以下两种源写法不能画成同一种节点：

- `reconcile: original-node-id`：使用 DSL 的 Reconcile Operator；
- `call: pdu_session.reconcile`：普通 Call Operator，调用的 Capability 名称含有 reconcile。

例如 `ensure-pdu-session` 中的 `reconcile-create` 是第二种：它是 `call: pdu_session.reconcile`。而 `establish-pdu-session` 中的 `reconcile-nudm-sdm-subscribe` 使用第一种：`reconcile: nudm-sdm-subscribe`。

只有当 Capability Catalog / Operator 语义明确时，Visual 才可额外显示业务用途标签。不得根据节点 ID 中是否包含 reconcile 猜测 Operator。

### 4.2 Operator、效果和状态是不同维度

- Operator：`call` / `verify` / `script` / `procedure` 等；
- Effect：只读、local compute、evidence wait、mutation 等；由可信 Capability 元数据或已验证的语义提供；
- Outcome：当前 Operator 实际返回的结果；
- Procedure terminal：整个 Procedure 的终态。

`call` 不是 mutation 的同义词，`ca.*` 也不代表一定只读。无法确定 Effect 时显示 Unknown，不得推断。

## 5. 节点内部阶段

当前 CreatedSession authoring model 引入的节点级阶段：

1. **Preconditions**：主操作之前按顺序执行的入口准备；
2. **Main Operation**：节点的唯一核心 Operator；
3. **Postconditions**：主操作成功后按顺序验证业务事实。

这些阶段属于同一个业务节点，不是三个独立的主流程节点。

### 5.1 Preconditions

- `preconditions.steps` 按源顺序执行；
- 遇到第一个非成功步骤即停止；
- 当前窄范围 authoring profile 允许受限的 `script`、只读 `call`、`verify` 和指定的只读子 Procedure；
- 全部步骤成功后才可进入 Main Operation；
- 聚合路由为 `preconditions.on`，当前 CreatedSession validator 要求 `FAILED / UNRESOLVED`；
- Preconditions 失败时主操作尚未执行，不能显示为 mutation 失败。

步骤结果折叠规则以 CreatedSession authoring design 为准：Script / read-only Call / Child Procedure 的成功结果继续下一步；Verify 的 `PASS` 继续，`FAIL` 折叠为 `FAILED`，`UNKNOWN` 折叠为 `UNRESOLVED`。

### 5.2 Main Operation

主操作是节点的核心 Operator。其输入来自 `with` Binding。节点根级 `on` 只表达主操作自身的结果路由。

如果节点声明了 Postconditions，成功结果进入 Postconditions；它不能直接跳过事实验证。若没有 Postconditions，则成功转移必须由该节点的正常语义 / 显式路由表达。

### 5.3 Postconditions

- `postconditions.steps` 按源顺序执行；
- 当前 CreatedSession validator 只允许 `verify` 步骤及其可选 `with`；
- 第一个非 PASS 结果结束阶段；
- 聚合路由为 `postconditions.on`，当前要求 `PASS / FAIL / UNKNOWN`；
- 只有所有步骤都 PASS，才走 PASS 路由；
- Postconditions 验证当前节点操作之后的事实，不替代 Skill Contract 的最终 Postconditions。

### 5.4 三个路由来源必须分开

同一个节点最多可能有三组出口：

| 路由来源 | Source path | 表达内容 | 当前 CreatedSession 结果域 |
|---|---|---|---|
| Preconditions | `preconditions.on` | 主操作尚未执行时，入口准备为何退出 | `FAILED / UNRESOLVED` |
| Main Operation | node-level `on` | 核心 Operator 的实际结果 | 按 Operator / Capability 语义，例如 `NOT_COMMITTED / OUTCOME_UNKNOWN / FAILED / DENIED` |
| Postconditions | `postconditions.on` | 主操作之后的事实验证结果 | `PASS / FAIL / UNKNOWN` |

Visual 必须在每条边上显示来源阶段和 outcome，例如：

- `Preconditions · FAILED`
- `Operation · OUTCOME_UNKNOWN`
- `Postconditions · UNKNOWN`

即使多组路由指向同一个目标节点，也不能把来源信息合并掉。成功进入 Postconditions 的内部语义转移应明确标注为 **implicit success → postconditions**，不能伪装成 YAML 中显式存在的 `on` 路由。

## 6. 状态域不可混用

| 状态域 | 值 | 含义 |
|---|---|---|
| Predicate truth | `PASS / FAIL / UNKNOWN` | 事实判定 |
| Mutation certainty | `COMMITTED / NOT_COMMITTED / OUTCOME_UNKNOWN` | 副作用是否提交 / 是否确定 |
| Procedure terminal | `SUCCEEDED / FAILED / UNRESOLVED / SAFE_STOPPED` | 整个 Procedure 的结束状态 |
| Validation | `PASS / FAIL / BLOCKED / NOT_RUN / STALE` 等 | Studio 检查源文件的结果 |

节点上的 `FAILED`、`DENIED`、`UNKNOWN` 等 Operator outcome 仍须保留其原始来源，不能直接映射为 Predicate 或 Procedure terminal。

状态展示必须同时包含文字和语义说明，不能只用颜色。

## 7. Binding 与数据流

Binding Inspector 的目标是解释 `with` / `from`：某个输入值来自哪里、由谁生产、经过哪个阶段产生、有哪些消费者。

初始来源类型：

- Procedure input；
- `context.subject / request / facts / constraints`；
- 先前节点的 `output`；
- 当前 CreatedSession 过渡语法中的节点级 Preconditions step output；
- Schema 声明但尚未资格验收的 Loop item；
- literal `value`。

### 7.1 标准来源与过渡来源

必须明确区分：

- 通用本地 Schema 中的 `input.*`、`context.*`、`<node>.output.*`、`loop.*`；
- 当前 CreatedSession authoring source 中使用的 `preconditions.<step>.output.*` 以及跨节点的 `<node>.preconditions.<step>.output.*`。

后者由 ca-agent-demo 的窄范围专用 validator 检查，不得宣称为通用 Schema 或 Runtime 能力。

### 7.2 Binding Inspector 字段

每条 Binding 显示：

- Consumer node / phase / step；
- Consumer field；
- Source expression；
- Producer Procedure / node / phase / step；
- Output field；
- Declared type（无法证明时 Unknown）；
- Source file location；
- Evidence level；
- Validation state。

点击 Binding 时在当前图中高亮生产者和消费者；跨 Procedure 时显示 Procedure breadcrumb，不将它们强行连成同一层的图边。

### 7.3 数据依赖不等于控制流

`from` 表达数据依赖，`on` 表达控制流。两者必须分开呈现。

默认画布只显示控制流。选中节点或 Binding 后，才显示数据依赖高亮 / 侧栏，避免所有数据边与控制流边叠在一起形成“意大利面图”。

## 8. 子 Procedure 与异步过程

- `procedure: child-name` 显示为 Child Procedure 节点；
- 双击或选择 Open Procedure 进入子图；
- Breadcrumb 显示父 / 子层级；
- 子图返回时恢复父图缩放、位置、选择和展开状态；
- 不将子 Procedure 内部节点自动展开到父图；
- 对异步网络收敛使用明确的 await / convergence 子 Procedure，不把它压扁成一个普通 Verify 节点；
- Schema-declared、但没有当前 Demo 使用 / 校验 / Runtime 证据的跨 Skill Composition，只显示其证据等级，不提供“已可执行”的视觉暗示。

## 9. 案例映射与 Qualification

Procedure Designer 可以展示与当前节点相关的 Case / Qualification obligations，但必须遵循：

- 只有存在明确的 source reference / trace mapping 时才展示映射关系；
- Semantic obligation、Schema-valid Case、Executable Fixture、Executed 和 Qualified 分开显示；
- 不从 Case 数量推断覆盖率；
- 不将 `establish-pdu-session` 的 36 个 semantic qualification obligations 显示为已执行测试；
- 不在当前 Procedure Designer 内直接触发 Runtime 或 Live 5GC。

## 10. 初始样本的设计目标

### ensure-pdu-session

用于验证基础流程：

- Verify 的 `PASS / FAIL / UNKNOWN`；
- Call 的 mutation certainty；
- `OUTCOME_UNKNOWN` 进入精确的 Reconcile 路径；
- Reconcile 后的 retry / verify / unresolved / safe-stopped 分支；
- 显式 terminal。

注意：该样本的 `reconcile-create` 节点使用 `call: pdu_session.reconcile`，不是 DSL 的 `reconcile:` Operator。

### establish-pdu-session

用于验证复杂流程：

- 3GPP 主业务节点顺序；
- 节点内部 Preconditions / Main Operation / Postconditions；
- 多阶段 `on` 路由；
- 跨节点与节点内 Preparation output Binding；
- N4 / RAN / UE 异步等待子 Procedure；
- 资源责任 finalization；
- 对三个不确定 mutation 的精确 Reconcile + SAFE_STOPPED；
- 36 个 semantic qualification obligations 的诚实呈现。

当前源仓的 CreatedSession authoring design 明确标记 **NOT YET RUNTIME-COMPATIBLE**。Studio 只承诺正确读取、展示和执行当前 Demo 专用静态校验；不承诺 Runtime Qualification。

## 11. 第一阶段编辑边界

第一阶段：

- Visual：Read-only projection；
- Source：原始 YAML 文本编辑；
- Inspector：只读语义详情；
- Binding Inspector：只读来源解析与定位；
- Diagnostics：只读诊断和导航；
- Validate：只执行明确配置的本地静态检查。

后续双向图形编辑必须以 Typed Source Patch 为中介，执行 Patch 前检查语义前置条件，保存前显示 Diff，保存后重新解析并重新校验。对未知语法、未建立类型信息或不支持的 Operator，不允许结构化修改。

## 12. 来源与兼容性基线

当前第一阶段兼容性来源：

- Repository: `odango-chan/ca-agent-demo`
- Commit: `bf445ad777149af5af2dfa0a5bdea18d0451303e`
- `skills/ensure-pdu-session/assurance/procedure.yaml`
- `skills/establish-pdu-session/assurance/procedure.yaml`
- `skills/establish-pdu-session/design/README.md`
- `skills/establish-pdu-session/cases/README.md`
- `scripts/validate_docs.py`
- `tests/contracts/ca-skill-toolchain/03a42764ee2a67e39f57ab550b63c7a5d7966199/procedure-source.schema.yaml`

具体的屏幕和交互规则见配套规范。更新 Demo baseline 时，必须重新核对这些源文件和 validator，不得静默沿用旧假设。
