# ConnectionAgent Skill Studio Demo

面向 ConnectionAgent Skill 的独立设计、编辑、验证与资格验收工作台原型。

本仓库先建立产品、UX 和架构基线，再进入应用实现。第一阶段以当前 Demo 中已经存在的 Skill Package、语法和校验行为为唯一兼容性依据；不依赖正式 Toolchain 仓库，也不修改 Agent Host 或 Runtime。

## 当前状态

| 领域 | 状态 |
|---|---|
| 产品定位 | 初版已归档，待评审 |
| 信息架构与工作台 UX | 初版已归档，待评审 |
| Procedure Designer | 交互规范初版已归档，待高保真细化 |
| Demo Capability Manifest | 已建立初始观察基线 |
| 应用代码 | 尚未开始 |
| Skill fixtures | 尚未导入 |
| Runtime / Live Qualification | 不属于当前文档初始化阶段 |

## 从这里开始

1. [产品愿景](docs/product/vision.md)
2. [产品需求](docs/product/requirements.md)
3. [信息架构](docs/ux/information-architecture.md)
4. [工作台布局](docs/ux/workbench-layout.md)
5. [Procedure Designer UX](docs/ux/procedure-designer.md)
6. [技术架构](docs/architecture/system-architecture.md)
7. [Demo 基线](docs/reference/demo-baseline.md)
8. [开放问题与待决策项](docs/decisions/open-questions.md)
9. [实施路线图](docs/roadmap/implementation-plan.md)

完整文档索引见 [docs/README.md](docs/README.md)。

## 仓库边界

- 本仓库拥有 Skill Studio 的产品文档、UX、应用代码和编辑器自身测试。
- ca-agent-demo 是当前 Skill 资产、Demo 语法和现有校验行为的只读参考来源。
- 不把 Skill Studio 变成 ca-agent-demo 的第二个运行时或第二份 Skill authority。
- 当前不修改 ca-agent-demo、ca-runtime 或其他仓库。
- 当前不依赖正式 ca-skill-toolchain 仓库；本仓只记录 ca-agent-demo 已提交的本地 Schema 快照和校验实现。
- 预览、静态校验和 Case 定义浏览不得隐式触发真实网络操作。
- 未经明确确认，不执行 GitHub Actions、不合并 PR、不发布或安装 Skill。

## 当前参考基线

- Source repository: [odango-chan/ca-agent-demo](https://github.com/odango-chan/ca-agent-demo)
- Source ref: main
- Source commit: bf445ad777149af5af2dfa0a5bdea18d0451303e
- Baseline details: [Demo baseline](docs/reference/demo-baseline.md)
- Machine-readable capability inventory: [spec/editor-capability-manifest.yaml](spec/editor-capability-manifest.yaml)

## 语言与术语

文档以中文说明为主，Skill 文件名、YAML 字段、状态值、Capability、Predicate、Observation、Procedure 等技术标识保持原样。界面中文化策略仍是待确认的 UX 决策。
