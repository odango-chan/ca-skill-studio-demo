# 产品范围与边界

**状态：Authoring-first scope · Confirmed repository constraints + Proposed delivery**

## 1. 当前阶段的范围

本阶段以 Skill 开发和维护为中心：

- Workspace / Package Explorer；
- 打开现有 Skill Package 与只读 Fixture 导入；
- SKILL.md Markdown Source / Preview；
- YAML / JSON / CEL / Script Source Editor；
- Procedure Control Flow、Data Flow 和 Semantic Inspector；
- 受支持 Procedure 语法的结构化编辑；
- Source / Visual 双向同步；
- Typed Source Patch、Diff、Undo / Redo；
- Binding / Predicate / Contract 的跨资产导航；
- 编辑器级解析和引用诊断；
- 其他资产的结构化编辑逐步扩展。

第一条真正可编辑的纵切从 ensure-pdu-session 开始。establish-pdu-session 先作为复杂兼容性样本；其 CreatedSession 专用阶段语法在专用 Round-trip / Patch Profile 通过前不开放图形修改。

## 2. 当前明确不做

- 不修改 ca-agent-demo 的 Agent Host、Harness、Runtime 或 Skill 源资产；
- 不修改 ca-runtime 或其他组件仓库；
- 不依赖或实现正式 ca-skill-toolchain；
- 不建立新的 Skill DSL 或新的 Runtime 语义；
- 不直接向真实 5GC 发送 SBI / NAS / NGAP / PFCP 请求；
- 不在普通编辑、Preview 或静态诊断中执行 Script；
- 不把 36 个 CreatedSession semantic obligations 伪装成可执行测试；
- 不建设独立 Validation / Qualification Center；
- 不建设 Skill Registry、发布、安装、晋升或远程部署工作台；
- 不在当前阶段实现多人实时协作；
- 不要求 AI 自动生成完整 Skill。

静态校验仅作为编辑器内的辅助诊断，不成为第一阶段的主要用户旅程。

## 3. 仓库职责

| 仓库 | 当前职责 | 本仓权限 |
|---|---|---|
| ca-skill-studio-demo | Studio 产品、UX、架构、应用和自身测试 | 本仓写入 |
| ca-agent-demo | 当前 Demo Skill、语法、Schema 快照和校验器 | 只读参考 |
| ca-runtime | 执行语义与 Runtime 实现 | 不修改 |
| 其他组件仓 | 各自组件实现和契约 | 不修改 |

## 4. Source of Truth

1. **Skill Source**：用户当前工作副本中的 Package 文件，是唯一权威定义。
2. **Concrete Syntax / Round-trip Tree**：承载注释、顺序、格式和未知语法的编辑底层表示。
3. **Semantic Model**：从 Source 解析出的类型化语义索引，用于 Graph、Inspector、引用导航和 Patch 前置条件；不可独立保存为第二份定义。
4. **Studio Projection**：由 Semantic Model 派生的图、表、Inspector 和 Problems。
5. **Fixture Snapshot**：从 ca-agent-demo 导入、带来源 Commit 和 Digest 的样本；导入后只写入用户明确选择的 Workspace Copy。

Visual 修改必须通过 Typed Source Patch 作用于 Source / Round-trip Tree。不能先修改独立 Graph JSON，再尝试全量重建 YAML。

## 5. 样本策略

### ensure-pdu-session

首个可编辑样本。先开放经过 Round-trip POC 的 call / verify / terminal、with / from、on 和 Node / Route 属性编辑。每一种操作仍需对应测试和 Manifest 资格。

### establish-pdu-session

复杂兼容性样本。先验证完整读取、阶段来源、Binding、Child Procedure 和 Source / Visual 同步。CreatedSession node-level Preconditions / Postconditions 是 Demo-custom-validated、Runtime-incompatible 的过渡语法；在专用 Parser + Typed Patch + Round-trip 测试通过前只允许 Source 编辑，不开放其结构化 Phase 编辑。

当前 36 个 Case 是 semantic qualification obligations，不是可执行 Runtime Fixture。

## 6. 编辑与副作用边界

- Source / Visual 编辑只修改用户明确打开的工作副本。
- 每次 Visual 结构操作生成 Typed Patch；有歧义或破坏性影响时先显示 Diff / Impact Preview。
- Save 只写入本地工作副本；不自动 commit、push、创建 PR 或发布。
- Preview、解析、引用索引和静态诊断不执行 Script / Capability。
- 外部文件变化时进入 Conflict；不静默覆盖。
- 无法安全处理未知语法时退回 Source-only / Preserve-only。
