# 产品需求

**状态：Proposed · Runtime-asset authoring-first 第一版需求基线**

## 1. 功能需求

| ID | 需求 | 优先级 | 第一版验收方向 |
|---|---|---:|---|
| FR-001 | Runtime Asset Explorer | P0 | 识别并浏览模型上下文和 Host / Runtime 实际消费的 Skill 资产 |
| FR-002 | Package Open / Create | P0 / P1 | P0 打开现有 Package；P1 创建 Blank / Clone Package |
| FR-003 | SKILL.md Editor | P0 | Markdown Source、Preview、Outline、Frontmatter |
| FR-004 | Source Editor | P0 | YAML / JSON / CEL / Python 原文编辑与源位置 |
| FR-005 | Procedure Projection | P0 | 从 Source 构建准确的 Procedure / Phase / Route / Binding 语义模型 |
| FR-006 | Visual Procedure Editing | P0 | 创建、选择、编辑、移动、删除受支持节点和路由 |
| FR-007 | Source / Visual Sync | P0 | 两种编辑入口共享同一 Source revision，修改后双向定位和刷新 |
| FR-008 | Semantic Inspector | P0 | 编辑 Node、Operator、Phase、Step、Binding 和引用属性 |
| FR-009 | Typed Source Patch + Diff | P0 | 所有 Visual 修改转成有前置条件的 Source Patch，预览实际文本差异 |
| FR-010 | Undo / Redo | P0 | Source 与 Visual 修改进入同一事务历史 |
| FR-011 | Conflict Handling | P0 | 外部文件变化时检测冲突，不静默覆盖 |
| FR-012 | Cross-asset Navigation | P0 | 在 Procedure、Predicate、Contract、Script、Schema 和 Reference 之间定位运行时引用 |
| FR-013 | Binding Editor | P1 | 有证据的来源选择、类型提示、生产者 / 消费者导航 |
| FR-014 | Phase Editor | P1 | 有序 Preconditions / Postconditions Step 的增加、删除和重排 |
| FR-015 | Child Procedure Editor | P1 | 独立子图 Drill-in、内部编辑、父子引用导航 |
| FR-016 | Contract / Predicate Editors | P1 | 结构化 Inspector + Source 编辑 |
| FR-017 | Reference / Schema / Script Editors | P1 | 按实际加载 / 消费证据提供 Markdown、Schema 和受治理 Script 编辑 |
| FR-018 | Inline Diagnostics | P1 | 解析、引用、结构和兼容性问题就地提示 |
| FR-019 | AI Co-author | P2 | 只提出候选 Patch，人工审查后应用 |
| FR-020 | Validation / Runtime / Publishing Workbenches | Deferred | 不建设独立工作台，不进入首个编辑纵切 |

## 2. Procedure 编辑要求

### Node

- 支持创建、选择、编辑属性、重命名和删除受支持 Node。
- Operator 类型与 Operator 标识分开编辑。
- 修改 Operator 时检查旧字段、新字段、输入输出和路由语义差异。
- Duplicate 必须生成新的唯一 ID，并检查复制后的内部引用。
- 未知 Operator / Preserve-only Node 不开放结构化编辑。

### Route

- 支持创建、修改 Outcome、修改 Target 和删除 Route。
- 新建 Route 时必须明确 Route Source：Operator、Preconditions、Postconditions 或 Child Procedure。
- 只有当前 Compatibility Profile 声明的 Outcome 才能被结构化选择；未知 Outcome 保留 Source-only。
- Target 必须属于当前 Procedure；跨 Procedure 路由不能被静默接受。
- 删除 Node 前必须处理入边、出边和引用。

### Phase / Step

- 有序 Step 的顺序必须保留。
- 支持受支持 Phase 中的 Step 增加、删除、编辑和重排。
- Preconditions / Postconditions 的聚合 Route 与 Step 自身 Operator Route 不得混淆。
- CreatedSession node-level phases 只有在专用 Profile 的 parser、patch 和 round-trip 测试通过后才开放结构化编辑。

### Binding

- 显示 Consumer、原始表达式、Producer、Field、Declared Type、Source Location 和 Evidence Level。
- 可从已解析且类型证据充分的 Producer 中选择。
- 不确定类型、生产时机或跨 Procedure 语义时，不提供自动补全或自动修复。
- 删除或重命名 Producer 时，必须先显示受影响 Binding 并要求在同一事务中处理或明确保留为 unresolved。

### Child Procedure

- 每个命名 Procedure 独立成图。
- Drill-in / Back 保留父图视图状态。
- 编辑 Child 内部资产不能自动重排或扁平化 Root。
- 新建 / 删除 / 重命名 Child Procedure 前，检查所有调用点、Procedure reference 和 Entry reference。
- 当前样本中的组合语义若尚未建立编辑资格，保持 Source-only。

