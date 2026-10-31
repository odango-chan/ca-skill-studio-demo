# 文档索引

本文档集描述 Skill Studio Demo 的产品、authoring UX、源文件编辑架构和实施计划。当前优先建设 Skill Package 开发与编辑体验；验证、Runtime 和发布工作台暂时后置。

## 产品

- [产品愿景](product/vision.md)
- [产品需求](product/requirements.md)
- [范围与边界](product/scope-and-boundaries.md)

## UX

- [信息架构](ux/information-architecture.md)
- [Skill Authoring Workbench](ux/workbench-layout.md)
- [Procedure Designer 语义规范](ux/procedure-designer.md)
- [Procedure Designer 屏幕规范](ux/procedure-designer-screen-spec.md)
- [Procedure Designer 交互模型](ux/procedure-designer-interaction-model.md)
- [Procedure Designer 编辑型线框与设计复盘](ux/procedure-designer-wireframes.md)
- [ensure-pdu-session Graph Projection Blueprint](ux/ensure-pdu-session-graph-blueprint.md)
- [establish-pdu-session Graph Projection Blueprint](ux/establish-pdu-session-graph-blueprint.md)
- [资产编辑器](ux/asset-editors.md)
- [核心用户旅程](ux/user-journeys.md)
- [交互与视觉语言](ux/interaction-and-visual-language.md)

## 架构

- [系统架构](architecture/system-architecture.md)
- [Source-preserving Edit Model](architecture/source-preserving-edit-model.md)
- [Skill Package 模型](architecture/skill-package-model.md)
- [Editor Capability Manifest](architecture/editor-capability-manifest.md)
- [机器可读 Manifest](../spec/editor-capability-manifest.yaml)

## 参考

- [ca-agent-demo 基线](reference/demo-baseline.md)
- [Validation Center UX（后置参考设计）](ux/validation-center.md)

## 决策

- [决策记录索引](decisions/README.md)
- [开放问题](decisions/open-questions.md)

## 路线图

- [实施计划](roadmap/implementation-plan.md)

## 文档状态约定

- **Confirmed**：用户明确确认或当前源仓事实直接确定。
- **Proposed**：设计建议，尚待用户确认。
- **Open**：需要补充信息或明确决策。
- **Deferred**：明确后置。
- **Observed**：从当前 Demo 源文件或实现中直接观察到的事实。

不要把 Proposed / Open 内容写成已实现事实。
