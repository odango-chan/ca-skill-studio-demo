# ADR-0004：Procedure Designer 先只读投影

- 状态：Superseded by ADR-0005
- 日期：2026-10-31

## 背景

最初设计 Procedure Designer 时，Round-trip AST / CST、未知字段保留、注释保留和 Source / Visual 一致性尚未验证。为避免图形保存重写或丢失源文件语义，曾建议先采用 Visual 只读、Source 可编辑的阶段方案。

## 原阶段建议

- Visual：只读图形投影；
- Source：原始文本编辑；
- Inspector / Binding Inspector：只读语义详情；
- 图形结构编辑推迟到 Round-trip 与 Typed Patch 具备测试之后。

## 复盘

用户明确将 Skill Studio 定位为 Skill 开发与编辑 IDE。长期只读的 Procedure Designer 不满足产品目标；但在源文件无损编辑能力未证明前直接开放 Visual 写回同样不安全。

## 当前结论

本 ADR 的“Visual 长期只读”阶段建议已被 ADR-0005 取代。

保留的安全原则：

- Source 仍是唯一权威；
- Visual 修改必须经 Typed Source Patch；
- Round-trip 不可靠的语法不开放结构化编辑；
- 未知字段 / 语法必须保留；
- Patch 失败原子回滚。

详见 [ADR-0005：Source-preserving 双向编辑模型](0005-source-preserving-bidirectional-editing.md)。
