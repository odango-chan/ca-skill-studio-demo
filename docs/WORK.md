# Skill Studio 当前工作状态

## 2026-11-12 · Package-first Workspace（ADR-0004）

**Design: ACCEPTED · Implementation: NOT_STARTED · Acceptance: NOT_RUN.** Package Explorer is the default project surface inside the native Explorer container; Files remains the secondary physical view. Skills / Dependencies / actual Build Artifacts are one logical projection backed by their existing owners. This changes presentation only; Plugin-managed Configuration v0.1, Source-first editing, Compiler ownership and ADR-0003's Inspector / Outline / Problems / Markdown decisions remain authoritative. Tracking: [Issue #173](https://github.com/odango-chan/ca-skill-studio-demo/issues/173). Draft [PR #152](https://github.com/odango-chan/ca-skill-studio-demo/pull/152) is not mergeable as-is: it is based on an earlier main and still contributes a separate Skill Studio Activity Bar. No implementation or browser acceptance is claimed.

**Updated: 2026-11-10**  
**Theia host migration merge:** `b2f4e991e5e273ebb98419ba0b66453bdd0f72cf` (PR #86 Squash Merge; Theia is now the default Pages host).  
**Node Focus merge baseline:** `b9c1c38cd286526d742dd254646a9ec3c2489562` (PR #89 Node Focus migration merged; resulting-main Pages [#42585232727 PASS](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42585232727)).  
**Integrated baseline before top-level menu UX: main@80cc153fc043cf3d6e7e6449fb9197adc7419eb6**（D1-A2c #70、Root 主路径 #73、分支收起 / 显式查看 #75、节点位置锚定 #77、统一菜单/移除双击 #79 均已合入；[resulting-main Pages #42181238105 PASS](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42181238105)。本节同时记录正在推进的 Explorer 整理 #80，不将待验收改动称为 main。）

## 2026-11-06 · 统一菜单与显式节点导航（PR #79）

**范围：** `site/application-menu.mjs` 提供全局「菜单」中的文件、编辑、视图真实命令入口；委托现有处理器，不实现另一套 Source Save / Undo / Runtime。主图及局部图移除双击进入，卡片「查看」为明确的节点局部图入口，`进入子流程` 仅进入真实 Child Procedure。

**Web/Local 统一：** 同一浏览器 UI、命令 ID、编辑模型；宿主能力不同。Node.js `http.server dist/` 只启动编辑器，**并不执行 SKILL**。本地执行宿主与实际 `Run/Debug/Trace` 功能仍未实现，不能展示假的可操作命令。详细决策见 [Application Shell](design/application-shell.md)。

**证据：** [PR #79](https://github.com/odango-chan/ca-skill-studio-demo/pull/79) 已合入；[exact-head PR CI #42180901569 PASS](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42180901569)（407 tests、TS、Build、Chromium 菜单/显式查看）；[resulting-main Pages #42181238105 PASS](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42181238105)。这不是 Native OS / Runtime PASS。

## 2026-11-06 · 顶层菜单显露与当前文件居中（Issue #82）

**本轮范围：** 旧版「菜单」中嵌套三个分组占用了过多横向留白。现在顶栏并列展示**文件、编辑、视图、帮助**；中间为当前文件的可伸缩路径栏，右侧状态和高频操作不变。仍是 54px 头部，小屏不引入第二套命令模型。

**交互：** Native details 菜单四组共用原来的命令目标，不修改文件授权、保存确认、Source 或 SKILL；同一时刻只允许展开一个一级菜单，支持 Esc/点击外部和方向键切换标题。Chromium 要验四菜单、中央路径、小屏可见性、原有编辑/示例/子流程回归。追踪 [#82](https://github.com/odango-chan/ca-skill-studio-demo/issues/82)。当前只记录 PR 范围，验收证据以 exact-head CI 和合入后 Pages 为准。

## 2026-11-06 · Explorer 低频入口收敛（Issue #80）

**本轮代码：** 左侧文件导航不再堆叠“打开单文件 / 导出 ZIP / 加载示例”三套入口，它们归并到顶部「菜单 → 文件」。Explorer 保留高频目录打开、资格成立才出现的目录保存、确有冲突才出现的重新导入和真实状态提示。顶部快捷导出和撤销/重做暂不动，避免失去操作效率。

**一致性：** 原文件按钮与 handler 仍为命令所有者，低频重复按钮仅在视觉上隐藏；不可用与权限仍由 JS `hidden`/`disabled`、现有 Picker 和 Diff/Confirm 保护。浏览器回归要证明文件菜单可以访问示例/ZIP，真实样本加载确实经过菜单，Source 和导航不变。追踪 [#80](https://github.com/odango-chan/ca-skill-studio-demo/issues/80)。PR CI、Pages 待实际成功后补证据；不得把部署前的 UI 声称已上线。

## 2026-11-06 · IDE Host Spike（历史起点；已由 2026-11-09 默认宿主决策取代）

**本轮为独立试验分支** `spike/ide-extension-theia-host`：标准 VS Code `CustomTextEditorProvider` / `TextDocument` / `WorkspaceEdit`，将现有 Procedure 投影、ELK、ReactFlow 复用到 Webview；普通 YAML/Python、文件树、新建/删除、Undo/Redo 交给宿主。另通过同一 VSIX 试验 Theia 的 VS Code API 兼容性。详细见 [ADR-0002](decisions/0002-ide-host-spike.md) 和 [试验说明](../experiments/ide-host/README.md)。

**当时证据：** [独立 IDE Spike CI #42191440251 PASS](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42191440251)（6/6 focused tests、409/409 旧回归、VSIX 生成）。当时 PR #86 为 Draft/OPEN；**现已于 2026-11-09 通过 Squash Merge 合入 `main@b2f4e991`**。Theia browser-only 在线宿主已通过真实 Chromium 和 Pages 根路径部署；VS Code 桌面 GUI / Node Theia 桌面宿主仍未验收。模拟宿主 PASS 不代表桌面 IDE PASS；本仓不修改 Runtime/5GC。

## 2026-11-06 · 在线版必须保留（历史约束；后续宿主决策见 2026-11-09）

**当时产品约束：** 浏览器在线 Studio 是必需能力；当时 Theia 1.76+ 仍处于候选评估，完整在线构建/部署/OPFS/Native GUI 尚未验收。该状态已由 2026-11-09 的决策更新：Theia browser-only 成为默认 Pages 宿主，旧版完整工作台保留在 `/classic/`；当前验收证据见本文件末尾和 [ADR-0002](decisions/0002-ide-host-spike.md)。

## Overall

静态浏览器 Studio 的 D1 React Flow/ELK、D2 Node Designer A1–A5、固定多文件 Package 浏览及图标统一已进入 `main`，并通过了本仓范围内的单测、构建及 Chromium 回归。**E4-A1 目录导入/ZIP 与 E4-A2 显式原位保存均已合入并部署；原生 Windows Chrome 选择窗口实盘验收尚未进行**；不宣称真实 OS 写盘验收、多文件原子事务、完整 Runtime validator 或真实 5GC 验收能力。Pages 的 PASS 不等于 Skill Runtime PASS。

**2026-11-05 E-line 集成：**`#56` Monaco YAML/Python 右键菜单不透明样式、`#57` 只读目录选择与会话句柄保存、`#59` 宽屏 Python 引用面板默认展开均已进入 `main`。三个 PR 的 exact-head CI 各自 PASS；最终 `main@12bf33be` 的 Pages Gate 已独立 PASS；这不替代真实 OS 原生交互验收。#56 的真实桌面菜单目视验收和 #57 的 Windows 原生目录选择/授权/实盘写回均尚未完成；对应 #55、#54、#26 仍开放，不得改称 native PASS。

## Current scope matrix

| Scope | Implementation | Acceptance | Tracking |
|---|---|---|---|
| Theia 工作台第一阶段：默认打开、原生只读 Inspection/Outline/Evidence/Problems、Package Audit、Markdown Preview、布局缓存与计时 | IMPLEMENTED | PASS（416 Unit / 29 Host、local Chrome Theia full smoke）；exact-head CI / resulting-main Pages 见 #93 | [#93](https://github.com/odango-chan/ca-skill-studio-demo/issues/93)、[范围与缺口](architecture/theia-workbench.md) |


| Scope | Design | Implementation | Acceptance | Tracking / evidence |
|---|---|---|---|---|
| D1 视觉 START 起点 / Outcome 连线配色 / 浮动图例 | ACCEPTED | IMPLEMENTED（#62 MERGED） | [PR CI #41997113612 PASS](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41997113612)、[resulting-main Pages #41997707337 PASS](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41997707337)；目视反馈追踪 #65 | [#61](https://github.com/odango-chan/ca-skill-studio-demo/issues/61)、[Workbench](design/authoring-workbench.md) |
| D1-A1 真实 Phase PRE/POST 摘要、当前类型图例、Route 来源 | ACCEPTED（仅 View） | IMPLEMENTED（PR #67 MERGED） | [PR CI #42017654738 PASS](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42017654738)；[resulting-main Pages #42021101176 PASS](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42021101176) | [#65](https://github.com/odango-chan/ca-skill-studio-demo/issues/65)、[Workbench](design/authoring-workbench.md) |
| D1-A2 所有业务节点双击下钻、子流程边界、精确调用位置往返 | ACCEPTED（仅 View） | IMPLEMENTED（PR #68 MERGED） | [PR CI #42024995449 PASS](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42024995449)：390/390 Unit + 17/17 Node Chromium；[resulting-main Pages #42025465770 PASS](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42025465770) | [#65](https://github.com/odango-chan/ca-skill-studio-demo/issues/65)、[PR #68](https://github.com/odango-chan/ca-skill-studio-demo/pull/68) |
| D1-A2b 每个 Node 的真实上一跳 / 内部阶段 / 下一跳（原三栏展示） | ACCEPTED（View） | IMPLEMENTED（PR #69 MERGED） | [PR CI #42029774314 PASS](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42029774314)；[Pages #42141895846 PASS](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42141895846) | [#65](https://github.com/odango-chan/ca-skill-studio-demo/issues/65)、[PR #69](https://github.com/odango-chan/ca-skill-studio-demo/pull/69) |
| D1-A3 Root 路径聚焦（主路径／选择路径／全部路径） | ACCEPTED（仅 View） | IMPLEMENTED（PR #73 MERGED、#75/#77 改进） | [resulting-main Pages #42177776582 PASS](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42177776582)（Root 9 默认 / 全图 17，分支可收起，锚点偏移 0px）；Runtime NOT_RUN | [#72](https://github.com/odango-chan/ca-skill-studio-demo/issues/72)、[PR #73](https://github.com/odango-chan/ca-skill-studio-demo/pull/73)、[Workbench](design/authoring-workbench.md) |
| D1-A2c 每节点真实一跳 React Flow 局部图（替换三栏详情） | ACCEPTED（View-only） | IMPLEMENTED（PR #70 MERGED，#79 移除双击） | [resulting-main Pages #42181238105 PASS](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42181238105)（显式「查看」17/17，局部图、返回、Source 不变） | [#65](https://github.com/odango-chan/ca-skill-studio-demo/issues/65)、[PR #70](https://github.com/odango-chan/ca-skill-studio-demo/pull/70)、[Workbench](design/authoring-workbench.md) |
| D1 Procedure 投影、图形浏览、现有 Route Target Rewire | ACCEPTED | IMPLEMENTED | PASS（本仓浏览器级） | [D1](D1-procedure-designer.md)、[CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41605377069) |
| D2 Node Designer A1–A5 有界创建/删除/重命名/属性 Patch | ACCEPTED | IMPLEMENTED | PASS（本仓单测/浏览器） | [D2](D2-node-designer.md)、[PR #4](https://github.com/odango-chan/ca-skill-studio-demo/pull/4)、[CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41605140297) |
| 固定示例多文件 Source / Markdown/ZIP 编辑与下载 | ACCEPTED | IMPLEMENTED | PASS（本仓测试范围） | `site/sample-packages.mjs`、`tests/package.test.mjs`、[CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41605377069) |
| `establish-pdu-session` 刷新 SKILL.md + `references/` 三份 Markdown | ACCEPTED（Source Snapshot） | IMPLEMENTED（PR #20） | PASS（249 tests + Chromium；PR #20 合入） | [owner@7570b309](https://github.com/odango-chan/ca-agent-demo/tree/eaadf9488ec3b5d6d6f60eb7090a2dee715d440b/skills/establish-pdu-session)、[PR #20](https://github.com/odango-chan/ca-skill-studio-demo/pull/20)、[CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41761998627) |
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
| D4-A3b2b1 无引用命名 Verify 的命名、删除和相邻换序 | ACCEPTED（Editor-tier） | IMPLEMENTED（PR #34） | PASS（289 tests + Chromium；集成提交） | [PR #34](https://github.com/odango-chan/ca-skill-studio-demo/pull/34)、[CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41786616595)、[设计](design/phase-designer.md) |
| D4-A3b2b2a 命名 Step 删除/换序影响门禁（只读） | ACCEPTED（Read-only editor tier） | IMPLEMENTED（PR #36） | PASS（298 tests + real Chromium；集成代码） | [PR #36](https://github.com/odango-chan/ca-skill-studio-demo/pull/36)、[CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41788514319)、[设计](design/phase-designer.md) |
| D4-A4a 现有 Phase 失败 Route 的已观察目标重定向 | ACCEPTED（Editor-tier） | IMPLEMENTED（PR #37） | PASS（305 tests + real Chromium；集成候选） | [PR #37](https://github.com/odango-chan/ca-skill-studio-demo/pull/37)、[CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41791294195)、[设计](design/phase-designer.md) |
| D4-A4b1 Phase Outcome 缺失修复、非核心拼写修正与受限删除 | ACCEPTED（Editor-tier） | IMPLEMENTED（PR #39） | PASS（315 tests + real Chromium；代码提交） | [PR #39](https://github.com/odango-chan/ca-skill-studio-demo/pull/39)、[CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41793627245)、[设计](design/phase-designer.md) |
| E1 Monaco Source Editor 接入最新 D4 主分支 | ACCEPTED（Editor-tier） | IMPLEMENTED（main@a5db46ee；PR #40 MERGED） | PASS（322/322 + real Chromium + resulting-main Pages） | [PR #40](https://github.com/odango-chan/ca-skill-studio-demo/pull/40)、[最终 PR CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41796985366)、[main Pages](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41797402343)、[设计](design/source-editor-workstream.md) |
| E2-A1/A2 YAML 1.2 语法诊断 / 离线 Owner Schema 智能提示 | ACCEPTED（Editor-tier） | IMPLEMENTED（main@9708528f；PR #42 MERGED） | PASS（328/328 + TypeScript + Build + real completion/hover Chromium + resulting-main Pages） | [PR #42](https://github.com/odango-chan/ca-skill-studio-demo/pull/42)、[最终 PR CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41803566642)、[main Pages](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41804005500)、[#24](https://github.com/odango-chan/ca-skill-studio-demo/issues/24) |
| E3-A1 Python Script caller/Schema 来源导航（只读） | ACCEPTED（Editor-tier） | IMPLEMENTED（main@fc6c42a；PR #45 MERGED） | PASS（333/333 + Chromium + resulting-main Pages） | [PR #45](https://github.com/odango-chan/ca-skill-studio-demo/pull/45)、[exact-head CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41807700051)、[main Pages](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41811535041)、[#25](https://github.com/odango-chan/ca-skill-studio-demo/issues/25) |
| E3-A2 Python 顶层 class/def/async def 符号导航（只读） | ACCEPTED（Editor-tier） | IMPLEMENTED（main@4e88e0a；PR #46 MERGED） | PASS（338/338 + Chromium + resulting-main Pages） | [PR #46](https://github.com/odango-chan/ca-skill-studio-demo/pull/46)、[rebased exact-head CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41811806093)、[main Pages](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41812070377)、[#25](https://github.com/odango-chan/ca-skill-studio-demo/issues/25) |
| D4-A2.2b2/A3b2b2b/A4b2 跨生产者写入 / 带副作用或输出依赖 Step 的写入 / 新 Phase on-map 与 owner Outcome 契约 | PROPOSED | NOT_STARTED | NOT_RUN | [#15](https://github.com/odango-chan/ca-skill-studio-demo/issues/15)、[设计](design/phase-designer.md) |
| E4-A1 浏览器所选目录导入、未知文件保留与 ZIP 导出 | ACCEPTED（Editor-tier） | IMPLEMENTED（main@3433e99；PR #48 MERGED） | PASS（345/345 + Chromium FileList UI + resulting-main Pages） | [PR #48](https://github.com/odango-chan/ca-skill-studio-demo/pull/48)、[CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41948794306)、[Pages](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41949134436)、[#26](https://github.com/odango-chan/ca-skill-studio-demo/issues/26) |
| E4-A2 重选目录写入（非原路径证明 / 全目录冲突 / 部分保存报告） | ACCEPTED（Demo best-effort） | IMPLEMENTED（main@ef8eae87；PR #50 MERGED） | PASS（365/365 + Chromium OPFS + Windows fixture 3/3 + resulting-main Pages）；原生 Chrome picker NOT_RUN | [PR #50](https://github.com/odango-chan/ca-skill-studio-demo/pull/50)、[CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41963816684)、[Windows](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41963816623)、[Pages](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41964699713)、[#26](https://github.com/odango-chan/ca-skill-studio-demo/issues/26) |
| E1 Monaco 浅色右键菜单不透明背景 | ACCEPTED | IMPLEMENTED（#56 MERGED） | PR exact-head CI PASS（374/374 + Chromium computed-style fallback）；真实桌面右键浮层待目视验收 | [#56](https://github.com/odango-chan/ca-skill-studio-demo/pull/56)、[CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41990206833)、[#55](https://github.com/odango-chan/ca-skill-studio-demo/issues/55) |
| E3 Python 引用面板宽屏默认展开、手动收起与窄屏行为 | ACCEPTED | IMPLEMENTED（#59 MERGED） | PR exact-head CI PASS（374/374 + Chromium）；resulting-main Pages PASS（#41994191657） | [#59](https://github.com/odango-chan/ca-skill-studio-demo/pull/59)、[CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41993061908)、[#58](https://github.com/odango-chan/ca-skill-studio-demo/issues/58) |
| E4-A3 只读目录选择、会话句柄延迟读写权限及 Explorer 状态提示 | ACCEPTED（Demo best-effort） | IMPLEMENTED（#57 MERGED） | PR exact-head CI PASS（378/378 + Chromium mocked picker / OPFS）；原生 Windows Chrome 仍 NOT_RUN | [#57](https://github.com/odango-chan/ca-skill-studio-demo/pull/57)、[CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41990023283)、[#54](https://github.com/odango-chan/ca-skill-studio-demo/issues/54)、[#26](https://github.com/odango-chan/ca-skill-studio-demo/issues/26) |
| 上游 SKILL 示例同步到 ca-agent-demo@eaadf948（16 文件） | ACCEPTED（Source Snapshot） | IMPLEMENTED（main@4d48d37e；PR #51 MERGED） | PASS（16/16 Owner blobs + 369/369 单测 + Chromium + resulting-main Pages） | [PR #51](https://github.com/odango-chan/ca-skill-studio-demo/pull/51)、[CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41978928033)、[Pages](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41979268876) |
| 正式 Runtime Qualification、Case、5GC、发布工作台 | PROPOSED（明确后置） | NOT_STARTED | NOT_RUN | — |


唯一公开示例名称与 owner 的 SKILL 目录 `establish-pdu-session` 完全一致；Ensure Package 已从选择器、清单和发布资源中移除。旧 Ensure Package 原文与独立 Procedure YAML 仅保留在源码中给单测/浏览器回归使用，发布到 Pages 的 `dist/` 仅包含 `establish-pdu-session` Package。`references/` 在 Explorer 默认展开。[PR #21 CI](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41766617644) 已验证单测、TypeScript、构建和真实 Chromium 交互 PASS；[main Pages #41771402007](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41771402007) 已在 `f93f1e3f`（重跑 attempt 2）完成静态资产检查、Chromium 和 Pages 部署 PASS。

## Current open work

- **合并后 Pages 验收：**`main@12bf33be` 的 [Pages #41994191657](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41994191657) 已 **PASS**（build + deploy success）。#58 的宽屏 Inspector 集成已满足本仓自动验收；#54/#55 保留用户现场验收，#26 保留真实 Windows 文件权限验收。


- [#26](https://github.com/odango-chan/ca-skill-studio-demo/issues/26)：E4-A1/A2 均已合入并部署。`npm run test:e4:native` 的随机临时目录与 Windows 文件系统专项已通过，但原生 Chrome 文件选择、授权及真实 OS 句柄写入现场仍 NOT_RUN；保留为 Demo 风险记录。

- [#25](https://github.com/odango-chan/ca-skill-studio-demo/issues/25)：E3-A1/A2 已合入且部署；Python 语言服务（例如浏览器内 Pyright）仍仅候选，尚无真实语义诊断、类型检查或脚本执行。E4 目录读写仍独立推进。

- **Skill Language Core / Browser LSP（未合并草稿栈）：** [#103 L1 Core](https://github.com/odango-chan/ca-skill-studio-demo/pull/103) 与 [#105 L2-A](https://github.com/odango-chan/ca-skill-studio-demo/pull/105) 的精确 HEAD CI PASS；[#109 L2-B](https://github.com/odango-chan/ca-skill-studio-demo/pull/109) 的 IDE Host、Theia Browser Host、Browser-Only 和回归四项门禁 PASS；[#110 L2-C](https://github.com/odango-chan/ca-skill-studio-demo/pull/110) 四项门禁 PASS。L2-B/C 仍为 Draft、未合入、未部署。Browser Worker 只在 Theia Browser-Only / Pages host 验收；backend-backed Theia 继续使用 Node extension-host 路径，不应错误要求 Browser Worker READY。当前 [L2-D1 PR #113](https://github.com/odango-chan/ca-skill-studio-demo/pull/113) 已在 exact HEAD `de8f6d3973ae2fb181015a5a09b188eef5243f50` 完成真实 Theia 原生 Provider 验收：Definition / Hover / References / Python Document Symbols / Schema Completion 五项 PASS；IDE Host、backend Theia、Browser-Only Chromium、通用回归四项 CI 均 PASS。原有 Procedure CustomEditor、Inspector 编辑、Undo 与 Route 写入回归也 PASS。PR 仍为 Draft、未合入、未部署。当前 [L2-D2 PR #115](https://github.com/odango-chan/ca-skill-studio-demo/pull/115) 正在实现原生 Problems 诊断出现、修复后清除及 Package generation 级验收；尚未宣称 PASS。

- [#7](https://github.com/odango-chan/ca-skill-studio-demo/issues/7)：D3 有界 operator.on Route 编辑已合入；Runtime Outcome 资格和 Phase-specific Route 仍未覆盖。
- [#15](https://github.com/odango-chan/ca-skill-studio-demo/issues/15)：D4 Phase Designer；A1/A2.1/A2.2a 已合入，A2.2b1 只读脚本消费字段对照已合入；A3a 仅允许相邻无名无绑定单行 Verify 换序（首轮 CI 与浏览器 PASS）；A2.2b2、A3b2b2b 具副作用或带引用 Step 的写入与 A4b1 仅提供已有 Phase on-map 的受限 Outcome 修复（本仓编辑器级验收通过）；A4b2 新 Phase on-map 及 owner Outcome 完整性验证仍未开始；A4a 仅实现已存在失败分支目标的同 Phase/同 Outcome 观察值重定向（本仓编辑器级验收通过）；A3b2b2a 仅提供已验收的执行/引用风险只读审查；A3b2b1 仅允许无输出引用的纯 Verify 命名/删除/相邻换序（本仓编辑器级验收通过）；A3b2a 先审查命名输出引用并受限改名，不能据此宣称 Runtime 兼容。
- 早期未合并 [PR #1](https://github.com/odango-chan/ca-skill-studio-demo/pull/1)、[#2](https://github.com/odango-chan/ca-skill-studio-demo/pull/2)、[#3](https://github.com/odango-chan/ca-skill-studio-demo/pull/3) 目前只作为历史候选，**不推断可直接合并**。

## Authority / evidence

- [TRACEABILITY](TRACEABILITY.md)：当前范围→实现/测试→稳定证据。
- [文档基线主分支 Pages 成功记录](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41612728393)：仅为本仓浏览器静态站部署。
- Studio 唯一可选择且默认打开的 Package `establish-pdu-session`，其运行时相关 16 文件来自 [ca-agent-demo@eaadf948](https://github.com/odango-chan/ca-agent-demo/tree/eaadf9488ec3b5d6d6f60eb7090a2dee715d440b/skills/establish-pdu-session)。`references/3gpp-procedure.md`、`references/session-selection.md`、`references/failure-handling.md` 为可选业务参考材料；Studio 可浏览/编辑/导出，不表示已实现 Host `read_reference` 工具。`cases/` 和内部 `design/` 未纳入此编辑示例。Host/Runtime 可执行性仍由真正 owner 的 Schema/Validator/执行事实决定。

## IDE preview integration follow-up (2026-11-09)

- The continuing online IDE preview is based on `spike/ide-extension-theia-host` / PR #86; `main` remains the stable published baseline and is not changed by this integration.
- The branch inherits the already-merged Root path-focus work: default proven success path, selectable/complete path modes, per-card `+N 条` expand / `收起`, explicit `查看`, and anchor-preserving expand/collapse (#73/#75/#77).
- Added the view-only dashed boundary grouping the current Node's PRE/OP/POST stages, adapted from #71. It adds no business Node, Route, Source mutation or Runtime meaning. Exact-head verification is pending.


## 2026-11-09 · Theia becomes the default online host; Classic is retained

**Decision:** GitHub Pages root `/` now targets Theia browser-only 1.76 with
the SKILL Studio Web extension bundled at build time. The previous complete
browser Studio is preserved at `/classic/`; the old `/ide-preview/` path
redirects to the new root. The Pages workflow builds the old Studio from the
main-source checkout, builds Theia from the current ref, verifies the root
subpath, and composes one artifact. PR #86 was merged by Squash Merge at `main@b2f4e991`; the same workflow
now runs from `main` on every normal deployment.

**This is not feature parity.** PR #89 has migrated the read-only Node Focus view
(previous/current/next, PRE/OP/POST, Source line reveal) into the IDE-host
CustomEditor. Route creation/reconnect, Phase Designer, full Inspector,
Package Audit and Markdown preview remain Classic-only and must be migrated
explicitly before Classic is retired. Do not treat a successful shell build
as proof that all old features were carried over.

**Security / persistence boundary:** the GitHub Pages Theia build uses a
same-origin Webview adapter and displays a persistent warning. It is for
public/sample workspaces only; do not open sensitive or untrusted files.
Browser OPFS is local to the current browser profile, not native disk access
or GitHub synchronization. No Python, SKILL Runtime or 5GC execution is
provided by this static host.

**Preservation:** `backup/main-before-theia-default-2026-11-09` points to the
exact previous main SHA `dcb137d606e6a697fcf02f7d7c5a811f7921e0f5`.

**Current migration evidence:** prior exact-head real Chromium run
[#42575346100](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42575346100)
passed the browser-only Theia shell, sample import, Procedure CustomEditor,
guarded Patch, Source editor and Undo at the former `/ide-preview/` path.
The resulting-main default-root smoke, release composition test and Pages
deployment passed again after the Node Focus migration in [workflow #42585232727](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42585232727)
at `main@b9c1c38`. Theia is the durable default Pages host; the previous
main browser application remains available at `/classic/`.


## 2026-11-09 · Theia Node Focus migration (PR #89)

**Scope:** Reused the existing Source-backed one-hop Node Focus projection inside the IDE-host CustomEditor. The view shows authentic previous/next Nodes, the selected Node's PRE/OP/POST stages, original Route identities and a read-only current-Node boundary. Clicking a Phase Step opens the same native Source TextDocument at its validated line; returning to the full graph does not edit YAML.

**Architecture:** No second business projection, no new Procedure Route and no Runtime meaning for view-only phase-order links. The host validates 1-based line bounds and owns the editor selection/reveal. Only four IDE-host files changed; shared theme/package files were untouched.

**Evidence:** [PR #89](https://github.com/odango-chan/ca-skill-studio-demo/pull/89) merged at `main@b9c1c38`. Exact merged-base checks: [IDE Host #42584800417 PASS](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42584800417), [Theia browser-only #42584800342 PASS](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42584800342), [Theia backend Chromium #42584800599 PASS](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42584800599). Resulting-main Pages [#42585232727 PASS](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42585232727). Route create/reconnect, Phase Designer, full Inspector, Package Audit and Markdown preview remain outstanding.


## 2026-11-10 · Theia Inspector Node authoring（首批增量，已合入 main）

**范围：** 在原生 Inspection / Inspector Node 项上增加「重命名 Node」与「编辑 Operator 值」上下文操作。复用 `site/node-designer.mjs` 的完整 Node 引用重命名 Patch，以及 `site/node-attributes.mjs` 的 Operator 值选择/校验；Theia Host 只负责当前 TextDocument 版本、Package PredicateSet 读取、Diff 确认与原生 WorkspaceEdit。

**安全边界：** 预览后必须显式确认；确认期间 Source 版本或文档身份变化则拒绝；宿主重新计算 Patch 并核对精确 source spans；不允许 Operator kind 转换，不安全/不支持的节点继续 Source-only。Classic 不删除、不降级。

**未包含：** Node 插入/删除、Phase Step 编辑、Binding 编辑、Root 路径筛选、Runtime / 5GC。该增量由 [PR #96](https://github.com/odango-chan/ca-skill-studio-demo/pull/96) 跟踪；IDE Host、Theia backend Chromium、Theia browser-only 和 Inspector Undo 真实 Chromium 均在 exact head `6ed046b` PASS。已合入 `main`，merge commit `dbcbf387`；合入后的 Pages 将在本轮链式 PR 收尾后做最终验收。


## 2026-11-10 · Theia Phase Input Binding authoring（D4-A1 首个增量，已合入 main）

**范围：** 在原生 Inspector 的 Phase Step 行增加「Edit Phase Input Binding」上下文操作。仅允许将既有 `with.<key>.from` 从当前输入改绑到同一 Procedure 中、声明类型相同的另一个 `input.*`。复用 `site/phase-bindings.mjs` 的候选集、资格判定、精确 Source span、图语义不变量和不可伪造 Preview；Theia 只负责版本校验、显式 Diff 确认与原生 WorkspaceEdit / Undo。

**拒绝边界：** 不新增/删除 Phase 或 Step，不改 Operator，不绑定 output producer、不跨 Procedure、不猜 Runtime 参数兼容性；引号、别名、锚点和非 plain scalar 继续拒绝。没有同类型替代输入的 Step 不显示编辑动作。Classic 保持完整。

**验收：** [PR #97](https://github.com/odango-chan/ca-skill-studio-demo/pull/97) exact head `b6a80ab` 的 IDE Host、Theia backend Chromium、browser-only Chromium 与 PR Verify 均 PASS；两种真实 Chromium 模式均验证 Source v10 → v11 → v12（编辑后原生 Undo）。已合入 `main`，merge commit `5ddd2759`；Runtime / 5GC / desktop VS Code GUI NOT_RUN。


## 2026-11-10 · Theia Node insert/delete authoring（首个受限增量，PR #98 已合入 main）

**范围：** 在原生 Inspector 的 Route 行增加「Insert Node on Route」，在符合安全删除条件的 Node 行增加「Delete Node」。复用 Classic 的 `site/node-create.mjs` / `site/node-delete.mjs`，不复制 Route/Node 语义。

**插入边界：** 只允许在现有且 Source span 可 Patch 的 Route 上插入；原 Route 改指向新 Node，Call / Verify 新 Node 通过显式 Outcome 回到原目标；Terminal 只能使用同 Procedure 已存在的 Terminal 状态；Verify Predicate 必须来自当前 Package PredicateSet。Theia 通过一个包含零宽插入 span 和 Route target span 的原生 WorkspaceEdit 原子提交。

**删除边界：** 仅开放两种已有 Classic profile：同状态 Terminal 合并到另一个 Terminal；或无 Phase/Child、恰有一个 Operator 出口的 Node bypass 到唯一出口目标。删除前由共享模块检查全部入站 Route 与其他引用；所有删除/重定向 spans 通过一次 WorkspaceEdit 提交。Start、Phase-bearing、Child Procedure、多出口及存在外部引用的 Node 不显示删除操作。

**安全与验收：** 所有操作均要求当前 TextDocument revision、精确 Diff、用户显式确认、宿主重算 Patch 与原生 Undo。Host 测试覆盖取消、过期选择、两 span 原子编辑及不可删除 Node；真实 Chromium 验收覆盖插入、删除、Route 修复和两次 Undo。PR #98 exact head `93a80fb` 的 IDE Host、Theia Browser-Only、Theia Browser Host、PR Verify 均 PASS；Browser Host 首次运行在既有 Package Audit 等待点偶发超时，failed-job rerun attempt 2 PASS；已合入 `main`，merge commit `27502c57`。Runtime / 5GC / desktop VS Code GUI NOT_RUN。Classic 保持完整。


## 2026-11-10 · Theia Phase Verify authoring（PR #99，受限增量，已合入 main）

**范围：** 在原生 Inspector 的 Phase 行支持向既有 Phase 尾部追加 Package PredicateSet 中已声明且未重复的无名 Verify；在符合 Source span 安全条件的无名 Verify Step 上支持删除或只与相邻独立 Verify 换序。受限的「编辑能力」不表示已完成全部 Phase Designer 或生产 Runtime 语义验收。

**实现边界：** 直接复用 `site/phase-step-structural.mjs` 与 `site/phase-step-order.mjs` 的候选、Source patch 和重算资格；Theia 宿主仅维护 TextDocument revision、跨文件 PredicateSet 读取、精确 Diff/用户确认、一组原生 WorkspaceEdit 和 Undo。保留注释或命名输出来源归属不可证的情况，原生 Inspector 不提供修改动作；已有 Classic /classic/ 保持不变。

**证据：** [PR #99](https://github.com/odango-chan/ca-skill-studio-demo/pull/99) 的代码验收提交 `9b79517` 在真实 Theia Chromium 完成 Verify 新增 v12→v13→Undo v14、删除 v14→v15→Undo v16、换序 v16→v17→Undo v18。文档刷新后的 exact head `0281894` 四组门禁均 PASS：[IDE Host](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42745664432)、[Theia Browser-Only](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42745664161)、[Theia Browser Host Chromium](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42745664398)、[PR Verify](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42745664136)。PR #99 已合入 `main`，merge commit `1ac11d6c`；resulting-main Pages [#42746670113 PASS](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42746670113)；发布源码身份为 `main@5a5cb981`，Theia 默认入口真实 Chromium 验收及 Pages Deploy 均 PASS。Runtime / 5GC / desktop VS Code GUI NOT_RUN。


## 2026-11-10 · Theia 画布工具栏与 Root 路径筛选恢复（PR #106，已合入 main）

**范围：** 新版 Theia CustomEditor 恢复 Classic 画布上方的整行工具栏：默认垂直 / 可切水平、放大缩小、适配整图 / 横向铺满 / 纵向铺满、邻居视图、Route 标签和定位当前节点。Root Procedure 另恢复主路径、选择路径、全部路径，以及失败 / 未决 / 恢复分支筛选；节点上的 `+N 条 / 收起` 支持逐节点展开并保持锚点。

**实现边界：** 不另造图模型。复用 `site/path-focus.mjs`、`site/layout.mjs`、`layoutProcedureELK`、共享 React Flow Canvas 的 `fitAxis` / `captureNodeAnchor` / `restoreNodeAnchor`。布局方向、路径模式和展开集合进入视图缓存键；Child Procedure 不显示 Root 专属筛选。所有按钮只影响视图，不改 YAML、不授予 Runtime / 5GC 权限。

**验收：** [PR #106](https://github.com/odango-chan/ca-skill-studio-demo/pull/106) 已合并，merge commit `5dfa50e0e39e43087f01e1d5fee9ada1e6ce7d63`。exact-head `36a252319281e7c0829100a07455b56af6236176` 三组门禁全部 PASS：[IDE Host #42752173199](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42752173199)、[Theia Browser-Only #42752173510](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42752173510)、[Theia Browser Host / real Chromium #42752173208](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42752173208)。真实 Chromium 记录默认主路径 9 Nodes / 8 visible edges、水平 9/9、恢复垂直、全部路径 17 Nodes / 46 edges；Source、Inspector、Node Focus、Route create/reconnect 与 native Undo 回归通过。resulting-main Pages 对新 merge SHA 的部署仍需单独确认；Runtime / 5GC / desktop VS Code GUI NOT_RUN。

## 2026-11-10 · Theia named Phase Step / Verify authoring（PR #108，已合入 main）

**范围：** 原生 Inspector 迁移命名 Phase Step 原子重命名，以及普通 / 命名 Verify 的安全生命周期操作。命名 Step 重命名只在同 Procedure 的完整 `from` 引用闭包可证明时开放；身份与所有已证明引用通过一个 WorkspaceEdit 同步更新。普通 Verify 仅在 Source 邻接行归属明确时可命名；命名 Verify 仅在零消费者证明成立时可删除，换序复用相邻独立 Verify 的共享规则。

**边界：** 不重写 DSL、不复制 Classic 语义、不开放跨 Producer ABI 写入、不改变 Runtime 行为。保留 Phase Input Binding 的原生菜单入口；不安全或存在未知引用的 Step 不出现相应修改动作。

**验收：** [PR #108](https://github.com/odango-chan/ca-skill-studio-demo/pull/108) 已合并，merge commit `a08041446dd79c9cd8e143f682144cf037f1569b`。exact-head `0dbd9125a68e20ebedb5781ed6bc58c3089f1907` 的 IDE Host、Theia Browser-Only、Theia Browser Host / real Chromium 三组门禁全部 PASS；真实 Chromium 验证命名 Step 引用重命名及原生 Undo、Verify 命名及原生 Undo；Host 验证命名 Verify 安全删除。Runtime / 5GC / desktop VS Code GUI NOT_RUN。


## 2026-11-10 · Theia Inspector Producer / Consumer Evidence（PR #111，已合入 main）

**范围：** 原生 Evidence 树复用 Classic 的 `phase-dataflow.mjs`、`phase-consumer-contract.mjs` 与 `phase-evidence-copy.mjs`，显示选中 Node 的 Phase 输入来源、Producer 输出 Schema 证据、Consumer 输入字段/类型证据，以及每条绑定的未知原因和边界。Phase Step 行同时显示简短证据摘要。

**数据与失效：** Evidence 使用 Package Audit 已读取的有界文件快照（最多 500 文件 / 4 MiB）；Procedure 或 Package 文件变更后立即失效旧快照，重新审计完成前只显示无 schema 的 Source 证据。不会把缺文件、未知类型或 TYPE_ONLY_MATCH 升级成 ABI PASS。

**安全边界：** 这是只读证据，不授权任何 binding / Producer / Consumer 写入；`authorizedWrites` 固定为 0，Runtime 仍为 NOT_RUN。跨 Producer ABI 写入、effectful Step 结构变更与 owner Outcome 合约仍需单独定义和审查。

**验收：** PR #111 exact HEAD `00877a0414674e4e5b8e056787b56e3d3fa5228e` 的四组门禁全部 PASS：IDE Host [#42762425857](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42762425857)、Theia Browser-Only [#42762425856](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42762425856)、Theia Browser Host / real Chromium [#42762425883](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42762425883)、PR Verify [#42762426052](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42762426052)。PR #111 已合入 `main`，merge commit `50eb16d5`；resulting-main Pages 需按该精确 merge SHA 单独核对。Runtime / 5GC / desktop VS Code GUI NOT_RUN。

## 2026-11-10 · Theia Package ZIP export（PR #114，已合入 main）

**范围：** 在原生 Procedure CustomEditor 增加「导出 Package ZIP」，只读取当前 Procedure 所属 Package。复用 Classic 的 `directory-import.mjs` / `zip.mjs` 校验和 ZIP 写入逻辑；使用 Theia 原生 Workspace FileSystem API 读取文件快照，将已打开 TextDocument 的未保存文本覆盖到快照，并原样保留未修改文本字节（含 BOM）及不透明二进制资源。

**一致性与安全：** 限制为最多 64 个文件、8 MiB 总量、1 MiB 单文件；校验安全相对路径、大小写冲突、单一 Package 根和根 `SKILL.md`。生成前后复核文件集合、文件字节和已打开文档版本/内容；发现并发修改则拒绝并要求重试。宿主不写入或覆盖工作区文件；用户需要在画布上再点击一次「下载 ZIP」才触发浏览器 Blob 下载。

**边界：** 这是 ZIP **导出**，Classic 当前没有 ZIP importer，因此不新增或声称已有 ZIP 导入对等功能。OPFS 不是本地磁盘挂载或 Git 同步；不涉及 Runtime / 5GC。

**验收：** PR #114 exact HEAD `851d327fd8eb48f34d2e3d616c51f320c11a29bd` 四组门禁全部 PASS：IDE Host [#42769069009](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42769069009)、Theia Browser-Only [#42769069011](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42769069011)、PR Verify [#42769069003](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42769069003)、Theia Backend real Chromium [#42769069069](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42769069069)。已合入 main，merge commit `1401530b`。Resulting-main Pages [#42770237030 PASS](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42770237030)，exact identity 为 source/classic/workflow SHA 全部 `1401530befab33704a60a3b3799b7c5047b21f53`，Theia 为默认根入口，Classic 保留 `/classic/`。

## 2026-11-10 · Theia Inspector D4-A2.1 Output Reference normalization（PR #116 MERGED）

**范围：** 将 Classic 已有 `site/phase-output-refs.mjs` 接入 Theia 原生 Inspector。对可证明的同一生产 Node / Phase / 唯一 earlier named Step / output suffix，只提供 local 与 fully-qualified 两种已在同一 Procedure Source 中实际出现的写法互换。Eligible Phase Step 下显示独立的 `Output reference · <bindingKey>` 子行，右键提供规范化操作；不把跨 Node 引用误判成同生产者。

**写入路径：** Theia 只负责 TreeItem/command、当前 TextDocument revision 检查、QuickPick、Diff/显式确认和原生 WorkspaceEdit；候选发现、身份判定、Source scalar span、候选重算和 forged/stale Preview 拒绝全部复用 Classic 模块。Undo 由 Theia 原生编辑历史负责。当前公开示例的 AMF 节点拥有可重验的同生产 Step local/qualified 引用对（delivery-context Verify 的 operationContextRef），真实 Chromium 直接对该示例执行原生 WorkspaceEdit、Undo、再次编辑和再次 Undo；host 测试另外覆盖仓内 pinned predecessor fixture。PCF baseline Verify 虽曾观察到两种写法，但替换最后一处 local 会使 Classic Preview 失去双写法证明，Theia Inspector 需隐藏该不可执行入口。既不需要整份替换 Source，也不会为了演示改变原始 SKILL 资产。

**边界：** 这是引用写法规范化，不证明 Runtime 能解析别名，不证明 output field schema/type，不授权跨生产者 ABI 写入，也不改变 Procedure/Route 语义。Runtime / 5GC NOT_RUN。

**验收状态：** [PR #116](https://github.com/odango-chan/ca-skill-studio-demo/pull/116) 已合并，main merge `330c9b80`。Exact-head `c5153a8e` IDE Host [#42776798637 PASS](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42776798637)、Browser-Only [#42776798442 PASS](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42776798442)、Backend Chromium [#42776798608 PASS](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42776798608)、PR Verify [#42776798584 PASS](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42776798584)。Resulting-main Pages [#42777288099 PASS](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42777288099)，精确 source/classic/workflow SHA 为 `330c9b8058452f6b1de1b25f990c6a0bca036fd4`；Runtime/5GC/桌面 GUI NOT_RUN。


## 2026-11-10 · Theia D4-A4a Phase Route 目标重定向（PR #118 MERGED）

**范围：** 仅迁移 Classic 已验收 `site/phase-routes.mjs` 的现有 Phase 失败/未决 Route 目标编辑，不新定义 YAML/业务规则。Inspector Route 行仅在共享模块证明同 Procedure、同 Phase、同 Outcome 的候选及保留可达 Node 集时提供原生命令；保留现有 Insert Node 命令并支持双菜单共存。

**写入与验证：** 文档和 Source 版本校验 → QuickPick → Classic Source Preview / Diff → 用户确认 → 原生 `WorkspaceEdit`/Undo。Host 测试覆盖取消、应用、过期 Route；真实 Chromium 针对 UDM `preconditions.on.FAILED: failed` → 已观测的 `finalize-failed` 并 Undo 原文。PR #118 merge `31987e41`；exact-head `5dc55f0a` 四组 CI 全部 PASS：IDE Host [#42778316708](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42778316708)、Browser-Only [#42778316442](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42778316442)、Backend Chromium [#42778316448](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42778316448)、PR Verify 重跑 [#42778316986](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42778316986)。

**边界：** 仅前置 `FAILED/UNRESOLVED`、后置 `FAIL/UNKNOWN` 已有 Route；没有创建 Phase/Outcome、修改 `operator.on` / `PASS` 或跨 Producer ABI。失败收尾路径的业务等价性及 Runtime/5GC NOT_RUN。


## 2026-11-10 · Theia D4-A4b1 已有 Phase Outcome 修复（PR #119 MERGED）

**迁移范围：** 完全复用 Classic `site/phase-outcomes.mjs`，只操作已有 Phase 的字面 `'on'` map；共享资格允许三种 Source 修复：从同 Procedure/同 Phase/同 Outcome 已观察值补齐缺失核心 Outcome；把可唯一证明的非核心拼写纠正成缺失核心键；当核心键齐全且无其他引用时删除孤立非核心键。正常完整 Phase 不出现编辑入口。

**原生交互：** Inspector Phase 下有资格才显示 `Outcome repair` 子行；原生 QuickPick 显示可证明的操作；重查最新 TextDocument/完整 Source/候选资格，显示 Diff 并要求明确确认，然后仅用原生 WorkspaceEdit 写精确 Source span、支持 Undo。Host 验证三操作、取消/过期/虚构候选；Chromium 在真实 Monaco 中制造单行拼写错误、通过原生命令修复、对修复操作执行原生 Undo，然后精确恢复测试样本；不假设键盘编辑的 Undo 分组。PR #119 已合入 main，merge `a19f9886`，exact-head `5ade768c` 四组 PASS：IDE Host [#42783478978](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42783478978)、Browser-Only Chromium [#42783479017](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42783479017)、Backend Chromium [#42783478968](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42783478968)、PR Verify [#42783479057](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42783479057)。合并后的 Pages SHA 仍需独立核对。

**不授权：** 新建 Phase/on map、任意 Outcome 字典、Runtime 失败处理等价性、跨生产者 ABI 和真实 5GC，均保持 NOT_RUN / Source-only 边界。


- **LSP stack refresh (2026-11-10):** #103 / #105 / #109 / #110 / #113 now include the current `main` workbench changes, including the canvas toolbar. All remain Draft; prior PASS results are historical until the refreshed exact heads complete CI. No merge or Pages deployment.
