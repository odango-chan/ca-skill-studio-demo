# ADR-0002：第一阶段只适配 ca-agent-demo 当前能力

- 状态：Accepted
- 日期：2026-10-31

## 背景

Skill Studio 的第一个目标是服务当前 Demo 中已经存在的 Skill，而不是先抽象一套未来通用语法。正式 Toolchain 仓库当前不作为本项目依赖。

## 决策

第一阶段的唯一兼容性基线为：

- odango-chan/ca-agent-demo；
- main @ bf445ad777149af5af2dfa0a5bdea18d0451303e；
- 该 Commit 中的 Skill Package、Schema snapshot、validator 和 local gate。

## 约束

- 不从正式 ca-skill-toolchain 仓库动态拉取 Schema；
- 不修改 ca-agent-demo；
- 不宣称 Demo Schema 快照等同于外部最新正式 Schema；
- 不将 Schema 声明等同于 Runtime 支持；
- 基线更新必须审查并显式记录。

## 后果

Studio 需要有 Demo Compatibility Adapter 和可更新的 Capability Manifest。未来增加其他兼容目标时，作为显式新 Profile，而不是静默替换当前行为。
