# Skill Studio 当前工作状态

**Updated: 2026-11-03**  
**Implementation baseline: main@69bd8ef5900c68fff85653619eda770599ac9d3a**（已合入文档治理的主分支基线）

## Overall

静态浏览器 Studio 的 D1 React Flow/ELK、D2 Node Designer A1–A5、固定多文件 Package 浏览及图标统一已进入 `main`，并通过了本仓范围内的单测、构建及 Chromium 回归。**尚无**完整磁盘 Package 目录导入/原位保存、完整 Runtime validator 或真实 5GC 验收能力。Pages 的 PASS 不等于 Skill Runtime PASS。

## Current scope matrix

| Scope | Design | Implementation | Acceptance | Tracking / evidence |
|---|---|---|---|---|
| D1 Procedure 投影、图形浏览、现有 Route Target Rewire | ACCEPTED | IMPLEMENTED | PASS（本仓浏览器级） | [D1](D1-procedure-designer.md)、[CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41605377069) |
| D2 Node Designer A1–A5 有界创建/删除/重命名/属性 Patch | ACCEPTED | IMPLEMENTED | PASS（本仓单测/浏览器） | [D2](D2-node-designer.md)、[PR #4](https://github.com/odango-chan/ca-skill-studio-demo/pull/4)、[CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41605140297) |
| 固定示例多文件 Source / Markdown/ZIP 编辑与下载 | ACCEPTED | IMPLEMENTED | PASS（本仓测试范围） | `site/sample-packages.mjs`、`tests/package.test.mjs`、[CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41605377069) |
| Root / Child 导航及统一线性图标 | ACCEPTED | IMPLEMENTED | PASS（189 tests + Chromium + Pages） | [PR #5](https://github.com/odango-chan/ca-skill-studio-demo/pull/5)、[Pages CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41608219330) |
| Canonical 文档整顿 | ACCEPTED | IMPLEMENTED | PASS（193 单测、Typecheck、Build、Chromium、resulting-main Pages） | [PR #8](https://github.com/odango-chan/ca-skill-studio-demo/pull/8)、[PR CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41611856550)、[Pages CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41612728393)、[#6](https://github.com/odango-chan/ca-skill-studio-demo/issues/6) |
| D3 Route Designer：新增、变更、删除 Outcome | PROPOSED | NOT_STARTED | NOT_RUN | [#7](https://github.com/odango-chan/ca-skill-studio-demo/issues/7)、[设计草案](design/route-designer.md) |
| 完整本地 Package 目录导入 / 原位保存 / 磁盘 Conflict | PROPOSED | NOT_STARTED | NOT_RUN | — |
| 正式 Runtime Qualification、Case、5GC、发布工作台 | PROPOSED（明确后置） | NOT_STARTED | NOT_RUN | — |

## Current open work

- [#7](https://github.com/odango-chan/ca-skill-studio-demo/issues/7)：D3 Route Designer；设计为 Proposed，未有实现/测试。
- 早期未合并 [PR #1](https://github.com/odango-chan/ca-skill-studio-demo/pull/1)、[#2](https://github.com/odango-chan/ca-skill-studio-demo/pull/2)、[#3](https://github.com/odango-chan/ca-skill-studio-demo/pull/3) 目前只作为历史候选，**不推断可直接合并**。

## Authority / evidence

- [TRACEABILITY](TRACEABILITY.md)：当前范围→实现/测试→稳定证据。
- [文档基线主分支 Pages 成功记录](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41612728393)：仅为本仓浏览器静态站部署。
- Skill Fixture 基线：[ca-agent-demo@bf445ad](https://github.com/odango-chan/ca-agent-demo/tree/bf445ad777149af5af2dfa0a5bdea18d0451303e/skills)。Host/Runtime 是否可执行由真正 owner 的 Schema/Validator/执行事实确定。
