# 实施路线图

**状态：Proposed · Runtime-asset authoring-first**

按源文件风险和功能依赖排序。先证明无损编辑，再搭建应用，最后扩展实际 Runtime / Model-context 资产编辑。独立验证和发布不作为当前主路线。

## Phase 0：产品与编辑模型

交付：Runtime-asset authoring-first 产品愿景、Runtime Asset Explorer 信息架构、Procedure 编辑 UX、Source-preserving Edit Model、ADR-0005、固定 Demo baseline 和 Capability Manifest。

退出条件：

- 用户确认只关注实际 Skill 模型上下文与 Host / Runtime 消费的资产；
- Source 是唯一权威定义；
- Source / Visual 的双向编辑模型清楚；
- Typed Patch、Diff、Undo / Redo、Conflict 语义明确；
- ensure-pdu-session 与 establish-pdu-session 的兼容边界明确；
- Runtime-consumed、Model-context-consumed、Contract-declared 和 Host-external 资产分层明确。

## Phase 1：Round-trip YAML + Typed Patch POC

交付：独立于 UI 框架的最小源文件 POC。

覆盖：

- 无修改 round-trip；
- 注释、键顺序、空行、缩进、scalar style、block scalar、未知字段；
- on 字符串键和 true / false 布尔语义；
- SetScalar、AddRoute、RenameNode、InsertSequenceItem；
- 局部 Diff；
- Patch 前置条件；
- Reparse / Semantic comparison；
- 失败原子回滚；
- 固定 Demo Loader / Validator 复核。

退出条件：

- 两个真实样本无修改 round-trip；
- ensure 的有限局部 Patch 不重写无关区域；
- establish Transitional 结构完整保留；
- 不支持 / 未知结构可 Source-only / Preserve-only；
- 技术 POC 报告给出 YAML CST / Round-trip Parser 决策。

## Phase 2：Package Workspace + Source Editor

交付：

- Workspace Open / Recent；
- Runtime Asset Explorer；
- 多文件 Editor Tabs；
- Markdown / YAML / JSON / CEL / Python Source Editor；
- Source revision / Dirty / Save；
- File Watch / Conflict；
- Problems 基础面板；
- Undo / Redo 基础历史；
- 完整 Package 文件保留与 Artifact Digest 更新。

退出条件：

- 打开本地 Package 并识别 Runtime Asset Map；
- 编辑并保存 Runtime / Model-context Source；
- 外部修改不被静默覆盖；
- Runtime Asset Explorer 与实际 Host 消费证据一致；
- optional 目录不会被自动创建；
- 未建模文件不被删除或排除出完整 Digest。

## Phase 3：Procedure Designer 首个可编辑纵切（ensure）

交付：

- Control Flow Canvas；
- Node / Route / Phase Inspector；
- Visual Node / Route editing；
- Typed Patch Engine；
- Source / Visual / Split 双向同步；
- Diff Preview；
- Undo / Redo；
- Node / Route Outline 键盘导航。

退出条件：

- ensure 的 11 个 Node、24 条显式 route entries 与 5 个 terminal nodes 正确投影；
- 支持的 Node / Route 编辑生成精确 Patch；
- Node rename / delete 显示引用影响；
- Route Source / Outcome / Target 不丢失；
- Source 注释 / 顺序 / 未知字段不被无关重写；
- Undo / Redo 与 Source / Visual 一致；
- 失败操作原子回滚。

## Phase 4：Procedure 编辑扩展

交付：

- Binding Editor / Data Flow Lens；
- Ordered Phase / Step Editor；
- Child Procedure Drill-in 与受支持内容编辑；
- 多文件引用 Impact Preview；
- establish 复杂样本的 Compatibility Profile。

退出条件：

- establish 的 17 Root Nodes、65 Root route entries、5 Child Procedures 正确读取；
- CreatedSession node-level Preconditions / Postconditions 在专用 Profile 未通过前 Source-only；
- 三种 Handle、Route Source、隐式阶段转换准确区分。

## Phase 5：Runtime Asset Editors

交付：

- SKILL.md Frontmatter / Markdown Editor；
- Contract Editor；
- Predicate Workbench；
- Script Source Editor；
- Schema Editor；
- Reference Editor（仅在 Host 支持且样本真实使用时）；
- Runtime Asset Map / Cross-asset Reference Index。

退出条件：

- 所有结构化表单由 Source Patch 驱动；
- 不支持字段保留；
- 引用跳转准确；
- Script / Schema 的 Runtime 消费与 allowlist 证据准确；
- Source 与 Inspector 同步；
- Model Context Preview 与 Host Loader 行为一致。

## Phase 6：增强能力（后置）

候选：AI Co-author、更多 Compatibility Profile、GitHub integration。

独立 Validation / Runtime Operations、Registry / Publishing、安装和晋升工作台不属于当前路线，只有后续明确提出需求时再规划。

## 技术选型闸门

仓库当前没有应用脚手架。Phase 1 Round-trip POC 完成前，不锁定 UI 框架、Graph Library、编辑器控件或 Desktop Shell。先证明源文件编辑不会丢语义，再决定应用技术。
