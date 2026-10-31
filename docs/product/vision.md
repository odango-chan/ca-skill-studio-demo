# 产品愿景

**状态：Proposed · Runtime-asset authoring-first**

## 1. 产品定位

ConnectionAgent Skill Studio 是面向 ConnectionAgent Skill Package 的开发与编辑 IDE。当前产品只覆盖 **实际 Skill 模型上下文加载和 Host / Runtime 执行链路会消费的资产**。

它不是普通 Prompt 编辑器、通用 YAML IDE 或 BPMN 绘图器。它需要理解 SKILL.md、Contract、Procedure、Predicate、Binding、受治理 Script、Schema 和 Reference 的不同职责，并让作者能在源码与结构化视图之间安全地创建、修改和维护这些资产。

产品的核心不是“把 Skill 画出来”，而是让作者安全、准确、高效地修改实际运行所依赖的 Skill 源文件。

## 2. 要解决的问题

当前运行相关 Skill 资产分布在 Markdown、YAML、JSON、CEL 和 Python 文件中。作者需要跨文件维护：

- SKILL.md 中的业务目标、适用条件、决策边界和模型指引；
- Contract 中的 Entry Procedure、输入、上下文要求、允许资源和完成条件；
- Procedure 中的业务主线、阶段、Operator、Outcome、Route 和 Binding；
- Predicate 中的 Observation、Scope、Freshness、CEL / Script Evaluator；
- Script 的确定性本地计算逻辑；
- Schema 对 Script 输入输出和已声明数据契约的约束；
- Reference 的 preload / on-demand / samples 加载规则；
- 文件间的精确引用、Digest 和兼容性边界。

纯文本编辑器缺少结构化导航和跨文件上下文；纯图形编辑器容易隐藏 DSL 的精确语义，并可能在保存时重写或丢失注释、顺序和未知字段。

## 3. 核心用户与工作

- **Skill 作者 / 业务设计者**：编写 SKILL.md、Contract 和 Procedure。
- **Skill 工程师**：精确编辑 Operator、Phase、Route、Binding、Predicate、Observation 和 Script 引用。
- **维护者**：理解运行时资产依赖、重构引用、处理兼容性差异并审查修改。

独立验证、Runtime 运维和发布管理员不属于当前产品的首要用户旅程。

## 4. 核心编辑闭环

~~~text
Open Skill Package
       |
       v
Inspect Runtime Asset Map
       |
       v
Edit Source <-----> Edit Visual / Inspector
       |                  |
       |                  v
       |             Typed Source Patch
       |                  |
       |                  v
       +------------> Diff Preview
                           |
                           v
                    Apply to Working Copy
                           |
                           v
                  Reparse + Rebuild Projection
                           |
                           v
                       Save Files
~~~

Source 与 Visual 是同一份 Package 的两种编辑入口，不是两份可以各自演化的定义。Source 是最终权威；Visual 编辑必须通过 Typed Source Patch 回写源文件。

## 5. 核心工作台

1. **Runtime Asset Explorer**：展示当前 Skill 模型上下文和执行链路实际消费、或由运行时契约明确引用的资产。
2. **SKILL.md Editor**：Markdown Source、Preview、Outline 和 Frontmatter。
3. **Procedure Designer**：图形化创建和编辑 Node、Route、Phase、Binding 与 Child Procedure。
4. **Contract / Predicate Editors**：编辑 Entry、Inputs、Required Facts、Allowed Resources、Postconditions、Observation 和 Evaluator。
5. **Script / Schema / Reference Editors**：编辑受治理本地计算、数据契约和模型上下文参考资料。
6. **Problems / Inline Diagnostics**：辅助作者发现解析、引用、结构和兼容性问题，不扩张成独立验证中心。

## 6. 产品体验原则

- **Runtime-grounded scope**：资产是否进入编辑器主导航，以 Host / Runtime 的实际加载和消费证据为准，不以文件存在与否推断。
- **Source is authority**：Package 文件是唯一权威定义，Graph / Inspector 是结构化编辑表面。
- **Source-preserving**：未修改的注释、键顺序、空行、标量风格和未知字段必须保留。
- **Typed editing**：图形操作只能生成有类型、有目标、有前置条件的 Source Patch。
- **Capability-aware**：只有证据充分且 Round-trip 测试通过的语法才开放结构化编辑。
- **No semantic guessing**：无法确认类型、引用目标、Effect 或来源时显示 Unknown / Unresolved，不自动猜测。
- **Profile-aware**：Demo Transitional 语法与通用 Schema / Runtime 能力严格区分。
- **Local-first authoring**：当前只编辑用户工作副本；不自动向源仓提交、推送或发布。

## 7. 成功标准

首个可用原型至少证明：

- 能打开真实 Skill Package，并识别运行时相关资产；
- 能编辑 SKILL.md、Contract、Predicate 和 Procedure Source；
- 能通过 Visual / Inspector 创建和修改受支持的 Procedure 结构；
- Source 修改会刷新 Visual，Visual 修改会生成可审查的 Source Diff；
- 注释、顺序、字符串类型、标量风格和未知字段不因局部编辑而丢失；
- on 保持为字符串键，true / false 保持正确布尔语义；
- Node / Route / Binding / Predicate / Script / Schema 引用不会静默断裂；
- Undo / Redo 能跨 Source 与 Visual 操作保持一致；
- 不支持语法能无损保留，并限制其对应结构化编辑；
- establish-pdu-session 的 CreatedSession 过渡语法不会被错误提升为通用 Runtime 能力；
- 资产是否可执行以 Host allowlist / Runtime adapter 证据为准，新增文件不会自动获得执行权限。

## 8. 当前明确后置

当前不以以下内容作为第一阶段目标：

- 独立 Validation / Qualification Center；
- Runtime Trace 管理与执行调度；
- Script Sandbox；
- Live 5GC；
- Skill Registry、发布、安装和晋升；
- AI 自动生成完整 Skill；
- 多人实时协作和远程 GitHub 编辑。

静态解析与轻量诊断是编辑器的辅助能力，不是主要工作台。

## 9. 产品不变量

- Studio 不拥有 Agent 决策权、Observation 事实权威或 Skill Runtime 语义。
- Studio 不定义新的 Skill DSL。
- Studio 不把 LLM 生成内容直接提升为可信 Skill。
- Studio 不以独立 Graph JSON 替代源文件。
- 当前只承诺适配固定 ca-agent-demo 基线中有证据的运行时资产和语法。
- 不在当前编辑器中暴露不参与 Skill 模型上下文或 Host / Runtime 执行的辅助文件；这些文件仍须在 Package 保存和 Digest 计算中无损保留。
