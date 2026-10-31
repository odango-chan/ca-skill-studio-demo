# Skill Authoring Workbench

**状态：Proposed · Runtime-asset authoring-first 桌面工作台**

工作台目标是让作者在同一个 Package 上同时操作实际运行资产、图形语义和属性；不把磁盘上的所有辅助文件都提升为一等编辑器。

## 1. 全局布局

~~~text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Skill Studio  / Workspace / Skill                     Saved · Undo · Redo · Save│
├──────────────────┬──────────────────────────────────────────┬─────────────────┤
│ RUNTIME ASSETS   │ EDITOR TABS                               │ SEMANTIC        │
│                  │ [SKILL.md] [procedure.yaml] [predicates] │ INSPECTOR       │
│ Skill Package    ├──────────────────────────────────────────┤                 │
│  SKILL.md        │ [Visual] [Source] [Split]                 │ Selected object │
│  assurance/      │                                          │ properties      │
│   contract.yaml  │          ACTIVE EDITOR                    │                 │
│   procedure.yaml │   Markdown / Graph / YAML / Form         │ Fields          │
│   predicates.yaml│                                          │ Bindings        │
│  references/     │                                          │ References      │
│  schemas/        │                                          │ Source          │
│  scripts/        │                                          │                 │
│                  │                                          │                 │
├──────────────────┴──────────────────────────────────────────┴─────────────────┤
│ PROBLEMS (collapsed) · Parse · References · Unsupported · Conflicts           │
└──────────────────────────────────────────────────────────────────────────────┘
~~~

## 2. 区域职责

| 区域 | 建议宽度 / 高度 | 职责 |
|---|---:|---|
| Top Bar | 52–60 px | Workspace、Package、Saved / Dirty / Conflict、Undo / Redo、Diff、Save |
| Runtime Asset Explorer | 220–260 px | 运行时资产树、Procedure Outline、Quick Open |
| Editor Tabs | 自适应 | 多文件编辑和模式切换 |
| Semantic Inspector | 320–400 px | 所选对象的可编辑属性、Binding、引用和 Source |
| Problems | 默认收起；展开约 160–220 px | 编辑时的解析 / 引用 / 兼容性诊断 |

尺寸是 1440×900 高保真原型的起点，不是最低支持分辨率。Explorer / Inspector 可折叠与拖动；主编辑区优先获得空间。

## 3. 编辑模式

### Source

- 原始文件文本编辑；
- 语法高亮、缩进、搜索、跳转定义；
- 不自动重排或格式化整个文件；
- 修改后增量解析，无法解析时保留原文并标记 Graph STALE。

### Visual

- 对当前 Compatibility Profile 明确支持且 Round-trip 测试通过的语法开放结构化编辑；
- 不支持的节点 / 字段显示 Source-only / Preserve-only；
- 画布布局变化与源文件业务顺序分开；
- 结构操作通过 Typed Source Patch 修改当前 Source working buffer。

### Split

- 同一个 Source revision 的两种编辑面；
- Source 与 Visual 均可编辑；
- Source 改动更新 Visual；Visual Patch 更新 Source；
- 选择、光标、Source range 和 Node / Route / Binding selection 双向同步；
- 一侧解析失败时另一侧不伪装成当前版本。

## 4. Procedure Designer 工作区

~~~text
┌──────────────────────────────────────────────────────────────────────────────┐
│ procedure.yaml · Root Procedure    [Control Flow] [Data Flow]  + Node  + Route│
│ [Visual] [Source] [Split]      Search · Fit · Zoom · Undo · Redo · Diff · Save│
├──────────────────┬───────────────────────────────────────┬───────────────────┤
│ PROCEDURE        │ CONTROL FLOW CANVAS                   │ NODE INSPECTOR    │
│ Root             │                                       │ Overview          │
│  Node Outline    │ [Node A] ── outcome ──> [Node B]      │ Operator          │
│  Child A         │     │                                 │ Inputs / Outputs  │
│  Child B         │ [Terminal]                             │ Phases            │
│                  │                                       │ Bindings          │
│                  │                                       │ Routes            │
│                  │                                       │ References        │
├──────────────────┴───────────────────────────────────────┴───────────────────┤
│ PROBLEMS · syntax / dangling references / unsupported edits                   │
└──────────────────────────────────────────────────────────────────────────────┘
~~~

