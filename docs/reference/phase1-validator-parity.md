# Phase 1 · Pinned CreatedSession authoring validator parity

**状态：隔离原函数对照 PASS · 整体 Demo Validator NOT_RUN**

## 来源与可复现性

- Source repository: `odango-chan/ca-agent-demo`
- Pinned commit: `bf445ad777149af5af2dfa0a5bdea18d0451303e`
- Original file: `scripts/validate_docs.py`，Git blob `a60eaa14234a89a57cfce4005c1cd65f1783659c`
- Verbatim function: `validate_createdsession_authoring_source`，从该文件提取；不修改函数体
- Test-only snapshot: `fixtures/upstream/validate_createdsession_authoring_source.py`
- Snapshot bytes: 9514，SHA-256: `d1f60f0d6af43d121d69097f4f0ee3a7f20732a5fa28ae83d146a65e42b0fa1d`
- Tests: `tests/test_upstream_validator_parity.py`

只在离线测试中执行该**经过 SHA-256 校验的原函数**。测试为其注入内存中的 `read(label)` 和抛异常的 `fail(message)`；并使用 Studio 的 Demo YAML 兼容 Loader 提供解析后的输入。未导入或执行上游完整 `validate_docs.py` 的其他部分。

## 已实际对照

`PYTHONPATH=packages python -m pytest -q -ra` → **46 passed / 0 skipped / 0 failed**。

本轮新增 13 个直接运行上游原函数的对照测试，涵盖：

- 固定完整版 CreatedSession Procedure 被原函数和子集适配器接受；
- 错误 `OUTCOME_UNKNOWN` → Reconcile 目标；
- 未授权 precondition Call（operation-context 与 PCF 输入）；
- 未授权 Script / Child Procedure；
- 缺失 JIT Predicate；
- 错误 N1N2 Reconcile 目标；
- Reconcile 分支没有全部导向 `safe-stopped`；
- 非法 Procedure-local Route 目标；
- 退役 authoring 写法；
- CreatedSession Transitional Profile 仍 Source-only。

### 一个重要的负面发现

把固定输入中某个 `terminal: SAFE_STOPPED` 改成 `terminal: COMPLETED` 时，**上游原始专项函数及 Studio 子集适配器均未拒绝**。这不是测试错误，而是原函数的检测范围只约束 Reconcile 的路由目标，并不单独检查 Terminal 枚举。

因此：

- 不得声称专项 authoring Validator 已覆盖 Terminal 类型、通用 Toolchain Schema 或 Runtime 降低语义；
- 不得凭专项验证 PASS 开放 CreatedSession 结构化 Phase 编辑；
- 是否允许 Terminal 值，必须由适用的 Schema / Runtime 检查作出最终判断。

## 验证等级

| 检查 | 结果 |
|---|---|
| 固定原始函数 SHA-256 / 离线执行 | PASS |
| 原函数与子集适配器针对 13 个代表性输入的接受/拒绝对照 | PASS |
| Studio Phase 1 所有测试 | 46 PASS、0 skipped |
| 完整上游 `scripts/validate_docs.py` | NOT_RUN |
| Demo `make verify` | NOT_RUN |
| CreatedSession Runtime-compatible | 未证明，仍保持禁用结构化写回 |
| Live 5GC | NOT_RUN |

## 下一步

使用完整固定 Demo checkout 运行其全部验证；对比测试之外的 Schema / 闭包规则，不把作者语法函数的成功误认为 Runtime PASS。只有在对应 Profile 的 Parser、Typed Patch、无损写回、Schema 与 Runtime 兼容证据完整后，才有资格开放结构化修改。
