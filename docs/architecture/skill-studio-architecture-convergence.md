# SKILL Studio 架构审视与后续收敛方案

**状态：PROPOSED（架构方向建议；不是当前实现规范，也不授权立即重构）**  
**审计基线：main@aca226943807cd841a70321d3a2e388384ea9c52（2026-11-10）**  
**适用范围：ca-skill-studio-demo**

> 本文先冻结方向、边界和后续顺序。当前 Theia 功能迁移、LSP 和多文件 Designer 工作尚在并行推进；在这些工作达到稳定门槛前，不开展本文所述的跨模块架构收敛，不为追求目录整洁而打断现有 PR。

## 1. 执行摘要

SKILL Studio 的产品定位应从“以 Procedure 流程图为中心的编辑 Demo”演进为：

**Source-first、Package-aware、multi-view 的 SKILL IDE。**

它管理和编辑一个 SKILL Package 的真实文件；根据文件种类提供合适的编辑和可视化视图；为用户提供统一的导航、分析、问题定位和安全修改体验。它不拥有 SKILL DSL、Tool/Capability 资格、Runtime 执行结果或 5GC 业务语义。

建议长期收敛为五个核心原则：

1. **一个 Source / Package 工作副本。** 原始文件是唯一可写业务真源；所有视图都从当前文档和当前 Package 派生。
2. **一个共享分析内核。** YAML 解析、文件/符号/引用索引、编辑期诊断和只读投影事实不能在 Classic、Theia、LSP 和各 Designer 中各自发展成第二套语义。
3. **多个文件类型视图。** Procedure 用图，Contract 用结构化摘要，Predicate 用关系视图，Schema 用字段树，Markdown 用预览；不能把所有文件强行变成流程图。
4. **一个受控 Source 修改通道。** Designer 只能提出有界、可复算的 Patch；Host 核对当前 Source、版本和精确范围，展示 Diff 并取得用户确认，再通过原生编辑 API 应用，以保留 Undo/Redo。
5. **多个 Host，共用编辑能力。** Theia 是当前在线宿主；VS Code Desktop 是目标兼容宿主；Host 差异留在 Adapter，不渗入 Package、分析和 Designer 业务逻辑。

这不是一次推倒重写。当前 Procedure、Phase、Route、Inspector、Source 编辑和浏览器验收中已有大量值得保留的实现。收敛的目标是减少重复的所有权和依赖，而不是为了抽象而重写已经通过验收的功能。

## 2. 审计范围与当前基线

### 2.1 已核实的仓库状态

本轮初始架构审计按 main@aca2269 审查了目录、关键源码、设计文档和开放 PR；技术栈与类型覆盖复核更新至 main@a5395e4。主要事实如下：

| 项目 | 当前状态（审计基线） |
|---|---|
| 在线宿主 | GitHub Pages 根入口使用 Theia Browser-only 1.76 |
| Classic | 完整旧版仍保留在 /classic/，是功能对照和回归资产，不是当前默认入口 |
| Procedure Designer | Theia 已有 Procedure Custom Editor、Node Focus、原生 Inspector、部分 Node / Phase / Route 有界编辑 |
| Source 编辑 | Theia 使用原生编辑器；Classic 保留 Monaco 编辑器及原有工作副本 |
| Package 功能 | Explorer、Package Audit、Outline、Evidence、Problems、Markdown Preview、ZIP 导出等已有实现 |
| Language Core / LSP | 共享 TypeScript Core 和浏览器 Worker LSP 仍在独立 PR 链中，尚不能视为 main 已具备的统一服务 |
| 多文件 Designer | PR #122 的独立分支已包含 Contract / Predicate 只读可视化候选与 Theia 编辑器注册；未合并 main，不代表 Pages 已部署 |
| 本地桌面宿主 | VS Code 扩展兼容路线已存在；真实桌面 VS Code GUI 和本地 OS 文件授权仍需单独验收 |
| Runtime / Run | Studio 不拥有 Runtime，也不提供真实 SKILL / Python / 5GC 执行 |

审计时开放工作主要包括：

- Theia parity：Issue #95 仍跟踪剩余 Inspector / Phase Designer 能力；PR #121 已在 main@aca2269 合并，校正了 #119 合并后的文档和证据。
- Language Service：Issue #100；PR #101（L0 设计）、#103（TypeScript Core）及 #105、#109、#110、#113、#115、#117、#120、#123 等分层 PR 仍在推进。
- Multi-file Designer：PR #122 已从 C0 只读 Contract 投影扩展为 Contract / Predicate 可视化候选，仍处于未合并评审；此前 C1 head 有 CI 证据，但新 head 的实际 exact-head 验收必须重新核对，不得等同于 main 或已部署 Pages。

以上状态是本次审计时的快照，不替代 GitHub 上的实时状态。后续实施必须重新核对 main、PR head 和 exact-head CI，不能沿用本文中的旧 SHA 作为新工作的基线。

### 2.2 关键代码现状

本轮读取到的代表性文件规模：

| 文件 | 约行数 | 当前职责 |
|---|---:|---|
| site/app.mjs | 2,651 | Classic 完整应用入口和 UI 编排 |
| experiments/ide-host/vscode/src/workbench.mjs | 938 | Theia / VS Code Host 生命周期、Package 读取、视图与命令适配 |
| site/workspace.mjs | 185 | 当前多 Procedure YAML 投影 |
| site/semantic.mjs | 117 | 较早的 Legacy Procedure 投影 |

行数不是模块质量的直接判据，也不意味着应该立即拆文件。真正的问题是哪些职责跨越了层边界、哪些规则有多个所有者，以及一个新文件视图需要复制多少已有能力。

## 3. 当前架构判断

### 3.1 正确决策，应继续保留

- Theia 作为在线默认宿主、VS Code 扩展作为可移植方向，是合理路线；不需要再建设一套新的 IDE Shell。
- React Flow + ELK 适合 Procedure / Route 这类有明确有向关系的视图；不应把它推广为所有文件的通用表示。
- YAML 1.2 AST/CST、Source range、版本核对、Diff、显式确认和原生 Undo/Redo 是正确的安全基础。
- Inspector、Outline、Evidence、Problems 应展示 Source 可证明的事实，并明确区分 UNKNOWN、启发式提示和完整证据。
- 浏览器端 Worker / LSP 适合把语言服务从 UI 宿主中分离；但 Theia Browser-only 的兼容性必须由真实 Worker 和 Chromium 证明，不能只凭 VS Code Web API 兼容性推断。
- 本地执行宿主尚未选型是正确的。在线编辑器、localhost 静态站点和本地 Runtime 是三个不同能力，不能混为一谈。

### 3.2 需要在稳定后收敛的结构问题

**A. Host 与 Workbench 应用编排尚未充分分层**

Classic 的 site/app.mjs 和 Theia 的 workbench.mjs 都承担较多 UI / 生命周期编排。两者已共享不少 Procedure、Phase、Route、Evidence 和 Patch 模块，但还没有一套清晰、稳定的 Workbench Application Services 契约。

后续应抽出的是可复用的应用服务与能力契约，而不是把两个 UI Shell 合成一个大入口，也不是让共享层依赖 VS Code / Theia API。

**B. 编辑期分析存在多个入口和不同成熟度**

目前主要分析职责分散在：

- workspace.mjs：当前多 Procedure 的 YAML 1.2 AST/CST 投影。
- package-audit.mjs：有限 Package 级引用检查和编辑期提醒。
- script-navigation.mjs：Procedure Script、Predicate evaluator、Schema 的精确引用导航。
- python-outline.mjs：有限的顶层 Python class / def 词法索引，不是 Python Parser 或类型检查器。
- yaml-owner-schemas.mjs / yaml-schema-policy.mjs：固定 Owner Schema 及其适用范围。
- semantic.mjs / graph.mjs：较早的 Procedure 投影和兼容布局路径。
- 新的 language/core 与 language/lsp：目前在 PR 链中，尚未成为 main 的唯一分析入口。

不能把这些模块简单视为重复代码后删除。它们的输入范围、语法支持、消费者和失败语义不同，需要先逐个确认实际消费者，再逐步由共享分析 API 包装或替代。

**C. Package 已是产品对象，但文件视图仍以 Procedure 为中心**

当前 Theia Custom Editor 的 Procedure 关联是精确限定的。Contract、PredicateSet、Schema、SKILL.md、references 和 Python 的能力分散在原生 Source、Outline、Problems、Preview 等功能中。

因此，下一阶段应建立“按文件类型选择视图”的机制，而不是扩大 Procedure Custom Editor 的 selector，让所有 YAML 都进入同一个图编辑器。

**D. Classic 的保留与退出条件尚需明确**

Classic 当前仍承载完整旧版功能和回归参照。它不是应立即删除的死代码，也不应成为未来所有新功能都必须维护的第二套产品。

需要先完成 Theia 功能对照、测试迁移和用户验收，再决定保留只读/兼容入口还是退出独立部署。退出不能仅以 Theia 能打开文件或构建成功为依据。

**E. 架构文档与代码状态存在代际漂移**

