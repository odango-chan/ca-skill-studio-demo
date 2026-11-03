# ConnectionAgent Skill Studio Demo

ConnectionAgent Skill 的独立开发与编辑原型。在线 Pages 托管的是**无后端的浏览器前端**，不是 Agent Runtime。


## Current milestone · D2 Node Designer (2026-11-03)

D1 React Flow migration and Chromium mouse-interaction smoke have passed on main.
D2-A1 adds a **generic Node ID rename** via a source-preserving, guarded multi-span
YAML patch with Diff preview, confirmation and Undo/Redo. It updates the current
Procedure start, inbound Route targets and explicit from references; unsupported
references fail closed. No CreatedSession-specific Node mutator was added.

**Still not implemented:** Node creation/deletion, generic operator/phase editing,
full package import, whole-package Runtime validation and in-place filesystem save.
See [D2 Node Designer](docs/D2-node-designer.md).

## 在线预览

https://odango-chan.github.io/ca-skill-studio-demo/

当前实现（Stage: Direct Canvas Controls + Explorer-owned Collapse + Aligned File Tree）：

- **真实多文件 Skill Package 示例**：从固定 `ca-agent-demo@bf445ad` 源码精确归档 `ensure-pdu-session` 的 4 个 Runtime Asset 文件和 `establish-pdu-session` 的 13 个运行相关文件（SKILL.md、Contract、Procedure、Predicates、3 个 Script、6 个 Schema；不展示 Case）。文件树可切换编辑，修改留在各文件独立的浏览器内存工作副本，当前文件可单独导出、整套文件可导出 ZIP；不增加 Package 内的 sidecar 文件。
- **Source 语法高亮**：YAML、Markdown、Python、JSON 本地着色；源文件仍由原生 textarea 编辑，着色层只读、HTML 转义、滚动同步；超出 260K 字符或不支持的扩展名安全退回纯文本，不引入云端代码服务。
- **按文件能力决定 Visual**：Procedure YAML 当前投影 `READY` 时才有流程图；投影失败立即切到 Source，隐藏 Visual/Split、清除旧图且保留错误诊断。Contract / Predicate / Schema / Script 等没有专用预览的文件仅显示 Source，不再输出“无法投影流程图”的无效提示。
- **Markdown Visual = 文档阅读预览**：SKILL.md、其他 Markdown 文件在 Visual 显示本地渲染的标题、正文、列表、代码块、表格、引用与安全链接；Split 让预览和 Source 并排，输入时立即更新。原始 HTML 转义、危险链接不渲染、图片不主动请求外部地址。此实现是**安全的基础 Markdown 子集**，尚非完整 GitHub Flavored Markdown/MDX 渲染器。超出 300K 字符时仅开放 Source。
- **真实文件名单行显示**：资产树中的长文件名不再换行，自动省略并用悬停 title 提供完整相对路径；顶栏也维持单行文件路径。
- **来源驱动的更多枚举**：Ensure Verify Node 从该 Package `predicates.yaml` 选择；CreatedSession 的 Phase Verify Step 从其真实 PredicateSet 选择引用（具体步骤的折叠编辑区）；CreatedSession Route 目标从当前 Procedure 已定义的 Node 列表选择；Contract `planning.maxActions` 保留自由整数输入并增加常用预算预设。选择只负责局部 AST Scalar Patch 与完整源码 Diff、Revision guard 和重新投影；不代替业务正确性 / 3GPP Runtime 验证。
- 从真实 Demo Procedure YAML 投影 Control Flow；显示准确的 Node / Route entry 数量、原始 Operator、Outcome、Target。
- CreatedSession 样本支持 Root 和 5 个 Child Procedure 的下钻与返回，保留 Node 顺序和 Route Source（operator / preconditions / postconditions）；Phase Step 在 Inspector 按顺序展示，不把局部过程冒充业务 Node。
- **UX Consolidation**：删去重复的 Node Quick Card 和独立 Inspector 开关。单击 Node / Route 直接进入唯一的上下文 Inspector；关闭后回到宽画布。布局方向、标签策略、邻居焦点保留为直接操作，缩放放在画布左下。
- **UX Trim 信息减负**：移除重复的编辑器标题 / 文件状态、空 Problems 与运行时说明、重复计数和 Canvas 状态浮层；文件名与未导出修改只在顶栏显示，Procedure 面包屑与 Visual / Source / Split 合为一条紧凑工具栏。仅显示真正存在的 Preconditions / Postconditions / Routes，Node Inspector 默认以 Operator 和可折叠信息为主。Sample 与 Node Outline 按需展开，必要的 Source 错误与 Patch Diff 保留。
- **资产优先的左栏**：示例现在加载真实 Runtime / Model-context 文件组成的 Package（仅固定样本）；Local 文件导入仍是单文件。Root / Child Procedure 是 procedure.yaml 内部视图，Node Outline 默认为折叠的线性导航。Case、Design 和其他非运行相关文件不会出现在示例资产树里。
- **Inspector 统一入口**：准备、执行、确认、路由在一个上下文面板中，低频内容默认折叠；Phase Step 与 Route 仍保留原始 Source 路径和行号；只读与可编辑资格严格分离。
- 文件导出、Undo / Redo、Procedure Explorer、搜索、Root / Child 路径和 Visual / Source / Split 继续存在，保留旧的固定 ensure Route Patch 安全边界。
- **ELK layered 自动布局**：**默认从上到下（DOWN / 垂直）**，仍可切到从左到右（RIGHT / 水平）；正交边路径、画布平移缩放和适配；Node Outline 选择后自动居中；相邻视图只显示所选 Node 的入边/出边一跳，不改写 Source。ELK 暂时失败时的基础布局也会沿当前方向显示。
- **按 Route Source 分组而非语义合并**：画布上的连线按 `source + target + routeSource` 分组；点击同一组连线可轮流定位每个原始 Route，在 Inspector 查看原始 outcome、target、line；Phase 的 on 路由不与 Operator 的 on 混淆。ELK 失败时退回旧布局，并显示状态。
- Visual / Source / Split 三视图；画布支持平移、缩放、适配；Node Outline 搜索及按源码顺序导航；点击节点/边查看 Inspector 和 Source 行。
- 支持导入本地文本文件、直接编辑 Source、重置本地缓冲区、导出文件。
- **Ensure Route 编辑边界**：保持原来的严格约束，仅允许固定 ensure 结构中的两条失败 Route 修改为已有终态；必须 Preview Source Diff → Apply → 可撤销。CreatedSession Route 使用独立的 Source-backed Preview Patch，候选项限定为该 Procedure 真实 Node，并逐字段检查其他节点、步骤与路由没有变化。
- **Visual 连线目标拖动编辑（首条真实图形交互）**：单击现有 Route，若其 Source 取得编辑资格，连线上出现 ↗ 手柄；拖动到另一个允许的目标 Node，必须经 YAML Diff Preview → Apply，最终由 Source Patch + Undo/Redo 保存在浏览器工作副本。Ensure 仅两条失败 Route；CreatedSession 仅当前 Procedure 现有节点。拖到空白 / 原目标 / 未授权节点或编辑过程中 Source 变化，拒绝修改。**此操作是现有 Route 的重定向，不是新建连线、自动增删 Node 或调整 YAML 节点布局**。
- **NODES 纵向空间自适应**：桌面端展开时占用左栏文件区与底部操作之间的剩余空间，Node Outline 独立滚动，不再受 220px 固定上限；窄屏时使用更大的视口相对上限。仍保持按需折叠，避免恢复信息过载。
- **直接可见的画布操作**：取消「视图」下拉菜单；Visual / Source / Split、布局方向、邻居焦点、标签、定位、适配，以及适用时的属性开关与恢复按钮都在编辑区工具栏。放大和缩小按钮位于流程画布左下侧。左侧导航的折叠按钮置于 Explorer 自己的标题旁，收起后 Explorer 自身缩成一条醒目的窄栏，同一个按钮显示「展开导航」，无需依赖另外生成的恢复入口。
- **真实层级的资产树**：文件夹现在可以展开/折叠，文件以 ▤ 标示，Folder 内缩进与细连接线分层；Procedure 使用 ◆ / ├ / └ 区分 Root 与 Child，NODES 保持已有 Operator 标识。Folder 展开状态保留在浏览器当前会话的工作区内存中，即使编辑 Source 触发重新渲染也不会折叠。原有长文件名单行省略、鼠标悬停路径与未导出修改标记保留。
- **Procedure 层级修正**：Root / Child 不再额外列在所有文件的末尾，而是作为 `assurance/procedure.yaml` 的真正子层，紧跟该文件显示。文件名负责打开 Source，旁边的 ▸ / ▾ 负责展开或收起子流程；当前没有有效 Procedure 投影时收起子树。编辑、切换文件、返回 Root 后仍保留展开意图，且不重复创建树形导航。
- Source 修改与此受限 Visual Patch 共用**有上限的内存 Undo / Redo 历史**；每次 Source 输入事件视作独立事务，尚无打字分组或持久历史。
- 对未知或不支持的 Procedure 结构**拒绝重新投影**，自动切回 Source 并清除旧图，保留诊断与错误定位。不会把过期图伪装成新 YAML 的正确语义。
- 不上传用户文件、不调用 Capability、不执行 Skill 或 Script，不进行发布。

