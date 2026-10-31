# ADR-0001：Skill Source 是唯一权威定义

- 状态：Accepted
- 日期：2026-10-31

## 背景

Skill Studio 需要同时提供 Visual Graph、Source Editor、Inspector、Reference Index 和 Diagnostics。若这些视图分别维护业务定义，会形成多份互相漂移的事实来源。

## 决策

Markdown / YAML / JSON / Script 等 Package 源文件是唯一权威定义。

Graph、Inspector Model、Cross-reference Index 和 Preview 均由源文件派生。图形编辑（后续阶段）必须通过带类型的 Source Patch 修改原始文件。

## 约束

- 不把 Graph JSON 作为独立业务定义存储；
- 保存后重新解析并验证；
- 保留注释、键顺序、标量风格和未知字段；
- 无法无损编辑时退回 Source-only / Read-only；
- 修改前提供 Diff，支持 Undo / Redo。

## 后果

Round-trip AST / CST 是核心技术能力，不能把普通 YAML load/dump 当作完整编辑方案。
