# ADR-0004：Procedure Designer 先只读投影

- 状态：Proposed
- 日期：2026-10-31

## 背景

Procedure Designer 需要把 Markdown / YAML 源文件投影为 Business Flow、Node Inspector、Binding View 和 Diagnostics。当前 Demo Procedure 既包含标准 Schema 语法，也包含 CreatedSession 的窄范围 node-level Preconditions / Postconditions 过渡语法。

如果在 Round-trip AST / CST、未知字段保留、注释保留和 Source / Visual 一致性尚未验证前开放图形编辑，图形保存可能重写或丢失源文件语义。

## 决策建议

第一阶段采用：

- Visual：只读图形投影；
- Source：原始文本编辑；
- Inspector：只读语义详情；
- Binding Inspector：只读来源解析与定位；
- Diagnostics：只读检查结果和导航。

只有完成以下能力验证后，才考虑开放双向图形编辑：

1. Round-trip AST / CST 可保留注释、键顺序、标量风格和未知字段；
2. Typed Source Patch 可表达每种图形操作；
3. 修改后重新解析得到的 Graph 与用户操作结果一致；
4. Demo Schema / 专用 Transitional Validator 能检查保存结果；
5. Undo / Redo 和 Diff 不会产生半应用状态。

## 后果

- 首个 Procedure Designer 仍然具有完整的图形理解、节点选择、Binding 导航和阶段检查能力；
- 作者可以通过 Source 编辑修改内容；
- 图形结构编辑推迟到 Phase 5；
- 不支持的语法可以安全地以 Source-only / Read-only 方式展示；
- 不会为了图形编辑提前引入第二份 Procedure 定义。

该 ADR 是当前设计建议，待产品评审后再标记 Accepted。
