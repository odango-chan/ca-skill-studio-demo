# 开放问题与待决策项

**状态：Open · 以 Skill Authoring 为中心**

本页只保留会影响第一版编辑器实现的决策。验证 / 发布工作台不进入当前设计主线。

## 1. Source-preserving 技术 POC

| 问题 | 当前建议 | 状态 |
|---|---|---|
| YAML Round-trip Parser | 先做候选库 POC，不提前锁定 | Open |
| CST / AST 层 | 必须保留 comments、order、style、unknown fields 和 source spans | Proposed |
| YAML 语义 | 对齐 Demo Loader：on 是字符串键，true / false 是布尔值 | Confirmed constraint |
| 局部序列化 | 只改目标语法区域，不全文件 dump | Proposed |
| Patch protocol | Typed Patch + source revision + preconditions + inverse | Proposed |
| Round-trip 失败 | 回滚；该语法降级 Source-only / Preserve-only | Proposed |

## 2. 工作区交互

| 问题 | 当前建议 | 状态 |
|---|---|---|
| 主工作区 | Package Explorer + Editor Tabs + Semantic Inspector | Proposed |
| 默认编辑模式 | 新开 Procedure 时默认 Visual；随时切 Source / Split | Proposed |
| Split | 两侧都可编辑，同一 Working Buffer | Proposed |
| Problems | 底部收起，仅显示编辑辅助诊断 | Proposed |
| 多文件 | 支持 Tab；跨文件修改先展示 Impact Preview | Proposed |
| Save | 保存本地工作副本；不自动 Git commit / push | Proposed |
| Layout persistence | 首版先作为 UI state，不写入 Skill YAML | Proposed |

## 3. Procedure 编辑能力

| 问题 | 当前建议 | 状态 |
|---|---|---|
| Node 编辑 | 受支持 Operator 可创建 / 编辑 / 重命名 / 删除 | Proposed |
| Route 编辑 | 明确 Route Source、Outcome、Target | Proposed |
| Node drag | 只改变画布位置，不重排 YAML 节点顺序 | Proposed |
| Phase / Step | 有序编辑；Transitional syntax 单独资格 | Proposed |
| Binding | 类型和生产来源明确时提供 Picker；不确定时 Source-only | Proposed |
| Child Procedure | 独立图；编辑资格按 Operator / Profile 决定 | Proposed |
| 删除 / 重命名 | 显示入边、出边、Binding 和跨资产引用影响 | Proposed |
| Draft | 允许语法正确但语义未完成的草稿，Problems 显示未完成项 | Proposed |

## 4. Compatibility Profile

| 问题 | 当前建议 | 状态 |
|---|---|---|
| ensure | 首个 Visual editing 样本，逐项开放已测试 Patch | Proposed |
| establish | 先读取 / round-trip；Transitional phase 保持 Source-only | Proposed |
| Manifest | 语法证据与 editability 分开；无测试不标 editable | Proposed |
| 新语法 | 不自动猜测；新增 Profile / Patch / round-trip 测试后再开放 | Proposed |

## 5. 应用技术栈

当前仓库没有应用脚手架。需先完成 Round-trip POC，再决定：

- YAML Round-trip Parser / CST；
- UI Framework；
- Source Editor（Monaco / CodeMirror 或其他）；
- Graph Library / 自研 Canvas；
- Web / Desktop Shell；
- 本地文件访问和 Workspace 安全模型；
- Windows / WSL 开发与运行体验。

## 6. 当前明确后置

- 独立 Validation / Qualification Center；
- Runtime Trace / Execution；
- Script Sandbox；
- Live 5GC；
- Registry / Publishing / Install；
- AI 自动生成完整 Skill；
- 多人实时协作。

## 7. 下一次评审顺序

1. 先评审 Source-preserving Edit Model 和 Round-trip POC 测试集；
2. 再确定首个 ensure Visual 编辑操作集合；
3. 再选择应用技术栈与 Graph 技术；
4. 最后进入可点击原型和应用脚手架。