例如 studio-boundaries.md 仍以“静态网站”描述整体宿主；README 和部分架构表仍保留较早的 Theia 迁移缺口；应用菜单文档则已经定义 capability-driven Host。部分文档的样本快照、Owner Schema pin 和 Toolchain snapshot 也属于不同来源维度。

PR #121 已经更新 Theia parity、WORK、TRACEABILITY 和 Host README 的状态；PR #101 仍在更新 Language Core 设计、文档地图和相关追踪文件。因此本文不直接改写这些并行文件。待 PR #101 合入后，应以实际 main 重新统一文档地图和状态口径。

## 4. 目标架构

### 4.1 逻辑分层

~~~text
Theia Browser / VS Code Desktop / (Classic compatibility)
                         |
                    Host Adapter
       URI / Workspace FS / TextDocument / Commands
       Editor lifecycle / Native WorkspaceEdit / Undo
                         |
              Workbench Application Services
       Package Session / File View Registry / Navigation
       Selection / Inspector / Problems / Command Routing
                         |
          +--------------+----------------+
          |                               |
   File-kind View Providers         Language Service Client
   Procedure / Contract / ...       LSP transport adapter
          |                               |
   Read-only Projections            Browser Worker / Node
   Typed Patch Proposals                    |
          |                         Shared Skill Language Core
          +---------------+----------------+
                          |
                Current Package Source
           TextDocuments + bounded Package files
                          |
              Owner-pinned Schemas / Contracts
              (external semantic ownership)
~~~

这是逻辑依赖图，不要求立即按这些名字建立物理 npm packages。先稳定职责与 API，再决定目录和包边界。

### 4.2 Source / Package Workspace

Package Workspace 表示用户当前打开的一个 SKILL Package 工作副本。

它负责：

- 一个明确的 Package root 和规范化的相对路径。
- 当前文件列表、文件身份、文件可读/不可读状态和编辑能力。
- 当前未保存 TextDocument 优先于磁盘或上次导入文本。
- 每个文档的 URI、版本、文本和语言类型。
- Package generation，用于丢弃过期的异步分析结果。
- Package completeness：complete / partial / unavailable。

约束：

- 这是编辑期的工作模型，不是 Runtime Source Snapshot、持久化版本系统或第二个文件真源。
- 分析用 Snapshot 是一次分析所需的临时一致性输入；不要求长期冻结、持久化或在 Host 之外保存。
- Package 读取必须限制在当前 Package root；不能跨工作区扫描或把网络资源当作本地文件。
- 缺文件、超限、读取失败必须显式表达不完整，不能伪装成“没有问题”。
- 继续沿用现有有界读取策略；任何调整文件数、文本大小和超时限制都应单独评审并测试。

### 4.3 Host Adapter

Host Adapter 是 Theia / VS Code / 未来其他宿主唯一理解宿主 API 的层。

它负责：

- 文件和目录读取、URI 映射、Package root 发现。
- TextDocument 生命周期、未保存文本、版本和编辑器关联。
- LSP Client / Worker 或 Node 进程生命周期。
- 命令注册、宿主能力发现、原生 WorkspaceEdit、Undo/Redo。
- 将共享视图投影映射到 Theia Tree / Editor、VS Code View / Editor 等 UI。

它不负责：

- 自己再解析一套 SKILL YAML。
- 重新实现 Procedure、Predicate、Capability、Effect 等业务语义。
- 根据文件名、Goal 或模型推测 Runtime 能力。
- 直接执行 SKILL、Python、Tool 或 5GC 操作。

Host 的差异应体现在能力适配上。例如目录授权、原生文件保存、Worker/Node Transport、菜单命令可用性，而不是复制一套 Designer 业务规则。

### 4.4 Workbench Application Services

这一层是当前最值得在稳定后抽取的共享应用层，负责跨视图的通用协作：

- Package Session 和文件导航。
- File View Registry：按文件身份选择视图 Provider。
- Selection / Reveal：在视图、Inspector、Outline、Source 之间传递真实文件身份和版本。
- Problems / Diagnostics 的统一呈现入口。
- Command Registry：命令 ID、能力要求、可用状态和执行结果。
- 视图会话和文档版本关联，避免切换文件或 Package 后复用过期结果。

它不实现 YAML 规则、Procedure 业务投影或 Patch 资格。它调用 Language Core、具体 View Provider 和 Source Patch 服务。

初期只需要本仓内置 Provider Registry，不建议过早建设第三方插件市场、动态插件下载或复杂依赖注入框架。

### 4.5 Shared Skill Language Core 与 LSP

Language Core 是确定性、只读、与宿主无关的分析内核。

建议职责：

- YAML 1.2 解析、AST/CST 和精确 UTF-16 Source ranges。
- Package 文件模型、符号和精确引用索引。
- Procedure / Contract / Predicate 等文件的只读语义投影。
- 具有来源、置信度和可用状态的编辑期 Diagnostics。
- 基于已支持语法和 Owner Schema 的 Completion / Hover。
- 明确区分 exact、heuristic、unknown；保留 unresolved / ambiguous 状态。

依赖边界：

- 可复用仓库已固定的 yaml 解析库和 Owner-pinned Schema。
- 不依赖 VS Code、Theia、Monaco、React、React Flow、DOM 或 Node 文件系统。
- 不包含文件读写、进程、网络、Runtime、Tool Registry、Capability Discovery 或 5GC Adapter。
- 不承担编辑 Patch 的资格批准或实际写入。

LSP 是协议适配层，不是另一套分析内核。Browser Worker 和未来 Node Transport 可以不同，但调用相同 Core API。

**Diagnostics 归属必须收敛为单一逻辑来源。** 在 LSP 完整稳定前，现有 Package Audit 可以继续服务当前 Theia / Classic；不能在相同规则上再注册第二个 LSP 诊断发布者，造成重复或互相覆盖。迁移时由 Core 统一分析结果，Host 只负责同步文档和显示结果。

LSP 初期能力保持保守：诊断、Completion、Hover；Definition / References 只有在身份和 Source range 可精确证明后开放；Rename、Code Action 不因协议支持就自动开放。Python 的现有 Outline 仍是词法级能力，不能把它描述成 Pyright、类型检查或执行。

### 4.6 File-kind View Providers

每种视图负责把对应文件的当前 Source 投影为适合用户理解的界面。它们共享 Package、Navigation、Problems、Source Reveal 和 Patch 基础设施，但不共享同一种图形表达。

建议的能力矩阵：

