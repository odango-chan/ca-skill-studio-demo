# Procedure Designer UX

**状态：Proposed · 核心交互规范初稿**

Procedure Designer 是 Skill Studio 的核心页面。它必须同时服务业务理解、形式化编辑和错误诊断，不能退化为普通流程图，也不能只把 YAML 节点机械地画成方框。

## 1. 设计目标

用户打开 Procedure 后，应能：

1. 先理解业务主流程；
2. 识别真实业务操作、异步收敛、恢复和终态；
3. 展开节点查看 Preconditions、Operation、Postconditions；
4. 追踪输入、Binding、输出和消费者；
5. 查看 Predicate、Capability 和 Contract 的关联；
6. 从图形定位源文件；
7. 在不丢失语义的情况下编辑源文件或图形。

## 2. 三层视图

### 2.1 Business Flow

默认层级。展示主业务节点、主要路由、子流程入口和终态。

### 2.2 Node Detail

选择节点后，在 Inspector 展示节点内部结构：

- Identity；
- Node Operator；
- Inputs / Bindings；
- Preconditions；
- Main Operation；
- Postconditions；
- Outcome Routing；
- Related Predicates / Capabilities；
- Source Location。

Preconditions、Main Operation、Postconditions 属于同一个业务节点的内部阶段。它们不应自动变成三个主业务节点。

### 2.3 Source

显示对应 YAML，并支持定位、编辑、Diff 和诊断行号。Source 与 Visual 是同一源文件的两个视图。

## 3. 画布组织

推荐纵向主流程，分支向侧面展开。复杂子流程按需进入，不将所有节点无差别铺在一张无限画布上。

画布基本能力：

- Zoom In / Out；
- Pan；
- Fit to View；
- Minimap（是否默认显示待评审）；
- 选择节点；
- 多选和框选（编辑能力阶段再开放）；
- 节点搜索；
- 诊断定位；
- 子流程 Drill-in / Drill-out。

图形布局顺序不能改变 YAML 的源节点顺序。自动布局结果只影响视觉坐标，不应重排源文件。

## 4. 节点视觉模型

节点卡片至少显示 Node ID、操作或 Predicate 名称、节点类别、一句可读摘要、子步骤或绑定数量、诊断标记，以及是否存在未知 / 过渡语法。

| 类别 | 表达 | 说明 |
|---|---|---|
| Capability Call | 操作节点 | 外部能力调用 |
| Verify | 判定节点 | 通过 Predicate / Observation 判断事实 |
| Script | 本地计算节点 | 不应默认执行 |
| Child Procedure | 可展开容器 | 进入子流程 |
| Reconcile | 协调节点 | 与原 mutation 结果关联 |
| Loop | 循环容器 | 仅在当前语法和校验能力明确支持时编辑 |
| Terminal | 终态节点 | SUCCEEDED / FAILED / UNRESOLVED / SAFE_STOPPED |
| Unknown / Unsupported | 保留节点 | 可查看源文件，不允许静默转换 |

Schema 声明的节点类型不等于当前 Demo Runtime 已经验证支持。节点卡片和 Inspector 必须显示能力证据等级。

## 5. 路由展示

路由必须保留所属阶段。不得把不同层级的 on 合并成一组无来源的出口。

### Node operation routes

处理主操作的返回状态，例如 COMMITTED、NOT_COMMITTED、OUTCOME_UNKNOWN、FAILED、DENIED；实际允许值由当前节点语义决定。

### Preconditions routes

当前 CreatedSession 过渡语法使用 FAILED / UNRESOLVED。其含义是主操作尚未执行，不能将其误画为 mutation 失败。

### Postconditions routes

当前 CreatedSession 过渡语法使用 PASS / FAIL / UNKNOWN。只有所有有序验证步骤都 PASS，才走 PASS 路由。

### Terminal

Procedure terminal 状态：

- SUCCEEDED；
- FAILED；
- UNRESOLVED；
- SAFE_STOPPED。

