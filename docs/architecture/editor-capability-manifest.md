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


## 7. Authoring Editability Gate

源文件出现某个语法，不代表该语法已经可以结构化编辑。每个语法 / 字段的 Visual editability 必须有独立证据：

1. Parser 能识别并提供准确 Source Map；
2. Typed Patch 能准确表达该修改；
3. Round-trip 测试证明注释、顺序、样式和未知字段不丢失；
4. 修改后重新解析得到预期语义；
5. 对应 Demo Schema / 专用 Validator 证据已记录（若适用）。

因此：

- observed-and-used 不自动等于 editable；
- demo-schema-declared 不自动等于 editable 或 Runtime-proven；
- demo-custom-validated 不自动等于通用 Schema；
- establish-pdu-session 的 Transitional Phase 在专用 Profile 通过前保持 Source-only；
- 未知字段和语法必须 Preserve-only，不得因全量序列化而消失。

机器可读 Manifest 中的 authoringPolicy 当前是 Proposed，不代表这些编辑能力已经实现。
