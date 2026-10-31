# ConnectionAgent Skill Studio Demo

面向 ConnectionAgent Skill 的 **开发、编写、图形化编辑与维护 IDE**。

本仓库先建立产品、编辑体验和源文件编辑架构，再进入应用实现。第一阶段以当前 Demo 中已经存在的 Skill Package、语法和校验行为为唯一兼容性依据；不依赖正式 Toolchain 仓库，也不修改 Agent Host 或 Runtime。

## 当前状态

| 领域 | 状态 |
|---|---|
| 产品定位 | 已调整为 authoring-first Skill IDE，待评审 |
| 工作台与信息架构 | 编辑器优先方案已归档，待评审 |
| Procedure Designer | 双向编辑、Typed Patch、源文件保护方案已归档，待评审 |
| Source-preserving Edit Model | 架构草案已归档；Round-trip POC 未开始 |
| Demo Capability Manifest | 已建立初始观察基线；结构化编辑资格仍需逐项证明 |
| 应用代码 / 技术栈 | 尚未开始；仓库目前没有应用脚手架 |
| Skill fixtures | 尚未导入；当前以固定来源和蓝图作为兼容性样本 |
| Validation / Runtime / Publishing | 不作为当前主要工作台，后置 |

## 从这里开始

1. [产品愿景](docs/product/vision.md)
2. [产品需求](docs/product/requirements.md)
3. [范围与边界](docs/product/scope-and-boundaries.md)
4. [信息架构](docs/ux/information-architecture.md)
5. [工作台布局](docs/ux/workbench-layout.md)
6. [Procedure Designer 语义规范](docs/ux/procedure-designer.md)
7. [Procedure Designer 屏幕规范](docs/ux/procedure-designer-screen-spec.md)
8. [Procedure Designer 交互模型](docs/ux/procedure-designer-interaction-model.md)
9. [Procedure Designer 编辑型线框与设计复盘](docs/ux/procedure-designer-wireframes.md)
10. [Source-preserving Edit Model](docs/architecture/source-preserving-edit-model.md)
11. [ensure-pdu-session Graph Blueprint](docs/ux/ensure-pdu-session-graph-blueprint.md)
12. [establish-pdu-session Graph Blueprint](docs/ux/establish-pdu-session-graph-blueprint.md)
13. [系统架构](docs/architecture/system-architecture.md)
14. [Demo 基线](docs/reference/demo-baseline.md)
15. [开放问题与待决策项](docs/decisions/open-questions.md)
16. [实施路线图](docs/roadmap/implementation-plan.md)

完整文档索引见 [docs/README.md](docs/README.md)。

## 仓库边界

- 本仓库拥有 Skill Studio 的产品文档、UX、架构、应用代码和自身测试。
- ca-agent-demo 是当前 Skill 资产、Demo 语法和现有校验行为的只读参考来源。
- Skill Package 源文件是唯一权威定义；图形和 Inspector 是源文件的结构化编辑界面与派生视图。
- 不把 Skill Studio 变成 ca-agent-demo 的第二个运行时或第二份 Skill authority。
- 当前不修改 ca-agent-demo、ca-runtime 或其他仓库。
- 当前不依赖正式 ca-skill-toolchain 仓库。
- 普通编辑、预览和静态诊断不执行 Script、Capability、Runtime 或真实 5GC 操作。
- 当前不建设独立 Validation / Qualification / Publishing 工作台；不自动发布、安装或合并 Skill。

## 当前参考基线

- Source repository: [odango-chan/ca-agent-demo](https://github.com/odango-chan/ca-agent-demo)
- Source ref: main
- Source commit: bf445ad777149af5af2dfa0a5bdea18d0451303e
- Baseline details: [Demo baseline](docs/reference/demo-baseline.md)
- Machine-readable capability inventory: [spec/editor-capability-manifest.yaml](spec/editor-capability-manifest.yaml)

## 语言与术语

文档以中文说明为主，Skill 文件名、YAML 字段、状态值、Capability、Predicate、Observation、Procedure 等技术标识保持原样。界面中文化策略仍为待确认的 UX 决策。
