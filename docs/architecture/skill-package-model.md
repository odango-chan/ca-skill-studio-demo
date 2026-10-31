# Skill Package 数据模型

**状态：Observed Runtime Asset Baseline + Proposed Studio Model**

## 1. 基本原则

Skill Package 是一组有明确职责的文件资产。Studio 当前只把 **Host / Runtime 实际加载、执行或由运行时契约明确引用的资产**作为一等编辑对象。

不同 Skill 不一定拥有相同目录。Optional 资产只有实际需要时才存在；不为了统一 UI 而创建空目录。

## 2. Runtime Asset Package 形态

~~~text
skills/<skill-name>/
├── SKILL.md
├── assurance/                  # executable Skill
│   ├── contract.yaml
│   ├── procedure.yaml
│   └── predicates.yaml
├── references/                 # optional model-context assets
│   ├── preload/
│   ├── on-demand/
│   └── samples/
├── schemas/                    # optional runtime / contract schemas
└── scripts/                    # optional governed local computation
~~~

当前 Studio 的 Runtime Asset Explorer 不展示非 Runtime / 非 Model-context 辅助文件；这些文件仍属于 Package 工作副本，必须作为 opaque files 无损保留。

## 3. 资产职责与消费证据

| 资产 | Host / Runtime 消费方式 | Studio 视图 |
|---|---|---|
| SKILL.md | SkillContextLoader 读取全文，提取 catalog description 并提供模型上下文 | Markdown Editor |
| assurance/contract.yaml | Admission 读取 Skill type、Entry、Dependencies、Required Facts；精确 Entry Runtime 使用 Postconditions | Contract Editor |
| assurance/procedure.yaml | Admission / Linker 读取 Entry Procedure 并冻结 Runtime Graph | Procedure Designer |
| assurance/predicates.yaml | Admission 加载定义；Linker 冻结 Predicate；PredicateEngine 求值 | Predicate Workbench |
| scripts/ | Procedure Script Step / Predicate Script Evaluator 通过受治理 Backend 执行 | Script Editor |
| schemas/ | 受治理 Script Backend 校验输入 / 输出；Contract 可声明 request schema | Schema Editor |
| references/preload/ | SkillContextLoader 选择 Skill 后自动加载 | Markdown Reference Editor |
| references/on-demand/ | 仅通过 SKILL.md 明确列出的精确路径读取 | Markdown Reference Editor |
| references/samples/ | 仅通过显式精确路径读取，不自动加载 | Markdown Reference Editor |

**证据边界：**

- Contract 中声明的 Schema 路径不自动证明当前直接 Entry Runtime 实际加载该 Schema。
- Script 文件存在不自动获得执行权限；当前 Demo 通过精确 Script allowlist / Backend 约束执行。
- Capability、Observation 和 Script 引用必须区分源文件声明与 Host / Runtime 已注册支持。
- 当前固定 Skill Packages 未观察到实际 references 目录；Host Loader 已实现上述加载规则，因此 Reference Editor 是可选能力，不应自动创建目录。

## 4. Model Context 与 Machine Execution

### Model Context

当前 Demo 的 SkillContextLoader：

- 加载所选 Skill 的 SKILL.md；
- 自动加载 references/preload 下的全部文件；
- references/on-demand 和 references/samples 只能通过 read_reference 精确读取；
- 显式引用路径必须出现在已加载的 SKILL.md 中；
- 不把 assurance、scripts 或 schemas 自动加入模型上下文。

Model Context Preview 必须区分 SKILL.md、preload 和显式按需读取的 Reference，不得把机器执行资产展示为模型已加载内容。

### Machine Execution

当前 Demo 的 Admission / Linker / Runtime：

- 从 assurance/contract.yaml 读取 Skill type、Entry Procedure、依赖和 Required Facts；
- 从 assurance/procedure.yaml 读取并冻结精确 Entry Procedure；
- 从 assurance/predicates.yaml 读取并冻结 Predicate definitions；
- PredicateEngine 消费冻结的 Predicate Definition，按其 Observation ref / Scope / Freshness 获取证据，并执行 CEL 或已注册 Script；
- Governed Script Backend 对 Script identity、输入和输出 Schema 使用精确 allowlist。