| 文件 / 类型 | 主要视图 | 当前 / 后续定位 |
|---|---|---|
| assurance/procedure.yaml | Procedure / Node / Phase / Route 图 | 现有核心视图，继续完善 |
| assurance/contract.yaml | 身份、入口、Input、Capability、Postcondition、Failure Policy 摘要 | PR #122 C0 只读投影 Spike；后续 C1 只读 UI |
| assurance/predicates.yaml | Predicate 声明、Observation、Scope/Freshness、Evaluator 关系 | C2 只读视图；不显示伪造的实时 PASS/FAIL |
| schemas/*.schema.yaml | JSON Schema 字段树、类型、required、约束、引用关系 | C3；先确认 Schema dialect、$ref 和循环边界 |
| SKILL.md / references/*.md | 安全 Markdown Preview、文件与精确引用导航 | 不把 LLM 指南转换成确定性执行图 |
| scripts/*.py | 原生 Python 编辑、现有调用方和 Schema 导航、词法 Outline | C4；Python 语义服务另行决策 |

Provider 应表达三种结果：

- READY：支持的内容可被完整投影。
- PARTIAL：部分字段可投影，同时列出未投影路径；原始 Source 始终可见。
- SOURCE_ONLY：解析失败、版本/Kind 不支持、存在不安全语法或超出边界时，退回原生 Source。

Provider 的“可视化能力”与“可写能力”必须分开。只读投影 READY 不代表允许写入；一个 Provider 可以长期只读。未知字段不能被静默隐藏后让界面看起来完整。

不建议把 File View Provider 立即做成外部可安装插件系统。先用简单、显式、可测试的内置注册表；等确实出现第三方扩展需求，再设计贡献点。

### 4.7 Source Patch / Edit Service

所有可视化编辑都应走统一安全协议：

1. View Provider 根据当前 Source 和已证明的规则提出类型化 Proposal。
2. Host 提供当前 TextDocument、URI 和版本。
3. 共享 Patch 逻辑重新计算资格、影响范围和精确 Source spans。
4. Host 核对版本和 Source 未变化，拒绝过期或被篡改的 Proposal。
5. 展示真实 Diff，由用户明确确认。
6. Host 通过原生 WorkspaceEdit 或当前宿主等价 API 写入。
7. 继续使用原生 Undo/Redo，并重新分析新 Source。

Patch 服务可以统一 Proposal envelope、Source identity、版本、Diff 和错误模型，但 Node、Route、Phase、Contract、Predicate 的具体写入资格仍由各自有界操作定义。不能抽象出一个“任意 YAML Patch”来绕过语义检查。

LSP 的 Code Action 不得绕开这条链路。初期 LSP 只提供只读信息，不直接写文件。

### 4.8 Technology and Language Selection · 技术栈与语言选型

语言选型必须纳入架构审视，但不能把“当前代码混合 JavaScript / TypeScript”简单等同于“需要全部重写”。应先区分 Studio 自身的实现语言、SKILL Package 中被编辑的语言、LSP 实现语言和 Host API，再按在线部署、跨宿主、Source 保真、性能和维护成本评估。

#### 4.8.1 当前技术事实（main 审计快照）

| 层 | 当前实际采用 | 状态与判断 |
|---|---|---|
| Online IDE Host | Theia Browser-only 1.76 + VS Code Web Extension API 兼容 | 在线版是硬产品要求；保留，不改为仅桌面 IDE |
| Desktop / Extension direction | VS Code Extension API | 与 Theia 共享扩展能力；真实桌面 GUI 仍需单独验收 |
| UI | React 19 | 当前主要视图技术；不因早期其他方案文档而直接重写 |
| Procedure graph | React Flow 12 + ELK 0.12 | 已有复杂交互和 Source-backed 投影；继续限定在图形关系适合的文件 |
| Source editor | Theia 原生文本编辑器；Classic / 独立编辑路径使用 Monaco 0.57 | 优先复用宿主原生编辑器、Undo/Redo 和文档生命周期，不自建文本编辑器 |
| YAML | yaml 2.9.1 | 现有 YAML 1.2 AST/CST / Source span 基础；不重新实现 Parser |
| Build | esbuild | 当前静态站点与扩展构建基础；保持浏览器可部署 |
| Project source language | JavaScript ESM 为主，少量 TypeScript / TSX | main 文件树快照包含约 147 个 .mjs、2 个 .tsx、1 个 .ts；这是全仓文件计数，不等于运行时模块精确占比 |
| Type checking | TypeScript 7 | 当前 tsconfig 的 checkJs=false、strict=false，且 include 只覆盖 React Flow TSX 与样式声明；不能声称全仓已受 TypeScript 严格检查 |
| Skill Language Core / LSP | 目标为 TypeScript，共享 Core + Browser Worker；Node transport 可供桌面宿主复用 | 实现仍在独立 PR 链中，不能记为 main 已交付 |
| Python | SKILL Package 内用户脚本语言 | Studio 当前提供原生编辑及有限词法 Outline；不是 Studio 自身后端语言，也不意味着 Studio 负责执行 Python |

以上是审计时 main 的事实快照。依赖版本、文件数量和 PR 状态会变化；进入 S1 时必须重新读取 lockfile、构建配置、实际 import 图和 PR exact head。

#### 4.8.2 选型建议

**当前建议是保留主要技术栈，不做整体换语言；把 TypeScript 作为新增共享核心和新应用边界的首选语言，逐步改善既有 JavaScript 的类型覆盖。**

具体决策建议：

- **React：保留。** 当前 React Flow 画布本身依赖 React；更换 Vue / Svelte 等框架意味着重做组件、状态和集成，除非实际性能基准或 Theia 兼容性证明当前方案存在不可接受的结构性问题，否则收益不足。
- **React Flow + ELK：保留为 Procedure 视图。** 不把它推广为 Contract、Predicate、Schema 和 Markdown 的统一 UI；也不为替换图形库而重写已通过验收的画布。
- **TypeScript：新核心优先，旧模块渐进迁移。** Language Core、Package Model、Diagnostic、Symbol / Reference、Source Range、Patch Proposal 等跨模块契约应优先采用严格类型。现有 .mjs 先维持行为和 API，通过边界类型、JSDoc / declaration 或小步迁移逐渐提高检查覆盖；不一次性批量改名或重写。
- **LSP：沿用 TypeScript + Node.js / Browser Worker 的共享 Core 路线。** Browser Worker 满足在线无后端约束；Node transport 供未来桌面扩展使用。两种 Transport 调用同一 Core，不允许各自实现语义。当前没有理由为了 LSP 把实现改成 Python、Go 或 Rust。
- **YAML：保留现有 yaml AST/CST 能力。** 先验证版本、Source span、注释/格式保留、增量成本和浏览器 Bundle；只有出现明确的正确性或性能瓶颈才评估替换。
- **编辑器：继续使用 Host 原生文本编辑能力。** 不另建 Monaco/CodeMirror 作为第二套 Source owner；Theia 与 VS Code 的文档模型、WorkspaceEdit 和 Undo/Redo 是优先适配对象。
- **Python：保持为被编辑的 SKILL 脚本语言。** 先使用原生 Python 编辑和有限导航；只有真实需求和性能/浏览器能力证明必要时，才评估 Pyright 等语言服务。不要因为 Package 中有 Python 脚本就用 Python 重写 Studio 或 Language Core。

这是一组有依据的默认保留建议，不是永久锁定。若某项在实际浏览器性能、包体积、Worker 兼容、编辑保真或维护成本上未达到要求，可单独提出替代方案，并以相同基准比较迁移成本与收益。

#### 4.8.3 三态技术决策原则（必需的审计产物）

**每个技术、组件或语言决策必须显式标注「保留 / 待验证 / 可替换」之一**，并附支持的证据、适用宿主/场景、仍然缺失的验证和重新评审触发条件。状态针对具体范围而不是语言或库的永久总体评价：一个组件可以在 Theia Browser-only 已验收，在 VS Code Desktop 仍待验证。

| 状态 | 可进入条件 | 对开发的约束 |
|---|---|---|
| **保留 RETAIN** | 当前目标场景内有实际代码使用和足够的功能/正确性证据，尚未发现必须替换的结构性阻塞；明确记录缺少的性能或跨宿主证据 | 继续维护现有实现；新功能优先复用；不主动重写；若触发新的缺陷或架构限制，重新进入待验证 |
| **待验证 VERIFY** | 有合理候选或未关闭的疑点，但性能、兼容、Source 保真、实际运行或迁移成本证据不足，无法决定保留还是替换 | 只能做受限调查、基准或独立 Spike；不得把目标方案当作已交付，也不得以猜测批量迁移 |
| **可替换 REPLACEABLE** | 已确认冗余/职责冲突、阻塞性限制、可复现缺陷或持续成本问题，且列出了替代方案、保留功能和风险 | 仅表示允许提出替换 PR，不等于自动批准删除；替换前必须证明消费者迁移、回归、回滚路径和真实宿主验收 |

状态变更规则：

1. RETAIN → VERIFY：出现复现的性能回退、宿主不兼容、Source 正确性问题、维护负担或新的功能硬约束；先验证，不能直接据此重写。
2. VERIFY → RETAIN：完成预设实验与正确性/性能验收，原方案满足目标。
3. VERIFY → REPLACEABLE：通过证据证明缺陷/冗余不可接受，并完成至少一个替代方案的适配性、迁移成本和失败模式比较。
4. REPLACEABLE → 具体实施：单独审批可回滚的小 PR；保留旧测试直到迁移验收。替换完成后重新评估新方案是否 RETAIN。
5. 任何状态都不能绕过 Browser-first、Source-first、Host WorkspaceEdit、版本拒绝、Owner 边界；如果缺少数据，标记 VERIFY 而不是假设通过。

证据最低记录：**审计时的 Git SHA / 路径、真实消费者、当前与目标宿主、已有单测/Chromium/Pages/桌面证据、未验证事项、测量或复现方式、责任模块、下次复审触发条件**。文档审查、CI 构建、真实 Chromium 和真实桌面操作必须区分，不能互相代替。未做性能测量时不得填写“性能已通过”。

**当前应用这套原则的初始分类**（截至本轮审计，均为架构建议，不是已合并的技术迁移）：

| 范围 | 当前状态 | 现有依据 / 缺少的证据 | 重新评审触发 |
|---|---|---|---|
| Theia Browser-only 作为在线默认宿主 | **保留** | 已在 Pages 使用且有真实 Chromium 主路径验收；跨桌面功能和长期资源使用不因此自动通过 | 在线首屏/兼容性/资源预算连续回退 |
| VS Code Extension API 作为共享宿主边界 | **保留** | 已有独立扩展代码与 Theia 集成；真正桌面运行能力单独列为 VERIFY | 扩展 API 无法覆盖必需的文件/命令/视图能力 |
| VS Code Desktop 的正式用户体验和 Node LSP Transport | **待验证** | 仍缺真实桌面 GUI、原生文件权限与相关 Transport 验收 | 完成真实 OS/编辑器矩阵后决定支持范围 |
| React 19 / React Flow 12 / ELK 0.12 的当前 Procedure 视图 | **保留** | 已有画布、布局、交互回归；不意味着所有文件都应使用图 | 大图性能或图行为在实际基准中不达标 |
| YAML 2.9 AST/CST 解析与 Source spans | **保留** | 现有 Procedure / Patch 等正负例依赖；不能无证据换解析器 | 可复现的保真、兼容或解析瓶颈 |
| esbuild 与浏览器静态构建 | **保留** | 既有 Pages / 扩展构建路径实际使用 | Bundle/资源加载、Worker 打包或安全需求无法满足 |
| 现有 JavaScript ESM 模块 | **保留（当前行为）** | 既有模块和大量测试依赖；短期不因 TS 方向而删除 | 关键边界的类型维护成本和缺陷证据积累 |
| 严格 TypeScript Shared Language Core / Browser LSP 作为正式主路径 | **待验证** | PR #101 / #103 及后续 LSP 链采用 TypeScript，main 尚未将其全量接入；必须验证 Worker、诊断归属、Typecheck 覆盖和浏览器生命周期 | 相关 PR 逐一落地并完成版本/故障/性能门禁 |
| 全仓 JS → TS 迁移 | **待验证** | 当前 tsconfig 仅覆盖少量 TSX，checkJs=false、strict=false；尚无全仓收益和迁移成本证明 | 先提供边界类型覆盖、错误率、改动成本和回归数据 |
| Legacy semantic.mjs 双投影路径 | **可替换（有条件）** | 已证明与 workspace.mjs 存在不同的解析路径，仍有 graph/旧 Patch 消费者；属于待迁移的历史兼容债 | 所有消费者及负例迁移完成后单独批准删除 |
| Classic 独立应用作为长期正式入口 | **待验证** | 目前仍是完整功能对照和回归资产；能否退出取决于 Theia parity / 用户验收 | 新版达到实际功能对等并迁走唯一能力后复审 |
| Python 语义 LSP / Pyright 之类扩展 | **待验证** | 当前只有原生 Python 编辑和词法 Outline；尚无浏览器体积/性能/兼容证据 | 真实代码导航或类型诊断需求出现且能给出浏览器可行方案 |
| ca-skill-toolchain Go Compiler → Browser WASM | **待验证（Pages 首选候选）** | 已有 CompileFiles / schemas.LoadSet / BuildFromPackage 内存入口；但尚未完成 js/wasm 构建、Registry 内存加载、安全投影、依赖 resolver、浏览器和体积/性能验收 | Native/WASM conformance、真实 Chromium Worker、资源预算和公开 Registry 安全审查全部通过后，才升级为保留 |
| Go / Rust / Python 重写 Studio 或 LSP | **待验证（无当前替换动机）** | 没有针对当前 TS/JS 方案的已测量硬瓶颈，也缺 Browser-first/Host 迁移收益证据 | 仅在现有栈被证明不能满足硬约束时启动独立对比 |

**当前原则执行审计：** 现有 LSP 分层 Draft PR（#101 / #103 / #105…）、多文件 Designer PR #122 的独立只读视图、以及保留 Classic 的做法，符合“不未经证据就全面重写”和“先受限验证”的方向。但这不是宣称所有 PR 都完成了技术选型验收。#122 已从 C0 Spike 发展到 Contract / Predicate 可视化候选并处于未合并评审中；具体 exact-head CI 和 Pages 是否通过须按实际最新 head 独立核对。当前 main 也尚未落实全仓 TypeScript 类型治理、通用性能基线或完整 Host 收敛。因此这套三态规则**现在写入了提案，并部分体现在并行工作方式中；不能说已在全部代码和 PR 流程中完成执行**。

#### 4.8.4 统一选型评价标准

每个候选语言、框架或库至少按以下维度记录：

1. **Browser-first：** 是否能在 GitHub Pages / Theia Browser-only 运行，不要求常驻后端或 Node 文件系统。
2. **Host portability：** 是否能被 Theia 与 VS Code Web / Desktop 复用，是否引入 Host 专属分叉。
3. **Source fidelity：** 能否保留 YAML 1.2、注释、格式、BOM/CRLF、UTF-16 Source range 和原生 Undo/Redo。
4. **Performance：** 冷启动、Bundle size、parse / index / layout 耗时、输入长任务、Worker 通信、内存和增量更新能力。
5. **Correctness / typing：** 能否明确表达 partial / unknown / unavailable、版本身份、精确引用和有界 Patch 契约。
6. **Ecosystem / maintenance：** 依赖成熟度、许可证、浏览器支持、升级风险、社区活跃度和团队维护成本。
7. **Migration cost：** 已有实现、测试、UI 行为和用户工作流的迁移成本；必须与可量化收益对比。

不得只按语言性能微基准、流行度或开发者偏好决定。对 Studio 而言，浏览器可用性、Source 保真和跨 Host 复用是硬约束。

#### 4.8.5 TypeScript 渐进治理门槛

在稳定阶段单独建立 TypeScript 覆盖计划：

- 首先把新增 Language Core 和跨模块共享契约设为 `strict: true`，不继承全仓宽松设置。
- 单独建立被检查文件清单和 typecheck 覆盖报告，避免 `tsc --noEmit` 通过却没有检查实际核心模块。
- 为现有 JS 模块逐步增加 JSDoc / 类型声明或迁移为 TS；每次只迁移一个有明确消费者和测试的边界。
- 不允许类型迁移改变 YAML 解析、Source span、Patch 资格、诊断状态或运行时行为。
- 不把类型断言、`any` 扩散或大范围关闭 strict 作为迁移完成标准。
- CI 分开报告 TypeScript typecheck、JavaScript 运行时测试、浏览器集成测试；三者不能互相替代。

**完成标准：** 新共享核心有严格类型和明确覆盖率；关键跨层 API 不依赖隐式动态对象；旧 JS 迁移按模块可追溯；浏览器和 Theia 功能行为不回退。是否将全仓全部转为 TS，留待实际维护收益评估，不设为目标本身。

### 4.9 Performance Architecture · 性能是架构约束

性能不能留到功能完成后再集中补救。Package、Language Core、LSP、多个 View 和大型 Procedure 图会共享 CPU、内存、Worker 和 UI 主线程；如果每个功能都自行读取、解析、索引和布局，功能叠加会形成明显的重复成本。

**性能目标是在不牺牲 Source 正确性、版本一致性和编辑安全的前提下，让用户当前正在做的事情始终优先。**

#### 4.9.1 用户可感知的性能原则

1. **Source-first 首屏。** 打开文件时先让原生 Source 编辑可用；Package 全量分析、LSP 初始化、Procedure 图布局、Python Outline 和后台索引不能成为首次输入的前置条件。
2. **交互优先。** 当前焦点文件、当前选中节点和用户明确触发的命令优先于后台 Package Audit、非活动文件 Outline 和预热任务。
3. **增量而非全量。** 一个文件变更优先重算该文档及受影响的引用；不能每次按键都重新扫描和解析整个 Package。
4. **共享而非重复。** 同一 URI + document version 的 YAML AST/CST、Source range、符号和引用事实应由共享分析层复用；View Provider 不得各自重复解析同一份 Source。
5. **异步且可取消。** Package 分析、LSP、跨文件索引和图布局在后台执行；新版本到来时合并、取消或丢弃过期任务。旧结果即使更快完成，也不能覆盖新版本结果。
6. **有界资源。** Package 文件数、总文本量、并发读取数、Worker 数、缓存条目和缓存内存都必须有上限；关闭文件、切换 Package 和销毁视图时释放不再需要的资源。
7. **大视图渐进呈现。** 大型 Procedure 图优先展示当前路径和可见区域；子流程折叠、邻居视图、可见节点渲染和稳定布局缓存应共同控制布局及 DOM/SVG 成本。不得为了性能改变 Source 中的真实节点、Route 或顺序。
8. **优雅降级。** 超限或性能预算无法满足时，应明确显示 PARTIAL / SOURCE_ONLY / unavailable，并保留原生 Source；不能无限等待，也不能静默跳过检查后报告 READY。

#### 4.9.2 分层性能职责

| 层 | 必须承担的性能职责 | 不应发生的情况 |
|---|---|---|
| Host Adapter | 增量文件读取、打开文档优先、有限并发、生命周期清理 | 每次切换视图都重新读取整个 Package |
| Package Session | 维护同一 generation 的有界文件快照与变更集合 | 每个 Designer / LSP Client 各持一份无协调的 Package 全量副本 |
| Language Core | 按文档版本复用解析结果；按依赖关系增量更新符号和引用 | 每个功能重复 YAML parse，或把全包分析塞进按键回调 |
| LSP / Worker | 请求取消、版本门控、单飞初始化、有限队列和显式恢复 | 每个编辑器/视图创建独立 Worker；过期诊断反复发布 |
| Workbench Services | 共享分析结果、选择和导航状态；避免重复投影 | Inspector、Outline、Problems 各自扫描并解析 Package |
| View Provider | 只计算自身视图需要的投影；惰性创建非活动视图 | 打开 Package 时同时构建所有图、树和预览 |
| Procedure Renderer | 稳定 Node identity、memoization、折叠/可见区域控制、布局缓存 | Inspector 选中变化就触发整图 ELK 布局 |
| Patch Service | 仅对当前操作范围重算资格与影响；写入后使相关缓存失效 | 为一次局部 Patch 无条件重建所有视图和索引 |

缓存必须有明确的 key、失效条件和容量上限。至少应区分 Document URI + version、Package identity + generation、Procedure projection identity、Layout inputs。不得只按文件名或路径缓存而忽略内容版本。缓存只能加速派生数据，不能成为 Source 或语义权威。

#### 4.9.3 任务调度与分析流水线

建议统一优先级，而不是由每个模块自行 setTimeout：

1. **P0 · 用户输入与 Source 编辑：** 不等待后台分析，不在主线程运行全包扫描或大图布局。
2. **P1 · 当前可见视图：** 当前文件投影、选中节点 Inspector、当前视口所需布局。
3. **P2 · 当前 Package 的必要分析：** 与当前文件相关的引用、Problems 和诊断。
4. **P3 · 非活动文件和后台能力：** 其他文件 Outline、预览预热、非当前 Procedure 布局。

新输入到来时，低优先级可取消任务应让位；同一文档短时间连续变更应合并分析请求。调度器应有并发上限和背压，避免多个大任务同时争抢浏览器线程。具体 debounce 时间、Worker 数和并发值必须由基准测量决定，不能散落硬编码在各视图中。

#### 4.9.4 性能观测与基准

先建立可复现的基线，再设定最终硬阈值。至少记录以下阶段的耗时、P50/P95、任务取消数和输入规模：

- 页面 / Workbench 冷启动与热启动；
- 文件打开到 Source 可输入、Procedure 视图首次可用；
- 输入到编辑器下一帧响应；
- YAML parse、Package snapshot、符号/引用索引、Package Audit；
- LSP Worker 启动、Completion / Hover / Definition / References 响应；
- Procedure projection、ELK layout、图首次渲染和视口变化；
- 文件切换、Package 切换、关闭重开后的内存与残留任务。

基准至少覆盖小型真实样例、多个文件的中型 Package、接近当前 Package 读取上限（500 文件 / 4 MiB）的压力样例，以及不同规模的 Procedure 图。测试要区分冷缓存 / 热缓存、单文件编辑 / 连续快速编辑、单视图 / 多视图和普通桌面 / 受限浏览器环境。

建议将以下作为**初始体验目标，而非未经测量就宣称已达到的 SLA**：

- 键入和 Source 编辑不等待 Package Audit、LSP 首次启动或图布局；主线程避免由单次分析任务造成超过 50 ms 的长任务。
- 常用 Completion / Hover 和 Inspector 交互以 100 ms 量级为目标；后台完整 Package 诊断可以异步完成，但应有明确的完成/不可用状态。
- 打开大 Package 时先可编辑，再逐步出现视图和分析结果；不能以全包扫描阻塞首屏。
- 同一版本的同一文件在一次分析周期内不应被多个模块重复完整解析；无效任务应能被取消，关闭后不应继续持有大对象。

以上数字和目标须在当前 GitHub Pages / Theia Browser-only 与受控 CI 环境实测后校准。不能用不稳定的 CI 墙钟测试单独判定性能回归；应结合稳定基准、阶段计时、重复解析计数、取消行为、资源上限和趋势报告。性能遥测只记录阶段、耗时、计数和大小，不采集 Source 正文或用户文件内容。

#### 4.9.5 性能与正确性的冲突处理

- 任何增量索引或缓存都必须携带 Document version / Package generation；无法证明缓存有效时宁可重算或返回 unavailable。
- 不得通过缩小检查范围、跳过未知字段、放宽解析规则或复用过期结果来制造性能改善。
- 大文件和大图可以降级为 Source-only / 折叠视图，但必须清楚说明未完成的能力。
- 性能优化必须有正例和负例：不仅证明快，也要证明快速连续编辑、切换 Package、Worker 重启和关闭视图后不会出现旧结果或资源泄漏。

### 4.10 Studio LSP 与跨仓 Compiler / Linker 的边界

**状态：PROPOSED · 2026-11-10 跨仓只读审计**。这是一份职责约定与接线候选，不表示 Studio 已集成 Go Compiler、已经运行跨仓 Build，或 Agent Demo 与正式 Toolchain 已使用同一实现。

#### 4.10.1 当前跨仓事实

| 实际实现 | 已有代码职责 | Studio 应如何对待 |
|---|---|---|
| [ca-skill-toolchain · Go Compiler](https://github.com/odango-chan/ca-skill-toolchain/tree/main/backend/internal/compiler) | 正式 Skill 解析、Schema/Registry 校验、Source → GraphIR → lowering、跨 Skill Composition 与 Artifact 构建准备 | **正式编译语义 owner**；Studio 不复制其规范性 Compiler |
| [ca-skill-toolchain · ProcedureTemplate](https://github.com/odango-chan/ca-skill-toolchain/blob/main/backend/internal/proceduretemplate/compiler.go) | 把已校验 Procedure 转成 Artifact-owned ResolvedProcedure wire；并不绑定真实 request/fact 或执行 | Studio 可只读展示 Source，不能把 UI Graph 等同于编译产物 |
| [ca-skill-toolchain · Composition](https://github.com/odango-chan/ca-skill-toolchain/blob/main/backend/internal/compiler/composition.go) | 解析固定 artifactRef/digest 依赖闭包，检查循环，组合编译期 Procedure 和资源约束 | Studio 允许引用导航，不复制正式跨 Skill 链接和准入语义 |
| [ca-agent-demo · Python MockCompiler](https://github.com/odango-chan/ca-agent-demo/blob/main/src/ca_agent_demo/skill_toolchain/compiler.py) | Proposal / exact entry 的 compile-or-reuse 缓存、摘要与 exact child identity | Demo Host 的轻量实现，不是 Go Toolchain Compiler 的等价替代 |
| [ca-agent-demo · Python Linker](https://github.com/odango-chan/ca-agent-demo/blob/main/src/ca_agent_demo/runtime/linker.py) | Agent 选择后 direct-entry 或 Proposal 的 attempt-local binding、exact child admission、FrozenLinkedGraph / LinkedProcedure；共用 Link/Admission core | 属于**执行前具体化与冻结**，不放到 Studio LSP |
| [ca-runtime · ArtifactResolver](https://github.com/odango-chan/ca-runtime/blob/main/internal/host/service/artifact_resolver.go) / [RuntimeHost](https://github.com/odango-chan/ca-runtime/blob/main/runtimehost/contract.go) | Artifact / 部署绑定准入，正式执行及 Outcome / Reconcile | Studio 不推断 Runtime 事实 |
| Studio · TypeScript Language Core / LSP #100、#103 等 | 未保存 Source 的语法提示、符号、引用、Hover、Completion、诊断和精确位置 | **编辑期体验**，不得成为第二套 Compiler / Linker / Runtime Validator |

不同仓的当前 main、Studio 使用的固定 Schema 和实际部署 Artifact 可能来自不同提交。涉及跨仓兼容时必须核对具体 Owner SHA、Schema/Registry/Artifact digest，不得假定各仓最新 main 天然兼容。

#### 4.10.2 三层不同的语义动作

~~~text
     Current Skill Package Source / unsaved TextDocuments
                            |
              +-------------+--------------+
              |                            |
       Studio / LSP                   Formal Toolchain (Go)
       editor-time hints              strict compile / validate
       tolerant parse                 schema / registry / dependency
       symbols / references           Source -> GraphIR -> lowering
       hover / completion             composition / frozen Artifact
       Source reveal                       |
       Editor Problems               ValidationReport + Artifact
       (not compile PASS)                   |
                                      Agent Host
                                   selection / bind /
                                direct-entry or Proposal Link
                                            |
                                      RuntimeHost
                                            |
                                      real Run / Outcome
~~~

LSP 是编辑器和 Language Server 的协议。Language Server 可以共享或消费 Compiler 的分析事实，但本身不是正式编译器。**不同实现语言不是问题；出现两个独立且相互矛盾的正式语义 owner 才是问题。**

- **编辑期分析（Studio）：** 允许在 Source 尚不完整时提供 PARTIAL / SOURCE_ONLY / UNAVAILABLE 和有限精确导航。分析 READY 只表示编辑期投影可用，不能代表 Compiler VALID。
- **正式编译（Toolchain）：** 依赖固定 Owner Schema、Registry、依赖闭包和正式静态规则，产生自己的 ValidationReport / SkillBuildArtifact。Compiler VALID 不意味着 Qualification PASSED 或 Runtime PASS。
- **执行前 Link 与运行（Agent Host / Runtime）：** 在用户请求上下文中完成选定 Skill 的精确身份、绑定、冻结、准入和真实执行。不能在 Studio Source 编辑阶段提前伪造。

Toolchain 内部的 GraphIR 是正式编译用 IR；React Flow 上的 Graph 是 Source 派生的可视化投影。即使两者显示类似节点，也不应共享“同一个图就是编译器 IR”的假设。

#### 4.10.3 必须复用的合同

1. **Owner Machine Schema：** 固定来源 SHA 与适用范围，Schema 不匹配时返回 unavailable，不静默放宽。
2. **公开 Source 合同：** Contract、Procedure、Predicate、Dependency、Binding、Capability、Outcome/Effect 的字段、枚举、身份与来源。必要时由 Owner Schema 生成 TS 类型，避免手抄第二套规范。
3. **Compiler 诊断合同：** ValidationReport 的 code、severity、path、pointer、message、版本/Registry/Schema provenance。Studio 编辑期诊断必须保留 distinct source。
4. **Conformance Fixtures：** 使用正式 Toolchain 的合法/非法 Skill Source 和错误码测试 Studio 的精确导航、类型提示与兼容性；Studio 可以提供保守提示子集，不得声称全等 Compiler。
5. **只读正式产物：** 若明确版本兼容，可展示 Compiler 真实输出的 Artifact、依赖闭包、GraphIR 投影；不能根据 Studio 的 UI Graph 自行宣称“正式链接通过”。

**不得在 Studio LSP 重做：** 真实 Capability/Effect 授权、完整跨 Skill 组合、Artifact/Variant digest 冻结、动态 Proposal Admission、运行时 Outcome / Reconcile、真实 Script 执行。LSP Code Action 不能绕过已有 Source Revision、Patch 资格、Diff、用户确认和原生 WorkspaceEdit/Undo。

#### 4.10.4 GitHub Pages-only 的正式 Compiler：Go/WASM 优先方案

**产品约束：在线 Studio 目前只能部署 GitHub Pages 静态站点，不假设存在可部署的常驻 HTTP 后端。** 因此在线版正式 Compiler 的首选候选应调整为：将 Toolchain 自身的 Go Compiler / Artifact Builder 编译成 WebAssembly，在浏览器专用 Worker 内按需运行。GitHub Pages 只需托管版本固定的 .wasm、Go wasm_exec.js 和 manifest 静态文件；不需要启动服务器，也不上传用户正在编辑的 Source。

这不是另写一套 Compiler，而是把 ca-skill-toolchain 同一版本的 Go 源码编译成两种目标：

- Online Pages：Go → js/wasm，在 Web Worker 内运行。
- Local Host：同一 Toolchain revision → 原生 Go CLI / 本地进程。
- 两种目标必须使用相同 Owner Schema、Registry、依赖 closure 和 Conformance fixtures，且对同一输入产生语义一致的 ValidationReport / Artifact Digest。

**当前源码已经提供有价值的内存接口：**

- [compiler.CompileFiles](https://github.com/odango-chan/ca-skill-toolchain/blob/main/backend/internal/compiler/compiler.go) 接收 map[path]bytes 和 Options，执行解析、Schema 校验、Reference Resolve、Composition Resolve、Procedure Validate、Assurance Validate、Python Script 静态检查及 Digest / ValidationReport；不要求通过本地目录发现 Package。
- [schemas.LoadSet](https://github.com/odango-chan/ca-skill-toolchain/blob/main/backend/internal/schemas/schemas.go) 可直接从内存文件 Map 创建只读 Schema Set。
- [skillbuildartifact.BuildFromPackage](https://github.com/odango-chan/ca-skill-toolchain/blob/main/backend/internal/skillbuildartifact/builder.go) 接收已编译 Package 和 Registry Snapshot，在内存中生成正式 SkillBuildArtifact、字节和 Digest。
- CompileFiles 的 Options 明确要求 Core、Registry，并通过 DependencyResolver 回调处理跨 Skill 依赖。因而这两个上下文必须以固定身份、安全地提供；不能只把用户当前 Package 文件传进去就声称全量编译成功。

**实现边界和必须补齐的工作：**

1. **WASM 入口应放在 Toolchain 仓内。** Compiler / Registry / Artifact Builder 位于 Go internal 包，不能由 Studio 仓直接 import。建议在 ca-skill-toolchain 增加一个受限的 WASM command/adapter，调用现有 CompileFiles + BuildFromPackage；输出带版本与 Digest 的 wasm、匹配 Go 版本的 wasm_exec.js 和构建 manifest。Studio Pages 只消费这个固定版本的静态产物。
2. **Registry 必须改为可内存加载。** 当前 registry.Load(dir, core) 主要依赖 filepath.WalkDir / os.ReadFile；需要增加 fs.FS / map 输入的加载入口，并复用同一套解析、校验、Binding Resolve 和 Digest 逻辑，避免复制 Registry 规则。
3. **公开 Registry 必须做最小化安全投影。** domain.Tool.ServerRef 明确属于内部执行信息；不能把原始 Registry、executionView、serverRef、凭据或 Provider 内部配置打进公开 Pages。需要通过编译器实际字段消费者审计，生成仅包含静态编译所需公开字段的 Compiler Registry Snapshot，并证明它不改变编译语义。
4. **跨 Skill 依赖必须使用内存 resolver。** 用固定 artifactRef → exact source file closure 的映射实现 DependencyResolver；逐项验证声明 Digest。禁止解析 latest、跟随 main 或使用同名 Skill 猜测。未提供、私有不可读或 Digest 不符的依赖必须明确报 unresolved / unavailable / invalid，不可静默退化成无依赖编译。
5. **输入边界要由 WASM Adapter 强制。** CompileFiles 是内存入口，不会自动经过 Compile(dir) 的 discover 文件数、单文件和 Package 总大小限制。Adapter 必须验证相对路径、拒绝绝对路径 / traversal / 重复规范化路径 / 非法文件类型，并实施 max files、per-file bytes、total bytes、依赖 closure 和并发限制。
6. **Studio 按需加载独立 Worker。** 用户显式选择 Validate / Build 后才下载并启动 WASM；不要放在页面冷启动或每次 LSP 请求中。Worker 独立于 TypeScript LSP Worker，接收当前未保存 Package generation 的文件快照；过期结果丢弃。关闭 Package 或取消任务时释放/终止 Worker 与大型内存对象。
7. **Build 只构建 Artifact，不执行。** Compile INVALID 不得生成可用 Artifact；Compile VALID 后才允许调用 BuildFromPackage。不得在 WASM 内执行 Python Skill Script、Tool、网络请求、Runtime、Qualification 或 5GC 操作。
8. **本地和在线必须做差分一致性测试。** 对同一组合法/非法 Package、Registry、依赖 closure，比较 native CLI 与 WASM 的 ValidationReport（去除明确非确定性元数据后）和 Artifact Digest；必须覆盖缺 Registry、缺依赖、Digest mismatch、超限文件、快速连续编辑、取消和 Worker 重启。

**性能门槛：** Go WASM 不是天然轻量。Compiler 依赖 CEL、JSON Schema、YAML 等库，必须实测压缩后下载体积、冷启动时间、峰值内存、Package compile/build P50/P95 和 Worker 对 UI 的影响。先 lazy-load、单飞、独立 Worker 和资源上限；如果基准不满足可接受体验，不得偷偷转成远端服务，也不得降低 Compiler 规则。此时 Pages 版应如实保留 Editor Hint 并显示正式 Compile unavailable，原生本地版仍可使用 Go CLI；是否允许未来部署服务需另行明确授权。

**目标调用链：**

~~~text
GitHub Pages static assets
  -> user explicitly selects "Validate / Build"
  -> Host Adapter snapshots unsaved Package + generation
  -> dedicated Worker lazy-loads pinned Go wasm + wasm_exec.js
  -> initialize pinned Core Schema + safe Registry Snapshot + exact dependency map
  -> compiler.CompileFiles(files, options)
  -> if VALID and Build requested: skillbuildartifact.BuildFromPackage(...)
  -> return ValidationReport / Artifact bytes + all input/compiler digests
  -> Problems / Build output, source = TOOLCHAIN_COMPILER
~~~

Go/WASM 方案是当前 Pages-only 的**首选待验证方向**，不是已通过构建或浏览器验收的事实；在 GOOS=js GOARCH=wasm 构建、真实 Chromium Worker、Native/WASM conformance 和性能基准完成前，状态保持 VERIFY。远端 HTTP Compiler Service 仅是未来用户明确允许服务器部署时的备选，不是当前在线方案的依赖。

诊断约束继续有效：Toolchain Finding 目前主要提供 path 与可选 pointer，不保证 UTF-16 range。只有在当前同版本 Source 上唯一映射成功时才定位到具体位置，否则显示文件级/路径级问题。Editor Hint 和 Toolchain Compiler Finding 必须保留不同来源、版本与适用范围。

#### 4.10.5 当前 PR 与后续收敛门禁

- LSP #100 / #103：Shared Core 可包装旧 JS 分析器，但这些 Editor Checker 不能成为规范性 Compiler。
- 多文件 Designer #122：只读 Contract / Predicate 展示和精确引用导航允许存在；不得复制 Go Compiler 的 GraphIR、Composition 或 Runtime admission。
- S1：按真实 Toolchain 版本建立字段级 ownership map，区分 OWNER_SCHEMA / EDITOR_HINT / COMPILER_CHECK / AGENT_LINK_TIME / RUNTIME_ONLY，至少覆盖 Entry、Dependency、Binding、Predicate、Capability、Outcome/Effect、Digest。
- S2：优先实现 Schema / Conformance / Diagnostics Bridge，不先把 Go Compiler 翻译成 TypeScript。
- S3：Host Adapter 仅预留 compilerValidation capability；没有真实 adapter 时不显示假编译成功。
- Agent Demo 的 Python MockCompiler / Linker 与正式 Toolchain 的长期收敛需要独立跨仓审计；不能通过把逻辑搬进 Studio 来解决。

**结论：LSP 是编辑体验；Toolchain 是正式编译与构建语义；Agent Host Linker 是执行前绑定与冻结；Runtime 是运行权威。它们应共享明确版本的机器合同和验证证据，而不是各造一套正式编译器。**

## 5. Source 与语义权威不变量

以下规则在任何架构调整中都不能降低：

1. 原始 SKILL Package 文件是唯一业务真源；Graph、Inspector、Outline、Evidence、缓存和选择状态都是派生视图。
2. YAML 按 YAML 1.2 处理；尤其保留字符串键 'on' 的语义、注释、引用、BOM、CRLF 和原始 Source 表达。
3. Source range 必须来自当前解析的同一份文本；不能从显示名称、行号猜测写入范围。
4. 所有异步分析必须关联 Package generation 和 Document version；旧结果必须丢弃。
5. 当前打开的未保存文本优先于磁盘内容。跨文件引用分析必须使用同一 Package generation 的一致输入。
6. 缺失、超限、不可读、解析失败、歧义和未知语法必须可见；不得转化为 READY 或“无问题”。
7. 精确引用与启发式提示必须区分；类型名称相同不等于完整 ABI 兼容。
8. 视图层的 PASS / FAIL / UNKNOWN 只表示 Source 声明或静态分析能证明的内容，不是 Runtime 观测结果。
9. Owner Schema、Skill Source Snapshot 和 Toolchain Snapshot 是不同来源身份，必须分别记录，不得合并成一个含糊的“版本”。
10. 任何新视图都不得修改 ca-agent-demo、ca-skill-toolchain、Runtime 或其他 Owner 仓库。

## 6. 现有模块的初步归属建议

这是基于当前消费者的初步归属，不是立即改目录或删代码的清单。

| 当前模块 / 区域 | 当前角色 | 稳定后处理建议 |
|---|---|---|
| site/workspace.mjs | 当前 Procedure YAML 1.2 投影，Classic / Theia 共用 | 保留行为和测试，先包装进 Language Core；不重写解析规则 |
| site/semantic.mjs | 较早的 Procedure 投影，被 graph / 固定 Legacy Patch 路径引用 | 设为兼容边界；查清消费者并迁移/退役后再删除 |
| site/graph.mjs | Legacy projection re-export 和基础布局回退 | 迁移消费者后评估是否删除或改成纯布局适配 |
| site/package-audit.mjs | Package 级编辑期诊断 | 先保持规则和负例；再逐步移入 Core，禁止双重诊断所有者 |
| site/script-navigation.mjs | 精确 Script / Predicate / Schema 引用导航 | 迁移为共享符号/引用索引，保留歧义拒绝 |
| site/python-outline.mjs | 有界 Python 顶层符号词法索引 | 保留为 lexical outline；不冒充 Python Parser / Type Checker |
| site/yaml-owner-schemas.mjs、site/yaml-schema-policy.mjs | Owner Schema pin 和适用范围策略 | 保持 Owner 版本和 applicability 独立可追溯；不自行扩张 Procedure Schema |
| site/monaco-language.mjs | Monaco 路径语法模式选择 | 留在编辑器适配层，不纳入语义 Core |
| site/node-*.mjs、site/phase-*.mjs、site/route-*.mjs、site/patch.mjs | 有界 Source-backed Proposal / Patch 规则 | 保持具体操作模块；只抽共享协议，不合并不同操作资格 |
| experiments/ide-host/vscode/src/workbench.mjs | Host 生命周期、Package FS、命令与原生视图适配 | 稳定后拆成薄 Host Adapter + Application Services，不在当前 PR 链中重写 |
| experiments/ide-host/vscode/src/inspection.mjs | Theia Inspector / Outline / Evidence UI 投影 | 保留为 Host View Adapter；投影事实逐步来自共享 Core / Designer |
| site/app.mjs | Classic 完整应用 Shell | Classic 退出前保留；不把整份 UI 强行抽成共享核心 |
| site/sample-packages.mjs、site/samples/packages | 内置样例 manifest 与固定 Source fixture | 保持固定 SHA；按 Owner 兼容性单独刷新，禁止自动跟随 upstream main |
| experiments/ide-host/lsp-browser、language/* | LSP Transport / Language Core 的并行实现 | 以实际合并后的 Core 契约为准；未合并前不假设 main 已拥有这些模块 |
| site/contract-projection.mjs（PR #122） | Contract C0 独立只读投影 Spike | 可作为验证样例；后续接入共享 YAML / Language API，不能成为第二个 Package 诊断或解析权威 |

特别说明：semantic.mjs 当前并非已证明无用。它仍被旧 graph / 固定 Ensure 兼容 Patch 路径引用。即使 Ensure 不再是可选示例，也不能仅凭“产品不再展示”就删除其回归路径；必须在独立变更中确认消费者、迁移测试和删除条件。

## 7. Owner 边界与样例治理

Studio 是 SKILL Package 的编辑器，不是 SKILL 规范制定者。

- ca-agent-demo 拥有其 Demo Skill Source、Agent Host Loader 和对应的 Owner 契约。
- ca-skill-toolchain 拥有正式 Toolchain / Qualification 语义和对应 Schema。
- Runtime / Tool Registry / Capability Provider 拥有执行、资格、真实副作用和运行证据。
- Studio 可以显示 Source 声明、固定 Schema 检查、精确引用和启发式提醒；不得把这些提升成 Runtime 资格或真实执行结论。

示例 Package 应固定来源 commit 和文件清单。刷新样例时单独审查文件变化、Schema 兼容性和视图覆盖，不自动追随 upstream main。后续增加 MAS 或其他 Skill 示例时，先判断 Package 是否有 Procedure、Contract、Predicate、Script 等文件；没有的能力应自然隐藏或 Source-only，不强行套用 establish-pdu-session 的结构。

本地执行和 Run / Debug 继续后置。未来若增加，必须由明确授权的 Host / Runtime Provider 提供能力；打开文件、预览或导入 Package 绝不触发执行。

## 8. 稳定后收敛路线

### S0 · 当前并行工作稳定化（现在进行，不做架构大改）

继续完成或明确延期现有工作流：

- Theia parity：将 Issue #95 中能由当前 Owner 契约支持的工作完成；跨 Producer ABI、effectful Step 和新 Outcome 词汇等缺 Owner 证据的项目明确保持 Source-only / Deferred。
- LSP：按 #100 的 L0/L1/L2 顺序验证 Shared Core、Worker、Completion / Hover / Definition / References、Package 版本一致性和失败降级。真实 Theia Chromium 是必要证据；VS Code Web / Desktop 不得从 Theia 结果自动推定。
- Multi-file：PR #122 已提出 C0/C1/C2 的 Contract / Predicate 只读候选。必须逐项核查最新 exact-head CI、真实 Chromium、原生 Source/Undo 与 Procedure 互不干扰；未合入前不得写成 main 已有能力。集成应保持独立文件类型 selector，不扩大 Procedure Editor selector。
- Docs：PR #121 已落地；待 PR #101 合入后，再统一刷新 docs map、WORK、TRACEABILITY、README 和旧 ADR 的状态。
- Performance：建立当前 Pages / Theia 的冷启动、文件打开、输入响应、Package Audit、LSP、Procedure layout / render 基线；增加可复现的多规模 Package / Graph 压力样例。先测量和定位，不以猜测为依据提前重写缓存或调度器。
- Technology / language selection：盘点实际运行时依赖、JS/TS 检查覆盖、浏览器兼容、Worker / Host API 和 Bundle；按「保留 / 待验证 / 可替换」记录每项状态、证据、缺口、复审触发与转换门槛。默认保留 React / React Flow / ELK / YAML Parser / Theia 在线宿主，新增共享核心优先 TypeScript；只有基准或能力缺口提供证据时才重开替换决策。
- Compiler WASM：只做源码可行性核对和边界设计，不在当前 LSP / Designer 并行分支里改 Toolchain。确认 CompileFiles / BuildFromPackage 的内存调用、Registry/Dependency 的文件系统耦合、公开 Registry 字段与 Go WASM 依赖闭包。

本阶段允许各工作流继续独立实现，但不做跨工作流的大范围改名、目录搬迁、双宿主重写或第二套通用框架。性能基线与观测可以并行进行，但不应改动其他工作流正在使用的公共模块。

### S1 · 架构基线对齐

进入条件：

- Theia 当前主线功能有 exact-head 测试证据；剩余缺口逐项标记为完成、明确延期或 Owner 阻塞。
- LSP 的共享分析 API 和 Theia Worker 生命周期已稳定；失败时 Source 编辑仍可用，过期结果不会复活。
- Multi-file C0 已有单测、Typecheck、Build 和真实 Chromium 验收；未集成的 UI 明确标为未实现。
- main Pages 与文档中的 Source SHA / 构建 SHA 一致。
- 不存在正在修改同一公共模块的未协调 PR。
- 已有可重复的性能基线，覆盖冷/热启动、编辑响应、Package 分析、LSP、图布局/渲染和 Package 切换；已识别主要瓶颈和缓存/任务所有权。
- 已形成可追溯的技术栈 / 语言选型 ADR：每项采用三态「保留 / 待验证 / 可替换」，并附 SHA、验收事实、证据缺口、状态转换条件；明确 TypeScript 覆盖门槛、Browser Worker / Node Transport 和在线宿主兼容要求。
- 已形成跨仓 Compiler/LSP/Agent Linker 语义所有权矩阵，明确编辑期提示、正式编译、绑定链接和运行期判定的边界及固定 Owner 版本。
- Go/WASM 可行性 Spike 已完成：Toolchain 内部 WASM 入口可构建；Registry 和依赖可由固定内存输入初始化；无敏感 Registry 字段进入公开资产；真实 Chromium Worker 与原生 Go 对同一 fixtures 的报告/Artifact Digest 一致；性能、包体积和内存达到校准预算。若未通过，记录明确阻塞并维持 Pages 正式编译 unavailable。

动作：更新架构 ADR、文档地图、模块 Owner 表、依赖图和性能预算。只做文档和接口对齐，不进行行为重写。

### S2 · 统一 Language Core

- 逐个将现有 Procedure projection、Package Audit、Script Navigation、Python Outline 接到共享 Core。
- 先包装旧实现，再以 characterization tests 证明兼容，最后单独迁移实现。
- 统一 Package Snapshot、Analysis State、Diagnostic、Symbol、Reference 和 Source Range 契约。
- 在 Language Core 稳定后，单独接入 Toolchain Compiler WASM Worker：复用当前未保存 Package Snapshot，显式 Validate / Build，结果携带 Compiler/Schema/Registry/Dependency/Source digests；不将完整 Compiler 运行混入逐键 LSP。
- 迁移期间每项诊断只能有一个发布者；Classic 可以暂时直接消费 Core，Theia 通过 LSP 消费相同 Core。
- semantic.mjs / graph.mjs 只在所有实际消费者和测试迁移后退役。

完成标准：同一 Package generation 在不同 Host 得到一致的分析身份、诊断和引用结果；无第二套 YAML 语义；所有旧正负例仍通过。

### S3 · 收敛 Workbench Application Services 与 Host Adapter

- 从 Classic / Theia 编排中提取 Package Session、导航、Selection/Reveal、Problems、Command Routing 等纯应用服务。
- Theia / VS Code 只保留各自的文件系统、文档生命周期、命令注册和原生编辑 API 适配。
- 不合并两个 UI Shell；不让应用服务依赖宿主 API。
- 先以一条跨宿主的垂直能力验证接口，再迁移其余能力。
- Online Pages Host Adapter 调用固定版本的 WASM Worker；Local Host Adapter 调用同一 Toolchain revision 的原生 Go CLI。两者共享请求/结果合同和 conformance fixtures，不分叉编译语义。

完成标准：新建一个 Host Adapter 不需要复制 Procedure / Contract / Predicate 投影和 Patch 规则。

### S4 · 多文件 View Provider

按 C1 → C2 → C3 → C4 顺序逐个交付，或根据实际 Package 使用频率调整，但每项都要满足：

- 使用同一个 Package Session 和共享分析事实。
- 原始 Source 随时可打开，视图结果标注 READY / PARTIAL / SOURCE_ONLY。
- 跨文件链接必须能回到真实 URI / Source range；未解析或歧义引用不生成假链接。
- 只读视图先于可写视图；每个写操作都单独定义资格、负例和 Patch。
- 视图类型决定呈现形式，不要求全部采用 React Flow。

完成标准：新增一种文件视图只需实现该类型的投影和 UI，不需要复制 Package 生命周期、诊断、导航、版本检查和 Source 写入机制。

### S5 · Classic 退出评估与目录整理

只有在以下条件全部满足后，才考虑退出 Classic 的默认构建或删除其独立部署：

1. Theia 覆盖用户需要的全部核心编辑流程，未迁移功能已有明确处置。
2. 关键回归用例已迁移到共享 Core / Host integration / Chromium 测试。
3. Classic 不再是任何唯一业务规则、Patch 资格或分析能力的唯一消费者。
4. 用户确认在线 Theia 和目标本地宿主满足日常使用要求。
5. 保留历史示例、测试夹具和必要的兼容说明；删除动作有独立 PR 和可回滚路径。

Classic 也可以长期保留为只读兼容入口；是否删除是产品决定，不是架构洁癖。

## 9. 明确不做的事

- 不重写 YAML Parser，不为了统一而一次性改写所有现有分析规则。
- 不把所有 YAML、Markdown、Python 都转成流程图。
- 不建立第二套 Skill DSL / Runtime Validator / Tool Qualification。
- 不让 LSP 直接写 Source，不让 Webview 自己成为 Source owner。
- 不根据名称或类型相等推断完整 Tool ABI、跨 Producer 兼容或业务正确性。
- 不把浏览器 OPFS、ZIP 下载或 localhost 误称为 Git 同步、原生磁盘工作区或 Runtime。
- 不在当前稳定化期间把 experiments 路径全面改名，不批量搬迁文件。
- 不因为 Classic 与 Theia 都有 UI 就强行合并成一个巨大前端应用。
- 不提前选择 Electron、Tauri、Python、WSL 或某种本地执行 Runtime。
- 不把未来 LLM Skill 路由或 Agent 执行逻辑放入 Studio。

## 10. 当前风险清单

| 优先级 | 风险 | 当前处理 |
|---|---|---|
| P1 | Host / Workbench 编排层职责过多 | 稳定后抽取应用服务；现在不拆正在变更的文件 |
| P1 | 多条分析链路可能形成重复语义或重复 Diagnostics | 以 Language Core 为目标；迁移期间指定唯一规则所有者 |
| P1 | 多文件视图容易各自造 Parser / Package 状态 | PR #122 C0 先保持只读；C1 集成必须复用统一 Package / Analysis 契约 |
| P1 | 视图投影与写入资格混淆 | 每个 View 明确 read-only / writable capability；写入仍走 Host Patch |
| P1 | Package / LSP / Designer 重复读取、解析和布局，导致交互阻塞及内存膨胀 | 建立分层性能基线、增量分析、统一缓存失效、任务优先级和资源上限 |
| P2 | Classic 与 Theia 双份应用编排长期维护 | 功能对齐后评估退出，不立即删除 |
| P1 | Pages-only 在线版无法启动 Go 服务，直接集成原生 Compiler 不成立 | 以 Go/WASM + 专用 Worker 为首选待验证；若构建/性能不达标则明确 unavailable，不暗中引入服务端 |
| P1 | Studio LSP 与 Toolchain Go Compiler 容易出现两个正式语义 owner | 固定 Owner Schema / Conformance、保留诊断来源；用可选 Compiler Bridge，不让编辑期 READY 冒充 Compile VALID |
| P1 | JS / TS 混合但 typecheck 覆盖有限，容易形成“安装了 TypeScript 就认为核心有类型保障”的错觉 | 新共享核心严格类型；逐模块提高 JS 检查覆盖，CI 报告实际覆盖文件 |
| P2 | Spike / experiments 命名留在正式代码路径 | 稳定后改名；改名前确认构建、Pages、插件清单和路径引用 |
| P2 | 文档中的宿主状态、样例 SHA 和合并状态漂移 | 等 PR #101 / #121 合入后统一刷新 |
| P2 | VS Code Desktop / 本地 OS 授权证据不足 | 单独建立真实宿主验收，不从 Browser-only 结果推断 |

## 11. 本文的验收与后续维护

本文当前只要求：

- 记录当前架构事实和并行开发状态，区分 main 已有能力与 PR 中候选能力。
- 形成可审查的技术选型三态规则和初始分类；状态不等于替换授权，也不宣称未经实际测试的性能/桌面能力 PASS。
- 冻结建议的依赖方向、Source 权威、Owner 边界和稳定后实施顺序。
- 不修改现有业务实现、编辑器注册、LSP Worker、Package 示例或 Pages Workflow。
- 不声称任何新的测试、构建、浏览器、部署、Runtime 或 5GC 验收已经通过。

待 S0 稳定后，重新审查本文的基线 SHA、开放 PR 和模块消费者，再决定是否将 Proposed 决策升级为 Accepted ADR。PR #101 合入后，再把本文加入 docs/README 的文档地图。任何实施任务应从 S1 开始拆成小型、可回滚、可独立验收的 PR。

## 12. 待稳定后再决策的问题

以下问题现在不需要提前定死：

1. File View Provider 最终是静态注册表、内部扩展点还是正式插件 API。
2. Contract / Predicate 视图是否成为默认打开关联，还是保留用户原生编辑器偏好。
3. Classic 最终保留只读入口还是完全退出。
4. VS Code Desktop 是否作为正式支持宿主，以及是否需要独立 Node LSP Transport。
5. Python 是否需要真正的语言服务器、格式化和静态类型检查；现有词法 Outline 是否已足够。
6. 未来本地文件授权和 Runtime 执行由哪个 Host Provider 提供。

**最终判断：先稳定当前三条主线，再按 S1–S5 渐进收敛。现在最重要的是守住边界，不让并行开发互相污染；不是立即把所有模块重排一遍。**
