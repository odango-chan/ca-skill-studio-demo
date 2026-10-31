# Validation Center UX

**状态：Proposed**

## 1. 目标

Validation Center 让用户知道哪些检查实际执行了、检查的是哪个 Skill Source 版本、使用了哪个 Schema / Validator、哪些问题阻塞后续工作、修改后哪些旧结果已失效，以及当前是否只是静态有效还是已经完成更高层级的 Qualification。

## 2. 统一状态模型

建议 UI 统一展示：

| 状态 | 含义 |
|---|---|
| PASS | 对明确的检查范围，实际执行并通过 |
| FAIL | 检查实际执行且发现问题 |
| BLOCKED | 因前置条件、依赖或环境缺失而无法执行 |
| NOT_RUN | 未执行 |
| STALE | 源文件或依赖变化，历史结果不再适用于当前版本 |
| NOT_AVAILABLE | 当前 Demo / Adapter 没有此检查能力 |

这是 Studio 的展示归一化模型，不表示现有 Demo validator 原样输出这些状态。

Predicate 的 PASS / FAIL / UNKNOWN、Mutation 的 COMMITTED / NOT_COMMITTED / OUTCOME_UNKNOWN、Procedure terminal 的 SUCCEEDED / FAILED / UNRESOLVED / SAFE_STOPPED 是领域状态，不能与 Validation 状态混用。

## 3. 验证层级

| 层级 | 检查内容 | 当前证据 |
|---|---|---|
| V1 Source Parse | Markdown / YAML / JSON 解析 | Demo 本地 YAML loader 和解析逻辑 |
| V2 Package Structure | 必需 / 可选文件和路径 | Demo Skill Package 约定 |
| V3 Schema | 本地快照 Schema 验证 | scripts/validate_docs.py |
| V4 Transitional Rules | CreatedSession 专用规则 | validate_createdsession_authoring_source |
| V5 Cross References | Node、Binding、Predicate、Contract、Asset 引用 | Studio 后续实现 |
| V6 Graph Integrity | start、节点、路由、可达性和终态 | Studio 后续实现 |
| V7 Semantic Lint | 状态域、Mutation/Reconcile、阶段语义 | 规则需逐项设计与证据确认 |
| V8 Demo Local Gate | 文档校验 + 非 live_model 测试 | make verify |
| V9 Runtime Qualification | 真实 Compile / Admission / Runtime Case | 当前不由文档门禁证明 |
| V10 Live Acceptance | 真实目标环境端到端验收 | 独立环境和授权 |

不要把 V5–V7 写成当前已经存在的 Demo validator 功能；它们是 Studio 的目标能力。

## 4. 当前 Demo 门禁

基线仓库 Makefile 的 verify 目标执行：

~~~make
verify:
    uv run python scripts/validate_docs.py
    uv run pytest -q -m "not live_model"
~~~

Studio 可以通过本地 Adapter 调用或指导用户执行该门禁，但第一版不得假设可以安全地在远程 GitHub 环境中直接运行命令。

执行结果必须记录 repository / ref / commit、Skill Package Digest、command、validator / test revision、start / finish time、exit code、stdout / stderr 或诊断摘要、execution environment，以及是否包含 live test。

## 5. Diagnostics

每条诊断至少包含 Severity、Code、Message、File、Line / Column（有真实位置信息才展示）、JSON Pointer / YAML path、Skill / Procedure / Node / Predicate、Related Locations、Evidence / Validator 和 Suggested Fix（如可靠）。

交互：

- Go to Source；
- Reveal in Procedure；
- Open Related Predicate；
- Inspect Binding；
- Show Diff；
- Re-run affected checks。

## 6. Staleness

验证记录绑定：

- Source Package Digest；
- Schema Snapshot Digest；
- Validator Version / Commit；
- Fixture Set Digest；
- Execution Environment。

任何相关输入变化都应使对应验证状态变为 STALE。不能只根据文件修改时间推断有效性。

## 7. 覆盖率

Coverage 只基于可执行且已执行的 Case / Trace 计算。

对 semantic obligation 可以显示 Defined、Reviewed、Mapped to Procedure、Executable Fixture Missing、Not Executed。

不应将定义数量当作执行覆盖率。

## 8. 禁止行为

- 未执行的检查不能显示 PASS；
- Schema 通过不能显示 Runtime Qualified；
- Case YAML 存在不能显示 Case Executed；
- Runtime 测试通过不能显示 Live Accepted；
- Script 静态检查不能显示 Script Runtime Success；
- Predicate UNKNOWN 不等于 Validation NOT_RUN。
