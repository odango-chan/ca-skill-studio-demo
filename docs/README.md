# Skill Studio 文档地图

**Status: Current map · Updated: 2026-11-26 · Baseline: main@5b666c0ef754ed32fa37c97ce2429f328c70477f**

当前产品与 Compiler / Example 基线以 [WORK](WORK.md) 顶部的 2026-11-26 快照为准；本仓唯一在线宿主为 Theia browser-only，当前 Compiler 集成为 v2.0.2，当前内置示例为 OpenAMSM Scheme C Create / Modify / Release。早期 v1.0.0 Compiler、旧 5GC + MAS 示例和 Classic 迁移内容均为历史记录，不得作为当前执行依据。产品审计入口：[Issue #279](https://github.com/odango-chan/ca-skill-studio-demo/issues/279)；当前文档刷新：[Issue #281](https://github.com/odango-chan/ca-skill-studio-demo/issues/281)。

Studio 拥有浏览器编辑器，不拥有正式 Skill/Runtime/MCP 业务真相。当前唯一活动语言目标为 CA-SL v1alpha5（FROZEN / RELEASED）；Studio 编辑器集成仍与 Compiler、Host、Runtime 资格分开。v1alpha4 仅作为不可变的规范继承基线和历史记录，不是产品兼容模式。**当前 Theia 的 Procedure / Contract / Predicate / Schema Preview 均为只读 Source 投影；原生 Source 是直接编辑入口，AI Authoring 是独立的 Host-owned Change Set 工作流。D1–D4 Visual Designer mutation 记录均为历史，不是当前产品操作。** 阅读当前代码前按以下顺序：

- [CA-SL v1alpha5 Studio Integration](design/ca-sl-v1alpha5-studio-preview.md) — 正式规范来源 pin、Node-entry Wait 编辑投影、Compiler fail-closed 与产品资格边界

1. [README](../README.md) 与 [AGENTS](../AGENTS.md) — 目标/开发规约
2. [WORK](WORK.md) — **唯一当前实现与验收状态**
3. [TRACEABILITY](TRACEABILITY.md) — Contract/设计 → 生产代码 → 测试 → 实际证据
4. [Studio Ownership / Source Authority](architecture/studio-boundaries.md) — 当前 ownership、Source authority、Theia-only 产品边界
5. [Dependency / Interface Package Architecture](architecture/dependency-and-interface-package.md) — 当前 Studio lock、immutable snapshots、Example dependency closure、Schema IntelliSense 与 Compiler v2.1.0 边界
6. [Source-backed Authoring Workbench](design/authoring-workbench.md) — 独立浏览器工作台与 D1/D4 的历史设计、Source Patch 安全原则；当前 Theia 布局以 ADR-0005 为准
7. [AI Procedure Authoring](design/ai-procedure-authoring.md) — 当前 F1–F4 实现状态、v1alpha5 Host-owned Change Set、Go Gateway / Compiler Apply gate；历史规划已明确标记
   - [Authoring Core](../authoring/core/README.md) — 平台无关 Model Client / ModelProposal
   - [Go AI Gateway](https://github.com/odango-chan/ai-gateway) · [Browser CORS issue #4](https://github.com/odango-chan/ai-gateway/issues/4)
8. [Historical D3 Route Designer](design/route-designer.md) — 早期 standalone `operator.on` 有界编辑实验；不是当前 Theia mutation contract
9. [Historical D4 Phase Designer](design/phase-designer.md) — 早期 Phase Step 编辑实验；不是当前 Theia mutation contract
10. [E Source Editor](design/source-editor-workstream.md) — 早期 standalone Monaco Source Editor 工作流历史；当前 Theia 编辑使用宿主原生 Source Editor
11. [Application Shell](design/application-shell.md) — Web/Local 菜单命令与本地宿主边界
12. [Skill Language Core / Browser LSP · L2-D1](design/skill-lsp-l2d-editor-acceptance.md) — 共享语言分析与真实 Theia Provider 验收
13. [L2-D2 Live Problems](design/skill-lsp-l2d2-live-problems.md) — Problems 诊断与 Package generation
14. [ADR-0002 Theia default online host (historical migration record)](decisions/0002-ide-host-spike.md) — Theia 默认在线宿主迁移历史；Classic 已退役
15. [ADR-0003 Native Workbench / Inspector / Markdown](decisions/0003-native-workbench-and-markdown.md) — 原生视图、Inspector、Data Flow 与 Markdown 决策
16. [ADR-0004 Package-first Workspace](decisions/0004-package-first-workspace.md) — Package Explorer / Dependencies / Build Artifacts 组合
17. [ADR-0005 Fixed Source + Preview](decisions/0005-fixed-source-preview-workbench.md) — 当前固定 Source + Preview 工作台
18. [Documentation Governance](DOCUMENTATION.md) — canonical source map

**Historical proposals, not current implementation contracts:** [Plugin-managed Configuration v0.1](architecture/plugin-managed-configuration-v0.1.md) and [SKILL Project layout](architecture/skill-project-layout.md). They preserve decision history; use the current Dependency Architecture and WORK instead.

## Historical visual-designer milestone records（非当前 Theia UI）

- [D1 Procedure Designer](D1-procedure-designer.md)：早期 React Flow + ELK 独立画布迁移记录
- [D2 Node Designer](D2-node-designer.md)：早期 A1–A5 有界 Node 编辑记录
- [早期 UX Consolidation](ux/ux-consolidation.md)：**Deprecated**，保留历史设计背景，不作为当前实现规则

## 唯一 canonical 正文

| 主题 | Canonical |
|---|---|
| Owner / Authority / Source truth | [Architecture](architecture/studio-boundaries.md) |
| Current dependency acquisition / Interface Package / Schema IntelliSense | [Dependency Architecture](architecture/dependency-and-interface-package.md) |
| Historical standalone Workbench / Source-editing safety principles | [Workbench](design/authoring-workbench.md) |
| AI Procedure Authoring P1（v1alpha5 / Go Gateway） | [AI Procedure Authoring](design/ai-procedure-authoring.md) |
| Historical D3 Route editing design（非当前 Theia UI） | [D3 Route Designer](design/route-designer.md) |
| Historical D4 Phase Step editing design（非当前 Theia UI） | [D4 Phase Designer](design/phase-designer.md) |
| 为何采用 Source-first | [ADR-0001](decisions/0001-source-first-visual.md) |
| Historical standalone Source Editor workstream | [E Source Editor](design/source-editor-workstream.md) |
| 当前应用菜单 / 本地宿主边界 | [Application Shell](design/application-shell.md) |
| Skill Language Core / Browser LSP · L2-D1 | [L2-D1 Editor Acceptance](design/skill-lsp-l2d-editor-acceptance.md) |
| Native Problems diagnostics lifecycle · L2-D2 | [L2-D2 Live Problems](design/skill-lsp-l2d2-live-problems.md) |
| Theia 默认在线宿主与历史迁移决策（Classic 已退役） | [ADR-0002](decisions/0002-ide-host-spike.md) |
| Native workbench / Inspector / Data Flow / Markdown ownership | [ADR-0003](decisions/0003-native-workbench-and-markdown.md) |
| Package-first workspace and Package Explorer composition | [ADR-0004](decisions/0004-package-first-workspace.md) |
| 当前状态 | [WORK](WORK.md) |
| 实施、测试与证据 locator | [TRACEABILITY](TRACEABILITY.md) |
| 文档治理 | [DOCUMENTATION](DOCUMENTATION.md) |

早期 [PR #1](https://github.com/odango-chan/ca-skill-studio-demo/pull/1) 的架构、[PR #2](https://github.com/odango-chan/ca-skill-studio-demo/pull/2) 的 Python POC、[PR #3](https://github.com/odango-chan/ca-skill-studio-demo/pull/3) 的浏览器草稿仍未合并。可作为引用材料，但不直接合并其旧实现。

- [Theia 工作台与 Classic 对照](architecture/theia-workbench.md) — 原生视图、共享逻辑、性能测量及保留缺口。

## Revision record

- **2026-11-26 — Clarified current Theia read-only Preview boundary and historical Designer map.** Sections: current product boundary, D3/D4 reading list, D1/D2 milestone records and canonical table. Reason: prevent future contributors and Harness runs from treating retired standalone mutation UI as current product behavior. Author: ChatGPT (GPT-6.2).
