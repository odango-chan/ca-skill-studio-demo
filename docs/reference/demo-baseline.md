# ca-agent-demo 参考基线

**状态：Observed · 2026-10-31 核对**

## 1. Source

- Repository: odango-chan/ca-agent-demo
- Commit: bf445ad777149af5af2dfa0a5bdea18d0451303e
- Tree: 89f45b85e025c2a18952495abcf269e99ddb400e

本文件记录 Skill Studio 第一阶段的兼容性基线。后续更新必须显式审查 Commit 差异并更新 Manifest。

## 2. Skill Inventory

当前 skills/ 下观察到七个 Skill：

| Skill | 当前定位 | 运行时相关资产 |
|---|---|---|
| 5gc-intent | Routing Policy | SKILL.md |
| 5gc-file-transfer | Root Business Skill | SKILL.md、assurance、schemas、scripts |
| ue-registration | UE registration convergence | SKILL.md、assurance |
| ensure-pdu-session | PDU Session target convergence | SKILL.md、assurance |
| ensure-session-qos | QoS convergence | SKILL.md、assurance |
| ensure-virtual-group | Virtual Group lifecycle convergence | SKILL.md、assurance |
| establish-pdu-session | UE-requested initial establishment candidate | SKILL.md、assurance、schemas、scripts |

establish-pdu-session 是 source-first candidate；当前 skills/README 明确说明它不在 routing 或 installed runtime asset snapshot 中。不能将其展示为当前已安装、已激活或 Runtime-qualified。

## 3. Host / Runtime 消费路径

当前固定基线的关键消费实现：

- SkillContextLoader：读取 SKILL.md、自动加载 references/preload，并按精确路径读取 on-demand / samples；
- load_admitted_closure：读取 assurance/contract.yaml、procedure.yaml 和 predicates.yaml；
- compile_link_admit_skill_entry / Linker：冻结精确 Entry Procedure 和 Predicate definitions；
- PredicateEngine：按 Predicate 定义读取 Observation，执行 CEL 或受治理 Script；
- GovernedCreatedSessionScriptBackend：按精确 Script allowlist 执行本地计算，并加载对应输入 / 输出 Schema；
- Host Skill Artifact Digest：SkillContextLoader / Root routing 对所选 Skill 根目录全部文件计算；Model Context Digest 只覆盖 SKILL.md 和实际 preload 文件；Admitted Executable Closure Digest 则只覆盖 Contract、Procedure、Predicate 三份 assurance 源定义。三个 Digest domain 不可混用。

文件是否进入 Artifact Digest，不等于文件被模型加载或 Runtime 消费。

## 4. Package Shape

当前运行时相关资产：

- SKILL.md；
- assurance/contract.yaml；
- assurance/procedure.yaml；
- assurance/predicates.yaml；
- 可选 references/、schemas/、scripts/。

references 目录在当前固定 Skill Packages 中未实际观察到，但 Host Loader 已支持相应加载模式。不要为了统一 UI 而创建空目录。

## 5. Local Schema Snapshot 与 Validator

ca-agent-demo 自己包含固定 Schema 快照：

~~~text
tests/contracts/ca-skill-toolchain/03a42764ee2a67e39f57ab550b63c7a5d7966199/
  common.schema.yaml
  procedure-source.schema.yaml
  skill-contract.schema.yaml
  predicate-set.schema.yaml
  procedure-proposal.schema.yaml
~~~

该快照是本阶段 Demo 兼容性证据的一部分。Skill Studio 不依赖正式 ca-skill-toolchain 仓库，也不从外部动态下载 Schema。

当前 Demo 的文档校验入口：

- scripts/validate_docs.py；
- local Schema snapshot validation；
- CreatedSession 专用 validate_createdsession_authoring_source；
- YAML loader 对 on key 的 YAML 1.2 bool 解析兼容。

CreatedSession 专用 validator 对当前 preconditions / postconditions 形状、step operator、允许的 call / script / procedure 和路由集合做窄范围检查，并对主业务节点顺序和退役写法做额外约束。这不是通用的可扩展 Procedure validator。

## 6. Local Gate

Makefile 的 verify 目标执行：

~~~make
verify:
    uv run python scripts/validate_docs.py
    uv run pytest -q -m "not live_model"
~~~

该门禁证明当前 Demo 的文档校验与非 live_model 测试结果。它不是 Skill Studio 的运行时编辑能力证明，也不代表真实 5GC 已验收。

## 7. CreatedSession 特殊状态

establish-pdu-session 当前：

- 有独立的 Contract、Procedure、Predicate、Script 和 Schema source；
- 使用 node-level preconditions / postconditions；
- 当前 Demo validator 对其做窄范围校验；
- 这些 node-level phase 语义尚未进入通用 Toolchain ProcedureSource schema；
- 当前 authoring source 标记为 NOT YET RUNTIME-COMPATIBLE。

Studio 必须保留并显示这些限制。

## 8. 初始样本计划

首批只考虑两个 Skill Package：

1. ensure-pdu-session：验证基础图形、状态路由、Reconcile、Predicate 和 Contract。
2. establish-pdu-session：验证复杂图形、阶段结构、Binding、受治理 Script / Schema 和 Transitional 语法。

当前尚未复制任何 Skill 文件。导入前应重新确认 source Commit，并生成完整文件清单和 Digest。

对应的源代码级图形投影基准：

- [ensure-pdu-session Graph Projection Blueprint](../ux/ensure-pdu-session-graph-blueprint.md)
- [establish-pdu-session Graph Projection Blueprint](../ux/establish-pdu-session-graph-blueprint.md)
