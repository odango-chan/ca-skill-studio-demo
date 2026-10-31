# 实施路线图

**状态：Proposed**

本路线图按风险和依赖排序。先完成文档与语义基线，再做可运行的最小纵切，避免先堆页面、后发现源文件模型不成立。

## Phase 0：产品与语义基线

交付：产品愿景和范围、信息架构和核心用户旅程、Procedure Designer 语义 / 屏幕 / 交互规范、Demo Capability Manifest、Demo Source baseline、Open Questions / ADR。

退出条件：

- 用户确认工作台布局和 Procedure 双视图策略；
- Manifest 的证据等级可解释；
- CreatedSession Transitional 语法边界明确；
- 两个初始 Skill 样本和来源 Commit 确认；
- Procedure Graph 对 Operator、Effect、Outcome、Terminal 和阶段路由的表达不混淆；
- 两个真实样本的图形投影规则可逐条对照源文件。

## Phase 1：解析与 Workspace 纵切

交付：Package Explorer、Skill Package discovery、YAML / Markdown Source Editor、Round-trip AST POC、Source location、Digest / modified state、Diagnostics 基础模型。

退出条件：

- 打开两个 Fixture；
- 修改并保存 YAML 后注释、顺序、on 字符串键和未知字段保留；
- 再用 Demo Validator 重新验证；
- 外部文件变化可检测并提示冲突。

## Phase 2：Procedure Read-only Designer

交付：Procedure Graph Projection、Node Inspector、路由分组、Preconditions / Operation / Postconditions 展示、Child Procedure Drill-in、Binding Source Navigation、Source ↔ Graph selection sync。

退出条件：

- ensure-pdu-session 基础流程可正确展示；
- establish-pdu-session 过渡语法可正确展示；
- 每个命名 Procedure 单独投影，不把子 Procedure 扁平化；
- 不把阶段步骤变成主业务节点；
- Operation / Preconditions / Postconditions 路由始终保留来源；
- 显式 `on` 与隐式成功进入 Postconditions 不混淆；
- `reconcile:` Operator 与调用 reconcile Capability 的 Call 节点区分；
- Binding 数据依赖默认不与控制流混画；
- 不支持语法无损保留，解析失败时旧图标记 STALE。

## Phase 3：资产编辑器

交付：Contract Editor、Predicate Workbench、Case Studio、References / Schemas / Scripts Browser、Cross-reference Index、Local Diff / Undo / Redo。

退出条件：

- 跨文件引用可定位；
- Case obligations 与 executable fixtures 区分；
- 资产修改能正确使受影响校验结果 Stale。

## Phase 4：Validation Center

交付：Demo Schema Adapter、CreatedSession Transitional Validator Adapter、make verify Adapter、Diagnostics UI、Validation History、Digest-bound reports。

退出条件：

- 所有状态有真实来源；
- 未执行检查显示 NOT_RUN；
- 语义义务不计入执行覆盖率；
- 不把本地门禁 PASS 解释为 Runtime / Live PASS。

## Phase 5：双向图形编辑

交付：Typed Graph Patch、Node create / rename / connect / delete、Binding Designer、Phase Editor、Undo / Redo、Diff Preview。

退出条件：

- 每种操作都有 AST Patch 和 round-trip tests；
- Source 与 Visual 双向修改结果一致；
- 无损性测试覆盖未知字段和注释；
- 不支持语法有明确限制。

## Phase 6：增强能力

候选内容：AI Co-author、Script Sandbox、Runtime Trace Viewer、更多 Skill Compatibility Profiles、GitHub integration、Artifact export / freeze。这些功能不自动进入首版承诺。

## 首个端到端纵切

优先顺序：

1. 打开 ensure-pdu-session；
2. 解析 Procedure；
3. 展示主流程和状态路由；
4. 选择节点并查看 Binding；
5. Source 编辑一处无风险字段；
6. 保存后重新解析；
7. 调用 Demo 当前校验器；
8. 打开 establish-pdu-session 验证 Transitional 阶段和路由。

首个纵切应证明数据模型和源文件处理正确，而不是先追求完整视觉效果。
