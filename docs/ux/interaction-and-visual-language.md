# 交互与视觉语言

**状态：Proposed · Authoring-first Developer Workbench**

## 1. 视觉方向

采用专业 Developer Workbench 风格：

- 中性色为主、低装饰；
- 清晰的文字层级与紧凑信息密度；
- 节点类型使用稳定图形 / 图标；
- 编辑状态、焦点状态和兼容性状态分开表达；
- 避免把每个属性都做成大型彩色卡片；
- 画布优先保证可读性和可操作空间。

Light / Dark 双主题作为目标；首个高保真原型默认主题待确认。

## 2. 编辑状态视觉

| 状态 | 表达 |
|---|---|
| Saved / CLEAN | 中性文字 + 保存图标 |
| DIRTY / Unsaved | 明确文字 + 轻量提示 |
| SAVING | 进度反馈，不允许重复保存 |
| CONFLICT | 警示图标 + Compare / Resolve 操作 |
| INVALID Source | 错误文字 + Source 保留提示 |
| Projection STALE | 旧图明确标记，不冒充当前 Source |
| Unsupported / Preserve-only | 中性标签 + Source-only 入口 |
| Selected / Focused | 清晰焦点边框，不依赖颜色 |

Predicate UNKNOWN、Mutation OUTCOME_UNKNOWN、Procedure UNRESOLVED、Parse Error 和 Compatibility Warning 是不同语义，不能只靠颜色区分。

## 3. Node / Route 视觉

节点类型保持稳定：Call、Verify、Script、Child Procedure、Reconcile Operator、Terminal、Unknown / Preserve-only。

类别图标与状态颜色分离。例如 Call 节点可以同时是 DIRTY、Unsupported 或具有引用警告。

Route label 始终保留 Route Source 和原始 Outcome。视觉 bundle 不能隐藏每个独立 Route entry。

## 4. 编辑反馈

- 修改字段后显示 Working Copy 状态；
- Visual Patch 显示 Source Diff；
- 破坏性操作先显示引用影响；
- Patch 失败显示原因并保持原 Buffer 不变；
- Undo / Redo 对 Source 与 Visual 一致生效；
- 外部文件变化进入 Conflict；
- 未知语法解释为何不能结构化编辑，并提供 Open in Source；
- 静态诊断是编辑辅助，不用大面积绿色状态宣称“验证完成”。

## 5. 快捷键建议

| 快捷键 | 动作 |
|---|---|
| Ctrl/Cmd + S | 保存本地工作副本 |
| Ctrl/Cmd + Z | 撤销 |
| Ctrl/Cmd + Shift + Z | 重做 |
| Ctrl/Cmd + P | Quick Open |
| Ctrl/Cmd + Shift + F | Package 全局搜索 |
| Ctrl/Cmd + D | 复制 / 多光标动作（需按编辑器实现确认） |
| Ctrl/Cmd + backtick | 显示 / 隐藏 Problems |

快捷键需检查浏览器 / OS 冲突；破坏性命令必须有确认或 Undo，不得依赖容易误触的单键快捷键。

## 6. 语言

建议中文界面说明 + 英文技术标识符：

- 操作说明、按钮和帮助文字可中文；
- 文件名、YAML key、Predicate ID、Capability ID、状态枚举保持原样；
- 错误信息可提供中文解释，同时保留原始 Parser / Validator 消息；
- 不翻译会影响复制、搜索或协议含义的标识符。

## 7. 无障碍与可用性

- 所有状态不只依赖颜色；
- Node、Route、Step、Binding 可通过键盘导航和操作；
- Inspector 字段具备明确 Label；
- 画布提供 Outline / Route List 线性替代；
- 焦点可见，缩放后文本仍可读；
- 高密度表格支持键盘操作和稳定排序；
- 删除、重命名等破坏性操作有清楚的影响预览和可撤销反馈。
