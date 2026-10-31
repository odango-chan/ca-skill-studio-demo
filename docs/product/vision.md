# 产品愿景

**状态：Proposed · Authoring-first 方向已确认，细节待评审**

## 1. 产品定位

ConnectionAgent Skill Studio 是一个面向 Agent Skill Package 的 **开发与编辑 IDE**。

它不是普通 Prompt 编辑器、单纯 YAML IDE 或通用 BPMN 绘图器。它需要理解 Skill 的业务说明、Procedure、Predicate、Contract、Binding、Case 和辅助文件，并让作者能在源码与结构化视图之间自然地创建、修改、组织和维护这些资产。

产品的核心不是“把 Skill 画出来”，而是 **让作者安全、准确、高效地修改 Skill 本身**。

## 2. 要解决的问题

当前 Skill 资产分散在 Markdown、YAML、JSON、CEL 和 Script 文件中。作者需要在多个文件间手工完成：

- 创建和组织 Skill Package；
- 编写 SKILL.md，明确业务目标、适用条件和决策边界；
- 设计 Procedure 的业务主线、分支、阶段和终态；
- 维护 Operator 参数、输入输出和 Binding；
- 维护 Predicate、Observation、Contract 和跨资产引用；
- 理解复杂 Child Procedure 及其局部上下文；
- 修改后确认源文件、图形和引用关系仍然一致。

纯文本编辑器缺少结构化导航和跨文件上下文；纯图形编辑器又容易隐藏 DSL 的精确语义，并可能在保存时重写或丢失注释、顺序和未知字段。

## 3. 核心用户与工作

- **Skill 作者 / 业务设计者**：创建 Package、撰写业务说明、组织 Procedure。
- **Skill 工程师**：精确编辑 Operator、Phase、Route、Binding、Predicate 和 Contract。
- **维护者**：理解已有 Skill、重构节点和引用、处理兼容性差异、审查修改。

验证工程师、Runtime 集成开发者和发布管理员不是当前首要用户旅程；其专用工作台暂不纳入第一阶段。

## 4. 核心编辑闭环

~~~text
Open / Create Skill Package
        |
        v
Explore Package Assets
        |
        v
Edit Source <-----> Edit Visual / Inspector
        |                  |
        |                  v
        |             Typed Source Patch
        |                  |
        |                  v
        |             Patch Preconditions
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

Source 与 Visual 是同一份 Package 的两种编辑入口，不是两份可以各自演化的定义。Source 是最终权威；Visual 编辑必须通过 Typed Source Patch 回写到源文件。

## 5. 核心工作台

1. **Package Explorer**：创建 / 打开 / 组织 Package，导航所有实际存在的资产。
2. **Source Editor**：编辑 Markdown、YAML、JSON、CEL 和 Script 原文。
3. **Procedure Designer**：图形化创建与编辑节点、路由、阶段、Binding 和子流程。
4. **Semantic Inspector**：在上下文中编辑所选资产的属性、输入、引用和来源。
5. **Problems / Inline Diagnostics**：辅助作者发现解析、引用和结构问题；不扩张成独立验证中心。

其他资产编辑器逐步加入，但必须复用同一 Package、Source、Patch、Diff 和 Undo / Redo 模型。

## 6. 产品体验原则

- **Source is authority**：Package 文件是唯一权威定义，Graph / Inspector 是其结构化编辑表面。
- **Source-preserving**：未修改的注释、键顺序、空行、标量风格、未知字段和不支持语法必须保留。
- **Typed editing**：图形操作只能生成有类型、有目标、有前置条件的 Source Patch。
- **Capability-aware**：只有证据充分且 Round-trip 测试通过的语法才开放结构化编辑。
- **Progressive disclosure**：主流程清晰，Phase、Binding、Predicate 和 Route 细节按需展开。
- **Reversible**：每次编辑可预览、可撤销、可重做；失败不留下半应用状态。
- **No semantic guessing**：无法确认类型、引用目标、Effect 或来源时显示 Unknown / Unresolved，不自动猜测。
- **Profile-aware**：Demo Transitional 语法与通用 Schema / Runtime 能力严格区分。
- **Local-first authoring**：当前只编辑用户工作副本；不自动向源仓提交、推送或发布。

## 7. 成功标准

首个可用原型至少证明：

- 能打开并浏览真实 Skill Package；
- 能编辑 SKILL.md 与 Procedure Source；
- 能通过 Visual / Inspector 创建和修改受支持的 Procedure 结构；
- Source 修改会刷新 Visual，Visual 修改会生成可审查的 Source Diff；
- 注释、顺序、字符串类型、标量风格和未知字段不因局部编辑而丢失；
- on 保持为字符串键，true / false 保持正确布尔语义；
- Node / Route / Binding 的引用关系不会因重命名或删除而静默断裂；
- Undo / Redo 能跨 Source 与 Visual 操作保持一致；
- 不支持语法能无损保留，并限制其对应结构化编辑；
- establish-pdu-session 的 CreatedSession 过渡语法不会被错误提升为通用 Runtime 能力。

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
- 当前只承诺适配固定 ca-agent-demo 基线中有证据的语法。
