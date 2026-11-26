# Skill Studio 文档治理与 Canonical Source Map

**Status: Accepted · Updated: 2026-11-26 · Current baseline: main@5b666c0ef754ed32fa37c97ce2429f328c70477f**

本仓参考 [ConnectionAgent 中央治理](https://github.com/odango-chan/connectionagent/blob/main/docs/DOCUMENTATION.md)、[tool-mcp-gw 文档规则](https://github.com/odango-chan/tool-mcp-gw/blob/main/docs/DOCUMENTATION.md)，但只实现浏览器 Studio 必需的最小治理。中央 Machine truth 和 owner public contracts 始终高于 Studio 的 prose/UI。

## 职责分离

| 路径 | 唯一用途 |
|---|---|
| `README.md` | 产品定位、Quick Start、文档导航 |
| `AGENTS.md` | Agent 必读和硬约束 |
| `docs/README.md` | 文档地图、阅读顺序 |
| `docs/WORK.md` | 当前 implementation/acceptance **唯一快照** |
| `docs/WORK-history.md` | 已迁出的日期化 WORK 快照与历史 Traceability 证据；仅用于追溯，不是当前状态 |
| `docs/TRACEABILITY.md` | WORK scope → canonical design → code/test → acceptance/evidence |
| `docs/architecture/` | 当前 ownership、dependency、边界；依赖 / Interface Package 以 `architecture/dependency-and-interface-package.md` 为 canonical；旧 v0.1 / skills-lib-output 提案标为历史 |
| `docs/design/` | Studio 自有实现契约；独立 Monaco / Visual Designer 工作流等已退役设计明确标为历史，当前 Theia UI 以 ADR-0005 为准 |
| `docs/decisions/` | 设计理由、替代方案及后果 |
| `docs/D1-*`、`docs/D2-*` | 已完成阶段的技术记录 |
| `docs/ux/ux-consolidation.md` | Deprecated 早期 UX 历史 |

**一个主题只写一份 canonical 正文**；不能在 README/WORK/ADR 重复维护字段规则，也不创建 `final/v2/latest` 影子文档。

## 状态/证据

Canonical prose 用 `Draft / Proposed / Accepted / Deprecated`。WORK 的 Design `PROPOSED / ACCEPTED`、Implementation `NOT_STARTED / PARTIAL / IMPLEMENTED`、Acceptance `NOT_RUN / BLOCKED / FAIL / PASS` 分开记录。

`Accepted != IMPLEMENTED != PASS`。CI/Chromium/Pages 的 PASS 只对实际执行的 Gate 成立，不得写成 Skill Runtime、5GC 或外部 owner 的 PASS。

代码和固定 fixture / schema / focused test 是可验证证据。若与描述冲突，核对并更新 canonical；不凭另一份 UI 投影发明 machine contract。实施/验收 locator 见 TRACEABILITY，不能只用私人 `/tmp` 路径作长期证据。

## Current work / Issue / history

- `WORK` 是简洁现状面板（40–120 行）。状态原位更新，不追加日期流水，不存 backlog / 长阻断说明。日期化 WORK 快照与历史 Traceability 证据已无损迁至 [WORK-history.md](WORK-history.md)；该文件保留原始 SHA、PR、Actions run 和 NOT_RUN / BLOCKED 边界，不作为当前状态入口。当前 TRACEABILITY 只保留当前 main / open candidate 的 scope → design → code/test → exact-head evidence 映射。
- Owner GitHub Issue 负责 actionable defect、需求、cleanup、blocker；Issue 需观察证据、预期、owner、影响和完成条件。合并代码后仍要核实 required gate 才能关闭。
- `TRACEABILITY` 对每项 IMPLEMENTED 给出源码/测试，对 PASS 给出实际验收事件/CI/稳定证据。历史精确 SHA 的 PASS 只对该 SHA 和该 Gate 有效，不能沿用到新 main / PR head。
- 旧文档整理：**Snapshot → Inventory → Classify → Migrate before delete → Verify → Compact**。唯一历史语义先迁移后删；Git/Issue/PR 负责保留过程。


## Current baseline and historical proposals · 2026-11-26

- Current Theia / Source + Preview / CA-SL v1alpha5 / Compiler v2.0.2 / OpenAMSM Scheme C Example truth is recorded in [WORK](WORK.md) and [TRACEABILITY](TRACEABILITY.md).
- Current dependency acquisition, `skillc.lock/v0.1`, immutable snapshots, `mas` / `ca-context` / `ca-client` and the Compiler v2.1.0 formal Interface Package boundary are specified only in [Dependency Architecture](architecture/dependency-and-interface-package.md).
- `plugin-managed-configuration-v0.1.md`, `skill-project-layout.md`, the standalone `authoring-workbench.md` UI snapshot and `source-editor-workstream.md` are historical records where superseded. Do not treat them as current implementation instructions.
- AI Authoring current F1–F4 state is at the top of `design/ai-procedure-authoring.md`; later implementation-plan text is historical. The current Source Editor is host-native Theia, not the earlier standalone Monaco workstream.

## Cross-repo rule adoption

| 参考仓/规则 | 采用 | 不复制 |
|---|---|---|
| [connectionagent/docs/DOCUMENTATION.md](https://github.com/odango-chan/connectionagent/blob/main/docs/DOCUMENTATION.md) | Canonical/状态、Issue audit、Scratch safety、Traceability | 顶层业务 owner 的规范正文 |
| [tool-mcp-gw/AGENTS.md](https://github.com/odango-chan/tool-mcp-gw/blob/main/AGENTS.md) | 必读顺序、issue、负面证据、合同不足 fail closed | MCP Toolset/RequestStore/跨语言 Host 协议 |
| [ca-agent-demo/AGENTS.md](https://github.com/odango-chan/ca-agent-demo/blob/main/AGENTS.md) | Demo Schema、固定 Skill Source 与分层验收 | CreatedSession 真实 5GC 运行步骤 |
| [ca-runtime/AGENTS.md](https://github.com/odango-chan/ca-runtime/blob/main/AGENTS.md) | 不越过 Runtime authority/不冒充资格验证 | RuntimeHost service 架构 |
| [ca-skill-toolchain/AGENTS.md](https://github.com/odango-chan/ca-skill-toolchain/blob/main/AGENTS.md) | AST、Schema/测试证据区分 | Registry/正式 qualification 平台 |
| [ca-sandbox/AGENTS.md](https://github.com/odango-chan/ca-sandbox/blob/main/AGENTS.md) | Owner 隔离和安全规则 | Go 目录与 Environment Control |

## 文档修改验收

检查 canonical 是否唯一，全部相对 Markdown 链接是否可解析，WORK/TRACEABILITY 状态及证据是否一致，AGENTS scratch 与 `.gitignore` 是否成对存在，Issue/PR 追踪是否真实。文档 PR 同样运行 Node.js 24 的 `npm test`（含 docs governance 测试）、typecheck、build。未实际运行的 Chromium/Pages 不能宣称 PASS。

## Revision record

- **2026-11-26 — Completed WORK history separation.** Sections: canonical path map and Current work / Issue / history. Reason: document the completed separation between current status and historical evidence under #285. Author: ChatGPT (GPT-6.2).
