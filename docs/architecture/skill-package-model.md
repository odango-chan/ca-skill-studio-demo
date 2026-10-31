# Skill Package 数据模型

**状态：Observed baseline + Proposed Studio model**

## 1. 基本原则

Skill Package 是一组有明确职责的文件资产。不是所有 Skill 都拥有完全相同的目录；Optional 资产只有实际需要时才存在。

## 2. 当前 Demo 观察到的 Package 形态

~~~text
skills/<skill-name>/
├── SKILL.md
├── assurance/
│   ├── contract.yaml
│   ├── procedure.yaml
│   └── predicates.yaml
├── cases/                  # optional
│   └── <case>/case.yaml
├── references/             # optional
│   ├── preload/
│   ├── on-demand/
│   └── samples/
├── schemas/                # optional
└── scripts/                # optional
~~~

不要创建空 optional directory。

## 3. 资产职责

| 资产 | 职责 | Studio 视图 |
|---|---|---|
| SKILL.md | Model-facing business semantics | Markdown Editor |
| contract.yaml | Skill goal、授权、前后置条件和 planning policy | Contract Editor |
| procedure.yaml | Procedure graph、nodes、bindings 和 routes | Procedure Designer |
| predicates.yaml | Observation、Scope、Freshness、Evaluator | Predicate Workbench |
| cases/ | 业务场景、期望结果和可执行 Fixture（视 Case 而定） | Case Studio |
| references/ | 模型补充资料及加载生命周期 | Reference Browser |
| schemas/ | Skill-owned request / payload schemas | Schema Browser |
| scripts/ | 受治理的确定性本地计算 | Script Browser |

## 4. Model Context 与 Machine Assets

当前 Demo 约定：

- SKILL.md 提供业务含义和决策边界；
- references/preload 在 Host 选择并加载 Skill 后自动加载；
- references/on-demand 只在 SKILL.md 给出精确路径和触发条件时读取；
- references/samples 默认不加载；
- assurance、cases、scripts 不因位于 Package 内就自动进入模型上下文。

Studio 的 Model Context Preview 必须忠实于实际 Host 装配行为。无法证明的部分标记为 Approximate。

## 5. Source / Projection / Fixture

### Source

用户当前打开的真实文件。它是编辑与版本控制的权威来源。

### Projection

解析 Source 后生成的图、表、引用索引和 Inspector Model。不得独立保存业务语义。

### Fixture

从 ca-agent-demo 导入的受版本约束样本。必须有 manifest，记录 source repository、source ref / commit、source package path、file list、per-file digest、package digest、imported timestamp 和 local modifications。

Fixture 不得自动覆盖来源仓库或被误认为生产安装资产。

## 6. 初始样本选择

### ensure-pdu-session

基础样本：Procedure 使用 inputs / start / nodes、verify、call、with/from、on、reconcile 操作和 terminal；包含五个 Case。

### establish-pdu-session

复杂样本：多业务节点、node-level preconditions / postconditions、阶段路由、Script / Call / Verify preparation、跨节点输出引用、异步等待子流程和 36 个 semantic qualification obligations。

## 7. Case 状态区分（未来 Case Editor 参考）

未来扩展 Case Editor / Qualification 集成时，应区分以下生命周期状态：

- Defined；
- Definition Valid；
- Semantic Obligation；
- Fixture Ready；
- Executed；
- Qualified。

这些状态不得从文件存在与否直接推断，必须有对应的校验或执行证据。该生命周期不是首版 Procedure Designer 的 UI 需求；当前只需把 Case 文件作为 Package 源资产浏览和编辑。

## 8. 导入 / 导出

导入先预览，不立即写入 Workspace。确认后建立只读 Fixture 或用户可编辑的 Workspace Copy。

导出必须显示目标路径、文件清单和 Diff。默认不向 ca-agent-demo 推送。
