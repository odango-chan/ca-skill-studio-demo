# ca-agent-demo 参考基线

**状态：Observed · 2026-10-31 核对**

## 1. Source

- Repository: odango-chan/ca-agent-demo
- Ref: main
- Commit: bf445ad777149af5af2dfa0a5bdea18d0451303e
- Tree: 89f45b85e025c2a18952495abcf269e99ddb400e

本文件记录 Skill Studio 第一阶段的兼容性基线。后续更新必须显式审查 Commit 差异并更新 Manifest。

## 2. Skill Inventory

当前 skills/ 下观察到七个 Skill：

| Skill | 当前定位 | 资产特征 |
|---|---|---|
| 5gc-intent | Routing Policy | SKILL.md |
| 5gc-file-transfer | Root Business Skill | SKILL.md、assurance、schemas、scripts |
| ue-registration | UE registration convergence | SKILL.md、assurance |
| ensure-pdu-session | PDU Session target convergence | SKILL.md、assurance、5 Cases |
| ensure-session-qos | QoS convergence | SKILL.md、assurance、5 Cases |
| ensure-virtual-group | Virtual Group lifecycle convergence | SKILL.md、assurance、6 Cases |
| establish-pdu-session | UE-requested initial establishment candidate | SKILL.md、assurance、schemas、scripts、36 Case obligations |

establish-pdu-session 是 source-first candidate；当前 skills/README 明确说明它不在 routing 或 installed runtime asset snapshot 中。不能将其展示为当前已安装、已激活或 Runtime-qualified。

## 3. Package Shape

当前 Demo 约定的 Package 资产：

- 必需的核心资产：SKILL.md；
- reusable executable prototype 常见资产：assurance/contract.yaml、procedure.yaml、predicates.yaml；
- 可选资产：cases、references、schemas、scripts。

不要为了统一 UI 而为每个 Skill 创建空目录。

## 4. Local Schema Snapshot

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

## 5. Validator

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

该门禁证明的是当前 Demo 的文档校验与非 live_model 测试结果。不能据此推断所有 Case 已执行、Runtime Qualification 已通过或真实 5GC 已验收。

## 7. CreatedSession 特殊状态

establish-pdu-session 当前：

- 有独立的 authoring source；
- 使用 node-level preconditions / postconditions；
- 当前 Demo validator 对其做窄范围校验；
- 36 个 Case 是 semantic qualification obligations；
- 不是可执行 Runtime fixtures；
- authoring model 文档明确标记 NOT YET RUNTIME-COMPATIBLE。

Studio 必须保留并显示这些限制。

## 8. 初始 Fixture 计划

首批只考虑两个样本：

1. ensure-pdu-session：验证基础图形、状态路由、Reconcile 和 Contract。
2. establish-pdu-session：验证复杂图形、阶段结构、Binding、Transitional 语法和 Case obligations。

当前尚未复制任何 Skill 文件。导入前应重新确认 source Commit，并生成完整文件清单和 Digest。
