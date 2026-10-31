# Runtime Skill Asset Editors UX

**状态：Proposed · Host / Runtime-consumption scoped**

所有资产编辑器共享 Runtime Asset Explorer、Source Buffer、Diff、Undo / Redo、Source Navigation 和 Problems。Visual 结构化编辑必须经过 Typed Source Patch；不因文件存在就推断 Runtime 支持。

## 1. SKILL.md / Business Guide

- Markdown Source Editor、Preview、Document Outline 和 Frontmatter Inspector；
- Source 与 Preview 同步；Preview 不反向重写原文；
- 支持标题、列表、链接、表格、代码块和 Frontmatter；
- Model Context Preview 展示 Host 实际加载规则；
- references/preload 标记为自动加载；
- references/on-demand 和 references/samples 标记为精确路径显式加载；
- assurance、scripts、schemas 不自动塞入模型上下文。

## 2. Contract Editor

分区：Identity & Goal、Skill Type / Entry Procedure、Inputs、Context Requirements、Allowed Resources、Preconditions、Requirements、Postconditions、Planning、Dependencies、Failure Semantics。

- 表单编辑必须经 Source Patch；
- Goal / Predicate / Entry Procedure 提供 Package 内引用导航；
- Capability / Local Tool Catalog 只列出有 Host 注册证据的标识符；
- requestSchema 等引用明确区分 Contract-declared 与 Runtime-loaded；
- 未知字段保留，不做全量重写。

## 3. Predicate Workbench

显示 Predicate ID、Observation ref、Scope、Freshness、When、Evaluator、CEL / Script ref、引用者和 Source location。

- 支持 Source 编辑；
- 结构化字段编辑按 Manifest 资格开放；
- Observation ref 只有在 ObservationSource 有明确 Adapter 支持时才标记为可执行；
- Script evaluator 只有在 Governed Script Backend allowlist 支持时才标记为可执行；
- 不推断 Observation producer / authority。

## 4. Script Editor

- Python Source Editor、语法高亮、静态诊断和引用索引；
- 显示被 Procedure Step / Predicate 引用的位置；
- 显示 Host Backend allowlist 状态、输入 Schema、输出 Schema；
- 新增或修改 Script 不自动授权执行；
- 默认不执行 Script，不提供通用 Python Console；
- Script 只有通过 Host / Runtime 的精确注册和受治理 Backend 才能被执行。

## 5. Schema Editor

- YAML / JSON Schema Source Editor；
- 显示 schema title / $id、引用者、输入或输出方向；
- 区分 Runtime 实际加载、Contract-declared 和仅由本地 Validator 使用的 Schema；
- 不把本地静态校验等同于 Runtime 已消费；
- 保存后检查引用路径和受影响 Script。

## 6. Reference Editor

- Markdown Source / Preview；
- 显示 exact path、加载模式、在 SKILL.md 中的引用位置；
- preload 在 Skill 选择后自动加载；
- on-demand / samples 只允许按 SKILL.md 中明确声明的精确路径读取；
- 当前固定 Skill Packages 没有实际 references 目录；首版不创建空目录，只在样本真实使用时开放。

## 7. Runtime Asset Map

每个资产至少显示：

- Source path；
- Asset kind；
- Consumer（Host Loader / Admission / Linker / PredicateEngine / Script Backend）；
- Consumption mode（model-context / machine-execution / contract-declared / host-external）；
- Reference path / identity；
- Evidence level；
- Structured edit capability。

未证明 Runtime 消费的辅助文件不显示为一等资产。完整 Package 中未建模的文件仍需原样保留，并参与完整 Artifact Digest。
