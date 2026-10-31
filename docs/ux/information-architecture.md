# 信息架构与导航

**状态：Proposed · Authoring-first**

## 1. 顶层结构

当前产品只有两个主要层级：

1. **Workspace**：选择和组织 Skill Package。
2. **Skill Editor**：围绕一个 Package 的持续开发工作区。

不把 Designer、Assets、Qualification 切成互不相关的一级工作台。作者的大多数任务都在同一个 Package Editor 内完成。

## 2. 页面 / 文件树

~~~text
Workspace
├── Recent Packages
├── Open Folder
├── Import Fixture
└── Workspace Settings

Skill Editor
├── Package Explorer
│   ├── SKILL.md
│   ├── assurance/
│   │   ├── contract.yaml
│   │   ├── procedure.yaml
│   │   │   ├── Root Procedure
│   │   │   └── Child Procedures
│   │   └── predicates.yaml
│   ├── cases/                 # only if present
│   ├── references/            # only if present
│   ├── schemas/               # only if present
│   ├── scripts/               # only if present
│   └── design/                # only if present; maintainer docs, not runtime assets
├── Editor Tabs
│   ├── Markdown Editor
│   ├── Procedure Designer
│   ├── Contract Editor
│   ├── Predicate Editor
│   └── Source Editor
└── Problems (collapsed)
~~~

Package Explorer 反映真实文件结构；Procedure / Predicate 等语义索引是辅助导航，不取代文件树。不存在的 optional directory 不显示，也不自动创建。

## 3. Skill Editor 内部导航

### Package Explorer

- 展示文件和目录；
- 区分文件修改状态、解析状态和不支持语法；
- 可打开、重命名、创建和删除受支持的 Package 文件；
- 删除 / 重命名前显示引用影响；
- 可切换 Package 文件树和 Procedure Outline；
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
- 选中 Predicate / Contract 字段：显示结构化属性和 Source。

### Problems

Problems 仅汇总编辑时有帮助的内容：

- Parse / Syntax；
- Missing / Dangling Reference；
- Unsupported / Preserve-only；
- Compatibility Profile；
- Source / Projection Conflict。

不提供独立 Coverage、Runtime Trace、Qualification Report 或 Publish 页面。

## 4. 主要作者旅程

### 修改现有 Procedure

打开 Package → 打开 procedure.yaml → Visual 选择 Node → Inspector 修改属性 / Route / Phase → 预览 Source Diff → Apply → 重新解析 → Save。

### 从 Source 修改

打开 YAML → 修改原文 → 增量解析 → Visual 定位同一语义对象；若解析失败，保留文本并把旧 Graph 标记 STALE。

### 创建 Skill

Workspace → New Skill → 选择 Blank / Clone Existing（后续实现）→ 生成最小 Package → 编辑 SKILL.md 和 Procedure。创建向导不强制创建 optional 资产。

### 跨资产维护

从 Procedure 的 Binding / Predicate / Capability 引用跳转到定义；修改引用目标时显示所有消费者和影响范围。

## 5. 全局搜索

搜索范围：

- Skill 名称 / 描述；
- 文件路径；
- Procedure / Node ID；
- Operator / Capability ID；
- Predicate ID；
- Binding path；
- Case ID（如存在）。

搜索结果显示类型、所属 Package、源文件路径和上下文；点击后直接打开对应 Editor 和 Inspector。

## 6. 当前不设置为一级导航

以下功能暂不作为独立工作台：

- Validation / Qualification；
- Runtime Trace / Execution；
- Registry / Publishing；
- AI Co-author。

静态诊断放在 Problems；其他功能以后按真实作者需求再决定是否需要独立区域。
