# Current Authoring Workbench · Source-backed Editing

**Status: Accepted · Date: 2026-11-03**  
**Verified implementation baseline: `main@69bd8ef5900c68fff85653619eda770599ac9d3a`**

本文件描述当前浏览器应用行为；早期 [UX Consolidation](../ux/ux-consolidation.md) 的“View 菜单 / CreatedSession 只读 / 单文件视图”为已退役阶段描述。

## UI / Source flow

- 顶部：当前文件名、Dirty、Undo/Redo、导出。内存文件工作副本为唯一可写源。
- Explorer：固定样本 Package 实际文件和路径；`procedure.yaml` 的 Root/Child 是**当前文件内**的导航子树。Root workflow 图标、Child git-branch，不能冒充两个不同文件。
- NODES：可折叠当前 Procedure 顺序导航，按 Operator 图标区分。主画布由 React Flow + ELK 投影。
- Visual / Source / Split 同一工作副本；布局默认 DOWN，可切 RIGHT；邻居视图、Route 标签、定位、**适配全部 / 横向铺满 / 纵向铺满**直接在 toolbar，Zoom ± 仍在画布左下。**没有 View dropdown**。横向/纵向只缩放并居中当前 Procedure 的可见节点范围，允许另一轴溢出；默认打开仍使用适配全部。当前选择会在布局重算和浏览器调整尺寸后继续应用，切换文件后恢复为适配全部。
- 单一 Inspector：选中 Node/Route 后按 `preconditions → operator → postconditions → routes` 显示；Phase Step 在 Inspector 内，不创建假业务 Node。
- Problems：语法失败及 editor-only warnings，**不是 Runtime Validator**。

| File / state | Visual | Source | Split |
|---|---|---|---|
| Procedure YAML 当前投影 READY | React Flow | 编辑 | 图和 YAML |
| SKILL.md / Markdown 安全子集 | Markdown 预览 | 编辑 | 预览和文本 |
| Contract / Predicate / Script / Schema / JSON | 无专用图形 | 编辑 | 不适用 |
| Procedure 解析/投影失败 | 清除旧图、无 Graph 修改 | 保留原文和诊断 | 不适用 |

固定样本的多文件切换保留内存文本；本地 Open 仅单文件。Download/ZIP 是浏览器下载，不是原位保存/磁盘 watcher。无本机 Script、Runtime 或 5GC 调用。

## Current implementation invariants

- `yaml@2.9.1` AST/CST/span → `site/workspace.mjs` → `site/graph.mjs`、`site/layout.mjs` → `site/react-flow-projection.mjs`、`site/react-flow-canvas.tsx`。ELK 坐标与选中状态不反写 YAML。
- 1 文件最多 1 MiB；每 Procedure 300 Node/1600 Route entries；32 Procedure。全图超过 90 可见节点或 250 Route 使用基础布局，缩小邻居范围可回 ELK。
- Bundle identity 应区分 `source + target + routeSource`。保留每个 Outcome 的来源、ID、目标与 Source Span，不允许混合 Operator/Phase。
- **当前有限的** Node 编辑：`site/node-designer.mjs` 重命名，`node-create.mjs` 在已有 Route 上插入 terminal/call/verify，`node-delete.mjs` 受限 merge/bypass，`node-attributes.mjs` 修改现有 Operator scalar / `with.<key>.from`。这些不是任意 Node/Binding/Phase 创建。
- 现有 Route Target Patch：`site/visual-route-edit.mjs` 接收被允许的目标，走完整源码 Diff。
- D3-A1 已合入：`site/route-create.mjs` 在现有 `operator.on` 中新增一个源可证明的候选 Outcome。D3-A2 已合入主分支：`site/route-mutate.mjs` 有界重命名或删除一个 Route 条目，保留其他 source identity 和评论。D3-A3 已实现专用画布加号拖线，只创建待确认提案，并通过 Inspector 显式选择 Outcome 后复用 A1 YAML Patch；**不等于**任意 Phase 路由或 Runtime 语义验证。
- 任何 Visual Patch 都先源文 revision+span+资格、后重新解析/结构比对、预览 Diff、确认、撤销。源已变化或者歧义时拒绝。
- `site/package-audit.mjs` 是保守编辑期提示，可能不完整；绿色 CI 不能代替 Demo/Runtime Validator。
- `site/icons.mjs` 是本地描边 SVG 的唯一图标源，不散落混用字符图标。