## 边界和兼容性

**图形投影基于 yaml@2.9.1 的 YAML 1.2 Document AST / CST source tokens 与 LineCounter，目前只有有限的 Source-backed 编辑资格，并非完整 Demo Schema / Runtime 校验。** 它拒绝重复键、Alias / Anchor / Tag、额外 Procedure、未资格化的 Phase 和不安全语法；不支持跨文件语义。其他文件（Contract、Predicate、Schema、Script、JSON）仍可 Source-only 编辑；Markdown 使用阅读预览，多 Procedure / CreatedSession 的限定局部编辑继续可用；不承诺这些文件获得图形投影。

Visual 当前在 ensure 单 Procedure 的**两条固定失败终态 Route**支持实验性 SetRouteTarget，并对 Ensure Verify 的 Predicate ref 提供独立的受限标量编辑。Contract 的 maxActions 则由 Contract 源文件的精确标量 Patch 实现。**CreatedSession 多 Procedure 的主 Operator、Binding、Procedure 结构仍只读**，但有限 Phase Verify Scalar 和 Route Target Scalar 已开放有界编辑；其余对象仍需在 Source 中修改。Patch 使用 YAML Scalar.range 确定真实 Source Span，只替换目标标量，绑定完整源文本 Revision、重新解析并比对全部 Node 和 Route 投影、冻结其余 22 条路由目标，保留所有未触及文本及注释。Preview 如果过期或被修改会拒绝应用。**这不等于完整 YAML CST Round-trip 或 Demo Validator 通过**，也不意味着已接入 Python POC；语义安全仍需人工检查。未知字段和复杂结构不能凭 Graph 自动修改。

