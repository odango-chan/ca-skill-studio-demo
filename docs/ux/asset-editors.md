# Skill Asset Editors UX

**状态：Proposed**

本页定义 Procedure Designer 以外的主要资产编辑体验。所有编辑器共享同一 Package Explorer、Source Navigation、Diff 和 Diagnostics。

## 1. SKILL.md / Business Guide

工作区包含 Source 编辑、Markdown Preview、Document Outline、Frontmatter Inspector 和链接检查。

内容结构建议：When to use、Business Goal、Boundary / Supported Profile、Required Facts、What must not be guessed、Decision Rules、Success Semantics。这些是编辑建议，不应强制所有 SKILL.md 使用完全相同的标题模板。

### Model Context Preview

展示可能进入模型上下文的内容，并为每项标明：

- Host auto-loaded；
- Skill-selected；
- Exact-path on-demand；
- Never auto-loaded；
- Unknown / Not verified。

当前 Demo 的 references 规则为：

- references/preload：Skill 被 Host 选择并加载后自动加载；
- references/on-demand：只有 SKILL.md 给出精确路径和触发条件时才读取；
- references/samples：说明 / few-shot 示例，不自动加载；
- assurance、cases、scripts 不因属于 Package 就自动进入模型上下文。

Model Context Preview 必须基于可核验的 Host 装配实现。无法还原的部分标记为 Approximation，不得冒充真实运行时上下文。

## 2. Contract Editor

建议分区：

1. Identity & Goal；
2. Skill Type / Entry Procedure；
3. Inputs；
4. Context Requirements；
5. Allowed Resources；
6. Preconditions；
7. Requirements；
8. Postconditions；
9. Planning；
10. Dependencies；
11. Failure Semantics。

关键交互：

- Goal 和 Predicate ID 提供引用选择；
- Entry Procedure 指向当前 Package 的 Procedure；
- Request Schema 选择 Package 内路径；
- Allowed Capabilities / Local Tools 来自可用目录；
- 显示 Procedure 实际引用与 Contract 授权的差异；
- Budget、Dynamic Procedure、Dependency 和 Failure Semantics 展示精确字段定义。

如果 Capability Catalog 不可用，允许 Source 编辑，但不提供虚假的智能补全。

## 3. Predicate Workbench

### Predicate 列表

每行展示 Predicate ID、Evaluator 类型、Observation 数量、被引用次数、源文件位置和最近诊断。

### Predicate 详情

分区：Identity、Observations、Scope、Freshness、Optional When、Evaluator、Usage、Fixture Evaluation（仅在有合法 Fixture 时）。

### Evidence Provenance View

~~~text
Predicate
  -> Observation reference
  -> Observation source / producer
  -> scope
  -> freshness
  -> evaluator
  -> PASS / FAIL / UNKNOWN
~~~

当前 Predicate YAML 可表达 Observation ref、scope、freshness、when，以及 CEL 或 Script evaluator。Observation 的真实 producer、authority 和 runtime provenance 不一定能从 Predicate 文件单独得出；无法确认时必须显示 Not Resolved。

### 离线求值

- 只使用明确选择的 Fixture；
- 展示 Fixture 来源；
- 不调用真实 Observation Provider；
- 缺字段或类型不匹配时显示错误 / UNKNOWN；
- 不把离线 CEL 求值标记为真实业务 Predicate PASS。

## 4. Case Studio

Case 列表展示 Case ID / Name、Classes、Purpose、Definition Validation、Execution State、Expected Terminal 和 Source Location。

详情区展示 PlanningContext、Subject / Request / Facts、Available Resources、Constraints、Expected Procedure、Expected Planning Status、Expected Terminal、Expected Postconditions、Trace expectation 和 Fixtures（如存在）。

必须区分：

1. Semantic obligation：描述需要验证的业务场景；
2. Schema / Envelope Valid：Case 结构通过检查；
3. Executable Fixture：存在可供执行的动作 / Predicate 等 Fixture；
4. Executed：有真实执行记录；
5. Qualified：通过规定的资格验收。

establish-pdu-session 当前 36 个 Case 属于 semantic qualification obligations，不是可执行 Runtime fixtures。UI 不得把它们计入 Executed Coverage。

## 5. References Browser

按 Preload、On-demand、Samples 分组。展示加载规则、被哪些 SKILL.md 指向、精确路径和内容预览。不得允许模型或用户通过默认流程任意枚举并自动加载所有 Reference。

## 6. Schema Browser

- 展示 Schema 文件及引用关系；
- 支持 JSON / YAML Schema 源码；
- 展示 Schema 的来源 Commit、Digest 和版本；
- 展示被哪些 Request / Payload / Predicate 引用；
- 当前 Demo 本地 Schema 快照与自定义 validator 必须分开标注。

## 7. Script Browser

- 展示脚本路径、用途、输入输出和引用者；
- 静态检查语法和元数据；
- 默认不执行；
- 若未来支持执行，必须进入显式 Sandbox Run 流程；
- Script 结果不能直接替代 Observation 或 Predicate authority。
