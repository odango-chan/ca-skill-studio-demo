# Validation Center UX（后置参考设计）

**状态：Deferred · 不属于当前主要工作台**

本文件保留未来 Validation / Qualification 工作台可能需要的状态语义和证据要求。当前 Skill Studio 的主要任务是开发和编辑 Skill；验证能力只以轻量 Problems / Inline Diagnostics 形式辅助作者。

## 1. 当前范围

当前编辑器仅显示：

- Source Parse / Syntax；
- Duplicate ID / Dangling Route；
- Unresolved Binding / Reference；
- Unsupported / Preserve-only；
- Compatibility Profile 限制；
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

## 3. 保留的证据原则

- 未执行的检查不能显示 PASS；
- Schema 通过不能显示 Runtime Qualified；
- Case 文件存在不能显示 Case Executed；
- Runtime 测试通过不能显示 Live Accepted；
- Script 静态检查不能显示 Script Runtime Success；
- 36 个 CreatedSession semantic obligations 不得计入 Executed Coverage。

以上内容仅作为未来参考，不构成当前实施承诺。
