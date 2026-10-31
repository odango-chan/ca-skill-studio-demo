# 开放问题与待决策项

**状态：Open**

以下事项尚未由用户最终确认。当前文档中的推荐方案不能被实现为不可配置的产品事实。

## 1. 工作台布局

| 问题 | 当前建议 | 状态 |
|---|---|---|
| 整体布局 | IDE 式布局；首页 / 管理区与编辑工作台可混合 | Open |
| 左侧导航 | Package Explorer | Proposed |
| 右侧 Inspector | 可折叠属性面板 | Proposed |
| 底部 Diagnostics | 可收起问题面板 | Proposed |
| 桌面基准 | 1440×900 | Open |
| 移动端 | 只保证浏览，不保证完整图形编辑 | Proposed |

## 2. Procedure 编辑模式

| 问题 | 当前建议 | 状态 |
|---|---|---|
| Visual / Source | 两种视图同等重要 | Proposed |
| 默认视图 | 首次打开 Procedure 默认 Visual；熟悉用户可记忆上次视图 | Open |
| 图形编辑 | 先只读投影，后续开放双向编辑 | Proposed |
| 自动布局 | 只改变视觉坐标，不重排源顺序 | Proposed |
| 子流程 | Drill-in + Breadcrumb | Proposed |

## 3. 新建 Skill

| 问题 | 当前建议 | 状态 |
|---|---|---|
| 创建方式 | Guided 与 Advanced 两种入口 | Proposed |
| 模板 | Blank / Clone Existing / Template | Proposed |
| 模板范围 | 先基于当前 Demo 的 Package 形态 | Proposed |

## 4. 技术栈

尚未决定 React / Vue / Svelte、Monaco / CodeMirror、Procedure graph library、YAML Round-trip AST / CST 实现、Web / Desktop shell、本地文件 Workspace Adapter 和本地 Git 操作方式。

技术选型应由 Round-trip YAML、复杂图形可用性、桌面文件安全和 Windows / WSL 体验验证驱动。

## 5. Workspace 与 Git

- 首版只打开本地目录，还是同时支持 GitHub Repository？
- 是否允许 Studio 直接 commit / push？
- 是否需要只读远程浏览？
- 多 Workspace 是否属于首版？
- 导入后是只读 Fixture，还是可编辑副本？

## 6. 视觉与语言

- Light / Dark 默认值；
- 中文 UI + 英文标识符是否作为默认语言；
- 是否提供用户自定义快捷键；
- 是否需要紧凑 / 舒适两种密度。

## 7. Qualification

- 首版是否直接调用本地 make verify？
- Case Studio 是否只管理定义，还是同时提供本地 Runner？
- Script Sandbox 是否首版实现？
- Runtime Trace 是否只做导入展示？
- 真实 5GC Live Acceptance 是否永远留在独立工具链？

## 8. AI Co-author

- 首版是否需要 AI 建议；
- AI 是否只支持文本 Patch，还是也支持结构化 Procedure Patch；
- 是否需要 Prompt / Context Preview；
- 如何展示 AI 修改的来源和依据。

## 9. 决策顺序

建议优先确定工作台整体布局、Procedure Visual / Source 的默认关系、新建 Skill 入口、本地 Workspace 与 Git 的首版边界、YAML Round-trip 技术 POC 和 Procedure graph 技术 POC。