## Technology and boundaries

React 19、React Flow 12、ELK 0.12、YAML 2.9、TypeScript 7、esbuild，静态浏览器 Bundle。坚持一个 Inspector、Source-only 降级、负面测试；不重新引入 Node Quick Card、Python POC Server 或 CreatedSession 专用平行 CRUD。

[已完成 D1](../D1-procedure-designer.md) / [D2](../D2-node-designer.md) 是里程碑记录；[D3 Route 设计](route-designer.md) 仅 Proposed。

## Axis-fit viewport controls (2026-11-03)

- Three explicit controls adjacent in the existing main graph toolbar: **适配** (fit entire current graph, default), **横向** (fit visible graph width), **纵向** (fit visible graph height). This does **not** change the graph's layout direction selector (垂直 / 水平).
- Width/height modes compute the active graph's visible node bounding box using the same 238 × 80 React Flow node footprint, with 24 px canvas padding and the existing min/max zoom limits (0.05–2.5). The opposite axis stays centered and may overflow; users can pan or zoom afterward.
- Current Procedure, Child Procedure, neighbor-scoped view, ELK layout and large-graph fallback are treated independently. All three are view actions only: **no Source Patch, no YAML change, no extra graph model**.
- The requested mode survives layout recalculation and window resizing. On opening another document it resets to default whole-graph fit.
- Browser acceptance checks actual node bounds and viewport zoom for both ELK orientations, the three controls, resize behavior and Source-byte identity; unit tests verify math and huge graph bounds.

## D4 Phase Designer · A1 bounded candidate

Phase Steps 继续是 Node Inspector 内的有序行，**不是**主业务图中的 Node。D4-A1 只更改已经存在的 Step `with.<key>.from`，且源值和候选值必须均为**当前 Procedure 已声明、且类型完全一致的 `input.*`**。原有 Step Operator、Step name、顺序、Phase 路由和 Node/Child 结构不改变。

必须经过精确 YAML Source span、重新解析与语义对比、Diff/确认、Undo/Redo。虽然 input 的 `type` 相同，也不代表工具参数语义或 Runtime 类型完全相容。任何未资格化 Step/引用都仅支持 Source 编辑。详细约束见 [D4 Phase Designer](phase-designer.md)。

## D4-A2.1 已观察的 Phase 输出引用写法

已有 Step `with.<key>.from` 在本 Procedure Source 中同时出现了局部和自身 Node 全限定的**同一个**先行命名 Step 的输出引用时，Inspector 可以提供两种已观察写法的切换。生产者身份、Step 顺序、输出字段后缀都保持不变。精确 Source Span → Diff → 确认 → Undo/Redo；不支持跨 Node 换生产者、凭字段名猜类型或向未来 Step 取值。**两种写法已出现，不等于 Runtime 确认语义等价。** 完整边界和证据见 [D4 设计](phase-designer.md)。

## D4-A2.2a · 数据依赖审查（只读）

每个带 `with.from` 的 Phase Step 可展开「数据依赖」：展示原始来源、输入/命名 Step/主 Operator 的生产者位置、同 Phase 执行先后及跨 Node 图结构的必经关系，并在本地脚本输出元信息可唯一定位对应 schema 时展示输出字段的**声明类型**。所有项均只读，附源码行定位。来源存在并不等于结果一定可用；声明了输出类型也不等于消费者字段 ABI 匹配。正式跨生产者/字段重绑定仍不开放，详见 [D4 设计](phase-designer.md)。

## D4-A2.2b1 · 消费者 ABI 与生产者声明类型对照（只读）

在现有 Phase Step「数据依赖」展开项中，若消费者是带 `# inputSchema` 的 Package 内本地脚本，展示对应的消费参数声明 Schema、字段类型、是否必填以及尚未验证的 `const`/`pattern` 等约束。同一行与 D4-A2.2a 已解析的上游输入或脚本输出类型对照，明确标记**仅声明类型一致**、**类型不符**、**生产者类型缺失**或**消费者 ABI 缺失**。这是诊断信息，不是候选来源列表，也不授权改写 YAML；`call` 没有已映射 ABI 时保持未知。下一阶段跨生产者编辑必须先取得真实 owner 契约与 Runtime 引用语义，详见 [D4 设计](phase-designer.md)。

## `establish-pdu-session` 示例同步 · 可选 Reference 文件

