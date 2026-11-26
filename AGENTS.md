# SKILL Studio · Agent 工作规则

## Scope / Authority

本仓 odango-chan/ca-skill-studio-demo 拥有 **VS Code Extension / Theia 在线宿主的编辑体验**：UI、Source projection、Typed Source Patch、Package / Project authoring、语言服务集成、静态样本及本仓测试。

Skill DSL 与正式语言契约由 ca-skills 拥有；Compiler、Host Context、Tool Contract、Runtime 执行结果、MCP Tool Catalog、5GC / 环境状态分别由各自 owner 负责。Studio 只消费这些权威契约，不定义第二份语法或业务规则。

当前唯一活动编辑目标是 `connectionagent.io/v1alpha5`，规范已在 `ca-skills@0abfd0e1ab99f481a4ae01f3f47efc54783dd5e5` 正式冻结发布；权威来源与字节摘要由 `language/contracts/ca-sl-v1alpha5.lock.json` 固定。v1alpha4 仅作为不可变的规范继承基线和历史记录，不是产品编辑模式，也不提供旧项目迁移或兼容。内置 Example 固定为当前仓 `site/samples/v1alpha5` 中的 OpenAMSM Scheme C Create / Modify / Release 三个 Skill，并锁定三个项目依赖：MAS Owner ToolCatalog（`mas`）、Host Context Schema Bundle（`ca-context`）和只读 SBI Interface Package（`ca-client`，仅用于查询工具 Schema IntelliSense，不是 MAS Contract root）；来源和 resolved revision 以 `site/samples/v1alpha5/files.json` 为准，不得再引用早期 5GC + MAS 双 Skill 示例作为当前 Example。当前集成的 CA Skill Compiler 为 v2.0.2，支持 CA-SL v1alpha5；Studio 的 Check / Build / Inspect 通过该版本的 WASM Worker 与权威结果适配器执行。CA Skill Compiler v2.1.0 已正式发布，其 Development Build / Verify API 已存在；Studio 对该 API 的适配仍处于 Draft 候选阶段，尚未切换到 Studio main。切换由本仓 Issue #269 跟踪（Draft PR #272 / #276），在 #269 合并并完成 exact-head 验收前，不得声称 v2.1.0 已集成。v2.1.0 Development Build 只接受 formal Interface Package snapshots：当前 `mas` 是 Owner ToolCatalog、`ca-context` 是 Host Context Schema Bundle，二者都不是 formal Interface Package Contract roots；`ca-client` 虽是已发布 Interface Package，但仅用于只读 SBI 查询 Schema IntelliSense，不能替代 MAS / Context roots。当前 MAS Example 在这些 Owner / Context roots 正式发布为 Compiler Interface Packages 前不能宣称 `LINKED / BUILT`。不得合成 Package manifest 或改写导入快照。Compiler 结果仍不代表 Host Admission、Owner Receipt、Runtime、5GC 或 Production Qualification。不得把 Node-entry Wait 降级成旧版 Observation、Polling 或第五种业务阶段。

Theia browser-only 是唯一在线工作台。独立 Classic 浏览器工作台、Classic 发布路径及旧构建入口已经退役；不得重新引入平行工作台、旧菜单或旧项目管理实现。

当前优先建设开发与编辑。Case、Qualification、发布和 Runtime 执行工作台后置。不得把编辑器诊断冒充 Compiler 结果，不得将浏览器测试冒充真实 Runtime / 5GC E2E。

## Required reading — in order

1. README.md / docs/README.md — 当前产品和文档地图；
2. docs/WORK.md — 唯一当前状态；docs/TRACEABILITY.md — contract → code → test → acceptance → evidence；
3. 边界改动读 docs/architecture/studio-boundaries.md；依赖 / Interface Package 改动必须读 docs/architecture/dependency-and-interface-package.md。plugin-managed-configuration-v0.1.md 是历史提案，不是当前实现指南；
4. Extension / Host 改动读 experiments/ide-host/README.md、experiments/ide-host/vscode/ 与对应测试；
5. 当前 UI / Preview / Projection / lifecycle 改动读 [ADR-0005](docs/decisions/0005-fixed-source-preview-workbench.md)、docs/architecture/studio-boundaries.md、docs/design/ca-sl-v1alpha5-studio-preview.md、对应共享模块和测试；AI Change Set 改动另读 docs/design/ai-procedure-authoring.md 与 authoring/core/README.md。docs/design/authoring-workbench.md 仅作为历史 Source-editing safety principles 参考，不是当前 UI / 布局契约；
6. Route / Phase 语义改动以 CA-SL v1alpha5 正式规范和 `language/core/v1alpha5.ts` 为准，并阅读 docs/design/ca-sl-v1alpha5-studio-preview.md 与相关测试。D1 / D2 / D3 / D4 Designer 文档仅作历史参考，不是当前 UI mutation contract。当前 Theia Preview 为只读，不得恢复或新增 Visual Designer mutation controls；
7. 语言服务改动读 docs/design/skill-lsp-l2d-editor-acceptance.md 与 docs/design/skill-lsp-l2d2-live-problems.md；
8. 文档改动读 docs/DOCUMENTATION.md，并参考 ConnectionAgent 文档治理。

