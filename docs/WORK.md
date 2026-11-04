# Skill Studio 当前工作状态

**Updated: 2026-11-04**  
**Reviewed implementation baseline: main@95d18cb92a17d6a5726b3a190e6fa87e3fd4b624**（D4-A3b1 已合入且 Pages PASS；D4-A3b2a 编辑器级验收通过）

## Overall

静态浏览器 Studio 的 D1 React Flow/ELK、D2 Node Designer A1–A5、固定多文件 Package 浏览及图标统一已进入 `main`，并通过了本仓范围内的单测、构建及 Chromium 回归。**尚无**完整磁盘 Package 目录导入/原位保存、完整 Runtime validator 或真实 5GC 验收能力。Pages 的 PASS 不等于 Skill Runtime PASS。

## Current scope matrix

| Scope | Design | Implementation | Acceptance | Tracking / evidence |
|---|---|---|---|---|
| D1 Procedure 投影、图形浏览、现有 Route Target Rewire | ACCEPTED | IMPLEMENTED | PASS（本仓浏览器级） | [D1](D1-procedure-designer.md)、[CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41605377069) |
| D2 Node Designer A1–A5 有界创建/删除/重命名/属性 Patch | ACCEPTED | IMPLEMENTED | PASS（本仓单测/浏览器） | [D2](D2-node-designer.md)、[PR #4](https://github.com/odango-chan/ca-skill-studio-demo/pull/4)、[CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41605140297) |
| 固定示例多文件 Source / Markdown/ZIP 编辑与下载 | ACCEPTED | IMPLEMENTED | PASS（本仓测试范围） | `site/sample-packages.mjs`、`tests/package.test.mjs`、[CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41605377069) |
| `establish-pdu-session` 刷新 SKILL.md + `references/` 三份 Markdown | ACCEPTED（Source Snapshot） | IMPLEMENTED（PR #20） | PASS（249 tests + Chromium；PR #20 合入） | [owner@7570b309](https://github.com/odango-chan/ca-agent-demo/tree/7570b309a998580a6952352e2bf4b1c19e5c710d/skills/establish-pdu-session)、[PR #20](https://github.com/odango-chan/ca-skill-studio-demo/pull/20)、[CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41761998627) |
| Root / Child 导航及统一线性图标 | ACCEPTED | IMPLEMENTED | PASS（189 tests + Chromium + Pages） | [PR #5](https://github.com/odango-chan/ca-skill-studio-demo/pull/5)、[Pages CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41608219330) |
| Canonical 文档整顿 | ACCEPTED | IMPLEMENTED | PASS（193 单测、Typecheck、Build、Chromium、resulting-main Pages） | [PR #8](https://github.com/odango-chan/ca-skill-studio-demo/pull/8)、[PR CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41611856550)、[Pages CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41612728393)、[#6](https://github.com/odango-chan/ca-skill-studio-demo/issues/6) |
| D3-A1 受限新增 `operator.on` Outcome | ACCEPTED | IMPLEMENTED | PASS（200 单测 + Chromium） | [PR #10](https://github.com/odango-chan/ca-skill-studio-demo/pull/10)、[CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41615104253) |
| D3-A2 有界 Outcome 重命名、受保护删除 | ACCEPTED | IMPLEMENTED | PASS（208 单测 + Chromium，主分支构建） | [PR #11 merged](https://github.com/odango-chan/ca-skill-studio-demo/pull/11)、[PR CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41623111837)、[main Pages](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41623429905) |
| D3-A3 画布拖线 → 显式 Outcome → Source Diff | ACCEPTED（Editor-tier） | IMPLEMENTED | PASS（213 单测 + Chromium） | [PR #13 merged](https://github.com/odango-chan/ca-skill-studio-demo/pull/13)、[CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41627042146)、[Pages](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41627403309) |
| 画布整体 / 横向 / 纵向适配 | ACCEPTED | IMPLEMENTED | PASS（222 单测 + Chromium） | [PR #14 merged](https://github.com/odango-chan/ca-skill-studio-demo/pull/14)、[CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41628951327)、[Pages](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41629222963) |
| D4-A1 有界 Phase Step `with.from` 输入重绑定 | ACCEPTED（Editor-tier） | IMPLEMENTED（main） | PASS（230 tests + Chromium） | [PR #16 merged](https://github.com/odango-chan/ca-skill-studio-demo/pull/16)、[CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41631580489)、[Pages](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41631903456) |
| D4-A2.1 同生产 Step 的输出引用写法 | ACCEPTED（Editor-tier） | IMPLEMENTED（main） | PASS（238 tests + Chromium） | [PR #17 merged](https://github.com/odango-chan/ca-skill-studio-demo/pull/17)、[CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41756050731)、[Pages](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41756351449) |
| D4-A2.2a Phase Step 依赖/Schema 证据审查（只读） | ACCEPTED（Read-only editor tier） | IMPLEMENTED（main） | PASS（245 tests + Chromium） | [PR #18 merged](https://github.com/odango-chan/ca-skill-studio-demo/pull/18)、[CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41758229256)、[设计](design/phase-designer.md) |
| D4-A2.2b1 Script 消费参数 Schema / 生产者类型对照（只读） | ACCEPTED（Read-only editor tier） | IMPLEMENTED（PR #19） | PASS（258 tests + real Chromium；PR #19 已合入） | [PR #19](https://github.com/odango-chan/ca-skill-studio-demo/pull/19)、[最终 CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41769318870)、[设计](design/phase-designer.md) |
| D4-A3a 相邻独立 Verify Step 的 Source-backed 换序 | ACCEPTED（Editor-tier） | IMPLEMENTED（PR #29） | PASS（264 tests + Chromium；首轮提交） | [PR #29](https://github.com/odango-chan/ca-skill-studio-demo/pull/29)、[CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41770964460)、[设计](design/phase-designer.md) |
| D4-A3b1 已有 Phase 尾部新增 / 有界删除独立 Verify | ACCEPTED（Editor-tier） | IMPLEMENTED（PR #30） | PASS（272 tests + Chromium；集成文档 CI 已验收） | [PR #30](https://github.com/odango-chan/ca-skill-studio-demo/pull/30)、[CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41778044582)、[设计](design/phase-designer.md) |
| D4-A3b2a 命名 Step 引用影响审查与原子改名 | ACCEPTED（Editor-tier） | IMPLEMENTED（PR #32） | PASS（279 tests + real Chromium；集成提交） | [PR #32](https://github.com/odango-chan/ca-skill-studio-demo/pull/32)、[CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41784309105)、[设计](design/phase-designer.md) |
| D4-A2.2b2/A3b2b/A4 跨生产者写入 / 命名 Step 增删与依赖排序 / Phase Route | PROPOSED | NOT_STARTED | NOT_RUN | [#15](https://github.com/odango-chan/ca-skill-studio-demo/issues/15)、[设计](design/phase-designer.md) |
| E1 Monaco Source Editor（仍在 PR，未合主分支） | ACCEPTED | IMPLEMENTED（PR #33） | PASS（286 tests + Chromium，**仅 PR HEAD**） | [设计](design/source-editor-workstream.md)、[PR #33](https://github.com/odango-chan/ca-skill-studio-demo/pull/33)、[CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41785473857)、[#23](https://github.com/odango-chan/ca-skill-studio-demo/issues/23) |
| E2 YAML 语言智能 / Owner Schema 绑定 | ACCEPTED（分阶段、拒绝错误 Schema） | NOT_STARTED | NOT_RUN | [设计](design/source-editor-workstream.md)、[#24](https://github.com/odango-chan/ca-skill-studio-demo/issues/24) |
| E3 Python Script 智能编辑与导航 | ACCEPTED（方向） | NOT_STARTED | NOT_RUN | [设计](design/source-editor-workstream.md)、[#25](https://github.com/odango-chan/ca-skill-studio-demo/issues/25) |
| E4 Package 目录打开/保存与冲突 | PROPOSED | NOT_STARTED | NOT_RUN | [设计](design/source-editor-workstream.md)、[#26](https://github.com/odango-chan/ca-skill-studio-demo/issues/26) |
| 完整本地 Package 目录导入 / 原位保存 / 磁盘 Conflict | PROPOSED | NOT_STARTED | NOT_RUN | — |
| 正式 Runtime Qualification、Case、5GC、发布工作台 | PROPOSED（明确后置） | NOT_STARTED | NOT_RUN | — |


唯一公开示例名称与 owner 的 SKILL 目录 `establish-pdu-session` 完全一致；Ensure Package 已从选择器、清单和发布资源中移除。旧 Ensure Package 原文与独立 Procedure YAML 仅保留在源码中给单测/浏览器回归使用，发布到 Pages 的 `dist/` 仅包含 `establish-pdu-session` Package。`references/` 在 Explorer 默认展开。[PR #21 CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41766617644) 已验证单测、TypeScript、构建和真实 Chromium 交互 PASS；[main Pages #41771402007](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41771402007) 已在 `f93f1e3f`（重跑 attempt 2）完成静态资产检查、Chromium 和 Pages 部署 PASS。

## Current open work

- **E Source Editor 与 D4 并行**：E1 Monaco [PR #33](https://github.com/odango-chan/ca-skill-studio-demo/pull/33) 已通过分支 CI，但未合入 main 或通过 resulting-main Pages；E2 [#24](https://github.com/odango-chan/ca-skill-studio-demo/issues/24) 的旧 Owner Procedure Schema 与 Phase 结构不兼容，必须拒绝错误 Schema 关联；E3/E4 未实施。见 [统一设计](design/source-editor-workstream.md)。

- [#7](https://github.com/odango-chan/ca-skill-studio-demo/issues/7)：D3 有界 operator.on Route 编辑已合入；Runtime Outcome 资格和 Phase-specific Route 仍未覆盖。
- [#15](https://github.com/odango-chan/ca-skill-studio-demo/issues/15)：D4 Phase Designer；A1/A2.1/A2.2a 已合入，A2.2b1 只读脚本消费字段对照已合入；A3a 仅允许相邻无名无绑定单行 Verify 换序（首轮 CI 与浏览器 PASS）；A2.2b2、A3b2b 命名 Step 增删及依赖重排和 A4 尚未开始；A3b2a 先审查命名输出引用并受限改名，不能据此宣称 Runtime 兼容。
- 早期未合并 [PR #1](https://github.com/odango-chan/ca-skill-studio-demo/pull/1)、[#2](https://github.com/odango-chan/ca-skill-studio-demo/pull/2)、[#3](https://github.com/odango-chan/ca-skill-studio-demo/pull/3) 目前只作为历史候选，**不推断可直接合并**。

## Authority / evidence

- [TRACEABILITY](TRACEABILITY.md)：当前范围→实现/测试→稳定证据。
- [文档基线主分支 Pages 成功记录](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41612728393)：仅为本仓浏览器静态站部署。
- Studio 唯一可选择且默认打开的 Package `establish-pdu-session`，其运行时相关 16 文件来自 [ca-agent-demo@7570b309](https://github.com/odango-chan/ca-agent-demo/tree/7570b309a998580a6952352e2bf4b1c19e5c710d/skills/establish-pdu-session)。`references/3gpp-procedure.md`、`references/session-selection.md`、`references/failure-handling.md` 为可选业务参考材料；Studio 可浏览/编辑/导出，不表示已实现 Host `read_reference` 工具。`cases/` 和内部 `design/` 未纳入此编辑示例。Host/Runtime 可执行性仍由真正 owner 的 Schema/Validator/执行事实决定。
