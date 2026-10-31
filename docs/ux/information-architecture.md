# 信息架构与导航

**状态：Proposed · 待用户评审**

## 1. 顶层结构

建议采用四个一级区域：

1. Workspace
2. Designer
3. Assets
4. Qualification

它们对应用户的四种工作目的：找到 Skill、理解并编辑业务定义、管理组成资产、验证资产质量。

## 2. 页面树

~~~text
Workspace
├── Skill Library
├── Recent
└── Workspace Settings

Skill Workspace
├── Overview
├── Designer
│   ├── Business Guide
│   ├── Procedure
│   ├── Contract
│   └── Predicates
├── Assets
│   ├── Cases
│   ├── References
│   ├── Schemas
│   ├── Scripts
│   └── Source Files
└── Qualification
    ├── Validation
    ├── Case Results
    ├── Coverage
    └── Reports
~~~

Overview 是 Skill 的状态入口；具体编辑仍在对应 Designer / Assets 页面完成。

## 3. 全局导航与上下文导航

### 全局导航

- Workspace 切换；
- Skill Library；
- 最近打开；
- 全局搜索；
- Workspace 设置。

### Skill 上下文导航

进入 Skill 后，始终保留 Skill 名称、来源、当前分支和编辑状态。左侧 Package Explorer 用于快速切换资产。

### 页面内导航

Procedure、Predicate、Contract 和 Case 之间通过引用链接跳转。跳转时保留当前打开的标签和返回位置。

## 4. 页面职责

| 页面 | 主要回答的问题 |
|---|---|
| Skill Library | 当前有哪些 Skill？哪个需要处理？ |
| Skill Overview | 这个 Skill 是什么？资产和验证状态如何？ |
| Business Guide | 模型应理解什么业务语义？ |
| Procedure | 业务主流程如何组织？节点内部怎么执行？ |
| Contract | Skill 的授权边界和完成条件是什么？ |
| Predicates | 事实由哪些 Observation 和 Evaluator 确定？ |
| Cases | 哪些场景需要覆盖？是否真正执行？ |
| Assets | 引用资料、Schema、Script 在哪里？ |
| Validation | 当前源文件有哪些问题？哪些检查已完成？ |
| Reports | 某个具体源版本有哪些可追溯的验证证据？ |

## 5. 渐进披露

默认先展示业务主干：Procedure 主流程节点、主要分支、子流程入口和有真实来源的诊断标记。

用户主动展开后才显示 Preconditions / Postconditions、with/from 绑定、Predicate 证据细节、Script 元数据和完整 YAML Source。

不能为了简洁隐藏影响业务语义和安全判断的关键分支。

## 6. 全局搜索

搜索范围包括 Skill 名称和描述、Procedure 名称、Node ID、Predicate ID、Capability / Local Tool、Case 名称、文件路径和诊断消息。

搜索结果应显示类型、所属 Skill、路径和匹配上下文，并可直接打开。

## 7. 未决项

- 一级导航采用固定侧栏还是顶部导航；
- Overview 是否包含最近一次 Validation 摘要；
- 是否支持多个 Workspace；
- 是否需要多 Skill Dependency Explorer 作为独立页面。
