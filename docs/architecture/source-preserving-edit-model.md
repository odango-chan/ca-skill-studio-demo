# Source-preserving Edit Model

**状态：Proposed · 核心编辑架构，技术 POC 待完成**

本文件定义 Skill Studio 如何同时支持 Source 与 Visual 编辑，并保证 Skill Package 文件仍是唯一权威定义。

## 1. 核心原则

- Source 是唯一权威；Semantic Model、Graph、Inspector、Index 和 Layout 都是派生对象。
- Visual 不直接编辑独立 Graph JSON，也不全量重建 YAML。
- 每个 Visual 操作生成 Typed Source Patch，作用于 Source 的 Round-trip Tree。
- Source 文本修改重新解析并刷新 Semantic Model / Visual。
- 无法证明局部修改无损时，阻止该区域的结构化编辑，保留 Source-only / Preserve-only。
- 一次编辑失败必须原子回滚，不留下 Source 与 Projection 不一致的半应用状态。

## 2. 分层模型

~~~text
Package Files (authoritative)
        |
        v
Concrete Syntax / Round-trip Tree
  - comments / whitespace / ordering
  - scalar style / quoting / block style
  - unknown syntax / source spans
        |
        v
Compatibility Parser + Semantic Extractor
        |
        +------> Source Map / Cross-reference Index
        |
        v
Typed Semantic Model
  - Package / Procedure / Node
  - Operator / Phase / Step
  - Route / Binding / Terminal
  - capability evidence / editability
        |
        +------> Control Flow Projection
        +------> Data Flow Projection
        +------> Semantic Inspector
        +------> Problems / Diagnostics
        |
        v
Typed Source Patch (Visual edits only)
        |
        v
Round-trip Tree Patch Applier
        |
        v
Diff Preview -> Apply to Working Buffer -> Reparse
        |
        v
Save to local Package working copy
~~~

Semantic Model 不持有独立可保存的业务定义。画布布局、折叠状态和选中状态属于 UI state，不写入 Skill YAML，除非未来出现明确的 Skill-level layout contract。

## 3. 文件与文档状态

每个打开的文件维护：

- baseRevision：打开或上次保存时的文件 Digest；
- workingRevision：当前编辑缓冲区 Digest；
- roundTripTree：保留源语法与格式的树；
- semanticProjection：当前可解析的语义模型；
- sourceMap：语义对象到文件、行列、语法路径的映射；
- diagnostics：与 workingRevision 绑定的诊断；
- history：事务级 Undo / Redo；
- externalRevision：检测到的磁盘最新 Digest（如可用）。

状态至少包括 CLEAN、DIRTY、SAVING、CONFLICT、INVALID、STALE。

## 4. Typed Source Patch

### 4.1 Patch 结构

每个 Patch 至少包含：

- patchId；
- operation；
- packagePath / documentPath；
- baseRevision；
- targetSemanticPath；
- targetSourceRange（如果可定位）；
- expectedOldValue 或 expectedStructureFingerprint；
- payload；
- preconditions；
- affectedReferences；
- inverse（可撤销操作）；
- compatibilityProfile；
- capabilityEvidence。

Patch 必须绑定生成它时的 Source revision。若应用前目标内容已变化，Patch 失败并要求重新基于当前 Source 生成，不允许盲目覆盖。

### 4.2 初始操作族

| Patch Operation | 目标 |
|---|---|
| SetScalar | 修改已知标量字段 |
| InsertMappingEntry | 在指定顺序位置新增映射项 |
| RemoveMappingEntry | 删除指定映射项 |
| InsertSequenceItem | 插入有序 Step / Item |
| RemoveSequenceItem | 删除有序 Step / Item |
| MoveSequenceItem | 调整有序列表顺序 |
| SetOperator | 切换已支持 Operator 并重建其受控字段 |
| AddNode | 在当前 Procedure 增加 Node |
| RenameNode | 重命名 Node 并处理引用 |
| DeleteNode | 删除 Node 并处理依赖 |
| AddRoute / UpdateRoute / DeleteRoute | 修改明确 Route Source 下的 on 映射 |
| SetBinding | 修改 with / from / value |
| AddProcedure / RenameProcedure / DeleteProcedure | 修改 Procedure definition 与引用 |

Patch Operation 是 Studio 内部编辑协议，不是新的 Skill DSL。

### 4.3 语义前置条件

- Node ID 在当前 Procedure 内唯一；
- Route target 属于当前 Procedure，除非源语义明确允许其他引用；
- Route Source 明确，不将 Operator / Preconditions / Postconditions 混合；
- Outcome 属于当前 Profile 已知范围；未知 Outcome 保留 Source-only；
- Binding Producer 存在且字段可定位；类型未知时不伪造类型安全；
- 删除 / 重命名前列出入边、出边、Binding 和跨资产引用；
- 更改 start、Entry Procedure 或 Child Procedure 时检查相关引用；
- 受专用 validator 检查的顺序约束必须保留；
- 对 Transitional Syntax 只有对应 Profile 明确声明编辑资格时才开放 Patch。

