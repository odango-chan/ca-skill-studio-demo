# Skill Studio Demo 仓库工作规则

## 仓库定位

本仓库是 ConnectionAgent Skill Studio 的独立产品原型仓库，负责产品需求、UX、架构、编辑器应用、Demo 兼容性适配和自身测试。

本仓库不拥有 Agent Host、Skill Runtime、Capability、Observation、正式 Skill Registry 或真实 5GC 环境的 authority。

## 唯一当前兼容性基线

第一阶段只以以下来源为准：

- Repository: odango-chan/ca-agent-demo
- Ref: main
- Baseline commit: bf445ad777149af5af2dfa0a5bdea18d0451303e
- Skill assets: skills/
- Local schema snapshot: tests/contracts/ca-skill-toolchain/03a42764ee2a67e39f57ab550b63c7a5d7966199/
- Existing documentation validator: scripts/validate_docs.py
- Existing local gate: make verify

上面的 Schema 文件是 ca-agent-demo 在基线提交中自带的本地快照。当前阶段不读取、依赖或修改正式 ca-skill-toolchain 仓库。

如果 ca-agent-demo 的 main 发生变化，必须先审查差异，再显式更新本仓 baseline commit 和 Capability Manifest；不得静默漂移。

## 仓库写入边界

允许写入本仓库 docs/、spec/、app/、packages/、tests/、fixtures/ 和本仓配置。

ca-agent-demo 与其他 ConnectionAgent 组件仓库均为只读参考。未经用户明确授权，不得修改其他仓库，不得创建外部 Issue、PR、分支或提交。

## Skill 资产原则

- Skill 源文件是 Markdown / YAML / JSON / Script 等实际 Package 文件。
- Visual Graph 是源文件的投影，不是第二份权威定义。
- 导入的 Fixture 必须记录来源仓库、Commit、源路径和可复现的文件清单或 Digest。
- 不复制整个 ca-agent-demo 仓库。
- 不创建空的 optional Skill 目录。
- 对未知或当前不支持的语法必须无损保留。没有结构化编辑资格但原文可安全编辑时退回 Source-only；能保留但无法解释语义时使用 Preserve-only；无法保证无损保留时阻止修改并明确报告，不得把 Read-only 当作 Source-only 的替代。

## 语法和校验原则

- 当前 Demo 的本地 Schema 快照、专用 validator 和实际 Skill 源文件共同构成兼容性证据。
- Schema 声明、样例中实际使用、专用 validator 检查、Runtime 已支持是不同证据层级，不得混为一谈。
- CreatedSession 的 node-level preconditions / postconditions 属于当前 Demo 的窄范围过渡语法；不能宣称其已被通用 Schema 或 Runtime 完整支持。
- YAML 中的 on 是普通字符串键。解析必须遵守 Demo 的 YAML 1.2 true/false 布尔解析行为。
- Predicate、Mutation 和 Procedure 的状态域必须分开呈现。
- 静态校验通过不等于 Case 执行通过；Case 定义通过不等于 Runtime Qualification；Runtime Qualification 不等于 Live 5GC Acceptance。

## 安全边界

- Preview、图形布局、静态解析和静态校验不得执行 Skill Script、Capability 或网络请求。
- Script 执行必须是显式动作，并在隔离环境、受限权限和可审计输出下进行；未实现前只允许静态检查。
- 真实 5GC 或其他外部副作用操作必须有独立环境选择、风险说明和用户确认。
- AI 只能提出候选 Patch；所有变更展示 Diff，不能绕过校验和人工确认。
- 不得把模型输出当成可信 Observation 或业务成功证据。

## 开发约定

- 先更新产品 / UX / ADR，再实现相应交互。
- 每个功能必须有明确的 source-of-truth、输入、输出、失败状态和测试。
- 状态徽标必须能追溯到源文件 Digest、校验器版本和执行记录。
- 本地验证优先；没有明确授权时不触发 GitHub Actions。
- 不合并默认分支，除非用户明确要求。
