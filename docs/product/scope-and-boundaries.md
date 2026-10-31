# 产品范围与边界

**状态：Runtime-asset authoring-first scope**

## 1. 当前阶段的范围

本阶段只围绕实际 Skill 模型上下文和 Host / Runtime 执行链路消费的资产建设：

- Workspace / Runtime Asset Explorer；
- 打开现有 Skill Package 与样本 Package 导入；
- SKILL.md Markdown Source / Preview；
- Contract、Procedure、Predicate 编辑；
- Procedure Control Flow、Data Flow 和 Semantic Inspector；
- 受支持 Procedure 语法的结构化编辑；
- Source / Visual 双向同步；
- Typed Source Patch、Diff、Undo / Redo；
- Script / Schema 编辑和精确引用导航；
- Host 实际支持的 Reference preload / on-demand / samples；
- 编辑器级解析和运行时兼容性诊断。

第一条真正可编辑的纵切从 ensure-pdu-session 开始。establish-pdu-session 先作为复杂兼容性样本；其 CreatedSession 专用阶段语法在专用 Round-trip / Patch Profile 通过前不开放图形修改。

## 2. 当前明确不做

- 不把不参与模型上下文或 Host / Runtime 执行的辅助文件作为一等编辑资产；
- 不建立测试用例、Fixture、Coverage 或 Qualification 管理功能；
- 不修改 ca-agent-demo 的 Agent Host、Harness、Runtime 或 Skill 源资产；
- 不修改 ca-runtime 或其他组件仓库；
- 不依赖或实现正式 ca-skill-toolchain；
- 不建立新的 Skill DSL 或新的 Runtime 语义；
- 不直接向真实 5GC 发送 SBI / NAS / NGAP / PFCP 请求；
- 不在普通编辑、Preview 或静态诊断中执行 Script；
- 不建设独立 Validation / Qualification Center；
- 不建设 Skill Registry、发布、安装、晋升或远程部署工作台；
- 不在当前阶段实现多人实时协作；
- 不要求 AI 自动生成完整 Skill。

静态校验仅作为编辑器内的辅助诊断，不成为第一阶段的主要用户旅程。

## 3. 仓库职责

| 仓库 | 当前职责 | 本仓权限 |
|---|---|---|
| ca-skill-studio-demo | Studio 产品、UX、架构、应用和自身测试 | 本仓写入 |
| ca-agent-demo | 当前 Demo Skill、Host Loader、Runtime、Schema 快照和校验器 | 只读参考 |
| ca-runtime | 执行语义与 Runtime 实现 | 不修改 |
| 其他组件仓 | 各自组件实现和契约 | 不修改 |

Host-level planning surfaces 等位于 Skill Package 外部的运行配置只作为只读集成依赖，不属于当前 Skill Package 编辑范围。

## 4. Source of Truth

1. **Skill Source**：用户当前工作副本中的 Package 文件，是唯一权威定义。
2. **Concrete Syntax / Round-trip Tree**：承载注释、顺序、格式和未知语法的编辑底层表示。
3. **Semantic Model**：从 Source 解析出的类型化语义索引，用于 Graph、Inspector、引用导航和 Patch 前置条件；不可独立保存为第二份定义。
4. **Studio Projection**：由 Semantic Model 派生的图、表、Inspector 和 Problems。
5. **Sample Package Snapshot**：从 ca-agent-demo 导入、带来源 Commit 和 Digest 的样本；导入后只写入用户明确选择的 Workspace Copy。

Visual 修改必须通过 Typed Source Patch 作用于 Source / Round-trip Tree。不能先修改独立 Graph JSON，再尝试全量重建 YAML。

## 5. 样本策略

### ensure-pdu-session

首个可编辑样本。先开放经过 Round-trip POC 的 call / verify / terminal、with / from、on 和 Node / Route 属性编辑。每一种操作仍需对应测试和 Manifest 资格。

### establish-pdu-session

复杂兼容性样本。先验证完整读取、阶段来源、Binding、Child Procedure 和 Source / Visual 同步。CreatedSession node-level Preconditions / Postconditions 是 Demo-custom-validated、Runtime-incompatible 的过渡语法；在专用 Parser + Typed Patch + Round-trip 测试通过前只允许 Source 编辑，不开放其结构化 Phase 编辑。

## 6. 编辑与副作用边界

- Source / Visual 编辑只修改用户明确打开的工作副本。
- 每次 Visual 结构操作生成 Typed Patch；有歧义或破坏性影响时先显示 Diff / Impact Preview。
- Save 只写入本地工作副本；不自动 commit、push、创建 PR 或发布。
- Preview、解析、引用索引和静态诊断不执行 Script / Capability。
- 外部文件变化时进入 Conflict；不静默覆盖。
- 无法安全处理未知语法时退回 Source-only / Preserve-only。
- Package 的完整 Artifact Digest 可能覆盖未进入 Runtime Asset Explorer 的文件；Studio 必须保留这些文件并参与 Digest 计算，不能因界面不展示而删除或忽略它们。
