# Phase 1 · Source-preserving Typed Patch POC

**状态：Offline POC regression PASS (33 tests) · Production editor qualification still NOT_READY**

## 1. 范围

本 POC 不提供 UI、不访问 Host / Runtime、不执行 Script / Capability、不操作 Live 5GC。
只在本 Studio 代码包中提供基于 Source Revision 的离线 YAML 解析和 Typed Patch 预览。

- 基线：`odango-chan/ca-agent-demo@bf445ad777149af5af2dfa0a5bdea18d0451303e`。
- 固定输入：`fixtures/baseline/ensure-pdu-session/procedure.yaml` 与 `fixtures/baseline/establish-pdu-session/procedure.yaml`。
- `ensure-pdu-session` 仅开放三个已有受限 Patch；`poc-sequence` 是**仅用于单元测试**的合成步骤序列 Profile，绝不作为生产 Skill 编辑权限。CreatedSession / Transitional Profile 仍严格 Source-only。

## 2. 技术决定

初步采用 `ruamel.yaml` Round-trip Tree 作为**解析、源位置和注释 / 未知字段保留的辅助结构**，不使用全文件 dump 写回。

Visual Patch：

1. 校验生成时的完整 Source SHA-256 Revision。
2. 从带位置的 YAML 解析树定位明确标量 / Route / Node Key。
3. 检查旧值、Operator Outcome、目标节点和 Profile。
4. 将小范围非重叠 Source Span 文本替换应用到临时字符串。
5. 完整重新解析；验证目标语义。
6. 返回 Unified Diff + Preview；Apply 必须重新执行其 Typed Patch 并校验预览完全一致，不信任调用者构造的 Preview。
7. 出错抛出 `PatchRejected`，原文不变。

这验证了 **Source-preserving localized edit**，不是完整 Editor CST 序列化器或成品 Runtime schema validator。

## 3. 已实现

- `SetScalar`：已存在的单行原始标量，禁止更改类型，保留 trailing comment 与引号风格；Reject block scalar。
- `AddRoute`：已有 operator `on` Map 上追加合法 Outcome → 本 Procedure Node；精确插入一行。
- `RenameNode`：改名 Node Key、`start`、当前 Procedure 内 `on` Route Target、`reconcile` target、`from: old.output.*` 生产者绑定；不对注释做全文替换。
- `InsertSequenceItem`（**合成 `poc-sequence` Profile，仅测试**）：对已存在的非空 Phase Step 序列，允许在指定索引插入单条最小 `verify` Step；只插入一行，保持嵌套字段和 Route 不动。空序列、注释边界和不确定源位置一律 Reject。
- `SourceDocument.preview/apply`：Revision 检查、Source Diff、语义复核、再次验证 Preview 防篡改、失败原子回滚。
- Anchor / Alias：Round-trip 原文保留；任何结构化修改均保守 Reject，回退 Source-only。
- BOM / CRLF：局部修改后保持开头 BOM、CRLF 换行格式。
- `DemoYaml12Loader`：独立复现当前 Demo 对 `on`、`true` / `false` 的布尔解析意图并拒绝重复键；只作 POC 交叉检查。
- `validator.py`：以固定 `ca-agent-demo@bf445ad` 的 `scripts/validate_docs.py::validate_createdsession_authoring_source` 为依据，新增**不执行任何 Skill 动作**的 CreatedSession 作者语法 **subset diagnostic adapter**。检查主业务节点顺序、阶段形状与允许 Operator、JIT Predicate、局部 Route 完整性和 Reconcile safe-stop；返回可定位的诊断，不授予 Visual 编辑或 Runtime 执行资格。

## 4. 本地测试结果

在完整固定样本与 Manifest 均已恢复、并经过 Git Blob SHA 校验的本地测试目录运行：

~~~text
PYTHONPATH=packages python -m pytest -q -ra
33 passed in 1.56s
python -m compileall -q packages tests
PASS
~~~

- **33 passed / 0 skipped / 0 failed**；
- 原先缺失的 Manifest 和完整 CreatedSession Procedure 已按 Git Blob SHA 与当前 Studio 远端仓库原件核对一致；
- ensure Procedure Blob：`1ead0efb0665b7ccb652501bc0075b36079c5017`；
- establish Procedure Blob：`cf502fa54363a5302161cc7cccb191ce73e453de`；
- Studio Capability Manifest Blob：`93b145396639dfee047f4da6ca94e894d47a976c`；
- 两个曾 skipped 的测试现在实际执行：Manifest 使用 Demo 兼容 Loader 解析成功，完整 establish 源读取、语义对照和无修改保留成功；
- 测试用例已改为 **fail-closed**：缺少 Manifest / Fixture 时直接失败，且固定 Fixture Git Blob 必须匹配基线清单；
- CreatedSession 子集适配器对完整固定 establish 源报告 **0 diagnostics**；人为修改同一真实源的 Reconcile Target 和未批准 precondition Call，诊断正确拒绝。

此处的 PASS 指 Studio 离线 POC 测试；**不等价于真实 Demo Validator、Runtime 兼容性或真实 5GC 验收**。

## 5. 尚未满足的 Phase 1 目标

- Manifest 的 Demo 兼容解析与完整 establish Procedure 只读回归已执行 PASS，不再列为缺口。
- `InsertSequenceItem` 已完成**受限合成 Profile POC**，真实 Skill 的结构化 Phase / Step 编辑仍 **NOT_IMPLEMENTED**；禁止对 CreatedSession 开放。
- Anchor / Alias 和 BOM 的保留 / 拒绝边界已有测试；anchors / merge keys 的可靠结构化编辑、复杂编码和无换行文件的序列插入仍 **NOT_PROVEN**，应视为 Source-only / Reject。
- 跨文件 Rename / Undo-Redo 状态机 / File Watch / Save / 外部冲突处理 **NOT_IMPLEMENTED**。
- `validator.py` 属于 **Demo-authoring subset adapter**；已用真实固定 establish 源及两种故障注入验证，但仍未直接执行上游 `scripts/validate_docs.py` 或 `make verify`，未证明与 Demo 完整 Validator 的逐项诊断等价。**真实 Demo Validator PASS 仍为 NOT_RUN**。
- 所有 Capability / Observation / Script allowlist 的运行时可执行性 **NOT_PROVEN**。

## 6. 下一道闸门

在固定 ca-agent-demo 完整源环境中直接运行其文档 / 专项 Validator，并把结果与 Studio 子集诊断做对照；再处理 Anchor / Alias、跨文件原子事务、Undo / Redo 和外部冲突。在特定 Profile 的 Parser、Typed Patch、无损回归和 Validator 证据全部齐备前，不授予结构化写回资格。本 POC **不修改 Capability Manifest 的编辑资格声明**。
