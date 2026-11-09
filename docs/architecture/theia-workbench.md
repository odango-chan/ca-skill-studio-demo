# Theia 工作台与 Classic 功能对照

**Status: Accepted · Date: 2026-11-09**

本阶段跟踪 [#93](https://github.com/odango-chan/ca-skill-studio-demo/issues/93)。剩余完整迁移跟踪 [#95](https://github.com/odango-chan/ca-skill-studio-demo/issues/95)。此表描述代码范围；实际验收见 WORK / TRACEABILITY 与 PR CI。Classic 完整保留在 `/classic/`，不删除功能或复制业务规则。

| 能力 | Classic | Theia 第一阶段 | 共享实现 / 剩余缺口 |
|---|---|---|---|
| Procedure / Child 导航、Node Focus | 完整 | 已有 | workspace、node-focus-graph、React Flow / ELK |
| 文件默认打开 | 自有文件导航 | 原生 CustomEditor default association | 仅 assurance/procedure.yaml；其他 YAML 保持原生文本；用户自行配置的编辑器关联优先 |
| 单击 / 双击 | 自有导航 | 委托 Theia 原生 Explorer | 预览 / 固定行为由宿主控制，不拦截树事件；真实 Chromium 门禁检查原生文件打开和预览标签晋升 |
| Inspection / Inspector | 选择详情及有界编辑 | 原生活动栏与只读树视图 | 复用 workspace；节点、operator、PRE/POST steps、精确来源 Route；完整 Node/Phase 编辑仍缺失 |
| Outline | Procedure / Node 导航 | 原生树视图 | 所有 Procedure / Node；点击定位 Source 并同步图中 Node Focus；版本失效拒绝旧导航 |
| Evidence | Phase 输入/输出与消费者合同 | 源码 Child / Phase / Step 证据 | 仅 workspace 真实字段；完整消费者 ABI、输入输出证据尚未迁移；不表示 Runtime evidence |
| Problems / Package Audit | 编辑期跨文件提醒 | 原生视图及宿主诊断 collection | 直接复用 package-audit；读取当前 Package 和已打开的未保存文档；缺必要文件明确 unavailable |
| Markdown Preview | 安全只读预览 | 原生命令 / Explorer 右键预览 | 直接复用 markdown-preview；无脚本、无外部图像；随文档变化刷新 |
| Route 创建 / 重连 / Diff / Apply / Undo | 有界实现 | 已有且保留 | 复用 route-connect / route-target、原生 WorkspaceEdit；仍要求 Diff 后显式确认 |
| Phase Designer | 有界 Step / binding / verify 编辑 | 未迁移 | 本阶段仅只读 Phase 浏览，不能称完整 Designer |
| Node 重命名 / 插入 / 删除 / Operator 编辑 | 有界实现 | 未迁移 | 本轮不新增写入面 |
| Root 路径筛选 / 锚定 | 已有 | 未迁移 | Theia 仍显示完整声明图 |
| 目录导入 / ZIP / 保存 | Classic 自有工作副本 | 宿主文件系统与 OPFS | 不提供 Classic ZIP 导入导出等价能力；OPFS 不等于磁盘或 GitHub 同步 |
| Run / Runtime / 5GC | 无 | 无 | NOT_RUN，非本仓 authority |

## 原生工作台适配边界

`vscode/package.json` 声明 View Container 和四个 View；`workbench.mjs` 只做 TreeDataProvider、TextDocument、Workspace FS 与 DiagnosticCollection 适配。`inspection.mjs` 把共享 `workspace.mjs` 投影映射为只读行，不定义 DSL。图中选择携带文档版本；宿主核对当前版本后才更新 Inspector。Outline 点击携带来源版本，旧版本命令拒绝执行。源文本仍是唯一业务真源。

Package Audit 限于当前 procedure 所属 Package，最多 500 文件 / 4 MiB 文本，350 ms 合并事件后异步执行。引用规则只来自 Classic `package-audit.mjs`，不创造 Runtime qualification。缺文件、超限或读取失败不能报告“无问题”。更新、切换和销毁使过期任务失效；审计不会阻塞 CustomEditor 首次渲染。

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