当前文件导出及 Package ZIP 导出都是浏览器下载请求，**不是本地原文件的原地或原子 Save**。浏览器 textarea 可能规范化 CRLF；当前不承诺逐字节文件保真、完整 Source map 或跨文件事务，重要文件应自行比对 Diff 后再替换。此站点不与 packages/skill_studio_poc/ Python POC 通信。

样本来源：ca-agent-demo@bf445ad777149af5af2dfa0a5bdea18d0451303e 的 skills/ensure-pdu-session/assurance/procedure.yaml，来自本仓 PR #2 的固定 Fixture。完整 Demo 与 Live 5GC 验证 **NOT_RUN**。

## Actions / Pages

.github/workflows/pages.yml 支持 push main 的静态站点变更自动部署以及 workflow_dispatch 手动触发。Build Job 使用 Node 24 安装固定版本 yaml@2.9.1、elkjs@0.12.1 和 esbuild@0.28.2，执行 YAML CST / Typed Route Patch / ELK 布局回归测试，构建自包含浏览器 bundle（dist/），并发布 dist/ 到 Pages。package-lock.json 已与成功构建的 GitHub Actions 产物进行字节级 Git Blob SHA 对比并固定入库，流水线使用 npm ci 安装精确依赖。package-lock.json 已从通过的 CI 构建原样归档到仓库，后续统一使用 npm ci 进行锁定依赖安装。