历史 ADR 和迁移对照文档用于解释决策背景，不得把已退役的 Classic 路径当成当前实现或兼容目标。

## Non-negotiable editing invariants

- 原始 Skill 工作副本 / Source Document 为唯一业务真源；Graph、ELK、Inspector、符号索引和选中状态均为派生视图。
- 当前 Theia Preview 不提供 Visual mutation；原生 Source 是直接编辑入口，AI Authoring 通过独立 Host-owned Change Set 受控修改。只有在独立 Issue 明确批准新增 Visual mutation 后，才允许按精确 AST/CST span、Source revision、资格核验、结构重解析、Diff Preview、显式确认和 Undo/Redo 实施；未经确认不得回写，不得整文件 dump YAML 或擦除未知内容。
- on 是 YAML 1.2 **字符串键**。不能混淆 operator.on、preconditions.on、postconditions.on 或多 Outcome；绘图 bundle 不得替代原始身份。
- 未知语法、引用、别名、Anchor、quoted scalar 或编辑资格不明确时 fail closed，提供 Source-only；不能因图上有拖动手柄就越权修改。
- 不新增 CreatedSession 专用平行 Node / Route 变更器，不猜 Tool Effect / Runtime 许可。
- LSP、Semantic Tokens、Completion、Hover、Definition、References 与 Diagnostics 消费权威语言契约及项目依赖快照；禁止在 Studio 另维护一套 DSL / Schema 定义。
- 修改现有行为必须新增 positive 和 negative test；Source revision 冲突、结构保真、Route origin、Root/Child 导航都需回归。
- 用户项目与工作区数据优先保护；示例导入不得覆盖用户修改，删除旧代码不得删除用户文件或持久化工作区数据。
- AI Authoring 只支持 CA-SL v1alpha5；改动必须遵循 `docs/design/ai-procedure-authoring.md` 与 Issue #200。模型输出始终是不可信提案，必须经过 Host Change Set / v1alpha5 Patch Engine；Compiler 是唯一权威 Check。使用独立 Go `ai-gateway`；Provider Key 只保存在 Gateway 主机，不得进入浏览器、Webview、VSIX 或工作区。无用户账户 / OAuth / per-user Model Key；非 loopback 只允许一个部署级 `X-Gateway-Token`，它不是用户身份。浏览器 CORS 只允许精确 Origin，不使用 Cookie。

## Local validation / delivery

Node.js 24；仓根验证：

~~~bash
npm ci
npm test
npm run test:plugin-managed
npm run typecheck
git diff --check
~~~

根目录不再提供旧版浏览器应用的 npm run build 或 scripts/edge-smoke.mjs。Theia Web Extension / browser-only host 构建与真实 Chromium 验收由 .github/workflows/ 对应工作流执行。只有实际运行并通过的 Gate 才能报告 PASS；Chrome 启动失败不能写成 E2E PASS。

## Documentation / Issues

遵守中央文档治理：README 只导航；一个主题一个 canonical；WORK 是薄当前快照、Issue 是可执行工作和 audit trail、TRACEABILITY 是实施 / 测试 / 证据映射。Design Accepted ≠ Implemented ≠ PASS。Mock / static PASS 不能冒充真实 Runtime PASS。

发现 bug、需求、文档漂移或缺证据，先搜 owner 仓 open Issue；已有则复用，否则创建，包含 observed locator、预期、owner、影响与验收关闭条件。修复提交 / PR 关联 Issue；目标分支必需 Gate 通过后才可记录证据、关闭 Issue。不要将 Issue backlog 复制到 WORK。

旧文档整理先 Snapshot → Inventory → Classify → Migrate before delete → Verify → Compact；不创建 v2/final/latest 影子真源。

## Agent scratch safety

大下载、构建缓存、浏览器产物和多命令中间状态不得默认放在 RAM-backed /tmp。使用本仓 .agent-tmp/ 或环境变量 CA_AGENT_TMPDIR 指定的磁盘目录：

~~~bash
AGENT_TMP="$PWD/.agent-tmp"
if [ -n "$CA_AGENT_TMPDIR" ]; then AGENT_TMP="$CA_AGENT_TMPDIR"; fi
mkdir -p "$AGENT_TMP"
export TMPDIR="$AGENT_TMP" TMP="$AGENT_TMP" TEMP="$AGENT_TMP"
~~~

只能清理当前任务创建的 scratch，不扫描、杀掉或删除其他用户、进程、任务或 Agent 的资源。.agent-tmp/ 必须被 .gitignore 忽略。

## Revision record

- **2026-11-26 — Updated current UI / Route / Phase required reading.** Sections: Required reading 5–6 and Non-negotiable editing invariants. Reason: align Agent execution with ADR-0005 and Issue #237; prevent retired D1–D4 Designer mutation documents from being treated as active implementation instructions. Author: ChatGPT (GPT-6.2).
