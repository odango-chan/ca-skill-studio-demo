# Skill Studio 文档地图

**Status: Accepted · Date: 2026-11-03**

Studio 拥有浏览器编辑器，不拥有正式 Skill/Runtime/MCP 业务真相。阅读当前代码前按以下顺序：

1. [README](../README.md) 与 [AGENTS](../AGENTS.md) — 目标/开发规约
2. [WORK](WORK.md) — **唯一当前实现与验收状态**
3. [TRACEABILITY](TRACEABILITY.md) — Contract/设计 → 生产代码 → 测试 → 实际证据
4. [Architecture](architecture/studio-boundaries.md) — ownership、Source authority
5. [Plugin-managed Configuration v0.1](architecture/plugin-managed-configuration-v0.1.md) — 原生 Settings、Dependency Snapshot / Lock、Compiler 输入与所有权边界
5. [Workbench](design/authoring-workbench.md) — 当前 UX / Patch / Source 交互
6. [D3 Route Designer](design/route-designer.md) — `operator.on` 有界编辑已实现；Runtime 资格未验收
7. [D4 Phase Designer](design/phase-designer.md) — A1/A2.1/A2.2a 已合入；A2.2b1 消费者 ABI 对照通过浏览器测试；A2.2b2/A3/A4 Proposed
8. [E Source Editor](design/source-editor-workstream.md) — Monaco / shared D4 history and E2–E4 scope
9. [Application Shell](design/application-shell.md) — Web/Local 共用菜单命令与未来本地执行边界
10. [Skill Language Core / Browser LSP · L2-D1](design/skill-lsp-l2d-editor-acceptance.md) — 共享语言分析、Browser Worker 与真实 Theia 编辑器 Provider 验收边界
11. [L2-D2 Live Problems](design/skill-lsp-l2d2-live-problems.md) — 原生 Problems 诊断出现、修复清除与 Package generation 验收
11. [ADR-0002 Theia default online host + Classic fallback](decisions/0002-ide-host-spike.md) — Theia 默认在线宿主与功能迁移背景
12. [ADR-0003 Native Workbench / Inspector / Markdown](decisions/0003-native-workbench-and-markdown.md) — 原生视图、右侧 Inspector、Data Flow 与 Markdown 决策
13. [ADR-0004 Package-first Workspace](decisions/0004-package-first-workspace.md) — Package Explorer 默认入口、Dependencies / Build Artifacts 组合及资源所有权
14. [Documentation Governance](DOCUMENTATION.md) — canonical source map

## 已完成阶段技术记录

- [D1 Procedure Designer](D1-procedure-designer.md)：React Flow + ELK/Route 重连浏览器验收
- [D2 Node Designer](D2-node-designer.md)：A1–A5 有界 Node 编辑和回归
- [早期 UX Consolidation](ux/ux-consolidation.md)：**Deprecated**，保留历史设计背景，不作为当前实现规则

## 唯一 canonical 正文

| 主题 | Canonical |
|---|---|
| Owner / Authority / Source truth | [Architecture](architecture/studio-boundaries.md) |
| Plugin-managed Project / Dependency / Build ownership | [Plugin-managed Configuration v0.1](architecture/plugin-managed-configuration-v0.1.md) |
| 现有 UI 和 Source-backed 编辑契约 | [Workbench](design/authoring-workbench.md) |
| Route 编辑 D3 设计 | [D3 Route Designer](design/route-designer.md) |
| Phase Step 输入绑定与后续结构编辑 | [D4 Phase Designer](design/phase-designer.md) |
| 为何采用 Source-first | [ADR-0001](decisions/0001-source-first-visual.md) |
| E1 Monaco Source Editor / E2–E4 boundaries | [E Source Editor](design/source-editor-workstream.md) |
| 当前应用菜单 / 本地宿主边界 | [Application Shell](design/application-shell.md) |
| Skill Language Core / Browser LSP · L2-D1 | [L2-D1 Editor Acceptance](design/skill-lsp-l2d-editor-acceptance.md) |
| Native Problems diagnostics lifecycle · L2-D2 | [L2-D2 Live Problems](design/skill-lsp-l2d2-live-problems.md) |
| Theia 默认在线宿主 / Classic 保留与功能迁移背景 | [ADR-0002](decisions/0002-ide-host-spike.md) |
| Native workbench / Inspector / Data Flow / Markdown ownership | [ADR-0003](decisions/0003-native-workbench-and-markdown.md) |
| Package-first workspace and Package Explorer composition | [ADR-0004](decisions/0004-package-first-workspace.md) |
| 当前状态 | [WORK](WORK.md) |
| 实施、测试与证据 locator | [TRACEABILITY](TRACEABILITY.md) |
| 文档治理 | [DOCUMENTATION](DOCUMENTATION.md) |

早期 [PR #1](https://github.com/odango-chan/ca-skill-studio-demo/pull/1) 的架构、[PR #2](https://github.com/odango-chan/ca-skill-studio-demo/pull/2) 的 Python POC、[PR #3](https://github.com/odango-chan/ca-skill-studio-demo/pull/3) 的浏览器草稿仍未合并。可作为引用材料，但不直接合并其旧实现。

- [Theia 工作台与 Classic 对照](architecture/theia-workbench.md) — 原生视图、共享逻辑、性能测量及保留缺口。
