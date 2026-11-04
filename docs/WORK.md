# Skill Studio 当前工作状态

**Updated: 2026-11-03**  
**Reviewed implementation baseline: main@a07e441c955e54180d8d909f800d33812a711d53**（D3、画布适配和 D4-A1 已合入）

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
| D3-A1 受限新增 `operator.on` Outcome | ACCEPTED | IMPLEMENTED | PASS（200 单测 + Chromium） | [PR #10](https://github.com/odango-chan/ca-skill-studio-demo/pull/10)、[CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41615104253) |
| D3-A2 有界 Outcome 重命名、受保护删除 | ACCEPTED | IMPLEMENTED | PASS（208 单测 + Chromium，主分支构建） | [PR #11 merged](https://github.com/odango-chan/ca-skill-studio-demo/pull/11)、[PR CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41623111837)、[main Pages](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41623429905) |
| D3-A3 画布拖线 → 显式 Outcome → Source Diff | ACCEPTED（Editor-tier） | IMPLEMENTED | PASS（213 单测 + Chromium） | [PR #13 merged](https://github.com/odango-chan/ca-skill-studio-demo/pull/13)、[CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41627042146)、[Pages](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41627403309) |
| 画布整体 / 横向 / 纵向适配 | ACCEPTED | IMPLEMENTED | PASS（222 单测 + Chromium） | [PR #14 merged](https://github.com/odango-chan/ca-skill-studio-demo/pull/14)、[CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41628951327)、[Pages](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41629222963) |
| D4-A1 有界 Phase Step `with.from` 输入重绑定 | ACCEPTED（Editor-tier） | IMPLEMENTED（main） | PASS（230 tests + Chromium） | [PR #16 merged](https://github.com/odango-chan/ca-skill-studio-demo/pull/16)、[CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41631580489)、[Pages](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41631903456) |
| D4-A2.1 同生产 Step 的输出引用写法 | PROPOSED（有界子集） | PARTIAL（PR #17） | NOT_RUN（最终 Gate 待验） | [PR #17](https://github.com/odango-chan/ca-skill-studio-demo/pull/17)、[#15](https://github.com/odango-chan/ca-skill-studio-demo/issues/15)、[设计](design/phase-designer.md) |
| D4-A2.2/A3/A4 跨生产者绑定 / Steps 编辑 / Phase Route | PROPOSED | NOT_STARTED | NOT_RUN | [#15](https://github.com/odango-chan/ca-skill-studio-demo/issues/15)、[设计](design/phase-designer.md) |
| 完整本地 Package 目录导入 / 原位保存 / 磁盘 Conflict | PROPOSED | NOT_STARTED | NOT_RUN | — |
| 正式 Runtime Qualification、Case、5GC、发布工作台 | PROPOSED（明确后置） | NOT_STARTED | NOT_RUN | — |

## Current open work

- [#7](https://github.com/odango-chan/ca-skill-studio-demo/issues/7)：D3 有界 operator.on Route 编辑已合入；Runtime Outcome 资格和 Phase-specific Route 仍未覆盖。
- [#15](https://github.com/odango-chan/ca-skill-studio-demo/issues/15)：D4 Phase Designer；A1 已合入，A2.1 在 PR #17 候选，A2.2/A3/A4 未开始。
- 早期未合并 [PR #1](https://github.com/odango-chan/ca-skill-studio-demo/pull/1)、[#2](https://github.com/odango-chan/ca-skill-studio-demo/pull/2)、[#3](https://github.com/odango-chan/ca-skill-studio-demo/pull/3) 目前只作为历史候选，**不推断可直接合并**。

## Authority / evidence

- [TRACEABILITY](TRACEABILITY.md)：当前范围→实现/测试→稳定证据。
- [文档基线主分支 Pages 成功记录](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41612728393)：仅为本仓浏览器静态站部署。
- Skill Fixture 基线：[ca-agent-demo@bf445ad](https://github.com/odango-chan/ca-agent-demo/tree/bf445ad777149af5af2dfa0a5bdea18d0451303e/skills)。Host/Runtime 是否可执行由真正 owner 的 Schema/Validator/执行事实确定。
