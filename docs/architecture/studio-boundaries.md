# Skill Studio Ownership / Source Authority

**Status: Accepted · Date: 2026-11-03**

`ca-skill-studio-demo` 拥有 Skill 编辑器的前端、浏览器临时工作副本、只读语义投影、源文本局部 Patch 和本仓验收。它是**静态网站**，不是 Agent Runtime 或另一套 Skill / Tool / 5GC truth owner。

## Dependency / authority

~~~text
Actual Skill source files (only business authority in Studio)
   ↓ YAML 1.2 AST + source spans
Source / Semantic Projection + Editor Hints
   ↓ ELK layout → React Flow / Inspector / Problems (derived UI)
Qualified Typed Source Patch → Preview Diff → Confirm
   ↓
Same working source text → Reparse → Undo/Redo → Download/ZIP
~~~

Graph、Edge、Node 位置、Selected Node、Collapsed Pane 不作为独立文件业务定义。只有受支持的 Source span 在用户确认后被更新。构建为 `dist/` 静态资源；无后端自动执行或跨仓写入。

## Cross-repository responsibility

| Owner | 正式边界 | Studio 应做 |
|---|---|---|
| [ca-agent-demo](https://github.com/odango-chan/ca-agent-demo) | Demo Skill Source、Host Loader、Demo Schema/validator | 引用固定 `bf445ad777149af5af2dfa0a5bdea18d0451303e` 样本；有意升级时单独审查 |
| [ca-runtime](https://github.com/odango-chan/ca-runtime) | RuntimeHost、真实 Run/Outcome/Reconcile 与 Capability 资格 | 不宣称 Runtime PASS，不用 UI 模拟真实执行事实 |
| [ca-skill-compiler](https://github.com/odango-chan/ca-skill-compiler) | 无状态多 SKILL Project Check / Build；规划浏览器 WASM | Studio 仅通过未来 Compiler adapter 调用稳定 API，不复制编译/链接逻辑，不把 LSP 或 Package Audit 当 Compiler PASS |
| [ca-skill-toolchain](https://github.com/odango-chan/ca-skill-toolchain) | 正式 Skill toolchain / qualification（与 Compiler 分开） | 不把 check/build 结果当作资格/发布证明 |
| [tool-mcp-gw](https://github.com/odango-chan/tool-mcp-gw) | Agent-facing MCP protocol / Server Tool Catalog adapter | 不根据名字/Goal/LLM 产生 Tool eligibility |
| [ca-sandbox](https://github.com/odango-chan/ca-sandbox) | Sandbox Environment 和受控 control facts | 不直接控制 5GC |
| [connectionagent](https://github.com/odango-chan/connectionagent) | 生态 ownership / 文档治理 | 只继承通用治理，尊重 owner 专有实现契约 |

## Source protection & scope

- 在线 Theia 内置演示从 `site/samples/skills/` 导入到 `<project-root>/skills/`；同一项目根目录还包含空的 `lib/` 与 `output/`。原来的浏览器 `workspaces/skills/` 会直接作为项目的 `skills/` 复用，已有内容不迁移、不删除、不覆盖；Classic 历史夹具 `site/samples/packages` 保留为兼容与测试材料。
- `skills/` 是可编辑 Source；`lib/` 仅供用户导入 Tool 契约；`output/` 只供未来 Compiler 生成。见 [SKILL Project layout](skill-project-layout.md)。
- YAML `'on'` 是字符串键；必须保留 `operator.on`、`preconditions.on`、`postconditions.on` 及每个 Outcome 的原身份、行号。ELK 分组不等于业务合并。
- Span/Revision、解析、Diff 和 Undo/Redo 是 Visual 修改的硬门禁；危险或未知语法 fall back Source-only。
- 编辑期跨文件 warning 不证明完整类型匹配、Capability 存在、Runtime 或 3GPP 业务正确性。
- 下载 ZIP 不等于本地文件原位 Save。没有用户确认不得改外仓、提交用户 Skill 或触发副作用。

稳定实现契约在 [Workbench](../design/authoring-workbench.md)，当前进度/验收只在 [WORK](../WORK.md)，下一步 Source-backed Route Edit 的讨论见 [D3](../design/route-designer.md)。
