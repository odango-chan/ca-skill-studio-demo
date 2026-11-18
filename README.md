# ConnectionAgent · SKILL Studio

**SKILL Package 的 Source-first 开发与编辑环境。** 当前产品以 VS Code Extension API 为核心，由 Theia 1.76 browser-only 提供在线宿主。它不是 Agent Runtime、5GC 控制台或 Runtime Validator。

[打开 Skill Studio 在线版](https://odango-chan.github.io/ca-skill-studio-demo/) · [当前实现与验收](docs/WORK.md) · [实施与证据追踪](docs/TRACEABILITY.md) · [开发文档地图](docs/README.md)

## 当前产品架构

- Theia browser-only 是唯一在线工作台；不再发布独立 Classic 浏览器工作台或 /classic/ 兼容入口。
- VS Code Web Extension 提供 Procedure / Contract / Predicate / Schema CustomEditor、Package Explorer、右侧 Inspector、Outline、Problems、LSP 与 Source/Visual 配对。
- React Flow + ELK 提供 Procedure 可视化；原生 Markdown Language Features 拥有 Markdown Preview；独立主题扩展提供颜色、文件图标和预览样式。
- YAML / Python TextMate 语法高亮不依赖 LSP；LSP 提供 CA-SL v1alpha5 的源码语义辅助。当前唯一活动编辑目标为 `connectionagent.io/v1alpha5`（FROZEN / RELEASED）；v1alpha4 仅作为不可变的规范继承基线和历史记录，不提供产品兼容模式或旧项目迁移。集成的 Compiler v1.0.0 仍只支持 v1alpha4；v1alpha5 Compiler 候选 [PR #38](https://github.com/odango-chan/ca-skill-compiler/pull/38) 尚未合并、发布或集成，因此 v1alpha5 的 Check / Build / Inspect 继续 fail-closed。编辑器的 LSP / Designer 投影不等于 Compiler、Host 或 Runtime 资格。
- 示例包含 5GC `establish-pdu-session` 与 MAS `establish-pdu-session-mas`，作为项目内容，不是 Studio 自己维护的第二套语言定义。

## 在线演示安全边界

GitHub Pages 使用 browser-only Theia 与同源 Webview，适合公开示例和非敏感工作区。浏览器存储不等于本地磁盘、GitHub 同步或可靠备份。在线版不执行用户 Python、Skill Runtime、Agent、Provider 或真实 5GC 操作。不要在公开在线演示中打开敏感文件。

## 本地开发与验证

需要 Node.js 24。在仓库根目录：

~~~bash
npm ci
npm test
npm run test:plugin-managed
npm run typecheck
~~~

根目录不再构建或启动旧版独立浏览器应用。Theia Web Extension、browser-only host 和真实 Chromium 验收由 .github/workflows/ 中对应工作流执行；构建入口及精确依赖见 experiments/ide-host/。

## 代码与所有权边界

- experiments/ide-host/vscode/：VS Code Web Extension、Host Adapter 与编辑器集成。
- experiments/ide-host/theia-online/：在线 Theia 宿主与插件装配。
- extensions/：独立主题、语言资源等扩展。
- site/：仍被 Extension / Theme 复用的解析、投影、编辑策略与固定样本模块；不是可独立发布的第二个工作台。
- docs/：架构决策、当前状态、设计和验收证据。

本仓只拥有 Studio 编辑器、Source projection、Typed Source Patch、项目体验和本仓测试。Skill DSL、Host Context、Tool 契约、Runtime 执行结果及 5GC 环境状态由各自权威仓库负责，不在 Studio 定义第二 authority。

开始开发前先读 AGENTS.md、WORK.md、TRACEABILITY.md。单测、Chromium、Pages PASS 只证明本仓实际覆盖的行为，不代表完整 Skill Runtime、跨仓联调或真实 5GC E2E PASS。
