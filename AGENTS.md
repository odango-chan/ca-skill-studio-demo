# Skill Studio Demo · Agent 工作规则

## Scope / Authority

本仓 `odango-chan/ca-skill-studio-demo` 只拥有**浏览器编辑器的 UI、Source projection、Typed Source Patch、静态样本及本仓测试**。Skill DSL、Host Loader、Runtime 执行结果、Capability Toolset、MCP Tool catalog、5GC/环境状态分别由 `ca-agent-demo`、`ca-runtime`、`ca-skill-toolchain`、`tool-mcp-gw`、`ca-sandbox` 等 owner 负责，不在 Studio 定义第二 authority。

当前只建设开发和编辑；Case、Validation/Qualification、发布、执行工作台后置。未经明确授权不得修改其他仓、合并 main、执行 Script/Skill、调用真实 5GC 或对用户文件做原地写回。

## Required reading — in order

1. `README.md` / `docs/README.md` — 当前文档地图；
2. `docs/WORK.md` — 唯一当前状态；`docs/TRACEABILITY.md` — contract → code → test → acceptance → evidence；
3. 边界改动读 `docs/architecture/studio-boundaries.md`；
4. UI/Projection/Patch 改动读 `docs/design/authoring-workbench.md` + 当前 `site/` 源码和相关 `tests/`；
5. Route 改动读 `docs/design/route-designer.md`、`docs/D1-procedure-designer.md`、`docs/D2-node-designer.md`；D3 是 Proposed，不是已实现；
6. 文档改动读 `docs/DOCUMENTATION.md`，并参考 [ConnectionAgent 文档治理](https://github.com/odango-chan/connectionagent/blob/main/docs/DOCUMENTATION.md)。

`docs/ux/ux-consolidation.md` 与早期 PR #1–#3 是**历史参考**。其中的 View 菜单、单文件只读假设、Python POC 不得用来推翻当前 React Flow + D2 代码。

## Non-negotiable editing invariants

- 原始 Skill 工作副本为唯一业务真源；Graph、ELK、Inspector 和选中状态是派生 UI，不保存第二份业务 JSON。
- 所有 Visual mutation 都要：精确当前源 AST/CST span、完整源文本 revision 与资格检查、结构重解析、Diff Preview、确认、Undo/Redo。未经确认不得回写；不能整文件 dump YAML 或擦除未知内容。
- `on` 为 YAML 1.2 **字符串键**。不能混淆 `operator.on`、`preconditions.on`、`postconditions.on` 或多 Outcome；bundle 只用于绘图，原始身份必须保留。
- 未知语法/引用/别名、Anchor、quoted scalar 或编辑资格不明确时 fail closed、提供 Source-only，不因图上有拖动手柄就越权修改。
- 不新增 CreatedSession 专用平行 Node/Route 变更器，不猜 Tool Effect/Runtime 许可、不把浏览器测试当成 5GC E2E。
- 修改现有行为必须新增 positive 和 negative test；Source revision 冲突、结构保真、Route origin、Root/Child 导航都需回归。

## Local validation / delivery

`site/` 是前端代码和固定样本；`tests/` 是测试；`scripts/` 是打包与 Chromium；`docs/architecture/` 定义稳定边界、`docs/design/` 定义 Studio 自有行为、`docs/decisions/` 解释 why。不要照搬 Go 仓的 `cmd/internal/pkg` 目录。

使用 Node.js 24；仓根实际执行：

~~~bash
npm ci
npm test
npm run typecheck
npm run build
node scripts/edge-smoke.mjs
git diff --check
~~~

浏览器/Actions/Pages Gate 只能在**实际运行**并通过后报告 PASS；Chrome 启动失败不能写成 E2E PASS。文档改动检查 canonical source、链接、WORK/TRACEABILITY、状态和 Issue。

## Documentation / Issues

遵守 [中央文档治理](https://github.com/odango-chan/connectionagent/blob/main/docs/DOCUMENTATION.md)，借鉴 `tool-mcp-gw/AGENTS.md`：README 只导航；一个主题一个 canonical；`WORK` 是薄当前快照、Issue 是可执行工作和 audit trail、`TRACEABILITY` 是实施/测试/证据映射。设计 `Accepted` ≠ `IMPLEMENTED` ≠ `PASS`。Mock/static PASS 不能冒充真实 Runtime PASS。

发现 bug、需求、文档漂移或缺证据，先搜 owner 仓 open Issue；已有则复用，否则创建，包含 observed locator、预期、owner、影响与验收关闭条件。修复提交/PR 关联 Issue；进入目标分支并完成必需 Gate 后才可记录证据、关闭 Issue。不要将 Issue backlog 复制到 WORK。

旧文档整理先 Snapshot → Inventory → Classify → Migrate before delete → Verify → Compact；不创建 `v2/final/latest` 影子真源。

## Agent scratch safety

大下载/构建缓存/浏览器产物/多命令中间状态**不得默认放在 RAM-backed /tmp**。使用本仓 `.agent-tmp/` 或环境变量 `CA_AGENT_TMPDIR` 指定的磁盘目录：

~~~bash
AGENT_TMP="$PWD/.agent-tmp"
if [ -n "$CA_AGENT_TMPDIR" ]; then AGENT_TMP="$CA_AGENT_TMPDIR"; fi
mkdir -p "$AGENT_TMP"
export TMPDIR="$AGENT_TMP" TMP="$AGENT_TMP" TEMP="$AGENT_TMP"
~~~

只能清理当前任务创建的 scratch，不扫描、杀掉或删除其他用户、进程、任务或 Agent 的资源。`.agent-tmp/` 必须被 `.gitignore` 忽略。
