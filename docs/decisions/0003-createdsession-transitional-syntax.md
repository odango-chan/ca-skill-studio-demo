# ADR-0003：CreatedSession 过渡语法必须显式建模

- 状态：Accepted
- 日期：2026-10-31

## 背景

当前 Demo 的 establish-pdu-session 使用 node-level preconditions / postconditions。Demo 的本地 ProcedureSource Schema 快照没有这些字段；scripts/validate_docs.py 通过专用窄范围 validator 检查当前 authoring source。

该 Skill 的 authoring model 将其标记为 NOT YET RUNTIME-COMPATIBLE。专用 validator 通过不代表当前 Host / Runtime 已支持这些过渡语义。

## 决策

Skill Studio 必须将该语法作为显式 Demo Transitional Profile 展示，并区分源文件可编辑、专用 validator 可检查和 Runtime 实际兼容这三个状态。

## UX 约束

- 显示 Transitional 标识和校验器来源；
- 不按本地通用 Procedure Schema 错误拒绝该 Skill；
- 不把专用 validator 误称为通用语法支持；
- 不把 Source Validation 通过解释为 Runtime-compatible；
- 在尚未实现可靠语法支持前，允许 Source-only 编辑；
- 对 preconditions / postconditions 保留阶段归属和路由来源；
- 专用 Parser、Typed Patch 和 Round-trip Profile 通过前，不开放结构化 Phase 编辑。

## 后果

Capability Manifest 需要表达 evidence level、editor behavior 和 Runtime compatibility 三个不同维度。