- Control Flow 是默认画布。
- Route Details 属于 Inspector 的解释 / 编辑区，不是另一张平级流程图。
- Data Flow 是独立 Lens，只展示 Binding 生产者与消费者。
- Node Outline 提供键盘可达的线性替代。
- Phase steps 在 Inspector 中按顺序编辑，不膨胀为主图节点。
- Child Procedure 进入独立图；返回时恢复父图视图状态。

## 5. Visual Editing 交互

### Node

- 从 + Node 选择当前 Profile 可编辑的 Operator；
- 创建唯一 Node ID；
- 在 Inspector 填写必需字段；
- 未完成的 Node 可作为 Draft，但不得伪装为语义完整；
- 拖动 Node 只改变画布布局，不自动改变 YAML mapping 顺序；
- 重命名时显示所有 Route / Binding / Procedure reference 影响；
- 删除时先处理入边、出边和引用。

### Route

- 从 Node 的阶段锚点发起连接；
- 必须明确选择 Route Source（Operator / Preconditions / Postconditions / Child Procedure）；
- 选择当前 Profile 已知的 Outcome；
- 选择当前 Procedure 内存在的 Target；
- 保存前检查重复键、缺失目标和来源阶段；
- 画布视觉 bundle 不合并源文件中的独立 Route entries。

### Phase / Step

- 在 Inspector 增加、删除、编辑和重排受支持 Step；
- 顺序是语义数据，不能用画布位置替代；
- Preconditions / Postconditions 的聚合 on 与 Step Operator outcome 分开；
- 未取得专用编辑资格的 CreatedSession Transitional phase 保持 Source-only。

### Binding

- 通过 Producer Picker 选择有明确类型 / 来源证据的字段；
- 支持查看原始表达式和 Consumer path；
- 类型 / 生产时机不确定时允许 Source 手动编辑，但不做自动猜测；
- 变更 Producer / Consumer 前显示影响范围。

## 6. Runtime Asset Editors

- SKILL.md 使用 Markdown Source / Preview / Outline；
- Contract 和 Predicate 使用 Source + 有资格字段的 Inspector；
- Script 使用 Python Source Editor，不在编辑器中执行；
- Schema 使用 YAML / JSON Schema Source Editor，并显示消费方；
- Reference 使用 Markdown Editor，并显示 preload / on-demand / samples 加载规则；
- 文件存在不代表 Host 已允许其执行或加载。

## 7. Diff、Undo / Redo 与 Save

- 每个 Visual 操作先生成 Typed Patch；破坏性或多文件修改先展示 Impact Preview。
- Patch Apply 到工作缓冲区后显示真实 Source Diff；用户可继续编辑、Undo / Redo 或 Save。
- Save 写入用户当前本地工作副本，不自动 Git commit / push。
- Undo / Redo 跨 Source 与 Visual 共用一个事务历史。
- 外部文件变化时进入 Conflict，提供 Compare / Reload / Resolve；未解决冲突不得覆盖外部版本。
- 非 Runtime 文件仍随完整 Package 保存和 Digest 计算，不因 Explorer 不显示而被删除。

## 8. Problems 面板

Problems 是编辑器辅助区，不是独立验证工作台。

Problems 只呈现当前编辑有用的信息：解析错误、未解析引用、悬空 Route、重复 ID、Unsupported / Preserve-only、Compatibility Profile 限制、未获 Host 支持的 Script / Observation / Capability 引用、外部文件冲突。

静态校验按需调用；不执行 Script、Capability、Runtime 或 Live 5GC。

## 9. 响应式

- 宽桌面：Explorer + Editor + Inspector 三栏。
- 中等窗口：Explorer 可折叠，Inspector Drawer。
- 窄窗口：单一编辑区；Inspector / Explorer Drawer；Split 自动关闭但保留模式选择。
- 手机端不承诺完整图形编辑，提供 Source 与线性 Outline / Inspector。