Predicate 状态、Mutation certainty 和 Procedure terminal 是三个独立状态域，必须使用不同标签和说明。

## 6. Preconditions / Operation / Postconditions

节点详情使用阶段式展示：

~~~text
Node: nudm-sdm-subscribe

01 Preconditions
   ordered, side-effect-free preparation
   steps + aggregate routes

02 Main Operation
   sbi.udm.sdm_subscription.create
   input bindings

03 Postconditions
   ordered fact verification
   PASS / FAIL / UNKNOWN routes

04 Operation Outcome
   COMMITTED / NOT_COMMITTED / OUTCOME_UNKNOWN / ...
~~~

当前 Demo 的 CreatedSession 设计要求：

- Preconditions 是有序的节点入口准备阶段；
- Preconditions 只能包含受限的只读准备、Script 计算、Verify 或允许的只读子流程；
- Postconditions 只做事实验证；
- Postconditions 不能替代 Skill Contract 的最终 Postconditions；
- Mutation COMMITTED 不等于业务事实 PASS；
- 主流程节点应对应有业务意义的操作、异步过程、恢复边界或 3GPP 操作/消息，不应为了每次检查增加主业务节点。

这些规则的证据来自当前 Demo 的 CreatedSession authoring design 和专用 validator。它们不能被 UI 推广成所有 Skill 都已支持的通用 Runtime 语义。

## 7. Binding Designer

Binding Inspector 应支持从可用来源树中选择字段，而不是要求作者手写长路径。

初始来源类别：

- Procedure input；
- Context subject / request / facts / constraints；
- Prior node output；
- Node-local preparation output；
- Loop item（仅在语法支持时）。

选择器展示 Source Procedure / Node、Producer stage、Output field、Declared type、Consumer、Source location 和 Validation state。

选择后写入当前 Demo 源语法所需的 from 表达式。类型不明、输出未声明或生产时机无法确认时显示 Unknown / Unresolved，不得猜测。

## 8. Child Procedure 和 Composition

- 当前 Procedure 内的子流程通过面包屑导航进入。
- 返回父流程时保留视图状态和选中位置。
- 跨 Skill Composition 如果只是 Schema 声明而没有当前 Demo 可执行证据，显示为 Schema-declared / Not qualified。
- 不把未解析的依赖显示为已成功链接的节点。

## 9. 节点编辑交互

第一阶段建议先做只读图形投影和 Source 编辑。双向图形编辑必须等 AST / Round-trip 编辑能力验证后开放。

后续图形编辑行为：

- Add Node：从当前 Demo 能力清单选择受支持的节点类型；
- Connect：只创建当前语法允许的路由；
- Edit Binding：通过 Binding Designer 修改；
- Delete Node：展示所有入边、出边和引用，要求显式确认；
- Rename Node：同步更新 start、on 路由和所有 Binding 引用；
- Change Node Type：展示语义差异，不做静默字段迁移；
- Reorder：只影响明确允许排序的结构，不自动重排源文件。

## 10. 诊断与定位

- 画布节点显示错误 / 警告标记；
- 点击诊断跳转节点并高亮字段；
- 点击字段显示原始路径和行列；
- 相关 Predicate、Capability、Contract 可从 Inspector 直接打开；
- 无法定位到准确行列时，显示文件级位置，不虚构行号。

## 11. 无损与未知语法策略

编辑器必须保留注释、键顺序、标量风格和未知字段。

如果当前 Parser / AST 无法保证无损写回：

- 允许 Source 编辑；
- Visual 进入 Read-only；
- 对受影响字段显示 Unsupported / Unknown；
- 保存时不得丢弃未识别内容。

## 12. 当前重点样本

- ensure-pdu-session：基础 call / verify / reconcile / terminal / on 分支；
- establish-pdu-session：复杂主流程、节点阶段、ordered preparation、Binding、异步等待、多个 reconcile 和 36 个语义验收义务。

完整源仓基线见 [Demo baseline](../reference/demo-baseline.md)。
