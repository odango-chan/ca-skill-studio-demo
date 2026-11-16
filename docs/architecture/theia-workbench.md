# Theia 工作台迁移记录

**Status: Historical migration record · Current architecture: [ADR-0003](../decisions/0003-native-workbench-and-markdown.md) + [ADR-0004](../decisions/0004-package-first-workspace.md) · Classic retired by PR #186**

本文件保留功能迁移与实现边界记录。当前 Pages 默认使用 Theia browser-only：Package Explorer 位于原生 Explorer 容器；Inspector 位于右侧 Secondary Sidebar，Data Flow 在 Inspector 内；Outline / Problems 使用宿主原生视图；Markdown 使用 pinned 原生 VS Code Markdown extension。独立 Evidence 视图已由 PR #170/#171 退役。Classic 仍保留在 `/classic/`，本轮清理不删除它。

早期阶段跟踪 [#93](https://github.com/odango-chan/ca-skill-studio-demo/issues/93) 与 parity 跟踪 [#95](https://github.com/odango-chan/ca-skill-studio-demo/issues/95) 已关闭；当前 LSP 收尾见 [#160](https://github.com/odango-chan/ca-skill-studio-demo/issues/160)，Theia 代码清理见 [#176](https://github.com/odango-chan/ca-skill-studio-demo/issues/176)。Inspector Node authoring 见 [PR #96](https://github.com/odango-chan/ca-skill-studio-demo/pull/96)；Phase Input Binding 见 [PR #97](https://github.com/odango-chan/ca-skill-studio-demo/pull/97)；Node insert/delete 见 [PR #98](https://github.com/odango-chan/ca-skill-studio-demo/pull/98)；Phase Verify 受限编辑见 [PR #99](https://github.com/odango-chan/ca-skill-studio-demo/pull/99)；画布工具栏与 Root 路径筛选见 [PR #106](https://github.com/odango-chan/ca-skill-studio-demo/pull/106)；命名 Step / Verify 生命周期见 [PR #108](https://github.com/odango-chan/ca-skill-studio-demo/pull/108)；只读 Producer/Consumer Data Flow 见已合并的 [PR #111](https://github.com/odango-chan/ca-skill-studio-demo/pull/111)（merge `50eb16d5`）；Package ZIP export 见已合并的 [PR #114](https://github.com/odango-chan/ca-skill-studio-demo/pull/114)（merge `1401530b`）。

| 能力 | Classic | Theia 第一阶段 | 共享实现 / 剩余缺口 |
|---|---|---|---|
| Procedure / Child 导航、Node Focus | 完整 | 已有 | workspace、node-focus-graph、React Flow / ELK |
| 文件默认打开 | 自有文件导航 | 原生 CustomEditor default association | 仅 assurance/procedure.yaml；其他 YAML 保持原生文本；用户自行配置的编辑器关联优先 |
| 单击 / 双击 | 自有导航 | 委托 Theia 原生 Explorer | 预览 / 固定行为由宿主控制，不拦截树事件；真实 Chromium 门禁检查原生文件打开和预览标签晋升 |
| Inspection / Inspector | 选择详情及有界编辑 | 原生树视图；Node 重命名/Operator 值（#96 MERGED）与 Node 插入/删除（#98 MERGED）已迁移 | 复用 workspace、node-designer、node-attributes、node-create、node-delete；宿主以 Source revision 校验、Diff/显式确认和 WorkspaceEdit 写入；复杂 Node 仍 fail-closed |
| Outline | Procedure / Node 导航 | 原生树视图 | 所有 Procedure / Node；点击定位 Source 并同步图中 Node Focus；版本失效拒绝旧导航 |
| Data Flow（旧 Evidence 视图名） | Phase 输入/输出与消费者合同 | 源码 Child / Phase / Step + 选中 Node 的 Producer/Consumer dataflow 与 Consumer ABI 声明（#111 MERGED） | 复用 `phase-dataflow`、`phase-consumer-contract`、`phase-evidence-copy`；只显示 Source 可证明的生产者来源、消费者字段/类型与不确定原因；TYPE_ONLY_MATCH 仅表示类型一致，不是完整 ABI 证明；authorizedWrites 恒为 0；不表示 Runtime Evidence 或 live Observation；按 ADR-0003 收敛为 Inspector 内的 Data Flow 区域 |
| Problems / Package Audit | 编辑期跨文件提醒 | 原生视图及宿主诊断 collection | 直接复用 package-audit；读取当前 Package 和已打开的未保存文档；缺必要文件明确 unavailable |
| Package Explorer | Package / Dependency 导航 | 原生 Explorer 容器中的单一 Package Explorer，组合 Skills + Plugin-managed Dependencies | `package-overview.mjs` 投影；Dependency Service 负责快照与 Lock；Build Artifacts 仅在真实 BuildResult 存在时显示 |
| Markdown Preview | 安全只读预览 | pinned `vscode.markdown-language-features@1.95.3` 原生 Preview；Source 在第一组、Preview 在第二组 | Theia 使用 `markdown-link-policy.mjs` + 共享主题 CSS，严格 Package inventory / symlink 校验；raw HTML 与图片禁用。Classic 的 `site/markdown-preview.mjs` 单独保留 |
| Route 创建 / 重连 / Diff / Apply / Undo | 有界实现 | 已有且保留 | 复用 route-connect / route-target、原生 WorkspaceEdit；仍要求 Diff 后显式确认 |
| Phase Designer | 有界 Step / binding / verify 编辑 | D4-A1 Phase Input Binding（#97 MERGED）+ Verify 新增/删除/换序（#99 MERGED）+ 命名 Step 原子重命名与命名 Verify 命名/安全删除（#108 MERGED） | 复用 `site/phase-bindings.mjs`、`site/phase-step-structural.mjs`、`site/phase-step-order.mjs`、`site/phase-step-rename.mjs`、`site/phase-named-verify.mjs`；D4-A2.1 Theia 已合并（PR #116）：Inspector 暴露 Classic `phase-output-refs.mjs` 已证明的同一生产 Node / Phase / Step / output suffix 的 local↔qualified 引用规范化，不新增引用语义；仅在两种写法都已在同一 Procedure Source 中出现且唯一身份可证明时开放；精确 Source scalar、Preview 重算、显式确认、原生 WorkspaceEdit/Undo。D4-A4a Phase Route 已合并（PR #118），仅复用 `site/phase-routes.mjs` 的既有失败/未决目标；D4-A4b1 Phase Outcome 源码修复已合并（PR #119）：仅共享 `site/phase-outcomes.mjs` 证明的现有 `on` map 缺失核心键、唯一非核心拼写误用、安全非核心删除，支持原生 Diff/确认/WorkspaceEdit/Undo；跨生产者 ABI 写入、effectful Step 结构写入需先有 owner 契约 |
| Phase Outcome 已观测源修复（D4-A4b1） | 仅现有 Phase `on` map 的缺失核心键、唯一拼写纠正、安全非核心删除 | Theia Inspector 中按 Source 资格显示修复行，PR #119 MERGED（`a19f9886`，四组 exact-head PASS） | 复用 `site/phase-outcomes.mjs` 的资格、reachability、精确 CST/Source span、Preview 抗篡改和 apply；原生 QuickPick、Diff、WorkspaceEdit/Undo。不得推断完整 Runtime Outcome 词汇或新建 `on` map |
| Node 重命名 / Operator 值编辑 | 有界实现 | 已合入 main（PR #96；merge `dbcbf387`） | 复用 `site/node-designer.mjs` / `site/node-attributes.mjs`；仅精确 Source spans，拒绝过期选择；原生 WorkspaceEdit / Undo；不支持 Operator kind 替换或不安全标量 |
| Node 插入 / 删除 | 有界实现 | 已合入 main（PR #98；merge `27502c57`，exact-head IDE Host / Browser-Only / Browser Host / PR Verify PASS） | Insert 仅作用于可 Patch 的现有 Route；Delete 仅限同状态 Terminal 合并或单出口 Node bypass；复用完整 Route 影响检查与精确 Source spans；复杂 Phase/Child/多出口 Node 不开放删除 |
| Phase Route 已观测目标重定向（D4-A4a） | 仅现有前置 FAILED/UNRESOLVED 与后置 FAIL/UNKNOWN | Theia 原生 Inspector Route 右键命令，PR #118 MERGED（exact-head 四组 PASS） | 直接复用 `site/phase-routes.mjs` 的资格、Preview 与 apply；精确 Source span、原生 WorkspaceEdit、Diff 确认及 Undo。没有新增 Outcome、PASS 修改、operator.on 修改，也不证明 Runtime/5GC 失败路径业务等价 |
| Root 路径筛选 / 锚定 | 已有 | 已迁移（PR #106 MERGED） | 默认垂直主路径；支持选择路径/全部路径、失败/未决/恢复筛选、分支逐节点展开/收起并锚定；复用 `path-focus`、ELK 和 React Flow 视口接口 |
| 画布工具栏 | 已有 | 已迁移（PR #106 MERGED） | 垂直/水平、缩放、适配整图/横向/纵向、邻居视图、Route 标签、定位；仅视图状态，不修改 YAML |
| 目录导入 / ZIP / 保存 | Classic 自有工作副本 | Theia 原生 Explorer + OPFS + 示例导入 | Theia Package ZIP export 已通过 PR #114 合入 main；main `1401530b` 的 Pages workflow [#42770237030 PASS](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/42770237030)，Classic/Theia/workflow source SHA 全部一致。Classic 本身没有 ZIP importer，因此不把 ZIP 导入列为既有对等功能。Theia 目录会话原位保存仍待迁移；OPFS 不等于磁盘或 GitHub 同步 |
| Run / Runtime / 5GC | 无 | 无 | NOT_RUN，非本仓 authority |

## 原生工作台适配边界

`vscode/package.json` 声明 View Container 和四个 View；`workbench.mjs` 只做 TreeDataProvider、TextDocument、Workspace FS 与 DiagnosticCollection 适配。`inspection.mjs` 把共享 `workspace.mjs` 投影映射为只读行，不定义 DSL。图中选择携带文档版本；宿主核对当前版本后才更新 Inspector。Outline 点击携带来源版本，旧版本命令拒绝执行。源文本仍是唯一业务真源。

Package Explorer 由一个原生 TreeView 组合 Skills 与 Plugin-managed Dependencies；Dependencies 仍由 Plugin Dependency Service 提供，不另建第二棵 TreeView。Package Audit 限于当前 procedure 所属 Package，最多 500 文件 / 4 MiB 文本，350 ms 合并事件后异步执行。引用规则只来自 Classic `package-audit.mjs`，不创造 Runtime qualification。审计成功读取的同一有界 Package 文件快照也供 Evidence 解析消费者 schema；Procedure 或 Package 文件变更即失效并回退为未知证据。缺文件、超限或读取失败不能报告“无问题”。更新、切换和销毁使过期任务失效；审计不会阻塞 CustomEditor 首次渲染。

Theia 1.76 的文本预览宿主使用 `editor-preview-widget` opener，显式 Source 命令通过专用构建适配选择它；backend-backed Theia 的 Node 扩展入口通过原生 `env.uriScheme` 识别宿主；无 preview 模块时仅在 opener 不存在的错误上回退 `code-editor-opener`。VS Code 仍使用 `default`。Native editor association 使用 basename 配置，CustomEditor selector 继续限定 assurance 路径；selector 的 `[p]` 是等价字面匹配，避免 Theia Windows glob 的多段路径快捷分支错误，不扩大文件范围。

## 延迟诊断与优化

基线构建可视包约 5.3 MiB；启用 esbuild minify 后约 2.0 MiB（精确字节以构建输出为准）。这证明资源体积下降，不等于冷启动耗时下降。Theia shell 本身构建/加载、插件激活、资源下载和 ELK 首次布局是不同阶段。

- 真 Chromium 输出 `shellReadyMs`（导航至原生 shell 可见），以及 Explorer 重开 `reopenMs`。
- Webview `rendered` 上报当前版本的 projection / layout+两帧 / cacheHit；宿主输出 `STUDIO_OPEN_TIMING` 的 resolve 至 render 时间。它不包含 shell 冷启动或最初文件解析之前的等待。
- 文档版本内按 Procedure 缓存最多 32 个布局；Source 变化清空缓存，不跨版本复用。重复相同快照跳过投影。
- 同一 Source 的 Inspector 选择复用 projection；后台审计合并。隐藏 Webview 保留上下文，切换标签不重新加载图。代价是隐藏标签占用内存；关闭标签销毁上下文。

一次本地 Chrome 157 / Windows 测量（同一版本、同一 Procedure）：首次 layout + 两帧 185.7 ms，缓存返回 22.6 ms；projection 10.5 ms，shellReady 1433 ms。`reopenMs` 的 925 ms 包含固定等待与采样开销，不作为精细延迟阈值；这些本地数字不等于公网冷启动保证。完整复现由 PR #94 的 Chromium 脚本输出 `STUDIO_LAYOUT_TIMING` / `STUDIO_THEIA_REAL_CHROMIUM`，后续 CI 数字以实际日志为准。

不声称消除全部首次打开延迟；首次 ELK、Theia 框架下载及多文档内存成本仍需持续测量。真实桌面 VS Code GUI、操作系统原生文件授权和 Runtime 验收不包含在浏览器 CI 中。

跨文件审计会合并 TextDocument 变化；未打开文件的外部创建/删除后使用原生 Audit / Refresh 命令重新检查。首阶段不宣称完整文件监听或完整 Classic 对等。

## Pages 源码身份

Pages 在发布前读取 Classic / Theia 两个 checkout 的完整 SHA；main 发布要求两者都等于工作流 `GITHUB_SHA`，否则拒绝发布。产物 `build-info.json` 保留 `sourceSha`、`classicSourceSha`、`workflowSha` 和 workflow run identity。发布后核对该文件及对应成功工作流，避免将较旧页面或 checkout 漂移误判为当前 main 已上线。
