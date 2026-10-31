# 产品需求

**状态：Proposed · 第一版需求基线**

## 1. 功能需求

| ID | 需求 | 优先级 | 第一版验收方向 |
|---|---|---:|---|
| FR-001 | 浏览 Skill Library | P0 | 列出当前 Workspace 可见的 Skill，并显示来源与状态 |
| FR-002 | 打开 Skill Package | P0 | 识别必需与可选资产，不创建空目录 |
| FR-003 | 编辑 SKILL.md | P0 | Markdown 编辑、预览、大纲和链接检查 |
| FR-004 | 编辑 YAML 源文件 | P0 | 保留注释、顺序、字符串类型和未知字段 |
| FR-005 | Procedure 图形投影 | P0 | 从源文件构建 Procedure graph、控制流、阶段来源路由和子 Procedure 视图 |
| FR-006 | 节点 Inspector | P0 | 展示 Operator、Effect（有证据时）、Preconditions / Operation / Postconditions、Binding 和 Source |
| FR-007 | Contract 浏览与编辑 | P1 | 表单和 Source 双视图 |
| FR-008 | Predicate 浏览与编辑 | P1 | Observation、Scope、Freshness、CEL / Script |
| FR-009 | Case 管理 | P1 | 显示语义义务与可执行 Fixture 的差异 |
| FR-010 | 跨资产导航 | P0 | 从引用跳转定义，并展示引用者 |
| FR-011 | Validation Center | P0 | 调用当前 Demo 现有校验入口并展示诊断 |
| FR-012 | Diff / Undo / Redo | P1 | 可审查、撤销和恢复源文件修改 |
| FR-013 | Fixture 导入 | P1 | 记录源仓、Commit、路径和文件 Digest |
| FR-014 | AI Co-author | P2 | 只产生候选 Patch，必须人工确认 |
| FR-015 | Runtime Trace 展示 | P2 | 仅展示已有、可验证的 Trace |
| FR-016 | 发布 / Registry 集成 | Deferred | 当前不在实现范围内 |

P0 为可用编辑工作台基础；P1 为完整 Skill authoring 体验所需；P2 为增强能力；Deferred 为明确后置。

## 2. 资产级需求

### SKILL.md

- 支持 Frontmatter 和 Markdown。
- 显示文档大纲和渲染预览。
- 检查内部路径引用。
- 不自动把 assurance、cases 或 scripts 塞入模型上下文。
- Model Context Preview 必须与实际 Host 装配行为区分；无法确认的部分标记为 Preview。

### Procedure

- 支持从 procedures / start / nodes 构建图形投影。
- 默认以显式控制流展示业务主流程；数据 Binding 不默认叠加为控制流边。
- 每个命名 Procedure 独立成图；Child Procedure 通过 Drill-in 导航，不自动扁平化。
- 支持节点选择、阶段查看、路由来源查看和 Source ↔ Visual 定位。
- 显示 inputs、with/from、on、operator 和终态。
- 对节点级 Preconditions / Postconditions 过渡语法，按有序阶段展示；不能提升为额外主业务节点。
- Operation、Preconditions、Postconditions 的 `on` 路由必须保留来源，不能合并为无来源出口。
- 对隐式成功进入 Postconditions 的语义转移明确标识，不伪造成源文件中的显式路由。
- 区分 `reconcile:` Operator 与 `call: ...reconcile`。
- 区分 Operator、Effect、Outcome 和 Procedure terminal。
- 不支持的语法必须保留并标记 Unsupported / Source-only。

### Contract

- 显示 Goal、Skill Type、Entry Procedure、Inputs、Context、Allowed Resources、Preconditions、Requirements、Postconditions、Planning 和 Failure Semantics。
- 对 Capability / Local Tool 引用提供来源导航。
- 检查 Procedure 使用的资源与 Contract 授权之间的一致性；没有可靠目录时显示 Unknown，而不是猜测。

### Predicate

- 显示 Predicate ID、Observation、Scope、Freshness、When 和 Evaluator。
- 支持 CEL / Script 源码查看与编辑。
- 显示被哪些 Procedure 和 Contract 使用。
- 离线 Fixture 求值与真实 Observation 获取必须明确分开。

### Case

- 显示 scenario purpose、context、availableResources、expected planning status、terminal、postconditions 和 trace / fixtures（如存在）。
- 明确区分 semantic obligation、schema-valid case 和 executable fixture。
- 只有真实执行记录才能产生执行状态和覆盖率。

## 3. 质量属性

- **正确性**：无损读取和写入；保留 YAML 1.2 对 true / false 的解析行为，尤其是字符串键 on。
- **可理解性**：主业务流程默认可读；节点详情按需展开。
- **可追溯性**：验证绑定 Package Digest、Schema / Validator 标识和执行范围。
- **安全性**：Preview 和静态验证不执行脚本或外部操作。
- **可扩展性**：新语法通过 Capability Manifest 描述；未知语法无损保留。

## 4. UX 验收场景

1. 第一次打开 ensure-pdu-session，用户能理解观察、创建、Reconcile、复核和终态。
2. 打开 establish-pdu-session，用户能看到复杂主流程、节点内阶段、子流程和 36 个 Case 义务。
3. 选择一个 Binding，能够追踪生产者、输出字段和消费者。
4. 点击 Predicate，能够查看 Observation 来源和 CEL / Script。
5. 修改 YAML 后，流程图和诊断同步更新。
6. 对不支持的语法，编辑器保留源文件且不静默丢字段。
7. 运行当前 Demo 静态门禁后，Validation Center 显示实际命令与结果范围。
8. 相同目标的多阶段路由仍能显示各自来源。
9. 节点声明 Postconditions 时，图形能区分操作成功进入验证阶段与 Postconditions 的 PASS 路由。
10. 对 CreatedSession 的过渡 Binding path 显示其专用 validator 证据等级，而非标记为通用 Schema 支持。
11. Source 解析失败时，旧 Graph 标记 STALE。
12. 普通 Preview / Validate 不触发 Script、Capability、Runtime 或 Live 5GC。
