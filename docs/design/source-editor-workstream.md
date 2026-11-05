# E · Source Editor Workstream（与 D Visual Designer 并行）

**Status: Accepted (development boundary) · Date: 2026-11-04**  
**Implementation: E1/E2/E3-A1/A2/E4-A1/A2 ACCEPTED and MERGED. E4-A2 main@ef8eae87 via PR #50; 365/365 + real Chromium OPFS + Windows filesystem fixture + resulting-main Pages PASS. The interactive native Windows Chrome OS folder picker/write remains NOT_RUN; Runtime NOT_RUN.**  
**Current accepted main baseline:** `main@3433e991006d8be9b41ae455d499ce7f59380b55`; [PR #40](https://github.com/odango-chan/ca-skill-studio-demo/pull/40) ports the E1-A1/A2 integration from historical [PR #33](https://github.com/odango-chan/ca-skill-studio-demo/pull/33) onto current D4-A4b1. [Final PR CI #41796985366](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41796985366) **322/322 + real Chromium PASS** and [resulting-main Pages #41797402343](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41797402343) **PASS** at `main@a5db46ee`. 本文件为 E 线的唯一 canonical 设计正文；追踪在 E1 #23、E2 #24、E3 #25 和 E4 #26。

## 1. 目标和不做的事

E 线负责 **YAML / Python / Markdown / JSON 的通用 Source 编辑体验**；D 线继续负责 Procedure / Node / Route / Phase 的 Visual Designer。两条线并行，不以 D4-A3/A4 完成为 E1 开始条件。

- 保留唯一业务真源：**SKILL Package 当前工作副本里的原始 Source text**；Monaco model、Graph、Inspector、Diagnostics、索引和布局都只是视图或缓存，不得成为另一份可独立持久化的业务定义。
- 不重新设计 SKILL DSL，不添加 CreatedSession 专有 CRUD，不在 Studio 中取得 Runtime、Tool / Capability、5GC 执行或 Qualification authority。
- Case、完整 Validator、执行和发布工作台仍后置。E1 不需要 Python 服务；E4 不阻塞 E1–E3。
- 现有 [Workbench](authoring-workbench.md) 的 Visual Patch（Source Span → Revision → Reparse → Diff → Confirm → Undo/Redo）继续生效；[ADR-0001](../decisions/0001-source-first-visual.md) 不变。

## 2. 已核对的现有接线（不是未来假定的 API）

| 能力 | 当前代码 | 必须保持的行为 |
|---|---|---|
| Source UI | E1 当前 `site/monaco-source-backend.mjs` + `#monacoHost`，旧 `#source` 是不交互的测试镜像或 Monaco 失败时回退 | E1 通过共享 Adapter 与现有 Workspace/History 同步；不能让旧 textarea 与 Monaco 同时各自成为权威 |
| Source 编辑入口 | `site/app.mjs` 的 Source adapter `source.addEventListener("input", ...)` | 写入当前工作副本、`history.record`、关闭旧 Preview、重新 `refresh(false)` |
| Visual Patch | `site/app.mjs` 的 Apply handler，`site/patch.mjs` 和各 D 模块 | 检查旧 Source/revision，使用现有 typed preview/apply，**一次事务**更新 Source 和历史 |
| Undo/Redo | `site/patch.mjs:createEditorHistory` | Studio 共享文本历史是业务事务历史；Monaco 自身撤销栈不得替代它 |
| 文件工作区 | `site/sample-packages.mjs:createFileWorkspace/markFileEdited` | `Map<path,{initialText,text,history}>`；不同文件各自 dirty/history，切换不丢改动 |
| 视图投影 | `site/workspace.mjs:projectWorkspace` / `site/app.mjs:refresh` | 非法 YAML 保留原文，Graph 不可用且禁止 Visual Patch；恢复后可重新投影 |
| 持久化 | 单文件 Download / Package ZIP | 浏览器内存工作副本；无隐式原地写盘或跨仓写入 |

**注意：** 当前的“revision”保障主要是完整 `baseSource === currentSource` 的内容对照，而非已有通用递增版本号；E1 不能凭空假设存在成熟 `WorkspaceService` API。必要的 adapter 要小步从现有入口提炼，并覆盖回归。

## 3. D / E 代码所有权与冲突规则

| 文件/模块 | 主要 owner | 集成规则 |
|---|---|---|
| `site/react-flow-*`、`site/graph.mjs`、`site/layout.mjs`、`site/phase-*`、`site/route-*`、`site/node-*` | D | E 不重构这些逻辑 |
| Monaco adapter、Workers、language mode / schema mapping、Source Editor CSS、新增 `tests/source-editor*.test.mjs` | E | E 独立模块开发，不在 D 组件里植入 Monaco |
| `site/app.mjs`、`site/index.html`、Source buffer / per-file history、`package.json` | **共享集成点** | E PR 尽量只做最小接线；与 D4 PR 存在重叠时先更新到最新 main 再审查差异 |
| `site/workspace.mjs` | D 投影 | E2 可以只读引用；禁止为了编辑器提示而扩张 Procedure 语义 |
| `docs/WORK.md` / `docs/TRACEABILITY.md` | 共享状态 | 各 PR 只更新本阶段的实际设计/实施/验收，不声称未运行 Gate PASS |

D/E 都必须从当时最新 `main` 分支启动。**不共享功能分支，不合并未验收的 E 代码到 D 分支，不让 E 的智能提示驱动未经资格化的 Visual Mutation。**

## 4. 共同编辑事务协议（E1 必须证明）

```text
Monaco typing / paste / edit
  -> active file model text
  -> single Source change path -> history.record -> invalidate pending D Preview
  -> refresh: Source diagnostics / Graph projection / Inspector / dirty

D typed Visual Patch (Diff -> Confirm)
  -> revalidate exact current Source text + source spans
  -> one authoritative text replacement
  -> history.record once -> update active Monaco model (no echo record)
  -> refresh: Graph / diagnostics / dirty

Studio Undo / Redo
  -> existing per-file shared history -> replace editor model
  -> refresh all derived views; do not append a new history transaction

Switch file
  -> flush current model to in-memory Package entry
  -> activate path-specific model/history -> no duplicate change events
```

E1 implemented `site/source-editor-adapter.mjs` as a minimal `SourceEditorAdapter` to abstract **read / replace / subscribe / focus / dispose / active path**; the UI is not authority. It must distinguish `user typing`, `visual patch`, `history restore`, `file switch`, `reset`; only intentional user/patch changes record new transactions. Avoid duplicate event handlers, reentrant updates, stale Diff application and model leak. Preserve existing file dirty logic and Source / Visual / Split modes, including Markdown preview and Python-only Source fallback.

Keep all model changes **text-preserving**: do not format on open/save, normalize CRLF/BOM, delete comments, rewrite YAML keys (including `on`), or insert editor metadata into the SKILL Package. If Monaco worker/build fails, expose an intentional Source fallback; do not silently publish a broken editor.

## 5. 分阶段选型和验收

| Phase | 选型 / 范围 | Hard gate |
|---|---|---|
| **E1 #23** | Monaco Editor；YAML, Python, Markdown, JSON, plain text 模式；本地打包 Worker | typing ↔ Graph/Source/Split ↔ Visual Patch ↔ Undo/Redo ↔ file switch/ZIP，真实 Chromium；无第二历史 |
| **E2 #24** | 先评估 `monaco-yaml`、local JSON Schema mapping（来自已 pin 的 `ca-agent-demo` owner，禁止自造 DSL） | `operator.on` 的 YAML 1.2 字符串键、嵌套 Phase/with/from、注释原文、错误诊断/补全的正反例；Editor hint 不冒充 Runtime Qualification |
| **E3 #25** | Monaco Python；脚本与 Predicate/Procedure、Schema 的可证实引用导航；Pyright Web Worker 仅候选评估，Ruff 后置 | `scripts/*.py` 可编辑，准确定位已存在引用、拒绝歧义，浏览器无 Python 执行；说明真实的语言服务能力边界 |
| **E4 #26** | 独立设计完整 Package 目录导入与用户批准的保存（按浏览器支持提供 fallback） | 冲突显式处理、第三方磁盘漂移不静默覆盖、无 Package 内 sidecar、未知文件完整保留；不能宣称多文件原子写盘 |

E2/E3 依赖稳定 E1 adapter，但 D4 与 E1 可同时进行。E4 不以静态 Pages 的“下载成功”替代真实的目录保存验收。

## 6. E1 回归与主分支合入前的测试矩阵

1. 修改 `procedure.yaml` 后图刷新；临时无效 YAML 不显示旧图，修复后恢复；D4 既有 Route/Phase Patch 仍能经过 Diff/确认。
2. Monaco Source 输入 → D Visual 变更 → Studio 撤销 / 重做，两条来源按同一事务历史恢复；重复 Model change 不能记两次历史；旧 Source Preview 必须被拒绝。
3. 切换 `procedure.yaml` / `scripts/*.py` / `SKILL.md` 并切回，文本与 dirty/history 不丢；Markdown 安全预览不退化。
4. 保留 YAML 注释、引号、未知字段、`on` 键、CRLF 与 BOM（原文 byte-level 断言）；不对用户编辑做隐式 formatter rewrite。
5. ZIP/单文件下载是工作副本原文，不混入工作区/Worker 产物；键盘快捷键和焦点行为在 Monaco 中不会双重执行。
6. `npm test`、`npm run typecheck`、`npm run build`、真实 Chromium smoke 和 Pages 发布门禁有真实证据，才在 WORK/TRACEABILITY 标 PASS。

失败即回退到安全 Source-only，不以 E1 的实施为由更改当前 D Visual 的资格规则。

## 7. E1 已验证的实际实现状态（2026-11-04）

- E1-A1 [PR #28](https://github.com/odango-chan/ca-skill-studio-demo/pull/28) — backend-neutral `source.value` facade，旧 textarea 回退；E1-A2 [PR #31](https://github.com/odango-chan/ca-skill-studio-demo/pull/31) — Monaco 0.57.0、本地 Editor Worker、YAML/Python/Markdown/JSON grammar；最终以从最新 D4 主分支启动的 [PR #40](https://github.com/odango-chan/ca-skill-studio-demo/pull/40) 作为正式交付，已合入 main 并成功部署；旧 PR #33 仅保留历史证据。
- [PR #40 code CI #41796287748](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41796287748) **PASS 322/322**，Typecheck、Build、真实 Chromium：Monaco 本地挂载、typing→Source、shared Undo/Redo、YAML/Python/Markdown 切换；最新 D4-A4b1 Phase Outcome 修复 Chromium 操作和历史回归也 PASS。
- E1 已于 2026-11-04 合入 main 并通过 resulting-main Pages（精确 merge SHA）。原 textarea 仍作为不交互测试镜像与 Monaco 初始化失败时的回退；保留 Source/Visual/Split、文件历史和 Patch Diff。

## 8. E2 重要 Owner Schema 相容性门禁

2026-11-04 核对 [ca-agent-demo@eaadf948](https://github.com/odango-chan/ca-agent-demo/tree/eaadf9488ec3b5d6d6f60eb7090a2dee715d440b/skills/establish-pdu-session) 与当前 [ca-skill-toolchain 源 Schema](https://github.com/odango-chan/ca-skill-toolchain/blob/main/schemas/v1alpha1/procedure-source.schema.yaml)：前者 Procedure 存在 `preconditions`、`postconditions` Phase Steps、跨 Step output `from`；后者 `$defs.node` 只有旧节点属性且 `additionalProperties: false`，缺少 Phase 结构。因此**E2 禁止直接将该 Procedure Schema 配到当前内置 `assurance/procedure.yaml`**，否则会误报。

- E2-A1 先做 Owner Schema 兼容性审计/路径关联的纯函数与正反测试；仅能对已证实结构一致的 Contract/Predicate 引入严格提示。
- Schema 不匹配的 Procedure 仍保留 YAML syntax diagnostics 和基础编辑，不自行推断新的可执行 DSL、不能丢弃引用与注释，更不能显示 Runtime qualification PASS。
- E2-A2 才进行 `monaco-yaml` Worker 集成；禁用远端 Schema 自动请求，保证 static Pages 离线可用、运行期只读，Schema Version/owner 明确固定。

## 9. E1 最新 D4 集成证据（PR #40）

在 `main@ccf17bfe` D4-A4b1 基线上仅移植 E1 Source 连接层，保留最新 Phase Outcome 修复、Step/Route 资格与浏览器测试。实际 Chromium 的 `E1_MONACO_READY`、`E1_MONACO_SOURCE_HISTORY` 证明 Monaco 本地加载、YAML/Python/Markdown 文件切换与共享 Undo/Redo；最新版 `D4_A4B1_PHASE_OUTCOME_REPAIR` 仍 PASS。Worker 从同源 Pages 静态资源加载，不使用外部 CDN；旧 textarea 作为初始化失败 fallback。[Pages #41797402343](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41797402343) 已在合并 SHA 对 Worker、Monaco license/notice、JavaScript 语法、浏览器交互和发布进行验收，全部 PASS。

E2 #35/#38 原堆叠分支已关闭（未合并），仅保留历史实现与失败审计；E2 已通过 PR #42 在最新 E1/D4 基线上合入 main，真实补全/hover 和 resulting-main Pages 全部 PASS。Studio 不取得 Runtime/5GC 业务认证权。

## 10. E2-A1/A2 最新主分支集成（PR #42）

E2 集成从 `main@07850bf1529f9439046f0768dcc35eba730136e2` 出发，选取旧 PR #35 的 YAML 1.2 语法诊断需求和旧 PR #38 已实现的 `monaco-yaml@5.5.1` 统一语言 Worker；独立的首版诊断 Marker 已由该 Worker 取代，避免 Monaco 出现两个错误标记来源。

`site/schemas/connectionagent/v1alpha1/manifest.json` 固定 `ca-agent-demo@eaadf948` 的 Toolchain snapshot `03a42764ee2a67e39f57ab550b63c7a5d7966199`，逐个标记 3 个 vendored Schema 的 Git blob SHA；`tests/yaml-owner-schemas.test.mjs` 验证字节级来源。仅在 `assurance/contract.yaml` 和 `assurance/predicates.yaml` 使用对应 Owner Schema；公共 Schema 仅解析本地 `$ref`。`assurance/procedure.yaml` 继续仅检测 YAML 1.2 语法，**绝不**套用缺少 Phase 定义的旧 Procedure Schema，也不自造新的 Procedure 语义。

本地 `yaml.worker.js`、`editor.worker.js` 使用相同 Pages 源域；`enableSchemaRequest:false` 禁止远端 Schema 读取，`format:{enable:false}` 不自动格式化 YAML。Schema 补全与 Hover 必须由真实 Chromium 的 Monaco UI 证明；旧堆叠 [PR #38 CI #41796543903](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41796543903) 的语法/约束错误标记通过，但 Ctrl+Space 补全没有弹出，属于 **FAIL**，不可重用为 E2 验收证据。最新 [PR #42 代码 CI #41802445121](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41802445121) **327/327 单测、TypeScript、Build 与真实 Chromium PASS**：确证 YAML 1.2 语法、Contract/Predicate Schema 约束、Procedure schema 不误报、真实 Contract 字段补全弹出 `allowedResources`/`entryProcedure`/`goal` 和 `skillType` 枚举 Hover。[最终 PR CI #41803566642](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41803566642) 328/328 单测、TypeScript、Build、真实 Chromium 全 PASS，[resulting-main Pages #41804005500](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41804005500) 同 SHA `9708528f` 的打包、yaml.worker.js、静态资源/语法、Chromium 和部署均 PASS。

E2 提示仅为对当前 pinned Owner Contract/Predicate 的**编辑器提示**，不得冒充 Runtime/Toolchain Qualification。旧快照未必涵盖后续 owner Schema 更新；没有版本相容证明的路径必须 fail closed 为 syntax-only，不得静默追加新 Schema。

## 11. E3 Python 编辑与导航：有界实施候选（2026-11-04）

**E3-A1:** [PR #45](https://github.com/odango-chan/ca-skill-studio-demo/pull/45) 已合入 `main@fc6c42a`；333/333 项测试、TypeScript/构建、真实 Chromium 和 [resulting-main Pages](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41811535041) 均通过。**E3-A2:** [PR #46](https://github.com/odango-chan/ca-skill-studio-demo/pull/46) 已基于 A1 合并后的 main 重新接线并合入 `main@4e88e0a`，338/338 项测试、TypeScript/构建、真实 Chromium 和 [resulting-main Pages](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41812070377) 均通过。仅认定 Editor-tier 引用/符号导航，不等于完整 Python 语言服务、Script/Runtime 验证或 5GC E2E。

| 能力 | 实施 / 限制 |
| --- | --- |
| Python 语法着色、括号/缩进与编辑 | E1 Monaco 已提供基础语言模式，原始脚本始终是内存 Package 的权威 Source |
| Procedure `script:` 与 Predicate `skill.<name>` 来路 | A1 扫描已有 YAML AST 的精确字面引用；工具名必须唯一，含糊时只提示不伪造跳转 |
| `# inputSchema` / `# outputSchema` | A1 仅关联唯一标题一致的当前 Package Schema；**不推断 Tool ABI** |
| Python 文件内 `class` / `def` / `async def` | A2 只索引明确的零缩进顶层声明；注释、三引号文本、嵌套声明不建立跳转，重复名称不建立链接 |
| Python 诊断 / 类型推断 | **未实现**；A2 的词法导航不是 Python parser、Pyright 或 Runtime Validator |
| Ruff / 自动格式化 / 脚本运行 | **未实现且未授权**；不执行用户脚本、不自动改写文件 |
| 完整本地 Package 打开/保存 | 属于 E4，尚未实现；当前 Download/ZIP 不是原位 Save |

上述可点击跳转走现有 `source.revealLine`、`switchFile`，不建立第二业务真源，不更改 D4 编辑资格或 Source 事务。A2 必须通过全部 Node 单测、TS 类型检查、打包、真实 Chromium（包括三份 Python 的符号点击与 E1/E2/D4 回归），且合并后需独立核对 resulting-main Pages。若词法无法可靠分析，Inspector 必须关闭不确定跳转，而不是制造假语义。 E3-A2 已按此范围完成并验收，尚未实现 Pyright/LSP/Ruff；是否需要更复杂诊断应先结合真实开发体验再评估。

### E3 体验调整：宽屏 Python 脚本引用默认可见（Issue #58；PR candidate）

打开当前多文件 Package 的 `scripts/*.py` 时，在宽屏（`min-width: 1180px`）默认显示既有**只读「Python 脚本引用」Inspector**，包含调用位置、顶层 `def/class` 符号及可确认的 Schema 声明。避免每次打开 Python 文件后再点击「显示脚本引用」；不修改引用推导或 Tool/Runtime 语义。

只在**进入文件**时应用默认展示，之后手动收起应保持收起，普通输入、Undo/Redo、Source 刷新不会反复自动打开。切换到下一个 Python 文件时重新按宽度判断；切到非脚本文件按原规则关闭。小屏幕 `<1180px` 不自动打开，仍可以通过原按钮手工开启，避免占用编辑区域。仅本仓页面布局与 Inspector 状态发生变化，不新增文件操作或脚本执行权限。

验收需 Chromium 在 1440px 验证初次默认展开、手动关闭及源码更新不反弹、重新打开/跳转来源与 Schema、三个实际 Python 文件的符号导航；800px 验证默认收起、按钮仍可用。Code CI 和 resulting-main Pages 不能混用，Runtime/Pyright 与 Windows 原生文件夹验收不属于本改动。

## 12. E4-A1 本地目录导入（2026-11-05；已验收）

**Status: ACCEPTED and IMPLEMENTED on main@3433e99 via [PR #48](https://github.com/odango-chan/ca-skill-studio-demo/pull/48).** [Code CI #41948794306](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41948794306) 345/345 单元测试、TypeScript、构建、真实 Chromium FileList UI PASS；[resulting-main Pages #41949134436](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41949134436) 同 SHA 部署通过。 此阶段仅提供浏览器「打开目录 → 内存工作副本 → ZIP 下载」。不使用磁盘 File System Access 写句柄，不申请保存权限，不监视外部目录，不写 sidecar。完整 E4 原位保存和 Conflict 仍在 [#26](https://github.com/odango-chan/ca-skill-studio-demo/issues/26) 后续实现。

- 仅接收浏览器通过 `webkitdirectory` 返回的单一根目录 FileList，要求根目录 `SKILL.md`；拒绝不安全路径、重复或大小写/Unicode 路径冲突、任意读失败、最多 64 个文件、单文件最多 1 MiB、总数据最多 8 MiB。导入在全部读取/校验完成后才替换现有工作区，失败保持原工作区。
- YAML、Python、Markdown、JSON 等熟悉的文本后缀仅在严格 UTF-8 解码成功后开放 Source 编辑；原有 BOM、CRLF 在未编辑时按原始字节 ZIP 导出。未知后缀、二进制或损坏 UTF-8 作为不可编辑但可见的资源进入工作区，ZIP 导出原始字节，不跳过、不强制转码。
- 优先打开 `assurance/procedure.yaml`，否则回退 `SKILL.md`；复用 E1 Monaco / D4 Visual 与 per-file Undo/Redo。原 Sample 16 文件和单文件 Open 保持可用。没有任何目录自动写回、文件系统锁、格式化或 Runtime 执行能力。
- 浏览器/OS 目录选择可能忽略隐藏文件、空文件夹与符号链接；只能保证**浏览器 FileList 实际返回的文件集合保真**，不能保证磁盘目录物理全量。未支持 `webkitdirectory` 的浏览器仍有原 Sample、单文件打开和 ZIP 下载能力，但不提供假冒的写入功能。

验收要求：单元正反例覆盖 16 文件实际示例、BOM、CRLF、未知文件/二进制、ZIP byte fidelity、路径/大小限制与读失败；真实 Chromium 对目录形状的 FileList 驱动 DOM 导入/Explorer/ZIP 测试。本轮 Chromium FileList 驱动不等价于 OS 原生文件夹对话框选择证据。Node、TypeScript、Build、Chromium 与 resulting-main Pages 必须实际通过才宣称 PASS。

**E4-A2 已在 PR #50 合入并部署：** 用户显式选择、全目录原始字节复核、有限原位写盘、文件级结果与冲突提示。真实 Windows Chrome 选择窗口及权限仍是 Issue #26 的独立待验收项。

## 13. E4-A2 原位写盘与冲突保护（2026-11-05；已合入 Demo）

**状态：IMPLEMENTED on main@ef8eae87 / PR #50 MERGED；单测、Chromium OPFS、Windows fixture、resulting-main Pages PASS，原生 Windows Chrome picker NOT_RUN。** 使用 E4-A1 内存工作副本为唯一 Source authority。FileList 不授予原位写盘权限；用户必须单独点击「保存到所选目录」，在支持的安全上下文浏览器中重新使用 `showDirectoryPicker({mode:"readwrite"})` 明确选择目录。其它浏览器保留 ZIP 导出，不发起隐式写盘或保留句柄。

1. 仅在 E4-A1 目录导入的工作区显示写盘功能（示例、单文件不能写盘）；新选择的目录名称必须与 Package 名称一致，浏览器 `queryPermission({mode:"readwrite"})` 必须返回 `granted`；用户还需逐次确认待写入的具体文件清单。**E4-A1 的 FileList 未提供原始物理目录句柄，不能证明二次选择的文件夹是同一个 OS 路径；只保证刚选择的目标目录名与文件路径/字节快照匹配。确认框必须明确提醒这一限制，不能把 basename 相同等同于目录身份。**只写已有且已编辑的文本；未改和二进制文件一律不写。
2. 确认前完整枚举磁盘相对路径，文件集合必须与原导入的集合完全一致，连同未修改的文本和二进制资源逐字节比对。新增/删除、大小写或 Unicode 名称冲突、读取失败、权限拒绝以及任何外部内容漂移均拒绝，工作副本不丢弃。
3. 每写入一个文件前再次校验完整磁盘快照与 Source 文本修订；使用现有 `FileSystemFileHandle.createWritable({keepExistingData:false})` 全量替换并显式 `truncate` 到目标 UTF-8 字节长度，防止文件缩短后残留旧尾部；不创建/删除/改名，不写 sidecar。关闭写入流后再次读取确认字节一致，才更新该文件 `initialText` 与 `originalBytes`；全部写入结束后再次核对完整磁盘快照，捕获最后一次写入后的非目标文件漂移；原 Undo/Redo 历史不受影响。
4. 只要后续某文件失败，立即停止，明确返回 `PARTIAL` 和已成功写入、仍待写入与磁盘结果不确定的文件；冲突时提供 ZIP 备份与重新导入引导。没有多文件原子提交、回滚或持久化恢复协议。
5. 浏览器检查与 `writer.close()` 之间仍存在 TOCTOU 竞态窗口，**不是 kernel CAS**；不能保证外部进程在最后校验后不会抢先写盘，也不保证突然断电/多文件写盘原子性或可靠 watcher。实际 OS 目录权限/平台竞态仍须单独验收。

验收：`tests/directory-save.test.mjs` 模拟目录句柄覆盖权限拒绝、错误目录、外部漂移、文件增减、确认取消、保存时 Source 改变、后写失败与重试、写后回读不一致。`scripts/edge-smoke.mjs` 真实 Chromium 使用 Origin Private File System (OPFS) 的 `FileSystemWritableFileStream` 验证写入/回读，只有目录选取对话框由测试替代；**此证据不等于真实 OS 目录选择/写入**。保存前还必须按照修改后的 UTF-8 字节量核对整个 Package 的 8 MiB 上限，并拒绝孤立 UTF-16 代理项和 NUL，避免 TextEncoder 替换字符后发生无提示内容变更。CI/Pages 仅能在真实 PASS 后标记。Issue #26 保留 OPEN。

### E4-A2 · 原生 Windows Chrome 验收清单（尚未执行）

此清单是 **NOT_RUN** 的现场验收步骤，不是 CI PASS 证据。只能使用一次性复制的测试 Skill 目录，不得拿生产 Skill 或 5GC 环境做写盘试验；先将完整目录复制到独立位置，核对备份和目录内容。

1. 在支持 File System Access 的 Windows Chrome 安全上下文打开 Pages，使用「打开本地 SKILL 目录」导入测试目录。分别修改 `SKILL.md` 和 Python 或 YAML 文件；点击「保存到所选目录」，重新选择目标目录，确认弹窗清楚提示**不能证明原物理路径身份**、列出将被写的文件，人工确认后检查磁盘实际内容与文件长度，特别覆盖长文本改短、BOM/CRLF 和非 ASCII 文本。
2. 检查未修改的 `references/`、图片/未知文件完全未改动；保存前后目录不应出现 `.studio`、额外 lock、临时或备份文件；刷新网页后重新导入该目录，页面呈现保存后的 Source。
3. 在导入后、点击保存前用外部编辑器修改一个**未修改的**文件，或新增/删除任意文件。预期显示 `CONFLICT`，本次目标文件不写入，页面保留 Source 与 ZIP 导出能力；恢复测试目录或重新导入。
4. 模拟取消目录选择、拒绝浏览器写权限或选择同名但文件内容不同的目录。预期无文件写入且保留可导出工作副本。选择同名、全内容相同的克隆目录时，目前只能在确认弹窗提醒身份无法验证，**不能认为目标 OS 目录与原始导入目录相同**。
5. 多文件场景人为让第二个文件不可写，确认 UI 显示 `PARTIAL`、已写入与待写入路径，以及不确定目标（如果失败发生在写流创建后）；恢复权限后重新导入或显式重试，核对实际磁盘内容。由于操作系统权限规则可能影响整个目录，无法可靠构造的场景标 `NOT_RUN`，不得编造结果。

验收记录须包含 Chrome 版本、OS、URL/安全上下文、测试目录的可公开脱敏布局、操作和可复查的前后字节/截图、结果与异常。即使这些项目通过，也不等于 kernel CAS、原子目录写入、外部进程锁或 Runtime PASS。

### E4-A2 · Windows 本地原生验收自动化入口（已合入 main；现场 NOT_RUN）

命令：`npm run test:e4:native`，要求 Windows、Node.js 24、Google Chrome，来自本仓当前 PR 分支。命令启动本地 `127.0.0.1` 网页并生成新的 `.agent-tmp/e4-native-*/studio-e4-native-fixture`；只允许选择这个测试目录。它带随机 128-bit 标记和 5 个真实文件（BOM/CRLF、Python、Reference、二进制和标记文件），**标记和全量初始字节不匹配就绝不写盘**。

需用户在 Chrome 点击一次按钮，原生选择这个一次性目录、允许写权限，并确认向该测试目录写入。其后浏览器直接执行 Studio 的 E4-A1 目录导入和 E4-A2 保存代码，自动测试两份文件的实际覆盖/回读、旧文件尾部截断、未修改与二进制文件保真、模拟外部修改以及新增文件冲突。Node **独立从 OS 磁盘读取全部文件并计算 SHA-256**，检查无额外文件；输出 `.agent-tmp/e4-native-*/e4-native-acceptance.json`，不是 Package sidecar。

`tests/e4-native-fixture.test.mjs` 在跨平台 CI 自动检验随机目录、文件字节及错误检测。**此 CI 不会显示 Windows 原生目录选择框，不能冒充 native PASS**。只有真实运行该本地命令并获得 `E4_NATIVE_OS_PASS` 及对应报告才能标记该现场场景 PASS。故意拒绝权限、真实文件 ACL 部分写失败、外部进程竞态和原子写盘不能通过这个单次授权流程自动证实，仍为 NOT_RUN/明确限制。不接触真实项目源文件，不关闭其它 Chrome 进程。10 分钟没有完成则退出、保留本次独立测试目录供审计；清理需仅限那次生成的独立目录。

## E4-A3 · 会话目录句柄与授权时机（PR candidate，2026-11-05）

现场反馈：浏览器原 `<input type=file webkitdirectory>` 的原生按钮叫「上传」，与 Studio 的「打开目录」意图不一致；原版本只获得 FileList，保存时必须重新选物理目录；导入成功/失败仅显示在被截断的底部提示里。见 [#54](https://github.com/odango-chan/ca-skill-studio-demo/issues/54)。

**本阶段候选方案：**在安全上下文且支持 `showDirectoryPicker` 的 Chrome/Edge，用户点击「打开本地 SKILL 目录」即直接执行 `showDirectoryPicker({mode:"read"})`，只拿本次页面会话内的 directory handle，通过 `entries()/getFile()` 转成原 E4-A1 的严格文件导入。其 FileList 前置限制、根 `SKILL.md`、64 文件 / 1 MiB / 8 MiB、严格 UTF-8 与 opaque 字节保存原则都不变。成功/失败将同时在 Explorer 左侧持久显示，让用户看得到结果；不能静默替换正在编辑的工作区。

**保存授权独立：**仅当工作区已产生修改且用户主动点击保存，才对保留的 handle 执行 `requestPermission({mode:"readwrite"})`。拒绝写权限直接阻止写盘，保留工作副本和 ZIP。获许可后仍进入原 E4-A2 的**全部文件字节/路径比对 → 明确列出待写文件 → 再次确认 → 分文件重验和写回/回读**。保留句柄绝不赋予自动写权限，也不保证文件系统 CAS/原子写入；刷新页面后句柄失效，需要重新打开。

**浏览器兼容：**缺少 File System Access 目录选择接口的浏览器仍用原 `webkitdirectory` 兼容导入、对应原生「上传」文案由浏览器掌控；兼容导入无法获取目录句柄，保存仍需重新选择目标目录。页面文案不得误称所有浏览器会显示「打开」，也不得称已经完成真实 OS 目录授权测试。

**验收：**单测覆盖真实 owner 16 文件、只读导入无写权限、非法目录/路径/大小/读失败；真实 Chromium 用模拟 picker + OPFS 进行「先选择只读目录 → 修改 → 保存只申请写授权而不二次选择 → 复核字节」及拒绝权限的负例。该证据不等于真实 Windows Chrome 系统文件选择框（Issue #26 仍须现场验收）。Source/Runtime/5GC 皆不改变。


## 14. E5 · 当前 Package 跨文件只读查找（2026-11-05；PR #64 OPEN）

实现与验证：[PR #64](https://github.com/odango-chan/ca-skill-studio-demo/pull/64)，代码提交 `f4e10a4` 的 [CI #41999904349 attempt 2](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41999904349) 完成 385/385 单测、TypeScript、打包和 Chromium PASS。首次尝试在测试页未打开前因 Chrome 调试端口未就绪失败，不能计为浏览器 PASS；第二次同提交真实交互测试通过。main/Pages 尚未验收。

当前 Explorer 的「查找节点」只过滤当前 Procedure 的 Node，不支持在多文件 SKILL 中查找任意文本。E5 在同一个 Explorer 增加独立、默认收起的「查找文件内容」，不创建第二 Inspector、第二编辑工作副本或服务器索引。

- **Source authority：**搜索当前内存 Package 的可编辑文本，当前文件以编辑器实时内容为准；包括尚未导出的改动。未知/二进制 opaque 文件不解码、不搜索。重新打开其他 Package 时清空查询；单文件不显示跨文件入口。
- **匹配语义：**大小写不敏感的字面文本搜索，**不是用户正则表达式**，返回路径、行、列与短摘录，按路径和文件内顺序排序。搜索输入最长 96 字符；上限 64 文件、单文件 1 MiB、总计 80 条/单文件 16 条。超限与结果截断要明示，不应暗称穷尽。
- **导航：**点击命中项复用现有 `switchFile` 和 `lineJump`，自动打开文件与 Source 定位；Procedure 图形能力、脚本引用面板及 Editor History 不因搜索而更改。保留原有「查找节点」，搜索结果只读且 DOM 由 `textContent` 创建。
- **验证边界：**Node 单测覆盖 Unicode/CRLF、大小写、字面特殊符号、未保存工作副本、opaque、超限；Chromium 真实 Owner Package 覆盖 Python 与 Reference 跨文件点击和返回 Procedure。未引入 Python LSP/Runtime Validator/磁盘监控，也不声称搜索未知的 OS 文件。