## 5. 一次编辑事务

~~~text
User Command
  -> Resolve selected semantic target
  -> Check source revision / capability / preconditions
  -> Build Typed Patch
  -> Build Impact Preview (if destructive / multi-reference)
  -> Apply Patch to in-memory Round-trip Tree
  -> Serialize only touched syntax region
  -> Reparse output
  -> Rebuild affected semantic projection
  -> Compare intended semantic result
  -> Verify untouched regions remain unchanged
  -> Show Source Diff
  -> Commit to working buffer
~~~

任一步失败：丢弃临时 Tree / Buffer，保持上一个可用 revision 不变。

Visual 操作应用到 working buffer 后不自动写盘；用户可 Undo / Redo、继续编辑或 Save。Save 写入本地工作副本，不触发 Git / Remote 发布动作。

## 6. Source 编辑事务

Source 编辑后：

1. 保留用户输入原文；
2. 增量解析受影响区域；
3. 解析成功时更新 Semantic Model 和 Visual；
4. 解析失败时不修复或覆盖原文，旧 Projection 标记 STALE；
5. 诊断必须绑定新的 Working Revision；
6. 用户修复语法后重新生成当前 Projection。

Source / Visual 在 Split 中都可以编辑，但每次编辑只更新同一份 Working Buffer，不存在双文档冲突。

## 7. 无损性约束

Round-trip POC 至少验证：

- 注释位置与内容；
- Mapping key 顺序；
- Sequence 顺序；
- 空行、缩进和换行符；
- 单引号 / 双引号 / Plain scalar 风格；
- Block scalar 的 | / > 及 chomping indicator；
- 未知字段、未知 Operator 和未知 Outcome；
- YAML anchor / alias（如当前 Skill 使用或解析器支持）；
- on 作为字符串键；
- true / false 作为布尔值；
- UTF-8 内容与 BOM 行为；
- 重复 key 的明确拒绝或保留策略，不能静默覆盖。

**局部无损**比“全文件 parse → dump”更重要。不能只比较解析后的对象相等，因为对象相等无法证明注释、顺序和样式没有丢失。

POC 应对两个固定样本执行无修改 round-trip，再执行一处局部修改，检查 Diff 是否只触及目标语法区域。

## 8. Undo / Redo

- Source typing 按编辑器的合理时间 / 光标边界分组；
- 一次 Visual 命令是一个事务；
- 复合操作（如重命名并更新所有引用）是一个原子事务；
- Undo / Redo 使用 Patch inverse 或受校验的文本 Diff；
- Undo / Redo 后重新计算 Working Revision 和 Projection；
- 外部修改导致 base revision 不匹配时，不把旧历史直接写回磁盘。

## 9. 冲突与多文件修改

### 外部文件变化

若磁盘文件 Digest 与 baseRevision 不同：

- 标记 CONFLICT；
- 保留本地 Working Buffer；
- 提供 Compare / Reload / Resolve；
- 不允许静默覆盖外部修改；
- Resolve 后重新解析并重建 Patch history。

### 跨文件引用

第一版可以先限制单文件 Visual Patch。重命名 Predicate / Procedure、修改跨文件引用等操作必须先生成完整 Impact Preview；只有多文件事务可以保证原子写入时，才开放自动批量更新。否则只提供引用清单和逐文件手动编辑。

## 10. Capability Manifest 与编辑资格

Manifest 的语法证据和编辑行为分开：

- observed-and-used 不自动等于 editable；
- demo-schema-declared 不自动等于 Runtime-proven；
- demo-custom-validated 不自动等于通用 Schema；
- editable 必须有 Parser、Patch、Round-trip 和测试证据；
- source-only 仍可编辑原文，但不开放结构化控件；
- preserve-only 不理解语义，但必须无损保留。

建议为每个语法 / 字段声明：
parseSupport、projectionSupport、patchSupport、roundTripTest、validatorEvidence、runtimeEvidence。

## 11. 首个技术 POC

仓库当前没有应用脚手架，也未选技术栈。先完成独立的 Round-trip POC，再决定 UI 和 Graph 技术：

1. 读取固定 ca-agent-demo commit 的 ensure-pdu-session 和 establish-pdu-session Procedure YAML；
2. 无修改 round-trip；
3. 局部 SetScalar / AddRoute / RenameNode / InsertSequenceItem；
4. 对照原始文件 Diff；
5. 用 ca-agent-demo 固定 Loader / Validator 语义复核输出；
6. 确认未知字段、注释、顺序和 on 键不丢失；
7. 验证失败原子回滚；
8. 形成 parser / CST library 决策和 UI 技术栈输入。

Round-trip POC 未通过前，不启动会对真实 Skill Source 写回的 Visual Editor。
