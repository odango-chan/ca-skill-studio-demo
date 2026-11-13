# SKILL Studio · Agent 工作规则

## Scope / Authority

本仓 odango-chan/ca-skill-studio-demo 拥有 **VS Code Extension / Theia 在线宿主的编辑体验**：UI、Source projection、Typed Source Patch、Package / Project authoring、语言服务集成、静态样本及本仓测试。

Skill DSL 与正式语言契约由 ca-skills 拥有；Compiler、Host Context、Tool Contract、Runtime 执行结果、MCP Tool Catalog、5GC / 环境状态分别由各自 owner 负责。Studio 只消费这些权威契约，不定义第二份语法或业务规则。

Theia browser-only 是唯一在线工作台。独立 Classic 浏览器工作台、Classic 发布路径及旧构建入口已经退役；不得重新引入平行工作台、旧菜单或旧项目管理实现。

当前优先建设开发与编辑。Case、Qualification、发布和 Runtime 执行工作台后置。不得把编辑器诊断冒充 Compiler 结果，不得将浏览器测试冒充真实 Runtime / 5GC E2E。

## Required reading — in order

1. README.md / docs/README.md — 当前产品和文档地图；
2. docs/WORK.md — 唯一当前状态；docs/TRACEABILITY.md — contract → code → test → acceptance → evidence；
3. 边界改动读 docs/architecture/studio-boundaries.md 和 docs/architecture/plugin-managed-configuration-v0.1.md；
4. Extension / Host 改动读 experiments/ide-host/README.md、experiments/ide-host/vscode/ 与对应测试；
5. UI / Projection / Patch 改动读 docs/design/authoring-workbench.md、相关共享模块和测试；
6. Route / Phase 改动读 docs/design/route-designer.md、docs/D1-procedure-designer.md、docs/D2-node-designer.md；
7. 语言服务改动读 docs/design/skill-lsp-l2d-editor-acceptance.md 与 docs/design/skill-lsp-l2d2-live-problems.md；
8. 文档改动读 docs/DOCUMENTATION.md，并参考 ConnectionAgent 文档治理。

历史 ADR 和迁移对照文档用于解释决策背景，不得把已退役的 Classic 路径当成当前实现或兼容目标。

## Non-negotiable editing invariants

- 原始 Skill 工作副本 / Source Document 为唯一业务真源；Graph、ELK、Inspector、符号索引和选中状态均为派生视图。
- 所有 Visual mutation 必须定位精确 AST/CST span，核对 Source revision 与资格，执行结构重解析、Diff Preview、显式确认和 Undo/Redo。未经确认不得回写；不得整文件 dump YAML 或擦除未知内容。
- on 是 YAML 1.2 **字符串键**。不能混淆 operator.on、preconditions.on、postconditions.on 或多 Outcome；绘图 bundle 不得替代原始身份。
- 未知语法、引用、别名、Anchor、quoted scalar 或编辑资格不明确时 fail closed，提供 Source-only；不能因图上有拖动手柄就越权修改。
- 不新增 CreatedSession 专用平行 Node / Route 变更器，不猜 Tool Effect / Runtime 许可。
- LSP、Semantic Tokens、Completion、Hover、Definition、References 与 Diagnostics 消费权威语言契约及项目依赖快照；禁止在 Studio 另维护一套 DSL / Schema 定义。
- 修改现有行为必须新增 positive 和 negative test；Source revision 冲突、结构保真、Route origin、Root/Child 导航都需回归。
- 用户项目与工作区数据优先保护；示例导入不得覆盖用户修改，删除旧代码不得删除用户文件或持久化工作区数据。

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
