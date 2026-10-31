# ConnectionAgent Skill Studio Demo

面向 ConnectionAgent Skill Package 的开发与编辑 IDE Demo。

当前产品范围只关注实际进入模型上下文、或被 Host / Runtime 执行链路消费的 Skill 资产：

- SKILL.md；
- Contract / Procedure / Predicate；
- 受治理 Scripts 与其输入 / 输出 Schemas；
- Host 支持的 Reference 加载路径。

核心设计是 Source-preserving 的 Source / Visual 双向编辑：所有结构化修改通过 Typed Source Patch 写回源文件，并经过 Diff、Round-trip 和语义核对。

## 文档

- [产品愿景](docs/product/vision.md)
- [产品需求](docs/product/requirements.md)
- [产品范围与边界](docs/product/scope-and-boundaries.md)
- [文档索引](docs/README.md)
- [Runtime Asset Package Model](docs/architecture/skill-package-model.md)
- [Source-preserving Edit Model](docs/architecture/source-preserving-edit-model.md)
- [Capability Manifest](spec/editor-capability-manifest.yaml)
- [ca-agent-demo 固定基线](docs/reference/demo-baseline.md)
- [实施路线图](docs/roadmap/implementation-plan.md)

## 当前状态

- 产品与 UX / 架构文档基线已建立；
- 应用代码尚未开始；
- Round-trip YAML / Typed Patch POC 尚未执行；
- 首批样本来自固定 ca-agent-demo Commit；
- ca-agent-demo 和其他组件仓库仅作为只读参考；
- 当前不建设独立 Validation / Qualification / Publishing 工作台；
- 不自动发布、安装或合并 Skill。
