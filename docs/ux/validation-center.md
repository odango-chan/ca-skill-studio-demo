# Validation / Runtime Workbench（后置参考设计）

**状态：Deferred · 不属于当前 Skill Studio 工作台**

本文件保留未来独立 Validation / Runtime 工作台可能需要的状态语义。当前 Skill Studio 的主要任务是开发和编辑实际 Skill Runtime Assets；检查能力只以轻量 Problems / Inline Diagnostics 形式辅助作者。

## 1. 当前范围

当前编辑器仅显示：

- Source Parse / Syntax；
- Duplicate ID / Dangling Route；
- Unresolved Binding / Reference；
- Unsupported / Preserve-only；
- Compatibility Profile 限制；
- Script / Capability / Observation 的 Host 支持证据缺失；
- Source / Projection Conflict。

不建设独立 Validation Center，不管理执行调度、Coverage、Runtime Trace 或 Qualification Report。

## 2. 未来验证状态语义

如未来明确启动该工作台，再考虑统一展示：

- PASS：明确检查范围实际执行并通过；
- FAIL：检查实际执行且发现问题；
- BLOCKED：前置条件 / 依赖 / 环境缺失；
- NOT_RUN：未执行；
- STALE：Source 或依赖变化后旧结果不再适用；
- NOT_AVAILABLE：当前 Adapter 没有此能力。

Predicate、Mutation、Procedure 的领域状态不能与 Validation 状态混用。

## 3. 证据原则

- 未执行的检查不能显示 PASS；
- Schema 通过不能显示 Runtime Qualified；
- Script 静态检查不能显示 Script Runtime Success；
- Host 未注册的 Script / Capability / Observation 不得显示为可执行；
- 本地 Runtime 测试不能显示为 Live 5GC Accepted。

以上内容仅作为未来参考，不构成当前实施承诺。
