# ConnectionAgent · SKILL Studio

**SKILL Package 的 Source-first 开发与编辑环境。** 当前唯一在线工作台是 VS Code-compatible Extension API hosted by Theia 1.76 browser-only。Studio 是编辑器和 Package authoring client，不是 Agent Runtime、5GC 控制台或 Runtime Validator。

[打开 Skill Studio 在线版](https://odango-chan.github.io/ca-skill-studio-demo/) · [当前实现与验收](docs/WORK.md) · [实施与证据追踪](docs/TRACEABILITY.md) · [开发文档地图](docs/README.md)

## 当前产品架构

- **固定工作台：** 左侧原生 Source Editor，右侧持久化 Preview Host；Outline / Problems 使用宿主原生视图，Package Explorer 组合 Skills 与 Plugin-managed Dependencies。Markdown 使用 pinned 原生 Markdown extension。不得恢复 Classic 独立工作台或第二套 Source/Preview 编辑组。
- **语言：** 唯一活动编辑目标为 `connectionagent.io/v1alpha5`。CA-SL v1alpha4 仅保留为规范继承基线和历史材料，不提供兼容编辑或旧项目迁移。
- **Compiler：** Studio main 当前集成 CA Skill Compiler **v2.0.2**，通过 WASM Worker 执行权威 Check / Build / dependency inspection。v2.1.0 Development Build / Verify 集成尚未完成，跟踪于 [Issue #269](https://github.com/odango-chan/ca-skill-studio-demo/issues/269)。当前 `mas` Owner ToolCatalog 与 `ca-context` Host Context Schema Bundle 不是正式 Interface Package Contract roots；`ca-client` 虽是 Interface Package，但仅用于只读 SBI 查询 Schema IntelliSense，不是 MAS Contract root。Owner / Context roots 必须先按 Compiler v2.1.0 契约正式发布，Studio 不得伪造 manifest 或替代依赖。不得把 Draft PR 或候选分支描述为已发布集成。
- **内置 Example：** 当前是 OpenAMSM Scheme C 的 Create、Modify、Release 三个真实 CA-SL v1alpha5 Skills，并固定三个项目依赖的 immutable snapshots：MAS Owner ToolCatalog（`mas`）、Host Context Schema Bundle（`ca-context`）和只读 SBI Interface Package（`ca-client`，仅用于查询工具 Schema IntelliSense，不是 MAS Contract root）。Example 及依赖来源以 `site/samples/v1alpha5/files.json` 为准。
- **AI Authoring：** 独立 AI Authoring Editor Tab；模型输出是不可信提案，必须经 Host Change Set 和 v1alpha5 Patch Engine。模型请求、Apply 和 Compiler 权威检查的当前门禁见 [WORK](docs/WORK.md) 与 [AI Authoring design](docs/design/ai-procedure-authoring.md)。

## 在线演示边界

GitHub Pages 使用 browser-only Theia 与同源 Webview，适合公开示例和非敏感工作区。浏览器 OPFS 存储不等于本地磁盘、GitHub 同步或可靠备份。在线版不执行用户 Python、Skill Runtime、Agent、Provider 或真实 5GC 操作。不要在公开在线演示中打开敏感文件。

## 本地开发与验证

需要 Node.js 24。在仓库根目录：

~~~bash
npm ci
npm test
npm run test:plugin-managed
npm run typecheck
~~~

Theia Web Extension、browser-only host 和真实 Chromium 验收由 `.github/workflows/` 中对应工作流执行；构建入口及精确依赖见 `experiments/ide-host/`。

## 代码与所有权边界

- `experiments/ide-host/vscode/`：Extension、Host Adapter、Source / Preview 与编辑器集成。
- `experiments/ide-host/theia-online/`：在线 Theia 宿主与插件装配。
- `extensions/`：主题、语言资源等扩展。
- `site/`：被 Extension / Theme 复用的解析、投影、编辑策略与固定样本模块；不是独立发布的第二工作台。
- `docs/`：架构决策、当前状态、设计和验收证据。

本仓只拥有 Studio 编辑器、Source projection、Typed Source Patch、项目体验和本仓测试。Skill DSL、Compiler 语义、Host Context、Tool 契约、Runtime 执行结果及 5GC 环境状态由各自权威仓库负责。浏览器 CI / Pages PASS 不代表 Runtime、Owner、Host、Integration 或真实 5GC Qualification PASS。
