# ADR-0001 · Source-first Visual Editing

**Status: Accepted · Date: 2026-11-03**

## Context

Skill Studio 用 React Flow + ELK 展示真实 Skill `procedure.yaml`。若 Graph 成为另一份可保存的业务定义，视觉节点与原始 YAML 可能漂移；早期 Python POC 也不应该与已合入的 JavaScript 编辑器形成双权威。

## Decision

1. 用户当前的原始 Source/工作副本是唯一业务真源；Semantic Projection、React Flow、Inspector 和 ELK 位置是派生视图。
2. Visual mutation 只能使用明确准入的 Typed Source Patch：精准 Source Span、完整 Revision、预览 Diff、用户确认、重新投影、Undo/Redo。
3. 无法安全处理的未知结构，回退 Source-only；不通过整篇 YAML 序列化抹除注释、顺序或未知字段。
4. 不在 Studio 设计第二套 Skill DSL、Runtime Tool 资格或 5GC 状态机。

## Alternatives rejected

Graph JSON authoritative、同时维护 YAML/Graph 两个可保存业务模型、强行把 Python POC 合入现有 Runtime 作为编辑服务。

## Consequences

部分编辑器功能必须保持有限或 Proposed，直到 Parser/补丁/负面测试证明安全。接受 UI 的保守范围，而不牺牲 Source 的可审查性。详见 [Architecture](../architecture/studio-boundaries.md)、[Workbench](../design/authoring-workbench.md)。
