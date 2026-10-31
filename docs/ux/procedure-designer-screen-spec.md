# Procedure Designer Screen Specification

**状态：Proposed · Authoring-first 屏幕规范**

本规范定义 Procedure Designer 的可编辑屏幕结构；样本级图形与选中对象线框见 [Procedure Designer Wireframes](procedure-designer-wireframes.md)。

## 1. 首屏

用户打开 Procedure 后应能同时回答：

- 当前 Package / Procedure / Compatibility Profile 是什么？
- 当前文件是否 Saved / Dirty / Conflict？
- 主业务流程从哪里开始，节点和分支如何组织？
- 当前 Node 的 Operator、输入、Phase、Route 和 Binding 如何编辑？
- 哪些结构化操作被当前 Profile 支持？

默认打开 Visual Control Flow。Source / Split 可随时切换。

## 2. 桌面工作台

~~~text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Workspace / Skill / Procedure        Saved · Undo · Redo · Diff · Save       │
├──────────────────────┬────────────────────────────────┬─────────────────────┤
│ Package / Procedure  │ [Visual] [Source] [Split]      │ Semantic Inspector  │
│ Explorer / Outline   │ + Node  + Route  Fit  Zoom      │ Editable properties │
│                      │                                │ Phases / Bindings   │
│                      │          Control Flow          │ References / Source │
├──────────────────────┴────────────────────────────────┴─────────────────────┤
│ Problems (collapsed)                                                        │
└──────────────────────────────────────────────────────────────────────────────┘
~~~

## 3. Header

显示 Workspace、Skill、Procedure breadcrumb、Source revision、Compatibility Profile、Saved / Dirty / Conflict、Undo / Redo、Diff、Save、Visual / Source / Split。

不显示 Run / Execute / Publish 作为主操作。

## 4. Navigator

- Package Explorer 显示真实文件树；
- Procedure Outline 显示 Root / Child Procedure / Node 顺序；
- Node Outline 点击后定位并选中画布节点；
- optional 目录只在实际存在时显示；
- 删除 / 重命名文件前显示引用影响。

## 5. Canvas

默认 Control Flow。画布支持：

- Node selection；
- 受支持 Node 的创建、编辑和删除；
- Node 拖动（仅 UI layout）；
- Route create / edit / delete；
- Route Source 明确选择；
- Route details 进入 Inspector；
- Data Flow 独立 Lens；
- 键盘 Outline / Route List。

Route outcome entries 和画布 connector 数量分别计数。视觉 bundle 不改变 Source entries。

## 6. Inspector

| 选中对象 | 可编辑内容 |
|---|---|
| Node | Node ID、Operator kind、Operator identifier、输入输出、引用 |
| Route | Route Source、Outcome、Target |
| Phase | Phase 结构与聚合路由（仅 Profile 支持时） |
| Step | Step ID / Operator / 参数 / 顺序 |
| Binding | expression、来源选择、Consumer、Producer（有证据时） |
| Predicate / Contract reference | 跳转定义；对应资产编辑器逐步提供 |

未取得 editability 资格的字段显示 Source-only / Preserve-only，不伪装为可编辑控件。

## 7. Node Card

显示 Node ID、Operator kind、Operator identifier、Phase / Child chips、Binding 数量、兼容性状态和真实 Problems。节点拖动只改变布局，不改变 YAML 节点映射顺序。

## 8. Route

每条 Route 保留 Source Node、Route Source、原始 Outcome、Target 和 Source Location。创建连接时不能只凭拖线推断 Outcome 或 Route Source，必须在 Inspector / popover 明确填写。

## 9. Phase Inspector

Preconditions / Main Operation / Postconditions 按源语义分组。Step 按序号显示，支持有资格的增删改和重排。聚合路由单独显示，不把隐式成功阶段转换伪造成源 on。

## 10. Binding Inspector

显示 Consumer、expression、Producer、Field、Declared Type、Source Location 和 Evidence Level。只有来源 / 类型 / 生产时机有证据时才启用 Picker。

## 11. Child Procedure

Child Procedure 独立成图。进入后保留父图视图状态；编辑资格按具体 Operator / Profile 决定。重命名 / 删除前显示调用点与引用影响。

## 12. Diff / Undo / Redo

- Visual 操作通过 Typed Patch 更新 Source Working Buffer；
- Diff 显示真实源文本变化；
- Undo / Redo 跨 Source 与 Visual；
- Save 写入本地工作副本；
- Patch 失败不改变 Working Buffer。

## 13. Problems

Problems 只显示编辑相关解析、引用、结构和兼容性问题；不建设独立验证 / 发布工作台。

## 14. 两个真实样本

- ensure-pdu-session：首个有限可编辑样本，11 Nodes / 24 route entries / 5 terminal nodes。
- establish-pdu-session：复杂兼容性样本，17 Root Nodes / 65 root route entries / 5 Child Procedures；Transitional phases 未资格化前 Source-only。

详细节点、路由和终态见配套 Graph Blueprints。
