# Skill Asset Editors UX

**状态：Proposed · Shared authoring model**

所有资产编辑器共享 Package Explorer、Source Buffer、Typed Patch（适用时）、Diff、Undo / Redo、Source Navigation 和 Problems。

## 1. SKILL.md / Business Guide

- Markdown Source Editor、Preview、Document Outline 和 Frontmatter Inspector；
- Source 与 Preview 同步；Preview 不反向重写原文；
- 支持标题、列表、链接、表格、代码块和 Frontmatter；
- Model Context Preview 展示可核验的 Host 加载规则；
- references/preload、on-demand、samples 按当前 Demo 约定呈现；
- 不把 assurance、cases、scripts 自动塞入模型上下文。

## 2. Contract Editor（后续资产编辑阶段）

分区：Identity & Goal、Skill Type / Entry Procedure、Inputs、Context Requirements、Allowed Resources、Preconditions、Requirements、Postconditions、Planning、Dependencies、Failure Semantics。

- 表单编辑必须经 Source Patch；
- Goal / Predicate / Entry Procedure 提供 Package 内引用导航；
- Capability / Local Tool Catalog 不可用时允许 Source 编辑，不提供虚假智能补全；
- 未知字段保留，不做全量重写。

## 3. Predicate Workbench（后续资产编辑阶段）

显示 Predicate ID、Observation ref、Scope、Freshness、When、Evaluator、CEL / Script、引用者和 Source location。

- 支持 Source 编辑；
- 结构化字段编辑按 Manifest 资格开放；
- 离线 Fixture 求值与真实 Observation 获取严格区分；
- 无法确认 Observation producer / authority 时显示 Not Resolved。

## 4. Case Editor（后续资产编辑阶段）

区分 Semantic obligation、Schema / Envelope Valid、Executable Fixture、Executed、Qualified。当前 establish-pdu-session 的 36 项只作为 semantic qualification obligations，不显示为已执行测试或覆盖率。

## 5. References / Schema / Script

- 展示路径、加载规则、来源和引用者；
- Schema 标注来源 Commit / Digest；
- Script 仅支持 Source 编辑和静态查看；
- 默认不执行 Script；
- 任何未来执行能力必须进入独立 Sandbox，不属于当前编辑闭环。

## 6. Maintainer Documentation

- Package Explorer 按实际文件树显示 design/ 等维护者文档目录（如存在），不把它们提升为所有 Skill 的标准目录；
- 使用通用 Markdown Source Editor / Preview，不提供虚构的 Runtime 语义；
- 明确标记 Maintainer-only，不自动纳入模型上下文；
- 当前 establish-pdu-session/design/ 中的 authoring model 与实验说明属于此类资产。