- [Actions](https://github.com/odango-chan/ca-skill-studio-demo/actions/workflows/pages.yml)
- [PR #1 · UX / Architecture](https://github.com/odango-chan/ca-skill-studio-demo/pull/1)
- [PR #2 · Python Typed Patch POC](https://github.com/odango-chan/ca-skill-studio-demo/pull/2)

两条 PR 在此阶段保持独立、未自动合并。

## 下一阶段

下一阶段为真实浏览器 E2E 交互验收、选中节点的分支折叠与复杂回边标签避让，并评估是否有足够收益迁移 React Flow。随后接入完整 Demo Schema / 专用 Validator 的可执行一致性检查。目前 CreatedSession 的枚举 Patch 只证明源码结构未意外损坏，业务路径变化仍需单独验收。在图形层选型上，大图和可编辑连接线优先评估 React + TypeScript + React Flow / ELK，**当前 D1 已使用 React Flow + ELK；此处为早期阶段记录；ELK 只负责视觉位置与边路由，不改变 YAML 语义**。

当前只建设 SKILL 开发与编辑，不做 Case、独立验证工作台、Registry / Publishing、Agent Runtime 调用或 Live 5GC。

## UX Consolidation 实现边界

- Explorer 的 Procedure 树与 Node 列表只从当前解析投影生成；任何无法安全投影的 Source 都禁用图形选择与编辑。
- Inspector 的四阶段 Journey 纯属 UI 视图，**不改变 SKILL YAML 结构或引入新语法**，点击 Step 会定位真实 Source 行。
- 文件状态表示是否与本次打开时的文本相同；导出触发浏览器下载，不是直接保存回原文件，也不会替用户标记为已保存。
- 界面元素和投影模型由静态 / 模型层回归检查；真实鼠标、键盘、辅助技术及手机交互浏览器 E2E 仍需单独验收。

UX Consolidation 的自动化测试覆盖直接操作与单一 Inspector 控件、Node Journey 语义投影、Route Source 隔离和 Source Patch 边界。**真实浏览器 E2E、视觉截图与可访问性测试仍为 NOT_RUN**，部署成功不应等同于这些验收完成。

参见 [UX Consolidation / 与原始设计对照](docs/ux/ux-consolidation.md)。原始 authoring-first 设计仍在未合并的 [PR #1](https://github.com/odango-chan/ca-skill-studio-demo/pull/1)，当前单文件 Demo 不等于完整 Skill Package IDE。

## 多文件示例及属性编辑边界

- 确定性 Source Fixture 来自 `ca-agent-demo@bf445ad777149af5af2dfa0a5bdea18d0451303e`，`site/samples/packages/` 下的样本逐文件保留 upstream Git Blob；静态目录只用于浏览器下载，不等于实际已装载 Runtime。
- 当前 Bundle 是单浏览器页面的临时内存工作副本，文件切换不会丢掉尚未导出的文本。每个文件保留自己的 Source + Patch Undo/Redo 历史；**不承诺多文件跨资产事务、文件系统保存、外部变更冲突管理或多文件 Schema / Runtime Validator**。
- 更改 Verify Predicate 的引用属于行为语义修改：即使目标 Predicate 在 Package 中存在，也不证明门禁或业务流程正确；修改后必须经 Demo Validator 和人工审查。更改 maxActions 也只检查数值及 Source 结构，不验证整体预算策略。
- Browser ZIP 是无压缩 UTF-8 标准 ZIP（store method），包含文件内存最新内容，不添加隐藏元数据。它不自动覆盖原文件，不执行 Python Script，不运行 5GC。
- **完整本地 Package 文件夹导入、文件创建 / 删除、Contract 全字段表单、Predicate 定义 / Binding 编辑仍 NOT_IMPLEMENTED（Phase Verify Step 引用编辑已实现）**；本轮的目标是验证真实多文件浏览与安全的有限属性编辑。

## 编辑器细节（2026-11-03）

- Source 高亮是独立的只读 HTML 转义渲染层，不是语言服务或自动格式化；不修改 textarea 内容和 Undo/Redo。编辑区是无自动换行的等宽字体，输入、光标、选择和滚动以 textarea 为权威。
- 文件树采用单行省略号，完整相对路径通过浏览器的悬停提示查看。
- CreatedSession 的 Predicate 候选值由 `assurance/predicates.yaml` 定义；Route 候选值由选中 Procedure 内已有的 Node ID 定义。新字段通过精确 Source Span、修改前后投影比对和完整 Source Revision guard；仅保证结构隔离，不保证业务语义、运行成功或新路线无环。
- 保留既有 Ensure 失败 Route 限制，未扩展原 Patch 的编辑资格。Contract 的 maxActions 预设是快捷输入，不是 SKILL DSL 内建枚举。

## 文件类型视图规则（2026-11-03）

| 文件 / 当前状态 | Visual | Source | Split |
| --- | --- | --- | --- |
| Procedure YAML，当前版本成功投影 | 流程图 | 源文本 | 图 + 源文本 |
| Markdown / SKILL.md（300K 字符以内） | Markdown 阅读预览 | 源文本 | 预览 + 源文本 |
| Contract、Predicate、Schema、Python、JSON 等 | 不显示 | 源文本 | 不显示 |
| Procedure YAML 解析 / 投影失败 | 不显示，旧图立即清除 | 源文本 + 错误定位 | 不显示 |
| Markdown 超出预览限制 | 不显示 | 源文本 | 不显示 |

Visual 仅表示有可用的可视化表达，不暗示完整的图形编辑资格。Markdown 预览的阅读内容派生于当前 Source，不参与文件导出和 Undo/Redo。工作区文件类型切换和源码语法恢复均不会替用户覆盖 Source 或自动应用修改。

## 下一条图形编辑纵切的边界（2026-11-03）

1. 当前实现的是 **Existing Route Rewire**：先选中连线（多路复用边可再次点击切换到具体 Outcome），再拖动连线上出现的 ↗ 手柄到新目标节点。右侧 Inspector 的 Route Target 下拉仍可作为备用入口。
2. 仅当现有 `routeEditTargets` / `createdRouteTargets` 返回候选目标时展示手柄。拖动只构建预览，不直接修改 YAML；统一经过 Source Revision 检查、原有 Typed Patch 的重解析和 Diff 确认。ELK 继续负责自动布局。
3. **未实现**：新建/删除/复制 Node、连接线以新建 Outcome、Node Operator/Phase 的通用编辑，以及拖动布局位置的持久化。这些需要独立类型化 Source Patch 与 Runtime 语义资格，不通过假 UI 宣称完成。
4. NODES 列表已取消桌面端固定高度与双重滚动截断。真实浏览器拖拽、触控、焦点导航和截图视觉回归仍属 NOT_RUN，不因静态测试与 Pages 部署成功而自动视为 PASS。

## Navigation polish (2026-11-03)

- No generic View dropdown: modes and relevant graph display controls are visible in the toolbar; canvas zoom is anchored at the lower-left of the graph.
- Asset groups reflect file paths, not invented Skill metadata; disclosure stays expanded/collapsed across reactive tree rebuilds.
- Procedure hierarchy is navigation within procedure.yaml, not a separate file or a second authoritative representation.
- When there is no qualified Inspector context, the toolbar hides the Inspector action rather than presenting a dead button.
- Browser interaction, screen reader and responsive visual E2E remain NOT_RUN.

## Procedure navigation nesting (2026-11-03)

Previously the `procedureTree` was a sibling of the entire `assetTree`, so even though its items referred to `assurance/procedure.yaml`, they appeared after all assets. It now has one stable DOM identity, mounted inside that source file's row with a separate disclosure control. The nav is only shown for the currently selected Procedure document with a READY projection. When unavailable it remains hidden, not incorrectly relocated to the explorer footer.

This is a navigation and layout fix, not a YAML restructuring or a second source of truth. The file and its children are not separately exported. Static DOM integrity and layout tests cover the relationship; interactive browser visual checks remain NOT_RUN.

## 2026-11-03 · Sidebar and graph controls

The Explorer owns its collapse button beside its title. When collapsed, the Explorer itself remains mounted as an accessible 54px strip; the same toggle visibly reads "展开导航". No secondary rail or disappearing aside is involved. The editor toolbar contains graph layout, neighbor focus, label visibility, centering, fit and editing modes without a secondary View menu. The zoom pair is inside the left edge of the graph canvas. Contract and procedure.yaml stay aligned at the same asset-tree depth using equal-width disclosure gutters; only Root/Child Procedure entries are indented under procedure.yaml. Automated source/UI assertions cover these relationships; browser-driven interaction remains NOT_RUN.

### 2026-11-03 · Collapsed Explorer recovery fix

The previous implementation used `explorerPanel.hidden=true` and relied on a separate 27px chevron in a rail. Users could not reliably find the way back. Now the Explorer itself stays in the DOM and visible when compact; its sections are hidden only by CSS, the header and the same collapse/expand button remain visible. The compact state uses a tinted 54px strip with a clearly labeled expand action; on narrow/flex layouts it becomes a horizontal strip. This avoids the hidden-parent problem and creates a consistent location for both actions. Automated tests assert the DOM identity, state transition, and breakpoint-specific visible styles; browser-driven E2E remains NOT_RUN.

### 2026-11-03 · Default vertical Procedure graph

- On first load the layout select and the ELK renderer use `DOWN`, so Procedures flow from top to bottom. Users can still select `RIGHT` for horizontal layout; this remains a visual option only and never rewrites the SKILL source.
- The basic fallback layout now honors the chosen direction instead of flashing a horizontal-only graph while ELK initializes or fails. The SVG fallback also draws the fallback edge paths in the matching direction.
- Current renderer remains dependency-light DOM SVG plus ELK layered (`elkjs`); React Flow is installed as of D1. For a future general-purpose Procedure Designer, evaluate `@xyflow/react` for node/edge interaction while retaining ELK for layout and YAML Source Patch as the editing authority. Do not migrate just to change layout direction.

## Procedure Designer D1 · React Flow canvas

完整迁移界限及 CreatedSession 验收依据见 [D1 Procedure Designer](docs/D1-procedure-designer.md)。D1 使用 React Flow + TSX 替换原生 SVG 画布，ELK 继续负责默认垂直的自动布局；文件树、Source/Preview/Split、Inspector、CST/AST、Typed Patch、Undo/Redo 与 ZIP 均保持原有实现。React Flow 的节点和边不是另一份业务权威模型。CreatedSession Root 以 17 Node / 65 Outcome 为回归基线。

此阶段支持 Node、Route 选中与子 Procedure 钻取；重新连接现有 Route 仍需要通过现有资格检查和 YAML Diff 才能生效。新建/删除 Node、创建 Route、修改 DSL 及持久化拖拽坐标不属于 D1，不能以图形变化假装修改了 Skill。真实浏览器 E2E 仍是单独验收项。

### React Flow D1 · CreatedSession Route visibility fix (2026-11-03)

The source projection for CreatedSession contains 17 Root nodes and 48 bundled routes representing 65 original Outcomes. A first Chromium smoke found only 39 rendered SVG paths (all nonzero): the initial smoke was insufficient because it checked visible paths but did not verify the entire expected bundle count. The new smoke must render all 48. In the tall default DOWN layout, initial fit-to-view scales ~2px SVG stroke widths to fractions of a display pixel, so routes can appear to disappear although the semantic projection is complete. React Flow paths now use visible higher-contrast, **non-scaling-stroke** rendering, retained pointer hit areas, and direction markers. Broad legacy `.graph-pane svg` styles have been removed to prevent React Flow SVG interference. Browser smoke now asserts **actual visible path CSS** and non-scaling strokes on CreatedSession, in addition to the existing source/projection counts; it runs before Pages deployment. No SKILL YAML/Typed Patch semantics changed.

### Explorer 文件图标主题（2026-11-03）

左侧 Explorer 按文件后缀使用本地 SVG 图标而非统一的 `▤`：YAML/YML 使用洋红色 Y；Markdown/MD 使用蓝色 M↓；Python/PYW 使用蓝黄双色 PY；JSON/JSONC 使用琥珀色 `{}`；Shell、文本与常见源码有各自主题，未知后缀保留通用文件图标。文件夹使用可展开/收起的暖金色图标。图标均为装饰性 `aria-hidden`，可访问名称仍由文件路径提供；不修改导入文件、YAML、Procedure 导航或 Package 导出。固定映射与 SVG 结构有 Node 回归，Chromium E2E 还会检查 CreatedSession 中实际出现的 YAML、Markdown、Python 与文件夹图标。

### Procedure 箭头与连线接点精修（2026-11-03）

- **原因**：之前的连线使用 React Flow 的 BaseEdge，但路径是 ELK 的正交路由（不是 React Flow 的默认 Bezier）。单个居中的 React Flow Handle 与 ELK 每条 Route 的边界端点不一致；同时人为指定 24×24 实心 ArrowClosed，使箭头相对非缩放线宽显得过粗。
- **调整**：保留 ELK 分流路径以免 CreatedSession 的不同 Route / Outcome 重叠，但将 ELK 的起止端点映射成真实的、每条合并 Route 专属的 React Flow Handle；连接端点跟边界准确重合。箭头改用 React Flow 内置的轻量 Arrow（细线、非填充、13×13），边线降为更克制的非缩放宽度，不再自行绘制第二套箭头。
- **验收**：Node 测试核对 17 Node、48 个可见边束、65 Outcome，逐条校验 ELK path 与 React Flow Port 的坐标；Chromium UI 检查 48 条实际连线的可见性和 96 个端点的屏幕空间对齐。整个流程仍通过 YAML Source 和 Typed Patch 管理，连线/端口都只属于 UI 投影。
- **后续优先级**：先补真实浏览器的 Route 选择与 Inspector、重连预览/拒绝、Split/Undo/Redo、小屏浏览验收，再进入 D2 Node Designer；大型流程可交互性和线条标签密度属于持续视觉优化，不要为了“默认连线”破坏 ELK 的分流能力。

#### Port 边框偏移修正

React Flow 的自定义 Node 存在普通 1px、选中 2px，以及起始节点左侧 4px 边框。HTML 绝对定位的 Handle 相对其 padding edge 定位，因此仅使用 ELK 的局部坐标会产生 1–4 CSS 单位的端点偏差，在放大时更明显。每条 ELK Port 的 top/bottom/left/right 现在按当前 Node 边框宽度扣除对应偏移；Chrome 的真实边路径到 Handle 屏幕坐标误差须低于 1.5px。此修正仅影响视图坐标。

### D1 浏览器交互回归门禁

已扩展 Chromium 自动化，从原先只验证可见连线和文件图标，进一步覆盖 CreatedSession Node→Inspector、Route→Diff 预览/取消/应用、Undo/Redo、Source/Split 同步、非法 YAML 的 fail-closed 与恢复、Child Procedure 返回、导航折叠、缩放和布局切换。这些是对真实浏览器页面的交互验收，而非单纯静态断言。空心箭头由 13×13 调至 16×16，保持 ELK 连线和 React Flow Handle 原有一致性。相关验收边界见 [D1 文档](docs/D1-procedure-designer.md)。

### D1 最终交互补测：实际 Route 拖动可用

原 CSS 在 `.react-flow__edges` 上设置 `pointer-events:none`，会让原生 React Flow 连线端点拖动不能工作。现在保留 ELK 连线但允许 Edge Updater 正常接收鼠标事件；Headless Chromium 真实 `Input.dispatchMouseEvent` 验证从边端拖到另一个节点的合法 Handle，显示实际 YAML Diff，取消时 Source 不变。另覆盖 Inspector 编辑、Source/Split、Undo/Redo、Child Procedure、布局和窄屏导航等。箭头保持 React Flow 内置细线 `16×16`，不引入新编辑器语法。详见 [D1 验收记录](docs/D1-procedure-designer.md)。
