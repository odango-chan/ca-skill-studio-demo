# 工作台布局

**状态：Proposed · 结构待评审**

工作台面向桌面端复杂编辑任务。核心目标是让用户在不频繁切换页面的情况下，同时理解源文件、业务图形、节点属性和诊断结果。

推荐 IDE 式布局作为默认方案，但最终布局形态仍待用户确认。Procedure Designer 的具体屏幕分区见 [Procedure Designer Screen Specification](procedure-designer-screen-spec.md)。

## 1. 布局区域

~~~text
┌────────────────────────────────────────────────────────────────────┐
│ Top Bar: Workspace / Skill / Branch / Save / Validate / View       │
├───────────────┬──────────────────────────────┬─────────────────────┤
│ Package       │ Central Work Area            │ Inspector           │
│ Explorer      │                              │                     │
│               │ Graph / Source / Preview     │ Properties          │
│               │ Tabs                         │ Bindings            │
│               │                              │ References          │
├───────────────┴──────────────────────────────┴─────────────────────┤
│ Diagnostics / Problems / Validation / Execution Evidence          │
└────────────────────────────────────────────────────────────────────┘
~~~

## 2. 初始尺寸建议

以下尺寸是设计起点，不是已确认的硬约束：

| 区域 | 建议尺寸 | 行为 |
|---|---:|---|
| Top Bar | 52–60 px | 固定 |
| Package Explorer | 220–260 px | 可折叠、可拖动 |
| Inspector | 320–380 px | 可折叠、可拖动 |
| Diagnostics | 180–240 px | 可收起、可调整高度 |
| Central Work Area | 自适应 | 优先获得空间 |

## 3. 工作视图

中央工作区至少支持：

- Visual：Procedure 图形视图；
- Source：Markdown / YAML / JSON / CEL / Script 源文件；
- Preview：渲染或模型上下文预览；
- Diff：当前修改与基准版本比较。

不同视图可分屏。分屏不代表存在多份数据源。Procedure Designer 的 Visual / Source / Split 行为以其专用交互规范为准。

## 4. 面板行为

- Package Explorer 可完全折叠；进入 Procedure 页面后，其上下文显示 Procedure List 和 Node Outline。
- Inspector 在没有选择对象时显示当前文件或 Procedure 概览。
- Diagnostics 可收起；存在错误时提供轻量提示，不强制占用大面积空间。
- 画布支持缩放、平移、适配内容和定位选中节点。
- 面板宽度变化不能导致节点详情和代码不可读。
- 切换文件时尽量保留滚动位置、展开状态和未提交编辑。

## 5. 响应式策略

桌面端是第一目标。较窄窗口下，Explorer 和 Inspector 改为抽屉；Diagnostics 改为底部弹层或独立标签；Visual / Source 默认单视图。

不承诺手机端完整图形编辑能力。

## 6. 顶部工具栏

建议包含当前 Workspace / Skill、Git branch / source reference、Saved / Saving / Unsaved / Conflict、Visual / Source 切换、Preview、Validate、Undo / Redo 和 Diff。

Run / Execute 不应与 Validate 放在相同视觉层级；真实副作用操作必须进入独立流程。

## 7. 待确认

- IDE 式固定布局，还是首页与编辑器混合布局；
- 1440×900 是否作为首个高保真设计基准；
- 顶部工具栏是否显示 Git 操作；
- 是否默认打开右侧 Inspector；
- 多文件 Tab 与分屏的优先级。
