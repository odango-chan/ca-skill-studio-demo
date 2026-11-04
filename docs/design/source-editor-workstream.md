# E · Source Editor Workstream（与 D Visual Designer 并行）

**Status: Accepted (development boundary) · Date: 2026-11-04**  
**Implementation: NOT_STARTED · Acceptance: NOT_RUN**  
**Baseline inspected:** `main@ef40178f81e166aca59ea73fb7dbac42b5ccdeb8`。本文件为 E 线的唯一 canonical 设计正文；任务与验收追踪在 [E1 #23](https://github.com/odango-chan/ca-skill-studio-demo/issues/23)、[E2 #24](https://github.com/odango-chan/ca-skill-studio-demo/issues/24)、[E3 #25](https://github.com/odango-chan/ca-skill-studio-demo/issues/25)、[E4 #26](https://github.com/odango-chan/ca-skill-studio-demo/issues/26)。

## 1. 目标和不做的事

E 线负责 **YAML / Python / Markdown / JSON 的通用 Source 编辑体验**；D 线继续负责 Procedure / Node / Route / Phase 的 Visual Designer。两条线并行，不以 D4-A3/A4 完成为 E1 开始条件。

- 保留唯一业务真源：**SKILL Package 当前工作副本里的原始 Source text**；Monaco model、Graph、Inspector、Diagnostics、索引和布局都只是视图或缓存，不得成为另一份可独立持久化的业务定义。
- 不重新设计 SKILL DSL，不添加 CreatedSession 专有 CRUD，不在 Studio 中取得 Runtime、Tool / Capability、5GC 执行或 Qualification authority。
- Case、完整 Validator、执行和发布工作台仍后置。E1 不需要 Python 服务；E4 不阻塞 E1–E3。
- 现有 [Workbench](authoring-workbench.md) 的 Visual Patch（Source Span → Revision → Reparse → Diff → Confirm → Undo/Redo）继续生效；[ADR-0001](../decisions/0001-source-first-visual.md) 不变。

## 2. 已核对的现有接线（不是未来假定的 API）

| 能力 | 当前代码 | 必须保持的行为 |
|---|---|---|
| Source UI | `site/index.html` 的 `#source` textarea / `#sourceHighlight` pre，`site/highlight.mjs` | E1 替换 UI/高亮实现，不能让旧 textarea 与 Monaco 同时各自成为权威 |
| Source 编辑入口 | `site/app.mjs` 的 `source.addEventListener("input", ...)` | 写入当前工作副本、`history.record`、关闭旧 Preview、重新 `refresh(false)` |
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

Implementation may introduce a minimal `SourceEditorAdapter` to abstract **read / replace / subscribe / focus / dispose / active path**; the UI is not authority. It must distinguish `user typing`, `visual patch`, `history restore`, `file switch`, `reset`; only intentional user/patch changes record new transactions. Avoid duplicate event handlers, reentrant updates, stale Diff application and model leak. Preserve existing file dirty logic and Source / Visual / Split modes, including Markdown preview and Python-only Source fallback.

Keep all model changes **text-preserving**: do not format on open/save, normalize CRLF/BOM, delete comments, rewrite YAML keys (including `on`), or insert editor metadata into the SKILL Package. If Monaco worker/build fails, expose an intentional Source fallback; do not silently publish a broken editor.

## 5. 分阶段选型和验收

| Phase | 选型 / 范围 | Hard gate |
|---|---|---|
| **E1 #23** | Monaco Editor；YAML, Python, Markdown, JSON, plain text 模式；本地打包 Worker | typing ↔ Graph/Source/Split ↔ Visual Patch ↔ Undo/Redo ↔ file switch/ZIP，真实 Chromium；无第二历史 |
| **E2 #24** | 先评估 `monaco-yaml`、local JSON Schema mapping（来自已 pin 的 `ca-agent-demo` owner，禁止自造 DSL） | `operator.on` 的 YAML 1.2 字符串键、嵌套 Phase/with/from、注释原文、错误诊断/补全的正反例；Editor hint 不冒充 Runtime Qualification |
| **E3 #25** | Monaco Python；脚本与 Predicate/Procedure、Schema 的可证实引用导航；Pyright Web Worker 仅候选评估，Ruff 后置 | `scripts/*.py` 可编辑，准确定位已存在引用、拒绝歧义，浏览器无 Python 执行；说明真实的语言服务能力边界 |
| **E4 #26** | 独立设计完整 Package 目录导入与用户批准的保存（按浏览器支持提供 fallback） | 冲突显式处理、第三方磁盘漂移不静默覆盖、无 Package 内 sidecar、未知文件完整保留；不能宣称多文件原子写盘 |

E2/E3 依赖稳定 E1 adapter，但 D4 与 E1 可同时进行。E4 不以静态 Pages 的“下载成功”替代真实的目录保存验收。

## 6. E1 合入前的测试矩阵

1. 修改 `procedure.yaml` 后图刷新；临时无效 YAML 不显示旧图，修复后恢复；D4 既有 Route/Phase Patch 仍能经过 Diff/确认。
2. Monaco Source 输入 → D Visual 变更 → Studio 撤销 / 重做，两条来源按同一事务历史恢复；重复 Model change 不能记两次历史；旧 Source Preview 必须被拒绝。
3. 切换 `procedure.yaml` / `scripts/*.py` / `SKILL.md` 并切回，文本与 dirty/history 不丢；Markdown 安全预览不退化。
4. 保留 YAML 注释、引号、未知字段、`on` 键、CRLF 与 BOM（原文 byte-level 断言）；不对用户编辑做隐式 formatter rewrite。
5. ZIP/单文件下载是工作副本原文，不混入工作区/Worker 产物；键盘快捷键和焦点行为在 Monaco 中不会双重执行。
6. `npm test`、`npm run typecheck`、`npm run build`、真实 Chromium smoke 和 Pages 发布门禁有真实证据，才在 WORK/TRACEABILITY 标 PASS。

失败即回退到安全 Source-only，不以 E1 的实施为由更改当前 D Visual 的资格规则。
