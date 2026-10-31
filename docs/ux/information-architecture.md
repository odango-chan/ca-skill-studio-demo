# 信息架构与导航

**状态：Proposed · Runtime-asset authoring-first**

## 1. 顶层结构

当前产品只有两个主要层级：

1. **Workspace**：选择和组织 Skill Package。
2. **Skill Editor**：围绕一个 Package 的持续开发工作区。

主导航只呈现实际参与模型上下文加载或 Host / Runtime 执行链路的资产。不会按磁盘上所有文件夹机械生成编辑器。

## 2. 页面 / 文件树

~~~text
Workspace
├── Recent Packages
├── Open Folder
├── Import Sample Package
└── Workspace Settings

Skill Editor
├── Runtime Asset Explorer
│   ├── SKILL.md
│   ├── assurance/
│   │   ├── contract.yaml
│   │   ├── procedure.yaml
│   │   │   ├── Root Procedure
│   │   │   └── Child Procedures
│   │   └── predicates.yaml
│   ├── references/             # only if present and Host-loadable
│   │   ├── preload/
│   │   ├── on-demand/
│   │   └── samples/
│   ├── schemas/                # only if runtime / contract referenced
│   └── scripts/                # only if runtime admitted
├── Editor Tabs
│   ├── Markdown Editor
│   ├── Procedure Designer
│   ├── Contract Editor
│   ├── Predicate Editor
│   └── Source Editor
└── Problems (collapsed)
~~~

Explorer 的主视图按 Runtime Asset Manifest 显示有消费证据的文件。未进入当前 Runtime / Model-context 资产范围的文件不作为一等编辑对象，但必须在完整 Package 工作副本中保留、参与完整文件 Digest 并随导出保存。

不存在的 optional directory 不显示，也不自动创建。

## 3. Skill Editor 内部导航

### Runtime Asset Explorer

- 展示 SKILL.md、assurance、已存在的 Host-loadable references、被 Contract / Script 引用的 schemas 和已获 Host allowlist 的 scripts；
- 区分模型上下文资产、Machine Execution 资产、Contract-declared 资产和 Host-external 依赖；
- 显示文件修改状态、解析状态、引用者和编辑资格；
- 仅对已建模资产提供结构化编辑；其他文件不因存在而自动获得 Runtime 语义；
- 提供 Quick Open 和全文搜索。

### Editor Tabs

- 多文件并行打开；
- 标签显示 Saved / Unsaved / Conflict；
- Source、Visual、Split 是同一文件 / revision 的编辑模式；
- 其他文件类型使用对应 Editor；
- 切换 Tab 保留光标、滚动、画布位置和选中对象。

### Semantic Inspector

Inspector 是上下文面板，不是独立资产页面：

- 选中 Node：编辑 Node ID、Operator、输入输出和引用；
- 选中 Route：编辑 Route Source、Outcome、Target；
- 选中 Phase / Step：编辑有序阶段内容；
- 选中 Binding：编辑表达式或从已知 Producer 选择；
- 选中 Predicate / Contract 字段：显示结构化属性和 Source；
- 选中 Script / Schema 引用：显示精确路径、消费方和 allowlist / schema 证据。

### Problems

Problems 仅汇总编辑时有帮助的内容：

- Parse / Syntax；
- Missing / Dangling Reference；
- Unsupported / Preserve-only；
- Compatibility Profile；
- Source / Projection Conflict；
- 未注册的 Script / Capability / Observation 引用（只报告证据缺失，不自行授予权限）。

不提供独立 Coverage、Runtime Trace、Qualification Report 或 Publish 页面。

## 4. 主要作者旅程

### 修改现有 Procedure

打开 Package → 打开 procedure.yaml → Visual 选择 Node → Inspector 修改属性 / Route / Phase → 预览 Source Diff → Apply → 重新解析 → Save。

### 从 Source 修改

打开 YAML → 修改原文 → 增量解析 → Visual 定位同一语义对象；若解析失败，保留文本并把旧 Graph 标记 STALE。

### 创建 Skill

Workspace → New Skill → 选择 Blank / Clone Existing（后续实现）→ 生成最小 Package → 编辑 SKILL.md 和实际需要的 Contract / Procedure / Predicate。创建向导不强制创建 optional 资产。

### 跨资产维护

从 Procedure 的 Binding / Predicate / Capability 引用跳转到定义；修改引用目标时显示所有消费者和影响范围。

## 5. 全局搜索

搜索范围：

- Skill 名称 / 描述；
- Runtime Asset 文件路径；
- Procedure / Node ID；
- Operator / Capability ID；
- Predicate ID；
- Observation ref；
- Binding path；
- Script identity；
- Schema title / $id；
- Reference exact path。

搜索结果显示类型、所属 Package、源文件路径、消费方和上下文；点击后直接打开对应 Editor 和 Inspector。

## 6. 当前不设置为一级导航

以下功能暂不作为独立工作台：

- Validation / Qualification；
- Runtime Trace / Execution；
- Registry / Publishing；
- AI Co-author。

静态诊断放在 Problems；其他功能以后按真实作者需求再决定是否需要独立区域。
