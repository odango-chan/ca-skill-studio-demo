# E · Source Editor Workstream（与 D Visual Designer 并行）

**Status: Accepted (development boundary) · Date: 2026-11-04**  
**Implementation: E1 IMPLEMENTED on PR #33; E2-A1 IMPLEMENTED on PR #35; E2-A2 implemented as candidate PR #38; E3/E4 NOT_STARTED · Acceptance: E1 296 tests + Chromium PASS; E2-A1 301 tests + Chromium PASS; E2-A2 CI PENDING; main/Pages NOT_RUN**  
**Current E1 integration**: [PR #33](https://github.com/odango-chan/ca-skill-studio-demo/pull/33) HEAD `b65b4422` on D4 `main@1291a9c0`, [296 tests + real Chromium PASS](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41787690305). E2-A1 [PR #35](https://github.com/odango-chan/ca-skill-studio-demo/pull/35) [301 tests + real Chromium PASS](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41787833576). Neither has been merged to main or deployed to Pages。

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

- E1-A1 [PR #28](https://github.com/odango-chan/ca-skill-studio-demo/pull/28) — backend-neutral `source.value` facade，旧 textarea 回退；E1-A2 [PR #31](https://github.com/odango-chan/ca-skill-studio-demo/pull/31) — Monaco 0.57.0、本地 Editor Worker、YAML/Python/Markdown/JSON grammar；最终以整合到 D4 最新 main 的 [PR #33](https://github.com/odango-chan/ca-skill-studio-demo/pull/33) 为交付候选。
- [PR #33 CI 41785473857](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41785473857) **PASS 286/286**，Typecheck、Build、真实 Chromium：Monaco 实际挂载、typing→Source、shared undo/redo、YAML/Python/Markdown 切换，D4 Phase 结构和命名 Step 回归均 PASS。
- E1 尚未合入 main、尚未完成 resulting-main Pages；不得写成已正式部署。代码仍保留原 textarea 作为不交互镜像与初始化失败的回退，原样保留 Source/Visual/Split、文件历史、Patch Diff。

## 8. E2 重要 Owner Schema 相容性门禁

2026-11-04 核对 [ca-agent-demo@7570b309](https://github.com/odango-chan/ca-agent-demo/tree/7570b309a998580a6952352e2bf4b1c19e5c710d) 的内置 SKILL 与其固定 Toolchain Schema snapshot `03a42764ee2a67e39f57ab550b63c7a5d7966199`：`skill-contract.schema.yaml`、`predicate-set.schema.yaml` 与当前 `assurance/contract.yaml`、`assurance/predicates.yaml` 结构相容；`procedure-source.schema.yaml` 的 `$defs.node` 仍未声明 `preconditions` / `postconditions` Phase Steps 且 `additionalProperties: false`，因此**Procedure Schema 继续禁用**，避免误报合法 Source。

- E2-A1 完成 Owner Schema 兼容性审计；仅对已证实结构一致的 Contract/Predicate 引入严格提示。
- Schema 不匹配的 Procedure 仍使用 YAML 1.2 syntax diagnostics 和基础编辑，不自行推断新的可执行 DSL、不能丢弃引用与注释，更不能显示 Runtime qualification PASS。
- E2-A2 使用本地 `monaco-yaml@5.5.1` Worker；`enableSchemaRequest:false`、`format:false`、YAML 1.2，所有 schema 内容从固定 Owner 快照本地打包，不允许 CDN/远端请求。

## 9. E2-A1 Grammar-only 实现边界

E2-A1 [PR #35](https://github.com/odango-chan/ca-skill-studio-demo/pull/35) 已通过 [301/301 tests + real Chromium](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41787833576)。其首版独立语法标记已在 E2-A2 收敛为 `monaco-yaml` Worker 的统一 YAML 1.2 syntax diagnostics，避免同一编辑器存在两套 Marker owner。

`yamlSchemaCapability(path)` 对 `assurance/contract.yaml`、`assurance/predicates.yaml` 返回 `owner-schema-v1alpha1`；对 `assurance/procedure.yaml` 返回 `procedure-schema-incompatible`。Procedure 不绑定旧 Schema，但仍保留语法诊断和基础编辑。



## 10. E2-A2 · 固定 Owner Schema 与 YAML Language Worker

E2-A2 候选实现位于 [PR #38](https://github.com/odango-chan/ca-skill-studio-demo/pull/38)，堆叠在 E2-A1 #35：

- 精确固定 `monaco-yaml@5.5.1`，`yaml.worker.js` 与 Monaco `editor.worker.js` 一样由 Pages 本地打包；`getWorker` 仅把 YAML 请求路由到该本地 Worker。
- 从 `ca-agent-demo@7570b309` 的 vendored Toolchain snapshot `03a42764ee2a67e39f57ab550b63c7a5d7966199` 字节级复制 `common.schema.yaml`、`skill-contract.schema.yaml`、`predicate-set.schema.yaml`，记录在 `site/schemas/connectionagent/v1alpha1/manifest.json`，Node 测试重新计算 Git blob SHA 验证未漂移。
- 只将 `assurance/contract.yaml` → `SkillContract`、`assurance/predicates.yaml` → `PredicateSet` 绑定固定 Owner Schema。公共 `common.schema.yaml` 仅作为本地 `$ref` 注册，不与编辑文件竞争匹配；内存中只将 `$id` 归一化到固定 Owner URI，原始 vendored Schema 文件不改动。
- `enableSchemaRequest:false`、`yamlVersion:"1.2"`、`format:{enable:false}`：不访问远端 Schema，不提供自动格式化写回，避免改变用户 Source。Procedure 仍为 syntax-only；不声明 DSL/Runtime qualification。
- Browser gate 直接检查实际 Owner Contract/Predicate 无误报、注入额外字段时被拒绝、恢复 Source 后标记清除；Procedure 语法错误仍可诊断；并验证 schema completion 与 enum hover。

**E2-A2 Acceptance: PENDING CI。** 该分支尚未合并 `main`，也未通过 resulting-main Pages。