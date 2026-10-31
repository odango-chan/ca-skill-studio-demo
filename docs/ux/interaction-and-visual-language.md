# 交互与视觉语言

**状态：Proposed · 待高保真设计确认**

## 1. 视觉方向

建议采用专业 Developer Workbench 风格：

- 中性色为主；
- 低装饰；
- 清晰的文字层级；
- 节点类型有稳定的图形和图标；
- 状态颜色只表达语义；
- 避免把所有内容包装成大型彩色卡片；
- 图形画布优先保证可读性和空间。

Light / Dark 双主题作为目标，首个高保真原型的默认主题待确认。

## 2. 状态视觉

| 颜色建议 | 含义 |
|---|---|
| Green | Validation PASS / Valid |
| Red | Validation FAIL / Error |
| Amber | Warning / Transitional / Needs Attention |
| Neutral Gray | NOT_RUN / Unknown / Not Available |
| Blue | 当前选择、焦点、编辑态 |

颜色不是唯一表达方式。每个状态必须同时有文字、图标或可访问名称。

Predicate UNKNOWN、Mutation OUTCOME_UNKNOWN、Procedure UNRESOLVED 和 Validation NOT_RUN 必须使用各自的状态文本，不得只靠颜色区分。

## 3. 节点类别视觉

节点视觉类型建议保持稳定：Operation、Verify、Script、Child Procedure、Reconcile、Loop、Terminal、Unsupported / Unknown。

类别图标与状态颜色分离。例如一个 Operation 节点可以同时有 Mutation 类别和 Validation Warning。

## 4. 交互反馈

- 保存状态：Saved / Saving / Unsaved / Conflict；
- 校验状态：明确显示检查范围和时间；
- 修改后：显示影响范围和 Stale 数量；
- 破坏性编辑：先显示引用影响，再要求确认；
- 自动修复：显示 Patch Preview，确认后应用；
- 不支持语法：解释原因，提供 Source-only 模式。

## 5. 快捷键建议

| 快捷键 | 建议动作 |
|---|---|
| Ctrl/Cmd + S | 保存 |
| Ctrl/Cmd + Z | 撤销 |
| Ctrl/Cmd + Shift + Z | 重做 |
| Ctrl/Cmd + P | Quick Open |
| Ctrl/Cmd + Shift + F | 全局搜索 |
| Ctrl/Cmd + Enter | 当前范围 Validate |
| Ctrl/Cmd + ` | 显示 / 隐藏 Diagnostics |

快捷键需支持用户自定义，并避免与浏览器或操作系统冲突。

## 6. 语言

建议中文界面说明 + 英文技术标识符：

- 操作说明、按钮和帮助文字可中文；
- 文件名、YAML key、Predicate ID、Capability ID、状态枚举保持原样；
- 错误信息可提供中文解释，同时保留 validator 原始消息；
- 不翻译会影响复制、搜索或协议含义的标识符。

此语言策略仍待用户确认。

## 7. 无障碍与可用性

- 所有状态不只依赖颜色；
- 节点可通过键盘导航；
- Inspector 字段具备明确标签；
- 画布提供节点列表 / Outline 作为非画布替代；
- 缩放后文本仍可读；
- 高密度表格支持键盘操作和稳定排序。