示例的最新 owner 基线为 [ca-agent-demo@7570b309](https://github.com/odango-chan/ca-agent-demo/tree/7570b309a998580a6952352e2bf4b1c19e5c710d/skills/establish-pdu-session)。
Studio 唯一可选的 `establish-pdu-session` Package 只同步实际运行时相关材料（16 个文件），保留原始目录路径：更新的 `SKILL.md`、
`references/3gpp-procedure.md`、`references/session-selection.md`、`references/failure-handling.md`；
`assurance/`、`schemas/`、`scripts/` 内容与 owner 当前版本 SHA 一致，因此没有修改。
示例不复制验证 Case 或内部设计记录。Studio 启动直接加载 `establish-pdu-session`；Explorer 的 `references/` 默认展开。旧 Ensure Package 仅在源码中保留为回归测试夹具，不在选择器或 Pages 构建产物中；独立旧 Procedure YAML 由本地浏览器测试服务按需提供。

Explorer 内 `references/` 目录可展开，三个 `.md` 文件使用现有安全 Markdown Visual / Source / Split，
修改仅作用于当前文件的内存工作副本，Undo/Redo 独立保留；导出 Package ZIP 时文件路径与内容原样保存。
Studio 本身**不是** Agent Host 的 `read_reference`，不会替模型自行选择/读取业务参考内容。
引用是可选知识材料，不是新的 Procedure 执行节点、实时 Observation 或 Runtime 成功证据。

验收包含 owner blob SHA 校验、引用路径及安全预览、16 文件 ZIP、真实浏览器的文件夹导航、
三文档预览、编辑/Undo/Redo、返回原 17 Node 的 Procedure。参见 [PR #20](https://github.com/odango-chan/ca-skill-studio-demo/pull/20)。

## D4-A3a · 最小 Phase Step 顺序编辑（编辑器级验收通过）

Inspector 在 Source 能证明是两个紧邻、未命名、单行、无 Binding 的 Verify 时，在前一个 Step 行显示「下移」。操作复用现有 Source Diff、确认和 Undo/Redo；复杂 Step 不出现可点击按钮。此项不创建流程主画布 Node，也不代表 Runtime 验证顺序无关。详见 [Phase Designer](phase-designer.md)。

## D4-A3b1 · Verify Step 受限增删（编辑器级验收通过）

在选中 Node 的「准备 / 确认」Inspector 中，符合条件的单行 Verify 提供「删除」入口；若 Phase 存在可证明的安全末尾插入点，则展开「新增 Verify」后从当前 Package PredicateSet 选一个尚未出现在该 Phase 的 Predicate。所有操作必须先看 YAML Diff，再显式确认并支持撤销/重做。Complex/named/bound/commented Step 保持 Source-only。新增或删除会改变业务门禁，本编辑器不承担 Runtime 合法性判定。参见 [Phase Designer](phase-designer.md)。

## D4-A3b2a · 命名 Step 引用影响与同步改名（编辑器级验收通过）

每条命名 Phase Step 在 Inspector 下有折叠「引用影响」视图，展示从当前 Procedure YAML 证明的 consumer 数、来源 Node、Source 行号。若所有旧名称出现位置均经严格审计为唯一生产者的合法未引号 from 引用，则可以提交命名 Step 的原子改名 Diff；任何未知/注释/歧义引用会拒绝可视改名。主画布不会新增业务节点。Runtime/5GC 未验证。参见 [Phase Designer](phase-designer.md)。

## D4-A3b2b1 · 命名 Verify 生命周期（编辑器级验收通过）

在现有「准备/确认」Inspector 中，仅对 Source 可精确定位的独立 Verify 显示折叠「命名 Verify」；已命名且无任何已知输出引用的纯 Verify 可显示「删除」或「下移」。任何命名脚本/工具调用、依赖引用、额外字段、注释归属不清时均不显示危险操作。各操作保留原文 Source Diff/确认/Undo/Redo，Runtime/5GC 未验证。参见 [Phase Designer](phase-designer.md)。

## D4-A3b2b2a · 命名 Step 删除/换序影响审查（只读验收通过）

命名 Step 的已有「引用影响」折叠区域中补充两行只读结论：「删除评估」与「与下一步换序」。显示能够证明的下游输出消费者、跨越的直接 `with.from` 依赖行号，以及 Script/Call 效果契约未证明的阻止原因。没有新编辑按钮，也不声称 0 引用等于 Runtime 安全。参见 [Phase Designer](phase-designer.md)。

## D4-A4a · Phase 失败 Route 目标编辑（编辑器级验收通过）

Node 的「准备 / 确认」阶段底部，在当前 Source 可严格限定的现有 Phase Route 上展示折叠「阶段 Route 目标」。只允许从同 Procedure、同 Phase、同失败 Outcome 已存在的目标选择；不允许编辑 `operator.on` 或将 `PASS` 改走失败分支。路径变更走 YAML 精确 Diff、显式确认和 Undo/Redo；改变失败清理路径可能影响 Runtime 行为，不做语义等价保证。参见 [Phase Designer](phase-designer.md)。

## D4-A4b1 · Phase Outcome 补齐与受限修复（编辑器级验收通过）

现有 Phase Inspector 的「准备 / 确认」只在 Source 中确实出现可核对的缺失或独有非核心 Outcome 时，展开一个轻量「阶段 Outcome」编辑区。正常 owner 样例所有核心分支齐全，不额外显示无意义按钮。操作沿用精确 Source Diff、确认、Undo/Redo；核心 Outcome 永远没有删除入口，非核心键也不自动判断为 Runtime 错误。详见 [Phase Designer](phase-designer.md)。

## D1 Visual-only START / Route 颜色与悬浮图例（2026-11-05）

- `procedure.start` 仍然唯一定位第一个真实 Node；画布给该 Node 绘制独立的 START 胶囊和连接线（CSS 视觉装饰），不新增 YAML Node / Route，不改变 Node、Route bundle、Outcome 数量，亦不允许选中虚拟 START 作为业务节点或 Route 编辑目标。真实 Node 仍显示原来的 `CALL` / `TOOL` / `VERIFY` 等 Operator，不再写 `CALL · START`。CALL 是 DSL 的调用型 Operator，不等于 TOOL。
- 同一个 Route bundle 的所有 Outcome 依照明确标签归类；`PASS/SUCCEEDED/SUCCESS` 绿色，`FAIL/FAILED/ERROR` 红色，`UNKNOWN/OUTCOME_UNKNOWN/UNRESOLVED/TIMEOUT/TIMED_OUT` 琥珀色，混合类别及未知标签中性色。**只要一个 bundle 的 Outcomes 含混，就不可据某一个 PASS 画成绿色。**选中态单独高亮，箭头颜色与线条保持一致。仅显示层，不做 Runtime 资格判断。
- 画布右上角的原生 `details` 图例默认折叠，首版显示 START、8 类支持的 Operator 与 4 类 Route 色义（A1 将其替换为当前实际类型）；图例不占 Inspector，不引入新的工具栏或运行状态。YAML Source、Diff、Undo/Redo、ELK 路由几何、拖动重连保持权威与既有行为。
- 浏览器验收需核对：真实业务 Node 数与 Route 路径数量未变，START 单独可见、原业务标签无 START，图例可折叠、可展开，PASS 对应的可见线条与箭头同色且混合/失败/不确定边不冒充成功；此项仅是 Studio 展示能力。大图适配边缘空间仍以真实 Node 布局为依据，不应把 CSS 的装饰物冒充额外 Route。

## D1-A1 · 语义可见性第一阶段（2026-11-05，PR #67 OPEN）

[代码 CI #42017183541](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42017183541) 已 PASS：384/384 Node、TypeScript、Build 和真实 Chromium；Root 17 Node / 46 路径及端口不变，PRE/POST、图例和线型一致；Child 4 Node 只有 POST，返回 Root 恢复。最终文档提交仍需单独 exact-head CI，主分支/Pages 未部署。

本阶段只针对 [Issue #65](https://github.com/odango-chan/ca-skill-studio-demo/issues/65) 的已确认问题，不抢先实施 A2 子流程边界/A3 图压缩。主要原则：**一个业务 Node 仍然对应一个 YAML Node**；Phase Step 是该 Node 内部的有序 Step，不能提升成业务 Node；`CALL` 不是 `TOOL` 的别名。

- 从 Source 投影的 `node.phases` 计算真正存在的 `PRE/POST · N` 徽标，`title` 进一步列举内部 `CALL/SCRIPT/VERIFY` 实际数量；Phase 缺失就不渲染，空 Phase 显示 0 而不是捏造 Step。Node 的尺寸和 ELK 港口坐标均维持 238×80。
- 图例拆为**当前可见业务 Node 类型**、**这些 Node 内部实际 Phase Step 类型**。不会因为 DSL 支持 `TOOL` 就默认显示 TOOL；切 Child Procedure 和邻居视图后只按当前范围重新统计。
- 对每条 Route，Outcome 色义维持不变；独立把 `preconditions.on` → `PRE` 虚线、`operator.on` → `OP` 实线、`postconditions.on` → `POST` 点线，标签带明示前缀。PRE/POST 标签默认可见，混合 Outcome 不得显示为成功；精确 Outcome 身份和原始 Route Source 仍来自 Source。
- 所有修改均为只读投影、TSX/UI/CSS，无新增 DSL 语法、业务 Graph Node/Route、Server、Runtime 执行或隐式 Patch。A2 子流程有界卡片与调用上下文、A3 异常分支缩略和概览/全图切换保持后续单独评审，不在 A1 混入新编辑能力。

## D1-A2 · 子流程边界与调用位置（2026-11-05；PR #68，堆叠于 #67）

[代码 CI #42019367400](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42019367400) **PASS**：388/388 单测、TS、Build、真实 Chromium。Root 6 张 Procedure 调用卡片、Child 4 Node 边界、Root 原调用节点回跳、3 种复用调用位置、Explorer 直接进入不编造调用关系、Source 字节保持与 17 Node/46 路径恢复均通过。文档最终 HEAD CI 尚待核对；main/Pages 仍未部署。

A2 建立在 A1 的 Source-backed Node/Phase/Route 语义展示之上，只改当前**视图的导航与边界**。它不在 Root 内联 Child，也不引入保存到 YAML 的容器节点：Root 17 个业务 Node 中 6 个 `PROCEDURE` 调用指向 4 份 Child 定义；`finalize-resource-responsibility` 的三个不同调用者是同一份定义的三个**调用位置**，不能在 Child 定义里捏造单一全局父节点。

- Root 的 `PROCEDURE` 节点保持同一 238×80 ELK 尺寸与连接端点，使用有界卡片、显式「进入子流程」动作；双击仍可进入。普通 `CALL` 不显示子流程动作；按钮具备键盘焦点和语义标签。
- 在 Child 视图的**画布容器**（不是业务图模型）增加轻边界、当前 Procedure 名称、已知调用位置与「返回调用节点」；子图自身仍有独立 START 和真实 4/5 Node。
- 从真实 Root/Child 调用进入时，`resolveProcedureCall` 依据当前 `workspace.procedures`、调用 Node 与 `children[]` 引用确定 `parentProcedure/callerId/childProcedure/via`，并建立仅 UI 的导航路径。返回时重新核验调用来源、在父图选择并居中原调用 Node。源文件修改后如调用位置失效则取消上下文，不猜测旧身份。
- **从 Explorer 或 picker 直接打开 Child**：没有已知调用来源时明确显示「直接打开 · 未指定调用节点」，「返回 Root」不会偷偷选择三个可能调用者之一。复用 Child 的任意调用来自哪个节点，返回就应到哪个。
- 仍只有原来精确的 Node/Route/Outcome 与 Source span、Diff/确认/Undo/Redo；A2 不更改 graph layout、Runtime/5GC、Script 或 Tool 语义。A3 根图异常分支缩略另起阶段，不在本 PR 偷偷删除完整失败链路。

验收：单测复用子流程与无上下文/失效来源负例，Chromium 真实点击调用卡片、验证 Child 边界与 breadcrumb、返回调用点，再进入同定义的不同调用位置、Explorer 直接打开的负例；返回 Root 17 Node / 46 bundle 和 Source bytes 完全不变。此项只可在 exact-head CI 通过后称浏览器 PASS，后续要人工目视宽窄屏可读性。

### A2 需求澄清：所有 Node 都能双击进入（2026-11-05）

用户明确的目标不是「仅有 4 份 Child Procedure 能进入」，而是根图的 **17 张业务节点都能双击进入自己的内部阶段视图**。前述 6 个 `PROCEDURE` 调用 → 4 份 Child 定义只是**第二层导航**，不是唯一的 Node 下钻模型。

- 普通 `CALL`、`RECONCILE`、`TERMINAL` 和 `PROCEDURE` 等真实节点双击都进入该 Node 的只读阶段画布：**PRE（如有）→ OPERATOR → POST（如有）**。它只消费现有 `nodeJourney()` 投影，真实步骤、顺序和按源归属的 Route/Outcome 一致；没有 PRE/POST 就省略阶段（TERMINAL 可能只有 OP）。
- 内部步骤保留 `SCRIPT`、`CALL`、`VERIFY` 等真实类型和源行号，点击行号跳到当前 Source；Outcome 标签展示路由到的目标业务节点，绝不在局部视图里伪造可执行或可编辑的独立 Step graph。
- 只有已有 `node.children` 引用时才出现「进入子流程」；点击后才从 Node 内部视图进入真正的独立 Child Procedure。6 次调用/4 个定义的边界和调用点返回仍与 A2 原始设计一致。
- 本地阶段画布只是 UI 派生视图，不复制数据源、业务 Node、Route 或执行步骤；返回完整 Procedure 图后不丢选中状态。Source 修改后若目标 Node 不再存在，自动取消此节点局部视图；禁止把这个新视图当成 Runtime 验收或生成新 YAML。

验收新增：对当前 owner 根图 **17/17 真实节点逐个双击**，核对 PRE/POST 有无、Step/Outcome 来源、只有 OP 的终态、返回整图、PROCEDURE 内部进入 Child、直接 Explorer 子图没有虚构调用者；所有 Source bytes 不变。前一次浏览器双击测试发现 React Flow 自身双击缩放拦截，必须通过 **真实的 Node DOM 事件**验证，不能把单测 PASS 误报为实际交互 PASS。


代码检查：[CI #42024171379](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42024171379) 成功（390/390 Unit、TypeScript、Build、Chromium）。浏览器记录显示 17/17 Node 双击 PASS、UDM Subscribe PRE 5/POST 1、终态仅 OP、Procedure 内进入 Child、返回 Root 17/46 和 Source 保持。随后精简了重复的组件事件回调和临时调试字段，最终 HEAD 仍需同样门禁；成功部署到 Pages 之前不声称线上可用。

## D1-A2b · Node 上下游一跳视图（2026-11-05 · PR #69 OPEN）

用户进一步明确：双击任何业务 Node 后，**不仅查看它的 PRE/OP/POST 内部阶段，还必须看到与它有真实 Route 相连的上一跳和下一跳**。这是现有 A2 局部 Node 详情的补充，不等于 A3 的「整个 Root 流程紧凑概览」。

- 视图：左侧为「上一跳：真实入向 Route 的 source Node」，中间为 Node 的 PRE（若有）/OP/POST（若有）有序步骤，右侧为「下一跳：真实出向 Route 的 target Node」。三个区域都在同一 Procedure 内；真正调用 Child Procedure 仍沿 A2 已实现的第二层导航。
- 唯一语义来源是当前 `procedure.nodes` 和 `procedure.routes`：本仓 `nodeNeighborhood()` 只做一次索引、按邻居 Node 分组展示，不转换为全局 success spine。每条原始 `route.id`、`outcome`、`routeSource`、`line` 必须完整保留，包括同一目标的 PASS/FAIL 等多个 Outcome、循环/self-loop、PRE/OP/POST Route。Route 颜色只反映 Outcome 静态类别，不能当真实执行结果。
- 点击上一跳/下一跳节点，以其为新焦点继续一跳浏览；不添加或执行业务 Node，不改变源 YAML；从局部视图返回仍定位原选中的业务节点。START 可能没有上一跳、TERMINAL 没有下一跳，这应呈现有明确解释的空态，而非伪造一条边。
- 窄屏三栏改为纵向排列，完整邻居和 Outcome 不被隐藏。高连通节点可分别滚动上/下游列表；不默认假设唯一前驱或唯一后继；按当前原始视图没有定义的跨 Procedure 控制边也不猜测。

验收：`tests/node-neighborhood.test.mjs` 验所有 Owner Root Node 的原始入/出 Route 身份集合完全对应；测试同一目标多个 Outcome、Phase 路由、循环、入口/终态和缺失引用。Chromium 双击实例 Node 后，验证左右邻接和路由来源、向下一跳浏览、再由其上一跳回到原节点、终态无出边、整图恢复为 17 Node/46 bundle 且 Source 不变。仅对应 PR 的 exact-head CI PASS 后称实现验收通过；A3 全局 Root 紧凑图仍待独立设计。
