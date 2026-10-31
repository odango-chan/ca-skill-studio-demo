# Editor Capability Manifest

**状态：Observed Runtime Asset Baseline**

## 1. 目的

Capability Manifest 描述编辑器当前能够识别、展示、编辑哪些实际进入模型上下文或 Host / Runtime 执行链路的 Skill 资产与语法。它是 UI 和 Adapter 的能力输入，不是新的 Skill DSL，也不是 Runtime Contract。

机器可读版本位于 [spec/editor-capability-manifest.yaml](../../spec/editor-capability-manifest.yaml)。

## 2. 资产消费证据等级

| 等级 | 含义 |
|---|---|
| model-context-consumed | 被 Host SkillContextLoader 加载到模型上下文 |
| runtime-consumed | 被 Host / Runtime 读取、冻结、校验或执行 |
| contract-declared | 被 Runtime-consumed Contract 引用，但当前直接 Runtime 路径未证明实际加载 |
| host-external | 被 Host / Runtime 消费，但位于 Skill Package 外 |
| loader-supported-not-observed | Host 支持该加载模式，但固定基线中没有 Skill 实际使用 |
| schema-declared | 存在于 ca-agent-demo 本地固定 Schema 快照 |
| demo-custom-validated | 由 ca-agent-demo 专项 validator 检查 |
| not-runtime-consumed | 不进入模型上下文，也不被当前 Host / Runtime 路径消费 |

## 3. 编辑器行为等级

| 行为 | 含义 |
|---|---|
| editable | 有明确语法和无损编辑支持 |
| source-only | 可编辑源文本，不提供结构化编辑 |
| preserve-only | 不理解语义，但必须无损保留 |
| opaque-preserve | 不作为一等编辑资产展示；完整 Package 操作中必须保留 |
| unavailable | 当前无法安全支持 |

Manifest 中的消费证据与编辑资格是两回事。某资产被 Runtime 消费，不代表 Studio 已经具备安全的结构化编辑能力；某字段出现在 Schema 中，也不代表 Runtime 已实际使用它。

## 4. 固定基线的消费实现

| Asset | Consumer | 读取 / 消费方式 |
|---|---|---|
| SKILL.md | SkillContextLoader | 读取全文并生成模型上下文 |
| references/preload | SkillContextLoader | 选中 Skill 后自动加载 |
| references/on-demand / samples | SkillContextLoader.read_reference | 精确路径读取，且路径必须出现在 SKILL.md |
| assurance/contract.yaml | Admission / exact-entry linker | Skill type、Entry、Dependencies、Required Facts、Postconditions |
| assurance/procedure.yaml | Admission / Linker | 解析并冻结精确 Entry Procedure |
| assurance/predicates.yaml | Admission / Linker / PredicateEngine | 冻结 Predicate definitions 并执行 CEL / Script evaluator |
| scripts/*.py | Governed Script Backend | 精确 allowlist + AST 限制 + Schema 边界校验 |
| schemas/*.yaml | Governed Script Backend | 校验受治理 Script 输入 / 输出 |
| planning/skill-surfaces/5gc-file-transfer.yaml | Root Linker | Host-level Root local Procedure allowlist，位于 Package 外 |

当前固定 Skill Packages 未观察到实际 references 目录，但 Host Loader 已支持对应加载规则。establish-pdu-session 的 establishment-request.schema.yaml 被 Contract 声明引用；在当前直接 Entry Admission / Linker 路径中尚未确认其 Runtime 加载，因此 Manifest 将其标记为 Contract-declared。

## 5. 初始语法证据

当前 Demo 本地 Schema 快照声明的 Procedure 结构包括 procedures、applicability、inputs、start、nodes，以及 call / tool / script / predicate / verify / procedure / for / reconcile / terminal、with / from、on、for / do 和 cross-Skill composition reference。

当前 Skill 样本中实际观察到并被 Runtime 消费的主要构造包括 call、verify、script、procedure、with / from、on、inputs / start / nodes。DSL reconcile Operator 与 Capability 名称中含 reconcile 的普通 Call 必须区分。

CreatedSession 的 node-level preconditions / postconditions 不在该本地 ProcedureSource Schema 中；当前由 Demo 的窄范围专用 validator 处理，尚不代表通用 Runtime 兼容。

## 6. YAML 兼容性

Demo validator 对 PyYAML SafeLoader 调整 bool resolver，只将 true / false 解析为布尔值，避免 YAML 1.1 将未加引号的 on 解析成布尔值。

Studio 的 Source Parser、Round-trip Serializer 和 Demo Validator Adapter 必须共享一致的语义预期。

## 7. Authoring Editability Gate

源文件出现某个语法或 Runtime 消费某个资产，都不代表它已经可以结构化编辑。每个语法 / 字段的 Visual editability 必须有独立证据：

1. Parser 能识别并提供准确 Source Map；
2. Typed Patch 能准确表达该修改；
3. Round-trip 测试证明注释、顺序、样式和未知字段不丢失；
4. 修改后重新解析得到预期语义；
5. 对应 Demo Schema / 专用 Validator 证据已记录（若适用）。

因此：

- runtime-consumed 不自动等于 editable；
- model-context-consumed 不自动等于 Runtime execution asset；
- contract-declared 不自动等于 Runtime-loaded；
- schema-declared 不自动等于 Runtime-proven；
- demo-custom-validated 不自动等于通用 Schema；
- establish-pdu-session 的 Transitional Phase 在专用 Profile 通过前保持 Source-only；
- 新增 Script 不自动获得 Host Backend 执行权限；
- 未知字段和语法必须 Preserve-only，不得因全量序列化而消失。

## 8. Package Identity 与不展示文件

当前 exact Skill artifact digest 覆盖 Skill 根目录全部文件；Model Context digest 只覆盖 SKILL.md 与实际 preload 文件。

不展示为一等 Runtime Asset 的文件仍可能影响完整 Artifact Digest。Studio 必须保留这些文件、在完整 Package 保存 / 导出中包含它们，并重新计算完整 Digest；不能把它们的 Digest 参与误解为 Runtime 消费证据。

机器可读 Manifest 中的 authoringPolicy 当前是 Proposed，不代表这些编辑能力已经实现。
