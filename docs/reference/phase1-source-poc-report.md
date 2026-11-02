# Phase 1 · Source-preserving Typed Patch POC

**状态：PARTIAL · Not production-ready**

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
- `DemoYaml12Loader`：独立复现当前 Demo 对 `on`、`true` / `false` 的布尔解析意图并拒绝重复键；只作 POC 交叉检查，不能冒充直接执行 Demo Validator。

## 4. 本地测试结果

在当前隔离环境执行 `python -m pytest -q`：

- **18 passed**；
- **2 skipped**（完整 CreatedSession Fixture 与现有远端 Manifest 在隔离本地工作目录不可用）；
- **0 failed**。

其中完整 `ensure-pdu-session` Fixture 的节点数、精确绑定的 RenameNode 与解析前后语义对照均通过。完整 `establish-pdu-session` Fixture 已以源 Git Blob 原样加入 Studio 分支，在完整仓库 checkout 中应重新运行上述两项测试；这里不声称已经运行。

## 5. 尚未满足的 Phase 1 目标

- 现有 `spec/editor-capability-manifest.yaml` 的实际 YAML Parser 回归在此隔离工作目录中 **NOT_RUN**，测试已入库，需在完整 checkout 验证。
- 完整 `establish-pdu-session` 原文读取、过渡语法 parse 与无修改 round-trip 测试 **NOT_RUN**，测试已入库。
- `InsertSequenceItem` 已完成**受限合成 Profile POC**，真实 Skill 的结构化 Phase / Step 编辑仍 **NOT_IMPLEMENTED**；禁止对 CreatedSession 开放。
- Anchor / Alias 和 BOM 的保留 / 拒绝边界已有测试；anchors / merge keys 的可靠结构化编辑、复杂编码和无换行文件的序列插入仍 **NOT_PROVEN**，应视为 Source-only / Reject。
- 跨文件 Rename / Undo-Redo 状态机 / File Watch / Save / 外部冲突处理 **NOT_IMPLEMENTED**。
- 没有使用 Demo 的真实 `scripts/validate_docs.py` 或 `make verify`；本地语义对照仅为兼容性近似检查，不代表 Demo Validator PASS。
- 所有 Capability / Observation / Script allowlist 的运行时可执行性 **NOT_PROVEN**。

## 6. 下一道闸门

在真实 Git checkout 中运行测试，修复跳过项，验证固定 Manifest；随后对完整固定源码补齐无跳过回归，扩展合成 `InsertSequenceItem` 到真正被专用 Profile 验证的 Step 结构，并开发 Demo Validator 适配。取得完整 Round-trip / Patch 证据后，才把特定操作标记为 `editable`。本 POC **不修改 Capability Manifest 的编辑资格声明**。
