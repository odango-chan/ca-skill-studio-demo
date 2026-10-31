# Editor Capability Manifest

**状态：Initial observed baseline**

## 1. 目的

Capability Manifest 描述编辑器当前能够识别、展示、编辑和校验哪些 Skill 资产与语法。它是 UI 和 Adapter 的能力输入，不是新的 Skill DSL，也不是 Runtime Contract。

机器可读版本位于 [spec/editor-capability-manifest.yaml](../../spec/editor-capability-manifest.yaml)。

## 2. 证据等级

| 等级 | 含义 |
|---|---|
| observed-and-used | 在 ca-agent-demo 当前 Skill 源文件中实际出现 |
| demo-schema-declared | 存在于 ca-agent-demo 本地固定 Schema 快照 |
| demo-custom-validated | 由 ca-agent-demo 专项 validator 检查 |
| optional-package-asset | Package 约定允许，但不是每个 Skill 都拥有 |
| not-established | 当前证据不足以承诺可编辑或可执行 |

## 3. 编辑器行为等级

| 行为 | 含义 |
|---|---|
| editable | 有明确语法和无损编辑支持 |
| source-only | 可查看 / 编辑源文本，不提供结构化编辑 |
| read-only | 可以展示解析结果，但编辑禁用 |
| preserve-only | 不理解语义，但必须无损保留 |
| unavailable | 当前无法安全支持 |

Manifest 中的 syntax evidence 与 editor behavior 是两回事。某语法出现在 Schema 中，不代表它已经有完整 Runtime 验收证据。

## 4. 初始语法证据

当前 Demo 本地 Schema 快照声明的 Procedure 结构包括 procedures、applicability、inputs、start、nodes，以及 call / tool / script / predicate / verify / procedure / for / reconcile / terminal、with / from、on、for / do 和 cross-Skill composition reference。

当前 Skill 样本中实际观察到的主要构造包括 call、verify、script、procedure、with / from、on、reconcile 相关操作、terminal、inputs / start / nodes。

CreatedSession 的 node-level preconditions / postconditions 不在该本地 ProcedureSource Schema 中；当前由 Demo 的窄范围专用 validator 处理。

## 5. YAML 兼容性

Demo validator 对 PyYAML SafeLoader 调整 bool resolver，只将 true / false 解析为布尔值，避免 YAML 1.1 将未加引号的 on 解析成布尔值。

Studio 的 Source Parser、Round-trip Serializer 和 Demo Validator Adapter 必须共享一致的语义预期。

## 6. Manifest 更新流程

更新能力时必须指明源仓 Commit、Schema / Validator 路径，区分 Schema-declared 与 source-observed，标记当前是否可编辑及 Runtime / Qualification 证据是否存在，并增加对应 Parser / UI / Validator 测试。

不得只因新增一个字段示例，就宣称完整支持某个语法特性。