## 3. Source-preserving 编辑要求

- YAML 编辑层使用 Round-trip AST / CST；普通 SafeLoader 仅用于语义校验，不作为无损编辑器。
- 局部修改只改动目标语法节点，不对整份 YAML 做无关格式化。
- 保留注释、键顺序、空行、缩进、引号 / 标量风格、Block Scalar、未知字段及不支持语法。
- on 必须按 Demo 的 YAML 1.2 语义解析为字符串键；true / false 才是布尔值。
- 每个 Patch 包含 Source revision、目标路径、预期旧值 / 结构指纹和操作类型。
- Patch 应用后重新解析，并验证用户操作结果与新 Semantic Model 一致。
- 任何一步失败，整个事务回滚；不得留下半应用状态。
- 无法证明无损的局部区域降级为 Source-only / Preserve-only。

## 4. 运行时资产需求

### SKILL.md 与 References

- 支持 Frontmatter、Markdown Source、Preview 和 Outline。
- Preview 不自动改写 Source。
- Model Context Preview 必须区分 SKILL.md、自动 preload 和按精确路径显式读取的 Reference。
- 不把 assurance、Script 或 Schema 自动塞入模型上下文。
- 不存在的 references 目录不自动创建。

### Contract

- 编辑 Entry Procedure、Inputs、Required Facts、Allowed Resources、Postconditions、Dependencies 和 Planning / Failure Policy。
- 所有 Procedure、Predicate、Schema 和 Capability 引用必须显示其来源及证据等级。
- Contract 中声明的资源不代表 Host 已经注册或允许执行该资源。
- requestSchema 等引用需区分 Contract-declared 与 Runtime-loaded；没有消费证据时不得显示 Runtime-proven。

### Predicate

- 显示 Observation ref、Scope、Freshness、When、Evaluator、Script ref 和引用者。
- CEL / Script 表达式均保留原文；结构化编辑必须有对应 Parser / Patch 资格。
- Observation ref 和 Script ref 只有在 Host / Runtime Adapter 明确支持时才显示为可执行候选。

### Script / Schema

- Script Source 可编辑，但默认不执行。
- 新增 Script 文件不自动获得 Runtime 执行权限；必须有 Host allowlist / backend 注册证据。
- Schema 显示被哪个 Script / Contract 引用、用于哪个输入或输出边界。
- 区分 Runtime 实际加载的 Schema 与仅被 Contract 声明引用的 Schema。

### References

- references/preload 按 Host 规则自动进入模型上下文。
- references/on-demand 和 references/samples 仅在 SKILL.md 明确给出精确路径时读取。
- 显示加载模式、引用路径和 Source location。
- 不把未被加载的目录内容误报为模型上下文。

## 5. 质量属性

- **无损性**：不相关源文本在局部编辑后保持不变。
- **一致性**：Source、Semantic Model、Visual、Inspector 对同一 revision 一致。
- **可逆性**：事务级 Undo / Redo。
- **冲突安全**：外部修改不能被本地保存静默覆盖。
- **可访问性**：Node / Route / Step / Binding 提供键盘可达的线性编辑方式。
- **兼容性诚实**：Observed / Host-loaded / Runtime-consumed / Contract-declared / Demo-custom-validated 分层。
- **性能**：编辑反馈不要求每次按键都完整重建所有资产索引；允许增量解析，但保存前必须完整一致性检查。

## 6. 首个编辑纵切验收

1. 打开固定基线中的 ensure-pdu-session。
2. Source 修改一个 Node 字段，Visual 选择与 Inspector 同步。
3. Visual 修改一个受支持 Node 属性，生成精确 Typed Patch 和 Diff。
4. 添加一条有合法 Outcome 和 Target 的 Route；Diff 只改动对应 on 项。
5. Undo / Redo 在 Source 与 Visual 中结果一致。
6. 删除被引用 Node 时显示入边和 Binding 影响；未处理影响时阻止删除。
7. 修改 YAML 注释、字段顺序或未知字段附近的无关区域后，其他区域不被格式化重写。
8. 解析失败时保留 Source，旧 Graph 明确标记 STALE。
9. 打开 establish-pdu-session，确认 17 个 Root Node、65 条 Root route entries 和 5 个 Child Procedure 正确解析；过渡 Phase 在未获得专用编辑资格前保持 Source-only。
10. 能从 Predicate 跳转到对应 Observation / Script；Script 和 Schema 的 Runtime allowlist / consumption 证据可见。
11. 普通编辑和保存不执行 Script、Capability、Runtime 或 Live 5GC。
