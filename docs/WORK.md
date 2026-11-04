# Skill Studio 当前工作状态

**Updated: 2026-11-04**  
**Reviewed implementation baseline: main@d5eedb3741afdbc9b1014e29bf78e4953b3c8b63**（PR #21/#22 已合入且 Pages PASS；D4-A2.2b1 集成中）

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
| D4-A2.2b1 Script 消费参数 Schema / 生产者类型对照（只读） | ACCEPTED（Read-only editor tier） | IMPLEMENTED（PR #19） | PASS（258 tests + real Chromium；最新 main 整合提交） | [PR #19](https://github.com/odango-chan/ca-skill-studio-demo/pull/19)、[集成 CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41769084899)、[设计](design/phase-designer.md) |
| D4-A2.2b2/A3/A4 跨生产者写入 / Steps 结构 / Phase Route | PROPOSED | NOT_STARTED | NOT_RUN | [#15](https://github.com/odango-chan/ca-skill-studio-demo/issues/15)、[设计](design/phase-designer.md) |
| E1 Monaco Source Editor / 共享事务历史 | ACCEPTED（设计） | NOT_STARTED | NOT_RUN | [E 设计](design/source-editor-workstream.md)、[#23](https://github.com/odango-chan/ca-skill-studio-demo/issues/23) |
| E2 YAML Schema / 语言智能 | ACCEPTED（方向，技术验证待做） | NOT_STARTED | NOT_RUN | [E 设计](design/source-editor-workstream.md)、[#24](https://github.com/odango-chan/ca-skill-studio-demo/issues/24) |
| E3 Python 编辑与 Script 引用导航 | ACCEPTED（方向，语言服务待评估） | NOT_STARTED | NOT_RUN | [E 设计](design/source-editor-workstream.md)、[#25](https://github.com/odango-chan/ca-skill-studio-demo/issues/25) |
| E4 完整 Package 目录打开/保存/冲突 | PROPOSED（后置） | NOT_STARTED | NOT_RUN | [E 设计](design/source-editor-workstream.md)、[#26](https://github.com/odango-chan/ca-skill-studio-demo/issues/26) |
| 完整本地 Package 目录导入 / 原位保存 / 磁盘 Conflict | PROPOSED | NOT_STARTED | NOT_RUN | — |
| 正式 Runtime Qualification、Case、5GC、发布工作台 | PROPOSED（明确后置） | NOT_STARTED | NOT_RUN | — |


唯一公开示例名称与 owner 的 SKILL 目录 `establish-pdu-session` 完全一致；Ensure Package 已从选择器、清单和发布资源中移除。旧 Ensure Package 原文与独立 Procedure YAML 仅保留在源码中给单测/浏览器回归使用，发布到 Pages 的 `dist/` 仅包含 `establish-pdu-session` Package。`references/` 在 Explorer 默认展开。[PR #21 CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41766617644) 已验证单测、TypeScript、构建和真实 Chromium 交互 PASS；[main Pages #41767797399](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41767797399) 已在 `d5eedb37` 完成所有静态资产检查、Chromium 和 Pages 部署 PASS。

## Current open work

- **E 与 D4 并行启动（仅立项、未实现）**：[#23](https://github.com/odango-chan/ca-skill-studio-demo/issues/23) Monaco、[#24](https://github.com/odango-chan/ca-skill-studio-demo/issues/24) YAML、[#25](https://github.com/odango-chan/ca-skill-studio-demo/issues/25) Python、[#26](https://github.com/odango-chan/ca-skill-studio-demo/issues/26) Package；共同 Source/History 接线见 [设计](design/source-editor-workstream.md)。

- [#7](https://github.com/odango-chan/ca-skill-studio-demo/issues/7)：D3 有界 operator.on Route 编辑已合入；Runtime Outcome 资格和 Phase-specific Route 仍未覆盖。
- [#15](https://github.com/odango-chan/ca-skill-studio-demo/issues/15)：D4 Phase Designer；A1/A2.1/A2.2a 已合入，A2.2b1 只读脚本消费字段对照在 PR #19 集成中；A2.2b2/A3/A4 仍未开始。
- 早期未合并 [PR #1](https://github.com/odango-chan/ca-skill-studio-demo/pull/1)、[#2](https://github.com/odango-chan/ca-skill-studio-demo/pull/2)、[#3](https://github.com/odango-chan/ca-skill-studio-demo/pull/3) 目前只作为历史候选，**不推断可直接合并**。

## Authority / evidence

- [TRACEABILITY](TRACEABILITY.md)：当前范围→实现/测试→稳定证据。
- [文档基线主分支 Pages 成功记录](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41612728393)：仅为本仓浏览器静态站部署。
- Studio 唯一可选择且默认打开的 Package `establish-pdu-session`，其运行时相关 16 文件来自 [ca-agent-demo@7570b309](https://github.com/odango-chan/ca-agent-demo/tree/7570b309a998580a6952352e2bf4b1c19e5c710d/skills/establish-pdu-session)。`references/3gpp-procedure.md`、`references/session-selection.md`、`references/failure-handling.md` 为可选业务参考材料；Studio 可浏览/编辑/导出，不表示已实现 Host `read_reference` 工具。`cases/` 和内部 `design/` 未纳入此编辑示例。Host/Runtime 可执行性仍由真正 owner 的 Schema/Validator/执行事实决定。