Studio 负责编辑源文件和展示已知引用，不拥有 Observation authority、Capability 注册或 Script 执行权限。

## 5. Schema 与 Script 的精确边界

establish-pdu-session 当前受治理 Script Backend 明确支持：

- scripts/select_establishment_configuration.py
- scripts/evaluate_udm_read.py
- scripts/evaluate_transfer_start.py

当前 Script Backend 实际加载的 Schema：

- selection-input.schema.yaml
- selection.schema.yaml
- udm-read-evaluation-input.schema.yaml
- transfer-start-evaluation-input.schema.yaml
- predicate-evaluation-result.schema.yaml

Contract 还声明 establishment-request.schema.yaml 作为 requestSchema；在当前检查的直接 Entry Admission / Linker 路径中没有确认其实际加载，因此 Studio 将其标记为 Contract-declared，而不是 Runtime-loaded。

新增 Script 或 Schema 文件不会自动加入 Backend allowlist。Studio 必须显示该差异，不提供“文件存在即可执行”的假象。

## 6. Package Identity 与 Context Digest

当前 Demo 存在三个不同的 Digest domain，不能混为一谈：

1. Host Skill artifact digest：SkillContextLoader._artifact_digest 和 Root routing identity 对所选 Skill 根目录下全部文件计算 Digest。
2. Model Context digest：SkillContextLoader._digest 只覆盖 SKILL.md 与实际 preload 的 Reference。
3. Admitted executable closure identity：load_admitted_closure 对 contract.yaml、procedure.yaml 和 predicates.yaml 的解析后内容计算 Digest。

因此：

- 文件进入 Host Skill artifact digest，不等于文件被模型加载或 Runtime 消费；
- Model Context digest 不包含 assurance、Script 或 Schema；
- executable closure identity 只由三份 assurance 源定义计算，不应被 Studio 的 Package 文件清单替代；
- 未进入 Runtime Asset Explorer 的文件仍须在完整 Package 保存 / 导出中无损保留；
- 修改 Package 文件可能改变 Host Skill artifact identity；修改三份 assurance 定义会改变 admitted executable closure identity；
- Studio 必须明确显示 Digest domain，不得根据可见资产集合自行重算或合并不同 identity。

## 7. Host-level 外部资产

当前 Root Linker 还读取 planning/skill-surfaces/5gc-file-transfer.yaml，作为 Root local Procedure allowlist。

它位于 Skill Package 之外，是 Host / Demo planning 配置，不属于当前 Skill Package Editor。首版只将它作为外部只读依赖展示，不在 Skill 内创建副本或编辑它。

## 8. 初始样本选择

### ensure-pdu-session

基础样本：SKILL.md、Contract、PredicateSet、Procedure。当前 Predicate 使用 CEL；用于验证基础 Control Flow、状态路由、Reconcile 和 Binding 编辑。

### establish-pdu-session

复杂样本：SKILL.md、Contract、PredicateSet、Procedure、受治理 Scripts 和关联 Schemas。用于验证复杂业务节点、阶段结构、跨节点 Binding、异步等待子流程和 Transitional Syntax。

establish-pdu-session 当前不在 routing 或 installed runtime asset snapshot 中；它是 source-first candidate，不能展示为已安装、已激活或 Runtime-qualified。

## 9. 导入 / 导出

导入先预览 Runtime Asset Map、来源 Commit 和完整 Package 文件清单，不立即写入 Workspace。确认后建立只读 Sample Snapshot 或用户可编辑的 Workspace Copy。

导出必须显示目标路径、完整文件清单和 Diff。即使某些文件不在 Runtime Asset Explorer 中，也必须随 Package 原样保留。默认不向 ca-agent-demo 推送。
