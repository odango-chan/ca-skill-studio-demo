# 产品范围与边界

**状态：Confirmed constraints + Proposed scope**

## 1. 当前阶段的范围

本阶段只做 ca-agent-demo 当前 Skill 资产的编辑器设计和适配原型：

- Skill Library / Package Explorer；
- Markdown / YAML Source Editor；
- Procedure 图形投影和节点 Inspector；
- Contract / Predicate / Case 编辑体验；
- References / Schemas / Scripts 浏览；
- Demo 现有验证入口适配；
- Fixture 来源和版本追溯。

## 2. 当前阶段明确不做

- 不修改 ca-agent-demo 的 Agent Host、Harness、Runtime 或 Skill 源资产；
- 不修改 ca-runtime 或其他组件仓库；
- 不依赖或实现正式 ca-skill-toolchain；
- 不建立新的 Skill DSL 或新的 Runtime 语义；
- 不直接向真实 5GC 发送 SBI / NAS / NGAP / PFCP 请求；
- 不在普通 Preview 或 Validate 中执行 Script；
- 不将 36 个 CreatedSession semantic obligations 伪装成可执行测试；
- 不自动发布、安装或晋升 Skill；
- 不自动合并 GitHub PR；
- 第一版不要求 AI 自动生成完整 Skill。

## 3. 仓库职责

| 仓库 | 当前职责 | 本仓权限 |
|---|---|---|
| ca-skill-studio-demo | Studio 产品、UX、应用和自身测试 | 本仓写入 |
| ca-agent-demo | 当前 Demo Skill、语法、Schema 快照和校验器 | 只读参考 |
| ca-runtime | 执行语义与 Runtime 实现 | 不修改 |
| 其他组件仓 | 各自组件实现和契约 | 不修改 |

## 4. Source of Truth

区分三种对象：

1. **Skill Source**：用户当前打开的真实 Skill Package 文件。
2. **Studio Projection**：由 Skill Source 解析生成的图形、表格、关系图和诊断视图。
3. **Fixture Snapshot**：从 ca-agent-demo 导入、带来源 Commit 和 Digest 的测试样本。

Studio Projection 不得成为第二份权威定义。Fixture Snapshot 不是生产 Skill，也不能反向覆盖源仓。

## 5. 两个初始验证样本

### ensure-pdu-session

用途：基础 Procedure 交互验证。

重点覆盖 verify / call、Predicate 三态、Mutation certainty、reconcile、terminal、Contract postconditions 和五个现有 Case。

### establish-pdu-session

用途：复杂 Procedure 交互和 Demo Transitional 语法验证。

重点覆盖多业务 Procedure、node-level preconditions / postconditions、阶段级 on 路由、多个 Binding 生产者和消费者、async convergence 子流程、Mutation Reconcile 和 36 个语义验收义务。

当前 36 个 Case 不是可执行 Runtime Fixture，必须保持这一事实。

## 6. 运行与副作用边界

- 文件打开、预览、图形投影、静态解析和静态校验均为本地只读或源文件编辑行为。
- Case 的静态检查不等于 Case 执行。
- 未来如增加 Script Sandbox，必须独立显示执行环境、权限、输入、输出和副作用。
- 未来如接入 Runtime 或真实 5GC，必须使用独立的 Run 操作和显式授权。
